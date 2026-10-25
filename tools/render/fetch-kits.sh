#!/usr/bin/env bash
# Verify and stage the pinned character kits into deps/kits/ (gitignored). See tools/render/kits.mjs for the options
# and for why the first download is manual.
#
#   tools/render/fetch-kits.sh                          verify and stage what kits.json pins
#   tools/render/fetch-kits.sh --from <download dir>    stage from a directory (or zips) downloaded from the kit's itch.io page
#   tools/render/fetch-kits.sh --from <dir> --kit <id> --pin    first fetch: record sha256 and size in kits.json
#   tools/render/fetch-kits.sh --check                  verify only
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v node >/dev/null || { echo "fetch-kits: missing tool: node" >&2; exit 1; }
exec node "$ROOT/tools/render/kits.mjs" "$@"
