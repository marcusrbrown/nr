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
 * fire). Heroes are team 0 and actors 0 .. NR_PLAYERS - 1; every actor after them is an enemy: a grunt, a heavy (both
 * spawned by the waves) or the test dummy, which has no AI (it stands still, or swings on a schedule).
 *
 * Players. A player is present when its pad is connected on tick NR_PRESENCE_TICKS (player 0 always is; every hero
 * stands on the street until then, so a pad the platform reports a frame or two late is not left out); the pool of
 * lives is NR_LIVES_PER_PLAYER for each present player. A hero whose hp runs out is knocked down and dies; each death takes
 * a life from the pool, and while lives remain the hero stands up at the left edge of the camera's frame after
 * NR_RESPAWN_DELAY ticks. When the pool is empty and no hero is alive or waiting to respawn the game is over: the
 * simulation stops advancing its actors (the tick counter and the checksum go on) and a start press is refused. A
 * hero whose pad is disconnected finishes the state it is in, then idles, and cannot be hit or targeted until the pad
 * is back; a grab it was holding is let go, and the camera and the leash ignore it.
 *
 * Enemies. A grunt (2 hp) and a heavy (NR_HEAVY_HP hp) chase the player they are assigned, swing when it is in reach,
 * walk round the arena's blocks and stay inside the camera's frame. Spawns alternate between the players that can be
 * targeted; an enemy whose target dies, disconnects or is gone takes the player with the fewest enemies. A heavy cannot
 * be grabbed, shrugs off a hit while it swings and is staggered (NR_ST_STAGGER) only by a special.
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
#include "waves.h"

#define NR_PLAYERS 2
#define NR_MAX_ENEMIES 9 /* the last wave: 8 grunts and a heavy */
#define NR_SIM_MAX_ACTORS (NR_PLAYERS + NR_MAX_ENEMIES)
#define NR_MAX_STRIKES 4
#define NR_EVENT_CAP 1536
#define NR_EVENT_FIELDS 5
#define NR_LIVES_PER_PLAYER 3
#define NR_RESPAWN_DELAY 90 /* ticks a dead hero lies before it stands up again */
#define NR_RESPAWN_INVULN 120
#define NR_PRESENCE_TICKS 30 /* the tick on which the players present are decided (the title's stand-in) */
#define NR_HERO_HP 12
#define NR_GRUNT_HP 2
#define NR_HEAVY_HP 16

typedef enum { NR_TEAM_HERO = 0, NR_TEAM_ENEMY = 1 } nr_team;
typedef enum { NR_KIND_HERO, NR_KIND_DUMMY, NR_KIND_GRUNT, NR_KIND_HEAVY, NR_KIND_COUNT } nr_kind;

typedef enum {
  NR_ST_IDLE, NR_ST_WALK, NR_ST_RUN, NR_ST_HIT1, NR_ST_HIT2, NR_ST_HIT3, NR_ST_JUMP, NR_ST_JUMPKICK, NR_ST_GRAB,
  NR_ST_THROW, NR_ST_HURT, NR_ST_KNOCKDOWN, NR_ST_GETUP, NR_ST_DASH, NR_ST_SPECIAL_KNOCKBACK, NR_ST_SPECIAL_DASH,
  NR_ST_GRABBED, NR_ST_THROWN, NR_ST_DEAD, NR_ST_ATTACK, NR_ST_HEAVY_ATTACK, NR_ST_STAGGER, NR_ST_COUNT
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
  NR_EV_DEAD,        /* actor ran out of hp */
  NR_EV_SPAWN,       /* actor (an enemy) appeared: a its kind, b the player it targets (-1 none) */
  NR_EV_RETARGET,    /* actor now targets player a (-1 none) */
  NR_EV_WAVE_BEGIN,  /* wave a began (actor -1) */
  NR_EV_WAVE_END,    /* wave a ended: its last enemy died (actor -1) */
  NR_EV_UPGRADE,     /* wave 2 ended: the upgrade flag is set (actor -1) */
  NR_EV_CLEAR,       /* the last wave ended (actor -1) */
  NR_EV_LIFE_LOST,   /* hero actor died: a lives left in the pool, b 1 when it will stand up again */
  NR_EV_RESPAWN,     /* hero actor stood up at x a / 1000, lane b / 1000 */
  NR_EV_GAME_OVER,   /* the pool is empty and no hero is alive (actor -1) */
  NR_EV_AWAY,        /* hero actor's pad: a 1 disconnected, 0 back */
  NR_EV_START_REFUSED, /* a start press at game over (actor = player) */
  NR_EV_STAGGER      /* actor (a heavy) was staggered by a special of a */
} nr_event_kind;

/* One player's input for a tick: the stick, the buttons that went down this tick, and `tap`, the direction (-1 left,
 * +1 right) of a d-pad or stick press that went down this tick. `special_alt` held with `special` picks the dash
 * variant. */
typedef struct {
  float mx, my;
  int8_t tap;
  bool attack, jump, grab, special, dash, special_alt, start, any;
  bool connected; /* the player's pad is plugged in (player 0 always is: the keyboard plays) */
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
  int32_t kind;                    /* nr_kind */
  int32_t target;                  /* an enemy's player (actor id), or -1 */
  int32_t away;                    /* a hero whose pad is disconnected */
  int32_t respawn;                 /* a dead hero: it will stand up again */
  int32_t ai_wait;                 /* an enemy: ticks until it may swing again */
  int32_t flinch_wait;             /* a heavy: ticks until a hit flinches it again */
  int32_t detour;                  /* an enemy: -1 / +1 the lane direction it walks to get round a block, 0 none */
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
  nr_waves waves;
  int32_t ticks, input_count, wave, lives;
  int32_t players;                 /* present on tick NR_PRESENCE_TICKS (both until then) */
  int32_t waves_on;                /* the waves spawn enemies (off for the test dummies' arena) */
  int32_t game_over, start_refused;
  int32_t log_moves;               /* log a hero's walk, run and idle-after-walk entries too */
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

/* Spawns a grunt or a heavy (NR_KIND_GRUNT, NR_KIND_HEAVY) at (x, lane), facing the middle of the frame, in the first
 * free enemy slot; the player it targets is the next in the wave's alternation. Returns its actor id, or -1 when
 * there is no free slot. Used by the waves. */
int nr_sim_spawn_enemy(nr_sim *s, int32_t kind, float x, float lane);

/* Appends an event to the log (the waves use it). */
void nr_sim_log(nr_sim *s, int32_t kind, int32_t actor, int32_t a, int32_t b);

/* One tick of the spawn schedule (waves.c), run at the end of nr_sim_step while `waves_on` is set. */
void nr_waves_step(nr_sim *s);

/* Enemies of the waves (grunts and heavies) that are standing: present with hp left. */
int nr_sim_enemies_alive(const nr_sim *s);

/* One tick. */
void nr_sim_step(nr_sim *s, const nr_input input[NR_PLAYERS]);

/* The half width of the frame at `lane` less the actor's half width: how far from the camera an actor can stand. */
float nr_sim_view_half(const nr_sim *s, float lane);

/* The static description of a state: its name, length in ticks (0 until an event ends it), first hit-test tick and
 * number of hit-test ticks. */
typedef struct { const char *name; int32_t total, startup, active; } nr_state_info;
const nr_state_info *nr_state_info_of(int32_t state);

#endif
