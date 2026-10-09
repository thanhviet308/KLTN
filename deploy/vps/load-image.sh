#!/usr/bin/env bash
# Receive an archive on stdin over authenticated SSH. No services or volumes.
set -euo pipefail
checksum=${1:?Pass the expected archive SHA256}
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid archive checksum' >&2; exit 1; }
archive=$(mktemp /tmp/pingpong-image.XXXXXX.tar)
trap 'rm -f -- "$archive"' EXIT
chmod 600 "$archive"
cat > "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --strict
docker image load --input "$archive"
