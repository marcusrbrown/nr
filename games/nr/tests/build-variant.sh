#!/usr/bin/env bash
# Build a measurement or control variant of the nr apps into out/<dir>/<target>, with the same SDKs and
# configure options as scripts/build.sh, plus extra CMake definitions. NINJA_TARGETS limits the build to named apps.
#
#   [NINJA_TARGETS="nr_stress"] games/nr/tests/build-variant.sh <out-dir> <native|cart|cart-wgpu> [-DNR_PERF=ON ...]
#
# Example: NINJA_TARGETS=nr_stress games/nr/tests/build-variant.sh out/unit8/build-perf native -DNR_PERF=ON
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
  cart|cart-wgpu)
    cmake -S "$ROOT" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_TOOLCHAIN_FILE="$SDK/$TARGET/cmake/cart.cmake" \
      -Dcartwheel_DIR="$SDK/$TARGET/lib/cmake/cartwheel" \
      -DCW_CWPACK="$SDK/macos-arm64/bin/cwpack" "$@" >/dev/null ;;
  *) echo "build-variant: target must be native, cart or cart-wgpu" >&2; exit 1 ;;
esac
# shellcheck disable=SC2086
ninja -C "$BUILD" ${NINJA_TARGETS:-}
