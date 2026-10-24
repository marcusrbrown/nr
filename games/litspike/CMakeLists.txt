# Two apps from one source file: `litspike` draws LITSPIKE_ACTORS_BASELINE lit sprite actors and `litspike_stress`
# LITSPIKE_ACTORS_STRESS. The count is a compile definition, so no input script can change it.
set(LITSPIKE_ACTORS_BASELINE 3)
set(LITSPIKE_ACTORS_STRESS 40)

# Control build: every actor's normal map is a flat (0, 0, 1) map. The program state is the same as the
# normal-mapped build's; only the texels differ.
option(LITSPIKE_FLAT_NORMALS "Replace the actors' normal map with a flat one (control build)" OFF)

# Measurement build (outside the simulation): one-pixel readback per frame with per-frame wall times.
option(LITSPIKE_PERF "Read a pixel back every frame and publish per-frame wall times (measurement build)" OFF)

set(LITSPIKE_ASSETS ${CMAKE_CURRENT_SOURCE_DIR}/assets/roots.txt)
# Program table manifest; a control build points it at a table with a row removed.
set(LITSPIKE_PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/programs/litspike.txt CACHE FILEPATH "three.c program table manifest")

foreach(app litspike litspike_stress)
  if(app STREQUAL "litspike")
    set(count ${LITSPIKE_ACTORS_BASELINE})
  else()
    set(count ${LITSPIKE_ACTORS_STRESS})
  endif()
  cw_add_app(${app} SOURCES main.c PACK ${LITSPIKE_ASSETS} PROGRAMS ${LITSPIKE_PROGRAMS})
  target_compile_definitions(${app} PRIVATE LITSPIKE_ACTORS=${count} LITSPIKE_PERF=$<BOOL:${LITSPIKE_PERF}>
    LITSPIKE_FLAT_NORMALS=$<BOOL:${LITSPIKE_FLAT_NORMALS}>)
  target_compile_options(${app} PRIVATE -ffp-contract=off -Wall -Wextra)
endforeach()

# both apps run cwpack on the same manifest and share its import cache: one at a time
add_dependencies(litspike_stress_pack litspike_pack)
