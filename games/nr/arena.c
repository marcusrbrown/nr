/* arena: the street block. See arena.h. */
#include "arena.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/core.h"
#include "cartwheel/math.h"
#include "cartwheel/platform.h"
#include "json.h"

#ifndef NR_REVERSE_DEPTH
#define NR_REVERSE_DEPTH 0
#endif

#define TWO_PI 6.2831853f
#define LANE_EPS 0.004f
#define ARENA_ACTOR_SLOTS 8

/* ── load ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

static bool load_layout(arena *a, float half_width, float reach) {
  nr_json *root = nr_json_load("arena/layout.json", "arena");
  if (!root) return false;
  const nr_json *b = nr_json_get(root, "bounds"), *solids = nr_json_get(root, "solids");
  if (!b || !solids || solids->type != NR_JSON_ARR || solids->count < 1 || solids->count > ARENA_MAX_SOLIDS) {
    cw_error("arena: layout.json has no bounds, or no solids, or more than %d", ARENA_MAX_SOLIDS);
    nr_json_free(root);
    return false;
  }
  a->x_min = (float)nr_json_num(nr_json_get(b, "x_min"), -4.0);
  a->x_max = (float)nr_json_num(nr_json_get(b, "x_max"), 24.0);
  a->lane_min = (float)nr_json_num(nr_json_get(b, "lane_min"), -1.6);
  a->lane_max = (float)nr_json_num(nr_json_get(b, "lane_max"), 1.8);
  a->street_x_min = (float)nr_json_num(nr_json_get(b, "street_x_min"), -5.0);
  a->street_x_max = (float)nr_json_num(nr_json_get(b, "street_x_max"), 25.0);
  for (int i = 0; i < solids->count; i++) {
    const nr_json *s = solids->kid[i];
    const nr_json *shape = nr_json_get(s, "shape");
    const char *shape_name = nr_json_str(shape);
    arena_solid *o = &a->solid[a->solid_count++];
    o->shape = shape_name && !strcmp(shape_name, "plane") ? 'p' : shape_name && !strcmp(shape_name, "decal") ? 'd' : 'b';
    o->x = (float)nr_json_num(nr_json_get(s, "x"), 0);
    o->y = (float)nr_json_num(nr_json_get(s, "y"), 0);
    o->z = (float)nr_json_num(nr_json_get(s, "z"), 0);
    o->w = (float)nr_json_num(nr_json_get(s, "w"), 1);
    o->h = (float)nr_json_num(nr_json_get(s, "h"), 1);
    o->d = (float)nr_json_num(nr_json_get(s, "d"), 1);
    o->color = nr_json_color(nr_json_get(s, "color"), 0x808080);
    o->emissive = nr_json_color(nr_json_get(s, "emissive"), 0);
    o->emissive_intensity = (float)nr_json_num(nr_json_get(s, "emissive_intensity"), 0);
    o->order = (int)nr_json_num(nr_json_get(s, "order"), 0);
    o->blocks = nr_json_bool(nr_json_get(s, "blocks"));
    if (o->blocks) {
      if (a->block_count >= ARENA_MAX_BLOCKS) {
        cw_error("arena: more than %d blocking solids", ARENA_MAX_BLOCKS);
        nr_json_free(root);
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
  nr_json_free(root);
  return true;
}

static void load_wave(arena_wave *w, const nr_json *v) {
  w->sweep_amp = v && v->type == NR_JSON_ARR && v->count > 0 ? (float)nr_json_num(v->kid[0], 0) : 0.0f;
  w->sweep_period = v && v->type == NR_JSON_ARR && v->count > 1 ? (float)nr_json_num(v->kid[1], 1) : 1.0f;
  w->sweep_phase = v && v->type == NR_JSON_ARR && v->count > 2 ? (float)nr_json_num(v->kid[2], 0) : 0.0f;
}

static bool load_lights(arena *a) {
  nr_json *root = nr_json_load("arena/lights.json", "arena");
  if (!root) return false;
  const nr_json *lights = nr_json_get(root, "lights"), *amb = nr_json_get(root, "ambient");
  if (!lights || lights->type != NR_JSON_ARR || lights->count != ARENA_LIGHTS) {
    cw_error("arena: lights.json must list exactly %d lights", ARENA_LIGHTS);
    nr_json_free(root);
    return false;
  }
  a->ambient_color = nr_json_color(nr_json_get(amb, "color"), 0x808080);
  a->ambient_intensity = (float)nr_json_num(nr_json_get(amb, "intensity"), 1.0);
  a->light_distance = (float)nr_json_num(nr_json_get(root, "distance"), 14.0);
  a->light_decay = (float)nr_json_num(nr_json_get(root, "decay"), 2.0);
  for (int i = 0; i < ARENA_LIGHTS; i++) {
    const nr_json *l = lights->kid[i];
    arena_light_def *d = &a->light[a->light_count++];
    d->color = nr_json_color(nr_json_get(l, "color"), 0xffffff);
    d->intensity = (float)nr_json_num(nr_json_get(l, "intensity"), 0);
    d->follow = (float)nr_json_num(nr_json_get(l, "follow"), 0);
    const nr_json *base = nr_json_get(l, "base");
    for (int k = 0; k < 3; k++) d->base[k] = base && base->type == NR_JSON_ARR && k < base->count ? (float)nr_json_num(base->kid[k], 0) : 0.0f;
    load_wave(&d->sweep[0], nr_json_get(l, "sweep_x"));
    load_wave(&d->sweep[1], nr_json_get(l, "sweep_y"));
    load_wave(&d->sweep[2], nr_json_get(l, "sweep_z"));
    const nr_json *f = nr_json_get(l, "flicker"), *bz = nr_json_get(l, "buzz");
    d->flicker_depth = (float)nr_json_num(nr_json_get(f, "depth"), 0);
    d->flicker_period = (float)nr_json_num(nr_json_get(f, "period"), 1);
    d->flicker_phase = (float)nr_json_num(nr_json_get(f, "phase"), 0);
    d->buzz_every = (int)nr_json_num(nr_json_get(bz, "every"), 0);
    d->buzz_ticks = (int)nr_json_num(nr_json_get(bz, "ticks"), 0);
    d->buzz_scale = (float)nr_json_num(nr_json_get(bz, "scale"), 1);
    d->buzz_offset = (int)nr_json_num(nr_json_get(bz, "offset"), 0);
  }
  nr_json_free(root);
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
