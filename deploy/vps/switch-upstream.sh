#!/usr/bin/env bash
# Install root-owned as /usr/local/sbin/pingpong-switch-upstream.
# Only these fixed ports/file can be changed via sudo. No repository path args.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ "$EUID" == 0 && "$#" == 1 ]] || { echo 'Run as root with status, 3000 or 3001' >&2; exit 1; }
target=/etc/nginx/conf.d/pingpong-upstream.conf
[[ -f "$target" && ! -L "$target" ]] || { echo 'Install the managed upstream first' >&2; exit 1; }
if [[ "$1" == status ]]; then
  port=$(sed -nE 's/^[[:space:]]*server 127\.0\.0\.1:(3000|3001);[[:space:]]*$/\1/p' "$target")
  [[ "$port" == 3000 || "$port" == 3001 ]] || { echo 'Invalid managed upstream' >&2; exit 1; }
  echo "$port"
  exit
fi
[[ "$1" == 3000 || "$1" == 3001 ]] || { echo 'Unsupported API port' >&2; exit 1; }
exec 9>/run/lock/pingpong-upstream.lock
flock -n 9 || { echo 'Another upstream switch is running' >&2; exit 1; }
backup=$(mktemp /etc/nginx/.pingpong-backup.XXXXXX)
temporary=$(mktemp /etc/nginx/conf.d/.pingpong-upstream.XXXXXX)
changed=false
committed=false
cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  if [[ "$changed" == true && "$committed" == false ]]; then
    cp -p -- "$backup" "$target"
    if ! nginx -t || ! systemctl reload nginx; then
      echo 'CRITICAL: restoring Nginx failed; inspect configuration immediately' >&2
    fi
  fi
  rm -f -- "$backup" "$temporary"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
cp -p -- "$target" "$backup"
printf 'upstream pingpong_api {\n    server 127.0.0.1:%s;\n}\n' "$1" > "$temporary"
chmod 644 "$temporary"
changed=true
mv -f -- "$temporary" "$target"
if nginx -t && systemctl reload nginx; then
  committed=true
  echo "Nginx upstream switched to $1"
else
  exit 1
fi
