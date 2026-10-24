#!/usr/bin/env bash
# Build the project against the prebuilt Cartwheel SDKs fetched by scripts/fetch-deps.sh,
# one build tree per target (build/<target>):
#
#   native   build/native   host SDK (deps/cartwheel-sdk/macos-arm64), Apple clang
#   cart     build/cart     cart SDK (deps/cartwheel-sdk/cart), wasi-sdk + Binaryen from deps/
#
#   scripts/build.sh                          native and cart
#   TARGETS="native" scripts/build.sh         one target
#   BUILD_TYPE=Debug scripts/build.sh         CMake build type (default Release)
#   CW_CART_DEV=1 scripts/build.sh            cart from the SDK's non-LTO libraries, no wasm-opt (fast dev carts)
#
# The root CMakeLists.txt finds the SDK with find_package(cartwheel CONFIG) and adds the games.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BT="${BUILD_TYPE:-Release}"
SDK="$ROOT/deps/cartwheel-sdk"

die() { echo "build: $*" >&2; exit 1; }

[ -f "$ROOT/CMakeLists.txt" ] || die "no CMakeLists.txt at $ROOT: the project has no build to run yet"
command -v cmake >/dev/null || die "missing tool: cmake"
command -v ninja >/dev/null || die "missing tool: ninja"
[ -d "$SDK/macos-arm64" ] || die "deps/cartwheel-sdk/macos-arm64 missing: run scripts/fetch-deps.sh"

for t in ${TARGETS:-native cart}; do
  case "$t" in
    native)
      cmake -S "$ROOT" -B "$ROOT/build/native" -G Ninja -DCMAKE_BUILD_TYPE="$BT" \
        -Dcartwheel_DIR="$SDK/macos-arm64/lib/cmake/cartwheel" >/dev/null ;;
    cart)
      [ -d "$SDK/cart" ] || die "deps/cartwheel-sdk/cart missing: run scripts/fetch-deps.sh"
      [ -x "$ROOT/deps/wasi-sdk/bin/clang" ] || die "deps/wasi-sdk missing: run scripts/fetch-deps.sh"
      cmake -S "$ROOT" -B "$ROOT/build/cart" -G Ninja -DCMAKE_BUILD_TYPE="$BT" \
        -DCMAKE_TOOLCHAIN_FILE="$SDK/cart/cmake/cart.cmake" \
        -Dcartwheel_DIR="$SDK/cart/lib/cmake/cartwheel" \
        -DCW_CWPACK="$SDK/macos-arm64/bin/cwpack" \
        ${CW_CART_DEV:+-DCW_CART_DEV=ON} >/dev/null ;;
    *) die "unknown target '$t' (native, cart)" ;;
  esac
  ninja -C "$ROOT/build/$t"
  ninja -C "$ROOT/build/$t" -t cleandead >/dev/null # outputs of targets that no longer exist
  # a cart no target packs any more must not linger in carts/: tools would still find and run it
  if [ -f "$ROOT/build/$t/carts.txt" ] && [ -d "$ROOT/build/$t/carts" ]; then
    for f in "$ROOT/build/$t/carts/"*.wasc; do
      [ -e "$f" ] || continue
      n="$(basename "$f" .wasc)"
      grep -qxF "$n" "$ROOT/build/$t/carts.txt" || { echo "removing stale cart $n.wasc ($t)"; rm -f "$f"; }
    done
  fi
done
