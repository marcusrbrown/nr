/* sim: the deterministic simulation: actors on the belt, their states, hit resolution, the leash and the camera.
 *
 * Nothing here draws, reads the engine's input or touches the clock. A tick (60 Hz) takes one nr_input per player and
 * changes the state; the same inputs give the same state on every host, and `checksum` rolls every field a tick can
 * change. Floats are used with -ffp-contract=off and only + - * / and sqrtf (IEEE-exact), as the rest of the game.
 *
 * World units as in arena.h: x along the street, `lane` the ground-y (a larger lane is nearer the camera), `y` the
 * height above the ground (a jump). An actor stands at (x, lane); its hurtbox is a box around that point.
 *
 * Teams. A hit lands only on an actor of the other team; a same-team overlap is logged and does nothing (no friendly
 * fire). Heroes are team 0 and actors 0 .. NR_PLAYERS - 1; every actor after them is an enemy, and the test dummy is
 * an enemy with no AI (it stands still, or swings on a schedule).
 *
 * States. Every state has a length in ticks, the tick of its first hit test (`startup`) and how many ticks it tests
 * (`active`); the rest is recovery. `tick` is the ticks since the state was entered: the tick a state is entered on is
 * tick 0. A press that is a chain (hit1 -> hit2 -> hit3) is taken on a recovery tick and enters the next state at once;
 * a press after the state ended starts hit1. A state set during hit resolution (a victim's) runs its tick 0 without
 * its movement.
 *
 * Event log. Every state entry and every hit, grab, throw, landing and skipped hit is appended to `events` as
 * { tick, kind, actor, a, b } (nr_event_kind) until the log is full; the checks read it. */
#ifndef NR_SIM_H
#define NR_SIM_H

#include <stdbool.h>
#include <stdint.h>

#include "arena.h"
#include "cartwheel/core.h"

#define NR_PLAYERS 2
#define NR_SIM_MAX_ACTORS 12
#define NR_MAX_STRIKES 4
#define NR_EVENT_CAP 512
#define NR_EVENT_FIELDS 5

typedef enum { NR_TEAM_HERO = 0, NR_TEAM_ENEMY = 1 } nr_team;

typedef enum {
  NR_ST_IDLE, NR_ST_WALK, NR_ST_RUN, NR_ST_HIT1, NR_ST_HIT2, NR_ST_HIT3, NR_ST_JUMP, NR_ST_JUMPKICK, NR_ST_GRAB,
  NR_ST_THROW, NR_ST_HURT, NR_ST_KNOCKDOWN, NR_ST_GETUP, NR_ST_DASH, NR_ST_SPECIAL_KNOCKBACK, NR_ST_SPECIAL_DASH,
  NR_ST_GRABBED, NR_ST_THROWN, NR_ST_DEAD, NR_ST_COUNT
} nr_state;

typedef enum {
  NR_EV_ENTER = 1,   /* actor entered state a */
  NR_EV_HIT,         /* actor hit a for b hp */
  NR_EV_GRAB,        /* actor grabbed a */
  NR_EV_GRAB_FAIL,   /* actor's grab found a, which cannot be grabbed */
  NR_EV_RELEASE,     /* actor threw a */
  NR_EV_LAND,        /* actor landed from a throw, taking a hp */
  NR_EV_SKIP_TEAM,   /* actor's attack overlapped a, a teammate */
  NR_EV_SKIP_INVULN, /* actor's attack overlapped a, which was invulnerable */
  NR_EV_DEAD         /* actor ran out of hp */
} nr_event_kind;

/* One player's input for a tick: the stick, the buttons that went down this tick, and `tap`, the direction (-1 left,
 * +1 right) of a d-pad or stick press that went down this tick. `special_alt` held with `special` picks the dash
 * variant. */
typedef struct {
  float mx, my;
  int8_t tap;
  bool attack, jump, grab, special, dash, special_alt, any;
} nr_input;

/* A scheduled swing of a test dummy: enter `state` (NR_ST_HIT1 or NR_ST_HIT3) on `tick`. */
typedef struct { int32_t tick, state; } nr_strike;

typedef struct {
  float x, lane, y, vy;            /* ground point, jump height and its velocity */
  float vx;                        /* the horizontal speed a jump or throw carries */
  float knock_x, knock_z;          /* knockback velocity at its start, units per tick */
  int32_t knock_left, knock_total; /* ticks of knockback left and its length; the velocity decays linearly to 0 */
  int32_t facing;                  /* +1 right, -1 left */
  int32_t state, tick;
  int32_t hp, invuln;
  int32_t team;
  int32_t hit_mask;                /* actors this state's attack has already met (bit per actor id) */
  int32_t holding, held_by;        /* a grab in progress: the actor held / the actor holding this one, or -1 */
  int32_t grabbable, present;
  int32_t variant;                 /* the special: 0 knockback, 1 dash */
  int32_t last_tap_dir, last_tap_tick, run_dir;
  int32_t strike_count;
  nr_strike strike[NR_MAX_STRIKES];
} nr_actor;

/* How the leash sees the frame: the half width of the frame at the centre lane in world units, the camera's distance
 * for one unit to be a pixel-per-unit scale, and the cosine of the camera's pitch (view_half() in sim.c). */
typedef struct { float half_width, distance, cos_pitch, actor_half; } nr_view;

typedef struct {
  const arena *arena;
  nr_view view;
  nr_actor actor[NR_SIM_MAX_ACTORS];
  int32_t actor_count;
  float cam_x, cam_left;
  cw_rng rng;
  int32_t ticks, input_count, wave, lives;
  uint32_t checksum;
  int32_t events[NR_EVENT_CAP][NR_EVENT_FIELDS];
  int32_t event_count, events_dropped;
} nr_sim;

/* Starts a simulation on `arena`: the players at their starts, no dummies. */
void nr_sim_init(nr_sim *s, const arena *arena, nr_view view);

/* Adds a test dummy (an enemy standing still) and returns its actor id, or -1 when the actor table is full. */
int nr_sim_add_dummy(nr_sim *s, float x, float lane, int32_t hp, bool grabbable, int32_t facing);

/* Schedules a dummy's swings; at most NR_MAX_STRIKES. */
void nr_sim_set_strikes(nr_sim *s, int actor, const nr_strike *strikes, int count);

/* One tick. */
void nr_sim_step(nr_sim *s, const nr_input input[NR_PLAYERS]);

/* The half width of the frame at `lane` less the actor's half width: how far from the camera an actor can stand. */
float nr_sim_view_half(const nr_sim *s, float lane);

/* The static description of a state: its name, length in ticks (0 until an event ends it), first hit-test tick and
 * number of hit-test ticks. */
typedef struct { const char *name; int32_t total, startup, active; } nr_state_info;
const nr_state_info *nr_state_info_of(int32_t state);

#endif
