/*
 * people.js - the (entirely fictional) students and staff, the pretend school
 * day clock, their routines, walking along the nav graph, and rendering.
 *
 * Rendering: ALL characters (and the player) are drawn with a handful of
 * InstancedMeshes, one per body part (torso, head, hair, eyes, 2 arms, 2 legs,
 * backpack).  Per-instance colour comes from setColorAt, matrices are written
 * straight into the instance buffers each frame.  Hidden characters get a
 * zero-scale matrix.  Limbs are only animated near the camera.
 */
(function () {
  'use strict';
  if (!window.THREE) return;     // engine failed to load: main.js shows a message
  var S = window.CAMPUS, L = S.layout, nav = S.nav, THREE = window.THREE;
  var P = S.people = {};
  var U = S.world.util, C = U.C;

  // ===================================================== the pretend schedule
  // Game time is in minutes after midnight.
  var T = { ARRIVE: 450, MORNING: 480, LUNCH: 660, AFTERNOON: 750, DISMISS: 885, END: 930, RESET: 935, MORNING_RESTART: 435 };
  P.T = T;
  var clock = P.clock = { t: 7 * 60 + 38, fast: false, minPerSec: 0.3, now: 0 };   // a school day is about 28 real minutes
  P.blockName = function (t) {
    t = t === undefined ? clock.t : t;
    if (t < T.ARRIVE) return 'Before School';
    if (t < T.MORNING) return 'Arrival';
    if (t < T.LUNCH) return 'Morning Classes';
    if (t < T.AFTERNOON) return 'Lunch & Recess';
    if (t < T.DISMISS) return 'Afternoon Classes';
    if (t < T.END) return 'Dismissal';
    return 'After School';
  };
  // per grade-group schedule: [start minute, activity] (PK-1 / 2-3 / 4-5)
  var SCHED = [
    [[480, 'class'], [540, 'specials'], [585, 'class'], [660, 'lunch'], [690, 'recess'], [720, 'class']],
    [[480, 'class'], [600, 'specials'], [645, 'class'], [690, 'lunch'], [720, 'recess'], [750, 'class']],
    [[480, 'class'], [720, 'lunch'], [750, 'recess'], [780, 'class'], [810, 'specials'], [855, 'class']]
  ];
  P.activity = function (group, t) {
    t = t === undefined ? clock.t : t;
    if (t < T.ARRIVE) return 'hidden';
    if (t < T.MORNING) return 'arrive';
    if (t >= T.END) return 'hidden';
    if (t >= T.DISMISS) return 'dismiss';
    var s = SCHED[group], a = 'class';
    for (var i = 0; i < s.length; i++) if (t >= s[i][0]) a = s[i][1];
    return a;
  };
  P.fmtTime = function (t) {
    t = t === undefined ? clock.t : t;
    var h = Math.floor(t / 60) % 24, m = Math.floor(t % 60), ap = h >= 12 ? 'PM' : 'AM';
    return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  };

  // ============================================================== name lists
  var FIRST = ['Ava', 'Leo', 'Mia', 'Noah', 'Zoe', 'Max', 'Lily', 'Sam', 'Ella', 'Ben', 'Ruby', 'Jack', 'Nora', 'Theo', 'Ivy', 'Finn', 'Lucy', 'Owen', 'Maya', 'Eli',
    'Cora', 'Jude', 'Pia', 'Kai', 'Rosa', 'Dan', 'Tess', 'Gus', 'June', 'Cal', 'Wren', 'Abe', 'Luna', 'Hugo', 'Nina', 'Ravi', 'Sofia', 'Tom', 'Alma', 'Ty', 'Bea', 'Omar',
    'Daisy', 'Milo', 'Hazel', 'Jonah', 'Piper', 'Reed', 'Stella', 'Wes', 'Esme', 'Arlo', 'Tilly', 'Rex', 'Nell', 'Otis', 'Posy', 'Dean', 'Faye', 'Ivan', 'Greta', 'Basil',
    'Mabel', 'Colt', 'Lola', 'Emmett', 'Iris', 'Silas', 'Juno', 'Felix', 'Opal', 'Dex', 'Tori', 'Lars', 'Clara', 'Nico', 'Remy', 'Pearl', 'Gabe', 'Kira', 'Joel', 'Vera',
    'Cruz', 'Anya', 'Beau', 'Dina', 'Enzo', 'Fern', 'Gil', 'Hana', 'Ike', 'Jada', 'Kip', 'Lena', 'Moe', 'Neva', 'Orrin', 'Pru', 'Quin', 'Rita', 'Sven', 'Tula', 'Uma', 'Vik',
    'Wade', 'Xena', 'Yara', 'Zed'];
  var SURNAMES = ['Larkin', 'Pemberly', 'Fennimore', 'Oakhaven', 'Bellamy', 'Quimby', 'Thistlewood', 'Hargrove', 'Dunmore', 'Rosewater', 'Wickham', 'Ashgrove', 'Verity',
    'Tolliver', 'Kestrel', 'Brambles', 'Linden', 'Marlowe', 'Penhallow', 'Sutter', 'Calloway', 'Ferris', 'Hollis', 'Juniper', 'Kettle', 'Lockhart', 'Mulberry', 'Nettle',
    'Olwen', 'Prescott', 'Quill', 'Rainey', 'Sparrow', 'Tumble', 'Underhill', 'Valmont', 'Winslow', 'Yarrow', 'Zephyr', 'Alder', 'Birch', 'Clover', 'Dapple', 'Elmwood',
    'Fable', 'Gable', 'Harbor', 'Ivory', 'Jasper', 'Kimble', 'Lumen', 'Moss', 'Nimbus', 'Orchard', 'Pickett'];
  var SKINS = ['#FFDCB8', '#F1C27D', '#E0AC69', '#C68642', '#8D5524', '#5C3A21'];
  var HAIRS = ['#2B1B10', '#4B2E1A', '#8B5A2B', '#D9A441', '#B5361E', '#1B1B1B', '#6B4423', '#E8C27A', '#3A2A1E'];
  var SHIRTS = ['#FF6B6B', '#4FB0F0', '#FFD23F', '#7BD88F', '#B590F0', '#FF9F5A', '#FF9FD2', '#35B8C8', '#F2F2F2', '#E24B4B', '#5E7DB8', '#8DD65A'];
  var PANTS = ['#2F4B7C', '#3B3B4F', '#7A5C3E', '#4A6B3A', '#8A3B3B', '#2E2E2E', '#5B6B8C', '#6B4E8C'];

  // ============================================================ the roster
  var npcs = P.list = [];
  function rr(r, a) { return a[Math.floor(r() * a.length)]; }
  var rnd = L.rng(4242);
  var PLAYER_INDEX = 0;

  function makeNPC(kind, name, role) {
    var n = {
      id: npcs.length + 1, kind: kind, name: name, role: role, x: 0, y: 0, z: 0, level: 0, yo: 0, h: rnd() * 6.28, hidden: true,
      path: null, pi: 0, node: -1, wait: 0, moving: false, sit: 0, sitTarget: false, phase: rnd() * 10, speed: 1.4,
      amp: 0, act: '', ctx: '', dest: null, home: null, wanderAt: 0, stuck: 0, lastD: 0, leaving: false, talkUntil: 0
    };
    var adult = kind === 'staff';
    n.s = adult ? 1.62 + rnd() * 0.18 : 1.12 + rnd() * 0.16;
    n.width = 0.92 + rnd() * 0.2;
    n.skin = rr(rnd, SKINS); n.hairColor = rr(rnd, HAIRS); if (adult && rnd() < 0.2) n.hairColor = '#B8B8B8';
    n.hairStyle = adult ? Math.floor(rnd() * 4) : Math.floor(rnd() * 3);
    if (adult && n.hairStyle === 3 && rnd() < 0.5) n.hairStyle = 0;
    n.shirt = rr(rnd, SHIRTS); n.pants = rr(rnd, PANTS); n.pack = rr(rnd, SHIRTS);
    n.speedMul = 0.85 + rnd() * 0.3;
    npcs.push(n); return n;
  }

  function buildRoster() {
    var gi = 0, order = {};
    // 27 classes x 8 students
    L.classes.forEach(function (cl, ci) {
      cl.index = ci; cl.group = L.groupOfGrade[cl.grade]; cl.students = [];
      for (var k = 0; k < 8; k++) {
        var idx = ci * 8 + k, nm = FIRST[idx % FIRST.length] + ' ' + 'ABCDEFGHJKLMNPRSTW'.charAt((Math.floor(idx / FIRST.length) * 5 + idx * 7) % 18) + '.';
        var n = makeNPC('student', nm, 'Student');
        n.cls = cl; n.seatIdx = k; n.group = cl.group; n.grade = cl.grade; n.home = cl.room;
        n.busRider = (idx % 3 !== 0); n.busIdx = (ci + k) % 2;
        cl.students.push(n);
      }
    });
    // staff
    var si = 0;
    function staff(role, titleMr, extra) {
      var title = titleMr === undefined ? (rnd() < 0.5 ? 'Mr.' : 'Ms.') : titleMr, nm = title + ' ' + SURNAMES[si++ % SURNAMES.length];
      var n = makeNPC('staff', nm, role); for (var k in extra) n[k] = extra[k]; return n;
    }
    L.classes.forEach(function (cl) {
      cl.teacher = staff('Teacher', undefined, { cls: cl, group: cl.group, grade: cl.grade, home: cl.room, stroll: ['stroll:' + cl.id], sup: cl.sec === 'A' });
    });
    staff('PE Coach', 'Coach', { stroll: ['stroll:gym'], coachNo: 0, group: -1 });
    staff('PE Coach', 'Coach', { stroll: ['stroll:gym'], coachNo: 1, group: -1 });
    staff('Librarian', 'Ms.', { stroll: ['stroll:library'] });
    staff('Music Teacher', undefined, { stroll: ['stroll:music'] });
    staff('Art Teacher', undefined, { stroll: ['stroll:art'] });
    staff('STEM Teacher', undefined, { stroll: ['stroll:stem'] });
    staff('Computer Teacher', undefined, { stroll: ['stroll:computer'] });
    staff('Counselor', 'Ms.', { stroll: ['stroll:counselor'] });
    staff('Resource Teacher', undefined, { stroll: ['stroll:resource'] });
    staff('Principal', 'Ms.', { stroll: ['stroll:hall', 'stroll:lobby', 'stroll:office'], roam: true });
    staff('Assistant Principal', 'Mr.', { stroll: ['stroll:hall', 'stroll:cafe', 'stroll:lobby'], roam: true });
    staff('Secretary', 'Ms.', { stroll: ['stroll:office'] });
    staff('Secretary', 'Mr.', { stroll: ['stroll:office'] });
    staff('Nurse', 'Ms.', { stroll: ['stroll:nurse'] });
    for (var h = 0; h < 3; h++) staff('Cafeteria Helper', undefined, { stroll: ['stroll:cafe'], helper: true });
    staff('Custodian', 'Mr.', { stroll: ['stroll:hall', 'rec:yard', 'stroll:cafe', 'rec:playground'], roam: true });
    // shirt colours for roles
    npcs.forEach(function (n) {
      if (n.role === 'PE Coach') n.shirt = '#E24B4B'; else if (n.role === 'Nurse') n.shirt = '#7FD6C4';
      else if (n.role === 'Custodian') { n.shirt = '#5E7DB8'; n.pants = '#3B3B4F'; } else if (n.role === 'Principal') { n.shirt = '#2F4B7C'; n.pants = '#2E2E2E'; }
      else if (n.role === 'Cafeteria Helper') n.shirt = '#FFFFFF';
    });
  }

  // ======================================================= rendering parts
  var parts = {}, N = 0;
  var matPeople;
  function geoOf(fn) { var ly = new U.Layer(1e6); fn(ly); return ly.build(U.matSolid, false, false, null)[0].geometry; }
  function makeParts(scene) {
    matPeople = new THREE.MeshToonMaterial({ gradientMap: U.gradient });
    var W1 = '#FFFFFF';
    var defs = {
      body: geoOf(function (l) { U.cyl(l, 0, 0, 0, 0.12, 0.12, 0.12, W1, 10); U.sph(l, 0, 0.06, 0, 0.12, 0.12, 0.11, W1, null, 8); U.sph(l, 0, -0.06, 0, 0.12, 0.12, 0.11, W1, null, 8); }),
      head: geoOf(function (l) { U.sph(l, 0, 0, 0, 0.16, 0.16, 0.16, W1, null, 10); }),
      hair: geoOf(function (l) { U.sph(l, 0, 0, 0, 0.17, 0.17, 0.17, W1, null, 9); }),
      eyes: geoOf(function (l) { U.sph(l, 0, 0, 0, 0.022, 0.03, 0.02, W1, null, 5); }),
      arm: geoOf(function (l) { U.cyl(l, 0, -0.12, 0, 0.04, 0.04, 0.24, W1, 6); U.sph(l, 0, -0.25, 0, 0.05, 0.05, 0.05, W1, null, 6); }),
      leg: geoOf(function (l) { U.cyl(l, 0, -0.17, 0, 0.055, 0.055, 0.34, W1, 6); U.sph(l, 0, -0.37, 0.025, 0.065, 0.045, 0.09, W1, null, 6); }),
      pack: geoOf(function (l) { U.box(l, 0, 0, 0, 0.22, 0.27, 0.1, W1); })
    };
    N = npcs.length;
    function mk(key, geo, count, tint) {
      var m = new THREE.InstancedMesh(geo, tint ? new THREE.MeshToonMaterial({ gradientMap: U.gradient, color: tint }) : matPeople, count);
      m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false;
      var arr = m.instanceMatrix.array; for (var i = 0; i < count; i++) arr[i * 16 + 15] = 1;
      if (!tint) { for (i = 0; i < count; i++) m.setColorAt(i, C('#FFFFFF')); }
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m); parts[key] = m; return m;
    }
    mk('body', defs.body, N); mk('head', defs.head, N); mk('hair', defs.hair, N); mk('eyes', defs.eyes, N * 2, C('#1F2530'));
    mk('armL', defs.arm, N); mk('armR', defs.arm, N); mk('legL', defs.leg, N); mk('legR', defs.leg, N); mk('pack', defs.pack, N);
    npcs.forEach(function (n, i) {
      parts.body.setColorAt(i, C(n.shirt)); parts.head.setColorAt(i, C(n.skin)); parts.hair.setColorAt(i, C(n.hairColor));
      parts.armL.setColorAt(i, C(n.shirt)); parts.armR.setColorAt(i, C(n.shirt)); parts.legL.setColorAt(i, C(n.pants)); parts.legR.setColorAt(i, C(n.pants));
      parts.pack.setColorAt(i, C(n.pack));
    });
    ['body', 'head', 'hair', 'armL', 'armR', 'legL', 'legR', 'pack'].forEach(function (k) { parts[k].instanceColor.needsUpdate = true; });
  }

  // write a compose(pos, quat, scale) matrix into an instance buffer
  function wm(arr, o, px, py, pz, qx, qy, qz, qw, sx, sy, sz) {
    var x2 = qx + qx, y2 = qy + qy, z2 = qz + qz, xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
    arr[o] = (1 - (yy + zz)) * sx; arr[o + 1] = (xy + wz) * sx; arr[o + 2] = (xz - wy) * sx; arr[o + 3] = 0;
    arr[o + 4] = (xy - wz) * sy; arr[o + 5] = (1 - (xx + zz)) * sy; arr[o + 6] = (yz + wx) * sy; arr[o + 7] = 0;
    arr[o + 8] = (xz + wy) * sz; arr[o + 9] = (yz - wx) * sz; arr[o + 10] = (1 - (xx + yy)) * sz; arr[o + 11] = 0;
    arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
  }
  function wz0(arr, o) { for (var k = 0; k < 15; k++) arr[o + k] = 0; arr[o + 15] = 1; }


  // ------------------------------------------- rendering (allocation-free loop)
  var HAIR_STYLE = [ // offset y,z and scale x,y,z of the hair blob relative to the head centre
    [0.05, -0.045, 1.0, 1.0, 1.0], [0.0, -0.07, 1.02, 1.38, 1.0], [0.06, -0.035, 1.14, 1.14, 1.12], null];
  var PART_KEYS = ['body', 'head', 'hair', 'armL', 'armR', 'legL', 'legR', 'pack'];
  var ALL_KEYS = PART_KEYS.concat(['eyes']);
  var R = { bx: 0, by: 0, bz: 0, s: 1, ch: 1, sh: 0, hs: 0, hc: 1 };    // per-character transform shared by put()
  // write one body part: local offset (lx,ly,lz), rotation about X, scale
  function put(mesh, idx, lx, ly, lz, rx, sx, sy, sz) {
    var cx = Math.sin(rx * 0.5), cw = Math.cos(rx * 0.5), s = R.s;
    wm(mesh.instanceMatrix.array, idx * 16, R.bx + s * (lx * R.ch + lz * R.sh), R.by + s * ly, R.bz + s * (-lx * R.sh + lz * R.ch),
      R.hc * cx, R.hs * cw, -R.hs * cx, R.hc * cw, sx * s, sy * s, sz * s);
  }
  function renderNPC(i, n, near, camT) {
    var k;
    if (n.hidden || n.cull) {
      for (k = 0; k < PART_KEYS.length; k++) wz0(parts[PART_KEYS[k]].instanceMatrix.array, i * 16);
      wz0(parts.eyes.instanceMatrix.array, i * 32); wz0(parts.eyes.instanceMatrix.array, i * 32 + 16); return;
    }
    var s = n.s, h = n.h, legA = 0, bob = 0, sit = n.sit, wid = n.width;
    if (near) {
      if (n.moving) { legA = Math.sin(n.phase) * 0.75 * n.amp; bob = Math.abs(Math.sin(n.phase)) * 0.035 * n.amp; }
      else bob = Math.sin(camT * 2.2 + n.id) * 0.006;
    }
    var legSit = -1.5 * sit, armSit = -0.55 * sit;
    R.s = s; R.sh = Math.sin(h); R.ch = Math.cos(h); R.hs = Math.sin(h * 0.5); R.hc = Math.cos(h * 0.5);
    R.bx = n.x; R.by = n.y + bob * s; R.bz = n.z;
    put(parts.body, i, 0, 0.53, 0, 0, wid, 1, wid);
    put(parts.head, i, 0, 0.84, 0, 0, 1, 1, 1);
    var hsty = HAIR_STYLE[n.hairStyle];
    if (hsty) put(parts.hair, i, 0, 0.84 + hsty[0], hsty[1], 0, hsty[2], hsty[3], hsty[4]); else wz0(parts.hair.instanceMatrix.array, i * 16);
    put(parts.armL, i, 0.17 * wid + 0.02, 0.67, 0, legA * 0.9 + armSit, 1, 1, 1);
    put(parts.armR, i, -0.17 * wid - 0.02, 0.67, 0, -legA * 0.9 + armSit, 1, 1, 1);
    put(parts.legL, i, 0.065, 0.37, 0, -legA + legSit, 1, 1, 1);
    put(parts.legR, i, -0.065, 0.37, 0, legA + legSit, 1, 1, 1);
    if (n.kind === 'student' || n.id === 0) put(parts.pack, i, 0, 0.55, -0.145, 0, 1, 1, 1); else wz0(parts.pack.instanceMatrix.array, i * 16);
    put(parts.eyes, i * 2, 0.06, 0.855, 0.145, 0, 1, 1, 1); put(parts.eyes, i * 2 + 1, -0.06, 0.855, 0.145, 0, 1, 1, 1);
  }

  // ============================================================ the player
  // The player is one extra instance in the same buffers.
  var player = null;
  P.setPlayer = function (x, z, h, moving, amp, visible, phase, y, level) {
    if (!player) return;
    player.y = y || 0; player.level = level || 0;
    player.x = x; player.z = z; player.h = h; player.moving = moving; player.amp = amp; player.hidden = !visible; player.phase = phase; player.sit = 0;
  };

  // ===================================================== routing / planning
  var STUDENT_SPD = 4.0, STAFF_SPD = 2.8, RECESS_RUSH = 1.3;
  var occ = [];                 // how many characters target each spot (recess spots spread out)
  var cand = [];
  // random spot of a list; for recess lists prefer the least occupied ones
  function pickSpot(key) {
    var l = nav.spots[key]; if (!l || !l.length) return null;
    if (key.indexOf('rec:') !== 0) return l[Math.floor(rnd() * l.length)];
    var min = 1e9, i;
    for (i = 0; i < l.length; i++) { var o = occ[l[i].i] || 0; if (o < min) min = o; }
    cand.length = 0;
    for (i = 0; i < l.length; i++) if ((occ[l[i].i] || 0) === min) cand.push(l[i]);
    return cand[Math.floor(rnd() * cand.length)];
  }
  function setDest(n, spot) {
    if (n.resv === spot) n.resv = null; else occ[spot.i] = (occ[spot.i] || 0) + 1;
    if (n.dest && n.dest !== spot) occ[n.dest.i] = Math.max(0, (occ[n.dest.i] || 1) - 1);
    n.dest = spot;
    // outdoor recess spots get a small random offset so nobody stands exactly on someone else
    if (spot.rec) { var a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.9; n.jx = Math.cos(a) * r; n.jz = Math.sin(a) * r; } else { n.jx = 0; n.jz = 0; }
  }
  // nudge a freshly arrived character off anyone standing (nearly) on the same spot
  function unstack(n) {
    for (var pass = 0; pass < 2; pass++) for (var i = 0; i < npcs.length; i++) {
      var o = npcs[i]; if (o === n || o.hidden || o.path || o === player) continue;
      var dx = n.x - o.x, dz = n.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 >= 0.36 || o.level !== n.level) continue;
      var d = Math.sqrt(d2);
      if (d < 1e-3) { dx = 1; dz = 0; d = 1; }
      n.x = o.x + dx / d * 0.6; n.z = o.z + dz / d * 0.6;
      var r = L.resolve(n.x, n.z, 0.26, true, n.level); n.x = r.x; n.z = r.z;
    }
  }
  function placeAt(n, spot) {
    setDest(n, spot);
    n.x = spot.x + n.jx; n.z = spot.z + n.jz; n.level = spot.level || 0; n.yo = spot.y || 0;
    n.y = L.surfaceY(n.x, n.z, n.level) + n.yo; if (spot.h != null) n.h = spot.h; n.sitTarget = spot.sit; n.sit = spot.sit ? 1 : 0;
    if (n.jx || n.jz) { var r = L.resolve(n.x, n.z, 0.26, true, n.level); n.x = r.x; n.z = r.z; unstack(n); }
    n.node = spot.i; n.path = null; n.moving = false;
  }
  function goTo(n, spot, wait) {
    if (n.dest === spot && !n.path) return;
    var from = n.path ? n.path[Math.min(n.pi, n.path.length - 1)] : n.node;
    var route = from >= 0 ? nav.route(from, spot.i) : null;
    if (!route) { placeAt(n, spot); return; }
    setDest(n, spot); n.wait = wait || 0;
    n.path = route; n.pi = 0; n.moving = false; n.stuck = 0; n.sitTarget = false; n.leaving = false;
  }
  // length (m) of the shortest route between two nodes (cached)
  var lenCache = {};
  function routeLen(a, b) {
    var key = a * 4096 + b, v = lenCache[key];
    if (v !== undefined) return v;
    var r = nav.route(a, b), len = 0;
    if (r) for (var i = 1; i < r.length; i++) len += Math.hypot(nav.nodes[r[i]].x - nav.nodes[r[i - 1]].x, nav.nodes[r[i]].z - nav.nodes[r[i - 1]].z);
    return (lenCache[key] = len);
  }

  // ---- destination logic -----------------------------------------------
  function studentDest(n, act) {
    var cl = n.cls, nm = nav.spots;
    if (act === 'class' || act === 'arrive') return nm['seat:' + cl.id][n.seatIdx];
    if (act === 'specials') { var list = nav.spots['special:' + L.specialRooms[cl.index % 6]]; return list[n.specialSlot % list.length]; }
    if (act === 'lunch') { var l = nm.lunch; return l[n.lunchIdx % l.length]; }
    if (act === 'recess') return pickSpot('rec:' + n.recessZone);
    if (act === 'dismiss') return n.busRider ? pickSpot('bus' + n.busIdx) : pickSpot('car');
    return null;
  }
  function assignSlots() {
    // lunch seats: students of a group sit together in order; special slots per (group, room)
    var perGroup = [0, 0, 0], spec = {};
    L.classes.forEach(function (cl) {
      cl.students.forEach(function (n) {
        n.lunchIdx = perGroup[n.group]++;
        var key = n.group + ':' + (cl.index % 6);
        spec[key] = (spec[key] || 0); n.specialSlot = spec[key]++;
        n.recessZone = ['playground', 'field', 'court'][(cl.index + n.group) % 3];
      });
    });
  }

  // full block list per group, incl. arrival, dismissal and the end of the day
  var BLOCKS = P.blocks = SCHED.map(function (s) { return [[T.ARRIVE, 'arrive']].concat(s, [[T.DISMISS, 'dismiss'], [T.END, 'hidden']]); });
  function blockIndex(g, t) { var b = BLOCKS[g], ci = -1; for (var i = 0; i < b.length; i++) if (t >= b[i][0]) ci = i; return ci; }
  // game-minutes a student needs to walk from where they are to `dest`
  function tripMinutes(n, dest, act) {
    if (!n.dest || !dest) return 0;
    var spd = STUDENT_SPD * n.speedMul * (act === 'recess' ? RECESS_RUSH : 1);
    return routeLen(n.dest.i, dest.i) / spd * clock.minPerSec * 1.4 + 1.2 + n.jit;
  }

  // Students leave early by exactly their own walking time so they arrive when the block starts.
  function planStudent(n, snap) {
    var t = clock.t, b = BLOCKS[n.group], ci = blockIndex(n.group, t), dest, act;
    if (ci < 0 || b[ci][1] === 'hidden') { n.hidden = true; n.path = null; n.blk = ci; n.act = 'hidden'; n.dest = null; n.node = -1; return; }
    if (snap) {
      act = b[ci][1]; n.blk = ci; n.act = act; n.lookBlk = -1; dest = studentDest(n, act);
      n.hidden = false; if (dest) placeAt(n, dest); return;
    }
    var ti = ci, nb = ci + 1;
    if (nb < b.length && b[nb][1] !== 'dismiss' && b[nb][1] !== 'hidden' && n.blk >= 0) {
      if (n.lookBlk !== nb) {                              // first look at the coming block
        n.lookBlk = nb; n.nextDest = studentDest(n, b[nb][1]);
        if (n.nextDest && b[nb][1] === 'recess') { occ[n.nextDest.i] = (occ[n.nextDest.i] || 0) + 1; n.resv = n.nextDest; }
      }
      // re-estimated every step: a student who wandered far away at recess must leave earlier
      if (n.blk === nb || t >= b[nb][0] - tripMinutes(n, n.nextDest, b[nb][1])) ti = nb;      // once left, stay committed
    }
    if (ti === n.blk) return;
    act = b[ti][1]; n.blk = ti; n.act = act;
    dest = (n.lookBlk === ti && n.nextDest) ? n.nextDest : studentDest(n, act);
    if (!dest) return;
    if (act === 'arrive' || n.hidden) {                    // appears at the buses
      n.hidden = false; n.node = -1; n.dest = null; var d0 = pickSpot('drop'); placeAt(n, d0);
      goTo(n, dest, rnd() * 8); return;
    }
    n.rushing = (act === 'recess');
    if (dest === n.dest) return;
    goTo(n, dest, act === 'dismiss' ? rnd() * 10 : 0);
    n.leaving = (act === 'dismiss');
  }

  // staff supervisors / coaches go a little early too
  var STAFF_LEAD = 12, tickRecess = false;
  function staffAct(g, t) { return (t >= T.MORNING && t < T.END) ? (t + STAFF_LEAD < T.DISMISS ? P.activity(g, t + STAFF_LEAD) : 'dismiss') : P.activity(g, t); }
  function computeTick() { var t = clock.t; tickRecess = staffAct(0, t) === 'recess' || staffAct(1, t) === 'recess' || staffAct(2, t) === 'recess'; }

  function staffDest(n, t) {
    if (n.role === 'Teacher') {
      if (n.sup) {
        var act = staffAct(n.group, t);
        if (act === 'recess') return nav.spots['post:' + n.cls.students[0].recessZone][0];
        if (act === 'dismiss') return pickSpot('post:front');
      }
    } else if (n.role === 'PE Coach') {
      if (tickRecess) return nav.spots[n.coachNo ? 'post:court' : 'post:field'][0];
      if (t >= T.DISMISS && t < T.END) return pickSpot('post:front');
    } else if (n.role === 'Principal' || n.role === 'Assistant Principal') {
      if ((t >= T.ARRIVE && t < T.MORNING) || (t >= T.DISMISS && t < T.END)) return pickSpot('post:front');
    } else if (n.role === 'Cafeteria Helper') {
      if (t >= T.LUNCH && t < T.AFTERNOON + 30) return pickSpot('stroll:counter');
    }
    return pickSpot(n.stroll[Math.floor(rnd() * n.stroll.length)]);
  }
  // the "mode" of a staff member; changing it triggers a new destination
  function staffCtx(n, t) {
    if (n.role === 'Teacher' && n.sup) { var a = staffAct(n.group, t); return a === 'recess' ? 'recess' : a === 'dismiss' ? 'dismiss' : 'home'; }
    if (n.role === 'PE Coach') return tickRecess ? 'recess' : (t >= T.DISMISS && t < T.END ? 'dismiss' : 'home');
    if (n.roam) return (t >= T.ARRIVE && t < T.MORNING) ? 'arrive' : (t >= T.DISMISS && t < T.END) ? 'dismiss' : 'home';
    if (n.helper) return (t >= T.LUNCH && t < T.AFTERNOON + 30) ? 'lunch' : 'home';
    return 'home';
  }
  function planStaff(n, snap) {
    var t = clock.t, c = staffCtx(n, t);
    if (c === n.ctx && !snap) return;
    n.ctx = c; n.hidden = false;
    var dest = staffDest(n, t); if (!dest) return;
    if (snap || n.node < 0) { placeAt(n, dest); n.wanderAt = clock.now + 6 + rnd() * 12; return; }
    goTo(n, dest, rnd() * 4); n.wanderAt = clock.now + 8 + rnd() * 10;
  }
  function plan(n, snap) { if (n.kind === 'student') planStudent(n, snap); else planStaff(n, snap); }

  // ============================================================ per frame
  function stepNPC(n, dt) {
    if (n.hidden) return;
    n.sit += ((n.sitTarget && !n.path ? 1 : 0) - n.sit) * Math.min(1, dt * 8);
    if (n.talkUntil > clock.now) { n.moving = false; return; }
    if (!n.path) {
      n.moving = false;
      if (n.kind === 'student') {                           // wander between recess spots
        if (n.act === 'recess' && clock.now > n.wanderAt) {
          n.wanderAt = clock.now + 6 + rnd() * 10;
          var d = pickSpot('rec:' + n.recessZone); if (d && d !== n.dest) goTo(n, d, rnd() * 2);
        }
      } else if (clock.now > n.wanderAt) {
        n.wanderAt = clock.now + (n.roam ? 7 : 10) + rnd() * (n.roam ? 12 : 18);
        var key = (n.ctx === 'recess' || n.ctx === 'dismiss' || n.ctx === 'arrive') ? null : n.stroll[Math.floor(rnd() * n.stroll.length)];
        if (n.ctx === 'lunch') key = 'stroll:counter';
        if (key) { var dd = pickSpot(key); if (dd && dd !== n.dest) goTo(n, dd, 0); }
      }
      if (n.faceTo != null) { var df = Math.atan2(Math.sin(n.faceTo - n.h), Math.cos(n.faceTo - n.h)); n.h += df * Math.min(1, dt * 8); }
      return;
    }
    if (n.wait > 0) { n.wait -= dt; n.moving = false; return; }
    n.sitTarget = false; n.sit = Math.max(0, n.sit - dt * 6);
    var node = nav.nodes[n.path[n.pi]], last = n.pi === n.path.length - 1;
    var tx = last ? node.x + n.jx : node.x, tz = last ? node.z + n.jz : node.z;
    var dx = tx - n.x, dz = tz - n.z, dist = Math.hypot(dx, dz);
    var spd = (n.kind === 'student' ? STUDENT_SPD : STAFF_SPD) * n.speedMul * (n.rushing && n.act === 'recess' ? RECESS_RUSH : 1);
    var step = spd * dt;
    if (dist <= step + 0.02) {
      n.x = tx; n.z = tz; n.node = node.i; n.pi++; n.stuck = 0; n.level = node.level;
      if (n.pi >= n.path.length) {                          // arrived
        n.path = null; n.pi = 0; n.moving = false; n.sitTarget = !!node.sit; n.yo = node.y || 0;
        n.y = L.surfaceY(n.x, n.z, n.level) + n.yo;
        n.faceTo = node.h != null ? node.h : null;
        if (n.jx || n.jz) { var r = L.resolve(n.x, n.z, 0.26, true, n.level); n.x = r.x; n.z = r.z; unstack(n); }
        if (n.leaving) { n.hidden = true; n.leaving = false; }
        return;
      }
    } else {
      n.x += dx / dist * step; n.z += dz / dist * step; n.moving = true;
      var da = Math.atan2(dx, dz) - n.h; da = Math.atan2(Math.sin(da), Math.cos(da));
      n.h += da * Math.min(1, dt * 10);
      n.amp += (Math.min(1.2, spd / 4.0) - n.amp) * Math.min(1, dt * 8);
      n.phase += dt * spd * 2.4;
      // stuck watchdog: no progress for 2.5 s -> jump to the node
      if (Math.abs(dist - n.lastD) < 0.01) { n.stuck += dt; if (n.stuck > 2.5) { n.x = tx; n.z = tz; n.stuck = 0; } } else n.stuck = 0;
      n.lastD = dist;
    }
    // height: the walking surface (floor or stair flight; switches level on the stairs) plus
    // the eased offset of the spot being approached (music risers)
    if (n.path) n.yo += ((nav.nodes[n.path[Math.min(n.pi, n.path.length - 1)]].y || 0) - n.yo) * Math.min(1, dt * 6);
    L.surface(n); n.y += n.yo;
  }

  function separate(dt) {
    var k = Math.min(1, dt * 6);
    for (var i = 0; i < npcs.length; i++) {
      var a = npcs[i]; if (a.hidden || !a.moving) continue;
      for (var j = 0; j < npcs.length; j++) {
        if (i === j) continue; var b = npcs[j]; if (b.hidden || b.sit > 0.5 || b.level !== a.level) continue;
        var dx = a.x - b.x, dz = a.z - b.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.36 && d2 > 1e-6) { var d = Math.sqrt(d2), push = (0.6 - d) * 0.5 * k; a.x += dx / d * push; a.z += dz / d * push; }
      }
      var r = L.resolve(a.x, a.z, 0.26, true, a.level); a.x = r.x; a.z = r.z;
    }
  }

  // --------------------------------------------------------------- tags/speech
  var tagPool = [], tagScene = null;
  function tagTexture(n) {
    if (n.tagTex) return n.tagTex;
    var name = n.name, role = n.kind === 'student' ? n.cls.room.name + ' student' : (n.role === 'Teacher' ? n.cls.room.name + ' teacher' : n.role);
    return (n.tagTex = U.canvasTex(256, 72, function (c, w, h) {
      c.fillStyle = 'rgba(255,255,255,.92)'; U.roundRect(c, 4, 4, w - 8, h - 8, 18); c.fill();
      c.strokeStyle = L.schoolColor; c.lineWidth = 4; U.roundRect(c, 4, 4, w - 8, h - 8, 18); c.stroke();
      c.fillStyle = '#222'; c.textAlign = 'center'; c.textBaseline = 'middle';
      U.fitText(c, name, w - 30, 30, '800'); c.fillText(name, w / 2, 30);
      c.fillStyle = '#7A7F8C'; U.fitText(c, role, w - 30, 20, '600'); c.fillText(role, w / 2, 54);
    }));
  }
  function makeTags(scene) {
    tagScene = scene;
    for (var i = 0; i < 6; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
      sp.visible = false; sp.scale.set(1.5, 0.42, 1); sp.renderOrder = 20; scene.add(sp); tagPool.push(sp);
    }
  }
  var nearN = [null, null, null, null, null, null], nearD = [0, 0, 0, 0, 0, 0], nearCount = 0;
  function updateTags(px, pz, level) {
    nearCount = 0;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i]; if (n.hidden || n.cull || n === player || n.level !== level) continue;
      var dx = n.x - px, dz = n.z - pz; if (dx * dx + dz * dz >= 36) continue;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (nearCount >= 6 && d >= nearD[5]) continue;
      var j = nearCount < 6 ? nearCount++ : 5;
      while (j > 0 && nearD[j - 1] > d) { nearD[j] = nearD[j - 1]; nearN[j] = nearN[j - 1]; j--; }
      nearD[j] = d; nearN[j] = n;
    }
    for (var k = 0; k < 6; k++) {
      var sp = tagPool[k];
      if (k < nearCount) {
        var n2 = nearN[k]; sp.visible = true;
        var tex = tagTexture(n2);
        if (sp.material.map !== tex) { var first = !sp.material.map; sp.material.map = tex; if (first) sp.material.needsUpdate = true; }  // shader only changes when a map first appears
        var ks = Math.max(0.5, Math.min(1, nearD[k] / 5)); sp.scale.set(1.35 * ks, 0.38 * ks, 1);
        sp.position.set(n2.x, n2.y + n2.s * 1.08 + 0.3 + 0.1 * ks, n2.z);
      } else sp.visible = false;
    }
  }

  var LINES = {
    student: {
      class: ['I love learning new things!', "We're doing math today!", 'Shh, I am reading.', 'Can I borrow a pencil?', 'I drew a dinosaur!'],
      specials: ['Today is specials - yay!', 'I love this room!', 'Are we doing something fun today?'],
      lunch: ['Lunch is my favorite!', 'Want to trade snacks?', 'Mmm, pizza day!'],
      recess: ['Recess is the best!', 'Want to play tag?', 'I can swing so high!', 'Race you to the slide!'],
      arrive: ['Good morning!', 'My bus was so bumpy!', 'I hope we have art today.'],
      dismiss: ['See you tomorrow!', 'Time to go home!', 'Bye, bye!'], hidden: ['Hi!']
    },
    Teacher: ['Good job, everyone!', 'Walking feet, please.', 'Wonderful question!', 'Eyes on the board, friends.'],
    'PE Coach': ['Let us get moving!', 'Great teamwork out there!', 'Water break, everyone!'],
    Librarian: ['Welcome to the library - shhh!', 'Looking for a good book?', 'Remember to return your books!'],
    'Music Teacher': ['Do, re, mi!', 'Can you clap this rhythm?', 'Music makes everything better.'],
    'Art Teacher': ['Be creative!', 'There are no mistakes in art.', 'Who wants to mix some colors?'],
    'STEM Teacher': ['Let us build something!', 'Science is everywhere.', 'What is your hypothesis?'],
    'Computer Teacher': ['Click, click, code!', 'Remember to save your work.', 'Typing practice time!'],
    Counselor: ['My door is always open.', 'How are you feeling today?', 'Kindness counts.'],
    'Resource Teacher': ['We learn at our own pace.', 'You can do it!', 'Let us try that together.'],
    Principal: ['Welcome to our school!', 'I am so proud of our students.', 'Have a wonderful day!'],
    'Assistant Principal': ['Please walk in the hallway.', 'Thanks for being kind.', 'Good morning, friends!'],
    Secretary: ['How can I help you?', 'Please sign in at the desk.', 'The office is happy to help.'],
    Nurse: ['Feeling better? Drink some water.', 'Wash those hands!', 'I have bandages with stickers.'],
    'Cafeteria Helper': ['Lunch is served!', 'Would you like some fruit?', 'Please use a napkin!'],
    Custodian: ['Keeping things sparkly clean!', 'Mind the wet floor.', 'Have a great day!']
  };

  P.speak = function (n) {
    var pool;
    if (n.kind === 'student') pool = LINES.student[n.act] || LINES.student.class;
    else pool = LINES[n.role] || LINES.Teacher;
    var base = pool[Math.floor(Math.random() * pool.length)];
    n.talkUntil = clock.now + 3; n.lastSpeech = base;
    return base;
  };
  // closest visible character within maxD that is not behind a wall (ray at chest height)
  P.nearestTo = function (x, z, maxD, level) {
    var best = null, bd = maxD; level = level || 0;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i]; if (n.hidden || n === player || n.level !== level) continue;
      var dx = n.x - x, dz = n.z - z, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= bd) continue;
      if (L.rayWall(x, 1.0, z, n.x, 1.0, n.z, 0, level) < 1) continue;
      bd = d; best = n;
    }
    return best;
  };

  // =============================================================== API
  P.init = function (scene) {
    clock.now = 0;
    buildRoster();
    assignSlots();
    // stem / computer labs use their chairs + standing spots for specials
    ['stem', 'computer', 'art'].forEach(function (id) { nav.spots['special:' + id] = nav.spots['seat:' + id].concat(nav.spots['floor:' + id]); });
    npcs.forEach(function (n) { n.blk = -2; n.lookBlk = -1; n.jit = rnd() * 1.2; n.jx = 0; n.jz = 0; });
    // the player is the last instance
    player = makeNPC('player', 'You', 'Player'); player.s = 1.24; player.shirt = L.schoolColor; player.pants = '#2F4B7C'; player.skin = '#E0AC69';
    player.hairColor = '#2B1B10'; player.hairStyle = 0; player.pack = '#FFD23F'; player.hidden = false; player.id = 0;
    makeParts(scene); makeTags(scene);
    computeTick();
    P.snapAll(true);
  };
  // Teleport everybody to where they belong right now.  With `initial`, students
  // who would be arriving instead start at the buses so the first minutes look alive.
  P.snapAll = function (initial) {
    computeTick();
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i]; if (n === player) continue;
      n.act = ''; n.ctx = ''; n.node = -1; n.path = null; n.leaving = false; n.blk = -2; n.lookBlk = -1; n.resv = null;
      if (n.dest) { occ[n.dest.i] = Math.max(0, (occ[n.dest.i] || 1) - 1); n.dest = null; }
      if (initial && n.kind === 'student' && P.activity(n.group, clock.t) === 'arrive') { n.hidden = true; plan(n, false); } else plan(n, true);
    }
  };
  P.setTime = function (hours) { clock.t = hours * 60; P.snapAll(); };

  var camT = 0;
  // view options set by main.js: hideUpper = the second floor is hidden (player downstairs
  // inside); thirdPerson = hide anyone within 1.5 m of the camera so they do not block the view
  P.view = { hideUpper: false, thirdPerson: false };
  P.update = function (dt, camera, px, pz, plevel) {
    if (!player) return;
    // fast time is an exact time-lapse: the same simulation, five steps per frame
    var steps = clock.fast ? 5 : 1, i, k;
    for (var s = 0; s < steps; s++) {
      clock.now += dt; clock.t += dt * clock.minPerSec;
      if (clock.t >= T.RESET) { clock.t = T.MORNING_RESTART; P.snapAll(); }
      computeTick();
      for (i = 0; i < npcs.length; i++) { var n = npcs[i]; if (n === player) continue; plan(n, false); stepNPC(n, dt); }
      separate(dt);
    }
    camT += dt;
    // matrices: limbs only near the camera
    var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, hideUp = P.view.hideUpper, tp = P.view.thirdPerson;
    for (i = 0; i < npcs.length; i++) {
      var q = npcs[i], ddx = q.x - cx, ddz = q.z - cz, ddy = q.y + 0.8 - cy;
      q.cull = q !== player && ((hideUp && q.level === 1) || (tp && ddx * ddx + ddz * ddz + ddy * ddy < 2.25));
      renderNPC(i, q, Math.abs(ddx) + Math.abs(ddz) < 80 || q === player, camT);
    }
    for (k = 0; k < ALL_KEYS.length; k++) parts[ALL_KEYS[k]].instanceMatrix.needsUpdate = true;
    updateTags(px, pz, plevel || 0);
  };
  // stats for the debug handle
  P.visibleCount = function () { var c = 0; for (var i = 0; i < npcs.length; i++) if (!npcs[i].hidden && npcs[i] !== player) c++; return c; };
  // characters actually drawn on a given level (for tests)
  P.drawnOnLevel = function (lv) { var c = 0; for (var i = 0; i < npcs.length; i++) { var n = npcs[i]; if (!n.hidden && !n.cull && n !== player && n.level === lv) c++; } return c; };
  P.count = function () { return npcs.length - 1; };
  P.parts = function () { return parts; };
  P.player = function () { return player; };
})();
