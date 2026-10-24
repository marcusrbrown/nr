#!/usr/bin/env bash
# Build a measurement or control variant of the litspike apps into out/<dir>/<target>, with the same SDKs and
# configure options as scripts/build.sh, plus extra CMake definitions.
#
#   games/litspike/tests/build-variant.sh <out-dir> <native|cart> [-DLITSPIKE_PERF=ON ...]
#
# Example: games/litspike/tests/build-variant.sh out/litspike/build-perf native -DLITSPIKE_PERF=ON
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SDK="$ROOT/deps/cartwheel-sdk"
OUTDIR="$1"
TARGET="$2"
shift 2
BUILD="$ROOT/$OUTDIR/$TARGET"

case "$TARGET" in
  native)
    cmake -S "$ROOT" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -Dcartwheel_DIR="$SDK/macos-arm64/lib/cmake/cartwheel" "$@" >/dev/null ;;
  cart)
    cmake -S "$ROOT" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_TOOLCHAIN_FILE="$SDK/cart/cmake/cart.cmake" \
      -Dcartwheel_DIR="$SDK/cart/lib/cmake/cartwheel" \
      -DCW_CWPACK="$SDK/macos-arm64/bin/cwpack" "$@" >/dev/null ;;
  *) echo "build-variant: target must be native or cart" >&2; exit 1 ;;
esac
ninja -C "$BUILD"
