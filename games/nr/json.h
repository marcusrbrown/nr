/* json: the small JSON reader the game's data files share (the atlas manifest written by tools/render/post.mjs, the
 * arena's layout.json and lights.json). A document is a tree of nr_json values; lookups return NULL (and the number,
 * string and bool accessors a default) for a missing key or a value of another type, so a reader states what it needs
 * and checks the few things that must be there. */
#ifndef NR_JSON_H
#define NR_JSON_H

#include <stdbool.h>
#include <stddef.h>

typedef enum { NR_JSON_NULL, NR_JSON_BOOL, NR_JSON_NUM, NR_JSON_STR, NR_JSON_ARR, NR_JSON_OBJ } nr_json_type;

typedef struct nr_json {
  nr_json_type type;
  double num;             /* a number; 0 or 1 for a bool */
  char *str;              /* a string */
  struct nr_json **kid;   /* array items, or object values */
  char **key;             /* object keys, parallel to `kid` */
  int count;              /* array items or object members */
} nr_json;

/* Parses `len` bytes of text. Returns NULL when the text is not one JSON value. The text is not kept. */
nr_json *nr_json_parse(const char *text, size_t len);

/* Reads `path` through the asset system and parses it; the root must be an object. Reports through cw_error as
 * "<who>: <path> is missing" or "<who>: <path> is not valid JSON" and returns NULL. */
nr_json *nr_json_load(const char *path, const char *who);

void nr_json_free(nr_json *v);

const nr_json *nr_json_get(const nr_json *object, const char *key);
const nr_json *nr_json_at(const nr_json *array, int index);
double nr_json_num(const nr_json *v, double fallback);
const char *nr_json_str(const nr_json *v);
bool nr_json_bool(const nr_json *v);

/* "#rrggbb" -> 0xrrggbb, or `fallback` for anything else. */
unsigned nr_json_color(const nr_json *v, unsigned fallback);

#endif
