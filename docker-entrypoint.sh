#!/bin/sh
set -e

# /data may have been mounted from a host path owned by a different uid
# (common on Unraid where appdata is nobody:users / 99:100). Take ownership
# so the unprivileged `node` user can read and write the SQLite DB, then
# drop to that user for the real process.
chown -R node:node /data 2>/dev/null || true

exec gosu node:node "$@"
