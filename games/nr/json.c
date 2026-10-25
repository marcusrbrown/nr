/* json: the shared JSON reader. See json.h. */
#include "json.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "cartwheel/core.h"
#include "cartwheel/platform.h"

typedef struct { const char *p, *end; bool bad; } jcur;

void nr_json_free(nr_json *v) {
  if (!v) return;
  for (int i = 0; i < v->count; i++) {
    nr_json_free(v->kid[i]);
    if (v->key) free(v->key[i]);
  }
  free(v->kid);
  free(v->key);
  free(v->str);
  free(v);
}

static void skip_space(jcur *c) {
  while (c->p < c->end && isspace((unsigned char)*c->p)) c->p++;
}

static char *read_string(jcur *c) {
  if (c->p >= c->end || *c->p != '"') { c->bad = true; return NULL; }
  c->p++;
  size_t cap = 16, len = 0;
  char *out = malloc(cap);
  while (c->p < c->end && *c->p != '"') {
    char ch = *c->p++;
    if (ch == '\\' && c->p < c->end) {
      char e = *c->p++;
      ch = e == 'n' ? '\n' : e == 't' ? '\t' : e == 'r' ? '\r' : e; /* \uXXXX does not occur in the game's files */
    }
    if (len + 1 >= cap) out = realloc(out, cap *= 2);
    out[len++] = ch;
  }
  if (c->p >= c->end) { c->bad = true; free(out); return NULL; }
  c->p++;
  out[len] = 0;
  return out;
}

static nr_json *read_value(jcur *c) {
  skip_space(c);
  if (c->p >= c->end) { c->bad = true; return NULL; }
  nr_json *v = calloc(1, sizeof *v);
  char ch = *c->p;
  if (ch == '{' || ch == '[') {
    bool obj = ch == '{';
    v->type = obj ? NR_JSON_OBJ : NR_JSON_ARR;
    c->p++;
    skip_space(c);
    int cap = 0;
    if (c->p < c->end && *c->p == (obj ? '}' : ']')) { c->p++; return v; }
    for (;;) {
      if (v->count == cap) {
        cap = cap ? cap * 2 : 8;
        v->kid = realloc(v->kid, (size_t)cap * sizeof *v->kid);
        if (obj) v->key = realloc(v->key, (size_t)cap * sizeof *v->key);
      }
      char *key = NULL;
      if (obj) {
        skip_space(c);
        key = read_string(c);
        skip_space(c);
        if (c->bad || c->p >= c->end || *c->p != ':') { free(key); c->bad = true; break; }
        c->p++;
      }
      nr_json *item = read_value(c);
      if (!item) { free(key); break; }
      if (obj) v->key[v->count] = key;
      v->kid[v->count++] = item;
      skip_space(c);
      if (c->p < c->end && *c->p == ',') { c->p++; continue; }
      if (c->p < c->end && *c->p == (obj ? '}' : ']')) { c->p++; return v; }
      c->bad = true;
      break;
    }
    nr_json_free(v);
    return NULL;
  }
  if (ch == '"') {
    v->type = NR_JSON_STR;
    v->str = read_string(c);
    if (!v->str) { free(v); return NULL; }
    return v;
  }
  if (!strncmp(c->p, "true", 4) || !strncmp(c->p, "false", 5)) {
    v->type = NR_JSON_BOOL;
    v->num = c->p[0] == 't';
    c->p += v->num != 0.0 ? 4 : 5;
    return v;
  }
  if (!strncmp(c->p, "null", 4)) { c->p += 4; return v; }
  char *e;
  v->type = NR_JSON_NUM;
  v->num = strtod(c->p, &e);
  if (e == c->p) { c->bad = true; free(v); return NULL; }
  c->p = e;
  return v;
}

nr_json *nr_json_parse(const char *text, size_t len) {
  jcur cur = { text, text + len, false };
  nr_json *root = read_value(&cur);
  if (!root || cur.bad) {
    nr_json_free(root);
    return NULL;
  }
  return root;
}

nr_json *nr_json_load(const char *path, const char *who) {
  size_t len = 0;
  char *text = cw_asset_load(path, &len);
  if (!text) {
    cw_error("%s: %s is missing", who, path);
    return NULL;
  }
  nr_json *root = nr_json_parse(text, len);
  free(text);
  if (!root || root->type != NR_JSON_OBJ) {
    cw_error("%s: %s is not valid JSON", who, path);
    nr_json_free(root);
    return NULL;
  }
  return root;
}

const nr_json *nr_json_get(const nr_json *o, const char *key) {
  if (!o || o->type != NR_JSON_OBJ) return NULL;
  for (int i = 0; i < o->count; i++)
    if (!strcmp(o->key[i], key)) return o->kid[i];
  return NULL;
}

const nr_json *nr_json_at(const nr_json *a, int i) { return a && a->type == NR_JSON_ARR && i >= 0 && i < a->count ? a->kid[i] : NULL; }
double nr_json_num(const nr_json *v, double fallback) { return v && v->type == NR_JSON_NUM ? v->num : fallback; }
const char *nr_json_str(const nr_json *v) { return v && v->type == NR_JSON_STR ? v->str : NULL; }
bool nr_json_bool(const nr_json *v) { return v && v->type == NR_JSON_BOOL && v->num != 0.0; }

unsigned nr_json_color(const nr_json *v, unsigned fallback) {
  if (!v || v->type != NR_JSON_STR || v->str[0] != '#') return fallback;
  return (unsigned)strtoul(v->str + 1, NULL, 16);
}
