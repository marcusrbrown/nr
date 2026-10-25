/* sim: the deterministic simulation. See sim.h. */
#include "sim.h"

#include <math.h>
#include <string.h>

#include "cartwheel/math.h"

/* ── numbers ───────────────────────────────────────────────────────────────────────────────────────────────────── */

#define WALK_SPEED 0.06f     /* a hero's walk: 3.6 units a second */
#define RUN_SPEED 0.11f
#define RUN_WINDOW 14        /* ticks between two presses of one direction that make a run */
#define AIR_LANE_SPEED 0.03f /* lane control in the air */
#define DASH_SPEED 0.2f
#define DASH_FROM 3          /* the dash moves on ticks DASH_FROM .. DASH_TO - 1 */
#define DASH_TO 16
#define SPECIAL_DASH_SPEED 0.3f /* the dash special: 15 ticks at 0.3 = 4.5 units */
#define JUMP_VY 0.13f
#define GRAVITY 0.0076f      /* a jump lasts 36 ticks: the length of the jump clip */
#define KICK_FROM 4          /* a jump kick can start from this tick of a jump */
#define THROW_RELEASE 10     /* the tick of the throw state on which the held actor leaves the hands */
#define THROW_VX 0.10f
#define THROW_VY 0.11f
#define THROW_GRAVITY 0.0074f
#define THROW_DAMAGE 2
#define HOLD_REACH 0.8f      /* a held actor's distance in front of its holder */
#define HOLD_HEIGHT 0.4f
#define HURT_HALF_X 0.35f    /* the hurtbox: half width, half depth in lanes, height */
#define HURT_HALF_LANE 0.3f
#define HURT_HEIGHT 2.0f
#define HERO_INVULN 60       /* action2d's invulnerability after a hit */
#define CAM_MIN_X 0.0f
#define CAM_MAX_X 20.0f
#define CAM_MAX_STEP 0.3f
#define RESPAWN_MARGIN 0.4f  /* a hero stands up this far inside the left edge of the frame */
#define ENEMY_LINGER 40      /* ticks a dead enemy lies before it is gone */
#define HEAVY_FLINCH_WAIT 120 /* ticks after a heavy flinches before a hit flinches it again */
#define HEAVY_KNOCK_SHARE 0.5f /* a heavy is pushed this share of what a special pushes a grunt */
#define AI_LANE_SPREAD 0.25f /* enemies stand this far apart in lane round their target */
#define AI_LANE_SETTLE 0.05f

/* ── the state table ───────────────────────────────────────────────────────────────────────────────────────────── */

typedef enum { SHAPE_NONE, SHAPE_BOX, SHAPE_RADIUS } shape;

typedef struct {
  nr_state_info info;
  shape shape;
  float x0, x1;       /* a box: its reach in front of the actor, x0 .. x1 (mirrored with facing); a radius: x1 */
  float half_lane;    /* half the box's depth in lanes */
  float y0, y1;       /* height range above the actor's feet */
  int32_t damage;
  bool knocks_down;
  float knock;        /* the victim's knockback speed at its start, units per tick */
  int32_t knock_ticks;
  int32_t next;       /* the state a press during recovery chains to, or -1 */
} state_def;

/* Lengths follow the clips: ticks = frames * ms * 60 / 1000 (hit1 6 x 60 ms = 21.6, hit3 7 x 60 = 25.2, throw 6 x 80 =
 * 28.8, hurt 4 x 80 = 19.2, knockdown 8 x 90 = 43.2, getup 6 x 90 = 32.4, dash 6 x 70 = 25.2, special_knockback 9 x 70 =
 * 37.8, special_dash 8 x 60 = 28.8; the grunt's attack 5 x 70 = 21, the heavy's 8 x 130 = 62.4). A melee swing tests
 * for 9 ticks and its state is 18 ticks of cooldown past the startup, as in action2d. An enemy's swing is shorter or
 * slower by its clip: the grunt's tests for 4 ticks from tick 8, the heavy's for 6 from tick 24 (the hook's
 * extension). The grunt's knockdown and getup, which play their own clips, run as long as the hero's (the clips are
 * 5 x 144 = 720 ms and 4 x 135 = 540 ms). The heavy's stagger holds the last pose of its clip for the rest of 60 ticks. */
static const state_def DEF[NR_ST_COUNT] = {
  [NR_ST_IDLE] = { { "idle", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_WALK] = { { "walk", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_RUN] = { { "run", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_HIT1] = { { "hit1", 22, 4, 9 }, SHAPE_BOX, 0.2f, 1.3f, 0.3f, 0.7f, 1.9f, 1, false, 0.06f, 6, NR_ST_HIT2 },
  [NR_ST_HIT2] = { { "hit2", 22, 4, 9 }, SHAPE_BOX, 0.2f, 1.3f, 0.3f, 0.7f, 1.9f, 1, false, 0.06f, 6, NR_ST_HIT3 },
  [NR_ST_HIT3] = { { "hit3", 25, 4, 9 }, SHAPE_BOX, 0.2f, 1.5f, 0.3f, 0.7f, 1.9f, 2, true, 0.18f, 12, -1 },
  [NR_ST_JUMP] = { { "jump", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_JUMPKICK] = { { "jumpkick", 0, 2, 255 }, SHAPE_BOX, 0.1f, 1.1f, 0.3f, 0.0f, 1.2f, 2, false, 0.16f, 10, -1 },
  [NR_ST_GRAB] = { { "grab", 20, 6, 4 }, SHAPE_NONE, 0.1f, 1.1f, 0.3f, 0.0f, 2.0f, 0, false, 0, 0, -1 },
  [NR_ST_THROW] = { { "throw", 29, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_HURT] = { { "hurt", 19, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_KNOCKDOWN] = { { "knockdown", 43, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_GETUP] = { { "getup", 32, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_DASH] = { { "dash", 25, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_SPECIAL_KNOCKBACK] = { { "special_knockback", 38, 12, 4 }, SHAPE_RADIUS, 0, 2.4f, 0, 0.0f, 2.2f, 1, false, 0.28f, 14, -1 },
  [NR_ST_SPECIAL_DASH] = { { "special_dash", 29, 6, 15 }, SHAPE_BOX, -0.3f, 1.0f, 0.3f, 0.0f, 1.9f, 2, false, 0.2f, 10, -1 },
  [NR_ST_GRABBED] = { { "grabbed", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_THROWN] = { { "thrown", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_DEAD] = { { "dead", 0, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
  [NR_ST_ATTACK] = { { "attack", 21, 8, 4 }, SHAPE_BOX, 0.2f, 1.2f, 0.4f, 0.0f, 1.9f, 1, false, 0.05f, 6, -1 },
  [NR_ST_HEAVY_ATTACK] = { { "heavy_attack", 62, 24, 6 }, SHAPE_BOX, 0.2f, 1.7f, 0.45f, 0.0f, 2.1f, 3, true, 0.2f, 12, -1 },
  [NR_ST_STAGGER] = { { "stagger", 60, 0, 0 }, SHAPE_NONE, 0, 0, 0, 0, 0, 0, false, 0, 0, -1 },
};

const nr_state_info *nr_state_info_of(int32_t state) { return state >= 0 && state < NR_ST_COUNT ? &DEF[state].info : NULL; }

/* The enemies' numbers: how fast they walk along the street and across the lanes, how close they stand, how near they
 * must be to swing (along x and across lanes), the ticks before the next swing and the swing's state. */
typedef struct {
  int32_t hp;
  float speed_x, speed_z, standoff, reach_x, reach_z;
  int32_t cooldown, swing;
} enemy_def;

static const enemy_def ENEMY[NR_KIND_COUNT] = {
  [NR_KIND_GRUNT] = { NR_GRUNT_HP, 0.045f, 0.03f, 0.9f, 1.05f, 0.4f, 80, NR_ST_ATTACK },
  [NR_KIND_HEAVY] = { NR_HEAVY_HP, 0.025f, 0.018f, 1.25f, 1.5f, 0.45f, 130, NR_ST_HEAVY_ATTACK },
};

/* ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────── */

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static float absf(float v) { return v < 0.0f ? -v : v; }
static int32_t milli(float v) { return (int32_t)(v >= 0.0f ? v * 1000.0f + 0.5f : v * 1000.0f - 0.5f); }

static bool is_hero(const nr_actor *a) { return a->kind == NR_KIND_HERO; }
static bool is_wave_enemy(const nr_actor *a) { return a->present && (a->kind == NR_KIND_GRUNT || a->kind == NR_KIND_HEAVY); }

static void sfx(nr_sim *s, nr_sfx kind) {
  s->sfx_count[kind]++;
  s->sfx_tick[kind] = s->ticks;
}

/* The sound an event asks for, counted whether or not the log has room for the event. */
static void sfx_of_event(nr_sim *s, int32_t kind, int32_t actor, int32_t a) {
  switch (kind) {
    case NR_EV_HIT: sfx(s, s->actor[a].kind == NR_KIND_HERO ? NR_SFX_HURT : NR_SFX_HIT); break;
    case NR_EV_LAND: sfx(s, NR_SFX_HIT); break;
    case NR_EV_GRAB: case NR_EV_RELEASE: sfx(s, NR_SFX_GRAB); break;
    case NR_EV_ENTER: if (a == NR_ST_SPECIAL_KNOCKBACK || a == NR_ST_SPECIAL_DASH) sfx(s, NR_SFX_SPECIAL); break;
    case NR_EV_JOIN: case NR_EV_BEGIN: case NR_EV_PICK: sfx(s, NR_SFX_CONFIRM); break;
    default: break;
  }
  (void)actor;
}

static void log_event(nr_sim *s, int32_t kind, int32_t actor, int32_t a, int32_t b) {
  sfx_of_event(s, kind, actor, a);
  if (s->event_count >= NR_EVENT_CAP) {
    s->events_dropped++;
    return;
  }
  int32_t *e = s->events[s->event_count++];
  e[0] = s->ticks;
  e[1] = kind;
  e[2] = actor;
  e[3] = a;
  e[4] = b;
}

void nr_sim_log(nr_sim *s, int32_t kind, int32_t actor, int32_t a, int32_t b) { log_event(s, kind, actor, a, b); }

/* Walking and running state entries are not logged unless `log_moves` is set (they would fill the log of a long run). */
static bool moves_only(int32_t from, int32_t to) {
  return to == NR_ST_WALK || to == NR_ST_RUN || (to == NR_ST_IDLE && (from == NR_ST_WALK || from == NR_ST_RUN));
}

static void enter(nr_sim *s, int i, int32_t state) {
  nr_actor *a = &s->actor[i];
  int32_t from = a->state;
  a->state = state;
  a->tick = 0;
  a->hit_mask = 0;
  a->knock_left = 0;
  a->knock_total = 0;
  bool quiet = is_hero(a) ? !s->log_moves && moves_only(from, state) : a->kind != NR_KIND_DUMMY && (state == NR_ST_IDLE || state == NR_ST_WALK);
  if (!quiet) log_event(s, NR_EV_ENTER, i, state, 0);
}

static void enter_if_changed(nr_sim *s, int i, int32_t state) {
  if (s->actor[i].state != state) enter(s, i, state);
}

/* Moves an actor, each axis on its own so it slides along the arena's bounds and the pillar. Returns whether it moved. */
static bool move_actor(nr_sim *s, int i, float dx, float dz) {
  nr_actor *a = &s->actor[i];
  const arena *ar = s->arena;
  bool moved = false;
  if (dx != 0.0f) {
    float nx = clampf(a->x + dx, ar->x_min, ar->x_max);
    if (!arena_blocked(ar, nx, a->lane) && nx != a->x) { a->x = nx; moved = true; }
  }
  if (dz != 0.0f) {
    float nl = clampf(a->lane + dz, ar->lane_min, ar->lane_max);
    if (!arena_blocked(ar, a->x, nl) && nl != a->lane) { a->lane = nl; moved = true; }
  }
  return moved;
}

/* An actor a hit can land on: not down, not held, not thrown, not dead, not a hero whose pad is gone. */
static bool targetable(const nr_actor *t) {
  if (!t->present || t->hp <= 0 || t->away) return false;
  switch (t->state) {
    case NR_ST_KNOCKDOWN: case NR_ST_GETUP: case NR_ST_GRABBED: case NR_ST_THROWN: case NR_ST_DEAD: return false;
    default: return true;
  }
}

/* A hero an enemy can be sent after: standing (or down but not dead), its pad plugged in. */
static bool chaseable(const nr_actor *h) { return h->present && !h->away && h->hp > 0 && h->state != NR_ST_DEAD; }

static void release_hold(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  if (a->holding < 0) return;
  nr_actor *h = &s->actor[a->holding];
  if (h->state == NR_ST_GRABBED) {
    h->held_by = -1;
    h->y = 0.0f;
    enter(s, a->holding, NR_ST_IDLE);
  }
  a->holding = -1;
}

/* Does `a`'s attack of state definition `d` overlap `t`'s hurtbox? */
static bool overlaps(const nr_actor *a, const state_def *d, const nr_actor *t) {
  if (!(a->y + d->y0 < t->y + HURT_HEIGHT && a->y + d->y1 > t->y)) return false;
  if (d->shape == SHAPE_RADIUS) {
    float dx = t->x - a->x, dz = t->lane - a->lane;
    return dx * dx + dz * dz <= d->x1 * d->x1;
  }
  float f = (float)a->facing, e0 = a->x + f * d->x0, e1 = a->x + f * d->x1;
  float lo = e0 < e1 ? e0 : e1, hi = e0 < e1 ? e1 : e0;
  if (!(lo < t->x + HURT_HALF_X && hi > t->x - HURT_HALF_X)) return false;
  return absf(t->lane - a->lane) <= d->half_lane + HURT_HALF_LANE;
}

/* ── targets ───────────────────────────────────────────────────────────────────────────────────────────────────── */

static int enemies_on(const nr_sim *s, int player) {
  int n = 0;
  for (int i = NR_PLAYERS; i < s->actor_count; i++)
    if (is_wave_enemy(&s->actor[i]) && s->actor[i].hp > 0 && s->actor[i].target == player) n++;
  return n;
}

/* The player with the fewest enemies after it, the lowest id on a tie; -1 when no player can be chased. */
static int least_chased(const nr_sim *s) {
  int best = -1, best_n = 0;
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (!chaseable(&s->actor[p])) continue;
    int n = enemies_on(s, p);
    if (best < 0 || n < best_n) { best = p; best_n = n; }
  }
  return best;
}

/* The player the next spawn of the wave takes: the players that can be chased in turn. */
static int alternate_target(const nr_sim *s) {
  int list[NR_PLAYERS], n = 0;
  for (int p = 0; p < NR_PLAYERS; p++)
    if (chaseable(&s->actor[p])) list[n++] = p;
  return n ? list[s->waves.spawned % n] : -1;
}

static void retarget(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  int t = least_chased(s);
  if (t != a->target) {
    a->target = t;
    log_event(s, NR_EV_RETARGET, i, t, 0);
  }
}

/* ── hits ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/* A heavy shrugs a hit off: only a special staggers it, a plain hit flinches it when it is not swinging and has not
 * flinched lately, and none of them pushes it or knocks it down. */
static void hit_heavy(nr_sim *s, int ai, int ti, const state_def *d) {
  nr_actor *a = &s->actor[ai], *t = &s->actor[ti];
  if (t->hp <= 0) {
    log_event(s, NR_EV_DEAD, ti, 0, 0);
    enter(s, ti, NR_ST_DEAD);
    return;
  }
  bool special = d == &DEF[NR_ST_SPECIAL_KNOCKBACK] || d == &DEF[NR_ST_SPECIAL_DASH];
  if (special) {
    if (a->x != t->x) t->facing = a->x > t->x ? 1 : -1;
    enter(s, ti, NR_ST_STAGGER);
    log_event(s, NR_EV_STAGGER, ti, ai, 0);
    if (d->shape == SHAPE_RADIUS) {
      float dx = t->x - a->x, dz = t->lane - a->lane, dist = sqrtf(dx * dx + dz * dz);
      if (dist >= 0.001f) {
        t->knock_x = dx / dist * d->knock * HEAVY_KNOCK_SHARE;
        t->knock_z = dz / dist * d->knock * HEAVY_KNOCK_SHARE;
        t->knock_left = t->knock_total = d->knock_ticks;
      }
    }
    return;
  }
  if (t->state == NR_ST_HEAVY_ATTACK || t->state == NR_ST_STAGGER || t->flinch_wait > 0) return;
  if (a->x != t->x) t->facing = a->x > t->x ? 1 : -1;
  enter(s, ti, NR_ST_HURT);
  t->flinch_wait = HEAVY_FLINCH_WAIT;
}

static void apply_hit(nr_sim *s, int ai, int ti, const state_def *d) {
  nr_actor *a = &s->actor[ai], *t = &s->actor[ti];
  a->hit_mask |= 1 << ti;
  release_hold(s, ti);
  t->hp -= d->damage;
  log_event(s, NR_EV_HIT, ai, ti, d->damage);
  if (t->kind == NR_KIND_HEAVY) {
    hit_heavy(s, ai, ti, d);
    return;
  }
  if (a->x != t->x) t->facing = a->x > t->x ? 1 : -1;
  float kx, kz;
  if (d->shape == SHAPE_RADIUS) {
    float dx = t->x - a->x, dz = t->lane - a->lane, dist = sqrtf(dx * dx + dz * dz);
    if (dist < 0.001f) { kx = (float)a->facing; kz = 0.0f; }
    else { kx = dx / dist; kz = dz / dist; }
  } else {
    kx = (float)a->facing;
    kz = 0.0f;
  }
  if (t->hp <= 0) log_event(s, NR_EV_DEAD, ti, 0, 0);
  enter(s, ti, t->hp <= 0 || d->knocks_down ? NR_ST_KNOCKDOWN : NR_ST_HURT);
  if (t->state == NR_ST_HURT && t->team == NR_TEAM_HERO) t->invuln = HERO_INVULN;
  t->knock_x = kx * d->knock;
  t->knock_z = kz * d->knock;
  t->knock_left = t->knock_total = d->knock_ticks;
}

static void resolve_hits(nr_sim *s) {
  for (int ai = 0; ai < s->actor_count; ai++) {
    nr_actor *a = &s->actor[ai];
    const state_def *d = &DEF[a->state];
    if (!a->present || d->shape == SHAPE_NONE) continue;
    if (a->tick < d->info.startup || a->tick >= d->info.startup + d->info.active) continue;
    for (int ti = 0; ti < s->actor_count; ti++) {
      nr_actor *t = &s->actor[ti];
      if (ti == ai || !t->present || (a->hit_mask & (1 << ti)) || !overlaps(a, d, t)) continue;
      if (a->team == t->team) {
        a->hit_mask |= 1 << ti;
        if (is_hero(a)) log_event(s, NR_EV_SKIP_TEAM, ai, ti, 0);
        continue;
      }
      if (!targetable(t)) continue;
      if (t->invuln > 0) {
        a->hit_mask |= 1 << ti;
        log_event(s, NR_EV_SKIP_INVULN, ai, ti, 0);
        continue;
      }
      apply_hit(s, ai, ti, d);
    }
  }
}

/* ── per-actor updates ─────────────────────────────────────────────────────────────────────────────────────────── */

static void apply_knock(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  if (a->knock_left <= 0) return;
  float k = (float)a->knock_left / (float)a->knock_total;
  move_actor(s, i, a->knock_x * k, a->knock_z * k);
  a->knock_left--;
}

/* A grab's hit test: the first grabbable actor of the other team in reach is taken; an actor in reach that cannot be
 * grabbed is logged once and the grab goes on. */
static void grab_test(nr_sim *s, int ai) {
  nr_actor *a = &s->actor[ai];
  const state_def *d = &DEF[NR_ST_GRAB];
  for (int ti = 0; ti < s->actor_count; ti++) {
    nr_actor *t = &s->actor[ti];
    if (ti == ai || !t->present || t->team == a->team || (a->hit_mask & (1 << ti)) || !targetable(t) || !overlaps(a, d, t)) continue;
    if (!t->grabbable) {
      a->hit_mask |= 1 << ti;
      log_event(s, NR_EV_GRAB_FAIL, ai, ti, 0);
      continue;
    }
    release_hold(s, ti);
    enter(s, ai, NR_ST_THROW);
    a->holding = ti;
    enter(s, ti, NR_ST_GRABBED);
    t->held_by = ai;
    t->facing = -a->facing;
    log_event(s, NR_EV_GRAB, ai, ti, 0);
    return;
  }
}

static void land(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  a->y = 0.0f;
  a->vy = 0.0f;
  a->vx = 0.0f;
}

/* A hero in a state that takes input: move, and start what was pressed. */
static void hero_free(nr_sim *s, int i, const nr_input *in) {
  nr_actor *a = &s->actor[i];
  if (in->mx > 0.0f) a->facing = 1;
  else if (in->mx < 0.0f) a->facing = -1;
  if (in->special) {
    a->variant = s->special_variant || (s->hold_alt && in->special_alt) ? 1 : 0;
    enter(s, i, a->variant ? NR_ST_SPECIAL_DASH : NR_ST_SPECIAL_KNOCKBACK);
    return;
  }
  if (in->grab) { enter(s, i, NR_ST_GRAB); return; }
  if (in->jump) {
    float speed = a->state == NR_ST_RUN ? RUN_SPEED : WALK_SPEED;
    enter(s, i, NR_ST_JUMP);
    a->vx = in->mx * speed;
    a->vy = JUMP_VY;
    return;
  }
  if (in->attack) { enter(s, i, NR_ST_HIT1); return; }
  if (in->dash) { enter(s, i, NR_ST_DASH); return; }
  if (in->tap != 0) {
    if (in->tap == a->last_tap_dir && s->ticks - a->last_tap_tick <= RUN_WINDOW) a->run_dir = in->tap;
    a->last_tap_dir = in->tap;
    a->last_tap_tick = s->ticks;
  }
  if (a->run_dir != 0 && (float)a->run_dir * in->mx <= 0.0f) a->run_dir = 0;
  bool moving = in->mx != 0.0f || in->my != 0.0f;
  float speed = a->run_dir != 0 ? RUN_SPEED : WALK_SPEED;
  move_actor(s, i, in->mx * speed, in->my * WALK_SPEED);
  enter_if_changed(s, i, !moving ? NR_ST_IDLE : a->run_dir != 0 ? NR_ST_RUN : NR_ST_WALK);
}

/* A hero's death takes a life from the pool; it stands up again when lives remain. */
static void hero_died(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  if (s->lives > 0) s->lives--;
  a->respawn = s->lives > 0;
  log_event(s, NR_EV_LIFE_LOST, i, s->lives, a->respawn);
}

static void end_state(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  switch (a->state) {
    case NR_ST_KNOCKDOWN:
      enter(s, i, a->hp <= 0 ? NR_ST_DEAD : NR_ST_GETUP);
      if (a->state == NR_ST_DEAD && is_hero(a)) hero_died(s, i);
      break;
    default: enter(s, i, NR_ST_IDLE); break;
  }
}

static void airborne(nr_sim *s, int i, const nr_input *in) {
  nr_actor *a = &s->actor[i];
  if (a->tick < 1) return;
  a->y += a->vy;
  a->vy -= GRAVITY;
  move_actor(s, i, a->vx, in ? in->my * AIR_LANE_SPEED : 0.0f);
  if (a->y <= 0.0f) {
    land(s, i);
    enter(s, i, NR_ST_IDLE);
  }
}

/* A hero stands up at the left edge of the camera's frame, in the lane it started in, at full hp and invulnerable for a
 * while, holding the special the run has. */
static void stand_at_edge(nr_sim *s, int i) {
  static const float LANE[NR_PLAYERS] = { 0.6f, -0.6f };
  nr_actor *a = &s->actor[i];
  const arena *ar = s->arena;
  float lane = LANE[i], x = clampf(s->cam_x - nr_sim_view_half(s, lane) + RESPAWN_MARGIN, ar->x_min, ar->x_max);
  while (arena_blocked(ar, x, lane) && x < ar->x_max) x += 0.5f;
  a->x = x;
  a->lane = lane;
  a->y = a->vy = a->vx = 0.0f;
  a->hp = NR_HERO_HP;
  a->invuln = NR_RESPAWN_INVULN;
  a->facing = 1;
  a->holding = a->held_by = -1;
  a->respawn = 0;
  a->run_dir = 0;
  a->variant = s->special_variant;
  enter(s, i, NR_ST_IDLE);
}

/* A dead hero stands up at the left edge of the frame when lives remain. */
static void respawn_hero(nr_sim *s, int i) {
  stand_at_edge(s, i);
  log_event(s, NR_EV_RESPAWN, i, milli(s->actor[i].x), milli(s->actor[i].lane));
}

/* The lane direction that walks an enemy at (x, lane) round the block it is up against: towards the nearer edge of the
 * block's lanes. */
static int detour_dir(const arena *ar, float x, float lane) {
  for (int k = 0; k < ar->block_count; k++) {
    const arena_block *b = &ar->block[k];
    if (x >= b->x0 - 0.5f && x <= b->x1 + 0.5f) return lane < (b->lane0 + b->lane1) * 0.5f ? -1 : 1;
  }
  return 1;
}

/* An enemy standing or walking: take a target, swing when it is in reach, otherwise walk to the place beside it. */
static void enemy_ai(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  const enemy_def *e = &ENEMY[a->kind];
  if (a->target < 0 || !chaseable(&s->actor[a->target])) retarget(s, i);
  if (a->target < 0) {
    enter_if_changed(s, i, NR_ST_IDLE);
    return;
  }
  const nr_actor *t = &s->actor[a->target];
  float dx = t->x - a->x, ax = absf(dx);
  float lane_goal = t->lane + (float)((i % 3) - 1) * AI_LANE_SPREAD, dz = lane_goal - a->lane;
  if (dx > 0.0f) a->facing = 1;
  else if (dx < 0.0f) a->facing = -1;
  if (a->ai_wait == 0 && ax <= e->reach_x && absf(t->lane - a->lane) <= e->reach_z) {
    a->ai_wait = e->cooldown;
    enter(s, i, e->swing);
    return;
  }
  float mx = 0.0f, mz = 0.0f, gap = ax - e->standoff;
  if (gap > 0.001f) mx = (float)a->facing * (gap < e->speed_x ? gap : e->speed_x);
  if (mx == 0.0f) a->detour = 0;
  if (a->detour != 0) mz = (float)a->detour * e->speed_z;
  else if (absf(dz) > AI_LANE_SETTLE) mz = (dz > 0.0f ? 1.0f : -1.0f) * (absf(dz) < e->speed_z ? absf(dz) : e->speed_z);
  /* up against a block: walk along it, to the side of the target's lane it is on, until the street is open */
  if (mx != 0.0f && arena_blocked(s->arena, clampf(a->x + mx, s->arena->x_min, s->arena->x_max), a->lane) && a->detour == 0) {
    a->detour = detour_dir(s->arena, a->x + mx, a->lane);
    mz = (float)a->detour * e->speed_z;
  } else if (a->detour != 0 && mx != 0.0f && !arena_blocked(s->arena, clampf(a->x + mx, s->arena->x_min, s->arena->x_max), a->lane)) {
    a->detour = 0;
  }
  bool moved = move_actor(s, i, mx, mz);
  enter_if_changed(s, i, moved ? NR_ST_WALK : NR_ST_IDLE);
}

static void update_actor(nr_sim *s, int i, const nr_input *in) {
  nr_actor *a = &s->actor[i];
  if (!a->present) return;
  const state_def *d = &DEF[a->state];
  if (d->info.total > 0 && a->tick >= d->info.total) {
    end_state(s, i);
    d = &DEF[a->state];
  }
  apply_knock(s, i);
  switch (a->state) {
    case NR_ST_IDLE: case NR_ST_WALK: case NR_ST_RUN:
      if (in) {
        hero_free(s, i, in);
      } else if (a->kind == NR_KIND_DUMMY) {
        for (int k = 0; k < a->strike_count; k++)
          if (a->strike[k].tick == s->ticks) enter(s, i, a->strike[k].state);
      } else {
        enemy_ai(s, i);
      }
      break;
    case NR_ST_HIT1: case NR_ST_HIT2: case NR_ST_HIT3:
      if (in && in->attack && d->next >= 0 && a->tick >= d->info.startup + d->info.active) enter(s, i, d->next);
      break;
    case NR_ST_JUMP:
      if (in && in->attack && a->y > 0.0f && a->tick >= KICK_FROM) {
        enter(s, i, NR_ST_JUMPKICK);
        break;
      }
      airborne(s, i, in);
      break;
    case NR_ST_JUMPKICK:
      airborne(s, i, NULL);
      break;
    case NR_ST_GRAB:
      if (a->tick >= d->info.startup && a->tick < d->info.startup + d->info.active) grab_test(s, i);
      break;
    case NR_ST_THROW: {
      nr_actor *h = a->holding >= 0 ? &s->actor[a->holding] : NULL;
      if (h) {
        h->x = a->x + (float)a->facing * HOLD_REACH;
        h->lane = a->lane;
        h->y = HOLD_HEIGHT;
        if (a->tick == THROW_RELEASE) {
          log_event(s, NR_EV_RELEASE, i, a->holding, 0);
          h->held_by = -1;
          h->vx = (float)a->facing * THROW_VX;
          h->vy = THROW_VY;
          enter(s, a->holding, NR_ST_THROWN);
          a->holding = -1;
        }
      }
      break;
    }
    case NR_ST_DASH:
      if (a->tick >= DASH_FROM && a->tick < DASH_TO) move_actor(s, i, (float)a->facing * DASH_SPEED, 0.0f);
      break;
    case NR_ST_SPECIAL_DASH:
      if (a->tick >= d->info.startup && a->tick < d->info.startup + d->info.active) move_actor(s, i, (float)a->facing * SPECIAL_DASH_SPEED, 0.0f);
      break;
    case NR_ST_THROWN:
      if (a->tick >= 1) {
        a->y += a->vy;
        a->vy -= THROW_GRAVITY;
        move_actor(s, i, a->vx, 0.0f);
        if (a->y <= 0.0f && a->vy < 0.0f) {
          land(s, i);
          a->hp -= THROW_DAMAGE;
          log_event(s, NR_EV_LAND, i, THROW_DAMAGE, 0);
          if (a->hp <= 0) log_event(s, NR_EV_DEAD, i, 0, 0);
          enter(s, i, NR_ST_KNOCKDOWN);
        }
      }
      break;
    case NR_ST_DEAD:
      if (is_hero(a)) {
        if (a->respawn && a->tick >= NR_RESPAWN_DELAY) respawn_hero(s, i);
      } else if (a->kind != NR_KIND_DUMMY && a->tick >= ENEMY_LINGER) {
        a->present = 0;
      }
      break;
    default:
      break;
  }
}

/* ── leash and camera ──────────────────────────────────────────────────────────────────────────────────────────── */

float nr_sim_view_half(const nr_sim *s, float lane) {
  float depth = s->view.distance - lane * s->view.cos_pitch;
  return s->view.half_width * depth / s->view.distance - s->view.actor_half;
}

/* A hero the camera follows: present, its pad plugged in, alive. */
static bool follows(const nr_actor *a) { return a->present && !a->away && a->state != NR_ST_DEAD; }

/* Follows the followed players' midpoint, holds every player in frame, never scrolls back. Every player is inside the
 * current frame when this runs, so the camera's range is never empty: it is limited by the trailing player (it cannot
 * move on past where that player would leave the frame), by the leader (it cannot move back past where that player
 * would) and by the furthest it has scrolled. With nobody to follow it stays where it is. */
static void step_camera(nr_sim *s) {
  float lo = s->cam_left > CAM_MIN_X ? s->cam_left : CAM_MIN_X, hi = CAM_MAX_X, mid = 0.0f;
  int n = 0;
  for (int i = 0; i < NR_PLAYERS; i++) {
    if (!follows(&s->actor[i])) continue;
    float h = nr_sim_view_half(s, s->actor[i].lane);
    if (s->actor[i].x - h > lo) lo = s->actor[i].x - h;
    if (s->actor[i].x + h < hi) hi = s->actor[i].x + h;
    mid += s->actor[i].x;
    n++;
  }
  if (!n) return;
  mid /= (float)n;
  float target = clampf(mid, lo, hi);
  s->cam_x += clampf(target - s->cam_x, -CAM_MAX_STEP, CAM_MAX_STEP);
  if (s->cam_x > s->cam_left) s->cam_left = s->cam_x;
}

/* ── the tick ──────────────────────────────────────────────────────────────────────────────────────────────────── */

static uint32_t fold(uint32_t h, const void *p, size_t n) { return cw_hash32(p, n, h); }

static uint32_t checksum_of(const nr_sim *s, uint32_t h) {
  for (int i = 0; i < s->actor_count; i++) {
    const nr_actor *a = &s->actor[i];
    float f[8] = { a->x, a->lane, a->y, a->vy, a->vx, a->knock_x, a->knock_z, 0.0f };
    int32_t n[28] = { a->knock_left, a->knock_total, a->facing, a->state, a->tick, a->hp, a->invuln, a->team, a->hit_mask, a->holding,
                      a->held_by, a->grabbable, a->present, a->variant, a->last_tap_dir, a->last_tap_tick, a->run_dir, a->kind, a->target, a->away,
                      a->respawn, a->ai_wait, a->flinch_wait, a->detour, 0, 0, 0, 0 };
    h = fold(h, f, sizeof f);
    h = fold(h, n, sizeof n);
  }
  float cam[2] = { s->cam_x, s->cam_left };
  const nr_waves *w = &s->waves;
  int32_t sc[18] = { s->ticks, s->input_count, s->wave, s->lives, s->actor_count, s->event_count, s->players, s->game_over, s->start_refused, s->waves_on,
                     w->phase, w->delay, w->grunts_left, w->heavies_left, w->spawn_gap, w->spawned, w->upgrade_ready, w->cleared };
  h = fold(h, cam, sizeof cam);
  h = fold(h, s->rng.s, sizeof s->rng.s);
  h = fold(h, sc, sizeof sc);
  if (!s->auto_presence) {
    /* a run with a title also has its phase, the pick and the joins; a run without one keeps the fields it always had */
    int32_t ex[8] = { s->phase, s->phase_since, s->special_variant, s->pick_player, s->upgrade_done, s->joins, s->ignored_starts, s->return_title };
    h = fold(h, ex, sizeof ex);
  }
  return h;
}

void nr_sim_init(nr_sim *s, const arena *arena, nr_view view) {
  memset(s, 0, sizeof *s);
  s->arena = arena;
  s->view = view;
  s->players = NR_PLAYERS;
  s->lives = NR_LIVES_PER_PLAYER * NR_PLAYERS;
  s->waves_on = 1;
  s->phase = NR_PH_FIGHT;
  s->auto_presence = 1;
  s->pick_player = -1;
  s->log_moves = 1;
  s->checksum = CW_HASH32_INIT;
  cw_rng_seed(&s->rng, 0x4e52u);
  s->waves.phase = NR_WAVES_WAITING;
  s->waves.delay = NR_WAVE_FIRST_DELAY;
  static const float LANE[NR_PLAYERS] = { 0.6f, -0.6f };
  s->actor_count = NR_SIM_MAX_ACTORS;
  for (int i = 0; i < NR_SIM_MAX_ACTORS; i++) {
    s->actor[i].target = -1;
    s->actor[i].team = NR_TEAM_ENEMY;
    s->actor[i].holding = s->actor[i].held_by = -1;
    s->actor[i].facing = 1;
  }
  for (int i = 0; i < NR_PLAYERS; i++) {
    nr_actor *a = &s->actor[i];
    a->x = 0.0f;
    a->lane = LANE[i];
    a->state = NR_ST_IDLE;
    a->hp = NR_HERO_HP;
    a->team = NR_TEAM_HERO;
    a->kind = NR_KIND_HERO;
    a->present = 1;
  }
}

/* The first free enemy slot, or -1. */
static int free_slot(const nr_sim *s) {
  for (int i = NR_PLAYERS; i < s->actor_count; i++)
    if (!s->actor[i].present) return i;
  return -1;
}

int nr_sim_add_dummy(nr_sim *s, float x, float lane, int32_t hp, bool grabbable, int32_t facing) {
  int id = free_slot(s);
  if (id < 0) return -1;
  nr_actor *a = &s->actor[id];
  memset(a, 0, sizeof *a);
  a->x = x;
  a->lane = lane;
  a->facing = facing < 0 ? -1 : 1;
  a->state = NR_ST_IDLE;
  a->hp = hp;
  a->team = NR_TEAM_ENEMY;
  a->kind = NR_KIND_DUMMY;
  a->grabbable = grabbable ? 1 : 0;
  a->holding = a->held_by = -1;
  a->target = -1;
  a->present = 1;
  return id;
}

int nr_sim_spawn_enemy(nr_sim *s, int32_t kind, float x, float lane) {
  int id = free_slot(s);
  if (id < 0 || (kind != NR_KIND_GRUNT && kind != NR_KIND_HEAVY)) return -1;
  nr_actor *a = &s->actor[id];
  memset(a, 0, sizeof *a);
  a->x = x;
  a->lane = lane;
  a->facing = s->cam_x >= x ? 1 : -1;
  a->state = NR_ST_IDLE;
  a->hp = ENEMY[kind].hp;
  a->team = NR_TEAM_ENEMY;
  a->kind = kind;
  a->grabbable = kind == NR_KIND_GRUNT;
  a->holding = a->held_by = -1;
  a->target = alternate_target(s);
  a->present = 1;
  log_event(s, NR_EV_SPAWN, id, kind, a->target);
  return id;
}

int nr_sim_enemies_alive(const nr_sim *s) {
  int n = 0;
  for (int i = NR_PLAYERS; i < s->actor_count; i++)
    if (is_wave_enemy(&s->actor[i]) && s->actor[i].hp > 0) n++;
  return n;
}

void nr_sim_set_strikes(nr_sim *s, int actor, const nr_strike *strikes, int count) {
  nr_actor *a = &s->actor[actor];
  a->strike_count = count > NR_MAX_STRIKES ? NR_MAX_STRIKES : count;
  for (int k = 0; k < a->strike_count; k++) a->strike[k] = strikes[k];
}

/* A hero whose pad was just unplugged or plugged back in. Unplugging lets go of what it holds. */
static void set_away(nr_sim *s, int p, bool away) {
  nr_actor *a = &s->actor[p];
  if ((a->away != 0) == away) return;
  a->away = away ? 1 : 0;
  if (away) release_hold(s, p);
  log_event(s, NR_EV_AWAY, p, away ? 1 : 0, 0);
}

/* ── phases, joins and the upgrade pick ────────────────────────────────────────────────────────────────────────── */

void nr_sim_enter_phase(nr_sim *s, int32_t phase) {
  s->phase = phase;
  s->phase_since = s->ticks;
  if (!s->auto_presence) log_event(s, NR_EV_PHASE, -1, phase, 0); /* a run without a title keeps the event log it always had */
}

void nr_sim_enter_title(nr_sim *s) {
  s->auto_presence = 0;
  s->upgrade_pause = 1;
  s->players = 0;
  s->lives = 0;
  s->phase = NR_PH_TITLE;
  s->phase_since = s->ticks;
  for (int p = 0; p < NR_PLAYERS; p++) s->actor[p].present = 0;
}

void nr_sim_offer_upgrade(nr_sim *s) {
  if (s->upgrade_pause && !s->upgrade_done) nr_sim_enter_phase(s, NR_PH_UPGRADE);
}

void nr_sim_run_cleared(nr_sim *s) {
  if (!s->auto_presence) nr_sim_enter_phase(s, NR_PH_CLEAR);
}

/* A player that is not present joins: at the title it stands on the street where it began, later at the camera's left edge. */
static void join_player(nr_sim *s, int p) {
  nr_actor *a = &s->actor[p];
  a->present = 1;
  a->away = 0;
  if (s->phase != NR_PH_TITLE) {
    stand_at_edge(s, p);
    s->joins++;
  }
  s->players++;
  s->lives += NR_LIVES_PER_PLAYER;
  log_event(s, NR_EV_JOIN, p, s->lives, s->phase);
}

/* Start presses in the fight and the upgrade pause: a player that is not present joins, one that is does nothing. */
static void start_presses(nr_sim *s, const nr_input input[NR_PLAYERS]) {
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (!input[p].start) continue;
    if (s->actor[p].present) {
      s->ignored_starts++;
      log_event(s, NR_EV_START_IGNORED, p, 0, 0);
    } else {
      join_player(s, p);
    }
  }
}

/* The title: a start press from a player that has not joined joins it; one from a player that had already joined, on an
 * earlier tick, begins the fight with the players that are in. */
static void title_step(nr_sim *s, const nr_input input[NR_PLAYERS]) {
  bool was_in[NR_PLAYERS], begin = false;
  for (int p = 0; p < NR_PLAYERS; p++) {
    was_in[p] = s->actor[p].present != 0;
    if (s->actor[p].present) s->actor[p].tick++;
  }
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (!input[p].start) continue;
    if (was_in[p]) begin = true;
    else join_player(s, p);
  }
  if (begin && s->players > 0) {
    log_event(s, NR_EV_BEGIN, -1, s->players, s->lives);
    nr_sim_enter_phase(s, NR_PH_FIGHT);
  }
}

/* The upgrade pause: joins, then the first pick after the lockout; the lower port wins a tick two players pick on. */
static void upgrade_step(nr_sim *s, const nr_input input[NR_PLAYERS]) {
  start_presses(s, input);
  if (s->ticks - s->phase_since < NR_UPGRADE_LOCKOUT) return;
  for (int p = 0; p < NR_PLAYERS; p++) {
    const nr_actor *a = &s->actor[p];
    if (!a->present || a->away || input[p].tap == 0) continue;
    s->special_variant = input[p].tap > 0 ? 1 : 0;
    s->upgrade_done = 1;
    s->pick_player = p;
    for (int h = 0; h < NR_PLAYERS; h++) s->actor[h].variant = s->special_variant;
    log_event(s, NR_EV_PICK, p, s->special_variant, s->ticks - s->phase_since);
    nr_sim_enter_phase(s, NR_PH_FIGHT);
    return;
  }
}

/* The game is over when the pool is empty and no hero is alive or about to stand up. */
static void check_game_over(nr_sim *s) {
  if (s->game_over || s->lives > 0) return;
  for (int p = 0; p < NR_PLAYERS; p++) {
    const nr_actor *a = &s->actor[p];
    if (a->present && (a->state != NR_ST_DEAD || a->respawn)) return;
  }
  s->game_over = 1;
  log_event(s, NR_EV_GAME_OVER, -1, 0, 0);
  nr_sim_enter_phase(s, NR_PH_GAMEOVER);
}

void nr_sim_step(nr_sim *s, const nr_input input[NR_PLAYERS]) {
  s->ticks++;
  bool any = false;
  for (int p = 0; p < NR_PLAYERS; p++) any = any || input[p].any;
  if (any) s->input_count++;
  if (s->phase == NR_PH_TITLE) {
    title_step(s, input);
    s->checksum = checksum_of(s, s->checksum);
    return;
  }
  if (s->phase == NR_PH_CLEAR) {
    /* the last wave ended: nothing moves; a back press asks the host for a new run */
    for (int p = 0; p < NR_PLAYERS; p++)
      if (input[p].back) s->return_title = 1;
    s->checksum = checksum_of(s, s->checksum);
    return;
  }
  if (s->auto_presence && s->ticks == 1) {
    /* every hero stands on the street until the presence tick: a pad the platform reports a frame or two late is still in */
    for (int p = 0; p < NR_PLAYERS; p++) s->actor[p].present = 1;
    s->players = NR_PLAYERS;
    s->lives = NR_LIVES_PER_PLAYER * s->players;
  }
  if (s->auto_presence && s->ticks == NR_PRESENCE_TICKS) {
    s->players = 0;
    for (int p = 0; p < NR_PLAYERS; p++) {
      s->actor[p].present = p == 0 || input[p].connected ? 1 : 0;
      s->players += s->actor[p].present;
    }
    s->lives = NR_LIVES_PER_PLAYER * s->players;
  }
  if (s->game_over) {
    for (int p = 0; p < NR_PLAYERS; p++) {
      if (input[p].back) s->return_title = 1;
      if (!input[p].start) continue;
      s->start_refused++;
      log_event(s, NR_EV_START_REFUSED, p, 0, 0);
    }
    s->checksum = checksum_of(s, s->checksum);
    return;
  }
  if (s->phase == NR_PH_UPGRADE) {
    upgrade_step(s, input);
    s->checksum = checksum_of(s, s->checksum);
    return;
  }
  if (!s->auto_presence) start_presses(s, input);
  nr_input idle_input = { .connected = false };
  const nr_input *eff[NR_PLAYERS];
  for (int p = 0; p < NR_PLAYERS; p++) {
    if (s->actor[p].present && (!s->auto_presence || s->ticks >= NR_PRESENCE_TICKS)) set_away(s, p, p != 0 && !input[p].connected);
    eff[p] = s->actor[p].away ? &idle_input : &input[p];
  }
  float before[NR_SIM_MAX_ACTORS];
  for (int i = 0; i < s->actor_count; i++) {
    nr_actor *a = &s->actor[i];
    before[i] = a->x;
    if (!a->present) continue;
    a->tick++;
    if (a->invuln > 0) a->invuln--;
    if (a->ai_wait > 0) a->ai_wait--;
    if (a->flinch_wait > 0) a->flinch_wait--;
  }
  for (int i = 0; i < s->actor_count; i++) update_actor(s, i, i < NR_PLAYERS ? eff[i] : NULL);
  resolve_hits(s);
  /* no player stands past the edge of the frame it is in: the trailing player cannot walk off the left and the leader
   * stops at the right (the soft wall) until the camera, which follows the midpoint, moves on; the enemies of the waves
   * stay in the frame the same way */
  for (int i = 0; i < s->actor_count; i++) {
    nr_actor *a = &s->actor[i];
    if (!a->present || a->kind == NR_KIND_DUMMY || a->state == NR_ST_DEAD) continue;
    float h = nr_sim_view_half(s, a->lane), x = clampf(a->x, s->cam_x - h, s->cam_x + h);
    if (arena_blocked(s->arena, x, a->lane)) a->x = before[i];
    else a->x = x;
  }
  step_camera(s);
  if (s->waves_on) nr_waves_step(s);
  check_game_over(s);
  s->checksum = checksum_of(s, s->checksum);
}
