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
 * Simulation. sim.c owns the actors (two heroes, then the grunts and heavies the waves spawn, or the test dummies),
 * their states, hits, lives, the leash and the camera; waves.c the spawn schedule. This file feeds the simulation each
 * player's input, maps every actor's state to its character's clip and frame, and draws: the hero, the grunt and the
 * heavy each have an atlas and a material (player 2's hero a second colour sheet over the same frames and normals, so the
 * two players wear the HUD's magenta and cyan), and an actor shows the plane of its own. An actor faces left on a mirrored
 * plane (anim.h: nr_atlas_geometry): the plane's tangent frame mirrors with the picture, so the normal map still lights
 * the side that faces the light.
 *
 * Controls (key / pad): move arrows / d-pad or left stick, attack Z / west, jump space / south, grab X / east,
 * special C / north, dash left shift / right shoulder, start Return / start, back Backspace / back.
 *   Title: start from a pad that has not joined joins its player (the keyboard and pad 0 are player 1, pad 1 player 2);
 *     start again from a player that is in begins the fight with the players that are in, 3 lives each in one pool.
 *   Fight: start from a pad that has not joined joins its player at the left edge of the camera's frame with 3 more
 *     lives; start from a pad that has joined does nothing.
 *   Upgrade (after wave 2): left picks the knockback special, right the dash, once a short grace period has passed; the first
 *     press wins and the lower port wins a tick both press on.
 *   Clear and game over: back returns to the title; start at game over is refused.
 * A pad that goes away leaves its hero idle and untouchable until it is back. The builds without a title (NR_NO_TITLE:
 * the Unit 6 scripts and the bots) decide the players on tick 30 from the pads connected then (NR_PRESENCE_TICKS).
 *
 * Self-play. `nr.demo` is a field a host sets: 1 plays the combat script of the test dummies' arena (demo_combat.inc), 2
 * hands both players to the bot below, which fights the waves (and, on a build with a title, joins, picks the dash with
 * player 2 and returns to the title). NR_BOT_MASK builds an app whose players are bots from the first tick.
 *
 * Builds (compile definitions):
 *   NR_DUMMIES: the street block with the test dummies (layout_dummies) in place of the waves: the combat checks.
 *   NR_BOT_MASK: the players (bit 0 player 0, bit 1 player 1) the bot plays from the first tick; NR_BOT_FOCUS makes a
 *     bot fight only the enemies that chase it.
 *   NR_LOOK: the street block with real grunts and a heavy that stand still (sim.passive) at three stations along the street, and
 *     the two players: the look gate's combat captures (input-look.json takes player 1 through a combo against the pillar, the
 *     radius special and the dash special). Plays on the combat checks' rules (hold_alt, no waves).
 *   NR_NO_TITLE: the fight begins on the first tick with no title, no upgrade pause and no HUD (the Unit 6 builds).
 *   NR_STAGE_LEGACY: the look checkpoint's stage (a plain street, four fixed actors, no input); the lit-side and
 *     silhouette checks measure on it. NR_LIT_TEST implies it.
 *   NR_LIT_TEST: 0 = the street block; 1 = one hero held on one frame under a light that sweeps along x;
 *     2 = the same under a light that sweeps along y, above and below the hero; 3, 4, 5 = the same hero held under only
 *     neon light 0, 1 or 2, standing still to the hero's left.
 *   NR_LIT_FACE: -1 draws the legacy stage's actors facing left (the lit-side check of a mirrored plane).
 *   NR_NO_HEROES: the actors are not drawn; the control for measuring their silhouettes and for the ordering check.
 *   NR_FLAT_NORMALS: the actors' normal map is flat; the control build of the lit-side check.
 *   NR_REVERSE_DEPTH: the actors' depth mapping is inverted (arena.c); the control build of the ordering check.
 *   NR_STRESS: the last wave's population with no waves and no title: 8 grunts, a heavy and both heroes (invulnerable, idle) on
 *     the street, every actor shown on a frame of its own that advances every 6 ticks, so each draws as its own non-instanced
 *     plane. The perf measurement scene.
 *   NR_PERF: reads one pixel back after every frame so each frame includes its GPU work, and publishes the wall time of every
 *     frame (nr.perf_ms); the measurement build, GL only, outside the simulation.
 *   NR_PERF_CONTROL: spins NR_PERF_CONTROL_MS per actor per frame in the render callback; the control build that must exceed
 *     the frame budget.
 *   NR_EXTRA_LIGHT: a fifth point light (intensity 0) is added to the scene, so every lit draw is an l0500 program state the
 *     table does not have (three.c draws a frame with fewer lights than a row's with that row, never one with more); the
 *     control build of the missing-state predicate.
 *
 * The state hosts compare (tick, phase, every actor's position, jump, state and hp, the rng, lives, wave, camera, input
 * count, the special, the sounds asked for, checksum) and the program states three.c skipped are published as debug
 * fields (nr.*, cw.three.*). The screens are ui.c, drawn with render2d over the 3D frame. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "anim.h"
#include "arena.h"
#include "cartwheel/audio.h"
#include "cartwheel/core.h"
#include "cartwheel/debug.h"
#if NR_PERF
#include "cartwheel/gl.h"
#endif
#include "cartwheel/input.h"
#include "cartwheel/math.h"
#include "cartwheel/platform.h"
#include "cartwheel/render2d.h"
#include "cartwheel/render3d.h"
#include "sim.h"
#include "three.h"
#include "ui.h"

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
#ifndef NR_DUMMIES
#define NR_DUMMIES 0
#endif
#ifndef NR_LOOK
#define NR_LOOK 0
#endif
#ifndef NR_BOT_MASK
#define NR_BOT_MASK 0
#endif
#ifndef NR_BOT_FOCUS
#define NR_BOT_FOCUS 0
#endif
#ifndef NR_NO_TITLE
#define NR_NO_TITLE 0
#endif
#ifndef NR_STRESS
#define NR_STRESS 0
#endif
#ifndef NR_PERF
#define NR_PERF 0
#endif
#ifndef NR_PERF_CONTROL
#define NR_PERF_CONTROL 0
#endif
#ifndef NR_PERF_CONTROL_MS
#define NR_PERF_CONTROL_MS 0.5
#endif
#ifndef NR_EXTRA_LIGHT
#define NR_EXTRA_LIGHT 0
#endif
#define NR_PERF_RING 1024
#define NR_ARENA (NR_LIT_TEST == 0 && NR_STAGE_LEGACY == 0)
#define NR_UI (NR_ARENA && !NR_DUMMIES && !NR_LOOK && !NR_NO_TITLE) /* the game: a title, the HUD, the upgrade pause, the end screens */

#define ACTORS (NR_LIT_TEST ? 1 : NR_ARENA ? NR_SIM_MAX_ACTORS : 4) /* the actors the state publishes */
#define CHARS 3 /* hero, grunt, heavy */
#define BOT_LOG 3072 /* bot input changes kept for the script generator */
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

#define ACTOR_HALF 0.45f   /* half the width an actor takes up on the street: blocks are widened by it (arena_load) */
/* The allowance of the camera's leash: how far the widest frame of a hero's clips reaches from its pivot, both facings
 * (1.19 units: special_dash, facing right; tests/reach-check.mjs measures the atlas), so a hero held inside the frame
 * has its whole silhouette inside it. */
#define CAMERA_ALLOWANCE 1.2f

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
  int32_t actor_kind[ACTORS];   /* nr_kind */
  int32_t actor_target[ACTORS]; /* the player an enemy chases, or -1 */
  int32_t actor_away[ACTORS];   /* a hero whose pad is disconnected */
  int32_t actor_present[ACTORS];
  int32_t clip[ACTORS];       /* clip index in the actor's own atlas */
  int32_t step[ACTORS];       /* frame within the clip */
  int32_t frame[ACTORS];      /* frame of the actor's atlas */
  int32_t clip_tick[ACTORS];  /* ticks since the actor's clip started */
  float light_pos[LIGHTS][3];
  float light_intensity[LIGHTS];
  float cam_x;
  float cam_left;             /* the furthest the camera has scrolled: it never goes back past it */
  int32_t ticks, heroes, lights, players, input_count, wave, lives;
  int32_t game_over, start_refused, upgrade_ready, cleared, wave_phase;
  int32_t phase, special_variant, pick_player, joins, ignored_starts;
  int32_t sfx_count[NR_SFX_COUNT], sfx_tick[NR_SFX_COUNT]; /* the sounds the simulation asked for: how many, and the tick of the last */
  int32_t sfx_seen[NR_SFX_COUNT], sfx_played[NR_SFX_COUNT], voice_created; /* what this host turned into voices: not compared between hosts */
  int32_t ui_atlas_pages, ui_glyphs_missing;
  uint32_t rng[4];
  uint32_t sim_checksum, checksum;
  int32_t demo;               /* set by a host: 1 plays the combat script (demo_combat.inc), 2 the bot */
  int32_t events[NR_EVENT_CAP * NR_EVENT_FIELDS];
  int32_t event_count, events_dropped;
#if NR_PERF
  float perf_ms[NR_PERF_RING]; /* wall ms from the end of one frame's render to the end of the next's */
  int32_t perf_n;
#endif
#if NR_BOT_MASK
  int32_t bot_log[BOT_LOG * 2]; /* { tick, mask of player 0 | mask of player 1 << 16 } at every tick a mask changed */
  int32_t bot_log_count;
#endif
  cw_action left, right, up, down, attack, jump, grab, special, dash, special_alt, start, back;
  cw_sound sound[NR_SFX_COUNT];
  bool audio_on;
  ui_state ui;
  /* presentation */
  nr_sim sim;
  nr_view view;
  nr_atlas atlas[CHARS];      /* hero, grunt, heavy */
  nr_atlas hero_p2;           /* the hero's colour sheet for player 2 (accent cyan; player 1's is magenta): the same frames and normals */
  int vclip[CHARS][NR_ST_COUNT]; /* the atlas clip each state shows, per character */
  arena ar;
  t3_renderer *renderer;
  t3_scene *scene;
  t3_camera *camera;
  t3_mesh *mesh[ACTORS][CHARS]; /* one plane per character for every actor; the one of the actor's character is shown */
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

#define HERO_ATLAS (S.atlas[0])


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

/* The clip an actor's state shows, per character. `fixed` is a frame of the clip held for the whole state, FRAME_BY_TICK
 * plays the clip from the tick the state was entered, FRAME_LAST holds its last frame. The jump kick and the grab have
 * no clip yet (the owner hand-keys them): the jump kick shows the last frame of the jump, the grab the first frame of
 * the idle. A state a character never enters shows its idle. A dead enemy lies on its last frame. */
#define FRAME_BY_TICK -1
#define FRAME_LAST -2
typedef struct { const char *clip; int fixed; } visual;
static const visual VIS_HERO[NR_ST_COUNT] = {
  [NR_ST_IDLE] = { "idle", FRAME_BY_TICK },
  [NR_ST_WALK] = { "walk", FRAME_BY_TICK },
  [NR_ST_RUN] = { "run", FRAME_BY_TICK },
  [NR_ST_HIT1] = { "hit1", FRAME_BY_TICK },
  [NR_ST_HIT2] = { "hit2", FRAME_BY_TICK },
  [NR_ST_HIT3] = { "hit3", FRAME_BY_TICK },
  [NR_ST_JUMP] = { "jump", FRAME_BY_TICK },
  [NR_ST_JUMPKICK] = { "jump", FRAME_LAST },
  [NR_ST_GRAB] = { "idle", 0 },
  [NR_ST_THROW] = { "throw", FRAME_BY_TICK },
  [NR_ST_HURT] = { "hurt", FRAME_BY_TICK },
  [NR_ST_KNOCKDOWN] = { "knockdown", FRAME_BY_TICK },
  [NR_ST_GETUP] = { "getup", FRAME_BY_TICK },
  [NR_ST_DASH] = { "dash", FRAME_BY_TICK },
  [NR_ST_SPECIAL_KNOCKBACK] = { "special_knockback", FRAME_BY_TICK },
  [NR_ST_SPECIAL_DASH] = { "special_dash", FRAME_BY_TICK },
  [NR_ST_GRABBED] = { "hurt", 0 },
  [NR_ST_THROWN] = { "knockdown", 1 },
  [NR_ST_DEAD] = { "knockdown", FRAME_LAST },
};
static const visual VIS_GRUNT[NR_ST_COUNT] = {
  [NR_ST_IDLE] = { "idle", FRAME_BY_TICK },
  [NR_ST_WALK] = { "walk", FRAME_BY_TICK },
  [NR_ST_ATTACK] = { "attack", FRAME_BY_TICK },
  [NR_ST_HURT] = { "hurt", FRAME_BY_TICK },
  [NR_ST_KNOCKDOWN] = { "knockdown", FRAME_BY_TICK },
  [NR_ST_GETUP] = { "getup", FRAME_BY_TICK },
  [NR_ST_GRABBED] = { "hurt", 0 },
  [NR_ST_THROWN] = { "knockdown", 1 },
  [NR_ST_DEAD] = { "knockdown", FRAME_LAST },
};
static const visual VIS_HEAVY[NR_ST_COUNT] = {
  [NR_ST_IDLE] = { "idle", FRAME_BY_TICK },
  [NR_ST_WALK] = { "walk", FRAME_BY_TICK },
  [NR_ST_HEAVY_ATTACK] = { "attack", FRAME_BY_TICK },
  [NR_ST_HURT] = { "hurt", FRAME_BY_TICK },
  [NR_ST_STAGGER] = { "stagger", FRAME_BY_TICK },
  [NR_ST_DEAD] = { "stagger", FRAME_LAST },
};
static const visual *const VIS[CHARS] = { VIS_HERO, VIS_GRUNT, VIS_HEAVY };

/* The character (atlas) an actor of `kind` is drawn with: the test dummy is a hero. */
static int char_of(int32_t kind) { return kind == NR_KIND_GRUNT ? 1 : kind == NR_KIND_HEAVY ? 2 : 0; }

/* The atlas clip of every state of every character, from the tables above; false when an atlas lacks a clip. */
static bool resolve_visuals(void) {
  bool ok = true;
  for (int c = 0; c < CHARS; c++) {
    int idle = nr_clip_index(&S.atlas[c], "idle");
    for (int st = 0; st < NR_ST_COUNT; st++) {
      const visual *v = &VIS[c][st];
      S.vclip[c][st] = v->clip ? nr_clip_index(&S.atlas[c], v->clip) : idle;
      if (S.vclip[c][st] < 0) {
        cw_error("nr: atlas %d has no clip '%s' for state %d", c, v->clip ? v->clip : "idle", st);
        ok = false;
      }
    }
  }
  return ok;
}

#include "demo_combat.inc"
#define NR_DEMO_LOOP (NR_DEMO_TICKS + 120) /* the demo plays the script, rests two seconds and starts again */
#define BTN_RIGHT 1
#define BTN_LEFT 2
#define BTN_UP 4
#define BTN_DOWN 8
#define BTN_ATTACK 16
#define BTN_JUMP 32
#define BTN_GRAB 64
#define BTN_SPECIAL 128
#define BTN_DASH 256
#define BTN_ALT 512
#define BTN_START 1024
#define BTN_BACK 2048
#define BOT_REST 300 /* ticks the bot's run rests after the arena is cleared or the game is over, before it starts again */

/* A player's input from the buttons held on this frame and on the frame before, as read_input() makes it from the
 * pads: the edges are the buttons that went down. A hand-made input has its pad plugged in. */
static void input_from_mask(uint16_t now, uint16_t was, nr_input *in) {
  uint16_t edge = (uint16_t)(now & ~was);
  in->mx = (now & BTN_RIGHT ? 1.0f : 0.0f) - (now & BTN_LEFT ? 1.0f : 0.0f);
  in->my = (now & BTN_DOWN ? 1.0f : 0.0f) - (now & BTN_UP ? 1.0f : 0.0f);
  in->tap = edge & BTN_RIGHT ? 1 : edge & BTN_LEFT ? -1 : 0;
  in->attack = edge & BTN_ATTACK;
  in->jump = edge & BTN_JUMP;
  in->grab = edge & BTN_GRAB;
  in->special = edge & BTN_SPECIAL;
  in->dash = edge & BTN_DASH;
  in->special_alt = now & BTN_ALT;
  in->start = edge & BTN_START;
  in->back = edge & BTN_BACK;
  in->connected = true;
  in->any = in->mx != 0.0f || in->my != 0.0f || in->tap != 0 || in->attack || in->jump || in->grab || in->special || in->dash;
}

/* The buttons the combat script holds for player `p` on engine frame `frame`; neutral before frame 1 and after the script. */
static uint16_t demo_buttons(int p, int32_t frame) {
  uint16_t held = 0;
  if (frame >= NR_DEMO_TICKS) return 0;
  for (size_t i = 0; i < sizeof NR_DEMO_COMBAT / sizeof NR_DEMO_COMBAT[0] && NR_DEMO_COMBAT[i].frame <= frame; i++)
    held = p == 0 ? NR_DEMO_COMBAT[i].p0 : NR_DEMO_COMBAT[i].p1;
  return held;
}

/* The combat script's input for this tick. The sim's tick is `sim.ticks`, so the frame about to run is sim.ticks + 1. */
static void demo_input(int p, nr_input *in) {
  int32_t frame = S.sim.ticks + 1;
  input_from_mask(demo_buttons(p, frame), demo_buttons(p, frame - 1), in);
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
  in->start = cw_action_just_pressed(p, S.start);
  in->back = cw_action_just_pressed(p, S.back);
  int pad = cw_input_player_pad(p);
  in->connected = p == 0 || (pad >= 0 && cw_input_raw()->pads[pad].connected);
  in->any = mv.x != 0.0f || mv.y != 0.0f || in->tap != 0 || in->attack || in->jump || in->grab || in->special || in->dash;
}

/* ── the bot ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/* A player that fights the waves: it walks up to the nearest enemy (the nearest that chases it with NR_BOT_FOCUS), turns
 * to it and chains hit1 to hit3 as the swings' recovery windows open, grabs a heavy once (it cannot be grabbed) and every
 * third grunt, uses the knockback special on a crowd or a heavy, and walks on to where the next wave appears when the
 * street is clear. It reads the simulation and chooses only one axis at a time, so its input is the same through the pad
 * path: the buttons it holds are logged and tests/gen-input-waves.mjs writes them out as input-waves.json. */
#define BOT_REACH_X 1.1f
#define BOT_REACH_Z 0.35f
#define BOT_SPECIAL_GAP 360
static struct {
  uint16_t mask[NR_PLAYERS], was[NR_PLAYERS];
  int32_t stuck[NR_PLAYERS], detour_until[NR_PLAYERS], detour_dir[NR_PLAYERS], special_ok[NR_PLAYERS];
  uint32_t grabbed[NR_PLAYERS]; /* bit per actor id the bot already tried to grab */
  float last_x[NR_PLAYERS];
} bot;

static bool bot_on(int p) { return (NR_BOT_MASK >> p) & 1 || S.demo == 2; }

static bool bot_free(const nr_actor *a) { return a->state == NR_ST_IDLE || a->state == NR_ST_WALK || a->state == NR_ST_RUN; }

/* The menus. On the title player 1 joins, player 2 joins and player 1 starts the fight again, 20 ticks apart; in the
 * upgrade pause player 2 (player 1 when it is alone) picks the dash a moment after the grace period; at clear and game over
 * player 1 presses back after BOT_REST ticks. Each press is held two ticks, so it is one edge. */
#define BOT_MENU_FIRST 20
#define BOT_MENU_GAP 20
#define BOT_PICK_DELAY 20
static bool bot_press_at(int32_t since, int32_t at) { return since >= at && since < at + 2; }

static uint16_t bot_menu(int p) {
  const nr_sim *s = &S.sim;
  int32_t since = s->ticks - s->phase_since;
  switch (s->phase) {
    case NR_PH_TITLE:
      if (p == 0 && (bot_press_at(since, BOT_MENU_FIRST) || bot_press_at(since, BOT_MENU_FIRST + 2 * BOT_MENU_GAP))) return BTN_START;
      if (p == 1 && bot_press_at(since, BOT_MENU_FIRST + BOT_MENU_GAP)) return BTN_START;
      return 0;
    case NR_PH_UPGRADE:
      if (p == (s->actor[1].present ? 1 : 0) && bot_press_at(since, NR_UPGRADE_GRACE + BOT_PICK_DELAY)) return BTN_RIGHT;
      return 0;
    default:
      return p == 0 && bot_press_at(since, BOT_REST) ? BTN_BACK : 0;
  }
}

static uint16_t bot_choose(int p) {
  const nr_sim *s = &S.sim;
  if (s->phase != NR_PH_FIGHT) return bot_menu(p);
  const nr_actor *me = &s->actor[p];
  if (!me->present || me->hp <= 0 || me->state == NR_ST_DEAD) return 0;
  for (int i = NR_PLAYERS; i < s->actor_count; i++)
    if (!s->actor[i].present || s->actor[i].hp <= 0) bot.grabbed[p] &= ~(1u << i);
  int best = -1, near = 0;
  float best_d = 0.0f;
  for (int i = NR_PLAYERS; i < s->actor_count; i++) {
    const nr_actor *e = &s->actor[i];
    if (!e->present || e->hp <= 0 || (e->kind != NR_KIND_GRUNT && e->kind != NR_KIND_HEAVY) || e->state == NR_ST_DEAD) continue;
    float dx = e->x - me->x, dz = e->lane - me->lane;
    if (dx * dx + dz * dz <= 5.76f) near++;
    if (NR_BOT_FOCUS && e->target != p) continue;
    float d = dx * dx + 4.0f * dz * dz;
    if (best < 0 || d < best_d) { best = i; best_d = d; }
  }
  bool detouring = s->ticks < bot.detour_until[p];
  uint16_t m = 0;
  if (best < 0) {
    /* nobody to fight: on to where the next wave appears */
    float goal = 2.0f + 3.5f * (float)s->waves.wave;
    if (!s->waves.cleared && me->x < goal) m = BTN_RIGHT;
  } else {
    const nr_actor *e = &s->actor[best];
    float dx = e->x - me->x, dz = e->lane - me->lane, adx = dx < 0.0f ? -dx : dx, adz = dz < 0.0f ? -dz : dz;
    uint16_t toward = dx >= 0.0f ? BTN_RIGHT : BTN_LEFT;
    bool heavy = e->kind == NR_KIND_HEAVY, in_reach = adx <= (heavy ? 1.3f : BOT_REACH_X) && adz <= BOT_REACH_Z;
    if (in_reach) {
      if (bot_free(me)) {
        bool try_grab = !((bot.grabbed[p] >> best) & 1) && (heavy || best % 3 == 0);
        if (try_grab) {
          m = (uint16_t)(toward | BTN_GRAB);
          bot.grabbed[p] |= 1u << best;
        } else if ((near >= 3 || (heavy && adx <= 2.0f)) && s->ticks >= bot.special_ok[p] && !(heavy && e->state == NR_ST_STAGGER)) {
          m = (uint16_t)(toward | BTN_SPECIAL);
          bot.special_ok[p] = s->ticks + BOT_SPECIAL_GAP;
        } else {
          m = (uint16_t)(toward | BTN_ATTACK);
        }
      } else if ((me->state == NR_ST_HIT1 || me->state == NR_ST_HIT2) && me->tick >= 14) {
        m = BTN_ATTACK;
      }
    } else {
      float ex = adx - BOT_REACH_X + 0.1f, ez = (adz - BOT_REACH_Z) * 1.5f;
      if (ex < 0.0f) ex = 0.0f;
      if (ez < 0.0f) ez = 0.0f;
      if (ex > ez) m = toward;
      else m = dz > 0.0f ? BTN_DOWN : BTN_UP;
    }
  }
  if (m & (BTN_LEFT | BTN_RIGHT) && !(m & (BTN_ATTACK | BTN_GRAB | BTN_SPECIAL))) {
    /* held against a block: walk round it for a while */
    float moved = me->x - bot.last_x[p];
    bot.stuck[p] = me->state == NR_ST_WALK && moved > -0.0001f && moved < 0.0001f ? bot.stuck[p] + 1 : 0;
    if (bot.stuck[p] >= 12) {
      bot.stuck[p] = 0;
      bot.detour_until[p] = s->ticks + 70;
      bot.detour_dir[p] = me->lane > 0.2f ? 1 : -1;
      detouring = true;
    }
  } else {
    bot.stuck[p] = 0;
  }
  bot.last_x[p] = me->x;
  if (detouring && !(m & (BTN_ATTACK | BTN_GRAB | BTN_SPECIAL))) m = bot.detour_dir[p] > 0 ? BTN_DOWN : BTN_UP; /* one axis at a time: a diagonal d-pad is normalised by the engine */
  return m;
}

/* The bot's input for player `p`; with the masks of both players known the tick is logged when either changed. */
static void bot_input(int p, nr_input *in) {
  /* the first tick is neutral: a host that loads the app consumes its first frame with no input */
  bot.mask[p] = S.sim.ticks == 0 ? 0 : bot_choose(p);
  input_from_mask(bot.mask[p], bot.was[p], in);
}

static void bot_commit(void) {
#if NR_BOT_MASK
  if ((bot.mask[0] != bot.was[0] || bot.mask[1] != bot.was[1]) && S.bot_log_count < BOT_LOG) {
    S.bot_log[S.bot_log_count * 2] = S.sim.ticks + 1;
    S.bot_log[S.bot_log_count * 2 + 1] = bot.mask[0] | (bot.mask[1] << 16);
    S.bot_log_count++;
  } else if (bot.mask[0] != bot.was[0] || bot.mask[1] != bot.was[1]) {
    S.bot_log_count++;
  }
#endif
  for (int p = 0; p < NR_PLAYERS; p++) bot.was[p] = bot.mask[p];
}

/* The clip, frame and the published fields of actor i from the simulation. */
static void pose_actor(int i) {
  const nr_actor *a = &S.sim.actor[i];
  int c = char_of(a->kind);
  const nr_atlas *at = &S.atlas[c];
  const visual *v = &VIS[c][a->state];
  int clip = S.vclip[c][a->state];
  S.clip[i] = clip;
  S.clip_tick[i] = a->tick;
  S.step[i] = v->clip == NULL ? nr_clip_step_at(at, clip, a->tick) : v->fixed >= 0 ? v->fixed : v->fixed == FRAME_LAST ? at->clips[clip].count - 1 : nr_clip_step_at(at, clip, a->tick);
  S.frame[i] = at->clips[clip].first + S.step[i];
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
  S.actor_kind[i] = a->kind;
  S.actor_target[i] = a->target;
  S.actor_away[i] = a->away;
  S.actor_present[i] = a->present;
}

#if NR_UI
/* What the screens show, from the simulation. */
static void fill_ui(void) {
  const nr_sim *s = &S.sim;
  ui_state *u = &S.ui;
  u->phase = s->phase;
  u->ticks = s->ticks;
  u->phase_ticks = s->ticks - s->phase_since;
  u->lives = s->lives;
  u->wave = s->waves.wave;
  u->wave_total = NR_WAVE_COUNT;
  for (int p = 0; p < NR_PLAYERS; p++) {
    u->present[p] = s->actor[p].present;
    u->away[p] = s->actor[p].away;
    u->hp[p] = s->actor[p].hp;
  }
  u->hp_max = NR_HERO_HP;
  u->variant = s->special_variant;
  u->upgrade_done = s->upgrade_done;
  u->pick_player = s->pick_player;
  u->grace_left = s->phase == NR_PH_UPGRADE && u->phase_ticks < NR_UPGRADE_GRACE ? NR_UPGRADE_GRACE - u->phase_ticks : 0;
}
#endif

static void publish_sim(void) {
  for (int i = 0; i < ACTORS; i++) pose_actor(i);
#if NR_STRESS
  /* every actor on a frame of its own atlas that no other actor of that atlas shows, moving on every 6 ticks */
  for (int i = 0; i < ACTORS; i++) {
    const nr_atlas *at = &S.atlas[char_of(S.sim.actor[i].kind)];
    S.frame[i] = (i * 3 + S.sim.ticks / 6) % at->frame_count;
  }
#endif
  S.ticks = S.sim.ticks;
  S.cam_x = S.sim.cam_x;
  S.cam_left = S.sim.cam_left;
  S.input_count = S.sim.input_count;
  S.wave = S.sim.wave;
  S.lives = S.sim.lives;
  S.players = S.sim.players;
  S.game_over = S.sim.game_over;
  S.start_refused = S.sim.start_refused;
  S.upgrade_ready = S.sim.waves.upgrade_ready;
  S.cleared = S.sim.waves.cleared;
  S.wave_phase = S.sim.waves.phase;
  S.phase = S.sim.phase;
  S.special_variant = S.sim.special_variant;
  S.pick_player = S.sim.pick_player;
  S.joins = S.sim.joins;
  S.ignored_starts = S.sim.ignored_starts;
  memcpy(S.sfx_count, S.sim.sfx_count, sizeof S.sfx_count);
  memcpy(S.sfx_tick, S.sim.sfx_tick, sizeof S.sfx_tick);
#if NR_UI
  fill_ui();
#endif
  memcpy(S.rng, S.sim.rng.s, sizeof S.rng);
  S.sim_checksum = S.sim.checksum;
  memcpy(S.events, S.sim.events, sizeof S.events);
  S.event_count = S.sim.event_count;
  S.events_dropped = S.sim.events_dropped;
}

#if NR_STRESS
/* The last wave's population: eight grunts spread across the frame and the heavy, a mix of lanes and sides. */
static void layout_stress(void) {
  static const float X[8] = { -4.2f, -3.0f, -1.8f, 1.9f, 3.0f, 4.2f, -0.6f, 0.9f };
  static const float LANE[8] = { -1.2f, 0.9f, -0.3f, 1.4f, -1.0f, 0.3f, 1.5f, -1.5f };
  for (int i = 0; i < 8; i++) nr_sim_spawn_enemy(&S.sim, NR_KIND_GRUNT, X[i], LANE[i]);
  nr_sim_spawn_enemy(&S.sim, NR_KIND_HEAVY, 2.4f, 0.0f);
}
#endif

/* The test dummies: stand-ins for enemies that stand still. Actor 2 stands in front of the pillar; 3 takes the combo
 * and the throw; 4 cannot be grabbed; 5 and 6 stand together for the radius special; 7 stands left of the street's
 * start, facing right, and swings on a schedule (a hit, a hit inside the invulnerability the first one gives, then a
 * knockdown) at whoever stands in its reach: only the combat script walks a player there; 8 and 2 stand on the dash
 * special's path. All but 7 face left. */
#if NR_DUMMIES
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
#endif

/* The look scene (NR_LOOK): real grunts and a heavy that stand still, facing the heroes (who come from the left). A grunt
 * keeps its two hit points unless the scene gives it more. Station 1 is the dash special's lane (two grunts and the heavy
 * in a file from the heroes' start); station 2 a crowd round one point for the radius special; station 3 a grunt a short
 * step from the pillar, which stops its knockback so a whole combo stays in contact (it has six hit points: the combo's
 * three hits take four). */
#if NR_LOOK
static void look_enemy(int32_t kind, float x, float lane, int32_t hp) {
  int id = nr_sim_spawn_enemy(&S.sim, kind, x, lane);
  if (id < 0) return;
  S.sim.actor[id].facing = -1;
  if (hp > 0) S.sim.actor[id].hp = hp;
}

static void layout_look(void) {
  look_enemy(NR_KIND_GRUNT, 1.7f, 0.6f, 0);
  look_enemy(NR_KIND_GRUNT, 3.0f, 0.5f, 0);
  look_enemy(NR_KIND_HEAVY, 5.2f, 0.5f, 0);
  look_enemy(NR_KIND_GRUNT, 5.9f, 0.9f, 0);
  look_enemy(NR_KIND_GRUNT, 6.2f, 0.1f, 0);
  look_enemy(NR_KIND_GRUNT, 5.6f, -0.3f, 0);
  look_enemy(NR_KIND_GRUNT, 10.3f, 0.45f, 6);
}
#endif

/* A fresh simulation: the street with the dummies (NR_DUMMIES), the look scene (NR_LOOK) or the waves. */
static void start_sim(void) {
  nr_sim_init(&S.sim, &S.ar, S.view);
#if NR_DUMMIES
  S.sim.waves_on = 0;
  S.sim.hold_alt = 1;
  layout_dummies();
#elif NR_LOOK
  S.sim.waves_on = 0;
  S.sim.hold_alt = 1;
  S.sim.passive = 1;
  layout_look();
#else
  S.sim.log_moves = 0;
#if NR_STRESS
  S.sim.waves_on = 0;
  layout_stress();
#endif
#if NR_UI
  nr_sim_enter_title(&S.sim);
#endif
#endif
  memset(&bot, 0, sizeof bot);
  memset(S.sfx_seen, 0, sizeof S.sfx_seen);
  S.checksum = CW_HASH32_INIT;
}

#if NR_UI
/* Back from clear or game over: a new run on the title. The tick counter goes on, so a host's frame count and the tick
 * stay the same number; the bot's schedule reads ticks since the phase began. */
static void restart_to_title(void) {
  int32_t ticks = S.sim.ticks, inputs = S.sim.input_count;
  start_sim();
  S.sim.ticks = ticks;
  S.sim.phase_since = ticks;
  S.sim.input_count = inputs;
}
#endif

/* The sounds the simulation asked for since the last tick become voices: one voice per kind per tick, however many events
 * of that kind the tick had. */
static void play_sfx(void) {
  for (int k = 0; k < NR_SFX_COUNT; k++) {
    if (S.sim.sfx_count[k] == S.sfx_seen[k]) continue;
    S.sfx_seen[k] = S.sim.sfx_count[k];
    S.sfx_played[k]++;
    if (S.audio_on && S.sound[k].id) {
      cw_voice v = cw_audio_play(S.sound[k], NULL);
      S.voice_created = v.id != 0;
    }
  }
}

static void step_sim(void) {
  nr_input in[NR_PLAYERS];
  static int32_t end_tick, demo_was;
  if (S.demo != demo_was) {
    /* a host turning the self-play on starts the street over: both players are bots from the first tick */
    if (S.demo == 2 && S.sim.ticks > 0) start_sim();
    demo_was = S.demo;
  }
  if (S.demo == 1 && NR_DUMMIES && S.sim.ticks >= NR_DEMO_LOOP) start_sim();
#if !NR_UI
  /* a build without a title starts the street again after the arena is cleared or the game is over; one with a title
   * has the bot press back */
  if (S.demo == 2 && (S.sim.game_over || S.sim.waves.cleared)) {
    if (!end_tick) end_tick = S.sim.ticks;
    if (S.sim.ticks - end_tick >= BOT_REST) {
      end_tick = 0;
      start_sim();
    }
  }
#else
  (void)end_tick;
#endif
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (NR_STRESS) {
      in[p] = (nr_input){ .connected = true }; /* both heroes stand idle, and nothing the enemies do can hurt them */
      S.sim.actor[p].invuln = 1000;
    } else if (S.demo == 1 && NR_DUMMIES) demo_input(p, &in[p]);
    else if (bot_on(p)) bot_input(p, &in[p]);
    else read_input(p, &in[p]);
  }
  bot_commit();
  nr_sim_step(&S.sim, in);
#if NR_UI
  if (S.sim.return_title) restart_to_title();
#endif
  play_sfx();
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
  int idle = nr_clip_index(&HERO_ATLAS, "idle"), walk = nr_clip_index(&HERO_ATLAS, "walk");
  for (int i = 0; i < ACTORS; i++) {
    S.clip[i] = (!NR_LIT_TEST && i == 3) ? walk : idle;
    S.clip_tick[i] = S.ticks;
    S.step[i] = NR_LIT_TEST ? 0 : nr_clip_step_at(&HERO_ATLAS, S.clip[i], S.clip_tick[i]);
    S.frame[i] = HERO_ATLAS.clips[S.clip[i]].first + S.step[i];
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

#if NR_PERF || NR_PERF_CONTROL
static double wall_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}
#endif

/* The character an actor is drawn with: the grunts and heavies of the street block have their own, everything else
 * (the heroes, the dummies, the legacy stage's actors) is the hero. */
static int char_of_actor(int i) {
#if NR_ARENA
  return char_of(S.actor_kind[i]);
#else
  (void)i;
  return 0;
#endif
}

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
#if NR_EXTRA_LIGHT
  t3_object_add((t3_object *)S.scene, t3_point_light_new(0xffffff, 0.0f, LIGHT_DISTANCE, LIGHT_DECAY));
#endif
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
    for (int c = 0; c < (NR_ARENA ? CHARS : 1); c++) {
      /* the players wear their HUD colours: player 2 (actor 1) draws with the hero's second colour sheet */
      t3_material *mat = NR_ARENA && c == 0 && i == 1 ? S.hero_p2.material : S.atlas[c].material;
      S.mesh[i][c] = t3_mesh_new(S.atlas[c].geom[c == char_of_actor(i) ? S.frame[i] : 0], mat);
      t3_object_set_rotation(S.mesh[i][c], -S.pitch, 0, 0);
      S.mesh[i][c]->base.visible = false;
      t3_object_add((t3_object *)S.scene, S.mesh[i][c]);
    }
  }
}

/* An actor's plane faces the camera; its centre sits where the pivot texel (the ground anchor) lands on the actor's
 * ground point: the pivot's offset from the cell centre, along the plane's right and up axes. An actor facing left has
 * the plane mirrored about its centre (x scale -1) and the pivot's offset mirrored with it; a jump lifts the plane
 * along the world's up axis. */
static void sync_scene(void) {
  float sp, cp;
  cw_sincos(S.pitch, &sp, &cp);
  place_camera();
  for (int i = 0; i < ACTORS; i++) {
#if NR_PERF_CONTROL
    for (double end = wall_ms() + NR_PERF_CONTROL_MS; wall_ms() < end;) {
    }
#endif
    int shown = char_of_actor(i);
    const nr_atlas *at = &S.atlas[shown];
    float right = ((float)at->cell_w * 0.5f - at->pivot_x) / PPU;
    float up = (at->pivot_y - (float)at->cell_h * 0.5f) / PPU;
    float face = S.actor_facing[i] < 0 ? -1.0f : 1.0f;
    for (int c = 0; c < (NR_ARENA ? CHARS : 1); c++) S.mesh[i][c]->base.visible = !NR_NO_HEROES && c == shown && S.actor_present[i];
    t3_mesh *m = S.mesh[i][shown];
    m->geometry = nr_atlas_geometry(at, S.frame[i], face < 0.0f);
    t3_object_set_position(m, S.pos[i][0] + right * face, S.actor_y[i] + up * cp, S.pos[i][2] - up * sp);
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
  cw_debug_field("nr.actor_kind", S.actor_kind, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_target", S.actor_target, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_away", S.actor_away, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.actor_present", S.actor_present, CW_DBG_I32, ACTORS);
  cw_debug_field("nr.rng", S.rng, CW_DBG_U32, 4);
  cw_debug_i32("nr.wave", &S.wave);
  cw_debug_i32("nr.lives", &S.lives);
  cw_debug_i32("nr.input_count", &S.input_count);
  cw_debug_i32("nr.game_over", &S.game_over);
  cw_debug_i32("nr.start_refused", &S.start_refused);
  cw_debug_i32("nr.upgrade_ready", &S.upgrade_ready);
  cw_debug_i32("nr.cleared", &S.cleared);
  cw_debug_i32("nr.wave_phase", &S.wave_phase);
  cw_debug_i32("nr.demo", &S.demo);
  cw_debug_i32("nr.phase", &S.phase);
  cw_debug_i32("nr.special_variant", &S.special_variant);
  cw_debug_i32("nr.pick_player", &S.pick_player);
  cw_debug_i32("nr.joins", &S.joins);
  cw_debug_i32("nr.ignored_starts", &S.ignored_starts);
  cw_debug_field("nr.sfx_count", S.sfx_count, CW_DBG_I32, NR_SFX_COUNT);
  cw_debug_field("nr.sfx_tick", S.sfx_tick, CW_DBG_I32, NR_SFX_COUNT);
  cw_debug_field("nr.sfx_played", S.sfx_played, CW_DBG_I32, NR_SFX_COUNT);
  cw_debug_i32("nr.voice_created", &S.voice_created);
  cw_debug_i32("nr.ui_atlas_pages", &S.ui_atlas_pages);
  cw_debug_i32("nr.ui_glyphs_missing", &S.ui_glyphs_missing);
  cw_debug_u32("nr.sim_checksum", &S.sim_checksum);
#if NR_PERF
  cw_debug_f32_array("nr.perf_ms", S.perf_ms, NR_PERF_RING);
  cw_debug_i32("nr.perf_n", &S.perf_n);
#endif
  cw_debug_field("nr.events", S.events, CW_DBG_I32, NR_EVENT_CAP * NR_EVENT_FIELDS);
  cw_debug_i32("nr.event_count", &S.event_count);
  cw_debug_i32("nr.events_dropped", &S.events_dropped);
#if NR_BOT_MASK
  cw_debug_field("nr.bot_log", S.bot_log, CW_DBG_I32, BOT_LOG * 2);
  cw_debug_i32("nr.bot_log_count", &S.bot_log_count);
#endif
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
#if NR_UI
  cw_r2d_debug_register("r2d");
#endif
}

#if NR_UI
/* One sample per sound the simulation asks for; a device that is not there leaves the sounds off, not the game. */
static void init_audio(void) {
  static const struct { const char *path; int voices; } SOUND[NR_SFX_COUNT] = {
    [NR_SFX_HIT] = { "audio/hit.wav", 3 }, [NR_SFX_GRAB] = { "audio/grab.wav", 2 }, [NR_SFX_SPECIAL] = { "audio/special.wav", 2 },
    [NR_SFX_HURT] = { "audio/hurt.wav", 3 }, [NR_SFX_CONFIRM] = { "audio/confirm.wav", 2 },
  };
  S.audio_on = cw_audio_init(NULL);
  if (!S.audio_on) return;
  for (int k = 0; k < NR_SFX_COUNT; k++)
    S.sound[k] = cw_sound_load(SOUND[k].path, &(cw_sound_desc){ .mode = CW_SOUND_SAMPLE, .max_voices = SOUND[k].voices });
}
#endif

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
  cw_action_bind_text(S.dash, "key:lshift, pad:rshoulder");
  S.start = cw_action_add("start", 0.5f);
  cw_action_bind_text(S.special_alt, "key:v, pad:lshoulder");
  cw_action_bind_text(S.start, "key:return, pad:start");
  S.back = cw_action_add("back", 0.5f);
  cw_action_bind_text(S.back, "key:backspace, pad:back");
  S.heroes = ACTORS;
  S.lights = LIGHTS;
  S.players = NR_PLAYERS;
  for (int i = 0; i < ACTORS; i++) {
    S.actor_present[i] = 1;
    S.actor_target[i] = -1;
  }
  S.lit_test = NR_LIT_TEST;
  S.flat_normals = NR_FLAT_NORMALS;
  S.arena_on = NR_ARENA;
  S.checksum = CW_HASH32_INIT;
  init_camera_constants();
  static const char *const ATLAS_NAME[CHARS] = { "hero", "grunt", "heavy" };
  for (int c = 0; c < (NR_ARENA ? CHARS : 1); c++) {
    if (!nr_atlas_load(&S.atlas[c], ATLAS_NAME[c], PPU, NR_FLAT_NORMALS)) {
      cw_error("nr: the %s atlas did not load", ATLAS_NAME[c]);
      return;
    }
  }
  for (int i = 0; i < ACTORS; i++) S.actor_facing[i] = NR_LIT_FACE; /* the sim sets the arena's actors' facing */
#if NR_ARENA
  if (!nr_atlas_variant(&S.hero_p2, &S.atlas[0], "atlases/hero-p2.png")) {
    cw_error("nr: the hero's second colour sheet did not load");
    return;
  }
  /* a standing actor's head recedes behind its ground point by its height times the sine of the plane's pitch */
  float reach = HERO_ATLAS.pivot_y / PPU * cw_sin(S.pitch) + 0.03f;
  if (!arena_load(&S.ar, ACTOR_HALF, reach)) {
    cw_error("nr: the arena did not load");
    return;
  }
  int slots[NR_HERO_CLIP_COUNT];
  if (!nr_clips_resolve(&S.atlas[0], nr_hero_clips, NR_HERO_CLIP_COUNT, slots) || !nr_clips_resolve(&S.atlas[1], nr_grunt_clips, NR_GRUNT_CLIP_COUNT, slots) ||
      !nr_clips_resolve(&S.atlas[2], nr_heavy_clips, NR_HEAVY_CLIP_COUNT, slots) || !resolve_visuals()) {
    cw_error("nr: a character's clips do not match its atlas");
    return;
  }
  S.view = (nr_view){ ((float)SCENE_W / PPU) * 0.5f, S.view_dist, cw_cos(S.pitch), CAMERA_ALLOWANCE };
#if NR_UI
  ui_init();
  init_audio();
#endif
  S.pick_player = -1;
  start_sim();
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
#if NR_UI
  ui_draw(&S.ui);
  S.ui_atlas_pages = ui_atlas_pages();
  S.ui_glyphs_missing = ui_glyphs_missing();
#endif
#if NR_PERF
  static double last;
  uint8_t px[4];
  glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
  double now = wall_ms();
  if (last > 0 && S.perf_n < NR_PERF_RING) S.perf_ms[S.perf_n++] = (float)(now - last);
  last = now;
#endif
}

static void update(void *user, double dt) {
  (void)user, (void)dt;
  if (S.audio_on) cw_audio_update();
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
    .update = update,
    .render = render,
    .debug = true,
  };
}
