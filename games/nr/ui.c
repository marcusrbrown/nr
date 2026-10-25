/* ui: the screens and the HUD. See ui.h. */
#include "ui.h"

#include <stdio.h>

#include "cartwheel/core.h"
#include "cartwheel/platform.h"
#include "cartwheel/render2d.h"

#define PINK cw_rgba(1.0f, 0.17f, 0.84f, 1.0f)
#define CYAN cw_rgba(0.12f, 0.91f, 1.0f, 1.0f)
#define AMBER cw_rgba(1.0f, 0.63f, 0.13f, 1.0f)
#define WHITE cw_rgba(1.0f, 1.0f, 1.0f, 1.0f)
#define INK cw_rgba(0.03f, 0.03f, 0.08f, 1.0f)

static cw_font font;

void ui_init(void) {
  /* SDF with room for an outline; every glyph of the ASCII range is baked now, whatever the screens draw later */
  const cw_font_desc fd = { .mode = CW_FONT_SDF, .sdf_padding = 10 };
  font = cw_font_load("fonts/FiraSans-Regular.ttf", &fd);
  cw_font_preload_range(font, 32, 126);
}

int32_t ui_atlas_pages(void) { return (int32_t)cw_r2d_get_stats()->atlas_pages; }
int32_t ui_glyphs_missing(void) { return (int32_t)cw_r2d_get_stats()->glyphs_missing; }

static cw_color alpha(cw_color c, float a) {
  c.a *= a;
  return c;
}

/* One line of text with an outline; `wrap` > 0 wraps and aligns inside that width. */
static void text(const char *s, float x, float y, float size, cw_color c, cw_text_align align, float wrap) {
  cw_text_style st = { .size = size, .color = c, .align = align, .wrap_width = wrap, .outline_width = size * 0.07f, .outline_color = alpha(INK, c.a) };
  cw_r2d_text(font, s, cw_v2(x, y), &st);
}

static void panel(cw_rect r, cw_color fill, cw_color line, float w) {
  cw_r2d_rect(r, fill);
  cw_r2d_rect_lines(r, w, line);
}

static float blink(int32_t ticks) { return ticks / 30 % 2 == 0 ? 1.0f : 0.45f; }

/* ── title ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

static void draw_title(const ui_state *u, float W, float H, float k) {
  cw_r2d_rect(cw_rect_make(0, H * 0.10f, W, H * 0.40f), cw_rgba(0.02f, 0.02f, 0.07f, 0.62f));
  text("NEON REBELLION", 7 * k, H * 0.15f + 7 * k, 150 * k, alpha(CYAN, 0.9f), CW_ALIGN_CENTER, W);
  text("NEON REBELLION", 0, H * 0.15f, 150 * k, PINK, CW_ALIGN_CENTER, W);
  text("ONE STREET BLOCK  -  FOUR WAVES  -  ONE OR TWO PLAYERS", 0, H * 0.36f, 40 * k, WHITE, CW_ALIGN_CENTER, W);

  int in = 0;
  for (int p = 0; p < NR_PLAYERS; p++) {
    cw_rect r = cw_rect_make(W * 0.5f - 560 * k + (float)p * 580 * k, H * 0.56f, 540 * k, 120 * k);
    cw_color tint = p == 0 ? PINK : CYAN;
    if (u->present[p]) {
      in++;
      panel(r, alpha(tint, 0.85f), WHITE, 4 * k);
      text(cw_frame_printf("P%d  IN", p + 1), r.x, r.y + 28 * k, 60 * k, INK, CW_ALIGN_CENTER, r.w);
    } else {
      panel(r, cw_rgba(0.03f, 0.03f, 0.1f, 0.78f), alpha(tint, 0.8f), 4 * k);
      text(cw_frame_printf("P%d  PRESS START TO JOIN", p + 1), r.x, r.y + 38 * k, 36 * k, alpha(WHITE, 0.85f), CW_ALIGN_CENTER, r.w);
    }
  }
  text(in ? "PRESS START AGAIN TO FIGHT" : "PRESS START TO JOIN", 0, H * 0.74f, 64 * k, alpha(AMBER, blink(u->ticks)), CW_ALIGN_CENTER, W);
  text("MOVE ARROWS OR D-PAD    ATTACK Z OR X    JUMP SPACE OR A    GRAB X OR B    SPECIAL C OR Y    DASH SHIFT OR RB", 0, H * 0.90f, 28 * k,
       alpha(WHITE, 0.9f), CW_ALIGN_CENTER, W);
}

/* ── HUD ───────────────────────────────────────────────────────────────────────────────────────────────────────── */

static void draw_tag(const ui_state *u, int p, float W, float H, float k) {
  float w = 420 * k, h = 96 * k, x = p == 0 ? 40 * k : W - w - 40 * k, y = H - h - 36 * k;
  cw_color tint = p == 0 ? PINK : CYAN;
  if (!u->present[p]) {
    if (u->phase == NR_PH_FIGHT || u->phase == NR_PH_UPGRADE)
      text(cw_frame_printf("P%d  START TO JOIN", p + 1), x, y + 30 * k, 34 * k, alpha(WHITE, 0.55f * blink(u->ticks) + 0.2f), p == 0 ? CW_ALIGN_LEFT : CW_ALIGN_RIGHT, w);
    return;
  }
  panel(cw_rect_make(x, y, w, h), cw_rgba(0.02f, 0.02f, 0.07f, 0.72f), alpha(tint, 0.9f), 4 * k);
  text(cw_frame_printf("P%d", p + 1), x + 18 * k, y + 8 * k, 52 * k, tint, CW_ALIGN_LEFT, 0);
  float bx = x + 120 * k, by = y + 52 * k, bw = w - 140 * k, bh = 22 * k;
  float f = u->hp_max > 0 ? (float)u->hp[p] / (float)u->hp_max : 0.0f;
  if (f < 0.0f) f = 0.0f;
  cw_r2d_rect(cw_rect_make(bx, by, bw, bh), cw_rgba(0.12f, 0.1f, 0.18f, 1.0f));
  cw_r2d_rect(cw_rect_make(bx, by, bw * f, bh), f > 0.34f ? tint : AMBER);
  if (u->away[p]) text("PAD OFF", bx, y + 8 * k, 34 * k, AMBER, CW_ALIGN_LEFT, 0);
}

static void draw_hud(const ui_state *u, float W, float H, float k) {
  panel(cw_rect_make(40 * k, 32 * k, 360 * k, 130 * k), cw_rgba(0.02f, 0.02f, 0.07f, 0.72f), alpha(CYAN, 0.9f), 4 * k);
  int wave = u->wave > 0 ? u->wave : 1;
  text(cw_frame_printf("WAVE %d / %d", wave, u->wave_total), 40 * k, 40 * k, 60 * k, WHITE, CW_ALIGN_CENTER, 360 * k);
  text(cw_frame_printf("LIVES %d", u->lives), 40 * k, 100 * k, 52 * k, u->lives > 1 ? AMBER : PINK, CW_ALIGN_CENTER, 360 * k);
  for (int p = 0; p < NR_PLAYERS; p++) draw_tag(u, p, W, H, k);
}

/* ── upgrade, clear, game over ─────────────────────────────────────────────────────────────────────────────────── */

static void card(float x, float y, float w, float h, const char *name, const char *what, const char *key, cw_color tint, float a) {
  panel(cw_rect_make(x, y, w, h), cw_rgba(0.03f, 0.03f, 0.1f, 0.9f * a), alpha(tint, a), 6);
  text(name, x, y + 40, 84, alpha(tint, a), CW_ALIGN_CENTER, w);
  text(what, x + 50, y + 170, 40, alpha(WHITE, a), CW_ALIGN_CENTER, w - 100);
  text(key, x, y + h - 100, 56, alpha(AMBER, a), CW_ALIGN_CENTER, w);
}

static void draw_upgrade(const ui_state *u, float W, float H, float k) {
  cw_r2d_rect(cw_rect_make(0, 0, W, H), cw_rgba(0.0f, 0.0f, 0.04f, 0.68f));
  text("CHOOSE YOUR SPECIAL", 0, H * 0.12f, 100 * k, WHITE, CW_ALIGN_CENTER, W);
  text(u->lockout_left > 0 ? "GET READY" : "FIRST PRESS WINS    FOR EVERY PLAYER, TO THE END OF THE STREET", 0, H * 0.27f, 42 * k, AMBER, CW_ALIGN_CENTER, W);
  float a = u->lockout_left > 0 ? 0.45f : 1.0f, cw = 780 * k, ch = 480 * k, y = H * 0.38f;
  card(W * 0.5f - cw - 30 * k, y, cw, ch, "KNOCKBACK", "A RING OF FORCE THAT SHOVES EVERY ENEMY AWAY AND STAGGERS A HEAVY", "PRESS LEFT", PINK, a);
  card(W * 0.5f + 30 * k, y, cw, ch, "DASH", "A FAST STRIKE ALONG THE FLOOR THAT HITS EVERYONE IN ITS PATH", "PRESS RIGHT", CYAN, a);
}

static void draw_end(const ui_state *u, float W, float H, float k, const char *title, cw_color tint, const char *line) {
  cw_r2d_rect(cw_rect_make(0, H * 0.18f, W, H * 0.52f), cw_rgba(0.0f, 0.0f, 0.04f, 0.7f));
  text(title, 0, H * 0.22f, 160 * k, tint, CW_ALIGN_CENTER, W);
  text(line, 0, H * 0.44f, 52 * k, WHITE, CW_ALIGN_CENTER, W);
  text(cw_frame_printf("LIVES LEFT %d", u->lives), 0, H * 0.54f, 52 * k, AMBER, CW_ALIGN_CENTER, W);
  text("PRESS BACKSPACE OR PAD BACK FOR THE TITLE", 0, H * 0.62f, 40 * k, alpha(WHITE, blink(u->ticks)), CW_ALIGN_CENTER, W);
}

void ui_draw(const ui_state *u) {
  cw_r2d_begin(&(cw_r2d_pass_desc){ .clear = false });
  cw_vec2 c = cw_r2d_canvas_size();
  float W = c.x, H = c.y, k = H / 1080.0f;
  switch (u->phase) {
    case NR_PH_TITLE: draw_title(u, W, H, k); break;
    case NR_PH_FIGHT: draw_hud(u, W, H, k); break;
    case NR_PH_UPGRADE: draw_hud(u, W, H, k); draw_upgrade(u, W, H, k); break;
    case NR_PH_CLEAR: draw_hud(u, W, H, k); draw_end(u, W, H, k, "ARENA CLEAR", CYAN, "THE BLOCK IS YOURS"); break;
    case NR_PH_GAMEOVER: draw_hud(u, W, H, k); draw_end(u, W, H, k, "GAME OVER", PINK, "THE LIVES ARE SPENT    START DOES NOTHING HERE"); break;
    default: break;
  }
  cw_r2d_end();
}
