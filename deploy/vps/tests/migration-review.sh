#!/usr/bin/env bash
# Fail fast in CI: a migration newer than the last reviewed one must be added
# to reviewed_migrations in deploy.sh; otherwise production deploy stops only
# after a long build. Older migrations are already applied and may be pruned.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
list=$(grep -E '^reviewed_migrations=\(' "$root/deploy/vps/deploy.sh") || { echo 'reviewed_migrations not found in deploy.sh' >&2; exit 1; }
latest_reviewed=$(grep -oE '[0-9]{13}' <<<"$list" | sort -n | tail -n1)
[[ -n "$latest_reviewed" ]] || { echo 'reviewed_migrations has no timestamped entry' >&2; exit 1; }
status=0
for file in "$root"/apps/api/src/modules/database/migrations/*.ts; do
  name=$(grep -oE 'export class [A-Za-z0-9]+' "$file" | head -n1 | awk '{print $3}')
  [[ -n "$name" ]] || { echo "No migration name in $file" >&2; status=1; continue; }
  timestamp=${name: -13}
  if (( timestamp > latest_reviewed )) && [[ "$list" != *"$name"* ]]; then
    echo "Migration $name is not in reviewed_migrations (deploy/vps/deploy.sh)." >&2
    echo 'Review it as backwards-compatible with the running API, then add it.' >&2
    status=1
  fi
done
[[ "$status" != 0 ]] || echo 'All new migrations are reviewed for blue-green deploy'
exit "$status"
