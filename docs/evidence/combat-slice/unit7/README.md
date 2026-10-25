# Unit 7: title, join, upgrade choice, end screens, audio

The full game (`nr`) runs title -> fight -> upgrade pause -> fight -> clear | game over, natively and as a cart. The Unit 5 and
Unit 6 scripts and checks run on `nr_waves`, the same simulation with no title, upgrade pause or HUD, which keeps the tick-30
presence rule (`NR_PRESENCE_TICKS`) for scripted and bot runs only.

## Input map

| Where | Keyboard | Pad | Effect |
| --- | --- | --- | --- |
| Title | Return | start (pad 1 is player 2; keyboard and pad 0 are player 1) | a player that is not in joins (3 lives each into one pool); start again from a player that is in begins the fight |
| Fight | Return / start from an unused pad | start | joins that player at the left edge of the camera's frame, +3 lives, spawns alternate between both; start from a player that is in does nothing |
| Upgrade pause (after wave 2) | Left arrow / Right arrow | d-pad left / right | left = knockback special, right = dash special; ignored for the first 30 ticks; first press wins, lower port on the same tick; start from an unused pad joins during the pause |
| Clear, game over | Backspace | back | returns to the title (a new run; the tick counter goes on); start at game over is refused and counted |
| Fight | arrows, Z, Space, X, C, Left Shift | d-pad / stick, west, south, east, north, right shoulder | move, attack, jump, grab, special, dash (the dash variant is no longer a held key: the pause chooses it) |

`nr.demo = 2` (a host writes it) hands both players to the bot, which joins, begins, fights, picks the dash with player 2 and
presses back after the clear screen has been up for 300 ticks.

## Results

All rows pass; artifacts are in this directory. Hosts are native WebGPU, cart WebGPU (headless Chromium), native GL and cart GL.

| Scenario | Result | Artifact |
| --- | --- | --- |
| Title: nobody present until start, 3 lives per joined player, second start begins | ok | `ui-report.txt` |
| AE2: dash pick by player 2 is both heroes' special to the arena's end, knockback never returns (6 dash specials after the pick, 0 knockback) | ok | `upgrade-events.json` |
| Pause: only the tick counter moves | ok | `ui-report.txt` |
| Same-frame picks: lower port wins | ok | `ui-report.txt` |
| Joiner in the pause: joins (+3 lives), gets the pick, no second prompt | ok | `ui-report.txt` |
| AE3: pad 2 start mid-fight: stands at the camera's left edge, pool 3 -> 6, the next 6 spawns target 0,1,0,1,0,1 | ok | `join-events.json` |
| Start on an already-joined pad: no duplicate | ok | `join-events.json` |
| Full run twice: 55 nr.* fields byte-identical, checksum 1637854936, screenshot identical, equal to the bot's own run | ok | `full-determinism.json` |
| Clear -> title; game over: start refused, back -> title, start joins again | ok | `ui-report.txt` |
| Glyph bakes: 95 in frame 0 (control), 0 after it on the title, the fight, the upgrade screen and the clear screen | ok | `glyph-bakes.json` |
| Sound: hit, grab, special, hurt, confirm asked, counted with their ticks, played with voices, per-sound `max_voices` 3/2/2/3/2 | ok | `ui-report.txt` |
| Unit 5 and 6 sim-check on `nr_waves` / `nr_dummies` | 27 of 27 ok | (run output, not republished) |
| Hosts, Unit 7 scripts (6 runs x 4 hosts): state equal, `cw.three.missing` 0 | ok | `unit7-hosts.json` |
| Hosts, Unit 6 scripts on `nr_waves`, `nr_bot`, `nr_bot1` (5 runs x 4 hosts): state equal, `cw.three.missing` 0 | ok | (run output, not republished) |
| Program survey, 19 apps: no new state; `missing` empty everywhere | ok | (no table change) |
| WebGPU captures (title, HUD in the fight, upgrade, clear): native and cart state equal, 0 differing pixels | ok | `captures/captures.json` |
| romdev session `nr-unit7`: script state and the bot's `nr.demo=2` state at tick 2300 equal to native, checksum 1637854936 | ok | `romdev-state-f2300.json`, `romdev-calls.ndjson`, `romdev-screen-f*.png` |

The cart is left loaded on the title in the `nr-unit7` session, nothing playing (`romdev-left-at-title.png`).

## Knocked-down grunts that look translucent

Not an alpha or blend fault; see `translucency/README.md`. No pipeline or atlas change was made.

## Not verified

* The look and feel of the screens and sounds is for the owner; the sounds are generated placeholders (`assets/LICENSE-NOTICES.md`).
* Audio output was run against SDL's dummy driver (voices created and counted, nothing heard).
* A joiner after the pick (rather than during the pause) takes the chosen special by the same code path (`stand_at_edge`), but
  no script runs it.
* The glyph check proves no bake after frame 0 on the screens a run shows; it has no control build with the preload removed.
