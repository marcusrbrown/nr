#!/usr/bin/env bash
# Render recipes with the pinned Blender (deps/blender, scripts/fetch-deps.sh) and post-process them into atlases.
#
#   tools/render/render-all.sh                      every recipe in tools/render/recipes/
#   tools/render/render-all.sh placeholder hero     the named recipes
#   OUT=<dir> tools/render/render-all.sh ...        output root (default out/render)
#
# Per recipe <name>: <OUT>/<name>/raw (nr_render.py frames + done.json), <OUT>/<name>/atlas (sheets + manifest),
# <OUT>/<name>/blender.log. A render that exits non-zero stops the run with that exit code (11: Blender version or
# build differs from the recipe's pin, 12: input error).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RENDER="$ROOT/tools/render"
OUT="${OUT:-$ROOT/out/render}"
BLENDER="${BLENDER:-$ROOT/deps/blender/Blender.app/Contents/MacOS/Blender}"

die() { echo "render-all: $*" >&2; exit 1; }

[ -x "$BLENDER" ] || die "no Blender at $BLENDER: run scripts/fetch-deps.sh"
PIN="$(awk '$1 == "blender:macos-arm64" { print $3; exit }' "$ROOT/scripts/deps.lock")"
[ -n "$PIN" ] || die "scripts/deps.lock pins no blender:macos-arm64"
case "$("$BLENDER" --version 2>&1 | sed -n '1p')" in
  "Blender $PIN "*) ;;
  *) die "installed Blender is not the locked $PIN: run FORCE=1 scripts/fetch-deps.sh" ;;
esac

if [ "$#" -gt 0 ]; then names=("$@"); else names=(); for f in "$RENDER"/recipes/*.json; do names+=("$(basename "$f" .json)"); done; fi

for name in "${names[@]}"; do
  recipe="$RENDER/recipes/$name.json"
  [ -f "$recipe" ] || die "no recipe $recipe"
  dir="$OUT/$name"
  rm -rf "$dir" && mkdir -p "$dir"
  echo "render-all: $name"
  rc=0
  "$BLENDER" --background --factory-startup --python-exit-code 1 --python "$RENDER/nr_render.py" -- \
    --recipe "$recipe" --out "$dir/raw" > "$dir/blender.log" 2>&1 || rc=$?
  grep -E '^RENDER ' "$dir/blender.log" || true
  if [ "$rc" -ne 0 ]; then
    tail -n 20 "$dir/blender.log" >&2
    echo "render-all: $name: Blender exited $rc" >&2
    exit "$rc"
  fi
  node "$RENDER/post.mjs" --recipe "$recipe" --raw "$dir/raw" --out "$dir/atlas"
done
