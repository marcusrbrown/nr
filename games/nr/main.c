/* nr: Neon Rebellion. Lit sprite actors on a belt-scroll street block, built natively and as a cart from one source.
 *
 * Presentation. The design frame is 1920x1080 with pixel_scale 3: the engine renders the scene at 640x360 and scales
 * it up 3x with nearest-neighbour. An actor is a plane that faces the belt camera (tilted by the camera's pitch), with
 * the frame's colour and plane-space normal texels mapped 1:1 onto scene pixels at the belt's centre lane, lit by four
 * point lights: three neon lights that sweep the street and one flash slot (intensity 0 until the special uses it),
 * so one program state (l0400) covers every frame. Actors stand at world (x, 0, z) with z from arena_depth_z(): a
 * larger lane is nearer the camera and wins the depth test, and equal lanes resolve to the greater id. The street
 * block (arena.c, assets/arena) is drawn in the same depth buffer.
 *
 * Camera. It follows the players' midpoint along x and keeps every player in frame. A player cannot stand past the
 * frame's edge, so the trailing player holds the camera back and the leading player stops at the edge of what the
 * trailing player's frame shows (the soft wall). The camera never scrolls back past the furthest point it reached.
 *
 * Builds (compile definitions):
 *   NR_STAGE_LEGACY: the look checkpoint's stage (a plain street, four fixed actors, no input); the lit-side and
 *     silhouette checks measure on it. NR_LIT_TEST implies it.
 *   NR_LIT_TEST: 0 = the street block; 1 = one hero held on one frame under a light that sweeps along x;
 *     2 = the same under a light that sweeps along y, above and below the hero; 3, 4, 5 = the same hero held under only
 *     neon light 0, 1 or 2, standing still to the hero's left.
 *   NR_NO_HEROES: the actors are not drawn; the control for measuring their silhouettes and for the ordering check.
 *   NR_FLAT_NORMALS: the actors' normal map is flat; the control build of the lit-side check.
 *   NR_REVERSE_DEPTH: the actors' depth mapping is inverted (arena.c); the control build of the ordering check.
 *
 * The state hosts compare (tick, positions, clip steps, lights, camera, checksum) and the program states three.c
 * skipped are published as debug fields (nr.*, cw.three.*). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "anim.h"
#include "arena.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#include "cartwheel/input.h"
#include "cartwheel/math.h"
#include "cartwheel/platform.h"
#include "cartwheel/render3d.h"
#include "three.h"

#ifndef NR_LIT_TEST
#define NR_LIT_TEST 0
#endif
#ifndef NR_FLAT_NORMALS
#define NR_FLAT_NORMALS 0
#endif
#ifndef NR_NO_HEROES
#define NR_NO_HEROES 0
#endif
#ifndef NR_STAGE_LEGACY
#define NR_STAGE_LEGACY 0
#endif
#define NR_ARENA (NR_LIT_TEST == 0 && NR_STAGE_LEGACY == 0)

#define ACTORS (NR_LIT_TEST ? 1 : 4)
#define PLAYERS 2 /* actors 0 and 1 are the players; the rest are stand-ins until the enemies exist */
#define LIGHTS ARENA_LIGHTS
#define TWO_PI 6.2831853f

/* the belt camera, in world units; one unit is PPU scene pixels at the belt's centre lane */
#define DESIGN_W 1920
#define DESIGN_H 1080
#define PIXEL_SCALE 3
#define SCENE_W (DESIGN_W / PIXEL_SCALE)
#define SCENE_H (DESIGN_H / PIXEL_SCALE)
#define PPU 64.0f
#define PITCH_DEG 20.0f
#define FOV_DEG 18.0f
#define GROUND_PX_BELOW_CENTRE 100.0f /* the centre lane's ground line, in scene pixels below the frame's centre */
#define LANE_EPS 0.004f

#define ACTOR_HALF 0.45f   /* half the width of an actor's silhouette, with a margin */
#define MOVE_PER_TICK 0.06f /* a player's walking speed: 3.6 units a second */
#define CAM_MIN_X 0.0f      /* the camera's x range: the street shows x -5 to 25 */
#define CAM_MAX_X 20.0f
#define CAM_MAX_STEP 0.3f   /* the most the camera moves in a tick */

#define NEON_INTENSITY 28.0f
#define AMBIENT_COLOR 0x7482a8 /* the legacy stage's fill; the street block's is in lights.json */
#define LIGHT_DISTANCE 14.0f
#define LIGHT_DECAY 2.0f

#if !NR_ARENA
static const uint32_t LIGHT_COLOR[LIGHTS] = { 0xff2bd6, 0x20e8ff, 0xffa020, 0xffffff };
#if NR_LIT_TEST == 0
static const float NEON_PERIOD[3] = { 120.0f, 240.0f, 360.0f };
static const float NEON_PHASE[3] = { 0.2617994f, 5.2359878f, 4.9741884f };
static const float NEON_AMP[3] = { 4.5f, 5.5f, 3.5f };
#endif
#endif

static struct {
  /* simulation (everything the hosts compare) */
  float pos[ACTORS][3];       /* x, lane, world z */
  int32_t clip[ACTORS];       /* clip index in the hero atlas */
  int32_t step[ACTORS];       /* frame within the clip */
  int32_t frame[ACTORS];      /* atlas frame */
  int32_t clip_tick[ACTORS];  /* ticks since the actor's clip started */
  float light_pos[LIGHTS][3];
  float light_intensity[LIGHTS];
  float cam_x;
  float cam_left;             /* the furthest the camera has scrolled: it never goes back past it */
  int32_t ticks, heroes, lights, players;
  uint32_t checksum;
  cw_action left, right, up, down;
  /* presentation */
  nr_atlas hero;
  arena ar;
  t3_renderer *renderer;
  t3_scene *scene;
  t3_camera *camera;
  t3_mesh *mesh[ACTORS];
  t3_light *light[LIGHTS];
  float pitch, view_dist, view_w, view_h;
  int32_t render_w, render_h;
  /* how the frame was sized, as the engine reported it: window, drawable and render size in render(), pixel scale */
  int32_t px[8];
  int32_t lit_test, flat_normals, arena_on, solids;
  /* program states three.c skipped (in no program table), published as the pipeline does */
  int32_t three_missing;
  char three_missing_states[1024];
} S;


/* ── camera ────────────────────────────────────────────────────────── */

/* The distance from the camera to the target at which one world unit is PPU scene pixels. */
static void init_camera_constants(void) {
  S.pitch = PITCH_DEG * 3.14159265f / 180.0f;
  float half_fov = FOV_DEG * 0.5f * 3.14159265f / 180.0f;
  float tan_half = cw_sin(half_fov) / cw_cos(half_fov);
  S.view_dist = ((float)SCENE_H / PPU) / (2.0f * tan_half);
}

#if NR_ARENA
static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

/* How far from the camera's x an actor on `lane` can stand with its whole silhouette in frame. The frame's half width
 * is SCENE_W / 2 / PPU units at the centre lane and scales with the distance from the camera at other lanes. */
static float view_half(float lane) {
  float depth = S.view_dist - lane * cw_cos(S.pitch);
  return ((float)SCENE_W / PPU * 0.5f) * depth / S.view_dist - ACTOR_HALF;
}
#endif

/* The belt camera: pitched down PITCH_DEG, FOV_DEG, at the distance where one world unit is PPU scene pixels; its
 * look-at point puts the centre lane's ground line GROUND_PX_BELOW_CENTRE pixels below the frame's centre */
static void place_camera(void) {
  float sp, cp;
  cw_sincos(S.pitch, &sp, &cp);
  float up_off = GROUND_PX_BELOW_CENTRE / PPU;
  float tx = S.cam_x, ty = up_off * cp, tz = -up_off * sp;
  t3_object_set_position(S.camera, tx, ty + S.view_dist * sp, tz + S.view_dist * cp);
  t3_object_look_at(S.camera, tx, ty, tz);
}

#if NR_ARENA
/* Follows the players' midpoint, holds every player in frame, never scrolls back. Every player is inside the current
 * frame when this runs, so the camera's range is never empty: it is limited by the trailing player (it cannot move on
 * past where that player would leave the frame), by the leader (it cannot move back past where that player would) and
 * by the furthest it has scrolled. */
static void step_camera(void) {
  float lo = S.cam_left > CAM_MIN_X ? S.cam_left : CAM_MIN_X, hi = CAM_MAX_X, mid = 0.0f;
  for (int i = 0; i < S.players; i++) {
    float h = view_half(S.pos[i][1]);
    if (S.pos[i][0] - h > lo) lo = S.pos[i][0] - h;
    if (S.pos[i][0] + h < hi) hi = S.pos[i][0] + h;
    mid += S.pos[i][0];
  }
  mid /= (float)S.players;
  float target = clampf(mid, lo, hi);
  S.cam_x += clampf(target - S.cam_x, -CAM_MAX_STEP, CAM_MAX_STEP);
  if (S.cam_x > S.cam_left) S.cam_left = S.cam_x;
}
#endif

/* ── simulation ────────────────────────────────────────────────────── */

static void sim_init(void) {
  S.heroes = ACTORS;
  S.lights = LIGHTS;
  S.players = PLAYERS;
  S.lit_test = NR_LIT_TEST;
  S.flat_normals = NR_FLAT_NORMALS;
  S.arena_on = NR_ARENA;
  S.checksum = CW_HASH32_INIT;
  S.cam_x = 0.0f;
  S.cam_left = 0.0f;
}

static void pose_actor(int i) {
  S.step[i] = nr_clip_step_at(&S.hero, S.clip[i], S.clip_tick[i]);
  S.frame[i] = S.hero.clips[S.clip[i]].first + S.step[i];
}

/* The poses before the first tick: every actor on its clip's first frame; the street block's patrol walks. */
static void initial_pose(void) {
  int idle = nr_clip_index(&S.hero, "idle"), walk = nr_clip_index(&S.hero, "walk");
  for (int i = 0; i < ACTORS; i++) {
    S.clip[i] = i == 3 && !NR_LIT_TEST ? walk : idle;
    S.clip_tick[i] = 0;
    pose_actor(i);
#if NR_ARENA
    S.pos[i][2] = arena_depth_z(&S.ar, S.pos[i][1], i);
#else
    S.pos[i][2] = S.pos[i][1] + (float)i * LANE_EPS;
#endif
  }
}

#if NR_ARENA

static void layout_actors(void) {
  /* players 0 and 1; actor 2 stands in front of the pillar, actor 3 patrols behind the play lane's front edge */
  static const float X[ACTORS] = { 0.0f, 0.0f, 11.7f, 2.0f };
  static const float LANE[ACTORS] = { 0.6f, -0.6f, 1.35f, -1.1f };
  for (int i = 0; i < ACTORS; i++) {
    S.pos[i][0] = X[i];
    S.pos[i][1] = LANE[i];
    S.clip[i] = nr_clip_index(&S.hero, "idle");
  }
}

static void set_clip(int i, int clip) {
  if (S.clip[i] != clip) S.clip_tick[i] = 0;
  S.clip[i] = clip;
}

/* A player moves with the d-pad or stick, slides along the pillar, and stays inside the arena. */
static void move_player(int p) {
  cw_vec2 mv = cw_input_vector(p, S.left, S.right, S.up, S.down, CW_DEADZONE_RADIAL, 0.2f);
  float x = S.pos[p][0], lane = S.pos[p][1];
  float nx = clampf(x + mv.x * MOVE_PER_TICK, S.ar.x_min, S.ar.x_max);
  if (!arena_blocked(&S.ar, nx, lane)) x = nx;
  float nl = clampf(lane + mv.y * MOVE_PER_TICK, S.ar.lane_min, S.ar.lane_max);
  if (!arena_blocked(&S.ar, x, nl)) lane = nl;
  S.pos[p][0] = x;
  S.pos[p][1] = lane;
}

/* Actor 3 patrols between x = 2 and x = 6 with period 200 ticks. */
static void step_patrol(int i) {
  int32_t t = S.ticks % 200, d = t < 100 ? t : 200 - t;
  S.pos[i][0] = 2.0f + 0.04f * (float)d;
}

static void sim_step(void) {
  float before[PLAYERS][2];
  for (int p = 0; p < PLAYERS; p++) {
    before[p][0] = S.pos[p][0];
    before[p][1] = S.pos[p][1];
    move_player(p);
  }
  step_patrol(3);
  /* no player stands past the edge of the frame it is in: the trailing player cannot walk off the left and the
   * leader stops at the right (the soft wall) until the camera, which follows the midpoint, moves on */
  for (int p = 0; p < PLAYERS; p++) {
    float h = view_half(S.pos[p][1]), x = clampf(S.pos[p][0], S.cam_x - h, S.cam_x + h);
    S.pos[p][0] = arena_blocked(&S.ar, x, S.pos[p][1]) ? before[p][0] : x;
  }
  step_camera();
  int idle = nr_clip_index(&S.hero, "idle"), walk = nr_clip_index(&S.hero, "walk");
  for (int i = 0; i < ACTORS; i++) {
    bool moving = i == 3 || (i < PLAYERS && (S.pos[i][0] != before[i][0] || S.pos[i][1] != before[i][1]));
    set_clip(i, moving ? walk : idle);
    S.clip_tick[i]++;
    pose_actor(i);
    S.pos[i][2] = arena_depth_z(&S.ar, S.pos[i][1], i);
  }
}

#else /* the look checkpoint's stage */

static void layout_actors(void) {
#if NR_LIT_TEST
  S.pos[0][0] = S.cam_x;
  S.pos[0][1] = 0.0f;
#else
  /* three heroes on one shared frame (they batch) at the belt's far left, centre and far right, and one walking on a
   * frame of its own, a lane nearer the camera */
  static const float X[ACTORS] = { -3.9f, 0.0f, 3.9f, 2.0f };
  static const float LANE[ACTORS] = { 0.0f, 0.0f, 0.0f, 0.9f };
  for (int i = 0; i < ACTORS; i++) {
    S.pos[i][0] = X[i];
    S.pos[i][1] = LANE[i];
  }
#endif
  for (int i = 0; i < ACTORS; i++) S.pos[i][2] = S.pos[i][1] + (float)i * LANE_EPS;
}

static void sim_step(void) {
  int idle = nr_clip_index(&S.hero, "idle"), walk = nr_clip_index(&S.hero, "walk");
  for (int i = 0; i < ACTORS; i++) {
    S.clip[i] = (!NR_LIT_TEST && i == 3) ? walk : idle;
    S.clip_tick[i] = S.ticks;
    S.step[i] = NR_LIT_TEST ? 0 : nr_clip_step_at(&S.hero, S.clip[i], S.clip_tick[i]);
    S.frame[i] = S.hero.clips[S.clip[i]].first + S.step[i];
  }
}

#endif

/* the lights by tick; cw_sincos is the deterministic sine */
static void lights_at(int32_t tick) {
#if NR_ARENA
  arena_lights_at(&S.ar, tick, S.cam_x, S.light_pos, S.light_intensity);
#else
  (void)tick; /* only the sweeping builds read it */
  for (int i = 0; i < LIGHTS; i++) S.light_intensity[i] = 0.0f;
#if NR_LIT_TEST == 1
  float s, c;
  cw_sincos(TWO_PI * (float)tick / 240.0f, &s, &c);
  S.light_pos[0][0] = S.cam_x + 2.4f * s;
  S.light_pos[0][1] = 1.0f;
  S.light_pos[0][2] = 2.0f;
  S.light_intensity[0] = 20.0f;
#elif NR_LIT_TEST == 2
  float s, c;
  cw_sincos(TWO_PI * (float)tick / 240.0f, &s, &c);
  S.light_pos[0][0] = S.cam_x;
  S.light_pos[0][1] = 1.0f + 2.2f * s;
  S.light_pos[0][2] = 1.8f;
  S.light_intensity[0] = 20.0f;
#elif NR_LIT_TEST >= 3
  S.light_pos[NR_LIT_TEST - 3][0] = S.cam_x - 1.6f;
  S.light_pos[NR_LIT_TEST - 3][1] = 1.4f;
  S.light_pos[NR_LIT_TEST - 3][2] = 1.8f;
  S.light_intensity[NR_LIT_TEST - 3] = 20.0f;
#else
  for (int i = 0; i < 3; i++) {
    float s, c;
    cw_sincos(TWO_PI * (float)tick / NEON_PERIOD[i] + NEON_PHASE[i], &s, &c);
    S.light_pos[i][0] = S.cam_x + NEON_AMP[i] * s;
    S.light_pos[i][1] = 2.4f + 0.3f * c;
    S.light_pos[i][2] = 2.4f + 0.4f * s;
    S.light_intensity[i] = NEON_INTENSITY;
  }
#endif
  for (int i = 0; i < LIGHTS; i++) {
    if (S.light_intensity[i] != 0.0f) continue; /* an idle slot rests at the hero's feet */
    S.light_pos[i][0] = S.cam_x;
    S.light_pos[i][1] = 1.2f;
    S.light_pos[i][2] = 1.8f;
  }
#endif
}

static void fixed_update(void *user, double dt) {
  (void)user, (void)dt;
  S.ticks++;
  sim_step();
  lights_at(S.ticks);
  int32_t scalars[4] = { S.ticks, S.heroes, S.lights, S.players };
  float cam[2] = { S.cam_x, S.cam_left };
  uint32_t h = S.checksum;
  h = cw_hash32(S.pos, sizeof S.pos, h);
  h = cw_hash32(S.clip, sizeof S.clip, h);
  h = cw_hash32(S.step, sizeof S.step, h);
  h = cw_hash32(S.light_pos, sizeof S.light_pos, h);
  h = cw_hash32(S.light_intensity, sizeof S.light_intensity, h);
  h = cw_hash32(cam, sizeof cam, h);
  h = cw_hash32(scalars, sizeof scalars, h);
  S.checksum = h;
}

/* ── scene ─────────────────────────────────────────────────────────── */

#if !NR_ARENA
static t3_material *standard_material(uint32_t color) {
  t3_material *m = t3_mesh_standard_material_new(color);
  m->metalness = 0.0f;
  m->roughness = 1.0f;
  return m;
}
#endif

static void build_scene(int w, int h) {
  S.renderer = cw_render3d_window_renderer(w, h);
  S.render_w = w;
  S.render_h = h;
  t3_renderer_set_clear_color(S.renderer, 0x0b0d16, 1.0f);
  S.scene = t3_scene_new();
  S.camera = t3_perspective_camera_new(FOV_DEG, (float)w / (float)h, 1.0f, 80.0f);
  place_camera();

#if NR_ARENA
  arena_build(&S.ar, S.scene, S.light);
  S.solids = S.ar.solid_count;
#else
  /* the street: drawn first and never in the depth buffer, so a hero's feet below its pivot are not cut by it */
  t3_material *ground_mat = standard_material(0x333847);
  ground_mat->depth_write = false;
  t3_mesh *ground = t3_mesh_new(t3_plane_geometry_new(30.0f, 9.0f, 1, 1), ground_mat);
  t3_object_set_rotation(ground, -1.5707963f, 0, 0);
  t3_object_set_position(ground, 0, 0, 0.5f);
  ground->base.render_order = -10;
  t3_object_add((t3_object *)S.scene, ground);
  t3_mesh *wall = t3_mesh_new(t3_plane_geometry_new(30.0f, 10.0f, 1, 1), standard_material(0x2a3050));
  t3_object_set_position(wall, 0, 4.2f, -3.0f);
  t3_object_add((t3_object *)S.scene, wall);

  t3_object_add((t3_object *)S.scene, t3_ambient_light_new(AMBIENT_COLOR, 1.0f));
  for (int i = 0; i < LIGHTS; i++) {
    S.light[i] = t3_point_light_new(LIGHT_COLOR[i], 1.0f, LIGHT_DISTANCE, LIGHT_DECAY);
    t3_object_add((t3_object *)S.scene, S.light[i]);
  }
#endif

  for (int i = 0; i < ACTORS; i++) {
    S.mesh[i] = t3_mesh_new(S.hero.geom[S.frame[i]], S.hero.material);
    t3_object_set_rotation(S.mesh[i], -S.pitch, 0, 0);
    S.mesh[i]->base.visible = !NR_NO_HEROES;
    t3_object_add((t3_object *)S.scene, S.mesh[i]);
  }
}

/* An actor's plane faces the camera; its centre sits where the pivot texel (the ground anchor) lands on the actor's
 * ground point: the pivot's offset from the cell centre, along the plane's right and up axes. */
static void sync_scene(void) {
  float sp, cp;
  cw_sincos(S.pitch, &sp, &cp);
  float right = (S.hero.cell_w * 0.5f - S.hero.pivot_x) / PPU;
  float up = (S.hero.pivot_y - S.hero.cell_h * 0.5f) / PPU;
  place_camera();
  for (int i = 0; i < ACTORS; i++) {
    S.mesh[i]->geometry = S.hero.geom[S.frame[i]];
    t3_object_set_position(S.mesh[i], S.pos[i][0] + right, up * cp, S.pos[i][2] - up * sp);
  }
  for (int i = 0; i < LIGHTS; i++) {
    t3_object_set_position(S.light[i], S.light_pos[i][0], S.light_pos[i][1], S.light_pos[i][2]);
    S.light[i]->intensity = S.light_intensity[i];
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
  if (n) cw_warn("nr: three.c skipped draws: %d program state(s) in no program table:\n%s", (int)n, m);
  S.three_missing = n;
  memset(S.three_missing_states, 0, sizeof S.three_missing_states);
  snprintf(S.three_missing_states, sizeof S.three_missing_states, "%s", m);
}

/* ── app ───────────────────────────────────────────────────────────── */

static void register_debug(void) {
  cw_debug_f32_array("nr.hero_pos", &S.pos[0][0], ACTORS * 3);
  cw_debug_field("nr.hero_clip", S.clip, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.hero_step", S.step, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.hero_frame", S.frame, CW_DBG_I32, ACTORS);
  cw_debug_f32_array("nr.light_pos", &S.light_pos[0][0], LIGHTS * 3);
  cw_debug_f32_array("nr.light_intensity", S.light_intensity, LIGHTS);
  cw_debug_f32("nr.cam_x", &S.cam_x);
  cw_debug_f32("nr.cam_left", &S.cam_left);
  cw_debug_i32("nr.heroes", &S.heroes);
  cw_debug_i32("nr.players", &S.players);
  cw_debug_i32("nr.lights", &S.lights);
  cw_debug_i32("nr.ticks", &S.ticks);
  cw_debug_u32("nr.checksum", &S.checksum);
  cw_debug_i32("nr.lit_test", &S.lit_test);
  cw_debug_i32("nr.flat_normals", &S.flat_normals);
  cw_debug_i32("nr.arena", &S.arena_on);
  cw_debug_i32("nr.solids", &S.solids);
  /* window w,h; drawable w,h and render size w,h as seen inside render(); pixel_scale in the app description */
  cw_debug_field("nr.px", S.px, CW_DBG_I32, 8);
  cw_debug_i32("cw.three.missing", &S.three_missing);
  cw_debug_bytes("cw.three.missing_states", S.three_missing_states, sizeof S.three_missing_states);
}

static void init(void *user) {
  (void)user;
  S.left = cw_action_add("move_left", 0.2f);
  S.right = cw_action_add("move_right", 0.2f);
  S.up = cw_action_add("move_up", 0.2f);
  S.down = cw_action_add("move_down", 0.2f);
  cw_action_bind_text(S.left, "key:left, pad:left, axis:lx-");
  cw_action_bind_text(S.right, "key:right, pad:right, axis:lx+");
  cw_action_bind_text(S.up, "key:up, pad:up, axis:ly-");
  cw_action_bind_text(S.down, "key:down, pad:down, axis:ly+");
  sim_init();
  init_camera_constants();
  if (!nr_atlas_load(&S.hero, "hero", PPU, NR_FLAT_NORMALS)) {
    cw_error("nr: the hero atlas did not load");
    return;
  }
#if NR_ARENA
  /* a standing actor's head recedes behind its ground point by its height times the sine of the plane's pitch */
  float reach = S.hero.pivot_y / PPU * cw_sin(S.pitch) + 0.03f;
  if (!arena_load(&S.ar, ACTOR_HALF, reach)) {
    cw_error("nr: the arena did not load");
    return;
  }
#endif
  layout_actors();
  lights_at(0);
  initial_pose();
  int w, h;
  cw_drawable_size(&w, &h);
  build_scene(w, h);
  S.px[6] = PIXEL_SCALE;
  register_debug();
}

static void render(void *user, double alpha) {
  (void)user, (void)alpha;
  if (!S.renderer) return;
  int dw, dh, rw, rh, ww, wh;
  cw_drawable_size(&dw, &dh);
  cw_render_size(&rw, &rh);
  cw_window_size(&ww, &wh);
  S.px[0] = ww; S.px[1] = wh; S.px[2] = dw; S.px[3] = dh; S.px[4] = rw; S.px[5] = rh;
  if (dw != S.render_w || dh != S.render_h) {
    t3_renderer_set_size(S.renderer, dw, dh);
    S.camera->aspect = (float)dw / (float)dh;
    t3_camera_update_projection_matrix(S.camera);
    S.render_w = dw;
    S.render_h = dh;
  }
  sync_scene();
  t3_renderer_reset_bindings(S.renderer);
  cw_render3d_window_target(S.renderer);
  t3_renderer_render(S.renderer, S.scene, S.camera);
  report_missing();
}

cw_app_desc cw_main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  return (cw_app_desc){
    .title = "nr",
    .width = DESIGN_W,
    .height = DESIGN_H,
    .pixel_scale = PIXEL_SCALE,
    .fixed_hz = 60,
    .init = init,
    .fixed_update = fixed_update,
    .render = render,
    .debug = true,
  };
}
