# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Marcus R. Brown
"""Headless Blender render script of the nr sprite pipeline. The only code in the repository that imports bpy.

    Blender --background --factory-startup --python-exit-code 1 --python nr_render.py -- \
        --recipe recipe.json --out raw-dir [--kits deps/kits]

The recipe is validated by recipe.schema.json (tools/render/post.mjs does that before this runs) and checked again
here for the fields the script reads. Its model is one of two things:

  parts    primitives (the placeholder and the control recipes)
  profile  a character profile (tools/render/profiles/<id>.json, pinned by profileSha256): a base body, hair and the
           animation library from the CC0 kits under --kits (default deps/kits, staged by fetch-kits.sh). Every kit
           file is checked against the profile's sha256 and the kit manifest's licence allowlist before it is read. The
           body is coloured by region from the profile's palette, posed from the library's actions through the
           profile's clip map, fitted to its pixel height and anchored on the ground.

For every slot frame the script poses the model, then renders two passes at `cell * supersample` pixels from the
recipe's camera:

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

import fnmatch
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
import numpy as np
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
ALLOWED_LICENCES = ("CC0-1.0",)
SCRIPT_DIR = Path(__file__).resolve().parent


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
    model = recipe["model"]
    if ("parts" in model) == ("profile" in model):
        raise InputError("recipe.model must have exactly one of 'parts' or 'profile'")
    if "parts" in model:
        parts = model["parts"]
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
    else:
        need(model, "profileSha256", "recipe.model")
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


# --- profile and kit files -----------------------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_profile(recipe: dict, recipe_path: Path, kits_dir: Path) -> tuple[dict, str, list[dict]]:
    """Load the recipe's character profile, check its sha256 against the recipe, and verify every kit file it names:
    the kit's licence is on the allowlist, the file is the one the kit manifest pins, and the bytes on disk match."""
    model = recipe["model"]
    path = (recipe_path.parent / model["profile"]).resolve()
    try:
        raw = path.read_bytes()
        profile = json.loads(raw)
    except (OSError, ValueError) as e:
        raise InputError(f"cannot read the profile {path}: {e}") from e
    digest = hashlib.sha256(raw).hexdigest()
    if digest != model["profileSha256"]:
        raise InputError(f"profile {path.name} has sha256 {digest}, the recipe pins {model['profileSha256']}")
    for key in ("schemaVersion", "id", "kitFiles", "models", "body", "palette", "regions", "clips", "pose"):
        need(profile, key, "the profile")
    if profile["schemaVersion"] != 1:
        raise InputError(f"unsupported profile schema version {profile['schemaVersion']!r}")
    try:
        manifest = json.loads((SCRIPT_DIR / "kits.json").read_text())
    except (OSError, ValueError) as e:
        raise InputError(f"cannot read kits.json: {e}") from e
    kits = {k["id"]: k for k in manifest["kits"]}
    verified = []
    for ref in profile["kitFiles"]:
        kit = kits.get(ref["kit"])
        if kit is None:
            raise InputError(f"profile names kit {ref['kit']!r}, which kits.json does not list")
        if kit["licence"]["spdx"] not in ALLOWED_LICENCES:
            raise InputError(f"kit {kit['id']}: licence {kit['licence']['spdx']!r} is not on the allowlist {ALLOWED_LICENCES}")
        pinned = next((f for f in kit["files"] if f["path"] == ref["path"]), None)
        if pinned is None or pinned["sha256"] != ref["sha256"]:
            raise InputError(f"profile file {ref['kit']}/{ref['path']} is not the file kits.json pins")
        file = kits_dir / ref["kit"] / ref["path"]
        if not file.is_file():
            raise InputError(f"{file} is not staged: run tools/render/fetch-kits.sh")
        if sha256_file(file) != ref["sha256"]:
            raise InputError(f"{file} differs from its pinned sha256 {ref['sha256']}")
        verified.append({"kit": ref["kit"], "path": ref["path"], "sha256": ref["sha256"]})
    used = {(m["kit"], m["path"]) for m in [profile["models"]["body"], *profile["models"]["animations"], *profile["models"].get("hair", [])]}
    listed = {(r["kit"], r["path"]) for r in profile["kitFiles"]}
    if not used <= listed:
        raise InputError(f"profile models use kit files that kitFiles does not list: {sorted(used - listed)}")
    for slot in recipe["slots"]:
        if slot["clip"] not in profile["clips"]:
            raise InputError(f"slot {slot['id']}: the profile has no clip {slot['clip']!r}")
        if not profile["clips"][slot["clip"]].get("ready"):
            raise InputError(f"slot {slot['id']}: clip {slot['clip']!r} is not ready (a gap awaiting a hand-keyed action)")
    return profile, digest, verified


def parse_args() -> tuple[Path, Path, Path]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    pairs = dict(zip(argv[0::2], argv[1::2]))
    if len(argv) % 2 or not set(pairs) <= {"--recipe", "--out", "--kits"} or "--recipe" not in pairs or "--out" not in pairs:
        raise InputError("usage: -- --recipe <recipe.json> --out <dir> [--kits <deps/kits>]")
    kits = Path(pairs["--kits"]) if "--kits" in pairs else SCRIPT_DIR.parent.parent / "deps" / "kits"
    return Path(pairs["--recipe"]), Path(pairs["--out"]), kits


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


def import_gltf(path: Path) -> list:
    """Import a glTF/GLB and return the objects it created. Textures were never staged; nothing renders from an image."""
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except RuntimeError as e:
        raise InputError(f"glTF import failed for {path.name}: {e}") from e
    for image in list(bpy.data.images):
        bpy.data.images.remove(image)
    return [o for o in bpy.data.objects if o not in before]


class KitFigure:
    """A kit character: the base-character body and hair skinned to its armature, posed from the animation library's
    actions through the profile's clip map. The meshes are coloured per face by the bone that dominates their vertices
    (the profile's regions), so the unlit albedo is flat colour fields; the lights supply the form at run time."""

    def __init__(self, scene, cam, recipe: dict, profile: dict, kits_dir: Path):
        self.scene, self.cam, self.profile = scene, cam, profile
        self.cell = recipe["cell"]
        override = recipe["model"].get("paletteOverride", {})
        unknown = sorted(set(override) - set(profile["palette"]))
        if unknown:
            raise InputError(f"recipe.model.paletteOverride names colours the profile's palette does not have: {unknown}")
        self.palette = {**profile["palette"], **override}
        self.root = bpy.data.objects.new("figure", None)
        scene.collection.objects.link(self.root)
        models = profile["models"]

        def kit_path(ref: dict) -> Path:
            return kits_dir / ref["kit"] / ref["path"]

        for ref in models["animations"]:  # only the actions are wanted; an action name is unique across the files
            for o in import_gltf(kit_path(ref)):
                bpy.data.objects.remove(o, do_unlink=True)
        objs = import_gltf(kit_path(models["body"]))
        self.arm = next((o for o in objs if o.type == "ARMATURE"), None)
        if self.arm is None:
            raise InputError("the body model has no armature")
        meshes = {o.name: o for o in objs if o.type == "MESH"}
        body_cfg = models["body"]
        if body_cfg["mesh"] not in meshes:
            raise InputError(f"the body model has no mesh {body_cfg['mesh']!r} (it has {sorted(meshes)})")
        self.body = meshes[body_cfg["mesh"]]
        extras = {n: meshes[n] for n in body_cfg.get("extras", {}) if n in meshes}
        for name, o in meshes.items():
            if o is not self.body and name not in extras:
                bpy.data.objects.remove(o, do_unlink=True)
        self.meshes = [self.body, *extras.values()]
        self.paint(self.body, profile["regions"])
        for name, o in extras.items():
            self.paint_flat(o, body_cfg["extras"][name])
        for hair in models.get("hair", []):
            self.meshes.append(self.add_hair(kit_path(hair), hair))
        for att in profile.get("attachments", []):
            self.meshes.append(self.add_attachment(att))

        ad = self.arm.animation_data or self.arm.animation_data_create()
        for track in list(ad.nla_tracks):
            ad.nla_tracks.remove(track)
        for o in [self.arm, *self.meshes]:
            self.adopt(o)
        self.arm.rotation_mode = "XYZ"
        self.fit()

    # -- construction --

    def adopt(self, obj) -> None:
        bpy.context.view_layer.update()  # matrix_world of a freshly built object is stale until then
        world = obj.matrix_world.copy()
        obj.parent = self.root
        obj.matrix_world = world

    def colour(self, key: str):
        return hex_to_linear(self.palette.get(key, key))

    def region_of(self, bone: str, height: float, regions: list[dict]) -> int:
        """First region whose bone patterns match the dominant bone and whose heightRange (fractions of the body's rest
        height, 0 at the soles, 1 at the crown) holds the vertex."""
        for index, region in enumerate(regions):
            lo, hi = region.get("heightRange", (0.0, 1.0))
            if lo <= height <= hi and any(fnmatch.fnmatchcase(bone, pat) for pat in region["bones"]):
                return index
        return len(regions)

    def paint(self, obj, regions: list[dict]) -> None:
        """One emission material per region; each face takes the region most of its vertices' dominant bones fall in."""
        group_names = {g.index: g.name for g in obj.vertex_groups}
        zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
        z0, z1 = min(zs), max(zs)
        vertex_region = []
        for v, z in zip(obj.data.vertices, zs):
            bone = group_names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "root"
            vertex_region.append(self.region_of(bone, (z - z0) / (z1 - z0), regions))
        obj.data.materials.clear()
        for region in regions:
            obj.data.materials.append(emission_material(f"albedo_{region['name']}", self.colour(region["color"])))
        obj.data.materials.append(emission_material("albedo_default", self.colour(self.profile.get("defaultColor", "default"))))
        for poly in obj.data.polygons:
            votes: dict[int, int] = {}
            for vi in poly.vertices:
                votes[vertex_region[vi]] = votes.get(vertex_region[vi], 0) + 1
            poly.material_index = max(votes, key=lambda k: (votes[k], -k))

    def paint_flat(self, obj, colour_key: str) -> None:
        obj.data.materials.clear()
        obj.data.materials.append(emission_material(f"albedo_{obj.name}", self.colour(colour_key)))
        for poly in obj.data.polygons:
            poly.material_index = 0

    def add_hair(self, path: Path, cfg: dict):
        objs = import_gltf(path)
        mesh = next((o for o in objs if o.type == "MESH" and o.name == cfg["mesh"]), None)
        if mesh is None:
            raise InputError(f"{path.name} has no mesh {cfg['mesh']!r}")
        for mod in mesh.modifiers:
            if mod.type == "ARMATURE":
                mod.object = self.arm  # the same bone names: it follows the body's pose
        for o in objs:
            if o is not mesh:
                bpy.data.objects.remove(o, do_unlink=True)
        mesh.parent = None
        self.paint_flat(mesh, cfg["color"])
        return mesh

    def add_attachment(self, att: dict):
        """A primitive skinned rigidly to one bone, placed at the bone's rest head plus an offset in armature space."""
        part = {"id": att["id"], "shape": att["shape"], "size": att.get("size", [1.0, 1.0, 1.0])}
        obj = Rig.build_part(part)
        bpy.context.scene.collection.objects.link(obj)
        bone = self.arm.data.bones.get(att["bone"])
        if bone is None:
            raise InputError(f"attachment {att['id']}: the rig has no bone {att['bone']!r}")
        loc = self.arm.matrix_world @ (bone.head_local + Vector(att.get("offset", [0.0, 0.0, 0.0])))
        obj.location = loc
        obj.rotation_euler = Euler([math.radians(a) for a in att.get("rotationDeg", [0.0, 0.0, 0.0])], "XYZ")
        obj.data.materials.append(emission_material(f"albedo_{att['id']}", self.colour(att["color"])))
        group = obj.vertex_groups.new(name=att["bone"])
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = self.arm
        return obj

    # -- posing --

    def clip(self, name: str) -> dict:
        return self.profile["clips"][name]

    def sample(self, clip: dict, i: int, n: int) -> tuple[str, float]:
        """Action name and (fractional) frame for sample i of n over the clip's segments, in order. A looping clip
        omits its end so the last sample is one step before the first."""
        segs = clip["segments"]
        lengths = [abs(sg["end"] - sg["start"]) for sg in segs]
        total = sum(lengths) or 1.0
        t = total * (i / n if clip.get("loop") else i / max(n - 1, 1))
        acc = 0.0
        for sg, length in zip(segs, lengths):
            if t <= acc + length + 1e-9 or sg is segs[-1]:
                local = min(max(t - acc, 0.0), length)
                return sg["action"], (sg["start"] + local if sg["end"] >= sg["start"] else sg["start"] - local)
            acc += length
        raise AssertionError("unreachable")

    def set_time(self, action_name: str, frame: float) -> None:
        action = bpy.data.actions.get(action_name)
        if action is None:
            raise InputError(f"the animation library has no action {action_name!r}")
        ad = self.arm.animation_data or self.arm.animation_data_create()
        ad.action = action
        if hasattr(ad, "action_slot") and getattr(action, "slots", None):
            ad.action_slot = action.slots[0]
        whole = math.floor(frame)
        self.scene.frame_set(whole, subframe=frame - whole)

    def adjust(self) -> None:
        """Applied after the animation is evaluated for a frame: the root's travel is removed (the simulation moves
        the actor) and the profile's head and hand scales are set."""
        body = self.profile["body"]
        pol = self.profile["pose"]
        if pol.get("pinRoot", True):
            self.arm.pose.bones["root"].location = (0.0, 0.0, 0.0)
        for names, key in ((("Head",), "headScale"), (("hand_l", "hand_r"), "handScale")):
            f = body.get(key, 1.0)
            for n in names:
                self.arm.pose.bones[n].scale = (f, f, f)
        bpy.context.view_layer.update()

    def points(self) -> np.ndarray:
        deps = bpy.context.evaluated_depsgraph_get()
        out = []
        for obj in self.meshes:
            ev = obj.evaluated_get(deps)
            mesh = ev.to_mesh()
            try:
                co = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
                mesh.vertices.foreach_get("co", co)
            finally:
                ev.to_mesh_clear()
            m = np.array(ev.matrix_world, dtype=np.float64)
            out.append(co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])
        return np.vstack(out)

    def projected_px(self) -> tuple[float, float]:
        ys = [world_to_camera_view(self.scene, self.cam, Vector(p)).y for p in self.points()]
        return (min(ys) * self.cell["height"], max(ys) * self.cell["height"])

    def anchor_world(self, anchor: str) -> Vector:
        """The world point that stays at (0, 0): the pelvis, or the midpoint of the two feet."""
        arm_eval = self.arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        names = ("pelvis",) if anchor == "pelvis-xy" else ("foot_l", "foot_r")
        pts = [arm_eval.matrix_world @ arm_eval.pose.bones[n].head for n in names]
        return sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)

    def place(self, yaw_deg: float) -> None:
        """Turn the figure about the vertical axis through the profile's anchor, which stays at world (0, 0)."""
        self.root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
        self.root.location = (0.0, 0.0, self.base_z)
        bpy.context.view_layer.update()
        anchor = self.profile["pose"].get("anchor", "feet-xy")
        if anchor != "none":
            p = self.anchor_world(anchor)
            self.root.location = (-p.x + self.root.location.x, -p.y + self.root.location.y, self.base_z)
            bpy.context.view_layer.update()

    def first_pose(self) -> None:
        first = self.profile["pose"]["fitClip"]
        action, frame = self.sample(self.clip(first), 0, 1)
        self.set_time(action, frame)
        self.adjust()

    def fit(self) -> None:
        """Scale the figure so the standing pose is standingHeightPx tall in the render camera, then put its lowest
        point on the ground; both measured on the first frame of pose.fitClip with the figure facing the camera."""
        body = self.profile["body"]
        prop = Vector((body.get("widthScale", 1.0), body.get("depthScale", 1.0), 1.0))
        self.base_z = 0.0
        self.root.scale = prop
        self.first_pose()
        self.place(0.0)
        for _ in range(3):
            lo, hi = self.projected_px()
            k = body["standingHeightPx"] / (hi - lo)
            self.root.scale = Vector([c * k for c in self.root.scale])
            self.place(0.0)
        zs = self.points()[:, 2]
        self.base_z = -float(zs.min())
        self.place(0.0)
        lo, hi = self.projected_px()
        self.facts = {"scale": [round(c, 5) for c in self.root.scale], "baseZ": round(self.base_z, 5), "heightPx": round(hi - lo, 3)}

    def pose(self, slot: dict, frame: int, hidden: bool) -> None:
        clip = self.clip(slot["clip"])
        action, f = self.sample(clip, frame, slot["frames"])
        self.set_time(action, f)
        self.adjust()
        self.place(FACING_YAW_DEG[slot.get("facing", "south")])
        for obj in self.meshes:
            obj.hide_render = hidden


def render_pass(scene, path: Path, view_transform: str, override) -> None:
    scene.view_settings.view_transform = view_transform
    bpy.context.view_layer.material_override = override
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_all(recipe: dict, recipe_sha: str, out_dir: Path, profile=None, profile_sha=None, kit_files=None, kits_dir=None) -> dict:
    scene = configure_scene(recipe)
    cam = make_camera(scene, recipe["camera"])
    rig = KitFigure(scene, cam, recipe, profile, kits_dir) if profile else Rig(scene, recipe["model"]["parts"])
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
    if profile:
        done["profile"] = {"id": profile["id"], "sha256": profile_sha, "kitFiles": kit_files, "figure": rig.facts}
    tmp = out_dir / (SENTINEL_NAME + ".tmp")
    tmp.write_text(json.dumps(done, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, out_dir / SENTINEL_NAME)
    return done


def main() -> int:
    log("start", {"version": bpy.app.version_string, "buildHash": bpy.app.build_hash.decode()})
    try:
        recipe_path, out_dir, kits_dir = parse_args()
        recipe, recipe_sha = read_recipe(recipe_path)
        profile = profile_sha = kit_files = None
        if "profile" in recipe["model"]:
            profile, profile_sha, kit_files = read_profile(recipe, recipe_path, kits_dir)
    except InputError as e:
        print(f"RENDER input error: {e}", flush=True)
        return EXIT_INPUT
    check_pin(recipe)
    if out_dir.exists():
        print(f"RENDER input error: output directory {out_dir} already exists", flush=True)
        return EXIT_INPUT
    try:
        done = render_all(recipe, recipe_sha, out_dir, profile, profile_sha, kit_files, kits_dir)
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
