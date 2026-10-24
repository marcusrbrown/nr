#!/usr/bin/env bash
# Check the host and record its tuple in build/tuple.json.
#
#   required (exit 1 if any is missing): clang, cmake, ninja, node
#   recorded when present, never fatal:  git, bun, docker, romdev (/healthz at $ROMDEV_URL)
#
# tuple.json carries the host tools' versions, the romdev host's reported versions, the pins from
# scripts/deps.lock, and what scripts/fetch-deps.sh has installed under deps/.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROMDEV_URL="${ROMDEV_URL:-http://localhost:7331}"
OUT="$ROOT/build/tuple.json"

missing=()
for tool in clang cmake ninja node; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "preflight: missing required tool(s): ${missing[*]}" >&2
  exit 1
fi

# run a command, give up after N seconds (macOS has no timeout(1))
bounded() { # seconds cmd...
  local secs=$1; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) & local watcher=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
  return "$rc"
}
first_line() { "$@" 2>&1 | head -n 1; }

export TUPLE_CLANG="$(first_line clang --version)"
export TUPLE_CLANG_PATH="$(command -v clang)"
export TUPLE_CMAKE="$(first_line cmake --version)"
export TUPLE_NINJA="$(first_line ninja --version)"
export TUPLE_NODE="$(first_line node --version)"
export TUPLE_GIT="$(command -v git >/dev/null && first_line git --version)"
export TUPLE_BUN="$(command -v bun >/dev/null && first_line bun --version)"

# optional: docker (client version, and the daemon's when it answers)
export TUPLE_DOCKER_CLIENT="" TUPLE_DOCKER_SERVER=""
if command -v docker >/dev/null 2>&1; then
  TUPLE_DOCKER_CLIENT="$(first_line docker --version)"
  TUPLE_DOCKER_SERVER="$(bounded 5 docker version --format '{{.Server.Version}}' 2>/dev/null | head -n 1)"
fi

# optional: romdev. /healthz reports the server version; /openapi.json carries the HTTP API version.
# The wasmcart runtime version is not reported by either: a loaded cart exposes only its ABI (wasm{op:info}).
export TUPLE_ROMDEV_URL="$ROMDEV_URL" TUPLE_ROMDEV_HEALTH="" TUPLE_ROMDEV_OPENAPI_VERSION=""
if command -v curl >/dev/null 2>&1; then
  TUPLE_ROMDEV_HEALTH="$(curl -fsS -m 3 "$ROMDEV_URL/healthz" 2>/dev/null || true)"
  if [ -n "$TUPLE_ROMDEV_HEALTH" ]; then
    TUPLE_ROMDEV_OPENAPI_VERSION="$(curl -fsS -m 5 "$ROMDEV_URL/openapi.json" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).info.version)}catch{}})')"
  fi
fi

# romdev's install, found from the process listening on its port: the wasmcart package it carries, and whether
# its headless-GL module (webgl-node -> native-gles) loads on this host (wasmcart GL carts need it)
export TUPLE_ROMDEV_ROOT=""
if [ -n "$TUPLE_ROMDEV_HEALTH" ] && command -v lsof >/dev/null 2>&1; then
  rd_port="${ROMDEV_URL##*:}"; rd_port="${rd_port%%/*}"
  for pid in $(lsof -nP -iTCP:"$rd_port" -sTCP:LISTEN -t 2>/dev/null); do
    bin="$(ps -o command= -p "$pid" 2>/dev/null | tr ' ' '\n' | grep -m1 '/bin/romdevtools$' || true)"
    [ -n "$bin" ] && TUPLE_ROMDEV_ROOT="$(cd "$(dirname "$bin")/.." && pwd)" && break
  done
fi

# what fetch-deps.sh installed
export TUPLE_DEPS_DIR="$ROOT/deps"
export TUPLE_PINS="$(node "$ROOT/scripts/gen-pins-table.mjs" --json)"
export TUPLE_OS="$(uname -s)" TUPLE_ARCH="$(uname -m)" TUPLE_KERNEL="$(uname -r)"
export TUPLE_OS_VERSION="$(command -v sw_vers >/dev/null && sw_vers -productVersion)"
export TUPLE_WASI_CLANG="" TUPLE_BINARYEN=""
[ -x "$ROOT/deps/wasi-sdk/bin/clang" ] && TUPLE_WASI_CLANG="$(first_line "$ROOT/deps/wasi-sdk/bin/clang" --version)"
[ -x "$ROOT/deps/binaryen/bin/wasm-opt" ] && TUPLE_BINARYEN="$(first_line "$ROOT/deps/binaryen/bin/wasm-opt" --version)"

mkdir -p "$ROOT/build"
node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const e = process.env;
const some = (v) => (v ? v : null);
const git = (dir, ...a) => { const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
const jsonFile = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const version = (f) => { try { return readFileSync(f, "utf8").trim(); } catch { return null; } };
const deps = e.TUPLE_DEPS_DIR;
let health = null;
try { health = JSON.parse(e.TUPLE_ROMDEV_HEALTH); } catch { /* unavailable */ }
const romdevPkg = (name) => { const r = e.TUPLE_ROMDEV_ROOT; const m = r && jsonFile(join(r, "node_modules", name, "package.json")); return m ? m.version : null; };
const glLoads = () => {
  const r = e.TUPLE_ROMDEV_ROOT;
  if (!r) return null;
  const p = spawnSync(process.execPath, ["--input-type=module", "-e", "await import(\"webgl-node\")"], { cwd: join(r, "node_modules", "webgl-node"), encoding: "utf8" });
  return p.status === 0;
};
const sdk = (t) => { const m = jsonFile(join(deps, "cartwheel-sdk", t, "manifest.json")); return m && { version: m.version, commit: m.commit, build_type: m.build_type, toolchains: m.toolchains, version_stamp: version(join(deps, "cartwheel-sdk", t, ".version")) }; };
const tuple = {
  schema: 1,
  generated_at: new Date().toISOString(),
  host: { os: e.TUPLE_OS, os_version: some(e.TUPLE_OS_VERSION), arch: e.TUPLE_ARCH, kernel: e.TUPLE_KERNEL },
  tools: {
    clang: { version: e.TUPLE_CLANG, path: e.TUPLE_CLANG_PATH },
    cmake: e.TUPLE_CMAKE,
    ninja: e.TUPLE_NINJA,
    node: e.TUPLE_NODE,
    git: some(e.TUPLE_GIT),
    bun: some(e.TUPLE_BUN),
    docker: e.TUPLE_DOCKER_CLIENT ? { client: e.TUPLE_DOCKER_CLIENT, server: some(e.TUPLE_DOCKER_SERVER) } : null,
  },
  romdev: {
    url: e.TUPLE_ROMDEV_URL,
    available: !!(health && health.ok),
    version: health ? health.version : null,
    openapi_version: some(e.TUPLE_ROMDEV_OPENAPI_VERSION),
    wasmcart_runtime_version: romdevPkg("wasmcart"),
    wasmcart_runtime_source: e.TUPLE_ROMDEV_ROOT ? "node_modules/wasmcart of the process listening on the romdev port" : null,
    wasmcart_runtime_note: "not reported by /healthz or /openapi.json; a loaded cart reports only its ABI via wasm{op:info}",
    gl_module_loads: glLoads(),
  },
  installed: {
    engine: existsSync(join(deps, "cartwheel-engine", ".git")) ? git(join(deps, "cartwheel-engine"), "rev-parse", "HEAD") : null,
    three_c: existsSync(join(deps, "cartwheel-engine", "deps", "three.c", ".git")) ? git(join(deps, "cartwheel-engine", "deps", "three.c"), "rev-parse", "HEAD") : null,
    wasmcart: existsSync(join(deps, "cartwheel-engine", "deps", "wasmcart", ".git")) ? git(join(deps, "cartwheel-engine", "deps", "wasmcart"), "rev-parse", "HEAD") : null,
    sdk_macos_arm64: sdk("macos-arm64"),
    sdk_cart: sdk("cart"),
    wasi_sdk_clang: some(e.TUPLE_WASI_CLANG),
    binaryen: some(e.TUPLE_BINARYEN),
  },
  pins: JSON.parse(e.TUPLE_PINS),
};
process.stdout.write(JSON.stringify(tuple, null, 2) + "\n");
' > "$OUT.tmp" && mv "$OUT.tmp" "$OUT" || { rm -f "$OUT.tmp"; echo "preflight: could not write $OUT" >&2; exit 1; }

echo "preflight: required tools present (clang, cmake, ninja, node)"
echo "preflight: docker: ${TUPLE_DOCKER_CLIENT:-unavailable}"
if [ -n "$TUPLE_ROMDEV_HEALTH" ]; then echo "preflight: romdev: $TUPLE_ROMDEV_HEALTH"; else echo "preflight: romdev: unavailable at $ROMDEV_URL"; fi
echo "preflight: wrote ${OUT#"$ROOT"/}"
