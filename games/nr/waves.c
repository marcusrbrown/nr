/* waves: the spawn schedule. See waves.h. */
#include "waves.h"

#include "sim.h"

const nr_wave_def NR_WAVE_DEFS[NR_WAVE_COUNT] = { { 4, 0 }, { 6, 0 }, { 6, 1 }, { 8, 1 } };

/* Where the next enemy appears: the left or right edge of the camera's frame, in a lane picked from the rng, at the
 * most the frame allows (nr_sim_view_half) and inside the arena. A spot inside a block moves to the front lane. */
static void spawn_spot(nr_sim *s, float *x, float *lane) {
  const arena *ar = s->arena;
  int right = cw_rng_int(&s->rng, 0, 1);
  int step = cw_rng_int(&s->rng, 0, 16);
  float span = ar->lane_max - ar->lane_min - 0.4f;
  float l = ar->lane_min + 0.2f + (float)step * span / 16.0f;
  float h = nr_sim_view_half(s, l);
  float px = right ? s->cam_x + h : s->cam_x - h;
  px = px < ar->x_min ? ar->x_min : px > ar->x_max ? ar->x_max : px;
  if (arena_blocked(ar, px, l)) l = ar->lane_max - 0.3f;
  *x = px;
  *lane = l;
}

static void begin_wave(nr_sim *s) {
  nr_waves *w = &s->waves;
  const nr_wave_def *def = &NR_WAVE_DEFS[w->wave];
  w->wave++;
  w->phase = NR_WAVES_ACTIVE;
  w->grunts_left = def->grunts;
  w->heavies_left = def->heavies;
  w->spawn_gap = 0;
  w->spawned = 0;
  s->wave = w->wave;
  nr_sim_log(s, NR_EV_WAVE_BEGIN, -1, w->wave, def->grunts + def->heavies);
}

static void end_wave(nr_sim *s) {
  nr_waves *w = &s->waves;
  nr_sim_log(s, NR_EV_WAVE_END, -1, w->wave, 0);
  if (w->wave == NR_WAVE_UPGRADE_AFTER) {
    w->upgrade_ready = 1;
    nr_sim_log(s, NR_EV_UPGRADE, -1, w->wave, 0);
  }
  if (w->wave >= NR_WAVE_COUNT) {
    w->phase = NR_WAVES_DONE;
    w->cleared = 1;
    nr_sim_log(s, NR_EV_CLEAR, -1, w->wave, 0);
    return;
  }
  w->phase = NR_WAVES_WAITING;
  w->delay = NR_WAVE_NEXT_DELAY;
}

void nr_waves_step(nr_sim *s) {
  nr_waves *w = &s->waves;
  switch (w->phase) {
    case NR_WAVES_WAITING:
      if (w->delay > 0) w->delay--;
      if (w->delay == 0) begin_wave(s);
      break;
    case NR_WAVES_ACTIVE:
      if (w->grunts_left > 0 || w->heavies_left > 0) {
        if (w->spawn_gap > 0) {
          w->spawn_gap--;
          break;
        }
        float x, lane;
        spawn_spot(s, &x, &lane);
        int32_t kind = w->grunts_left > 0 ? NR_KIND_GRUNT : NR_KIND_HEAVY;
        if (nr_sim_spawn_enemy(s, kind, x, lane) < 0) break;
        if (kind == NR_KIND_GRUNT) w->grunts_left--;
        else w->heavies_left--;
        w->spawned++;
        w->spawn_gap = NR_WAVE_SPAWN_GAP_MIN + cw_rng_int(&s->rng, 0, NR_WAVE_SPAWN_GAP_SPAN);
      } else if (nr_sim_enemies_alive(s) == 0) {
        end_wave(s);
      }
      break;
    default:
      break;
  }
}
