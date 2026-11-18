/*
 * layout.js - the single source of truth for WHERE things are.
 *
 * Everything here is plain data + tiny geometry helpers (no three.js):
 *   - rooms of the (invented) school building and the outdoor zones,
 *   - wall pieces / lintels / doorways generated from wall "lines" with gaps,
 *   - collision shapes (boxes, circles, segments) and the resolver used by the
 *     player and the NPCs,
 *   - placements of big props (buses, trees, parked cars, furniture lists)
 *     so that world.js (drawing), nav.js (pathing) and people.js agree.
 *
 * Coordinates: metres, ground = [X, Z], +Z is toward the boulevard (front).
 */
(function () {
  'use strict';
  var S = window.CAMPUS = window.CAMPUS || {};
  var site = S.site;
  var L = S.layout = {};

  // ---------------------------------------------------------------- constants
  var T = L.T = 0.3;           // wall thickness
  var WALL_H = L.WALL_H = 4;   // normal wall height
  var GYM_H = L.GYM_H = 8;     // gym wall height
  var DOOR_H = L.DOOR_H = 2.7; // top of a doorway (lintel starts here)
  L.worldBox = { x0: -150, x1: 165, z0: -135, z1: 112 };
  L.schoolColor = site.schoolColor || '#E20A19';

  // deterministic random numbers so the world is the same every load
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  L.rng = rng;

  function pip(poly, x, z) { // point in polygon (poly = [[x,z],...])
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }
  L.pip = pip;

  // ------------------------------------------------------------------- rooms
  // type: class | special | staff | hall | common | stair.  floor/wall are accent colours.
  // level: 0 = ground floor, 1 = second floor, 2 = stair tower (spans both).
  var FLOOR_H = L.FLOOR_H = 4.4;   // height of the second floor's floor surface
  var H2 = 4.4;                    // ground walls under the second floor reach the upper floor
  var rooms = L.rooms = [];
  var roomById = L.roomById = {};
  function room(id, name, type, x0, x1, z0, z1, floor, wall, extra) {
    var r = { id: id, name: name, type: type, x0: x0, x1: x1, z0: z0, z1: z1, level: 0,
      floor: floor, wall: wall, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
    if (extra) for (var k in extra) r[k] = extra[k];
    rooms.push(r); roomById[id] = r; return r;
  }

  // Grade accent colours (door frame, wall stripe, rug) and lighter floor tints.
  var GRADES = L.grades = [
    { name: 'Pre-K', accent: '#FF8FB8', floor: '#FBC3DA' },
    { name: 'Kindergarten', accent: '#FFC02E', floor: '#FFE08A' },
    { name: '1st Grade', accent: '#4FB0F0', floor: '#A9DBF8' },
    { name: '2nd Grade', accent: '#5CC84E', floor: '#B3E8A8' },
    { name: '3rd Grade', accent: '#9A6CEA', floor: '#CDB5F5' },
    { name: '4th Grade', accent: '#FF8A33', floor: '#FFC896' },
    { name: '5th Grade', accent: '#34C2B0', floor: '#9CE3D8' }
  ];
  L.gradeNames = GRADES.map(function (g) { return g.name; });
  // Grade groups share lunch / recess / specials times (see people.js)
  L.groupOfGrade = [0, 0, 0, 1, 1, 2, 2];

  // Wings are 24 m wide and run from the hallway (Z=8) back to Z=-28, with a 4 m wing
  // hall in the middle and 4 rooms (10 x 9 m) per side.  Two on the ground, two stacked
  // on top of them on the second floor.
  // Slot s: band = floor(s/2) (0 = nearest the hallway), side = s%2 (0 west, 1 east).
  var BANDS = L.bands = [[-1, 8], [-10, -1], [-19, -10], [-28, -19]];
  var WINGS = L.wings = [
    { id: 'wingA', level: 0, name: 'Pre-K & Kinder Hall', accent: '#FF8FB8', runner: '#FFB3CF', x0: -40, x1: -16, slots: [['c', 0, 'A'], ['c', 0, 'B'], ['c', 0, 'C'], ['c', 1, 'A'], ['c', 1, 'B'], ['c', 1, 'C'], ['c', 1, 'D'], ['counselor']] },
    { id: 'wingB', level: 0, name: '1st & 2nd Grade Hall', accent: '#4FB0F0', runner: '#9ED2F6', x0: -16, x1: 8, slots: [['c', 2, 'A'], ['c', 2, 'B'], ['c', 2, 'C'], ['c', 2, 'D'], ['c', 3, 'A'], ['c', 3, 'B'], ['c', 3, 'C'], ['c', 3, 'D']] },
    { id: 'wingC', level: 1, name: '3rd & 4th Grade Hall', accent: '#9A6CEA', runner: '#C9AEF5', x0: -40, x1: -16, slots: [['c', 4, 'A'], ['c', 4, 'B'], ['c', 4, 'C'], ['c', 4, 'D'], ['c', 5, 'A'], ['c', 5, 'B'], ['c', 5, 'C'], ['c', 5, 'D']] },
    { id: 'wingD', level: 1, name: '5th Grade & Labs Hall', accent: '#34C2B0', runner: '#8EE0D3', x0: -16, x1: 8, slots: [['c', 6, 'A'], ['c', 6, 'B'], ['c', 6, 'C'], ['c', 6, 'D'], ['art'], ['stem'], ['computer'], ['resource']] }
  ];
  L.classes = [];        // the 27 grade classrooms: {id, grade, sec, room}
  L.bandRooms = [];      // all 32 wing rooms
  WINGS.forEach(function (w) {
    w.cx = (w.x0 + w.x1) / 2; w.hx0 = w.cx - 2; w.hx1 = w.cx + 2;
    w.slots.forEach(function (sl, s) {
      var band = BANDS[Math.floor(s / 2)], west = (s % 2 === 0);
      var rx0 = west ? w.x0 : w.hx1, rx1 = west ? w.hx0 : w.x1;
      var id, name, type = 'class', floor, wall, extra = { wing: w.id, band: Math.floor(s / 2), doorSide: west ? 'E' : 'W', level: w.level };
      if (sl[0] === 'c') {
        var g = GRADES[sl[1]];
        id = 'c_' + sl[1] + sl[2]; name = g.name + ' ' + sl[2]; floor = g.floor; wall = g.accent;
        extra.grade = sl[1]; extra.sec = sl[2]; extra.desks = true;
      } else {
        var info = { counselor: ['Counselor', 'staff', '#E7D2F5', '#B88AE0', false], stem: ['STEM Lab', 'special', '#CBD6EC', '#5E7DB8', true],
          computer: ['Computer Lab', 'special', '#CFE9F2', '#3FA5C4', true], resource: ['Resource Room', 'staff', '#EAE3C8', '#C9B35E', true],
          art: ['Art', 'special', '#FFD7A0', '#FFB758', true] }[sl[0]];
        id = sl[0]; name = info[0]; type = info[1]; floor = info[2]; wall = info[3]; extra.desks = info[4]; extra.grade = -1;
      }
      var r = room(id, name, type, rx0, rx1, band[0], band[1], floor, wall, extra);
      L.bandRooms.push(r);
      if (sl[0] === 'c') L.classes.push({ id: id, grade: sl[1], sec: sl[2], room: r });
    });
    room(w.id, w.name, 'hall', w.hx0, w.hx1, -28, 8, '#EFE7D6', '#F7EBD3', { wing: w.id, level: w.level });
  });
  // hallways
  room('hall', 'Main Hallway', 'hall', -52, 56, 8, 12, '#EFE7D6', '#F7EBD3');
  room('uphall', 'Upper Hallway', 'hall', -42, 10, 8, 12, '#EFE7D6', '#F7EBD3', { level: 1 });
  room('sidehall', 'Side Hall', 'hall', 40, 43, 12, 40, '#EFE7D6', '#F7EBD3');
  // stair towers: ground landing, one straight flight along X, upper landing.
  // x0f/x1f = bottom / top of the flight (y rises linearly from 0 to FLOOR_H between them).
  L.stairs = [
    room('stairW', 'West Stairs', 'stair', -52, -40, 2, 8, '#D9D2C2', '#F7EBD3', { level: 2, xBot: -50, xTop: -42 }),
    room('stairE', 'East Stairs', 'stair', 8, 20, 2, 8, '#D9D2C2', '#F7EBD3', { level: 2, xBot: 18, xTop: 10 })
  ];
  // front row
  room('gym', 'Gym', 'special', -40, -16, 12, 40, '#E3B56E', '#F2C078');
  room('cafe', 'Cafeteria', 'common', -16, 4, 12, 40, '#F4EFE2', '#8CC8F0');
  room('lobby', 'Lobby', 'common', 4, 12, 12, 40, '#F6E3C0', L.schoolColor);
  room('office', 'Front Office', 'common', 12, 22, 26, 40, '#B7C9E2', '#8DA9D4');
  room('nurse', 'Nurse', 'common', 12, 22, 12, 26, '#CDEFE8', '#7FD6C4');
  room('library', 'Library', 'special', 22, 40, 12, 40, '#D9A86C', '#C58F52');
  room('music', 'Music', 'special', 43, 56, 12, 26, '#C7A8F0', '#A47DEB');
  room('lounge', 'Teacher Lounge', 'staff', 43, 56, 26, 40, '#F5D9C6', '#E58C5F');
  L.specialRooms = ['gym', 'music', 'art', 'library', 'stem', 'computer'];
  L.building = { x0: -52, x1: 56, z0: -28, z1: 40 };          // bounding box (the courtyard is inside it)

  // --------------------------------------------------------- levels / stairs
  function inRect0(r, x, z) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }
  L.stairAt = function (x, z) {
    for (var i = 0; i < 2; i++) { var s = L.stairs[i]; if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s; }
    return null;
  };
  // height of the walking surface in a stair tower at x
  L.stairY = function (s, x) {
    var t = (x - s.xBot) / (s.xTop - s.xBot);
    return FLOOR_H * (t < 0 ? 0 : t > 1 ? 1 : t);
  };
  // Put a mover {x, z, level} on its walking surface: sets .y, and inside a stair tower
  // switches .level at mid-height so the right floor's walls apply.  Returns the stair or null.
  L.surface = function (m) {
    var s = L.stairAt(m.x, m.z);
    if (s) { m.y = L.stairY(s, m.x); m.level = m.y > FLOOR_H / 2 ? 1 : 0; }
    else m.y = m.level ? FLOOR_H : 0;
    return s;
  };
  L.surfaceY = function (x, z, level) { var s = L.stairAt(x, z); return s ? L.stairY(s, x) : (level ? FLOOR_H : 0); };
  // room of a given level at (x,z) (stair towers count for both levels)
  L.roomAt = function (x, z, level) {
    for (var i = 0; i < rooms.length; i++) { var r = rooms[i]; if ((r.level === level || r.level === 2) && inRect0(r, x, z)) return r; }
    return null;
  };

  // ---------------------------------------------------------------- colliders
  // boxes: {x0,z0,x1,z1,npc,h,lv}. npc=true blocks NPC physics too, h = wall height
  // (only walls have h).  lv = floor the collider belongs to (0 ground + outdoors, 1 upstairs).
  // navBlock: furniture that must be avoided when routing between hubs.
  var boxes = L.boxes = [], circles = L.circles = [], segs = L.segs = [];
  L.curLevel = 0;                                             // level given to colliders added via addBox
  L.addBox = function (x0, z0, x1, z1, npc, extra) {
    var b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), npc: !!npc, lv: L.curLevel };
    if (extra) for (var k in extra) b[k] = extra[k];
    boxes.push(b); return b;
  };
  L.addCircle = function (x, z, r, npc) { circles.push({ x: x, z: z, r: r, npc: !!npc, lv: L.curLevel }); };
  L.addSeg = function (x0, z0, x1, z1, r) { segs.push({ x0: x0, z0: z0, x1: x1, z1: z1, r: r || 0.15 }); };

  // ------------------------------------------------------------------- walls
  var walls = L.walls = [];     // visible solid pieces {x0,z0,x1,z1,h,lv,ext}
  var lintels = L.lintels = []; // over doorways {x0,z0,x1,z1,y0,y1,ext,room,lv}
  var doors = L.doors = [];     // {axis,c,g0,g1,kind,ext,x,z,w,room,lv}
  var LV = 0;                   // level of the walls being added
  // gap = [g0, g1, kind, roomId]; kind 'door' (lintel), 'open' (no lintel,
  // recorded), 'void' (no lintel, not recorded)
  function addWall(axis, c, a0, a1, h, gaps, ext) {
    gaps = (gaps || []).slice().sort(function (p, q) { return p[0] - q[0]; });
    var half = T / 2;
    function piece(s, e, extS, extE) {
      if (e - s < 0.02) return;
      if (extS) s -= half;
      if (extE) e += half;
      var w = axis === 'x' ? { x0: s, x1: e, z0: c - half, z1: c + half, h: h }
                           : { x0: c - half, x1: c + half, z0: s, z1: e, h: h };
      w.lv = LV; w.ext = !!ext; w.y0 = LV * FLOOR_H;
      walls.push(w);
      L.curLevel = LV; L.addBox(w.x0, w.z0, w.x1, w.z1, true, { h: h, y0: w.y0 }); L.curLevel = 0;
    }
    var cur = a0, first = true;
    for (var i = 0; i < gaps.length; i++) {
      var g = gaps[i];
      piece(cur, g[0], first, false);
      first = false; cur = g[1];
      if (g[2] === 'void') continue;
      var open = g[2] === 'open';
      var d = { axis: axis, c: c, g0: g[0], g1: g[1], kind: open ? 'open' : 'door', ext: !!ext, h: h, room: g[3], lv: LV };
      d.x = axis === 'x' ? (g[0] + g[1]) / 2 : c; d.z = axis === 'x' ? c : (g[0] + g[1]) / 2; d.w = g[1] - g[0];
      doors.push(d);
      if (!open) {
        lintels.push(axis === 'x'
          ? { x0: g[0], x1: g[1], z0: c - half, z1: c + half, y0: DOOR_H, y1: h, ext: !!ext, room: g[3], lv: LV }
          : { x0: c - half, x1: c + half, z0: g[0], z1: g[1], y0: DOOR_H, y1: h, ext: !!ext, room: g[3], lv: LV });
      }
    }
    piece(cur, a1, first, true);
  }
  // partitions + wing hall walls of one wing (same on both floors)
  function wingWalls(w, h) {
    [-1, -10, -19].forEach(function (zd) { addWall('x', zd, w.x0, w.x1, h, [[w.hx0, w.hx1, 'void']]); });
    var gW = [], gE = [];
    BANDS.forEach(function (b, bi) {
      var cz = (b[0] + b[1]) / 2;
      var west = L.bandRooms.filter(function (r) { return r.wing === w.id && r.band === bi && r.doorSide === 'E'; })[0];
      var east = L.bandRooms.filter(function (r) { return r.wing === w.id && r.band === bi && r.doorSide === 'W'; })[0];
      gW.push([cz - 1, cz + 1, 'door', west.id]); gE.push([cz - 1, cz + 1, 'door', east.id]);
    });
    addWall('z', w.hx0, -28, 8, h, gW);          // a 2 m doorway per room, doorways facing each other
    addWall('z', w.hx1, -28, 8, h, gE);
  }

  // ===== ground floor =====
  LV = 0;
  addWall('x', -28, -40, 8, H2, [[-29.5, -26.5, 'door'], [-5.5, -2.5, 'door']], true);          // back wall, a 3 m door per wing hall
  // hallway north wall: stair doors, wing hall openings, courtyard door
  addWall('x', 8, -52, 20, H2, [[-52, -50, 'door', 'stairW'], [-30, -26, 'void'], [-6, -2, 'void'], [18, 20, 'door', 'stairE']]);
  addWall('x', 8, 20, 56, WALL_H, [[36.5, 39.5, 'door']], true);                                 // courtyard side (windows + door)
  wingWalls(WINGS[0], H2); wingWalls(WINGS[1], H2);
  addWall('z', -16, -28, 8, H2);
  addWall('z', -40, -28, 8, H2, null, true);                                   // wing A west wall / west tower east wall
  addWall('z', 8, -28, 8, H2, null, true);                                     // wing B east wall / east tower west wall
  addWall('z', -52, 2, 12, H2, [[8, 12, 'door']], true);                       // west tower + west exterior door
  addWall('x', 2, -52, -40, H2, null, true);
  addWall('x', 2, 8, 20, H2, null, true);
  addWall('z', 20, 2, 8, H2, null, true);
  addWall('z', 56, 8, 40, WALL_H, [[8, 12, 'door']], true);                    // east wall + east door
  // front row
  addWall('x', 12, -52, -40, WALL_H, null, true);                              // hallway south wall west of the gym
  addWall('x', 12, -40, -16, GYM_H, [[-38, -35, 'door', 'gym']]);              // hallway | gym
  addWall('x', 12, -16, 12, H2, [[-7.5, -4.5, 'door', 'cafe'], [4, 12, 'open']]);                // cafeteria, lobby
  addWall('x', 12, 12, 56, WALL_H, [[16, 18, 'door', 'nurse'], [29.8, 32.2, 'door', 'library'], [40, 43, 'open']]);
  addWall('x', 26, 12, 22, WALL_H);                                            // nurse | office
  addWall('x', 26, 43, 56, WALL_H);                                            // music | lounge
  addWall('x', 40, -40, -16, GYM_H, null, true);                               // gym front wall
  addWall('x', 40, -16, 56, WALL_H, [[6, 10, 'door']], true);                  // front wall + main entrance (4 m)
  addWall('z', -40, 12, 40, GYM_H, null, true);                                // gym west wall
  addWall('z', -16, 12, 40, GYM_H);                                            // gym | cafeteria
  addWall('z', 4, 12, 40, WALL_H);                                             // cafeteria | lobby
  addWall('z', 12, 12, 40, WALL_H, [[33, 35, 'door', 'office']]);              // lobby | nurse+office (office door)
  addWall('z', 22, 12, 40, WALL_H);                                            // nurse+office | library
  addWall('z', 40, 12, 40, WALL_H);                                            // library | side hall
  addWall('z', 43, 12, 40, WALL_H, [[18, 20, 'door', 'music'], [32, 34, 'door', 'lounge']]);     // side hall | music, lounge

  // ===== second floor (wall heights are relative to its floor) =====
  LV = 1;
  addWall('x', -28, -40, 8, WALL_H, null, true);                               // back wall (windows only)
  addWall('x', 8, -52, -42, WALL_H, null, true);                               // back of the west tower (outside)
  addWall('x', 8, -42, 10, WALL_H, [[-42, -40, 'door', 'stairW'], [-30, -26, 'void'], [-6, -2, 'void'], [8, 10, 'door', 'stairE']]);   // upper hallway north wall (indoors)
  addWall('x', 8, 10, 20, WALL_H, null, true);                                 // back of the east tower (outside)
  addWall('x', 12, -42, 10, WALL_H, null, true);                               // upper hallway south wall (windows)
  addWall('z', -42, 8, 12, WALL_H, null, true); addWall('z', 10, 8, 12, WALL_H, null, true);
  wingWalls(WINGS[2], WALL_H); wingWalls(WINGS[3], WALL_H);
  addWall('z', -16, -28, 8, WALL_H);
  addWall('z', -40, -28, 8, WALL_H, null, true);
  addWall('z', 8, -28, 8, WALL_H, null, true);
  addWall('z', -52, 2, 8, WALL_H, null, true); addWall('x', 2, -52, -40, WALL_H, null, true);    // tower tops
  addWall('x', 2, 8, 20, WALL_H, null, true); addWall('z', 20, 2, 8, WALL_H, null, true);
  LV = 0;

  // windows: glass panes applied to the walls (visual only), exterior walls only
  var windows = L.windows = [];
  function win(axis, c, at, w, y0, y1, lv) { windows.push({ axis: axis, c: c, at: at, w: w, y0: y0, y1: y1, lv: lv || 0 }); }
  L.bandRooms.forEach(function (r) {
    if (r.band === 3) { win('x', -28, r.cx - 2.3, 2.0, 1.2, 2.6, r.level); win('x', -28, r.cx + 2.3, 2.0, 1.2, 2.6, r.level); }
    if (r.x0 === -40 && !(r.band === 0)) win('z', -40, r.cz, 3.0, 1.2, 2.6, r.level);     // band 0 is behind the stair tower
    if (r.x1 === 8 && !(r.band === 0)) win('z', 8, r.cz, 3.0, 1.2, 2.6, r.level);
  });
  [-28, -4].forEach(function (x) { win('x', -28, x, 2.4, 1.0, 2.8, 1); });                 // upper wing hall ends
  [-12, -6, 0, 6].forEach(function (x) { win('x', 12, x, 2.6, 1.2, 2.8, 1); });   // upper hallway, over the front roof (west of x=-16 the taller gym wall is in the way)
  [24, 28, 32, 44, 48, 52].forEach(function (x) { win('x', 8, x, 2.6, 1.1, 2.7, 0); });   // main hallway onto the courtyard
  [[-46, -52], [14, 20]].forEach(function (q) { win('x', 2, q[0], 3.0, 1.2, 2.8, 0); win('x', 2, q[0], 3.0, 1.2, 2.8, 1); });   // stair towers
  [-36, -30, -24, -18].forEach(function (x) { win('x', 40, x, 3.2, 4.6, 6.8); });          // gym front (high)
  [-13, -9, -3, 1].forEach(function (x) { win('x', 40, x, 2.4, 1.1, 2.7); });              // cafeteria
  [14.5, 19.5].forEach(function (x) { win('x', 40, x, 2.4, 1.1, 2.7); });                  // office
  [25, 31, 37].forEach(function (x) { win('x', 40, x, 3.0, 1.1, 2.7); });                  // library
  [47, 53].forEach(function (x) { win('x', 40, x, 2.4, 1.1, 2.7); });                      // lounge
  [16, 22].forEach(function (z) { win('z', 56, z, 2.4, 1.1, 2.7); });                      // music (east)
  [30, 36].forEach(function (z) { win('z', 56, z, 2.4, 1.1, 2.7); });                      // lounge (east)
  [17, 23, 29, 35].forEach(function (z) { win('z', -40, z, 3.0, 4.6, 6.8); });             // gym west (high)

  // ------------------------------------------------------------- classrooms
  // Local frame of a band room: d = distance from the door wall into the room,
  // o = offset along Z from the room centre.  Desks face the whiteboard on the
  // far wall; chairs sit on the door side of each desk.  Aisles run at o=-2,0,2.
  L.classLayout = function (r) {
    var sgn = r.doorSide === 'E' ? -1 : 1;
    var base = r.doorSide === 'E' ? r.x1 : r.x0;
    function W(d, o) { return { x: base + sgn * d, z: r.cz + o }; }
    var heading = sgn < 0 ? -Math.PI / 2 : Math.PI / 2;      // facing the far wall
    var rowD = [3.6, 6.2], offs = [-3, -1, 1, 3], aisleO = [-2, 0, 2], chairD = [rowD[0] - 0.85, rowD[1] - 0.85];
    var desks = [], i, j;
    for (i = 0; i < 2; i++) for (j = 0; j < 4; j++) {
      var dp = W(rowD[i], offs[j]), cp = W(chairD[i], offs[j]);
      desks.push({ x: dp.x, z: dp.z, cx: cp.x, cz: cp.z, ri: i, ci: j, heading: heading, rot: sgn < 0 ? 1 : 0 });
    }
    return { W: W, sgn: sgn, heading: heading, desks: desks, rowD: rowD, chairD: chairD, offs: offs, aisleO: aisleO,
      door: W(1.1, 0), doorOut: W(-1.2, 0), front: W(8.4, 0), board: W(9.82, 0), teacherDesk: W(8.7, 3.2), rug: W(7.7, -1.2) };
  };
  L.classLayouts = {};
  L.bandRooms.forEach(function (r) { r.cl = L.classLayouts[r.id] = L.classLayout(r); });

  // --------------------------------------------------- other furniture lists
  var F = L.F = {};
  // cafeteria: long tables along X, benches either side; stage on the south wall
  F.cafeTables = [];
  [-10.5, -1.5].forEach(function (cx) { [16, 20.2, 24.4, 28.6, 32.8].forEach(function (cz) { F.cafeTables.push({ x: cx, z: cz, len: 6.5 }); }); });
  F.cafeStage = { x0: -12, x1: -4, z0: 37.5, z1: 39.85, h: 0.6 };
  F.cafeCounter = { x0: 3.0, x1: 3.85, z0: 15, z1: 27 };
  // library
  F.libTables = [{ x: 27, z: 21, len: 3.0 }, { x: 35, z: 21, len: 3.0 }];
  F.libRug = { x: 31, z: 32, r: 3.2 };
  F.libBeanbags = [];
  for (var bi = 0; bi < 6; bi++) {
    var ba = bi / 6 * Math.PI * 2 + 0.3;
    F.libBeanbags.push({ x: 31 + Math.cos(ba) * 2.3, z: 32 + Math.sin(ba) * 2.3,
      color: ['#FF6B6B', '#4FB0F0', '#FFD23F', '#7BD88F', '#B590F0', '#FF9F5A'][bi] });
  }
  F.libCounter = { x0: 33.6, x1: 37.6, z0: 13.2, z1: 14.4 };
  F.libShelves = [ // wall shelves + two free-standing double-sided rows
    { x0: 22.2, x1: 23.1, z0: 15, z1: 38.5 }, { x0: 38.9, x1: 39.8, z0: 15, z1: 38.5 },
    { x0: 25.5, x1: 26.4, z0: 26, z1: 36 }, { x0: 35.6, x1: 36.5, z0: 26, z1: 36 }];
  // music room
  F.musicRisers = [{ x0: 51, x1: 52.4, h: 0.25 }, { x0: 52.4, x1: 53.8, h: 0.5 }, { x0: 53.8, x1: 55.1, h: 0.75 }];
  F.musicRiserZ = [14.6, 24.4];
  F.piano = { x: 46.8, z: 14.9, w: 1.5, d: 2.0 };
  F.drums = { x: 49.2, z: 23.2 };
  // teacher lounge (ground floor, next to Music)
  F.loungeSofas = [{ x: 54.6, z: 30, ry: -Math.PI / 2 }, { x: 54.6, z: 36, ry: -Math.PI / 2 }];
  F.loungeTable = { x: 49, z: 33, r: 0.9 };
  // courtyard: planters with small trees, benches, picnic tables
  F.planters = [{ x: 28, z: -4 }, { x: 46, z: -4 }, { x: 28, z: -18 }, { x: 46, z: -18 }];
  F.courtBenches = [{ x: 24, z: 4.5, rot: Math.PI }, { x: 50, z: 4.5, rot: Math.PI }, { x: 37, z: -22, rot: 0 }];
  F.courtTables = [{ x: 33, z: -11 }, { x: 41, z: -11 }];
  // gym
  F.court = { x0: -35, x1: -21, z0: 14.6, z1: 37.4 };
  F.hoops = [{ x: -28, z: 12.2, dir: 1 }, { x: -28, z: 39.8, dir: -1 }];
  // lobby / office / nurse
  F.lobbyBench = { x0: 4.2, x1: 5.0, z0: 29, z1: 33 };
  F.trophyCase = { x0: 11.15, x1: 11.85, z0: 17, z1: 23 };
  F.officeCounters = [{ x0: 14.2, x1: 15.0, z0: 26.6, z1: 32 }, { x0: 14.2, x1: 15.0, z0: 36, z1: 39.4 }];
  F.officeDesks = [{ x: 18.8, z: 30 }, { x: 18.8, z: 37.5 }];
  F.cots = [{ x: 20.4, z: 15, len: 1.9 }, { x: 20.4, z: 19.5, len: 1.9 }];
  F.nurseDesk = { x: 14.2, z: 17.8 };

  // ---------------------------------------------------------------- outdoors
  var Z = L.zones = {
    playground: { name: 'Playground', x0: -30, x1: 10, z0: -72, z1: -38 },
    field: { name: 'Sports Field', x0: -125, x1: -55, z0: -75, z1: 5 },
    court: { name: 'Basketball Court', x0: 20, x1: 48, z0: -60, z1: -42 },
    garden: { name: 'Garden', x0: 60, x1: 78, z0: -25, z1: -10 },
    pavilion: { name: 'Pavilion', x0: -54, x1: -42, z0: -52, z1: -40 },
    courtyard: { name: 'Courtyard', x0: 8, x1: 56, z0: -28, z1: 8 }
  };
  L.track = { cx: -90, cz: -35, halfStraight: 5, rOut: 35, rIn: 29 };
  L.driveStrip = { x0: -64, x1: 104, z0: 58, z1: 66 };
  L.walkway = { x0: 6, x1: 10, z0: 40, z1: 58 };
  L.parkingPoly = site.parking;
  L.groundsPoly = site.grounds;

  // inside the building rectangle? (used to hide the roof)
  // inside the school building? (ground footprint incl. stair towers; the courtyard is outdoors)
  L.insideBuilding = function (x, z, level) {
    if (level === 1) return true;
    for (var i = 0; i < rooms.length; i++) { var r = rooms[i]; if (r.level !== 1 && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true; }   // inclusive: doorways sit exactly on room edges
    return false;
  };
  L.placeAt = function (x, z, level) {
    var r = L.roomAt(x, z, level || 0);
    // only places that exist on two storeys say which floor they are on
    if (r) return (r.wing || r.id === 'hall' || r.id === 'uphall' || r.level === 2) ? r.name + (level ? ' \u00b7 2nd floor' : ' \u00b7 1st floor') : r.name;
    if (level === 1) return 'Second Floor';
    for (var k in Z) if (inRect0(Z[k], x, z)) return Z[k].name;
    if (pip(L.parkingPoly, x, z)) return 'Parking Lot';
    if (x > 95 && x < 105 && z > 6 && z < 58) return 'Parking Link Road';
    if (inRect0(L.driveStrip, x, z)) return 'Drop-off Lane';
    if (z >= 86 && z <= 108) return 'Maple Boulevard';
    if (x > -54 && x < -40 && z > 99) return 'Star Lane';
    if (z > 68 && z < 86) return 'Campus Entrance';
    if (z >= 40 && z < 58 && x > -62 && x < 100) return 'Front Lawn';
    if (z >= -20 && z < -4 && x > -48 && x < 62) return 'Back Lawn';
    if (inRect0({ x0: -57, x1: 100, z0: -20, z1: 60 }, x, z)) return 'Schoolyard';
    if (pip(L.groundsPoly, x, z)) return 'School Grounds';
    return 'Neighborhood';
  };

  // buses parked in the drop-off lane (long side along X, doors face the school)
  L.buses = [{ x: -10, z: 63, len: 10.5, wid: 2.6 }, { x: 34, z: 63, len: 10.5, wid: 2.6 }];
  L.buses.forEach(function (b) { L.addBox(b.x - b.len / 2, b.z - b.wid / 2, b.x + b.len / 2, b.z + b.wid / 2, true); });

  // school sign, flagpole
  L.sign = { x: -6, z: 50, w: 8.4, h: 2.4 };
  L.addBox(L.sign.x - 4.2, L.sign.z - 0.25, L.sign.x + 4.2, L.sign.z + 0.25, true);
  L.flag = { x: 22, z: 48 };
  L.addCircle(L.flag.x, L.flag.z, 0.3, true);

  // playground equipment (positions; world.js draws them)
  L.play = {
    tower: { x: -22, z: -64 },          // slide tower 2.6 x 2.6, slide goes +X
    swings: { x: -4, z: -66, w: 7.2 },  // swing set frame along X
    dome: { x: -13, z: -50, r: 2.2 },   // climbing dome
    riders: [{ x: 3, z: -48 }, { x: 5.5, z: -51.5 }, { x: 3, z: -55 }],
    benches: [{ x: -26, z: -41, rot: 0 }, { x: 1, z: -40.5, rot: 0 }, { x: 7.5, z: -62, rot: Math.PI / 2 }]
  };
  var P = L.play;
  L.addBox(P.tower.x - 1.4, P.tower.z - 1.4, P.tower.x + 1.4, P.tower.z + 1.4, true);
  L.addBox(P.tower.x + 1.4, P.tower.z - 0.6, P.tower.x + 4.4, P.tower.z + 0.6, false); // slide run (player only)
  L.addBox(P.swings.x - P.swings.w / 2 - 0.5, P.swings.z - 0.5, P.swings.x - P.swings.w / 2 + 0.5, P.swings.z + 0.5, true);
  L.addBox(P.swings.x + P.swings.w / 2 - 0.5, P.swings.z - 0.5, P.swings.x + P.swings.w / 2 + 0.5, P.swings.z + 0.5, true);
  L.addCircle(P.dome.x, P.dome.z, P.dome.r - 0.1, true);
  P.riders.forEach(function (p) { L.addCircle(p.x, p.z, 0.6, false); });
  P.benches.forEach(function (b) {
    if (b.rot) L.addBox(b.x - 0.4, b.z - 1.0, b.x + 0.4, b.z + 1.0, false);
    else L.addBox(b.x - 1.0, b.z - 0.4, b.x + 1.0, b.z + 0.4, false);
  });

  // basketball court (outdoor)
  L.courtHoops = [{ x: 21.6, z: -51, dir: 1 }, { x: 46.4, z: -51, dir: -1 }];
  L.courtHoops.forEach(function (h) { L.addCircle(h.x - h.dir * 0.4, h.z, 0.25, false); });
  L.tetherballs = [{ x: 52.5, z: -47 }, { x: 52.5, z: -54 }];
  L.tetherballs.forEach(function (t) { L.addCircle(t.x, t.z, 0.25, false); });

  // soccer goals on the infield
  L.goals = [{ x: -90, z: -67, dir: 1 }, { x: -90, z: -3, dir: -1 }];

  // garden beds (3 x 2 grid)
  L.gardenBeds = [];
  for (var gx = 0; gx < 3; gx++) for (var gz = 0; gz < 2; gz++) {
    var bx = 64 + gx * 6, bz = -21.5 + gz * 7;
    L.gardenBeds.push({ x: bx, z: bz, w: 4.2, d: 2.6 });
    L.addBox(bx - 2.1, bz - 1.3, bx + 2.1, bz + 1.3, false);
  }
  // pavilion picnic tables
  L.picnicTables = [{ x: -50, z: -48, rot: 0 }, { x: -46, z: -43.5, rot: 0 }];
  L.picnicTables.forEach(function (t) { L.addBox(t.x - 1.2, t.z - 0.9, t.x + 1.2, t.z + 0.9, false); });
  L.addBox(-54, -52, -53.6, -51.6, true); L.addBox(-42.4, -52, -42, -51.6, true);
  L.addBox(-54, -40.4, -53.6, -40, true); L.addBox(-42.4, -40.4, -42, -40, true);

  // ------------------------------------------------------------ parking lot
  var pk = L.parking = { stalls: [], lines: [], cars: [] };
  var rowsX = [86.4, 98.2, 103.7], depth = 5.5, sw = 2.7;
  rowsX.forEach(function (x0) {
    for (var z = -71; z < 6; z += sw) {
      var cx = x0 + depth / 2, cz = z + sw / 2;
      var ok = [[x0 + .3, z + .2], [x0 + depth - .3, z + .2], [x0 + .3, z + sw - .2], [x0 + depth - .3, z + sw - .2]]
        .every(function (p) { return pip(site.parking, p[0], p[1]); });
      if (ok) { pk.stalls.push({ x: cx, z: cz, x0: x0 }); }
    }
  });
  (function () {
    var r = rng(77), pool = pk.stalls.slice(), colors = ['#E24B4B', '#3E8EDE', '#F2C230', '#4CB86B', '#9A6CEA', '#FF8A33', '#F4F4F4', '#2F3B52', '#E96AA8', '#35B8C8'];
    for (var i = 0; i < 15 && pool.length; i++) {
      var k = Math.floor(r() * pool.length), s = pool.splice(k, 1)[0];
      var car = { x: s.x, z: s.z, rot: r() < 0.5 ? 0 : Math.PI, color: colors[i % colors.length] };
      pk.cars.push(car);
      L.addBox(car.x - 2.1, car.z - 0.95, car.x + 2.1, car.z + 0.95, true);
    }
  })();

  // ------------------------------------------------------------------ fence
  // Along the grounds polygon, skipping the road (front) side.
  L.fence = [];
  (function () {
    var g = site.grounds;
    for (var i = 0; i < g.length - 1; i++) {
      var a = g[i], b = g[i + 1];
      if ((a[1] + b[1]) / 2 > 75) continue;        // road side stays open
      L.fence.push([a[0], a[1], b[0], b[1]]);
      L.addSeg(a[0], a[1], b[0], b[1], 0.2);
    }
  })();

  // ---------------------------------------------------------------- houses
  L.houses = site.houses.map(function (h, hi) {
    var o = h.outline, last = o[o.length - 1];
    var pts = (o[0][0] === last[0] && o[0][1] === last[1]) ? o.slice(0, -1) : o.slice();
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      L.addSeg(a[0], a[1], b[0], b[1], 0.15);
    }
    return { id: 'house' + hi, pts: pts, height: h.height * 0.7 };
  });

  // ------------------------------------------------------------------ trees
  L.trees = []; L.bushes = [];
  (function () {
    var r = rng(2024);
    var b = L.building;
    function distToSeg(px, pz, s) {
      var dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
      var t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / l2)) : 0;
      return Math.hypot(px - (s[0] + t * dx), pz - (s[1] + t * dz));
    }
    function blocked(x, z) {
      if (x > b.x0 - 8 && x < b.x1 + 8 && z > b.z0 - 9 && z < b.z1 + 8) return true;      // building + ring path
      if (x > 1 && x < 15 && z > 38 && z < 60) return true;                                 // walkway
      if (x > -14 && x < 0 && z > 44 && z < 54) return true;                                // sign
      if (x > 18 && x < 26 && z > 44 && z < 52) return true;                                // flagpole
      if (z > 54) return true;                                                               // drive + road
      if (x > 80 && x < 120 && z > -80 && z < 62) return true;                               // parking + link
      if (x > -58 && x < -38 && z > 5 && z < 14) return true;                                // west path
      for (var k in Z) { var q = Z[k]; if (x > q.x0 - 3 && x < q.x1 + 3 && z > q.z0 - 3 && z < q.z1 + 3) return true; }
      if (x > -128 && x < -52 && z > -78 && z < 8) return true;                              // track
      if (z > -45 && z < -26 && x > -50 && x < 62) return true;                              // back door paths
      if (x > 52 && x < 86 && z > 5 && z < 14) return true;                                  // east path
      if (!pip(site.grounds, x, z)) return true;
      for (var i = 0; i < L.fence.length; i++) if (distToSeg(x, z, L.fence[i]) < 5) return true;
      for (i = 0; i < L.trees.length; i++) if (Math.hypot(L.trees[i].x - x, L.trees[i].z - z) < 9) return true;
      return false;
    }
    var tries = 0;
    while (L.trees.length < 46 && tries++ < 6000) {
      var x = -135 + r() * 270, z = -125 + r() * 195;
      if (blocked(x, z)) continue;
      L.trees.push({ x: x, z: z, s: 0.85 + r() * 0.7, kind: r() < 0.35 ? 1 : 0, hue: r() });
      L.addCircle(x, z, 0.45, false);
    }
    // bushes: foundation planting along the front wall plus a few on lawns
    [-37, -33, -29, -25, -21, -16, -12, -8, -3, 15, 19, 23, 27, 31, 36, 41, 47, 53].forEach(function (bx, i) {
      L.bushes.push({ x: bx, z: 41.2 + (i % 2) * 0.1, s: 0.7 + r() * 0.35, hue: r() });
    });
    for (var n = 0; n < 12; n++) {
      var bx2 = -130 + r() * 260, bz2 = -120 + r() * 160;
      if (!blocked(bx2, bz2)) { L.bushes.push({ x: bx2, z: bz2, s: 0.8 + r() * 0.5, hue: r() }); L.addCircle(bx2, bz2, 0.7, false); }
    }
  })();

  // ------------------------------------------------------------- collision
  // Push a circle (x,z,r) out of every box / circle / segment.  Returns the
  // module-level result object {x,z} (do not keep a reference).
  var res = { x: 0, z: 0 };
  L.resolve = function (x, z, r, npcOnly, level) {
    level = level || 0;
    var xi = x, zi = z, moved, i, pass;
    for (pass = 0; pass < 3; pass++) {
      moved = false;
      for (i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.lv !== level || (npcOnly && !b.npc)) continue;
        if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
        var cx = x < b.x0 ? b.x0 : (x > b.x1 ? b.x1 : x);
        var cz = z < b.z0 ? b.z0 : (z > b.z1 ? b.z1 : z);
        var dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; z += dz * k;
        } else { // centre inside the box: leave through the nearest face
          var l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bt = b.z1 - z, m = Math.min(l, rr, t, bt);
          if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r;
        }
        moved = true;
      }
      for (i = 0; i < circles.length; i++) {
        var c = circles[i];
        if (c.lv !== level || (npcOnly && !c.npc)) continue;
        var ex = x - c.x, ez = z - c.z, rr2 = r + c.r, e2 = ex * ex + ez * ez;
        if (e2 >= rr2 * rr2) continue;
        var e = Math.sqrt(e2) || 1e-4; x = c.x + ex / e * rr2; z = c.z + (e2 > 1e-9 ? ez / e : 1) * rr2; moved = true;
      }
      if (!npcOnly && !level) {
        for (i = 0; i < segs.length; i++) {
          var s = segs[i];
          var minx = Math.min(s.x0, s.x1) - r - s.r, maxx = Math.max(s.x0, s.x1) + r + s.r;
          if (x < minx || x > maxx) continue;
          var minz = Math.min(s.z0, s.z1) - r - s.r, maxz = Math.max(s.z0, s.z1) + r + s.r;
          if (z < minz || z > maxz) continue;
          var sx = s.x1 - s.x0, sz = s.z1 - s.z0, l2 = sx * sx + sz * sz;
          var u = l2 ? Math.max(0, Math.min(1, ((x - s.x0) * sx + (z - s.z0) * sz) / l2)) : 0;
          var px = s.x0 + u * sx, pz = s.z0 + u * sz, qx = x - px, qz = z - pz, q2 = qx * qx + qz * qz, need = r + s.r;
          if (q2 >= need * need) continue;
          var q = Math.sqrt(q2);
          if (q < 1e-6) { qx = -sz; qz = sx; q = Math.hypot(qx, qz) || 1; }
          x = px + qx / q * need; z = pz + qz / q * need; moved = true;
        }
      }
      if (!moved) break;
    }
    // Walls always win: finish with wall-only passes, so that furniture (or a crowd of colliders in
    // a corner) can never leave a mover inside or beyond a wall.  A centre that ended up inside a
    // wall is put back on the side the move started from (xi, zi).
    for (pass = 0; pass < 4; pass++) {
      moved = false;
      for (i = 0; i < boxes.length; i++) {
        b = boxes[i];
        if (!b.h || b.lv !== level) continue;
        if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
        cx = x < b.x0 ? b.x0 : (x > b.x1 ? b.x1 : x); cz = z < b.z0 ? b.z0 : (z > b.z1 ? b.z1 : z);
        dx = x - cx; dz = z - cz; d2 = dx * dx + dz * dz;
        if (d2 >= r * r - 1e-9) continue;
        if (d2 > 1e-9) { d = Math.sqrt(d2); k = (r - d) / d; x += dx * k; z += dz * k; }
        else {
          var ax = xi < b.x0 ? b.x0 : (xi > b.x1 ? b.x1 : xi), az = zi < b.z0 ? b.z0 : (zi > b.z1 ? b.z1 : zi);
          var nx = xi - ax, nz = zi - az, nl = Math.hypot(nx, nz);
          if (nl > 1e-6) { x = ax + nx / nl * r; z = az + nz / nl * r; }
          else { l = x - b.x0; rr = b.x1 - x; t = z - b.z0; bt = b.z1 - z; m = Math.min(l, rr, t, bt); if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r; }
        }
        moved = true;
      }
      if (!moved) break;
    }
    var wb = L.worldBox;
    x = Math.max(wb.x0, Math.min(wb.x1, x)); z = Math.max(wb.z0, Math.min(wb.z1, z));
    res.x = x; res.z = z; return res;
  };

  // is a point inside any (npc) wall box?  (used by tests)
  L.insideSolid = function (x, z, r, npcOnly, level) {
    level = level || 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i]; if (b.lv !== level || (npcOnly && !b.npc)) continue;
      if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return b;
    }
    return null;
  };

  // segment (a->b) vs boxes inflated by `margin`.  Mode 'nav': walls + npc boxes +
  // navBlock furniture + npc circles.  Used for hub visibility.
  L.segBlocked = function (ax, az, bx, bz, margin, furnMargin, level) {
    var i; level = level || 0;
    for (i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.lv !== level) continue;
      var m = b.npc ? margin : (b.navBlock ? furnMargin : -1);
      if (m < 0) continue;
      if (segBox(ax, az, bx, bz, b.x0 - m, b.z0 - m, b.x1 + m, b.z1 + m)) return true;
    }
    for (i = 0; i < circles.length; i++) {
      var c = circles[i]; if (!c.npc || c.lv !== level) continue;
      if (segDist(ax, az, bx, bz, c.x, c.z) < c.r + margin) return true;
    }
    return false;
  };
  function segDist(ax, az, bx, bz, px, pz) {
    var dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    var t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  }
  // Liang-Barsky slab test, scalar (no allocation).  Returns the entry parameter t0 in [0,1] or -1.
  function segEntry(ax, az, bx, bz, x0, z0, x1, z1) {
    var t0 = 0, t1 = 1, dx = bx - ax, dz = bz - az, t;
    if (dx === 0) { if (ax < x0 || ax > x1) return -1; }
    else {
      t = (x0 - ax) / dx; var u = (x1 - ax) / dx;
      if (t > u) { var w = t; t = u; u = w; }
      if (t > t0) t0 = t; if (u < t1) t1 = u; if (t0 > t1) return -1;
    }
    if (dz === 0) { if (az < z0 || az > z1) return -1; }
    else {
      t = (z0 - az) / dz; u = (z1 - az) / dz;
      if (t > u) { w = t; t = u; u = w; }
      if (t > t0) t0 = t; if (u < t1) t1 = u; if (t0 > t1) return -1;
    }
    return t0;
  }
  function segBox(ax, az, bx, bz, x0, z0, x1, z1) { return segEntry(ax, az, bx, bz, x0, z0, x1, z1) >= 0; }

  // Line-of-sight test (talk prompt): first fraction t in [0,1] along p->c where a wall
  // (inflated by `margin`, and taller than the ray at that point) is hit; 1 if clear.
  L.rayWall = function (px, py, pz, cx, cy, cz, margin, level) {
    var best = 1, m = margin || 0; level = level || 0;
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i]; if (w.lv !== level) continue;
      var t = segEntry(px, pz, cx, cz, w.x0 - m, w.z0 - m, w.x1 + m, w.z1 + m);
      if (t >= 0 && t < best && py + (cy - py) * t < w.h + 0.2) best = t;
    }
    return best;
  };
  // Close pockets narrower than the player (< 0.7 m) between furniture boxes, or between
  // furniture and a wall, with invisible bridge boxes so nobody can wedge in.  Called once
  // after every collider has been registered.  Wall-to-wall gaps (doorways) are never touched.
  L.fixNarrowGaps = function () {
    var MIN = 0.7, add = [], n = boxes.length, i, j;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var a = boxes[i], b = boxes[j];
      if (a.lv !== b.lv || (a.h && b.h)) continue;
      if (a.bridge || b.bridge) continue;
      var oz0 = Math.max(a.z0, b.z0), oz1 = Math.min(a.z1, b.z1), ox0 = Math.max(a.x0, b.x0), ox1 = Math.min(a.x1, b.x1), g;
      if (oz1 - oz0 > 0.05) {                                   // side by side along X
        g = a.x1 <= b.x0 ? b.x0 - a.x1 : (b.x1 <= a.x0 ? a.x0 - b.x1 : -1);
        if (g > 0.001 && g < MIN) { var xa = a.x1 <= b.x0 ? a.x1 : b.x1, xb = a.x1 <= b.x0 ? b.x0 : a.x0; add.push([xa, oz0, xb, oz1, a.lv]); }
      }
      if (ox1 - ox0 > 0.05) {                                   // along Z
        g = a.z1 <= b.z0 ? b.z0 - a.z1 : (b.z1 <= a.z0 ? a.z0 - b.z1 : -1);
        if (g > 0.001 && g < MIN) { var za = a.z1 <= b.z0 ? a.z1 : b.z1, zb = a.z1 <= b.z0 ? b.z0 : a.z0; add.push([ox0, za, ox1, zb, a.lv]); }
      }
    }
    add.forEach(function (q) { L.addBox(q[0], q[1], q[2], q[3], false, { bridge: true, lv: q[4] }); });
    return add.length;
  };
})();
