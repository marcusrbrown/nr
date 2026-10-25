/* anim: atlas manifest loader, per-frame plane geometries and clip playback. See anim.h. */
#include "anim.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/core.h"
#include "cartwheel/platform.h"

/* ── a small JSON reader: the manifest is written by tools/render/post.mjs ────────────────────────────────────── */

typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ } jtype;
typedef struct jv {
  jtype t;
  double n;
  char *s;
  struct jv **kid; /* array items, or object values */
  char **key;      /* object keys */
  int count;
} jv;

typedef struct { const char *p, *end; bool bad; } jcur;

static void jfree(jv *v) {
  if (!v) return;
  for (int i = 0; i < v->count; i++) {
    jfree(v->kid[i]);
    if (v->key) free(v->key[i]);
  }
  free(v->kid);
  free(v->key);
  free(v->s);
  free(v);
}

static void jskip(jcur *c) {
  while (c->p < c->end && isspace((unsigned char)*c->p)) c->p++;
}

static char *jstring(jcur *c) {
  if (c->p >= c->end || *c->p != '"') { c->bad = true; return NULL; }
  c->p++;
  size_t cap = 16, len = 0;
  char *out = malloc(cap);
  while (c->p < c->end && *c->p != '"') {
    char ch = *c->p++;
    if (ch == '\\' && c->p < c->end) {
      char e = *c->p++;
      ch = e == 'n' ? '\n' : e == 't' ? '\t' : e == 'r' ? '\r' : e; /* \uXXXX does not occur in the manifest */
    }
    if (len + 1 >= cap) out = realloc(out, cap *= 2);
    out[len++] = ch;
  }
  if (c->p >= c->end) { c->bad = true; free(out); return NULL; }
  c->p++;
  out[len] = 0;
  return out;
}

static jv *jparse(jcur *c) {
  jskip(c);
  if (c->p >= c->end) { c->bad = true; return NULL; }
  jv *v = calloc(1, sizeof *v);
  char ch = *c->p;
  if (ch == '{' || ch == '[') {
    bool obj = ch == '{';
    v->t = obj ? J_OBJ : J_ARR;
    c->p++;
    jskip(c);
    int cap = 0;
    if (c->p < c->end && *c->p == (obj ? '}' : ']')) { c->p++; return v; }
    for (;;) {
      if (v->count == cap) {
        cap = cap ? cap * 2 : 8;
        v->kid = realloc(v->kid, (size_t)cap * sizeof *v->kid);
        if (obj) v->key = realloc(v->key, (size_t)cap * sizeof *v->key);
      }
      char *key = NULL;
      if (obj) {
        jskip(c);
        key = jstring(c);
        jskip(c);
        if (c->bad || c->p >= c->end || *c->p != ':') { free(key); c->bad = true; break; }
        c->p++;
      }
      jv *item = jparse(c);
      if (!item) { free(key); break; }
      if (obj) v->key[v->count] = key;
      v->kid[v->count++] = item;
      jskip(c);
      if (c->p < c->end && *c->p == ',') { c->p++; continue; }
      if (c->p < c->end && *c->p == (obj ? '}' : ']')) { c->p++; return v; }
      c->bad = true;
      break;
    }
    jfree(v);
    return NULL;
  }
  if (ch == '"') {
    v->t = J_STR;
    v->s = jstring(c);
    if (!v->s) { free(v); return NULL; }
    return v;
  }
  if (!strncmp(c->p, "true", 4) || !strncmp(c->p, "false", 5)) {
    v->t = J_BOOL;
    v->n = c->p[0] == 't';
    c->p += v->n ? 4 : 5;
    return v;
  }
  if (!strncmp(c->p, "null", 4)) { c->p += 4; return v; }
  char *e;
  v->t = J_NUM;
  v->n = strtod(c->p, &e);
  if (e == c->p) { c->bad = true; free(v); return NULL; }
  c->p = e;
  return v;
}

static const jv *jget(const jv *o, const char *key) {
  if (!o || o->t != J_OBJ) return NULL;
  for (int i = 0; i < o->count; i++)
    if (!strcmp(o->key[i], key)) return o->kid[i];
  return NULL;
}
static const jv *jat(const jv *a, int i) { return a && a->t == J_ARR && i >= 0 && i < a->count ? a->kid[i] : NULL; }
static double jnum(const jv *v, double d) { return v && v->t == J_NUM ? v->n : d; }
static const char *jstr(const jv *v) { return v && v->t == J_STR ? v->s : NULL; }

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

static bool fail(jv *root, nr_atlas *a, const char *why) {
  cw_error("anim: %s", why);
  jfree(root);
  free(a->geom);
  a->geom = NULL;
  return false;
}

bool nr_atlas_load(nr_atlas *a, const char *name, float pixels_per_unit, bool flat_normals) {
  memset(a, 0, sizeof *a);
  char path[96];
  snprintf(path, sizeof path, "atlases/%s.json", name);
  size_t len = 0;
  char *text = cw_asset_load(path, &len);
  if (!text) {
    cw_error("anim: %s is missing", path);
    return false;
  }
  jcur cur = { text, text + len, false };
  jv *root = jparse(&cur);
  free(text);
  if (!root || cur.bad || root->t != J_OBJ) return fail(root, a, "the manifest is not valid JSON");

  const jv *cell = jget(root, "cell"), *pages = jget(root, "pages"), *frames = jget(root, "frames"), *clips = jget(root, "clips");
  if (!cell || !pages || !frames || !clips) return fail(root, a, "the manifest has no cell, pages, frames or clips");
  if (pages->count != 1) return fail(root, a, "the manifest has more than one page: this loader reads one sheet pair per character");
  a->cell_w = (int)jnum(jget(cell, "width"), 0);
  a->cell_h = (int)jnum(jget(cell, "height"), 0);
  int page_w = (int)jnum(jget(pages->kid[0], "width"), 0), page_h = (int)jnum(jget(pages->kid[0], "height"), 0);
  if (a->cell_w <= 0 || a->cell_h <= 0 || page_w <= 0 || page_h <= 0) return fail(root, a, "the manifest has no sizes");
  if (frames->count < 1) return fail(root, a, "the manifest has no frames");
  a->frame_count = frames->count;
  a->width = (float)a->cell_w / pixels_per_unit;
  a->height = (float)a->cell_h / pixels_per_unit;
  const jv *pivot0 = jget(frames->kid[0], "pivot");
  a->pivot_x = (float)jnum(jget(pivot0, "x"), a->cell_w * 0.5);
  a->pivot_y = (float)jnum(jget(pivot0, "y"), a->cell_h);

  if (clips->count > NR_MAX_CLIPS) return fail(root, a, "the manifest has more clips than NR_MAX_CLIPS");
  for (int i = 0; i < clips->count; i++) {
    const jv *c = clips->kid[i];
    const char *n = jstr(jget(c, "name"));
    if (!n) return fail(root, a, "a clip has no name");
    nr_clip *o = &a->clips[a->clip_count++];
    snprintf(o->name, sizeof o->name, "%s", n);
    o->first = (int)jnum(jget(c, "first"), 0);
    o->count = (int)jnum(jget(c, "count"), 0);
    o->ms = (int)jnum(jget(c, "ms"), 100);
    const jv *lp = jget(c, "loop");
    o->loop = lp && lp->t == J_BOOL && lp->n != 0;
    if (o->count < 1 || o->first < 0 || o->first + o->count > a->frame_count || o->ms < 1) return fail(root, a, "a clip's frame range or duration is invalid");
  }

  char colour[96], normal[96];
  snprintf(colour, sizeof colour, "atlases/%s", jstr(jget(jget(pages->kid[0], "colour"), "file")) ? jstr(jget(jget(pages->kid[0], "colour"), "file")) : "");
  snprintf(normal, sizeof normal, "atlases/%s", jstr(jget(jget(pages->kid[0], "normal"), "file")) ? jstr(jget(jget(pages->kid[0], "normal"), "file")) : "");
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
  for (int i = 0; i < a->frame_count; i++) {
    const jv *f = frames->kid[i];
    const jv *r = jget(f, "rect");
    if (!r || (int)jnum(jget(f, "page"), -1) != 0) return fail(root, a, "a frame has no rect or is not on page 0");
    float x = (float)jnum(jget(r, "x"), 0), y = (float)jnum(jget(r, "y"), 0), w = (float)jnum(jget(r, "w"), 0), h = (float)jnum(jget(r, "h"), 0);
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
  }
  jfree(root);
  return true;
}

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
