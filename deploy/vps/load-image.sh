#!/usr/bin/env bash
# Receive an archive on stdin over authenticated SSH. No services or volumes.
set -euo pipefail
checksum=${1:?Pass the expected archive SHA256}
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid archive checksum' >&2; exit 1; }
archive=$(mktemp /tmp/pingpong-image.XXXXXX.tar)
trap 'rm -f -- "$archive"' EXIT
chmod 600 "$archive"
started=$SECONDS
printf '[%s] Receiving image archive over SSH (progress in bytes)...\n' "$(date -u +%FT%TZ)"
# dd reports progress while reading stdin; bound stalled transfers separately
# from Docker unpacking. Docker load accepts both plain and gzip archives.
timeout 900 dd bs=1M status=progress of="$archive"
printf '[%s] Received %s bytes in %ss; verifying SHA256...\n' \
  "$(date -u +%FT%TZ)" "$(stat -c %s "$archive")" "$((SECONDS-started))"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --strict
started=$SECONDS
printf '[%s] Checksum OK; loading image into Docker (timeout 10 minutes)...\n' "$(date -u +%FT%TZ)"
timeout 600 docker image load --input "$archive"
printf '[%s] Image loaded in %ss.\n' "$(date -u +%FT%TZ)" "$((SECONDS-started))"
