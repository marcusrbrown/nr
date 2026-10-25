/* waves: the spawn schedule of the arena: four waves of 4, 6, 6 + a heavy and 8 + a heavy.
 *
 * A wave begins `delay` ticks after the one before it ended (the first after FIRST_DELAY), spawns its grunts a few
 * ticks apart at the left or right edge of the camera's frame (the side and the lane come from the simulation's seeded
 * rng, so a run is reproducible) and its heavy after them, and ends on the tick all of its enemies are dead. The end of
 * wave 2 sets `upgrade_ready`, the flag the upgrade choice reads; the next wave still begins after its delay (nothing
 * holds it yet). The end of the last wave sets `cleared`. The steps and the spawns are in waves.c; the state is part of
 * the simulation's checksum. */
#ifndef NR_WAVES_H
#define NR_WAVES_H

#include <stdint.h>

#define NR_WAVE_COUNT 4
#define NR_WAVE_FIRST_DELAY 60   /* ticks before wave 1 */
#define NR_WAVE_NEXT_DELAY 150   /* ticks from a wave's last kill to the next wave */
#define NR_WAVE_SPAWN_GAP_MIN 14 /* ticks between two spawns of a wave: 14 to 26 */
#define NR_WAVE_SPAWN_GAP_SPAN 12
#define NR_WAVE_UPGRADE_AFTER 2  /* the wave whose end sets upgrade_ready */

typedef struct {
  int32_t grunts, heavies;
} nr_wave_def;

extern const nr_wave_def NR_WAVE_DEFS[NR_WAVE_COUNT];

typedef enum { NR_WAVES_WAITING, NR_WAVES_ACTIVE, NR_WAVES_DONE } nr_waves_phase;

typedef struct {
  int32_t phase;                      /* nr_waves_phase */
  int32_t wave;                       /* 0 before the first wave begins, then 1 .. NR_WAVE_COUNT */
  int32_t delay;                      /* WAITING: ticks until the next wave begins */
  int32_t grunts_left, heavies_left;  /* ACTIVE: not yet spawned */
  int32_t spawn_gap;                  /* ACTIVE: ticks until the next spawn */
  int32_t spawned;                    /* enemies spawned in this wave */
  int32_t upgrade_ready;              /* wave 2 has ended */
  int32_t cleared;                    /* the last wave has ended */
} nr_waves;

#endif
