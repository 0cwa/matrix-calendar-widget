#!/usr/bin/env node

// Check repository-local Markdown destinations without network access or packages.
// This covers the Markdown forms used in this repository, not arbitrary MDX.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const blank = (text) => text.replace(/[^\n]/g, ' ');
const unescape = (text) =>
  text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
const referenceKey = (text) =>
  unescape(text).trim().replace(/\s+/g, ' ').toLowerCase();

function prose(source) {
  let fence;
  let previousBlank = true;
  let indentedCode = false;
  const listIndents = [];
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (marker?.[1][0] === fence[0] && marker[1].length >= fence.length) {
          fence = undefined;
        }
        return blank(line);
      }
      if (marker) {
        fence = marker[1];
        return blank(line);
      }
      if (!line.trim()) {
        previousBlank = true;
        return line;
      }
      const prefix = line.match(/^[ \t]*/)[0];
      const indent = [...prefix].reduce(
        (column, character) =>
          column + (character === '\t' ? 4 - (column % 4) : 1),
        0,
      );
      while (listIndents.length && indent < listIndents.at(-1))
        listIndents.pop();
      const containerIndent = listIndents.at(-1) ?? 0;
      if ((previousBlank || indentedCode) && indent >= containerIndent + 4) {
        indentedCode = true;
        return blank(line);
      }
      indentedCode = false;
      previousBlank = false;
      // A list's indented continuation is prose; code needs four further columns.
      const list = line.match(/^[ \t]*([-+*]|\d+[.)])([ \t]+)/);
      if (list && indent < containerIndent + 4) {
        listIndents.push(indent + list[1].length + list[2].length);
      }
      return line;
    })
    .join('\n');
}

function anchors(source) {
  const text = prose(source);
  const result = new Set();
  const generated = new Set();
  const html = text.replace(/(`+)([\s\S]*?)\1/g, blank);
  for (const match of html.matchAll(
    /<[a-z][^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/gi,
  )) {
    result.add(match[1]);
  }
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const atx = lines[index].match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/);
    const setext = lines[index + 1]?.match(/^ {0,3}(?:=+|-+)\s*$/);
    if (!atx && (!setext || !lines[index].trim())) continue;
    const codeSpans = [];
    const heading = (atx?.[1] ?? lines[index])
      .replace(/(`+)([\s\S]*?)\1/g, (_, delimiter, code) => {
        codeSpans.push(code);
        return `\uE000${codeSpans.length - 1}\uE001`;
      })
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/(\*{1,2}|_{1,2})(?=\S)(.*?\S)\1/g, '$2')
      .replace(/\uE000(\d+)\uE001/g, (_, index) => codeSpans[Number(index)])
      .replace(
        /&(?:amp|lt|gt|quot|apos|#39);/g,
        (entity) =>
          ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&apos;': "'",
            '&#39;': "'",
          })[entity],
      )
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, number) =>
        String.fromCodePoint(
          number[0].toLowerCase() === 'x'
            ? parseInt(number.slice(1), 16)
            : Number(number),
        ),
      );
    const base = unescape(heading)
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-');
    let slug = base;
    let suffix = 0;
    while (generated.has(slug)) slug = `${base}-${++suffix}`;
    generated.add(slug);
    result.add(slug);
  }
  return result;
}

function closingBracket(text, start) {
  let depth = 1;
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '[') depth += 1;
    else if (text[index] === ']' && --depth === 0) return index;
  }
  return -1;
}

function destination(text, start) {
  let index = start;
  while (/\s/.test(text[index] ?? '') && index < text.length) index += 1;
  if (text[index] === '<') {
    const end = text.indexOf('>', index + 1);
    return end < 0 ? undefined : text.slice(index + 1, end);
  }
  const begin = index;
  let depth = 0;
  for (; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      if (!depth) break;
      depth -= 1;
    } else if (/\s/.test(text[index]) && !depth) break;
  }
  return text.slice(begin, index);
}

function links(source) {
  // Keep offsets so a failed destination points at its source line.
  let text = prose(source).replace(/(`+)([\s\S]*?)\1/g, blank);
  const references = new Map();
  const result = [];
  text = text.replace(
    /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:\n[ \t]*)?([^ \t\n][^\n]*)$/gm,
    (definition, label, rest, offset) => {
      const target = destination(rest, 0);
      references.set(referenceKey(label), target);
      result.push({ target, offset });
      return blank(definition);
    },
  );
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] !== '[') continue;
    const end = closingBracket(text, index);
    if (end < 0) continue;
    if (text[end + 1] === '(') {
      result.push({ target: destination(text, end + 2), offset: index });
    } else if (text[end + 1] === '[') {
      const referenceEnd = closingBracket(text, end + 1);
      if (referenceEnd < 0) continue;
      const label =
        text.slice(end + 2, referenceEnd) || text.slice(index + 1, end);
      const key = referenceKey(label);
      if (!references.has(key))
        result.push({ error: `undefined reference [${label}]`, offset: index });
    }
    // Shortcut references are checked once, at their definition.
  }
  return result;
}

export function checkDocumentation(root, files) {
  const errors = [];
  const headingCache = new Map();
  let checkedLinks = 0;
  for (const file of files) {
    const sourcePath = path.resolve(root, file);
    if (!existsSync(sourcePath)) continue; // A tracked file may be deleted locally.
    const source = readFileSync(sourcePath, 'utf8');
    for (const link of links(source)) {
      const line = source.slice(0, link.offset).split('\n').length;
      const fail = (message) => errors.push(`${file}:${line}: ${message}`);
      if (link.error) {
        fail(link.error);
        continue;
      }
      const target = unescape(link.target ?? '');
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
      checkedLinks += 1;
      const hash = target.indexOf('#');
      const rawPath = (hash < 0 ? target : target.slice(0, hash)).split('?')[0];
      let localPath;
      let fragment;
      try {
        localPath = decodeURIComponent(rawPath);
        fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
      } catch {
        fail(`invalid URL encoding in ${target}`);
        continue;
      }
      let resolved = localPath
        ? path.resolve(
            localPath.startsWith('/') ? root : path.dirname(sourcePath),
            localPath.replace(/^\//, ''),
          )
        : sourcePath;
      const relative = path.relative(root, resolved);
      if (
        relative.startsWith(`..${path.sep}`) ||
        relative === '..' ||
        path.isAbsolute(relative)
      ) {
        fail(`destination escapes repository: ${target}`);
        continue;
      }
      if (!existsSync(resolved)) {
        fail(`missing file: ${target}`);
        continue;
      }
      if (!fragment) continue;
      if (statSync(resolved).isDirectory()) {
        const readme = ['README.md', 'readme.md'].find((name) =>
          existsSync(path.join(resolved, name)),
        );
        if (!readme) {
          fail(`directory has no README for fragment: ${target}`);
          continue;
        }
        resolved = path.join(resolved, readme);
      }
      if (!/\.md$/i.test(resolved)) continue; // Binary/source-file fragments have other semantics.
      if (!headingCache.has(resolved))
        headingCache.set(resolved, anchors(readFileSync(resolved, 'utf8')));
      const available = headingCache.get(resolved);
      if (
        !available.has(fragment) &&
        !available.has(fragment.replace(/^user-content-/, ''))
      ) {
        fail(`missing heading or anchor: ${target}`);
      }
    }
  }
  return { errors, checkedLinks };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    // Include untracked, non-ignored drafts so contributors can check before staging.
    // Generated changelogs and bundled third-party timezone data are excluded.
    const files = [
      ...new Set(
        execFileSync(
          'git',
          ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
          {
            cwd: root,
            encoding: 'utf8',
          },
        ).split('\0'),
      ),
    ].filter(
      (file) =>
        /\.md$/i.test(file) &&
        !/(?:^|\/)(?:node_modules|build|dist|coverage|lib)\//.test(file) &&
        !/(?:^|\/)CHANGELOG\.md$/.test(file) &&
        !file.startsWith('packages/ical-timezones/src/data/'),
    );
    const { errors, checkedLinks } = checkDocumentation(root, files);
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(
        `Checked ${files.length} Markdown files and ${checkedLinks} local links.`,
      );
    }
  } catch (error) {
    console.error(`Documentation check could not finish: ${error.message}`);
    process.exitCode = 1;
  }
}
