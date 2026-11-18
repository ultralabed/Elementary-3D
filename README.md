# Maple Star Elementary 3D

A browser-based cartoon walk-around of the made-up Maple Star Elementary campus. Walk around the grounds, step inside the two-storey (made-up) building, climb the stairs and watch a pretend school day: buses arrive, students go to class, lunch, recess, specials and dismissal. Everything is procedural geometry in plain HTML/CSS/JS with three.js r128 from cdnjs. There is no build step.

## Run

- Open `index.html` in a desktop browser (needs internet access for three.js from cdnjs), or
- serve the folder with any static server (`python3 -m http.server`) and open it, or
- publish the repo with GitHub Pages.

`python3 tools/build_artifact.py` writes `dist/artifact.html`, a single self-contained file (CSS and JS inlined, three.js still from cdnjs).

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | move (relative to the camera) |
| Shift | run |
| mouse drag, Q / E, left/right arrows | look around |
| mouse wheel | zoom, V toggles first person |
| F | talk to a nearby character |
| M | big map |
| T | fast time (x5) |
| N | sound on / off (also the speaker button) |
| H | help |

Touch: left side joystick, drag on the right to look.

## Sound credits

The crowd sound is made of three public-domain recordings (PDSounds, via Wikimedia Commons), mixed by how many characters are nearby: "Ambient classroom mono" by rcrossley, "Kids next door" by ezwa and "High school cafeteria" by aradlaw. They live in `audio/` and are listed in `audio/manifest.json`; `python3 tools/build_artifact.py` refreshes the list and embeds them in `dist/artifact.html`. Any of the three may be missing. Recordings load over http(s) (not from a `file://` page); everything else (bell, footsteps, wind, birds, ...) is synthesized, and talking to a character uses the browser's own speech synthesis.

## Disclaimer

A made-up cartoon school. Ground shapes are based on OpenStreetMap data; the building, rooms and everyone in it are fictional. The school day is a pretend schedule.

Map data © OpenStreetMap contributors (ODbL).

## Code map

`js/site-data.js` ground outline shapes (grounds, parking, roads, houses) - `layout.js` rooms on both floors, stairs, walls, colliders, placements - `world.js` / `interior.js` scenery and building interior (merged geometry + instancing) - `nav.js` waypoint graph and routing - `people.js` roster, schedule, instanced character rendering - `player.js` controls and camera - `hud.js` DOM HUD and minimap - `audio.js` all sound, synthesized with the Web Audio API (no audio files) - `main.js` renderer, loop, `CAMPUS.debug` test handle.
