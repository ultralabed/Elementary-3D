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

## Lively characters

Everybody is still drawn with the same few instanced meshes (torso, head, hair, eyes, two arms, two legs, backpack); `js/behavior.js` only sets per-character pose values (head turn and nod, arm angle and splay, leg offset, lean, hop, sway) that `people.js` turns into matrices, plus two small extra instanced meshes: a lunch tray (one per character) and 28 shared balls (+2 draw calls). Seated students watch the teacher, write, glance at neighbours and raise a hand now and then (about one in eight at any time); teachers pace the front, face the class, point at the board and sometimes walk an aisle. At lunch the students queue along the counter wall, shuffle forward, carry a tray to their own seat and eat; at recess they swing, climb and use the slide, play tag, basketball, kickball and jump rope, or sit on benches chatting; PE jogs, does jumping jacks and passes balls; classes walk to lunch and specials in a loose line behind their teacher and a few kids wave when you pass. Full animation runs within about 35 m of the camera on the player's floor; further away characters are position-only.

## Class size and the school day

There are 27 classrooms with `CAMPUS.config.studentsPerClass` children each (18, so 486 students plus the staff; `index.html?spc=12` loads a smaller school for testing). Desks, chairs, cubbies, seats in the specials rooms and the school day all follow that one number. Every class has its own timetable: a 40 minute specials period (the room comes from the classroom number, the slot from the building order so two classes never share a room), a 25 minute lunch in one of five waves of four to six classrooms (the cafeteria seats 120, the serving line along the counter wall holds 26 and five trays are handed out at a time; anybody who cannot get a place in the line waits at their own seat) and a 30 minute recess in the playground, on the field or on the court. Arrival and dismissal are spread over the arrival and dismissal periods, class lines keep about 0.9 m between children (1.3 m on the stairs, where two lanes are used) and the stair flights never back up.

## Sound credits

The crowd sound is made of three public-domain recordings (PDSounds, via Wikimedia Commons), mixed by how many characters are nearby: "Ambient classroom mono" by rcrossley, "Kids next door" by ezwa and "High school cafeteria" by aradlaw. They live in `audio/` and are listed in `audio/manifest.json`; `python3 tools/build_artifact.py` refreshes the list and embeds them in `dist/artifact.html`. Any of the three may be missing. Recordings load over http(s) (not from a `file://` page); everything else (bell, footsteps, wind, birds, ...) is synthesized, and talking to a character uses the browser's own speech synthesis.

## Disclaimer

A made-up cartoon school. Ground shapes are based on OpenStreetMap data; the building, rooms and everyone in it are fictional. The school day is a pretend schedule.

Map data © OpenStreetMap contributors (ODbL).

## Code map

`js/site-data.js` ground outline shapes (grounds, parking, roads, houses) - `layout.js` rooms on both floors, stairs, walls, colliders, placements - `world.js` / `interior.js` scenery and building interior (merged geometry + instancing) - `nav.js` waypoint graph and routing - `people.js` roster, schedule, instanced character rendering - `player.js` controls and camera - `hud.js` DOM HUD and minimap - `audio.js` all sound, synthesized with the Web Audio API (no audio files) - `main.js` renderer, loop, `CAMPUS.debug` test handle.
