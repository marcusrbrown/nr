/* spike: a belt-scroll encounter scene for the shipping-path spike, built natively and as a cart from this one
 * file. Actors are alpha-tested textured planes in a three.c scene on a ground plane, ordered by depth derived
 * from their ground-y; a jump lifts the plane without touching that depth. Two local players act through named
 * actions read in the fixed tick; the rest of the crowd wanders on the shared rng. The simulation state that
 * hosts compare is published as debug fields (spike.*).
 *
 * SPIKE_ACTORS (compile definition): actors in play, two players and the rest enemies.
 * SPIKE_REVERSE_DEPTH (compile definition): inverts the actor depth mapping; the control build for the
 * ordering gate.
 * SPIKE_PERF (compile definition): reads one pixel back after every frame so each frame includes its GPU work,
 * and publishes the wall time of every frame (spike.perf_ms); the measurement build, outside the simulation.
 * SPIKE_PERF_CONTROL (compile definition): spins SPIKE_PERF_CONTROL_MS per actor per frame in the render
 * callback; the control build that must exceed the frame budget.
 * SPIKE_NO_PREWARM (compile definition): skips the HUD glyph preload; the control build for the glyph check. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "cartwheel/audio.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#if SPIKE_PERF
#include "cartwheel/gl.h"
#endif
#include "cartwheel/input.h"
#include "cartwheel/platform.h"
#include "cartwheel/render2d.h"
#include "cartwheel/render3d.h"
#include "three.h"

#ifndef SPIKE_ACTORS
#define SPIKE_ACTORS 8
#endif
#ifndef SPIKE_REVERSE_DEPTH
#define SPIKE_REVERSE_DEPTH 0
#endif
#ifndef SPIKE_PERF
#define SPIKE_PERF 0
#endif
#ifndef SPIKE_PERF_CONTROL
#define SPIKE_PERF_CONTROL 0
#endif
#ifndef SPIKE_PERF_CONTROL_MS
#define SPIKE_PERF_CONTROL_MS 0.5
#endif
#ifndef SPIKE_NO_PREWARM
#define SPIKE_NO_PREWARM 0
#endif
#define SPIKE_PERF_RING 1024

#define N SPIKE_ACTORS
#define ENEMIES (N - 2)
CW_STATIC_ASSERT(N >= 2 && N <= 64, "SPIKE_ACTORS is two players plus up to 62 enemies");

/* ground-y (depth into the screen axis of the belt) and x bounds; larger ground-y is nearer the camera */
#define PLAY_X 8.0f
#define PLAY_Y_MAX 4.0f
/* world z per unit of ground-y, and the per-actor-id step that breaks ties between equal ground-y */
#define Z_PER_Y 1.0f
#define Z_ID_EPS 0.004f
#define SPRITE_W 1.0f
#define SPRITE_H 1.5f
#define SPEED 4.0f
#define JUMP_V 6.0f
#define GRAVITY 18.0f
#define PILLAR_Y 1.6f
#define CROWD_Y_MIN 0.2f
#define CROWD_Y_SPAN 3.6f
#define CROWD_X_NEAR 4.2f
#define CROWD_X_SPAN 3.4f

/* body kinds select the material set: blue (player 0), orange (player 1), enemy (orange, tinted) */
enum { KIND_P0, KIND_P1, KIND_ENEMY, KIND_COUNT };
enum { FACE_LEFT, FACE_RIGHT };

static struct {
  /* simulation (everything the hosts compare) */
  float pos[N][3]; /* x, ground-y, world z */
  float jump[N];   /* height above the ground plane */
  float vy[N];
  uint8_t face[N];
  float band_lo[N], band_hi[N]; /* an enemy's x range */
  cw_rng rng;
  int32_t ticks, input_count, sfx_tick, voice_created, actors;
  uint32_t checksum;
  cw_action left, right, up, down, jump_a, attack;
  /* presentation */
  t3_renderer *renderer;
  t3_scene *scene;
  t3_camera *camera;
  t3_mesh *mesh[N];
  t3_material *mat[KIND_COUNT][2];
  cw_font font;
  cw_sound blip;
  bool audio_on;
  int32_t hud_atlas_pages; /* HUD only: render2d atlas pages, not part of the compared state */
#if SPIKE_PERF
  float perf_ms[SPIKE_PERF_RING]; /* wall ms from the end of one frame's render to the end of the next's */
  int32_t perf_n;
#endif
  /* program states three.c skipped (in no program table), published as the pipeline does */
  int32_t three_missing;
  char three_missing_states[1024];
} S;

/* ── ordering ──────────────────────────────────────────────────────── */

/* World z of an actor from its ground-y and id. The greater ground-y is nearer the camera and wins the depth
 * test; equal ground-y resolves to the greater id. A jump never enters it. */
static float depth_z(float ground_y, int id) {
#if SPIKE_REVERSE_DEPTH
  return (PLAY_Y_MAX - ground_y) * Z_PER_Y + (float)(N - id) * Z_ID_EPS;
#else
  return ground_y * Z_PER_Y + (float)id * Z_ID_EPS;
#endif
}

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

/* ── simulation ────────────────────────────────────────────────────── */

static void sim_init(void) {
  cw_rng_seed(&S.rng, 0x5eed);
  S.actors = N;
  S.sfx_tick = -1;
  S.checksum = CW_HASH32_INIT;
  S.pos[0][0] = -2.0f;
  S.pos[0][1] = 2.0f;
  S.pos[1][0] = 2.0f;
  S.pos[1][1] = 2.0f;
  S.face[0] = FACE_RIGHT;
  S.face[1] = FACE_LEFT;
  S.band_lo[0] = S.band_lo[1] = -PLAY_X;
  S.band_hi[0] = S.band_hi[1] = PLAY_X;
  /* two crowd waves, one on each side of the open middle */
  for (int i = 2; i < N; i++) {
    bool right_side = ((i - 2) & 1) != 0;
    float lo = right_side ? CROWD_X_NEAR : -(CROWD_X_NEAR + CROWD_X_SPAN);
    S.band_lo[i] = lo;
    S.band_hi[i] = lo + CROWD_X_SPAN;
    S.pos[i][0] = lo + cw_rng_float(&S.rng) * CROWD_X_SPAN;
    S.pos[i][1] = CROWD_Y_MIN + cw_rng_float(&S.rng) * CROWD_Y_SPAN;
    S.face[i] = right_side ? FACE_LEFT : FACE_RIGHT;
  }
  for (int i = 0; i < N; i++) S.pos[i][2] = depth_z(S.pos[i][1], i);
}

static void player_tick(int p, float dt) {
  cw_vec2 mv = cw_input_vector(p, S.left, S.right, S.up, S.down, CW_DEADZONE_RADIAL, 0.2f);
  S.pos[p][0] = clampf(S.pos[p][0] + mv.x * SPEED * dt, -PLAY_X, PLAY_X);
  S.pos[p][1] = clampf(S.pos[p][1] + mv.y * SPEED * dt, 0.0f, PLAY_Y_MAX);
  if (mv.x > 0.1f) S.face[p] = FACE_RIGHT;
  else if (mv.x < -0.1f) S.face[p] = FACE_LEFT;

  if (cw_action_just_pressed(p, S.jump_a) && S.jump[p] == 0.0f && S.vy[p] == 0.0f) S.vy[p] = JUMP_V;
  if (S.jump[p] > 0.0f || S.vy[p] > 0.0f) {
    S.jump[p] += S.vy[p] * dt;
    S.vy[p] -= GRAVITY * dt;
    if (S.jump[p] <= 0.0f) S.jump[p] = S.vy[p] = 0.0f;
  }

  if (cw_action_just_pressed(p, S.attack)) {
    S.sfx_tick = S.ticks;
    if (S.audio_on) {
      cw_voice v = cw_audio_play(S.blip, NULL);
      S.voice_created = v.id != 0;
    }
  }
}

static bool any_input(int p) {
  return cw_action_pressed(p, S.left) || cw_action_pressed(p, S.right) || cw_action_pressed(p, S.up) ||
         cw_action_pressed(p, S.down) || cw_action_pressed(p, S.jump_a) || cw_action_pressed(p, S.attack);
}

static void fixed_update(void *user, double dt) {
  (void)user;
  float fdt = (float)dt;
  S.ticks++;
  if (any_input(0) || any_input(1)) S.input_count++;
  player_tick(0, fdt);
  player_tick(1, fdt);

  /* one enemy per tick takes a step, in id order */
  if (ENEMIES > 0) {
    int e = 2 + (S.ticks - 1) % ENEMIES;
    uint32_t r = cw_rng_u32(&S.rng);
    float dx = (float)((int)(r & 0xff) - 128) * (1.0f / 128.0f) * 0.12f;
    float dy = (float)((int)((r >> 8) & 0xff) - 128) * (1.0f / 128.0f) * 0.08f;
    S.pos[e][0] = clampf(S.pos[e][0] + dx, S.band_lo[e], S.band_hi[e]);
    S.pos[e][1] = clampf(S.pos[e][1] + dy, CROWD_Y_MIN, CROWD_Y_MIN + CROWD_Y_SPAN);
  }

  for (int i = 0; i < N; i++) S.pos[i][2] = depth_z(S.pos[i][1], i);

  /* rolling checksum of the tick's simulation state */
  int32_t scalars[5] = { S.ticks, S.input_count, S.sfx_tick, S.voice_created, S.actors };
  uint32_t h = S.checksum;
  h = cw_hash32(S.pos, sizeof S.pos, h);
  h = cw_hash32(S.jump, sizeof S.jump, h);
  h = cw_hash32(S.rng.s, sizeof S.rng.s, h);
  h = cw_hash32(scalars, sizeof scalars, h);
  S.checksum = h;
}

/* ── scene ─────────────────────────────────────────────────────────── */

static t3_texture *load_sprite(const char *path) {
  size_t len = 0;
  void *bytes = cw_asset_load(path, &len);
  if (!bytes) {
    cw_error("spike: sprite %s missing", path);
    return NULL;
  }
  t3_texture *t = t3_texture_load_memory(bytes, len);
  free(bytes);
  if (!t) {
    cw_error("spike: sprite %s did not decode", path);
    return NULL;
  }
  t->mag_filter = t->min_filter = T3_NEAREST;
  t->generate_mipmaps = false;
  t->color_space = T3_SRGB_COLOR_SPACE;
  return t;
}

static t3_material *sprite_material(t3_texture *tex, uint32_t tint) {
  t3_material *m = t3_mesh_basic_material_new(tint);
  t3_material_set_map(m, tex);
  m->alpha_test = 0.5f;
  return m;
}

static void set_material(t3_mesh *m, t3_material *mat) {
  if (m->materials[0] == mat) return;
  t3_retain(mat);
  t3_release(m->materials[0]);
  m->materials[0] = mat;
}

static void build_scene(int w, int h) {
  S.renderer = cw_render3d_window_renderer(w, h);
  t3_renderer_set_clear_color(S.renderer, 0x10141c, 1.0f);
  S.scene = t3_scene_new();
  S.camera = t3_perspective_camera_new(50.0f, (float)w / (float)h, 0.5f, 60.0f);
  t3_object_set_position(S.camera, 0, 4.0f, 11.5f);
  t3_object_look_at(S.camera, 0, 0.8f, 1.5f);

  /* ground: unlit, no map */
  t3_mesh *ground = t3_mesh_new(t3_plane_geometry_new(24.0f, 10.0f, 1, 1), t3_mesh_basic_material_new(0x2b3a2b));
  t3_object_set_rotation(ground, -1.5707963f, 0, 0);
  t3_object_set_position(ground, 0, -0.002f, 2.0f);
  t3_object_add((t3_object *)S.scene, ground);

  /* environment: one lit pillar, no map */
  t3_mesh *pillar = t3_mesh_new(t3_box_geometry_new(1.6f, 3.0f, 0.8f, 1, 1, 1), t3_mesh_standard_material_new(0x9098a8));
  t3_object_set_position(pillar, 0, 1.5f, PILLAR_Y * Z_PER_Y);
  t3_object_add((t3_object *)S.scene, pillar);
  t3_light *sun = t3_directional_light_new(0xffffff, 3.14159f);
  t3_object_set_position(sun, 3, 6, 4);
  t3_object_add((t3_object *)S.scene, sun);
  t3_object_add((t3_object *)S.scene, t3_ambient_light_new(0x404040, 3.14159f));

  /* actors: one textured, alpha-tested plane each; the material follows the body kind and facing */
  t3_texture *blue[2] = { load_sprite("sprites/blue-left.png"), load_sprite("sprites/blue-right.png") };
  t3_texture *orange[2] = { load_sprite("sprites/orange-left.png"), load_sprite("sprites/orange-right.png") };
  for (int f = 0; f < 2; f++) {
    S.mat[KIND_P0][f] = sprite_material(blue[f], 0xffffff);
    S.mat[KIND_P1][f] = sprite_material(orange[f], 0xffffff);
    S.mat[KIND_ENEMY][f] = sprite_material(orange[f], 0x909090);
  }
  t3_geometry *quad = t3_plane_geometry_new(SPRITE_W, SPRITE_H, 1, 1);
  for (int i = 0; i < N; i++) {
    int kind = i < 2 ? i : KIND_ENEMY;
    S.mesh[i] = t3_mesh_new(quad, S.mat[kind][S.face[i]]);
    t3_object_add((t3_object *)S.scene, S.mesh[i]);
  }
}

#if SPIKE_PERF || SPIKE_PERF_CONTROL
static double wall_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}
#endif

static void sync_scene(void) {
  for (int i = 0; i < N; i++) {
#if SPIKE_PERF_CONTROL
    for (double end = wall_ms() + SPIKE_PERF_CONTROL_MS; wall_ms() < end;) {
    }
#endif
    int kind = i < 2 ? i : KIND_ENEMY;
    set_material(S.mesh[i], S.mat[kind][S.face[i]]);
    t3_object_set_position(S.mesh[i], S.pos[i][0], S.jump[i] + SPRITE_H * 0.5f, S.pos[i][2]);
  }
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
  if (n) cw_warn("spike: three.c skipped draws: %d program state(s) in no program table:\n%s", (int)n, m);
  S.three_missing = n;
  memset(S.three_missing_states, 0, sizeof S.three_missing_states);
  snprintf(S.three_missing_states, sizeof S.three_missing_states, "%s", m);
}

/* ── HUD ───────────────────────────────────────────────────────────── */

/* every fragment of text the HUD draws; the numbers are built from the digits */
static const char *const HUD_TEXT[] = { "SPIKE", "TICK", "ACTORS", "P1 JUMP", "P2 JUMP", "0123456789 " };

static void draw_hud(void) {
  const cw_text_style style = { .size = 18, .color = cw_hex(0xffffffff) };
  cw_r2d_begin(&(cw_r2d_pass_desc){ 0 });
  cw_r2d_text(S.font, "SPIKE", (cw_vec2){ 12, 8 }, &style);
  cw_r2d_text(S.font, cw_frame_printf("TICK %d", S.ticks), (cw_vec2){ 12, 30 }, &style);
  cw_r2d_text(S.font, cw_frame_printf("ACTORS %d", S.actors), (cw_vec2){ 12, 52 }, &style);
  cw_r2d_text(S.font, cw_frame_printf("P1 JUMP %d", (int)(S.jump[0] * 100.0f)), (cw_vec2){ 12, 496 }, &style);
  cw_r2d_text(S.font, cw_frame_printf("P2 JUMP %d", (int)(S.jump[1] * 100.0f)), (cw_vec2){ 780, 496 }, &style);
  cw_r2d_end();
  S.hud_atlas_pages = (int32_t)cw_r2d_get_stats()->atlas_pages;
}

/* ── app ───────────────────────────────────────────────────────────── */

static void register_debug(void) {
  cw_debug_f32_array("spike.pos", &S.pos[0][0], N * 3);
  cw_debug_f32_array("spike.jump", S.jump, N);
  cw_debug_field("spike.rng", S.rng.s, CW_DBG_U32, 4);
  cw_debug_i32("spike.actors", &S.actors);
  cw_debug_i32("spike.sfx_tick", &S.sfx_tick);
  cw_debug_i32("spike.voice_created", &S.voice_created);
  cw_debug_i32("spike.ticks", &S.ticks);
  cw_debug_i32("spike.input_count", &S.input_count);
  cw_debug_u32("spike.checksum", &S.checksum);
  cw_debug_i32("spike.hud_atlas_pages", &S.hud_atlas_pages);
  cw_debug_i32("cw.three.missing", &S.three_missing);
  cw_debug_bytes("cw.three.missing_states", S.three_missing_states, sizeof S.three_missing_states);
  cw_r2d_debug_register("r2d");
#if SPIKE_PERF
  cw_debug_f32_array("spike.perf_ms", S.perf_ms, SPIKE_PERF_RING);
  cw_debug_i32("spike.perf_n", &S.perf_n);
#endif
}

static void init(void *user) {
  (void)user;
  S.left = cw_action_add("move_left", 0.2f);
  S.right = cw_action_add("move_right", 0.2f);
  S.up = cw_action_add("move_up", 0.2f);
  S.down = cw_action_add("move_down", 0.2f);
  S.jump_a = cw_action_add("jump", 0.5f);
  S.attack = cw_action_add("attack", 0.5f);
  cw_action_bind_text(S.left, "key:left, pad:left, axis:lx-");
  cw_action_bind_text(S.right, "key:right, pad:right, axis:lx+");
  cw_action_bind_text(S.up, "key:up, pad:up, axis:ly-");
  cw_action_bind_text(S.down, "key:down, pad:down, axis:ly+");
  cw_action_bind_text(S.jump_a, "key:space, pad:south");
  cw_action_bind_text(S.attack, "key:j, pad:west");

  sim_init();

  S.audio_on = cw_audio_init(NULL);
  if (S.audio_on) S.blip = cw_sound_load("audio/blip.wav", &(cw_sound_desc){ .mode = CW_SOUND_SAMPLE, .max_voices = 4 });

  S.font = cw_font_load("fonts/FiraSans-Regular.ttf", NULL);
  for (size_t i = 0; i < CW_ARRAY_LEN(HUD_TEXT) && !SPIKE_NO_PREWARM; i++) cw_font_preload_text(S.font, HUD_TEXT[i]);

  int w, h;
  cw_drawable_size(&w, &h);
  build_scene(w, h);
  register_debug();
}

static void update(void *user, double dt) {
  (void)user, (void)dt;
  if (S.audio_on) cw_audio_update();
}

static void render(void *user, double alpha) {
  (void)user, (void)alpha;
  sync_scene();
  t3_renderer_reset_bindings(S.renderer); /* the last frame's HUD pass changed GL state three.c caches */
  cw_render3d_window_target(S.renderer);
  t3_renderer_render(S.renderer, S.scene, S.camera);
  report_missing();
  draw_hud();
#if SPIKE_PERF
  static double last;
  uint8_t px[4];
  glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
  double now = wall_ms();
  if (last > 0 && S.perf_n < SPIKE_PERF_RING) S.perf_ms[S.perf_n++] = (float)(now - last);
  last = now;
#endif
}

cw_app_desc cw_main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  return (cw_app_desc){
    .title = "spike",
    .width = 960,
    .height = 540,
    .fixed_hz = 60,
    .init = init,
    .fixed_update = fixed_update,
    .update = update,
    .render = render,
    .debug = true,
  };
}
