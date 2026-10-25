/* arena: the street block. See arena.h. */
#include "arena.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/core.h"
#include "cartwheel/math.h"
#include "cartwheel/platform.h"

#ifndef NR_REVERSE_DEPTH
#define NR_REVERSE_DEPTH 0
#endif

#define TWO_PI 6.2831853f
#define LANE_EPS 0.004f
#define ARENA_ACTOR_SLOTS 8

/* ── a small JSON reader: the arena files are written by hand and by assets/arena/gen-arena.mjs ───────────────── */

typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ } jtype;
typedef struct jv {
  jtype t;
  double n;
  char *s;
  struct jv **kid;
  char **key;
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
    if (ch == '\\' && c->p < c->end) ch = *c->p++;
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
static double jnum(const jv *v, double d) { return v && v->t == J_NUM ? v->n : d; }
static bool jbool(const jv *v) { return v && v->t == J_BOOL && v->n != 0; }

/* "#rrggbb" -> 0xrrggbb */
static uint32_t jcolor(const jv *v, uint32_t d) {
  if (!v || v->t != J_STR || v->s[0] != '#') return d;
  return (uint32_t)strtoul(v->s + 1, NULL, 16);
}

static jv *load_json(const char *path) {
  size_t len = 0;
  char *text = cw_asset_load(path, &len);
  if (!text) {
    cw_error("arena: %s is missing", path);
    return NULL;
  }
  jcur cur = { text, text + len, false };
  jv *root = jparse(&cur);
  free(text);
  if (!root || cur.bad || root->t != J_OBJ) {
    cw_error("arena: %s is not valid JSON", path);
    jfree(root);
    return NULL;
  }
  return root;
}

/* ── load ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

static bool load_layout(arena *a, float half_width, float reach) {
  jv *root = load_json("arena/layout.json");
  if (!root) return false;
  const jv *b = jget(root, "bounds"), *solids = jget(root, "solids");
  if (!b || !solids || solids->t != J_ARR || solids->count < 1 || solids->count > ARENA_MAX_SOLIDS) {
    cw_error("arena: layout.json has no bounds, or no solids, or more than %d", ARENA_MAX_SOLIDS);
    jfree(root);
    return false;
  }
  a->x_min = (float)jnum(jget(b, "x_min"), -4.0);
  a->x_max = (float)jnum(jget(b, "x_max"), 24.0);
  a->lane_min = (float)jnum(jget(b, "lane_min"), -1.6);
  a->lane_max = (float)jnum(jget(b, "lane_max"), 1.8);
  a->street_x_min = (float)jnum(jget(b, "street_x_min"), -5.0);
  a->street_x_max = (float)jnum(jget(b, "street_x_max"), 25.0);
  for (int i = 0; i < solids->count; i++) {
    const jv *s = solids->kid[i];
    const jv *shape = jget(s, "shape");
    arena_solid *o = &a->solid[a->solid_count++];
    o->shape = shape && shape->t == J_STR && !strcmp(shape->s, "plane") ? 'p' : shape && shape->t == J_STR && !strcmp(shape->s, "decal") ? 'd' : 'b';
    o->x = (float)jnum(jget(s, "x"), 0);
    o->y = (float)jnum(jget(s, "y"), 0);
    o->z = (float)jnum(jget(s, "z"), 0);
    o->w = (float)jnum(jget(s, "w"), 1);
    o->h = (float)jnum(jget(s, "h"), 1);
    o->d = (float)jnum(jget(s, "d"), 1);
    o->color = jcolor(jget(s, "color"), 0x808080);
    o->emissive = jcolor(jget(s, "emissive"), 0);
    o->emissive_intensity = (float)jnum(jget(s, "emissive_intensity"), 0);
    o->order = (int)jnum(jget(s, "order"), 0);
    o->blocks = jbool(jget(s, "blocks"));
    if (o->blocks) {
      if (a->block_count >= ARENA_MAX_BLOCKS) {
        cw_error("arena: more than %d blocking solids", ARENA_MAX_BLOCKS);
        jfree(root);
        return false;
      }
      /* the footprint widened by the actor's half width at both sides; behind the solid an actor stands clear of its back
       * face, in front of it clear by the head's recession */
      arena_block *k = &a->block[a->block_count++];
      k->x0 = o->x - o->w * 0.5f - half_width;
      k->x1 = o->x + o->w * 0.5f + half_width;
      k->lane0 = o->z - o->d * 0.5f - 0.05f;
      k->lane1 = o->z + o->d * 0.5f + reach;
    }
  }
  jfree(root);
  return true;
}

static void load_wave(arena_wave *w, const jv *v) {
  w->sweep_amp = v && v->t == J_ARR && v->count > 0 ? (float)jnum(v->kid[0], 0) : 0.0f;
  w->sweep_period = v && v->t == J_ARR && v->count > 1 ? (float)jnum(v->kid[1], 1) : 1.0f;
  w->sweep_phase = v && v->t == J_ARR && v->count > 2 ? (float)jnum(v->kid[2], 0) : 0.0f;
}

static bool load_lights(arena *a) {
  jv *root = load_json("arena/lights.json");
  if (!root) return false;
  const jv *lights = jget(root, "lights"), *amb = jget(root, "ambient");
  if (!lights || lights->t != J_ARR || lights->count != ARENA_LIGHTS) {
    cw_error("arena: lights.json must list exactly %d lights", ARENA_LIGHTS);
    jfree(root);
    return false;
  }
  a->ambient_color = jcolor(jget(amb, "color"), 0x808080);
  a->ambient_intensity = (float)jnum(jget(amb, "intensity"), 1.0);
  a->light_distance = (float)jnum(jget(root, "distance"), 14.0);
  a->light_decay = (float)jnum(jget(root, "decay"), 2.0);
  for (int i = 0; i < ARENA_LIGHTS; i++) {
    const jv *l = lights->kid[i];
    arena_light_def *d = &a->light[a->light_count++];
    d->color = jcolor(jget(l, "color"), 0xffffff);
    d->intensity = (float)jnum(jget(l, "intensity"), 0);
    d->follow = (float)jnum(jget(l, "follow"), 0);
    const jv *base = jget(l, "base");
    for (int k = 0; k < 3; k++) d->base[k] = base && base->t == J_ARR && k < base->count ? (float)jnum(base->kid[k], 0) : 0.0f;
    load_wave(&d->sweep[0], jget(l, "sweep_x"));
    load_wave(&d->sweep[1], jget(l, "sweep_y"));
    load_wave(&d->sweep[2], jget(l, "sweep_z"));
    const jv *f = jget(l, "flicker"), *bz = jget(l, "buzz");
    d->flicker_depth = (float)jnum(jget(f, "depth"), 0);
    d->flicker_period = (float)jnum(jget(f, "period"), 1);
    d->flicker_phase = (float)jnum(jget(f, "phase"), 0);
    d->buzz_every = (int)jnum(jget(bz, "every"), 0);
    d->buzz_ticks = (int)jnum(jget(bz, "ticks"), 0);
    d->buzz_scale = (float)jnum(jget(bz, "scale"), 1);
    d->buzz_offset = (int)jnum(jget(bz, "offset"), 0);
  }
  jfree(root);
  return true;
}

bool arena_load(arena *a, float actor_half_width, float actor_reach) {
  memset(a, 0, sizeof *a);
  return load_layout(a, actor_half_width, actor_reach) && load_lights(a);
}

/* ── scene ─────────────────────────────────────────────────────────────────────────────────────────────────── */

typedef struct { char shape; float w, h, d; t3_geometry *g; } geom_entry;
typedef struct { uint32_t color, emissive; float intensity; bool depth_write; t3_material *m; } mat_entry;

static t3_geometry *geometry_for(geom_entry *cache, int *n, const arena_solid *s) {
  for (int i = 0; i < *n; i++)
    if (cache[i].shape == s->shape && cache[i].w == s->w && cache[i].h == s->h && cache[i].d == s->d) return cache[i].g;
  t3_geometry *g = s->shape == 'b' ? t3_box_geometry_new(s->w, s->h, s->d, 1, 1, 1)
                   : s->shape == 'p' ? t3_plane_geometry_new(s->w, s->h, 1, 1)
                                     : t3_plane_geometry_new(s->w, s->d, 1, 1);
  cache[*n] = (geom_entry){ s->shape, s->w, s->h, s->d, g };
  (*n)++;
  return g;
}

static t3_material *material_for(mat_entry *cache, int *n, const arena_solid *s) {
  bool depth_write = s->shape != 'd';
  for (int i = 0; i < *n; i++)
    if (cache[i].color == s->color && cache[i].emissive == s->emissive && cache[i].intensity == s->emissive_intensity && cache[i].depth_write == depth_write)
      return cache[i].m;
  t3_material *m = t3_mesh_standard_material_new(s->color);
  m->metalness = 0.0f;
  m->roughness = 1.0f;
  if (s->emissive_intensity > 0.0f) {
    m->emissive.r = (float)((s->emissive >> 16) & 0xff) / 255.0f;
    m->emissive.g = (float)((s->emissive >> 8) & 0xff) / 255.0f;
    m->emissive.b = (float)(s->emissive & 0xff) / 255.0f;
    m->emissive_intensity = s->emissive_intensity;
  }
  m->depth_write = depth_write;
  cache[*n] = (mat_entry){ s->color, s->emissive, s->emissive_intensity, depth_write, m };
  (*n)++;
  return m;
}

void arena_build(const arena *a, t3_scene *scene, t3_light **light) {
  geom_entry geoms[ARENA_MAX_SOLIDS];
  mat_entry mats[ARENA_MAX_SOLIDS];
  int ng = 0, nm = 0;
  for (int i = 0; i < a->solid_count; i++) {
    const arena_solid *s = &a->solid[i];
    t3_mesh *mesh = t3_mesh_new(geometry_for(geoms, &ng, s), material_for(mats, &nm, s));
    if (s->shape == 'd') t3_object_set_rotation(mesh, -1.5707963f, 0, 0);
    t3_object_set_position(mesh, s->x, s->y, s->z);
    mesh->base.render_order = s->order;
    t3_object_add((t3_object *)scene, mesh);
  }
  t3_object_add((t3_object *)scene, t3_ambient_light_new(a->ambient_color, a->ambient_intensity));
  for (int i = 0; i < ARENA_LIGHTS; i++) {
    light[i] = t3_point_light_new(a->light[i].color, 1.0f, a->light_distance, a->light_decay);
    t3_object_add((t3_object *)scene, light[i]);
  }
}

/* ── lights ──────────────────────────────────────────────────────────────────────────────────────────────────── */

void arena_lights_at(const arena *a, int32_t tick, float cam_x, float pos[ARENA_LIGHTS][3], float intensity[ARENA_LIGHTS]) {
  for (int i = 0; i < ARENA_LIGHTS; i++) {
    const arena_light_def *d = &a->light[i];
    for (int k = 0; k < 3; k++) {
      float s, c;
      cw_sincos(TWO_PI * (float)tick / d->sweep[k].sweep_period + d->sweep[k].sweep_phase, &s, &c);
      (void)c;
      pos[i][k] = d->base[k] + d->sweep[k].sweep_amp * s;
    }
    pos[i][0] += d->follow * cam_x;
    float fs, fc;
    cw_sincos(TWO_PI * (float)tick / d->flicker_period + d->flicker_phase, &fs, &fc);
    (void)fc;
    float v = d->intensity * (1.0f - d->flicker_depth * (0.5f + 0.5f * fs));
    if (d->buzz_every > 0 && (tick + d->buzz_offset) % d->buzz_every < d->buzz_ticks) v *= d->buzz_scale;
    intensity[i] = v;
  }
}

/* ── ordering and blocking ────────────────────────────────────────────────────────────────────────────────── */

float arena_depth_z(const arena *a, float lane, int id) {
#if NR_REVERSE_DEPTH
  return (a->lane_max - lane) + (float)(ARENA_ACTOR_SLOTS - id) * LANE_EPS;
#else
  (void)a;
  return lane + (float)id * LANE_EPS;
#endif
}

bool arena_blocked(const arena *a, float x, float lane) {
  for (int i = 0; i < a->block_count; i++) {
    const arena_block *k = &a->block[i];
    if (x > k->x0 && x < k->x1 && lane > k->lane0 && lane < k->lane1) return true;
  }
  return false;
}
