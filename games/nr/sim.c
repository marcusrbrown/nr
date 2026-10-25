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
#define HERO_HP 12
#define HERO_INVULN 60       /* action2d's invulnerability after a hit */
#define CAM_MIN_X 0.0f
#define CAM_MAX_X 20.0f
#define CAM_MAX_STEP 0.3f

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
 * 37.8, special_dash 8 x 60 = 28.8). A melee swing tests for 9 ticks and its state is 18 ticks of cooldown past the
 * startup, as in action2d. */
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
};

const nr_state_info *nr_state_info_of(int32_t state) { return state >= 0 && state < NR_ST_COUNT ? &DEF[state].info : NULL; }

/* ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────── */

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static float absf(float v) { return v < 0.0f ? -v : v; }

static void log_event(nr_sim *s, int32_t kind, int32_t actor, int32_t a, int32_t b) {
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

static void enter(nr_sim *s, int i, int32_t state) {
  nr_actor *a = &s->actor[i];
  a->state = state;
  a->tick = 0;
  a->hit_mask = 0;
  a->knock_left = 0;
  a->knock_total = 0;
  log_event(s, NR_EV_ENTER, i, state, 0);
}

static void enter_if_changed(nr_sim *s, int i, int32_t state) {
  if (s->actor[i].state != state) enter(s, i, state);
}

/* Moves an actor, each axis on its own so it slides along the arena's bounds and the pillar. */
static void move_actor(nr_sim *s, int i, float dx, float dz) {
  nr_actor *a = &s->actor[i];
  const arena *ar = s->arena;
  if (dx != 0.0f) {
    float nx = clampf(a->x + dx, ar->x_min, ar->x_max);
    if (!arena_blocked(ar, nx, a->lane)) a->x = nx;
  }
  if (dz != 0.0f) {
    float nl = clampf(a->lane + dz, ar->lane_min, ar->lane_max);
    if (!arena_blocked(ar, a->x, nl)) a->lane = nl;
  }
}

/* An actor a hit can land on: not down, not held, not thrown, not dead. */
static bool targetable(const nr_actor *t) {
  if (!t->present || t->hp <= 0) return false;
  switch (t->state) {
    case NR_ST_KNOCKDOWN: case NR_ST_GETUP: case NR_ST_GRABBED: case NR_ST_THROWN: case NR_ST_DEAD: return false;
    default: return true;
  }
}

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

static void apply_hit(nr_sim *s, int ai, int ti, const state_def *d) {
  nr_actor *a = &s->actor[ai], *t = &s->actor[ti];
  a->hit_mask |= 1 << ti;
  release_hold(s, ti);
  t->hp -= d->damage;
  log_event(s, NR_EV_HIT, ai, ti, d->damage);
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
        log_event(s, NR_EV_SKIP_TEAM, ai, ti, 0);
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
    a->variant = in->special_alt ? 1 : 0;
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

static void end_state(nr_sim *s, int i) {
  nr_actor *a = &s->actor[i];
  switch (a->state) {
    case NR_ST_KNOCKDOWN: enter(s, i, a->hp <= 0 ? NR_ST_DEAD : NR_ST_GETUP); break;
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
      } else {
        for (int k = 0; k < a->strike_count; k++)
          if (a->strike[k].tick == s->ticks) enter(s, i, a->strike[k].state);
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
    default:
      break;
  }
}

/* ── leash and camera ──────────────────────────────────────────────────────────────────────────────────────────── */

float nr_sim_view_half(const nr_sim *s, float lane) {
  float depth = s->view.distance - lane * s->view.cos_pitch;
  return s->view.half_width * depth / s->view.distance - s->view.actor_half;
}

/* Follows the players' midpoint, holds every player in frame, never scrolls back. Every player is inside the current
 * frame when this runs, so the camera's range is never empty: it is limited by the trailing player (it cannot move on
 * past where that player would leave the frame), by the leader (it cannot move back past where that player would) and
 * by the furthest it has scrolled. */
static void step_camera(nr_sim *s) {
  float lo = s->cam_left > CAM_MIN_X ? s->cam_left : CAM_MIN_X, hi = CAM_MAX_X, mid = 0.0f;
  for (int i = 0; i < NR_PLAYERS; i++) {
    float h = nr_sim_view_half(s, s->actor[i].lane);
    if (s->actor[i].x - h > lo) lo = s->actor[i].x - h;
    if (s->actor[i].x + h < hi) hi = s->actor[i].x + h;
    mid += s->actor[i].x;
  }
  mid /= (float)NR_PLAYERS;
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
    int32_t n[20] = { a->knock_left, a->knock_total, a->facing, a->state, a->tick, a->hp, a->invuln, a->team, a->hit_mask, a->holding,
                      a->held_by, a->grabbable, a->present, a->variant, a->last_tap_dir, a->last_tap_tick, a->run_dir, 0, 0, 0 };
    h = fold(h, f, sizeof f);
    h = fold(h, n, sizeof n);
  }
  float cam[2] = { s->cam_x, s->cam_left };
  int32_t sc[6] = { s->ticks, s->input_count, s->wave, s->lives, s->actor_count, s->event_count };
  h = fold(h, cam, sizeof cam);
  h = fold(h, s->rng.s, sizeof s->rng.s);
  h = fold(h, sc, sizeof sc);
  return h;
}

void nr_sim_init(nr_sim *s, const arena *arena, nr_view view) {
  memset(s, 0, sizeof *s);
  s->arena = arena;
  s->view = view;
  s->lives = 3;
  s->checksum = CW_HASH32_INIT;
  cw_rng_seed(&s->rng, 0x4e52u);
  static const float LANE[NR_PLAYERS] = { 0.6f, -0.6f };
  for (int i = 0; i < NR_PLAYERS; i++) {
    nr_actor *a = &s->actor[i];
    a->x = 0.0f;
    a->lane = LANE[i];
    a->facing = 1;
    a->state = NR_ST_IDLE;
    a->hp = HERO_HP;
    a->team = NR_TEAM_HERO;
    a->holding = a->held_by = -1;
    a->present = 1;
  }
  s->actor_count = NR_PLAYERS;
}

int nr_sim_add_dummy(nr_sim *s, float x, float lane, int32_t hp, bool grabbable, int32_t facing) {
  if (s->actor_count >= NR_SIM_MAX_ACTORS) return -1;
  int id = s->actor_count++;
  nr_actor *a = &s->actor[id];
  memset(a, 0, sizeof *a);
  a->x = x;
  a->lane = lane;
  a->facing = facing < 0 ? -1 : 1;
  a->state = NR_ST_IDLE;
  a->hp = hp;
  a->team = NR_TEAM_ENEMY;
  a->grabbable = grabbable ? 1 : 0;
  a->holding = a->held_by = -1;
  a->present = 1;
  return id;
}

void nr_sim_set_strikes(nr_sim *s, int actor, const nr_strike *strikes, int count) {
  nr_actor *a = &s->actor[actor];
  a->strike_count = count > NR_MAX_STRIKES ? NR_MAX_STRIKES : count;
  for (int k = 0; k < a->strike_count; k++) a->strike[k] = strikes[k];
}

void nr_sim_step(nr_sim *s, const nr_input input[NR_PLAYERS]) {
  s->ticks++;
  bool any = false;
  for (int p = 0; p < NR_PLAYERS; p++) any = any || input[p].any;
  if (any) s->input_count++;
  float before[NR_PLAYERS][2];
  for (int i = 0; i < s->actor_count; i++) {
    nr_actor *a = &s->actor[i];
    if (!a->present) continue;
    a->tick++;
    if (a->invuln > 0) a->invuln--;
    if (i < NR_PLAYERS) {
      before[i][0] = a->x;
      before[i][1] = a->lane;
    }
  }
  for (int i = 0; i < s->actor_count; i++) update_actor(s, i, i < NR_PLAYERS ? &input[i] : NULL);
  resolve_hits(s);
  /* no player stands past the edge of the frame it is in: the trailing player cannot walk off the left and the leader
   * stops at the right (the soft wall) until the camera, which follows the midpoint, moves on */
  for (int p = 0; p < NR_PLAYERS; p++) {
    nr_actor *a = &s->actor[p];
    float h = nr_sim_view_half(s, a->lane), x = clampf(a->x, s->cam_x - h, s->cam_x + h);
    if (arena_blocked(s->arena, x, a->lane)) a->x = before[p][0];
    else a->x = x;
  }
  step_camera(s);
  s->checksum = checksum_of(s, s->checksum);
}
