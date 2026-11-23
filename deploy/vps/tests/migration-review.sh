#!/usr/bin/env bash
# Every SQL Server migration must be reviewed for blue-green deploy.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
list=$(grep -E '^reviewed_migrations=\(' "$root/deploy/vps/deploy.sh") || { echo 'reviewed_migrations not found in deploy.sh' >&2; exit 1; }
status=0
for file in "$root"/apps/api/src/modules/database/migrations-sqlserver/*.ts; do
  name=$(grep -oE 'export class [A-Za-z0-9]+' "$file" | head -n1 | awk '{print $3}')
  [[ -n "$name" ]] || { echo "No migration name in $file" >&2; status=1; continue; }
  if [[ "$list" != *"$name"* ]]; then
    echo "Migration $name is not in reviewed_migrations (deploy/vps/deploy.sh)." >&2
    echo 'Review it as backwards-compatible with the running API, then add it.' >&2
    status=1
  fi
done
[[ "$status" != 0 ]] || echo 'All new migrations are reviewed for blue-green deploy'
exit "$status"
