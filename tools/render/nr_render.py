# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Marcus R. Brown
"""Headless Blender render script of the nr sprite pipeline. The only code in the repository that imports bpy.

    Blender --background --factory-startup --python-exit-code 1 --python nr_render.py -- \
        --recipe recipe.json --out raw-dir

The recipe is validated by recipe.schema.json (tools/render/post.mjs does that before this runs) and checked again
here for the fields the script reads. For every slot frame the script poses the model, then renders two passes at
`cell * supersample` pixels from the recipe's camera:

  albedo  unlit base colour (every material is rebuilt as an emission of its colour); Standard view transform,
          exposure 0, gamma 1, transparent film
  normal  the shading normal in the sprite plane's basis: camera right (R), camera up (G), toward the camera (B),
          encoded v * 0.5 + 0.5, OpenGL convention (green up); data pass, Raw view transform

Cycles on the CPU, fixed seed, no denoise, no adaptive sampling, a near-zero-width box pixel filter: each pixel is
one point sample, so alpha is 0 or 1 and a frame depends on nothing but the recipe and the pinned Blender build.

Output layout under --out (written to <out>.partial, moved to <out>, then the sentinel is written):

  albedo/NNN.png  normal/NNN.png   one file per frame in slot order
  done.json                        the sentinel: recipe hash, Blender build, pivot, per-frame slot/clip and PNG payload hashes

Exit codes: 0 ok, 1 uncaught exception, 10 Cycles CPU device unavailable, 11 Blender version or build mismatch,
12 input error (recipe, arguments, existing output directory).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Vector

EXIT_OK = 0
EXIT_SCRIPT_ERROR = 1
EXIT_NO_DEVICE = 10
EXIT_VERSION = 11
EXIT_INPUT = 12
FIRST_LINE_MARKER = "RENDER start"
SENTINEL_NAME = "done.json"
SHAPES = ("sphere", "box", "cylinder", "cone", "plane")
FACING_YAW_DEG = {"south": 0.0, "east": 90.0, "north": 180.0, "west": -90.0}


class InputError(Exception):
    """A recipe field, argument or output location is missing or wrong. Exits with EXIT_INPUT."""


def log(tag: str, payload) -> None:
    print(f"RENDER {tag} {json.dumps(payload, sort_keys=True)}", flush=True)


def png_payload_sha256(path: Path) -> str:
    """sha256 over the data of a PNG's IHDR and IDAT chunks. Blender writes a Date text chunk, so the file hash changes
    from run to run while the image does not; post.mjs computes the same value."""
    data = path.read_bytes()
    h, off = hashlib.sha256(), 8
    while off < len(data):
        length = int.from_bytes(data[off : off + 4], "big")
        kind = data[off + 4 : off + 8]
        if kind in (b"IHDR", b"IDAT"):
            h.update(data[off + 8 : off + 8 + length])
        off += 12 + length
    return h.hexdigest()


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> tuple[float, float, float, float]:
    if not (isinstance(value, str) and len(value) == 7 and value[0] == "#"):
        raise InputError(f"colour {value!r} is not '#rrggbb'")
    try:
        r, g, b = (int(value[i : i + 2], 16) / 255.0 for i in (1, 3, 5))
    except ValueError as e:
        raise InputError(f"colour {value!r} is not '#rrggbb'") from e
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# --- recipe ------------------------------------------------------------------------------------------------------


def need(obj: dict, key: str, where: str):
    if not isinstance(obj, dict) or key not in obj:
        raise InputError(f"{where} has no {key!r}")
    return obj[key]


def read_recipe(path: Path) -> tuple[dict, str]:
    try:
        raw = path.read_bytes()
        recipe = json.loads(raw)
    except (OSError, ValueError) as e:
        raise InputError(f"cannot read the recipe {path}: {e}") from e
    for key in ("schemaVersion", "name", "blender", "cell", "supersample", "camera", "render", "model", "slots"):
        need(recipe, key, "the recipe")
    if recipe["schemaVersion"] != 1:
        raise InputError(f"unsupported recipe schema version {recipe['schemaVersion']!r}")
    for key in ("version", "buildHash"):
        need(recipe["blender"], key, "recipe.blender")
    for key in ("width", "height"):
        if not isinstance(need(recipe["cell"], key, "recipe.cell"), int) or recipe["cell"][key] < 1:
            raise InputError(f"recipe.cell.{key} must be a positive integer")
    if not isinstance(recipe["supersample"], int) or recipe["supersample"] < 1:
        raise InputError("recipe.supersample must be a positive integer")
    for key in ("projection", "elevationDeg", "azimuthDeg", "distance", "target", "pivotWorld"):
        need(recipe["camera"], key, "recipe.camera")
    if recipe["camera"]["projection"] == "orthographic":
        need(recipe["camera"], "orthoHeight", "recipe.camera")
    elif recipe["camera"]["projection"] == "perspective":
        need(recipe["camera"], "fovDeg", "recipe.camera")
    else:
        raise InputError(f"recipe.camera.projection {recipe['camera']['projection']!r} is not orthographic or perspective")
    for key in ("seed", "samples"):
        if not isinstance(need(recipe["render"], key, "recipe.render"), int):
            raise InputError(f"recipe.render.{key} must be an integer")
    parts = need(recipe["model"], "parts", "recipe.model")
    if not isinstance(parts, list) or not parts:
        raise InputError("recipe.model.parts must be a non-empty list")
    ids = set()
    for part in parts:
        pid = need(part, "id", "a model part")
        if pid in ids:
            raise InputError(f"model part id {pid!r} is repeated")
        ids.add(pid)
        if need(part, "shape", f"part {pid}") not in SHAPES:
            raise InputError(f"part {pid}: shape {part['shape']!r} is not one of {SHAPES}")
        hex_to_linear(need(part, "color", f"part {pid}"))
    slots = recipe["slots"]
    if not isinstance(slots, list) or not slots:
        raise InputError("recipe.slots must be a non-empty list")
    slot_ids = set()
    for slot in slots:
        sid = need(slot, "id", "a slot")
        if sid in slot_ids:
            raise InputError(f"slot id {sid!r} is repeated")
        slot_ids.add(sid)
        need(slot, "clip", f"slot {sid}")
        if not isinstance(need(slot, "frames", f"slot {sid}"), int) or slot["frames"] < 1:
            raise InputError(f"slot {sid}: frames must be a positive integer")
        if slot.get("facing", "south") not in FACING_YAW_DEG:
            raise InputError(f"slot {sid}: facing {slot['facing']!r} is not one of {tuple(FACING_YAW_DEG)}")
        for h in slot.get("hideFrames", []):
            if not (isinstance(h, int) and 0 <= h < slot["frames"]):
                raise InputError(f"slot {sid}: hideFrames entry {h!r} is outside 0..{slot['frames'] - 1}")
    return recipe, hashlib.sha256(raw).hexdigest()


def parse_args() -> tuple[Path, Path]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 4 or argv[0] != "--recipe" or argv[2] != "--out":
        raise InputError("usage: -- --recipe <recipe.json> --out <dir>")
    return Path(argv[1]), Path(argv[3])


def check_pin(recipe: dict) -> None:
    version = bpy.app.version_string.split()[0]
    build = bpy.app.build_hash.decode()
    want = recipe["blender"]
    if version != want["version"] or build != want["buildHash"]:
        print(
            f"RENDER version mismatch: expected {want['version']!r} build {want['buildHash']!r}, found {version!r} build {build!r}",
            flush=True,
        )
        sys.exit(EXIT_VERSION)


# --- scene -------------------------------------------------------------------------------------------------------


def configure_scene(recipe: dict):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    ss, cell, rr = recipe["supersample"], recipe["cell"], recipe["render"]
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    if cy.device != "CPU":
        print(f"RENDER no CPU device: scene.cycles.device is {cy.device!r}", flush=True)
        sys.exit(EXIT_NO_DEVICE)
    cy.samples = rr["samples"]
    cy.seed = rr["seed"]
    cy.use_animated_seed = False
    cy.use_denoising = False
    cy.use_adaptive_sampling = False
    cy.pixel_filter_type = "BOX"
    cy.filter_width = 0.01
    cy.film_exposure = 1.0
    cy.max_bounces = 0
    scene.render.film_transparent = True
    scene.render.resolution_x = cell["width"] * ss
    scene.render.resolution_y = cell["height"] * ss
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    scene.render.use_motion_blur = False
    scene.render.dither_intensity = 0.0
    img = scene.render.image_settings
    img.file_format = "PNG"
    img.color_mode = "RGBA"
    img.color_depth = "8"
    img.compression = 15
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    return scene


def make_camera(scene, cam_cfg: dict):
    data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    data.sensor_fit = "VERTICAL"
    clip = cam_cfg.get("clip", {})
    data.clip_start = clip.get("start", 0.1)
    data.clip_end = clip.get("end", 100.0)
    if cam_cfg["projection"] == "orthographic":
        data.type = "ORTHO"
        data.ortho_scale = cam_cfg["orthoHeight"]
    else:
        data.type = "PERSP"
        data.angle_y = math.radians(cam_cfg["fovDeg"])
    el, az, dist = math.radians(cam_cfg["elevationDeg"]), math.radians(cam_cfg["azimuthDeg"]), cam_cfg["distance"]
    target = Vector(cam_cfg["target"])
    cam.location = target + dist * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    return cam


def emission_material(name: str, color) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def normal_override_material(cam) -> bpy.types.Material:
    """Emits the world shading normal's components along the camera's right, up and toward-camera axes as v * 0.5 + 0.5.

    The axes are the camera object's world-matrix columns, baked into the nodes as constants (the camera never moves
    during a render), so the basis does not depend on Cycles' internal camera-space convention.
    """
    rot = cam.matrix_world.to_3x3()
    mat = bpy.data.materials.new("nr_normal")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    combine = nt.nodes.new("ShaderNodeCombineXYZ")
    for channel, axis in zip(("X", "Y", "Z"), (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))):
        dot = nt.nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        dot.inputs[1].default_value = tuple(rot @ axis)
        nt.links.new(geo.outputs["Normal"], dot.inputs[0])
        nt.links.new(dot.outputs["Value"], combine.inputs[channel])
    enc = nt.nodes.new("ShaderNodeVectorMath")
    enc.operation = "MULTIPLY_ADD"
    enc.inputs[1].default_value = (0.5, 0.5, 0.5)
    enc.inputs[2].default_value = (0.5, 0.5, 0.5)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(combine.outputs["Vector"], enc.inputs[0])
    nt.links.new(enc.outputs["Vector"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


class Rig:
    """The model: one object per recipe part under a yaw root, posed per slot frame."""

    def __init__(self, scene, parts: list[dict]):
        self.root = bpy.data.objects.new("root", None)
        scene.collection.objects.link(self.root)
        self.parts = []
        for part in parts:
            obj = self.build_part(part)
            scene.collection.objects.link(obj)
            obj.parent = self.root
            obj.data.materials.append(emission_material(f"albedo_{part['id']}", hex_to_linear(part["color"])))
            self.parts.append((part, obj))

    @staticmethod
    def build_part(part: dict) -> bpy.types.Object:
        shape, pid = part["shape"], part["id"]
        mesh = bpy.data.meshes.new(pid)
        bm = bmesh.new()
        if shape == "sphere":
            bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.5)
        elif shape == "box":
            bmesh.ops.create_cube(bm, size=1.0)
        elif shape == "cylinder":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.5, radius2=0.5, depth=1.0)
        elif shape == "cone":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.5, radius2=0.0, depth=1.0)
        else:
            bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        smooth = part.get("smooth", shape == "sphere")
        for poly in mesh.polygons:
            poly.use_smooth = bool(smooth)
        obj = bpy.data.objects.new(pid, mesh)
        obj.scale = Vector(part.get("size", [1.0, 1.0, 1.0]))
        return obj

    def pose(self, slot: dict, frame: int, hidden: bool) -> None:
        self.root.rotation_euler = Euler((0.0, 0.0, math.radians(FACING_YAW_DEG[slot.get("facing", "south")])), "XYZ")
        t = frame / slot["frames"]
        for part, obj in self.parts:
            loc = Vector(part.get("location", [0.0, 0.0, 0.0]))
            rot = Vector(part.get("rotationDeg", [0.0, 0.0, 0.0]))
            motion = part.get("motion", {}).get(slot["clip"])
            if motion:
                wave = math.sin(2.0 * math.pi * (motion.get("cycles", 1.0) * t + motion.get("phase", 0.0)))
                loc += Vector(motion.get("location", [0.0, 0.0, 0.0])) * wave
                rot += Vector(motion.get("rotationDeg", [0.0, 0.0, 0.0])) * wave
            obj.location = loc
            obj.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
            obj.hide_render = hidden


def render_pass(scene, path: Path, view_transform: str, override) -> None:
    scene.view_settings.view_transform = view_transform
    bpy.context.view_layer.material_override = override
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_all(recipe: dict, recipe_sha: str, out_dir: Path) -> dict:
    scene = configure_scene(recipe)
    cam = make_camera(scene, recipe["camera"])
    rig = Rig(scene, recipe["model"]["parts"])
    normal_mat = normal_override_material(cam)
    cell = recipe["cell"]
    pivot_view = world_to_camera_view(scene, cam, Vector(recipe["camera"]["pivotWorld"]))
    pivot = {"x": round(pivot_view.x * cell["width"], 4), "y": round((1.0 - pivot_view.y) * cell["height"], 4)}

    partial = out_dir.with_name(out_dir.name + ".partial")
    if partial.exists():
        shutil.rmtree(partial)
    for role in ("albedo", "normal"):
        (partial / role).mkdir(parents=True)

    frames, index, started = [], 0, time.perf_counter()
    for slot in recipe["slots"]:
        slot_started = time.perf_counter()
        for i in range(slot["frames"]):
            rig.pose(slot, i, i in slot.get("hideFrames", []))
            bpy.context.view_layer.update()
            name = f"{index:03d}.png"
            render_pass(scene, partial / "albedo" / name, "Standard", None)
            render_pass(scene, partial / "normal" / name, "Raw", normal_mat)
            frames.append({"index": index, "slot": slot["id"], "clip": slot["clip"], "clipFrame": i, "name": name})
            index += 1
        log("slot", {"slot": slot["id"], "frames": slot["frames"], "ms": round((time.perf_counter() - slot_started) * 1000.0, 1)})

    for f in frames:
        f["albedoSha256"] = png_payload_sha256(partial / "albedo" / f["name"])
        f["normalSha256"] = png_payload_sha256(partial / "normal" / f["name"])
    os.replace(partial, out_dir)  # the frames are in place; the sentinel below is the commit
    done = {
        "schemaVersion": 1,
        "recipeSha256": recipe_sha,
        "blender": {"version": bpy.app.version_string.split()[0], "buildHash": bpy.app.build_hash.decode()},
        "cell": cell,
        "supersample": recipe["supersample"],
        "pivot": pivot,
        "frames": frames,
        "renderMs": round((time.perf_counter() - started) * 1000.0, 1),
    }
    tmp = out_dir / (SENTINEL_NAME + ".tmp")
    tmp.write_text(json.dumps(done, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, out_dir / SENTINEL_NAME)
    return done


def main() -> int:
    log("start", {"version": bpy.app.version_string, "buildHash": bpy.app.build_hash.decode()})
    try:
        recipe_path, out_dir = parse_args()
        recipe, recipe_sha = read_recipe(recipe_path)
    except InputError as e:
        print(f"RENDER input error: {e}", flush=True)
        return EXIT_INPUT
    check_pin(recipe)
    if out_dir.exists():
        print(f"RENDER input error: output directory {out_dir} already exists", flush=True)
        return EXIT_INPUT
    try:
        done = render_all(recipe, recipe_sha, out_dir)
    except InputError as e:
        print(f"RENDER input error: {e}", flush=True)
        return EXIT_INPUT
    log("done", {"frames": len(done["frames"]), "wall_ms": done["renderMs"]})
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
