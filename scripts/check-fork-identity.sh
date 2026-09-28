#!/usr/bin/env bash
set -euo pipefail

failed=0

for path in   matrix-meetings-widget   matrix-meetings-bot   charts/matrix-meetings   charts/matrix-meetings-widget   charts/matrix-meetings-bot
do
  if [[ -e "$path" ]]; then
    echo "legacy fork path must not exist: $path" >&2
    failed=1
  fi
done

if grep -RInE   '@nordeck/matrix-meetings-(widget|bot|calendar)|ghcr\.io/nordeck/matrix-meetings-(widget|bot)'   .   --exclude='CHANGELOG.md'   --exclude='NOTICE'   --exclude-dir='.git'   --exclude-dir='docs'
then
  echo "legacy Nordeck package or image target found in active files" >&2
  failed=1
fi

# Development chart defaults must not target the inherited Nordeck tenant.
# Keep this check scoped to deployment inputs; provenance and history docs may
# legitimately mention upstream names and URLs.
if grep -RInE 'nordeck\.io' charts dev
then
  echo "inherited Nordeck tenant hostname found in chart or dev configuration" >&2
  failed=1
fi

if grep -RIn 'NeoDateFix'   matrix-calendar-widget matrix-calendar-server e2e charts   --exclude='CHANGELOG.md'   --exclude='NOTICE'
then
  echo "legacy NeoDateFix branding found in active runtime/test/deployment files" >&2
  failed=1
fi

if grep -RIn 'github.com/nordeck/matrix-meetings'   matrix-calendar-widget matrix-calendar-server e2e charts package.json   --exclude='CHANGELOG.md'   --exclude='NOTICE'
then
  echo "legacy upstream repository URL found in active package/deployment files" >&2
  failed=1
fi

exit "$failed"
