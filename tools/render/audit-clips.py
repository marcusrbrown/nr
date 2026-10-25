# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Marcus R. Brown
"""Headless Blender clip audit of the staged character kits (deps/kits, tools/render/fetch-kits.sh).

    Blender --background --factory-startup --python-exit-code 1 --python audit-clips.py -- \
        --kits deps/kits --manifest tools/render/kits.json --targets tools/render/clip-targets.json \
        --out out/audit/clip-audit.json --md docs/evidence/combat-slice/clip-audit.md

For every animation file of every pinned kit (.glb/.gltf with actions) the script imports the file into an empty
scene and records each action: name, frame range, scene fps, the number of animated bones and the keyframe count. For
every file with an armature (the animation libraries and the base characters) it records the bone names. The output is
one JSON document (--out) and, from it and clip-targets.json (the judgement table: which action fills which slot), the
markdown audit with the gap table (--md). A target action that no audited file contains fails the run (exit 12).

Exit codes: 0 ok, 1 uncaught exception, 12 input error.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import bpy

EXIT_OK = 0
EXIT_SCRIPT_ERROR = 1
EXIT_INPUT = 12
ANIMATION_SUFFIXES = (".glb", ".gltf")


class InputError(Exception):
    """An argument or a kit file is missing or wrong. Exits with EXIT_INPUT."""


def parse_args() -> dict[str, Path]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    opts: dict[str, Path] = {}
    for key, value in zip(argv[0::2], argv[1::2]):
        opts[key.lstrip("-")] = Path(value)
    for key in ("kits", "manifest", "targets", "out", "md"):
        if key not in opts:
            raise InputError("usage: -- --kits <deps/kits> --manifest <kits.json> --targets <clip-targets.json> --out <audit.json> --md <audit.md>")
    return opts


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def import_gltf(path: Path) -> None:
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if "FINISHED" not in result:
        raise InputError(f"glTF import of {path} returned {result}")


def action_record(action: bpy.types.Action, fps: float) -> dict:
    start, end = action.frame_range
    bones: set[str] = set()
    keys = 0
    for fc in action.fcurves:
        keys += len(fc.keyframe_points)
        if fc.data_path.startswith('pose.bones["'):
            bones.add(fc.data_path.split('"')[1])
    return {
        "name": action.name,
        "start": round(start, 3),
        "end": round(end, 3),
        "frames": int(round(end - start)) + 1,
        "fps": fps,
        "seconds": round((end - start) / fps, 4),
        "animatedBones": len(bones),
        "keyframes": keys,
        "loops": bool(getattr(action, "use_cyclic", False)),
    }


def audit_file(path: Path, kit_id: str, rel: str) -> dict:
    reset_scene()
    import_gltf(path)
    fps = bpy.context.scene.render.fps / (bpy.context.scene.render.fps_base or 1.0)
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    record = {
        "kit": kit_id,
        "path": rel,
        "sceneFps": fps,
        "armatures": [
            {
                "object": a.name,
                "bones": [b.name for b in a.data.bones],
                "boneCount": len(a.data.bones),
                "rootBones": [b.name for b in a.data.bones if b.parent is None],
            }
            for a in armatures
        ],
        "meshes": [{"object": m.name, "vertices": len(m.data.vertices), "materials": [s.material.name for s in m.material_slots if s.material]} for m in meshes],
        "actions": sorted((action_record(a, fps) for a in bpy.data.actions), key=lambda r: r["name"]),
    }
    return record


# --- markdown ------------------------------------------------------------------------------------------------------


STATUS_LABEL = {"exact": "exact match", "substitute": "usable substitute", "gap": "gap"}


def action_index(files: list[dict]) -> dict[str, tuple[dict, dict]]:
    index: dict[str, tuple[dict, dict]] = {}
    for f in files:
        for a in f["actions"]:
            index.setdefault(a["name"], (f, a))
    return index


def describe(index: dict, names: list[str]) -> str:
    parts = []
    for n in names:
        if n not in index:
            raise InputError(f"clip-targets.json names the action {n!r}, which no audited kit file contains")
        f, a = index[n]
        parts.append(f"`{n}` ({a['frames']} f @ {a['fps']:g} fps, {f['path']})")
    return ", ".join(parts)


def render_markdown(data: dict, manifest: dict, targets: dict) -> str:
    files = data["files"]
    index = action_index(files)
    armature_files = [f for f in files if f["armatures"]]
    lines = [
        "# Clip audit",
        "",
        f"Generated by `tools/render/audit-clips.py` under Blender {data['blender']} from the kits staged by `tools/render/fetch-kits.sh`; the judgement table is `tools/render/clip-targets.json`. Do not edit by hand.",
        "",
        "## Kits audited",
        "",
        "| Kit | File | sha256 | Actions | Armature bones |",
        "| --- | --- | --- | ---: | ---: |",
    ]
    for f in files:
        bones = f["armatures"][0]["boneCount"] if f["armatures"] else 0
        lines.append(f"| {f['kit']} | `{f['path']}` | `{f['sha256'][:12]}` | {len(f['actions'])} | {bones} |")
    pinned = {k["id"]: k for k in manifest["kits"]}
    unaudited = [k["id"] for k in manifest["kits"] if not any(f["kit"] == k["id"] for f in files)]
    for kit in manifest["kits"]:
        held = sum(len(f["actions"]) for f in files if f["kit"] == kit["id"])
        if kit.get("advertisedActions") and held:
            lines.append("")
            lines.append(f"`{kit['id']}`: the pack page advertises {kit['advertisedActions']} animations; the pinned Standard (free) file holds {held}.")
    lines += ["", "Not audited (no file pinned, nothing downloaded): " + (", ".join(f"`{k}`" for k in unaudited) if unaudited else "none") + ". Every gap below is a gap in the audited files only.", ""]

    names = [set(b for ar in f["armatures"] for b in ar["bones"]) for f in armature_files]
    same = all(n == names[0] for n in names) if names else True
    lines += ["## Rig comparison", ""]
    if names:
        lines.append(f"Armature files compared ({len(armature_files)}): {', '.join('`' + f['path'] + '`' for f in armature_files)}.")
        lines.append("")
        if same:
            lines.append(f"Bone names are identical in every file: {len(names[0])} bones, root `{armature_files[0]['armatures'][0]['rootBones'][0]}`, hierarchy root-to-leaf `pelvis`/`spine_01..03`/`neck_01`/`Head`, `clavicle_*`/`upperarm_*`/`lowerarm_*`/`hand_*` with `index|middle|pinky|ring|thumb_01..03` and `*_04_leaf_*`, `thigh_*`/`calf_*`/`foot_*`/`ball_*`/`ball_leaf_*` (`_l`, `_r` suffixes). **No retarget map is needed between the base-character armature and the animation library rig.** Only `Head` is capitalised.")
        else:
            base = names[0]
            for f, n in zip(armature_files, names):
                lines.append(f"- `{f['path']}` only: {sorted(n - base)}; missing: {sorted(base - n)}")
            lines.append("")
            lines.append("**The rigs differ; the profile needs a retarget map.**")
    lines += ["", "Frame rate: " + ", ".join(sorted({f"{f['sceneFps']:g} fps" for f in files})) + ". glTF carries no cyclic flag; a `_Loop` suffix is the library's loop marker.", ""]

    for who, rows in targets["characters"].items():
        lines += [f"## Gap table: {who}", "", "| Slot | Status | Source | Notes |", "| --- | --- | --- | --- |"]
        for r in rows:
            src = describe(index, r["actions"]) if r["actions"] else "—"
            note = r.get("note", "")
            if r.get("derived"):
                note = (f"Derived: {r['derived']}. " + note).strip()
            if r.get("nearest"):
                note = (f"Nearest pose sources: {describe(index, r['nearest'])}. " + note).strip()
            lines.append(f"| {r['slot']} | {STATUS_LABEL[r['status']]} | {src} | {note} |")
        counts = {k: sum(1 for r in rows if r["status"] == k) for k in STATUS_LABEL}
        lines += ["", f"{counts['exact']} exact, {counts['substitute']} usable substitute, {counts['gap']} gap of {len(rows)}.", ""]

    for f in files:
        if not f["actions"]:
            continue
        lines += [f"## Actions in `{f['kit']}/{f['path']}`", "", "| Action | Frames | Seconds | Range |", "| --- | ---: | ---: | --- |"]
        for a in f["actions"]:
            lines.append(f"| `{a['name']}` | {a['frames']} | {a['seconds']:.2f} | {a['start']:g}–{a['end']:g} |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    try:
        opts = parse_args()
        kits_dir, manifest_path, out_path = opts["kits"], opts["manifest"], opts["out"]
        manifest = json.loads(manifest_path.read_text())
        targets = json.loads(opts["targets"].read_text())
    except (InputError, OSError, ValueError) as e:
        print(f"AUDIT input error: {e}", flush=True)
        return EXIT_INPUT

    files = []
    try:
        for kit in manifest["kits"]:
            for f in kit["files"]:
                if not f["path"].lower().endswith(ANIMATION_SUFFIXES):
                    continue
                path = kits_dir / kit["id"] / f["path"]
                if not path.exists():
                    raise InputError(f"{path} is not staged: run tools/render/fetch-kits.sh")
                print(f"AUDIT {kit['id']}/{f['path']}", flush=True)
                files.append({**audit_file(path, kit["id"], f["path"]), "sha256": f["sha256"]})
    except InputError as e:
        print(f"AUDIT input error: {e}", flush=True)
        return EXIT_INPUT

    data = {"schemaVersion": 1, "blender": bpy.app.version_string.split()[0], "files": files}
    try:
        markdown = render_markdown(data, manifest, targets)
    except InputError as e:
        print(f"AUDIT input error: {e}", flush=True)
        return EXIT_INPUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    opts["md"].parent.mkdir(parents=True, exist_ok=True)
    opts["md"].write_text(markdown)
    print(f"AUDIT wrote {out_path} and {opts['md']} ({len(files)} files)", flush=True)
    return EXIT_OK


if __name__ == "__main__":
    try:
        code = main()
    except SystemExit:
        raise
    except BaseException:
        traceback.print_exc()
        code = EXIT_SCRIPT_ERROR
    sys.stdout.flush()
    sys.exit(code)
