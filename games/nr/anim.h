/* anim: a character atlas (colour sheet, normal sheet and manifest from tools/render/post.mjs) as three.c plane
 * geometries, one per frame, and clip playback by tick.
 *
 * All frames of a character share one material (colour map, plane-space normal map, nearest filtering, alpha test) and
 * one texture pair; the frame an actor shows is the geometry it holds. three.c batches draws by geometry and material
 * and applies the texture's UV transform per draw, so per-actor UV offsets would need a material each; per-frame
 * geometry keeps one material and lets actors on the same frame batch. */
#ifndef NR_ANIM_H
#define NR_ANIM_H

#include <stdbool.h>
#include <stdint.h>

#include "three.h"

#define NR_MAX_CLIPS 24
#define NR_CLIP_NAME 24

typedef struct {
  char name[NR_CLIP_NAME];
  int first, count; /* atlas frame index of the first frame, frames in the clip */
  int ms;           /* every frame's duration */
  bool loop;
} nr_clip;

typedef struct {
  int cell_w, cell_h;       /* texels of every frame */
  float pivot_x, pivot_y;   /* the ground anchor in texels from the cell's top-left, the same in every frame */
  float width, height;      /* plane size in world units (cell / pixels per unit) */
  int frame_count, clip_count;
  nr_clip clips[NR_MAX_CLIPS];
  t3_geometry **geom;       /* one plane per atlas frame, UVs on that frame's rect */
  t3_geometry **geom_flip;  /* the same planes with the frame's u range reversed: the frame facing left */
  t3_material *material;
} nr_atlas;

/* Loads atlases/<name>.json, .png and -n.png through the asset system. `pixels_per_unit` sizes the planes; with
 * `flat_normals` the normal map is replaced by a flat one of the same size (the control build of the lit-side check).
 * Returns false and reports through cw_error when a file is missing or the manifest is not one this loader reads
 * (one page, one atlas page's frames). */
bool nr_atlas_load(nr_atlas *a, const char *name, float pixels_per_unit, bool flat_normals);

/* The plane of atlas frame `frame`, mirrored when `flip` is set. A mirrored plane keeps the winding and the material of
 * the plain one (three.c does not turn the front face of a mirrored world matrix, so a negative x scale would cull the
 * plane); its u axis runs against world x, so the tangent frame that the normal map is read in flips with the picture
 * and a normal that pointed to the sprite's right points to the world's left. */
t3_geometry *nr_atlas_geometry(const nr_atlas *a, int frame, bool flip);

/* Index of a clip by name, or -1. */
int nr_clip_index(const nr_atlas *a, const char *name);

/* The hero's clips by role, in the order of tools/render/recipes/hero.json with the unrendered ones in place. A slot with
 * `gap` set has no frames in the atlas: the owner hand-keys it (profile clip not ready) and the render refuses it, so
 * its index resolves to -1 until the entry is cleared here and the clip is rendered. */
typedef enum {
  NR_HERO_IDLE, NR_HERO_WALK, NR_HERO_RUN, NR_HERO_HIT1, NR_HERO_HIT2, NR_HERO_HIT3, NR_HERO_JUMP, NR_HERO_JUMPKICK,
  NR_HERO_GRAB, NR_HERO_THROW, NR_HERO_HURT, NR_HERO_KNOCKDOWN, NR_HERO_GETUP, NR_HERO_DASH, NR_HERO_SPECIAL_KNOCKBACK,
  NR_HERO_SPECIAL_DASH, NR_HERO_CLIP_COUNT
} nr_hero_clip;

typedef struct {
  const char *name;
  bool gap;
} nr_clip_slot;

extern const nr_clip_slot nr_hero_clips[NR_HERO_CLIP_COUNT];

/* The grunt's and the heavy's clips, in the order of tools/render/recipes/grunt.json and heavy.json. */
typedef enum { NR_GRUNT_IDLE, NR_GRUNT_WALK, NR_GRUNT_ATTACK, NR_GRUNT_HURT, NR_GRUNT_KNOCKDOWN, NR_GRUNT_GETUP, NR_GRUNT_CLIP_COUNT } nr_grunt_clip;
typedef enum { NR_HEAVY_IDLE, NR_HEAVY_WALK, NR_HEAVY_ATTACK, NR_HEAVY_HURT, NR_HEAVY_STAGGER, NR_HEAVY_CLIP_COUNT } nr_heavy_clip;
extern const nr_clip_slot nr_grunt_clips[NR_GRUNT_CLIP_COUNT];
extern const nr_clip_slot nr_heavy_clips[NR_HEAVY_CLIP_COUNT];

/* Fills `index_out[i]` with the atlas clip index of `table[i]` (-1 for a gap slot). Returns false and reports through
 * cw_error when a slot that is not a gap has no clip in the atlas or a gap slot has one. */
bool nr_clips_resolve(const nr_atlas *a, const nr_clip_slot *table, int count, int *index_out);

/* The atlas frame of a clip `ticks` fixed ticks (60 Hz) after it started: a looping clip wraps, a one-shot holds its
 * last frame. Integer arithmetic only: frame k starts at the first tick whose elapsed time reaches k * ms. */
int nr_clip_frame_at(const nr_atlas *a, int clip, int32_t ticks);

/* The frame index within the clip (0-based) for the same arguments. */
int nr_clip_step_at(const nr_atlas *a, int clip, int32_t ticks);

#endif
