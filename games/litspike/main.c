/* litspike: a feasibility scene for normal-mapped, alpha-tested sprite planes lit by moving coloured point
 * lights, built natively and as a cart from this one file. Each actor is a MeshStandardMaterial plane with a colour
 * map, a normal map and an alpha test on a ground plane; three point lights sweep across them on a fixed tick, and
 * one untextured Standard pillar stands behind. The simulation state hosts compare (tick, light and actor
 * positions, checksum) and the program states three.c skipped are published as debug fields (lit.*, cw.three.*).
 *
 * LITSPIKE_ACTORS (compile definition): actors in play; up to three stand in one row, more fill rows of ten.
 * LITSPIKE_FLAT_NORMALS (compile definition): the actors' normal map is flat; the control build for the
 * normal-map response check.
 * LITSPIKE_PERF (compile definition): reads one pixel back after every frame so each frame includes its GPU work,
 * and publishes the wall time of every frame (lit.perf_ms); the measurement build, outside the simulation. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#if LITSPIKE_PERF
#include "cartwheel/gl.h"
#endif
#include "cartwheel/math.h"
#include "cartwheel/platform.h"
#include "cartwheel/render3d.h"
#include "three.h"

#ifndef LITSPIKE_ACTORS
#define LITSPIKE_ACTORS 3
#endif
#ifndef LITSPIKE_PERF
#define LITSPIKE_PERF 0
#endif
#ifndef LITSPIKE_FLAT_NORMALS
#define LITSPIKE_FLAT_NORMALS 0
#endif
#define LITSPIKE_PERF_RING 1024

#define N LITSPIKE_ACTORS
#define LIGHTS 3
CW_STATIC_ASSERT(N >= 1 && N <= 64, "LITSPIKE_ACTORS is 1 to 64");

/* the sprite is 64x128 texels; a plane of this size gives about 1.4 screen pixels per texel at 960x540 */
#define SPRITE_W 1.5f
#define SPRITE_H 3.0f
#define TWO_PI 6.2831853f
#define LIGHT_X_AMP 6.5f
#define ROW_SIZE 10

static const uint32_t LIGHT_COLOR[LIGHTS] = { 0xff2bd6, 0x20e8ff, 0xffa020 };
/* ticks per sweep and starting phase of each light: at ticks 60, 120, 180 and 240 the net push of the lights on the
 * middle actor alternates left, right, left, right */
static const float LIGHT_PERIOD[LIGHTS] = { 120.0f, 240.0f, 360.0f };
static const float LIGHT_PHASE[LIGHTS] = { 0.2617994f, 5.2359878f, 4.9741884f };
#define LIGHT_INTENSITY 36.0f
#define LIGHT_DISTANCE 16.0f
#define LIGHT_DECAY 2.0f

static struct {
  /* simulation (everything the hosts compare) */
  float pos[N][3];        /* actor x, ground y (0), world z */
  float light_pos[LIGHTS][3];
  int32_t ticks, actors, lights;
  uint32_t checksum;
  /* presentation */
  t3_renderer *renderer;
  t3_scene *scene;
  t3_camera *camera;
  t3_mesh *mesh[N];
  t3_light *light[LIGHTS];
#if LITSPIKE_PERF
  float perf_ms[LITSPIKE_PERF_RING]; /* wall ms from the end of one frame's render to the end of the next's */
  int32_t perf_n;
#endif
  int32_t flat_normals;
  /* program states three.c skipped (in no program table), published as the pipeline does */
  int32_t three_missing;
  char three_missing_states[1024];
} S;

/* ── simulation ────────────────────────────────────────────────────── */

static void layout_actors(void) {
  for (int i = 0; i < N; i++) {
    if (N <= 3) {
      S.pos[i][0] = (float)(i - (N - 1) / 2.0f) * 3.0f;
      S.pos[i][2] = 2.0f;
    } else {
      int row = i / ROW_SIZE, col = i % ROW_SIZE;
      int in_row = (N - row * ROW_SIZE) < ROW_SIZE ? (N - row * ROW_SIZE) : ROW_SIZE;
      S.pos[i][0] = ((float)col - (float)(in_row - 1) * 0.5f) * 1.4f;
      S.pos[i][2] = 0.0f + (float)row * 1.2f;
    }
    S.pos[i][1] = 0.0f;
    S.pos[i][2] += (float)i * 0.004f; /* breaks depth ties between coplanar actors */
  }
}

/* each light sweeps along x at its own phase and bobs in y and z; cw_sin/cw_cos are the deterministic ones */
static void lights_at(int32_t tick) {
  for (int i = 0; i < LIGHTS; i++) {
    float a = TWO_PI * (float)tick / LIGHT_PERIOD[i] + LIGHT_PHASE[i];
    float s, c;
    cw_sincos(a, &s, &c);
    S.light_pos[i][0] = LIGHT_X_AMP * s;
    S.light_pos[i][1] = 1.8f + 0.6f * c;
    S.light_pos[i][2] = 3.8f + 0.5f * s;
  }
}

static void sim_init(void) {
  S.actors = N;
  S.lights = LIGHTS;
  S.checksum = CW_HASH32_INIT;
  layout_actors();
  lights_at(0);
}

static void fixed_update(void *user, double dt) {
  (void)user, (void)dt;
  S.ticks++;
  lights_at(S.ticks);
  int32_t scalars[3] = { S.ticks, S.actors, S.lights };
  uint32_t h = S.checksum;
  h = cw_hash32(S.pos, sizeof S.pos, h);
  h = cw_hash32(S.light_pos, sizeof S.light_pos, h);
  h = cw_hash32(scalars, sizeof scalars, h);
  S.checksum = h;
}

/* ── scene ─────────────────────────────────────────────────────────── */

static t3_texture *load_sprite(const char *path, t3_color_space space) {
  size_t len = 0;
  void *bytes = cw_asset_load(path, &len);
  if (!bytes) {
    cw_error("litspike: sprite %s missing", path);
    return NULL;
  }
  t3_texture *t = t3_texture_load_memory(bytes, len);
  free(bytes);
  if (!t) {
    cw_error("litspike: sprite %s did not decode", path);
    return NULL;
  }
  t->mag_filter = t->min_filter = T3_NEAREST;
  t->generate_mipmaps = false;
  t->color_space = space;
  return t;
}

#if LITSPIKE_FLAT_NORMALS
/* a flat tangent-space normal map of the sprite's size, nearest filtered */
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
#endif

static t3_material *standard_material(uint32_t color) {
  t3_material *m = t3_mesh_standard_material_new(color);
  m->metalness = 0.0f;
  m->roughness = 1.0f;
  return m;
}

static void build_scene(int w, int h) {
  S.renderer = cw_render3d_window_renderer(w, h);
  t3_renderer_set_clear_color(S.renderer, 0x10141c, 1.0f);
  S.scene = t3_scene_new();
  S.camera = t3_perspective_camera_new(50.0f, (float)w / (float)h, 0.5f, 60.0f);
  t3_object_set_position(S.camera, 0, 4.0f, 11.5f);
  t3_object_look_at(S.camera, 0, 0.8f, 1.5f);

  /* ground and pillar: Standard, lit, no map */
  t3_mesh *ground = t3_mesh_new(t3_plane_geometry_new(24.0f, 10.0f, 1, 1), standard_material(0x2b3a2b));
  t3_object_set_rotation(ground, -1.5707963f, 0, 0);
  t3_object_set_position(ground, 0, -0.002f, 2.0f);
  t3_object_add((t3_object *)S.scene, ground);

  t3_mesh *pillar = t3_mesh_new(t3_box_geometry_new(1.6f, 3.4f, 0.8f, 1, 1, 1), standard_material(0x9098a8));
  t3_object_set_position(pillar, -5.5f, 1.7f, -0.5f);
  t3_object_add((t3_object *)S.scene, pillar);

  /* a dim ambient so the unlit side of a figure is not black, and the sweeping point lights */
  t3_object_add((t3_object *)S.scene, t3_ambient_light_new(0x303844, 1.0f));
  for (int i = 0; i < LIGHTS; i++) {
    S.light[i] = t3_point_light_new(LIGHT_COLOR[i], LIGHT_INTENSITY, LIGHT_DISTANCE, LIGHT_DECAY);
    t3_object_add((t3_object *)S.scene, S.light[i]);
  }

  /* actors: one colour-mapped, normal-mapped, alpha-tested Standard plane each */
  t3_texture *albedo = load_sprite("sprites/figure.png", T3_SRGB_COLOR_SPACE);
#if LITSPIKE_FLAT_NORMALS
  t3_texture *nrm = flat_normal_texture(albedo->width, albedo->height);
  S.flat_normals = 1;
#else
  t3_texture *nrm = load_sprite("sprites/figure-n.png", T3_NO_COLOR_SPACE);
#endif
  t3_material *mat = standard_material(0xffffff);
  t3_material_set_map(mat, albedo);
  t3_material_set_texture(mat, T3_NORMAL_MAP, nrm);
  mat->normal_scale = (t3_vec2){ 1.0f, 1.0f };
  mat->alpha_test = 0.5f;
  t3_geometry *quad = t3_plane_geometry_new(SPRITE_W, SPRITE_H, 1, 1);
  for (int i = 0; i < N; i++) {
    S.mesh[i] = t3_mesh_new(quad, mat);
    t3_object_add((t3_object *)S.scene, S.mesh[i]);
  }
}

#if LITSPIKE_PERF
static double wall_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}
#endif

static void sync_scene(void) {
  for (int i = 0; i < N; i++) t3_object_set_position(S.mesh[i], S.pos[i][0], S.pos[i][1] + SPRITE_H * 0.5f, S.pos[i][2]);
  for (int i = 0; i < LIGHTS; i++) t3_object_set_position(S.light[i], S.light_pos[i][0], S.light_pos[i][1], S.light_pos[i][2]);
}

/* A bare three.c renderer has no pipeline to publish the draws it skipped, so the counts are read here, as
 * src/render/pipeline.c reads them. */
static void report_missing(void) {
  const char *m = t3_renderer_generated_missing(S.renderer);
  if (!m) m = "";
  if (strcmp(m, S.three_missing_states) == 0) return;
  int32_t n = 0;
  for (const char *c = m; *c; c++)
    if (*c == '\n' || !c[1]) n++;
  if (n) cw_warn("litspike: three.c skipped draws: %d program state(s) in no program table:\n%s", (int)n, m);
  S.three_missing = n;
  memset(S.three_missing_states, 0, sizeof S.three_missing_states);
  snprintf(S.three_missing_states, sizeof S.three_missing_states, "%s", m);
}

/* ── app ───────────────────────────────────────────────────────────── */

static void register_debug(void) {
  cw_debug_f32_array("lit.pos", &S.pos[0][0], N * 3);
  cw_debug_f32_array("lit.light_pos", &S.light_pos[0][0], LIGHTS * 3);
  cw_debug_i32("lit.actors", &S.actors);
  cw_debug_i32("lit.lights", &S.lights);
  cw_debug_i32("lit.ticks", &S.ticks);
  cw_debug_u32("lit.checksum", &S.checksum);
  cw_debug_i32("lit.flat_normals", &S.flat_normals);
  cw_debug_i32("cw.three.missing", &S.three_missing);
  cw_debug_bytes("cw.three.missing_states", S.three_missing_states, sizeof S.three_missing_states);
#if LITSPIKE_PERF
  cw_debug_f32_array("lit.perf_ms", S.perf_ms, LITSPIKE_PERF_RING);
  cw_debug_i32("lit.perf_n", &S.perf_n);
#endif
}

static void init(void *user) {
  (void)user;
  sim_init();
  int w, h;
  cw_drawable_size(&w, &h);
  build_scene(w, h);
  register_debug();
}

static void render(void *user, double alpha) {
  (void)user, (void)alpha;
  sync_scene();
  t3_renderer_reset_bindings(S.renderer);
  cw_render3d_window_target(S.renderer);
  t3_renderer_render(S.renderer, S.scene, S.camera);
  report_missing();
#if LITSPIKE_PERF
  static double last;
  uint8_t px[4];
  glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
  double now = wall_ms();
  if (last > 0 && S.perf_n < LITSPIKE_PERF_RING) S.perf_ms[S.perf_n++] = (float)(now - last);
  last = now;
#endif
}

cw_app_desc cw_main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  return (cw_app_desc){
    .title = "litspike",
    .width = 960,
    .height = 540,
    .fixed_hz = 60,
    .init = init,
    .fixed_update = fixed_update,
    .render = render,
    .debug = true,
  };
}
