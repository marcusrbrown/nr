# Two apps from one source file: `spike` runs the baseline actor count and `spike_stress` the stress count.
# The count is a compile definition, so no input script can change it.
set(SPIKE_ACTORS_BASELINE 8)
set(SPIKE_ACTORS_STRESS 40)

# Control build: invert the ground-y depth mapping (the ordering gate must fail on it).
option(SPIKE_REVERSE_DEPTH "Invert the actor depth mapping (control build)" OFF)

# Measurement builds (outside the simulation): one-pixel readback per frame with per-frame wall times; a per-actor
# busy loop that must break the frame budget; the HUD glyph preload skipped.
option(SPIKE_PERF "Read a pixel back every frame and publish per-frame wall times (measurement build)" OFF)
option(SPIKE_PERF_CONTROL "Spin SPIKE_PERF_CONTROL_MS per actor per frame (budget control build)" OFF)
set(SPIKE_PERF_CONTROL_MS 0.5 CACHE STRING "Milliseconds the control build spins per actor per frame")
option(SPIKE_NO_PREWARM "Skip the HUD glyph preload (glyph-check control build)" OFF)

set(SPIKE_ASSETS ${CMAKE_CURRENT_SOURCE_DIR}/assets/roots.txt)
# Program table manifest; a control build points it at a table with a row removed.
set(SPIKE_PROGRAMS ${CMAKE_CURRENT_SOURCE_DIR}/programs/spike.txt CACHE FILEPATH "three.c program table manifest")

foreach(app spike spike_stress)
  if(app STREQUAL "spike")
    set(count ${SPIKE_ACTORS_BASELINE})
  else()
    set(count ${SPIKE_ACTORS_STRESS})
  endif()
  cw_add_app(${app} SOURCES main.c PACK ${SPIKE_ASSETS} PROGRAMS ${SPIKE_PROGRAMS})
  target_compile_definitions(${app} PRIVATE SPIKE_ACTORS=${count} SPIKE_REVERSE_DEPTH=$<BOOL:${SPIKE_REVERSE_DEPTH}>
    SPIKE_PERF=$<BOOL:${SPIKE_PERF}> SPIKE_PERF_CONTROL=$<BOOL:${SPIKE_PERF_CONTROL}>
    SPIKE_PERF_CONTROL_MS=${SPIKE_PERF_CONTROL_MS} SPIKE_NO_PREWARM=$<BOOL:${SPIKE_NO_PREWARM}>)
  target_compile_options(${app} PRIVATE -ffp-contract=off -Wall -Wextra)
endforeach()

# both apps run cwpack on the same manifest and share its import cache: one at a time
add_dependencies(spike_stress_pack spike_pack)
