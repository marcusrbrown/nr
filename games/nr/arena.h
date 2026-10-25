/* arena: the street block. Geometry (boxes, planes and flat decals) comes from assets/arena/layout.json, written by
 * assets/arena/gen-arena.mjs; the four point lights come from assets/arena/lights.json.
 *
 * World units: x along the street, y up, z the lane (a larger z is nearer the camera). One unit is 64 scene pixels at
 * the belt's centre lane. Actors and arena geometry use one depth mapping, arena_depth_z(): an actor's world z is its
 * lane, so a pillar standing at lane L occludes every actor on a smaller lane and is occluded by every actor on a
 * larger one, and two actors on one lane resolve to the greater id. */
#ifndef NR_ARENA_H
#define NR_ARENA_H

#include <stdbool.h>
#include <stdint.h>

#include "three.h"

#define ARENA_LIGHTS 4
#define ARENA_FLASH 3 /* the light slot the special uses; intensity 0 until then */
#define ARENA_MAX_SOLIDS 160
#define ARENA_MAX_BLOCKS 8

typedef struct {
  char shape; /* 'b' box, 'p' vertical plane, 'd' flat decal on the ground */
  float x, y, z, w, h, d;
  uint32_t color, emissive;
  float emissive_intensity;
  int order;
  bool blocks;
} arena_solid;

typedef struct { float sweep_amp, sweep_period, sweep_phase; } arena_wave;

typedef struct {
  uint32_t color;
  float intensity, follow;
  float base[3];
  arena_wave sweep[3];
  float flicker_depth, flicker_period, flicker_phase;
  int buzz_every, buzz_ticks, buzz_offset;
  float buzz_scale;
} arena_light_def;

typedef struct {
  float x0, x1, lane0, lane1; /* the rectangle of (x, lane) a standing actor cannot enter */
} arena_block;

typedef struct {
  float x_min, x_max, lane_min, lane_max; /* where an actor's ground point may stand */
  float street_x_min, street_x_max;       /* the street the camera can show */
  int solid_count, block_count;
  arena_solid solid[ARENA_MAX_SOLIDS];
  arena_block block[ARENA_MAX_BLOCKS];
  uint32_t ambient_color;
  float ambient_intensity, light_distance, light_decay;
  arena_light_def light[ARENA_LIGHTS];
  int light_count;
} arena;

/* Reads arena/layout.json and arena/lights.json through the asset system. `actor_half_width` is the half width of an
 * actor's silhouette and `actor_reach` how far a standing actor's head recedes behind its ground point (its height
 * times the sine of the plane's pitch): together they size the rectangle around each blocking solid in which an actor
 * would stand inside it or push its head through its front face. Returns false and reports through cw_error on a
 * missing or malformed file. */
bool arena_load(arena *a, float actor_half_width, float actor_reach);

/* Adds the solids, the ambient light and the point lights to `scene` as standard-material meshes and lights; the
 * point lights are returned in `light[ARENA_LIGHTS]` for the caller to move each frame. */
void arena_build(const arena *a, t3_scene *scene, t3_light **light);

/* The lights at a fixed tick for a camera x. Position and intensity per light; deterministic (cw_sincos). */
void arena_lights_at(const arena *a, int32_t tick, float cam_x, float pos[ARENA_LIGHTS][3], float intensity[ARENA_LIGHTS]);

/* World z of an actor on `lane` with the given id; arena geometry stands at its own lane through the same mapping. */
float arena_depth_z(const arena *a, float lane, int id);

/* True when an actor standing at (x, lane) is inside a blocking solid's rectangle. */
bool arena_blocked(const arena *a, float x, float lane);

#endif
