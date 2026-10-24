#!/usr/bin/env bash
# Fetch what the game builds and runs with, pinned in scripts/deps.lock, into deps/ (gitignored):
#
#   deps/cartwheel-sdk/macos-arm64   prebuilt engine SDK (Darwin-executable: clang libs, cwpack, programs.mjs)
#   deps/cartwheel-sdk/cart          prebuilt cart SDK (target-only wasm32 libraries, wasmcart-pack, import checker)
#   deps/wasi-sdk, deps/binaryen     Darwin arm64 cart toolchain, linked into deps/cartwheel-sdk/cart/deps/
#   deps/cartwheel-engine            engine source at the pinned commit (tools/run-cart.mjs, tests/gate.mjs),
#                                    with deps/three.c and deps/wasmcart (Node packages + Playwright Chromium)
#
#   scripts/fetch-deps.sh            fetch what is missing
#   FORCE=1 scripts/fetch-deps.sh    refetch everything
#   DEPS_LOCK=<file> DEPS_DIR=<dir>  alternative lock and target directory (used to test tampered locks)
#
# Every archive's sha256 is checked before extraction; an archive whose digest differs, or that the lock gives
# no digest for, is refused. Extraction happens in a staging directory and is moved into place only when
# complete, so a failed fetch leaves no partial dependency directory.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${DEPS_LOCK:-$ROOT/scripts/deps.lock}"
DEPS="${DEPS_DIR:-$ROOT/deps}"
STAGE="$DEPS/.stage.$$"
DL="$DEPS/.dl"

die() { echo "fetch-deps: $*" >&2; exit 1; }
cleanup() { rm -rf "$STAGE"; rm -f "$DL"/*.part 2>/dev/null || true; }
trap cleanup EXIT

[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || die "pins cover Darwin arm64 only (this host: $(uname -s)-$(uname -m))"
for tool in curl tar git node npm; do command -v "$tool" >/dev/null || die "missing tool: $tool"; done
[ -f "$LOCK" ] || die "no lock file: $LOCK"
mkdir -p "$DEPS" "$DL"
rm -rf "$STAGE" && mkdir -p "$STAGE"

sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
lock_line() { # name -> the lock line for exactly that name
  local l
  l="$(awk -v n="$1" '$1 == n { print; exit }' "$LOCK")"
  [ -n "$l" ] || die "scripts/deps.lock pins no $1"
  echo "$l"
}
is_sha() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
is_commit() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

# download <name> <url> <sha256> -> echoes the verified archive path
download() {
  local name=$1 url=$2 sha=$3 file
  is_sha "$sha" || die "$name: no sha256 in the lock; refusing an unverified archive"
  file="$DL/$(basename "$url")"
  if [ -f "$file" ] && [ "$(sha256_of "$file")" != "$sha" ]; then rm -f "$file"; fi
  if [ ! -f "$file" ]; then
    curl -fsSL "$url" -o "$file.part" || die "$name: download failed: $url"
    local got; got="$(sha256_of "$file.part")"
    if [ "$got" != "$sha" ]; then
      rm -f "$file.part"
      die "$name: sha256 mismatch (lock $sha, got $got): $url"
    fi
    mv -f "$file.part" "$file"
  fi
  echo "$file"
}

# install_archive <name> <url> <version> <sha256> <dest>: verify, extract (top directory stripped), move into place
install_archive() {
  local name=$1 url=$2 ver=$3 sha=$4 dst=$5 tgz
  if [ -f "$dst/.version" ] && [ "$(cat "$dst/.version")" = "$ver $sha" ] && [ "${FORCE:-0}" != 1 ]; then
    echo "$name: $ver (present)"; return
  fi
  tgz="$(download "$name" "$url" "$sha")"
  local tmp="$STAGE/$name"
  rm -rf "$tmp" && mkdir -p "$tmp"
  tar -xzf "$tgz" -C "$tmp" --strip-components=1 || die "$name: extraction failed: $tgz"
  echo "$ver $sha" > "$tmp/.version"
  rm -rf "$dst" && mkdir -p "$(dirname "$dst")" && mv "$tmp" "$dst"
  echo "$name: $ver"
}

# fetch_git <name> <url> <full commit> <dest>: shallow fetch of exactly that commit, moved into place when complete
fetch_git() {
  local name=$1 url=$2 rev=$3 dst=$4
  is_commit "$rev" || die "$name: lock must pin a full 40-hex commit (got '$rev')"
  if [ -d "$dst/.git" ] && [ "${FORCE:-0}" != 1 ] && [ "$(git -C "$dst" rev-parse HEAD 2>/dev/null)" = "$rev" ]; then
    echo "$name: $rev (present)"; return
  fi
  local tmp="$STAGE/$name"
  rm -rf "$tmp" && git init -q "$tmp"
  git -C "$tmp" fetch -q --depth 1 "$url" "$rev" || die "$name: cannot fetch $rev from $url"
  git -C "$tmp" -c advice.detachedHead=false checkout -q "$rev"
  [ "$(git -C "$tmp" rev-parse HEAD)" = "$rev" ] || die "$name: checkout is not $rev"
  rm -rf "$dst" && mkdir -p "$(dirname "$dst")" && mv "$tmp" "$dst"
  echo "$name: $rev"
}

# ── the engine's source ────────────────────────────────────────────
L="$(lock_line cartwheel-engine)" || exit 1; read -r _ ENGINE_URL ENGINE_TAG ENGINE_REV <<< "$L"
ENGINE="$DEPS/cartwheel-engine"
fetch_git cartwheel-engine "$ENGINE_URL" "$ENGINE_REV" "$ENGINE"

# the engine's own lock must agree with ours on the dependencies we re-pin
engine_pin() { awk -v n="$1" '$1 == n { print $4; exit }' "$ENGINE/scripts/deps.lock"; }
L="$(lock_line three.c)" || exit 1; read -r _ THREEC_URL _ THREEC_REV <<< "$L"
L="$(lock_line wasmcart)" || exit 1; read -r _ WASMCART_URL _ WASMCART_REV <<< "$L"
[ "$(engine_pin three.c)" = "$THREEC_REV" ] || die "three.c pin differs from the engine's scripts/deps.lock at $ENGINE_TAG"
[ "$(engine_pin wasmcart)" = "$WASMCART_REV" ] || die "wasmcart pin differs from the engine's scripts/deps.lock at $ENGINE_TAG"

fetch_git three.c "$THREEC_URL" "$THREEC_REV" "$ENGINE/deps/three.c"

# wasmcart: the hosts run-cart.mjs drives; Node packages from its lockfile
WC="$ENGINE/deps/wasmcart"
if [ ! -d "$WC/node_modules" ] || [ "$(git -C "$WC" rev-parse HEAD 2>/dev/null)" != "$WASMCART_REV" ] || [ "${FORCE:-0}" = 1 ]; then
  rm -rf "$WC"
  fetch_git wasmcart "$WASMCART_URL" "$WASMCART_REV" "$STAGE/wasmcart-src"
  [ -f "$STAGE/wasmcart-src/package-lock.json" ] || die "wasmcart: no package-lock.json at $WASMCART_REV"
  (cd "$STAGE/wasmcart-src" && npm ci --no-audit --no-fund >/dev/null) || die "wasmcart: npm ci failed"
  mkdir -p "$(dirname "$WC")" && mv "$STAGE/wasmcart-src" "$WC"
fi
echo "wasmcart: $WASMCART_REV (node_modules installed)"

# Playwright's Chromium, at the version wasmcart's lockfile resolved (browser cache: ~/Library/Caches/ms-playwright)
(cd "$WC" && npx --no-install playwright install chromium) || die "playwright: chromium install failed"

# ── the SDKs ───────────────────────────────────────────────────────
for t in macos-arm64 cart; do
  L="$(lock_line "cartwheel-sdk:$t")" || exit 1; read -r _ url ver sha <<< "$L"
  install_archive "cartwheel-sdk:$t" "$url" "$ver" "$sha" "$DEPS/cartwheel-sdk/$t"
done

# ── the cart toolchain (Darwin-executable; the cart SDK's own fetch script pins linux-x64 builds) ──
L="$(lock_line wasi-sdk:darwin-arm64)" || exit 1; read -r _ url ver sha <<< "$L"
install_archive wasi-sdk "$url" "$ver" "$sha" "$DEPS/wasi-sdk"
L="$(lock_line binaryen:darwin-arm64)" || exit 1; read -r _ url ver sha <<< "$L"
install_archive binaryen "$url" "$ver" "$sha" "$DEPS/binaryen"

# cmake/cart.cmake and cmake/flags.cmake look in <cart SDK>/deps/{wasi-sdk,binaryen}
mkdir -p "$DEPS/cartwheel-sdk/cart/deps"
for d in wasi-sdk binaryen; do
  rm -rf "$DEPS/cartwheel-sdk/cart/deps/$d"
  ln -sfn "../../../$d" "$DEPS/cartwheel-sdk/cart/deps/$d"
done

echo "fetch-deps: done"
