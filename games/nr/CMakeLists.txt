# One source tree, several apps. `nr` is the game. The others are the checks' builds, all from the same sources:
#   nr_arena_bare             the street block without its actors (the control for the ordering check)
#   nr_stage                  the look checkpoint's plain stage: four fixed actors, no input
#   nr_bare                   that stage without its actors (the control for measuring their silhouettes)
#   nr_lit_h, nr_lit_v        one hero held on one frame under a light that sweeps along x or y
#   nr_lit_h_flat, ..._v_flat the same with a flat normal map (the control: the response must come from the normal map)
#   nr_solo_0 .. nr_solo_2    the hero under only neon light 0, 1 or 2
set(NR_ASSETS ${CMAKE_CURRENT_SOURCE_DIR}/assets/roots.txt)
# Program table manifest; a control build points it at a table with a row removed.
set(NR_PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/programs/nr.txt CACHE FILEPATH "three.c program table manifest")

# Control build: invert the actors' depth mapping (the ordering check must fail on it).
option(NR_REVERSE_DEPTH "Invert the actor depth mapping (control build)" OFF)

set(NR_APPS nr nr_arena_bare nr_stage nr_lit_h nr_lit_v nr_lit_h_flat nr_lit_v_flat nr_solo_0 nr_solo_1 nr_solo_2 nr_bare)
set(previous "")
foreach(app ${NR_APPS})
  set(lit 0)
  set(flat 0)
  set(bare 0)
  set(legacy 1)
  if(app MATCHES "^nr_lit_h")
    set(lit 1)
  elseif(app MATCHES "^nr_lit_v")
    set(lit 2)
  elseif(app MATCHES "^nr_solo_([0-2])$")
    math(EXPR lit "3 + ${CMAKE_MATCH_1}")
  elseif(app STREQUAL "nr_bare")
    set(bare 1)
  elseif(app STREQUAL "nr")
    set(legacy 0)
  elseif(app STREQUAL "nr_arena_bare")
    set(legacy 0)
    set(bare 1)
  endif()
  if(app MATCHES "_flat$")
    set(flat 1)
  endif()
  cw_add_app(${app} SOURCES main.c anim.c arena.c PACK ${NR_ASSETS} PROGRAMS ${NR_PROGRAMS})
  target_compile_definitions(${app} PRIVATE NR_LIT_TEST=${lit} NR_FLAT_NORMALS=${flat} NR_NO_HEROES=${bare}
    NR_STAGE_LEGACY=${legacy} NR_REVERSE_DEPTH=$<BOOL:${NR_REVERSE_DEPTH}>)
  target_compile_options(${app} PRIVATE -ffp-contract=off -Wall -Wextra)
  # the apps run cwpack on the same manifest and share its import cache: one at a time
  if(previous)
    add_dependencies(${app}_pack ${previous}_pack)
  endif()
  set(previous ${app})
endforeach()
