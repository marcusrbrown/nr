/* nr: Neon Rebellion. This file is the look checkpoint of the combat slice: lit sprite heroes on a belt-scroll stage,
 * built natively and as a cart from one source.
 *
 * Presentation. The design frame is 1920x1080 with pixel_scale 3: the engine renders the scene at 640x360 and scales
 * it up 3x with nearest-neighbour. A hero is a plane that faces the belt camera (tilted by the camera's pitch), with
 * the frame's colour and plane-space normal texels mapped 1:1 onto scene pixels at the belt's centre lane, lit by four
 * point lights: three neon lights that sweep the street and one flash slot (intensity 0 until the special uses it),
 * so one program state (l0400) covers every frame. Actors stand at world (x, 0, lane + id * epsilon); a larger lane is
 * nearer the camera and wins the depth test, and equal lanes resolve to the greater id.
 *
 * NR_LIT_TEST (compile definition): 0 = the stage; 1 = one hero held on one frame under a light that sweeps along x;
 *   2 = the same under a light that sweeps along y, above and below the hero; 3, 4, 5 = the same hero held under only
 *   neon light 0, 1 or 2, standing still to the hero's left. The lit-side check builds 1 and 2, with and without
 *   NR_FLAT_NORMALS, and measures how the lit side follows the light.
 * NR_NO_HEROES (compile definition): the heroes are not drawn; the stage's control for measuring their silhouettes.
 * NR_FLAT_NORMALS (compile definition): the hero's normal map is flat; the control build of the lit-side check.
 *
 * The state hosts compare (tick, positions, clip steps, lights, checksum) and the program states three.c skipped are
 * published as debug fields (nr.*, cw.three.*). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "anim.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
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

#define HEROES (NR_LIT_TEST ? 1 : 4)
#define LIGHTS 4
#define FLASH_LIGHT 3
#define TWO_PI 6.2831853f

/* the belt camera, in world units; one unit is PPU scene pixels at the belt's centre lane */
#define DESIGN_W 1920
#define DESIGN_H 1080
#define PIXEL_SCALE 3
#define SCENE_H (DESIGN_H / PIXEL_SCALE)
#define PPU 64.0f
#define PITCH_DEG 20.0f
#define FOV_DEG 18.0f
#define GROUND_PX_BELOW_CENTRE 100.0f /* the centre lane's ground line, in scene pixels below the frame's centre */
#define LANE_EPS 0.004f

#define NEON_INTENSITY 28.0f
#define AMBIENT_COLOR 0x7482a8 /* the fill that lets a hero read between the neons; they still set the colour of the lit side */
#define LIGHT_DISTANCE 14.0f
#define LIGHT_DECAY 2.0f

static const uint32_t LIGHT_COLOR[LIGHTS] = { 0xff2bd6, 0x20e8ff, 0xffa020, 0xffffff };
#if NR_LIT_TEST == 0
static const float NEON_PERIOD[3] = { 120.0f, 240.0f, 360.0f };
static const float NEON_PHASE[3] = { 0.2617994f, 5.2359878f, 4.9741884f };
static const float NEON_AMP[3] = { 4.5f, 5.5f, 3.5f };
#endif

static struct {
  /* simulation (everything the hosts compare) */
  float pos[HEROES][3];       /* x, lane, world z */
  int32_t clip[HEROES];       /* clip index in the hero atlas */
  int32_t step[HEROES];       /* frame within the clip */
  int32_t frame[HEROES];      /* atlas frame */
  float light_pos[LIGHTS][3];
  float light_intensity[LIGHTS];
  float cam_x;
  int32_t ticks, heroes, lights;
  uint32_t checksum;
  /* presentation */
  nr_atlas hero;
  t3_renderer *renderer;
  t3_scene *scene;
  t3_camera *camera;
  t3_mesh *mesh[HEROES];
  t3_light *light[LIGHTS];
  float pitch, view_w, view_h;
  int32_t render_w, render_h;
  /* how the frame was sized, as the engine reported it: window, drawable and render size in render(), pixel scale */
  int32_t px[8];
  int32_t lit_test, flat_normals;
  /* program states three.c skipped (in no program table), published as the pipeline does */
  int32_t three_missing;
  char three_missing_states[1024];
} S;

/* ── simulation ────────────────────────────────────────────────────── */

static void layout_heroes(void) {
#if NR_LIT_TEST
  S.pos[0][0] = S.cam_x;
  S.pos[0][1] = 0.0f;
#else
  /* three heroes on one shared frame (they batch) at the belt's far left, centre and far right, and one walking on a
   * frame of its own, a lane nearer the camera */
  static const float X[HEROES] = { -3.9f, 0.0f, 3.9f, 2.0f };
  static const float LANE[HEROES] = { 0.0f, 0.0f, 0.0f, 0.9f };
  for (int i = 0; i < HEROES; i++) {
    S.pos[i][0] = X[i];
    S.pos[i][1] = LANE[i];
  }
#endif
  for (int i = 0; i < HEROES; i++) S.pos[i][2] = S.pos[i][1] + (float)i * LANE_EPS;
}

static void pose_heroes(int32_t tick) {
  int idle = nr_clip_index(&S.hero, "idle"), walk = nr_clip_index(&S.hero, "walk");
  for (int i = 0; i < HEROES; i++) {
    int clip = (!NR_LIT_TEST && i == 3) ? walk : idle;
    S.clip[i] = clip;
    S.step[i] = NR_LIT_TEST ? 0 : nr_clip_step_at(&S.hero, clip, tick);
    S.frame[i] = S.hero.clips[clip].first + S.step[i];
  }
}

/* the lights by tick; cw_sincos is the deterministic sine */
static void lights_at(int32_t tick) {
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
}

static void sim_init(void) {
  S.heroes = HEROES;
  S.lights = LIGHTS;
  S.lit_test = NR_LIT_TEST;
  S.flat_normals = NR_FLAT_NORMALS;
  S.checksum = CW_HASH32_INIT;
  S.cam_x = 0.0f;
}

static void fixed_update(void *user, double dt) {
  (void)user, (void)dt;
  S.ticks++;
  lights_at(S.ticks);
  pose_heroes(S.ticks);
  int32_t scalars[3] = { S.ticks, S.heroes, S.lights };
  uint32_t h = S.checksum;
  h = cw_hash32(S.pos, sizeof S.pos, h);
  h = cw_hash32(S.clip, sizeof S.clip, h);
  h = cw_hash32(S.step, sizeof S.step, h);
  h = cw_hash32(S.light_pos, sizeof S.light_pos, h);
  h = cw_hash32(S.light_intensity, sizeof S.light_intensity, h);
  h = cw_hash32(scalars, sizeof scalars, h);
  S.checksum = h;
}

/* ── scene ─────────────────────────────────────────────────────────── */

static t3_material *standard_material(uint32_t color) {
  t3_material *m = t3_mesh_standard_material_new(color);
  m->metalness = 0.0f;
  m->roughness = 1.0f;
  return m;
}

/* the belt camera: pitched down PITCH_DEG, FOV_DEG, at the distance where one world unit is PPU scene pixels; its
 * look-at point puts the centre lane's ground line GROUND_PX_BELOW_CENTRE pixels below the frame's centre */
static void place_camera(void) {
  float sp, cp, sf, cf;
  cw_sincos(S.pitch, &sp, &cp);
  (void)sf, (void)cf;
  float half_fov = FOV_DEG * 0.5f * 3.14159265f / 180.0f;
  float tan_half = cw_sin(half_fov) / cw_cos(half_fov);
  float dist = ((float)SCENE_H / PPU) / (2.0f * tan_half);
  float up_off = GROUND_PX_BELOW_CENTRE / PPU;
  float tx = S.cam_x, ty = up_off * cp, tz = -up_off * sp;
  t3_object_set_position(S.camera, tx, ty + dist * sp, tz + dist * cp);
  t3_object_look_at(S.camera, tx, ty, tz);
}

static void build_scene(int w, int h) {
  S.renderer = cw_render3d_window_renderer(w, h);
  S.render_w = w;
  S.render_h = h;
  t3_renderer_set_clear_color(S.renderer, 0x0b0d16, 1.0f);
  S.scene = t3_scene_new();
  S.pitch = PITCH_DEG * 3.14159265f / 180.0f;
  S.camera = t3_perspective_camera_new(FOV_DEG, (float)w / (float)h, 1.0f, 80.0f);
  place_camera();

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

  for (int i = 0; i < HEROES; i++) {
    S.mesh[i] = t3_mesh_new(S.hero.geom[S.frame[i]], S.hero.material);
    t3_object_set_rotation(S.mesh[i], -S.pitch, 0, 0);
    S.mesh[i]->base.visible = !NR_NO_HEROES;
    t3_object_add((t3_object *)S.scene, S.mesh[i]);
  }
}

/* A hero's plane faces the camera; its centre sits where the pivot texel (the ground anchor) lands on the actor's
 * ground point: the pivot's offset from the cell centre, along the plane's right and up axes. */
static void sync_scene(void) {
  float sp, cp;
  cw_sincos(S.pitch, &sp, &cp);
  float right = (S.hero.cell_w * 0.5f - S.hero.pivot_x) / PPU;
  float up = (S.hero.pivot_y - S.hero.cell_h * 0.5f) / PPU;
  for (int i = 0; i < HEROES; i++) {
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
  cw_debug_f32_array("nr.hero_pos", &S.pos[0][0], HEROES * 3);
  cw_debug_field("nr.hero_clip", S.clip, CW_DBG_I32, HEROES);
  cw_debug_field("nr.hero_step", S.step, CW_DBG_I32, HEROES);
  cw_debug_field("nr.hero_frame", S.frame, CW_DBG_I32, HEROES);
  cw_debug_f32_array("nr.light_pos", &S.light_pos[0][0], LIGHTS * 3);
  cw_debug_f32_array("nr.light_intensity", S.light_intensity, LIGHTS);
  cw_debug_f32("nr.cam_x", &S.cam_x);
  cw_debug_i32("nr.heroes", &S.heroes);
  cw_debug_i32("nr.lights", &S.lights);
  cw_debug_i32("nr.ticks", &S.ticks);
  cw_debug_u32("nr.checksum", &S.checksum);
  cw_debug_i32("nr.lit_test", &S.lit_test);
  cw_debug_i32("nr.flat_normals", &S.flat_normals);
  /* window w,h; drawable w,h and render size w,h as seen inside render(); pixel_scale in the app description */
  cw_debug_field("nr.px", S.px, CW_DBG_I32, 8);
  cw_debug_i32("cw.three.missing", &S.three_missing);
  cw_debug_bytes("cw.three.missing_states", S.three_missing_states, sizeof S.three_missing_states);
}

static void init(void *user) {
  (void)user;
  sim_init();
  if (!nr_atlas_load(&S.hero, "hero", PPU, NR_FLAT_NORMALS)) {
    cw_error("nr: the hero atlas did not load");
    return;
  }
  layout_heroes();
  lights_at(0);
  pose_heroes(0);
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
