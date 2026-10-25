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
  t3_material *material;
} nr_atlas;

/* Loads atlases/<name>.json, .png and -n.png through the asset system. `pixels_per_unit` sizes the planes; with
 * `flat_normals` the normal map is replaced by a flat one of the same size (the control build of the lit-side check).
 * Returns false and reports through cw_error when a file is missing or the manifest is not one this loader reads
 * (one page, one atlas page's frames). */
bool nr_atlas_load(nr_atlas *a, const char *name, float pixels_per_unit, bool flat_normals);

/* Index of a clip by name, or -1. */
int nr_clip_index(const nr_atlas *a, const char *name);

/* The atlas frame of a clip `ticks` fixed ticks (60 Hz) after it started: a looping clip wraps, a one-shot holds its
 * last frame. Integer arithmetic only: frame k starts at the first tick whose elapsed time reaches k * ms. */
int nr_clip_frame_at(const nr_atlas *a, int clip, int32_t ticks);

/* The frame index within the clip (0-based) for the same arguments. */
int nr_clip_step_at(const nr_atlas *a, int clip, int32_t ticks);

#endif
