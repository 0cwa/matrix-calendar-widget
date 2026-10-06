import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNTIME_MANIFESTS = [
  'matrix-calendar-server/package.json',
  'packages/calendar/package.json',
  'packages/ical-timezones/package.json',
];

const MISSING_MODULE_KINDS = new Set([
  'declared-package',
  'unlisted-package',
  'relative-or-file',
  'ambiguous',
  'unknown',
]);
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

export function loadRuntimeDependencyAllowlist(rootDirectory) {
  const dependencies = new Set();
  for (const manifestPath of RUNTIME_MANIFESTS) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(rootDirectory, manifestPath), 'utf8'),
      );
      for (const field of ['dependencies', 'optionalDependencies']) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (PACKAGE_NAME_PATTERN.test(name)) dependencies.add(name);
        }
      }
    } catch {
      // A missing or malformed manifest disables name disclosure for that file.
    }
  }
  return dependencies;
}

function packageNameFromPath(path) {
  const parts = path.split(/[\\/]+/u);
  const nodeModulesIndex = parts.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0) return undefined;

  const first = parts[nodeModulesIndex + 1];
  if (!first) return undefined;
  if (first.startsWith('@')) {
    const second = parts[nodeModulesIndex + 2];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

function classifySpecifier(specifier, allowlist) {
  let packageName;
  let kind;

  if (specifier.startsWith('file:')) {
    try {
      packageName = packageNameFromPath(
        decodeURIComponent(new URL(specifier).pathname),
      );
    } catch {
      return { missingModuleKind: 'unknown' };
    }
    kind = packageName ? 'declared-package' : 'relative-or-file';
  } else if (
    specifier.startsWith('/') ||
    /^[a-z]:[\\/]/iu.test(specifier) ||
    specifier.startsWith('.')
  ) {
    packageName = packageNameFromPath(specifier);
    kind = packageName ? 'declared-package' : 'relative-or-file';
  } else if (specifier.startsWith('node:')) {
    return { missingModuleKind: 'unknown' };
  } else {
    packageName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    kind = 'unlisted-package';
  }

  if (!packageName || !allowlist.has(packageName)) {
    return {
      missingModuleKind: kind === 'declared-package' ? 'unknown' : kind,
    };
  }

  return {
    missingModuleKind: 'declared-package',
    missingDependency: packageName,
  };
}

export function diagnoseMissingModule(logText, allowlist) {
  const matches = [
    ...logText.matchAll(
      /Cannot find (?:package|module) ['"]([^'"\r\n]+)['"]/gu,
    ),
  ];
  if (matches.length === 0) return { missingModuleKind: 'unknown' };

  const classifications = new Map();
  for (const match of matches) {
    const classification = classifySpecifier(match[1], allowlist);
    const key = `${classification.missingModuleKind}:${classification.missingDependency ?? ''}`;
    classifications.set(key, classification);
  }
  if (classifications.size !== 1) return { missingModuleKind: 'ambiguous' };
  const [classification] = classifications.values();
  return classification;
}

export function isRuntimeDependencyName(value, allowlist) {
  return typeof value === 'string' && allowlist.has(value);
}

export function isMissingModuleKind(value) {
  return MISSING_MODULE_KINDS.has(value);
}
