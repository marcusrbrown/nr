/* ui: the screens and the HUD, drawn with render2d over the 3D frame.
 *
 * Nothing here feeds the simulation: main.c copies what the screens show out of the simulation into a ui_state each
 * frame and ui_draw() draws it. The title, the HUD (wave, lives, a tag and hp for each player), the upgrade pause, the
 * clear screen and the game-over screen share one font; ui_init() bakes every glyph the screens use (the ASCII range)
 * before the first frame, so no frame after it bakes a glyph. Every string is ASCII. */
#ifndef NR_UI_H
#define NR_UI_H

#include <stdint.h>

#include "sim.h"

typedef struct {
  int32_t phase;            /* nr_phase */
  int32_t ticks;            /* the simulation's tick, for what blinks */
  int32_t phase_ticks;      /* ticks since the phase was entered */
  int32_t lives, wave, wave_total;
  int32_t present[NR_PLAYERS];   /* the player has joined */
  int32_t away[NR_PLAYERS];      /* its pad is disconnected */
  int32_t hp[NR_PLAYERS], hp_max;
  int32_t variant;               /* the special the run has: 0 knockback, 1 dash */
  int32_t upgrade_done;
  int32_t pick_player;           /* the player that picked, or -1 */
  int32_t grace_left;          /* upgrade pause: ticks until a pick is taken */
} ui_state;

/* Loads the font and bakes the glyphs. Call once, from init, with the GPU ready. */
void ui_init(void);

/* Draws the screen of s->phase and the HUD over the frame the 3D scene just drew. */
void ui_draw(const ui_state *s);

/* Render2d atlas pages and the codepoints no font had, for the debug state. */
int32_t ui_atlas_pages(void);
int32_t ui_glyphs_missing(void);

#endif
