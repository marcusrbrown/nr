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
 * Simulation. sim.c owns the actors (two heroes and the test dummies), their states, hits, the leash and the camera;
 * this file feeds it each player's input, maps every actor's state to a clip and frame, and draws. An actor faces
 * left on a mirrored plane (anim.h: nr_atlas_geometry): the plane's tangent frame mirrors with the picture, so the
 * normal map still lights the side that faces the light.
 *
 * Controls (key / pad): move arrows / d-pad or left stick, attack Z / west, jump space / south, grab X / east,
 * special C / north, dash left shift / right shoulder; the special's dash variant is picked by holding V / left
 * shoulder with it.
 *
 * Builds (compile definitions):
 *   NR_STAGE_LEGACY: the look checkpoint's stage (a plain street, four fixed actors, no input); the lit-side and
 *     silhouette checks measure on it. NR_LIT_TEST implies it.
 *   NR_LIT_TEST: 0 = the street block; 1 = one hero held on one frame under a light that sweeps along x;
 *     2 = the same under a light that sweeps along y, above and below the hero; 3, 4, 5 = the same hero held under only
 *     neon light 0, 1 or 2, standing still to the hero's left.
 *   NR_LIT_FACE: -1 draws the legacy stage's actors facing left (the lit-side check of a mirrored plane).
 *   NR_NO_HEROES: the actors are not drawn; the control for measuring their silhouettes and for the ordering check.
 *   NR_FLAT_NORMALS: the actors' normal map is flat; the control build of the lit-side check.
 *   NR_REVERSE_DEPTH: the actors' depth mapping is inverted (arena.c); the control build of the ordering check.
 *
 * The state hosts compare (tick, every actor's position, jump, state and hp, the rng, lives, wave, camera, input count,
 * checksum) and the program states three.c skipped are published as debug fields (nr.*, cw.three.*). */
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
#include "sim.h"
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
#ifndef NR_LIT_FACE
#define NR_LIT_FACE 1
#endif
#define NR_ARENA (NR_LIT_TEST == 0 && NR_STAGE_LEGACY == 0)

#define NR_DUMMIES 7 /* the arena's test dummies: actors NR_PLAYERS .. */
#define ACTORS (NR_LIT_TEST ? 1 : NR_ARENA ? NR_PLAYERS + NR_DUMMIES : 4)
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
  /* what the hosts compare: the actors as the simulation (or the legacy stage) leaves them */
  float pos[ACTORS][3];       /* x, lane, world z */
  float actor_y[ACTORS];      /* height above the ground */
  float actor_vy[ACTORS];
  int32_t actor_state[ACTORS];
  int32_t actor_state_tick[ACTORS];
  int32_t actor_hp[ACTORS];
  int32_t actor_facing[ACTORS];
  int32_t actor_team[ACTORS];
  int32_t actor_invuln[ACTORS];
  int32_t clip[ACTORS];       /* clip index in the hero atlas */
  int32_t step[ACTORS];       /* frame within the clip */
  int32_t frame[ACTORS];      /* atlas frame */
  int32_t clip_tick[ACTORS];  /* ticks since the actor's clip started */
  float light_pos[LIGHTS][3];
  float light_intensity[LIGHTS];
  float cam_x;
  float cam_left;             /* the furthest the camera has scrolled: it never goes back past it */
  int32_t ticks, heroes, lights, players, input_count, wave, lives;
  uint32_t rng[4];
  uint32_t sim_checksum, checksum;
  int32_t demo;               /* set by a host: the combat script plays instead of the pads (demo_combat.inc) */
  int32_t events[NR_EVENT_CAP * NR_EVENT_FIELDS];
  int32_t event_count, events_dropped;
  cw_action left, right, up, down, attack, jump, grab, special, dash, special_alt;
  /* presentation */
  nr_sim sim;
  nr_view view;
  nr_atlas hero;
  int slot_clip[NR_HERO_CLIP_COUNT]; /* atlas clip index of each hero clip slot, -1 for a gap */
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

/* ── simulation ────────────────────────────────────────────────────── */

#if NR_ARENA

/* The clip an actor's state shows. `fixed` is a frame of the clip held for the whole state, FRAME_BY_TICK plays the clip
 * from the tick the state was entered, FRAME_LAST holds its last frame. The jump kick and the grab have no clip yet
 * (the owner hand-keys them): the jump kick shows the last frame of the jump, the grab the first frame of the idle. */
#define FRAME_BY_TICK -1
#define FRAME_LAST -2
typedef struct { int slot, fixed; } visual;
static const visual VISUAL[NR_ST_COUNT] = {
  [NR_ST_IDLE] = { NR_HERO_IDLE, FRAME_BY_TICK },
  [NR_ST_WALK] = { NR_HERO_WALK, FRAME_BY_TICK },
  [NR_ST_RUN] = { NR_HERO_RUN, FRAME_BY_TICK },
  [NR_ST_HIT1] = { NR_HERO_HIT1, FRAME_BY_TICK },
  [NR_ST_HIT2] = { NR_HERO_HIT2, FRAME_BY_TICK },
  [NR_ST_HIT3] = { NR_HERO_HIT3, FRAME_BY_TICK },
  [NR_ST_JUMP] = { NR_HERO_JUMP, FRAME_BY_TICK },
  [NR_ST_JUMPKICK] = { NR_HERO_JUMP, FRAME_LAST },
  [NR_ST_GRAB] = { NR_HERO_IDLE, 0 },
  [NR_ST_THROW] = { NR_HERO_THROW, FRAME_BY_TICK },
  [NR_ST_HURT] = { NR_HERO_HURT, FRAME_BY_TICK },
  [NR_ST_KNOCKDOWN] = { NR_HERO_KNOCKDOWN, FRAME_BY_TICK },
  [NR_ST_GETUP] = { NR_HERO_GETUP, FRAME_BY_TICK },
  [NR_ST_DASH] = { NR_HERO_DASH, FRAME_BY_TICK },
  [NR_ST_SPECIAL_KNOCKBACK] = { NR_HERO_SPECIAL_KNOCKBACK, FRAME_BY_TICK },
  [NR_ST_SPECIAL_DASH] = { NR_HERO_SPECIAL_DASH, FRAME_BY_TICK },
  [NR_ST_GRABBED] = { NR_HERO_HURT, 0 },
  [NR_ST_THROWN] = { NR_HERO_KNOCKDOWN, 1 },
  [NR_ST_DEAD] = { NR_HERO_KNOCKDOWN, FRAME_LAST },
};

#include "demo_combat.inc"
#define NR_DEMO_LOOP (NR_DEMO_TICKS + 120) /* the demo plays the script, rests two seconds and starts again */
#define DEMO_RIGHT 1
#define DEMO_LEFT 2
#define DEMO_UP 4
#define DEMO_DOWN 8
#define DEMO_ATTACK 16
#define DEMO_JUMP 32
#define DEMO_GRAB 64
#define DEMO_SPECIAL 128
#define DEMO_DASH 256
#define DEMO_ALT 512

/* The buttons the combat script holds for player `p` on engine frame `frame`; neutral before frame 1 and after the script. */
static uint16_t demo_buttons(int p, int32_t frame) {
  uint16_t held = 0;
  if (frame >= NR_DEMO_TICKS) return 0;
  for (size_t i = 0; i < sizeof NR_DEMO_COMBAT / sizeof NR_DEMO_COMBAT[0] && NR_DEMO_COMBAT[i].frame <= frame; i++)
    held = p == 0 ? NR_DEMO_COMBAT[i].p0 : NR_DEMO_COMBAT[i].p1;
  return held;
}

/* The same input read_input() makes from the pads, made from the script: the buttons held on this frame, and the edges
 * against the frame before. The sim's tick is `sim.ticks`, so the frame about to run is sim.ticks + 1. */
static void demo_input(int p, nr_input *in) {
  int32_t frame = S.sim.ticks + 1;
  uint16_t now = demo_buttons(p, frame), was = demo_buttons(p, frame - 1), edge = (uint16_t)(now & ~was);
  in->mx = (now & DEMO_RIGHT ? 1.0f : 0.0f) - (now & DEMO_LEFT ? 1.0f : 0.0f);
  in->my = (now & DEMO_DOWN ? 1.0f : 0.0f) - (now & DEMO_UP ? 1.0f : 0.0f);
  in->tap = edge & DEMO_RIGHT ? 1 : edge & DEMO_LEFT ? -1 : 0;
  in->attack = edge & DEMO_ATTACK;
  in->jump = edge & DEMO_JUMP;
  in->grab = edge & DEMO_GRAB;
  in->special = edge & DEMO_SPECIAL;
  in->dash = edge & DEMO_DASH;
  in->special_alt = now & DEMO_ALT;
  in->any = in->mx != 0.0f || in->my != 0.0f || in->tap != 0 || in->attack || in->jump || in->grab || in->special || in->dash;
}

/* A player's input for this tick, read from the engine's actions. */
static void read_input(int p, nr_input *in) {
  cw_vec2 mv = cw_input_vector(p, S.left, S.right, S.up, S.down, CW_DEADZONE_RADIAL, 0.2f);
  in->mx = mv.x;
  in->my = mv.y;
  in->tap = cw_action_just_pressed(p, S.right) ? 1 : cw_action_just_pressed(p, S.left) ? -1 : 0;
  in->attack = cw_action_just_pressed(p, S.attack);
  in->jump = cw_action_just_pressed(p, S.jump);
  in->grab = cw_action_just_pressed(p, S.grab);
  in->special = cw_action_just_pressed(p, S.special);
  in->dash = cw_action_just_pressed(p, S.dash);
  in->special_alt = cw_action_pressed(p, S.special_alt);
  in->any = mv.x != 0.0f || mv.y != 0.0f || in->tap != 0 || in->attack || in->jump || in->grab || in->special || in->dash;
}

/* The clip, frame and the published fields of actor i from the simulation. */
static void pose_actor(int i) {
  const nr_actor *a = &S.sim.actor[i];
  const visual *v = &VISUAL[a->state];
  int clip = S.slot_clip[v->slot];
  S.clip[i] = clip;
  S.clip_tick[i] = a->tick;
  S.step[i] = v->fixed >= 0 ? v->fixed : v->fixed == FRAME_LAST ? S.hero.clips[clip].count - 1 : nr_clip_step_at(&S.hero, clip, a->tick);
  S.frame[i] = S.hero.clips[clip].first + S.step[i];
  S.pos[i][0] = a->x;
  S.pos[i][1] = a->lane;
  S.pos[i][2] = arena_depth_z(&S.ar, a->lane, i);
  S.actor_y[i] = a->y;
  S.actor_vy[i] = a->vy;
  S.actor_state[i] = a->state;
  S.actor_state_tick[i] = a->tick;
  S.actor_hp[i] = a->hp;
  S.actor_facing[i] = a->facing;
  S.actor_team[i] = a->team;
  S.actor_invuln[i] = a->invuln;
}

static void publish_sim(void) {
  for (int i = 0; i < ACTORS; i++) pose_actor(i);
  S.ticks = S.sim.ticks;
  S.cam_x = S.sim.cam_x;
  S.cam_left = S.sim.cam_left;
  S.input_count = S.sim.input_count;
  S.wave = S.sim.wave;
  S.lives = S.sim.lives;
  memcpy(S.rng, S.sim.rng.s, sizeof S.rng);
  S.sim_checksum = S.sim.checksum;
  memcpy(S.events, S.sim.events, sizeof S.events);
  S.event_count = S.sim.event_count;
  S.events_dropped = S.sim.events_dropped;
}

/* The test dummies: stand-ins for enemies that stand still. Actor 2 stands in front of the pillar; 3 takes the combo
 * and the throw; 4 cannot be grabbed; 5 and 6 stand together for the radius special; 7 stands left of the street's
 * start, facing right, and swings on a schedule (a hit, a hit inside the invulnerability the first one gives, then a
 * knockdown) at whoever stands in its reach: only the combat script walks a player there; 8 and 2 stand on the dash
 * special's path. All but 7 face left. */
static void layout_dummies(void) {
  nr_sim_add_dummy(&S.sim, 11.7f, 1.35f, 99, true, -1);
  nr_sim_add_dummy(&S.sim, 2.4f, 0.6f, 12, true, -1);
  nr_sim_add_dummy(&S.sim, 5.2f, 0.6f, 12, false, -1);
  nr_sim_add_dummy(&S.sim, 8.0f, 0.6f, 12, true, -1);
  nr_sim_add_dummy(&S.sim, 9.6f, 0.4f, 12, true, -1);
  int striker = nr_sim_add_dummy(&S.sim, -3.4f, -0.6f, 99, true, 1);
  static const nr_strike STRIKES[] = { { 80, NR_ST_HIT1 }, { 110, NR_ST_HIT1 }, { 170, NR_ST_HIT3 } };
  nr_sim_set_strikes(&S.sim, striker, STRIKES, 3);
  nr_sim_add_dummy(&S.sim, 10.0f, 1.4f, 12, true, -1);
}

static void step_sim(void) {
  nr_input in[NR_PLAYERS];
  if (S.demo && S.sim.ticks >= NR_DEMO_LOOP) {
    nr_sim_init(&S.sim, &S.ar, S.view);
    layout_dummies();
  }
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (S.demo) demo_input(p, &in[p]);
    else read_input(p, &in[p]);
  }
  nr_sim_step(&S.sim, in);
  publish_sim();
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

static void step_sim(void) {
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
#if !NR_ARENA
  S.ticks++;
#endif
  step_sim();
  lights_at(S.ticks);
  int32_t scalars[4] = { S.ticks, S.heroes, S.lights, S.players };
  float cam[2] = { S.cam_x, S.cam_left };
  uint32_t h = S.checksum;
  h = cw_hash32(&S.sim_checksum, sizeof S.sim_checksum, h);
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
 * ground point: the pivot's offset from the cell centre, along the plane's right and up axes. An actor facing left has
 * the plane mirrored about its centre (x scale -1) and the pivot's offset mirrored with it; a jump lifts the plane
 * along the world's up axis. */
static void sync_scene(void) {
  float sp, cp;
  cw_sincos(S.pitch, &sp, &cp);
  float right = (S.hero.cell_w * 0.5f - S.hero.pivot_x) / PPU;
  float up = (S.hero.pivot_y - S.hero.cell_h * 0.5f) / PPU;
  place_camera();
  for (int i = 0; i < ACTORS; i++) {
    float face = S.actor_facing[i] < 0 ? -1.0f : 1.0f;
    S.mesh[i]->geometry = nr_atlas_geometry(&S.hero, S.frame[i], face < 0.0f);
    t3_object_set_position(S.mesh[i], S.pos[i][0] + right * face, S.actor_y[i] + up * cp, S.pos[i][2] - up * sp);
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
  cw_debug_f32_array("nr.actor_y", S.actor_y, ACTORS);
  cw_debug_f32_array("nr.actor_vy", S.actor_vy, ACTORS);
  cw_debug_field("nr.actor_state", S.actor_state, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_state_tick", S.actor_state_tick, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_hp", S.actor_hp, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_facing", S.actor_facing, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_team", S.actor_team, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_invuln", S.actor_invuln, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.rng", S.rng, CW_DBG_U32, 4);
  cw_debug_i32("nr.wave", &S.wave);
  cw_debug_i32("nr.lives", &S.lives);
  cw_debug_i32("nr.input_count", &S.input_count);
  cw_debug_i32("nr.demo", &S.demo);
  cw_debug_u32("nr.sim_checksum", &S.sim_checksum);
  cw_debug_field("nr.events", S.events, CW_DBG_I32, NR_EVENT_CAP * NR_EVENT_FIELDS);
  cw_debug_i32("nr.event_count", &S.event_count);
  cw_debug_i32("nr.events_dropped", &S.events_dropped);
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
  S.attack = cw_action_add("attack", 0.5f);
  S.jump = cw_action_add("jump", 0.5f);
  S.grab = cw_action_add("grab", 0.5f);
  S.special = cw_action_add("special", 0.5f);
  S.dash = cw_action_add("dash", 0.5f);
  S.special_alt = cw_action_add("special_alt", 0.5f);
  cw_action_bind_text(S.attack, "key:z, pad:west");
  cw_action_bind_text(S.jump, "key:space, pad:south");
  cw_action_bind_text(S.grab, "key:x, pad:east");
  cw_action_bind_text(S.special, "key:c, pad:north");
  cw_action_bind_text(S.dash, "key:left shift, pad:rshoulder");
  cw_action_bind_text(S.special_alt, "key:v, pad:lshoulder");
  S.heroes = ACTORS;
  S.lights = LIGHTS;
  S.players = NR_PLAYERS;
  S.lit_test = NR_LIT_TEST;
  S.flat_normals = NR_FLAT_NORMALS;
  S.arena_on = NR_ARENA;
  S.checksum = CW_HASH32_INIT;
  init_camera_constants();
  if (!nr_atlas_load(&S.hero, "hero", PPU, NR_FLAT_NORMALS)) {
    cw_error("nr: the hero atlas did not load");
    return;
  }
  for (int i = 0; i < ACTORS; i++) S.actor_facing[i] = NR_LIT_FACE; /* the sim sets the arena's actors' facing */
#if NR_ARENA
  /* a standing actor's head recedes behind its ground point by its height times the sine of the plane's pitch */
  float reach = S.hero.pivot_y / PPU * cw_sin(S.pitch) + 0.03f;
  if (!arena_load(&S.ar, ACTOR_HALF, reach)) {
    cw_error("nr: the arena did not load");
    return;
  }
  if (!nr_clips_resolve(&S.hero, nr_hero_clips, NR_HERO_CLIP_COUNT, S.slot_clip)) {
    cw_error("nr: the hero's clips do not match the atlas");
    return;
  }
  S.view = (nr_view){ ((float)SCENE_W / PPU) * 0.5f, S.view_dist, cw_cos(S.pitch), ACTOR_HALF };
  nr_sim_init(&S.sim, &S.ar, S.view);
  layout_dummies();
  publish_sim();
#else
  layout_actors();
  step_sim();
#endif
  lights_at(0);
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
