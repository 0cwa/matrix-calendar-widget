import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkDocumentation } from './check-docs.mjs';

function fixture(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'calendar-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return (
    checked = Object.keys(files).filter((name) => name.endsWith('.md')),
  ) => checkDocumentation(root, checked);
}

test('validates navigation, images, references, and GitHub heading anchors', (t) => {
  const check = fixture(t, {
    'README.md':
      '# Start\n[Guide](docs/guide.md#héllo-code--links)\n![Diagram](diagram.svg)\n[Details][guide]\n[guide]: docs/guide.md#repeat-1\n[guide][]\n[guide]\n[HTML](docs/guide.md#custom)\n[Setext](docs/guide.md#setext-heading)\n[Directory](docs/#index)\n',
    'docs/README.md': '# Index',
    'docs/guide.md':
      '# Héllo `code` & [links](../README.md)\n## Repeat\n## Repeat\n<a id="custom"></a>\nSetext heading\n---\n',
    'diagram.svg': '<svg/>',
  });
  assert.deepEqual(check().errors, []);
});

test('reports moved files, removed headings, broken images, and undefined references', (t) => {
  const check = fixture(t, {
    'README.md':
      '# Start\n[Moved](old.md)\n[Changed](guide.md#removed)\n![Missing](missing.svg)\n[Unknown][gone]\n',
    'guide.md': '# Current',
  });
  assert.deepEqual(check().errors, [
    'README.md:2: missing file: old.md',
    'README.md:3: missing heading or anchor: guide.md#removed',
    'README.md:4: missing file: missing.svg',
    'README.md:5: undefined reference [gone]',
  ]);
});

test('handles encoded spaces, parentheses, query strings, and encoded Unicode anchors', (t) => {
  const check = fixture(t, {
    'README.md':
      '[One](docs/file%20name.md#caf%C3%A9)\n[Two](docs/file\\(copy\\).md?raw=1#café)\n[Three](<docs/file name.md>)\n[Four](docs/file(copy).md)\n',
    'docs/file name.md': '# Café',
    'docs/file(copy).md': '# Café',
  });
  assert.deepEqual(check().errors, []);
});

test('ignores fenced and inline examples, comments, and external destinations', (t) => {
  const check = fixture(t, {
    'README.md':
      '# Guide\n```md\n[Example](absent.md)\n```\n~~~md\n[Example][missing]\n~~~\n`[inline](absent.md)`\n<!-- [Comment](absent.md) -->\n[Web](https://example.org/no-check)\n[Mail](mailto:example@example.org)\n[CDN](//example.org/file)\n[Self](#guide)\n',
  });
  assert.deepEqual(check().errors, []);
  assert.equal(check().checkedLinks, 1);
});

test('rejects paths outside the repository and malformed URL escapes', (t) => {
  const check = fixture(t, {
    'README.md': '[Outside](../../etc/passwd)\n[Bad](bad%ZZ.md)\n',
  });
  assert.deepEqual(check().errors, [
    'README.md:1: destination escapes repository: ../../etc/passwd',
    'README.md:2: invalid URL encoding in bad%ZZ.md',
  ]);
});

test('retains GitHub duplicate-heading collision and explicit-anchor behavior', (t) => {
  const check = fixture(t, {
    'README.md':
      '# Repeat\n# Repeat\n# Repeat-1\n<a name="legacy"></a>\n[Second](#repeat-1)\n[Third](#repeat-1-1)\n[Legacy](#legacy)\n[GitHub](#user-content-repeat)\n',
  });
  assert.deepEqual(check().errors, []);
});

test('uses rendered heading emphasis while retaining underscores in code', (t) => {
  const check = fixture(t, {
    'README.md':
      '# _Readable_ **titles** and `_CONFIG_`\n[Heading](#readable-titles-and-_config_)\n`<a id="example"></a>`\n[Missing](#example)\n',
  });
  assert.deepEqual(check().errors, [
    'README.md:4: missing heading or anchor: #example',
  ]);
});

test('ignores indented code without hiding paragraph or list-continuation links', (t) => {
  const check = fixture(t, {
    'README.md':
      'An example:\n\n    [Example](absent-example.md)\n\t![Image](absent-example.svg)\n\nParagraph continuation:\n    [Real link](absent-paragraph.md)\n\n- List item:\n\n    [Real link](absent-list.md)\n\n      [Code example](absent-list-example.md)\n',
  });
  assert.deepEqual(check().errors, [
    'README.md:7: missing file: absent-paragraph.md',
    'README.md:11: missing file: absent-list.md',
  ]);
});

test('checks reference destinations on the following line', (t) => {
  const check = fixture(t, {
    'README.md':
      '[Guide][guide]\n[Broken][missing]\n\n[guide]:\n    guide.md#details\n[missing]:\n  absent.md "A title"\n',
    'guide.md': '# Details',
  });
  assert.deepEqual(check().errors, ['README.md:6: missing file: absent.md']);
  assert.equal(check().checkedLinks, 2);
});
