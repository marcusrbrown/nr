/* anim: atlas manifest loader, per-frame plane geometries and clip playback. See anim.h. */
#include "anim.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/core.h"
#include "cartwheel/platform.h"
#include "json.h"

/* ── textures and the material ─────────────────────────────────────────────────────────────────────────────────── */

static t3_texture *load_sheet(const char *path, t3_color_space space) {
  size_t len = 0;
  void *bytes = cw_asset_load(path, &len);
  if (!bytes) {
    cw_error("anim: %s is missing", path);
    return NULL;
  }
  t3_texture *t = t3_texture_load_memory(bytes, len);
  free(bytes);
  if (!t) {
    cw_error("anim: %s did not decode", path);
    return NULL;
  }
  t->mag_filter = t->min_filter = T3_NEAREST;
  t->generate_mipmaps = false;
  t->color_space = space;
  return t;
}

static t3_texture *flat_normal_texture(int w, int h) {
  uint8_t *px = malloc((size_t)w * (size_t)h * 4);
  for (int i = 0; i < w * h; i++) {
    px[i * 4 + 0] = 128;
    px[i * 4 + 1] = 128;
    px[i * 4 + 2] = 255;
    px[i * 4 + 3] = 255;
  }
  t3_texture *t = t3_texture_new(w, h, px);
  free(px);
  t->mag_filter = t->min_filter = T3_NEAREST;
  t->generate_mipmaps = false;
  t->color_space = T3_NO_COLOR_SPACE;
  return t;
}

/* ── load ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

static bool fail(nr_json *root, nr_atlas *a, const char *why) {
  cw_error("anim: %s", why);
  nr_json_free(root);
  free(a->geom);
  free(a->geom_flip);
  a->geom = NULL;
  a->geom_flip = NULL;
  return false;
}

bool nr_atlas_load(nr_atlas *a, const char *name, float pixels_per_unit, bool flat_normals) {
  memset(a, 0, sizeof *a);
  char path[96];
  snprintf(path, sizeof path, "atlases/%s.json", name);
  nr_json *root = nr_json_load(path, "anim");
  if (!root) return false;

  const nr_json *cell = nr_json_get(root, "cell"), *pages = nr_json_get(root, "pages"), *frames = nr_json_get(root, "frames"), *clips = nr_json_get(root, "clips");
  if (!cell || !pages || !frames || !clips) return fail(root, a, "the manifest has no cell, pages, frames or clips");
  if (pages->count != 1) return fail(root, a, "the manifest has more than one page: this loader reads one sheet pair per character");
  a->cell_w = (int)nr_json_num(nr_json_get(cell, "width"), 0);
  a->cell_h = (int)nr_json_num(nr_json_get(cell, "height"), 0);
  int page_w = (int)nr_json_num(nr_json_get(pages->kid[0], "width"), 0), page_h = (int)nr_json_num(nr_json_get(pages->kid[0], "height"), 0);
  if (a->cell_w <= 0 || a->cell_h <= 0 || page_w <= 0 || page_h <= 0) return fail(root, a, "the manifest has no sizes");
  if (frames->count < 1) return fail(root, a, "the manifest has no frames");
  a->frame_count = frames->count;
  a->width = (float)a->cell_w / pixels_per_unit;
  a->height = (float)a->cell_h / pixels_per_unit;
  const nr_json *pivot0 = nr_json_get(frames->kid[0], "pivot");
  a->pivot_x = (float)nr_json_num(nr_json_get(pivot0, "x"), a->cell_w * 0.5);
  a->pivot_y = (float)nr_json_num(nr_json_get(pivot0, "y"), a->cell_h);

  if (clips->count > NR_MAX_CLIPS) return fail(root, a, "the manifest has more clips than NR_MAX_CLIPS");
  for (int i = 0; i < clips->count; i++) {
    const nr_json *c = clips->kid[i];
    const char *n = nr_json_str(nr_json_get(c, "name"));
    if (!n) return fail(root, a, "a clip has no name");
    nr_clip *o = &a->clips[a->clip_count++];
    snprintf(o->name, sizeof o->name, "%s", n);
    o->first = (int)nr_json_num(nr_json_get(c, "first"), 0);
    o->count = (int)nr_json_num(nr_json_get(c, "count"), 0);
    o->ms = (int)nr_json_num(nr_json_get(c, "ms"), 100);
    o->loop = nr_json_bool(nr_json_get(c, "loop"));
    if (o->count < 1 || o->first < 0 || o->first + o->count > a->frame_count || o->ms < 1) return fail(root, a, "a clip's frame range or duration is invalid");
  }

  char colour[96], normal[96];
  const char *colour_file = nr_json_str(nr_json_get(nr_json_get(pages->kid[0], "colour"), "file"));
  const char *normal_file = nr_json_str(nr_json_get(nr_json_get(pages->kid[0], "normal"), "file"));
  snprintf(colour, sizeof colour, "atlases/%s", colour_file ? colour_file : "");
  snprintf(normal, sizeof normal, "atlases/%s", normal_file ? normal_file : "");
  t3_texture *albedo = load_sheet(colour, T3_SRGB_COLOR_SPACE);
  t3_texture *nrm = flat_normals ? (albedo ? flat_normal_texture(albedo->width, albedo->height) : NULL) : load_sheet(normal, T3_NO_COLOR_SPACE);
  if (!albedo || !nrm) return fail(root, a, "a sheet could not be loaded");
  if (albedo->width != page_w || albedo->height != page_h || nrm->width != page_w || nrm->height != page_h) return fail(root, a, "a sheet's size differs from the manifest's page");

  a->material = t3_mesh_standard_material_new(0xffffff);
  a->material->metalness = 0.0f;
  a->material->roughness = 1.0f;
  t3_material_set_map(a->material, albedo);
  t3_material_set_texture(a->material, T3_NORMAL_MAP, nrm);
  a->material->normal_scale = (t3_vec2){ 1.0f, 1.0f };
  a->material->alpha_test = 0.5f;

  a->geom = calloc((size_t)a->frame_count, sizeof *a->geom);
  a->geom_flip = calloc((size_t)a->frame_count, sizeof *a->geom_flip);
  for (int i = 0; i < a->frame_count; i++) {
    const nr_json *f = frames->kid[i];
    const nr_json *r = nr_json_get(f, "rect");
    if (!r || (int)nr_json_num(nr_json_get(f, "page"), -1) != 0) return fail(root, a, "a frame has no rect or is not on page 0");
    float x = (float)nr_json_num(nr_json_get(r, "x"), 0), y = (float)nr_json_num(nr_json_get(r, "y"), 0), w = (float)nr_json_num(nr_json_get(r, "w"), 0), h = (float)nr_json_num(nr_json_get(r, "h"), 0);
    if (w != (float)a->cell_w || h != (float)a->cell_h || x < 0 || y < 0 || x + w > (float)page_w || y + h > (float)page_h) return fail(root, a, "a frame's rect is not a cell inside its page");
    t3_geometry *g = t3_plane_geometry_new(a->width, a->height, 1, 1);
    /* vertices: top-left, top-right, bottom-left, bottom-right; v runs up the texture */
    float u0 = x / (float)page_w, u1 = (x + w) / (float)page_w;
    float v0 = 1.0f - y / (float)page_h, v1 = 1.0f - (y + h) / (float)page_h;
    float *uv = t3_attribute_f32(g->attributes[T3_ATTR_UV]);
    uv[0] = u0; uv[1] = v0;
    uv[2] = u1; uv[3] = v0;
    uv[4] = u0; uv[5] = v1;
    uv[6] = u1; uv[7] = v1;
    a->geom[i] = g;
    t3_geometry *m = t3_plane_geometry_new(a->width, a->height, 1, 1);
    float *muv = t3_attribute_f32(m->attributes[T3_ATTR_UV]);
    muv[0] = u1; muv[1] = v0;
    muv[2] = u0; muv[3] = v0;
    muv[4] = u1; muv[5] = v1;
    muv[6] = u0; muv[7] = v1;
    a->geom_flip[i] = m;
  }
  nr_json_free(root);
  return true;
}

t3_geometry *nr_atlas_geometry(const nr_atlas *a, int frame, bool flip) { return flip ? a->geom_flip[frame] : a->geom[frame]; }

int nr_clip_index(const nr_atlas *a, const char *name) {
  for (int i = 0; i < a->clip_count; i++)
    if (!strcmp(a->clips[i].name, name)) return i;
  return -1;
}

const nr_clip_slot nr_hero_clips[NR_HERO_CLIP_COUNT] = {
  [NR_HERO_IDLE] = { "idle", false },
  [NR_HERO_WALK] = { "walk", false },
  [NR_HERO_RUN] = { "run", false },
  [NR_HERO_HIT1] = { "hit1", false },
  [NR_HERO_HIT2] = { "hit2", false },
  [NR_HERO_HIT3] = { "hit3", false },
  [NR_HERO_JUMP] = { "jump", false },
  [NR_HERO_JUMPKICK] = { "jumpkick", true },
  [NR_HERO_GRAB] = { "grab", true },
  [NR_HERO_THROW] = { "throw", false },
  [NR_HERO_HURT] = { "hurt", false },
  [NR_HERO_KNOCKDOWN] = { "knockdown", false },
  [NR_HERO_GETUP] = { "getup", false },
  [NR_HERO_DASH] = { "dash", false },
  [NR_HERO_SPECIAL_KNOCKBACK] = { "special_knockback", false },
  [NR_HERO_SPECIAL_DASH] = { "special_dash", false },
};

const nr_clip_slot nr_grunt_clips[NR_GRUNT_CLIP_COUNT] = {
  [NR_GRUNT_IDLE] = { "idle", false },
  [NR_GRUNT_WALK] = { "walk", false },
  [NR_GRUNT_ATTACK] = { "attack", false },
  [NR_GRUNT_HURT] = { "hurt", false },
  [NR_GRUNT_KNOCKDOWN] = { "knockdown", false },
  [NR_GRUNT_GETUP] = { "getup", false },
};

const nr_clip_slot nr_heavy_clips[NR_HEAVY_CLIP_COUNT] = {
  [NR_HEAVY_IDLE] = { "idle", false },
  [NR_HEAVY_WALK] = { "walk", false },
  [NR_HEAVY_ATTACK] = { "attack", false },
  [NR_HEAVY_HURT] = { "hurt", false },
  [NR_HEAVY_STAGGER] = { "stagger", false },
};

bool nr_clips_resolve(const nr_atlas *a, const nr_clip_slot *table, int count, int *index_out) {
  bool ok = true;
  for (int i = 0; i < count; i++) {
    int at = nr_clip_index(a, table[i].name);
    if (table[i].gap) {
      if (at >= 0) {
        cw_error("anim: clip %s is a gap slot but the atlas holds it", table[i].name);
        ok = false;
      }
      index_out[i] = -1;
    } else {
      if (at < 0) {
        cw_error("anim: clip %s is not in the atlas", table[i].name);
        ok = false;
      }
      index_out[i] = at;
    }
  }
  return ok;
}

int nr_clip_step_at(const nr_atlas *a, int clip, int32_t ticks) {
  const nr_clip *c = &a->clips[clip];
  if (ticks < 0) ticks = 0;
  int64_t step = ((int64_t)ticks * 1000) / ((int64_t)c->ms * 60);
  if (c->loop) return (int)(step % c->count);
  return step >= c->count ? c->count - 1 : (int)step;
}

int nr_clip_frame_at(const nr_atlas *a, int clip, int32_t ticks) { return a->clips[clip].first + nr_clip_step_at(a, clip, ticks); }
