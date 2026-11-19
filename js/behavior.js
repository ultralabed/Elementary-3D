/*
 * behavior.js - lifelike behaviour for the (cartoon) characters.
 *
 * Everything here works on the existing per-character InstancedMesh parts: it only sets pose fields
 * on the character objects (head yaw/pitch, arm angle/splay, leg offsets, lean, hop, sway) that
 * people.js turns into per-instance matrices, moves a few scripted characters (swing, slide, tag),
 * and runs the small group games (basketball, kickball, jump rope, PE ball passing).  Two extra
 * instanced meshes exist in people.js: the lunch tray (one per character) and 28 shared balls.
 *
 * Level of detail: B.pose() is only called with full = true for characters within ~35 m of the
 * camera on the player's floor; everybody else keeps position-only (their pose is reset once).
 * Nothing in the per-frame path allocates.
 */
(function () {
  'use strict';
  if (!window.THREE) return;
  var S = window.CAMPUS, L = S.layout, nav = S.nav, P = S.people;
  var B = S.behavior = {};
  var core, npcs, clock, A, rnd;
  var PI = Math.PI;

  function hash(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ez(c, t, k) { return c + (t - c) * k; }

  // ===================================================================== setup
  var QMAX = 26, SERVE = 0.7;             // serving line slots, seconds per tray
  var qs = [], ov = [], serveT = 0;        // line (slot 0 = head), students waiting at their seats for room in the line
  var BALL = { hoop: 0, kick: 2, pe: 6 };  // first ball index of each game
  var peRing = [];
  var swingN = 0;
  B.stats = { maxQueue: 0, served: 0, maxWait: 0, byWave: [0, 1, 2, 3, 4].map(function () { return { maxQueue: 0, served: 0, unserved: 0, maxWait: 0 }; }) };

  B.init = function (c) {
    core = c; npcs = c.npcs; clock = c.clock; rnd = c.rnd; A = nav.act;
    A.arenas.forEach(function (a) { a.members = []; a.it = null; a.cool = 0; });
    A.hoops.forEach(function (g, gi) { g.m = [null, null, null, null]; g.ball = { st: 'hold', t: 0, holder: null, k: BALL.hoop + gi, x: 0, y: 0, z: 0 }; });
    A.kicks.forEach(function (g, gi) { g.m = [null, null, null, null, null]; g.ball = { st: 'wait', t: 0, holder: null, to: null, k: BALL.kick + gi, x: 0, y: 0, z: 0 }; });
    A.hops.forEach(function (g) { g.m = [null, null, null]; });
    ['gym-34_16', 'gym-34_24', 'gym-34_32', 'gym-34_38', 'gym-28_38', 'gym-22_38', 'gym-22_32', 'gym-22_24', 'gym-22_16', 'gym-28_16'].forEach(function (nm) {
      var h = nav.hubByName(nm); if (h) peRing.push(h);
    });
    B.reset();
  };
  B.reset = function () {
    qs.length = 0; ov.length = 0; serveT = 0; pePhase = -1;
    A.arenas.forEach(function (a) { a.members.length = 0; a.it = null; });
    A.hoops.forEach(function (g) { for (var i = 0; i < g.m.length; i++) g.m[i] = null; g.ball.st = 'hold'; g.ball.holder = null; P.hideBall(g.ball.k); });
    A.kicks.forEach(function (g) { for (var i = 0; i < g.m.length; i++) g.m[i] = null; g.ball.st = 'wait'; g.ball.holder = null; P.hideBall(g.ball.k); });
    A.hops.forEach(function (g) { for (var i = 0; i < g.m.length; i++) g.m[i] = null; });
    if (L.swingList) L.swingList.forEach(function (s) { s.taken = null; s.target = 0.2; });
    A.bench.forEach(function (s) { s.taken = null; });
    slideN = 0; slideLast = 0;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i]; n.scr = null; n.stT = null; n.stO = null; n.stI = -1; n.prop = 0; n.lphase = 0; n.spdF = 1; n.lineUp = false; n.mate = null; n.peOn = 0; n.curSpd = 0;
      n.waveUntil = 0; n.waveCool = 0; n.raise = 0; n.posed = false; n.hy = n.hp = n.aL = n.aR = n.wL = n.wR = n.zL = n.zR = n.lL = n.lR = n.ln = n.jy = n.sx = 0;
    }
    for (i = 0; i < P.BALLS; i++) P.hideBall(i);
  };

  // ============================================================ lunch / serving line
  // The line is a row of hubs along the counter wall.  A student who has to wait longer than the line is long
  // sits at their own seat until there is room.
  // Walk to the cafeteria door first; the line forms in the order people actually get there.
  var cafeIn = null;
  B.lunchDest = function (n) {
    cafeIn = cafeIn || nav.hubByName('cafeIn');
    n.lphase = -1; n.qT = clock.now; n.gotTray = false;       // -1: on the way to the cafeteria
    return cafeIn;
  };
  function joinLine(n) {
    n.qT = clock.now;
    if (qs.length < QMAX) { qs.push(n); n.lphase = 1; qMove(n, qs.length - 1, 0); }
    else { ov.push(n); n.lphase = 0; core.goTo(n, seatOf(n), 0); }
  }
  function seatOf(n) { var l = nav.spots.lunch; return l[n.lunchIdx % l.length]; }
  function qMove(n, slot, wait) {
    var to = nav.queue[slot], from = n.node >= 0 ? nav.nodes[n.node] : null;
    n.spdF = (from && Math.hypot(from.x - to.x, from.z - to.z) < 1.2) ? 0.6 : P.LINE_SPD;
    if (n.path || n.dest !== to) core.goTo(n, to, wait);
  }
  function leaveLunch(n) {
    var i = qs.indexOf(n); if (i >= 0) { qs.splice(i, 1); for (var j = i; j < qs.length; j++) qMove(qs[j], j, 0); }
    i = ov.indexOf(n); if (i >= 0) ov.splice(i, 1);
    if (!n.gotTray && n.cls) { B.stats.byWave[n.cls.wave].unserved++; (B.stats.unservedLog = B.stats.unservedLog || []).push([n.name, n.cls.id, n.lphase, +n.x.toFixed(1), +n.z.toFixed(1), !!n.path, qs.length, ov.length]); }
    n.gotTray = false; n.prop = 0; n.lphase = 0; n.spdF = 1;
  }
  var STATIONS = 5;                          // trays are handed out at the first five places of the line at once (the counter is 12 m long)
  var headStuck = 0;
  function updateLunch(dt) {
    if (qs.length > B.stats.maxQueue) B.stats.maxQueue = qs.length;
    if (qs.length && qs[0].cls && qs.length > B.stats.byWave[qs[0].cls.wave].maxQueue) B.stats.byWave[qs[0].cls.wave].maxQueue = qs.length;
    while (qs.length < QMAX && ov.length) {                       // somebody who was waiting seated gets up for the line
      var m = ov.shift(); if (m.act !== 'lunch') continue;
      m.lphase = 1; m.qT = clock.now; qs.push(m); qMove(m, qs.length - 1, 0);
    }
    serveT -= dt; if (serveT > 0 || !qs.length) return;
    // a head that cannot get to its place (blocked) is put there after a few seconds
    var h0 = qs[0];
    if (h0 && (h0.path || h0.node !== nav.queue[0].i)) { headStuck += dt; if (headStuck > 6) { headStuck = 0; core.placeAt(h0, nav.queue[0]); } } else headStuck = 0;
    var served = 0;
    for (var s = 0; s < STATIONS && s < qs.length; s++) {
      var h = qs[s - served];
      if (h.path || h.node !== nav.queue[s].i) break;       // not at the counter yet
      qs.splice(s - served, 1); served++; B.stats.served++;
      var w = clock.now - h.qT, bw = B.stats.byWave[h.cls.wave]; if (w > B.stats.maxWait) B.stats.maxWait = w; if (w > bw.maxWait) bw.maxWait = w; bw.served++; h.gotTray = true;
      h.prop = 1; h.lphase = 3; h.spdF = P.LINE_SPD; core.goTo(h, seatOf(h), 0.35 + s * 0.15);
    }
    if (served) { serveT = SERVE; for (var j = 0; j < qs.length; j++) qMove(qs[j], j, 0.05 + j * 0.012); }   // the line shuffles forward, front first
  }

  B.queueInfo = function () { return { line: qs.length, waiting: ov.length, headReady: !!(qs[0] && !qs[0].path && qs[0].node === nav.queue[0].i), headPath: !!(qs[0] && qs[0].path) }; };

  // ======================================================== activity hooks from people.js
  B.onAct = function (n, old, act) {
    if (old === 'recess' && act !== 'recess') release(n);
    if (old === 'lunch' && act !== 'lunch') leaveLunch(n);
    if (old === 'specials') { n.peOn = 0; n.spdF = 1; }
    n.lineUp = (act === 'lunch' || act === 'specials' || act === 'class' || act === 'recess');
    n.spdF = (act === 'lunch' || act === 'specials') ? P.LINE_SPD : 1; n.mate = null;
  };
  B.afterSnap = function (n, act, dest) {
    n.lineUp = false;
    if (act !== 'lunch') return;
    var b = P.blocks[n.group][n.blk], el = Math.max(0, (clock.t - b[0]) / clock.minPerSec), served = Math.floor(el / SERVE) * STATIONS, rank = n.lunchIdx;
    if (rank < served) { n.prop = 1; n.lphase = 3; n.gotTray = true; }
    else if (rank < served + QMAX) {
      var slot = rank - served; core.placeAt(n, nav.queue[slot]); qs[slot] = n; n.lphase = 1; n.qT = clock.now;
    } else { n.lphase = 0; var k = 0; while (k < ov.length && ov[k].lunchIdx < rank) k++; ov.splice(k, 0, n); }
  };

  // ================================================================== recess stations
  var slideN = 0, slideLast = 0;
  var ZONE_OPTS = { playground: ['swing', 'slide', 'bench', 'tag', 'swing', 'hop', 'bench', 'slide'], field: ['kick', 'tag', 'kick', 'hop'], court: ['hoop', 'tag', 'hoop'] };
  function arenaOf(zone) { for (var i = 0; i < A.arenas.length; i++) if (A.arenas[i].zone === zone) return A.arenas[i]; return null; }
  function claimSlot(arr, n) { for (var i = 0; i < arr.length; i++) if (!arr[i]) { arr[i] = n; return i; } return -1; }
  function tryClaim(n, type) {
    var zone = n.recessZone, i, g;
    if (type === 'swing') {
      var sl = L.swingList; if (!sl) return null;
      var k0 = Math.floor(rnd() * sl.length);
      for (i = 0; i < sl.length; i++) { var q = (i + k0) % sl.length; if (!sl[q].taken) { sl[q].taken = n; n.stT = 'swing'; n.stO = sl[q]; n.stI = q; return A.swing[q]; } }
    } else if (type === 'slide') {
      if (slideN >= 3) return null; slideN++; n.stT = 'slide'; n.reps = 2 + Math.floor(rnd() * 3); return A.slideFoot;
    } else if (type === 'bench') {
      var k1 = Math.floor(rnd() * A.bench.length);
      for (i = 0; i < A.bench.length; i++) { var b = A.bench[(i + k1) % A.bench.length]; if (!b.taken && (b.mate.taken || rnd() < 0.6)) { b.taken = n; n.stT = 'bench'; n.stO = b; return b; } }
    } else if (type === 'tag') {
      var a = arenaOf(zone); if (!a || a.members.length >= 6) return null; a.members.push(n); n.stT = 'tag'; n.stO = a; return a.spot;
    } else if (type === 'hop') {
      for (i = 0; i < A.hops.length; i++) { g = A.hops[i]; if (g.zone !== zone) continue; var s = claimSlot(g.m, n); if (s >= 0) { n.stT = 'hop'; n.stO = g; n.stI = s; return g.spots[s]; } }
    } else if (type === 'hoop') {
      for (i = 0; i < A.hoops.length; i++) { g = A.hoops[(i + (n.id & 1)) % A.hoops.length]; var s2 = claimSlot(g.m, n); if (s2 >= 0) { n.stT = 'hoop'; n.stO = g; n.stI = s2; return g.spots[s2]; } }
    } else if (type === 'kick') {
      var k2 = Math.floor(rnd() * A.kicks.length);
      for (i = 0; i < A.kicks.length; i++) { g = A.kicks[(i + k2) % A.kicks.length]; var s3 = claimSlot(g.m, n); if (s3 >= 0) { n.stT = 'kick'; n.stO = g; n.stI = s3; return g.spots[s3]; } }
    }
    return null;
  }
  function releaseRef(n) {
    var o = n.stO, i;
    switch (n.stT) {
      case 'swing': o.taken = null; o.target = 0.2; break;
      case 'slide': slideN = Math.max(0, slideN - 1); break;
      case 'bench': o.taken = null; break;
      case 'tag': i = o.members.indexOf(n); if (i >= 0) o.members.splice(i, 1); if (o.it === n) o.it = null; break;
      case 'hop': case 'hoop': case 'kick': if (o.m[n.stI] === n) o.m[n.stI] = null; if (o.ball && o.ball.holder === n) o.ball.holder = null; break;
    }
    n.stT = null; n.stO = null; n.stI = -1;
  }
  // End a station / script (the recess is over, or the kid moves on).  A child on the swing or the slide is not snapped
  // off: the script is told to finish (step off the swing, finish the slide run) and the walk to the next place starts afterwards.
  function release(n) {
    if (n.scr) {
      var t = n.scr.type;
      if (t === 'swing' || t === 'slide') { n.scr.ending = true; n.rEnd = 0; n.arrived = false; return; }
      n.scr = null; n.moving = false;
    }
    if (n.stT) releaseRef(n);
    n.rEnd = 0; n.arrived = false; n.spdF = 1; n.lL = n.lR = 0;
  }
  // called when a recess kid has been standing for a while: pick the next thing to do.  true = handled here
  B.recess = function (n) {
    if (n.stT === 'slide' && n.reps > 0) { n.reps--; n.arrived = false; core.goTo(n, A.slideFoot, 0); n.lineUp = false; n.wanderAt = Infinity; return true; }
    release(n);
    n.lineUp = false; n.mate = null;
    var opts = ZONE_OPTS[n.recessZone];
    if (opts && rnd() < 0.82) {
      var k0 = Math.floor(rnd() * opts.length);
      for (var i = 0; i < opts.length; i++) {
        var sp = tryClaim(n, opts[(i + k0) % opts.length]);
        if (sp) {
          n.arrived = false; n.wanderAt = Infinity; n.rDur = 14 + rnd() * 22;
          var far = Math.hypot(n.x - sp.x, n.z - sp.z) > 1.0;           // a finished game can leave the child away from the node they are 'at': then walk there
          if (n.dest !== sp || n.path || far) core.goTo(n, sp, rnd() * 1.5, far); else n.wanderAt = clock.now + n.rDur;
          n.arrived = n.dest === sp && !n.path; if (n.arrived) startStation(n);
          return true;
        }
      }
    }
    return false;                                                   // plain chat spot (people.js picks one)
  };
  // staff on yard duty: the next point along the edge
  B.dutyNext = function (n) {
    var zone = n.role === 'PE Coach' ? (n.coachNo ? 'court' : 'field') : (n.cls ? n.cls.students[0].recessZone : 'playground'), l = A.patrol[zone];
    if (!l) return null; n.pcur = ((n.pcur || 0) + 1) % l.length; n.spdF = 0.7; return l[n.pcur];
  };
  B.teacherNext = function (n, key) {
    if (n.ctx === 'recess') return B.dutyNext(n);
    if (n.ctx.indexOf('escort:') === 0) return null;                  // waits at the destination until the class is settled
    n.spdF = 1;
    var inClass = n.ctx === 'home' && n.cls && n.cls.students[0].act === 'class';
    if (inClass) {
      n.spdF = 0.62;                                                // unhurried pacing
      var fl = nav.spots['floor:' + n.cls.id];
      if (fl && fl.length && rnd() < 0.2) return fl[Math.floor(rnd() * fl.length)];   // sometimes down an aisle
    }
    return key ? core.pickSpot(key) : null;
  };

  // station begins once the kid is standing on its spot
  function startStation(n) {
    var o = n.stO, now = clock.now;
    n.wanderAt = now + (n.rDur || 20);
    if (n.stT === 'swing') { n.scr = { type: 'swing', ph: 0, t: 0, dur: n.rDur, sd: o }; n.wanderAt = Infinity; o.target = 0.8; }
    else if (n.stT === 'slide') { n.scr = { type: 'slide', ph: 0, t: 0 }; n.wanderAt = Infinity; slideLast = now; }
    else if (n.stT === 'tag') {
      n.scr = { type: 'tag', t: 0, vx: 0, vz: 0, until: now + n.rDur, ang: rnd() * 6.28 }; n.wanderAt = Infinity; n.moving = true;
      var an = rnd() * 6.283; n.x += Math.cos(an) * 0.2; n.z += Math.sin(an) * 0.2;      // (they all arrive at the middle: a tiny nudge, then the chase spreads them out)
    }
    else if (n.stT === 'hoop' || n.stT === 'kick') { if (!o.ball.holder) o.ball.holder = n; }
  }

  // =================================================================== scripts
  var TW = L.play.tower;
  function ease3(u) { return u * u * (3 - 2 * u); }
  B.script = function (n, dt) {
    var sc = n.scr, k;
    if (sc.type === 'swing') {
      var sd = sc.sd, sp = A.swing[n.stI], th = sd.th; sc.t += dt;
      n.sit += (1 - n.sit) * Math.min(1, dt * 10); n.moving = false; n.h = 0;
      var sz = sd.z - 2.45 * Math.sin(th), sy = 3.0 - 2.45 * Math.cos(th) + 0.06 - 0.37 * n.s;
      if (sc.ph === 0) {
        k = ease3(Math.min(1, sc.t / 0.7)); n.x = sp.x + (sd.x - sp.x) * k; n.z = sp.z + (sz - sp.z) * k; n.y = (sy < 0 ? 0 : sy) * k;
        if (sc.t >= 0.7) { sc.ph = 1; sc.t = 0; }
      } else if (sc.ph === 1) {
        n.x = sd.x; n.z = sz; n.y = sy;
        if (sc.t > sc.dur || sc.ending) { sc.ph = 2; sc.t = 0; sd.target = 0.15; }
      } else if (sc.ph === 2) {
        n.x = sd.x; n.z = sz; n.y = sy;
        if (sd.amp < 0.4 || sc.t > 4) { sc.ph = 3; sc.t = 0; }
      } else {
        k = ease3(Math.min(1, sc.t / 0.6)); n.x = sd.x + (sp.x - sd.x) * k; n.z = sz + (sp.z - sz) * k; n.y = Math.max(0, sy) * (1 - k);
        if (sc.t >= 0.6) { n.scr = null; n.sit = 0; n.y = 0; releaseRef(n); n.wanderAt = clock.now + 0.5; n.rEnd = 0; }
      }
      return;
    }
    if (sc.type === 'slide') { slideScript(n, sc, dt); return; }
    if (sc.type === 'tag') { n.moving = true; return; }     // moved by updateArenas
  };
  function slideScript(n, sc, dt) {
    var tx = TW.x, tz = TW.z, s = n.s; sc.t += dt;
    n.moving = false;
    switch (sc.ph) {
      case 0: {                                                    // walk from wherever we stood to the ladder (no snap to the foot)
        if (sc.d0 === undefined) { sc.sx = n.x; sc.sz = n.z; sc.d0 = Math.max(0.5, Math.hypot(tx - n.x, tz - 1.75 - n.z) / 2.6); }
        var u = Math.min(1, sc.t / sc.d0), e0 = ease3(u);
        n.x = sc.sx + (tx - sc.sx) * e0; n.z = sc.sz + (tz - 1.75 - sc.sz) * e0; n.y = 0; n.h += wrap(0 - n.h) * Math.min(1, dt * 8);
        n.moving = u < 1; n.amp = 0.8; n.phase += dt * 6; n.sit += (0 - n.sit) * Math.min(1, dt * 10);
        if (sc.t >= sc.d0) { sc.ph = 1; sc.t = 0; } break; }
      case 1: {                                                    // climb
        var u1 = Math.min(1, sc.t / 2.2); n.x = tx; n.z = tz - 1.75; n.y = 1.78 * u1; n.h = 0;
        if (sc.t >= 2.2) { sc.ph = 2; sc.t = 0; } break; }
      case 2: {                                                    // across the platform to the slide
        var u2 = ease3(Math.min(1, sc.t / 1.0)); n.x = tx + 1.45 * u2; n.z = tz - 1.75 + 1.75 * u2; n.y = 1.78; n.h = u2 * PI / 2;
        if (sc.t >= 1.0) { sc.ph = 3; sc.t = 0; } break; }
      case 3: {                                                    // sit and go: the board runs from the platform edge down 2.1 m over 2.9 m
        n.sit += (1 - n.sit) * Math.min(1, dt * 12);
        var u3 = Math.min(1, sc.t / 1.25), uu = u3 * u3 * 0.6 + u3 * 0.4;
        n.x = tx + 1.45 + 3.0 * uu; n.z = tz;
        n.y = 2.107 - 2.14 * uu + 0.12 - 0.37 * s;                // board surface + hip offset (same as a chair seat)
        n.h = PI / 2; sc.yEnd = n.y;
        if (sc.t >= 1.25) { sc.ph = 4; sc.t = 0; sc.jx = (rnd() - 0.5) * 0.6; sc.jz = (rnd() - 0.5) * 1.2; } break; }
      default: {                                                   // stand up and step off
        n.sit += (0 - n.sit) * Math.min(1, dt * 8); var u4 = Math.min(1, sc.t / 0.6), e4 = ease3(u4);
        n.x = tx + 4.45 + (A.slideOut.x + sc.jx - tx - 4.45) * e4; n.z = tz + sc.jz * e4; n.y = sc.yEnd * (1 - e4) + L.surfaceY(n.x, n.z, 0) * e4; n.h = PI / 2;
        if (sc.t >= 0.6) {
          n.scr = null; n.node = A.slideOut.i; n.dest = A.slideOut; n.y = L.surfaceY(n.x, n.z, 0); n.moving = false; n.sit = 0;
          n.wanderAt = clock.now + 0.3; if (sc.ending) releaseRef(n);
        }
      }
    }
  }

  // ----- tag: one chaser per arena; runners flee, the chaser swaps when it touches somebody
  function updateArenas(dt) {
    var now = clock.now, i, j, a, m, o;
    for (var ai = 0; ai < A.arenas.length; ai++) {
      a = A.arenas[ai]; var mem = a.members, cnt = 0;
      for (i = 0; i < mem.length; i++) if (mem[i].scr && mem[i].scr.type === 'tag') cnt++;
      if (!cnt) continue;
      if (!a.it || a.it.stO !== a || !a.it.scr) { a.it = null; for (i = 0; i < mem.length; i++) if (mem[i].scr) { a.it = mem[i]; break; } a.cool = now + 1.0; }
      for (i = 0; i < mem.length; i++) {
        m = mem[i]; var sc = m.scr; if (!sc || sc.type !== 'tag') continue;
        var tx = 0, tz = 0, spd = 0, dx, dz, d;
        if (m === a.it) {
          var best = 1e9, tgt = null;
          for (j = 0; j < mem.length; j++) { o = mem[j]; if (o === m || !o.scr) continue; d = Math.hypot(o.x - m.x, o.z - m.z); if (d < best) { best = d; tgt = o; } }
          if (tgt) {
            dx = tgt.x - m.x; dz = tgt.z - m.z; d = Math.max(0.01, best); tx = dx / d; tz = dz / d; spd = now < a.cool ? 0.4 : 4.6;
            if (d < 0.85 && now >= a.cool) { a.it = tgt; a.cool = now + 1.4; }
          }
        } else if (a.it) {
          dx = m.x - a.it.x; dz = m.z - a.it.z; d = Math.max(0.01, Math.hypot(dx, dz));
          sc.ang += (rnd() - 0.5) * 6 * dt;
          var fl = d < 7 ? 1 : 0.15;
          tx = dx / d * fl + Math.sin(sc.ang) * 0.9; tz = dz / d * fl + Math.cos(sc.ang) * 0.9;
          spd = d < 7 ? 4.4 : 2.2;
        }
        // keep inside the arena: steer away from the edges
        var mg = 1.8;
        if (m.x < a.x0 + mg) tx += (a.x0 + mg - m.x); else if (m.x > a.x1 - mg) tx -= (m.x - (a.x1 - mg));
        if (m.z < a.z0 + mg) tz += (a.z0 + mg - m.z); else if (m.z > a.z1 - mg) tz -= (m.z - (a.z1 - mg));
        for (j = 0; j < mem.length; j++) {                          // do not pile up
          o = mem[j]; if (o === m || !o.scr) continue; dx = m.x - o.x; dz = m.z - o.z; d = dx * dx + dz * dz;
          if (d < 0.64 && d > 1e-4) { d = Math.sqrt(d); tx += dx / d * (0.8 - d) * 3; tz += dz / d * (0.8 - d) * 3; }
        }
        var len = Math.hypot(tx, tz); if (len < 1e-3) { len = 1; tx = 0; tz = 0; spd = 0; }
        var want = spd * m.speedMul; sc.vx = ez(sc.vx, tx / len * want, Math.min(1, dt * 7)); sc.vz = ez(sc.vz, tz / len * want, Math.min(1, dt * 7));
        m.x = clamp(m.x + sc.vx * dt, a.x0 + 0.3, a.x1 - 0.3); m.z = clamp(m.z + sc.vz * dt, a.z0 + 0.3, a.z1 - 0.3);
        var sp = Math.hypot(sc.vx, sc.vz);
        if (sp > 0.3) { m.h += wrap(Math.atan2(sc.vx, sc.vz) - m.h) * Math.min(1, dt * 10); }
        m.moving = sp > 0.3; m.amp = ez(m.amp, Math.min(1.2, sp / 4), Math.min(1, dt * 8)); m.phase += dt * Math.max(sp, 0.01) * 2.4;
        L.surface(m); m.y += m.yo;
        if (now > sc.until) { endTag(m); }
      }
    }
  }
  function endTag(m) { m.scr = null; m.moving = false; releaseRef(m); m.wanderAt = clock.now + 0.2; }

  // ----- the ball games
  function ballAt(g, x, y, z) { g.ball.x = x; g.ball.y = y; g.ball.z = z; P.setBall(g.ball.k, x, y, z); }
  function updateHoops(dt) {
    for (var gi = 0; gi < A.hoops.length; gi++) {
      var g = A.hoops[gi], b = g.ball, cnt = 0, i, h = b.holder;
      for (i = 0; i < 4; i++) if (g.m[i] && g.m[i].stO === g && !g.m[i].path) cnt++;
      if (!cnt) { P.hideBall(b.k); b.holder = null; continue; }
      if (!h || h.stO !== g || h.path) { b.holder = h = null; for (i = 0; i < 4; i++) if (g.m[i] && !g.m[i].path) { h = b.holder = g.m[i]; break; } b.st = 'hold'; b.t = 0; if (!h) continue; }
      b.t += dt;
      var r = g.rim;
      if (b.st === 'hold') {                                       // dribble beside the right hand
        var ph = (b.t % 0.56) / 0.56, hy = 0.14 + 0.72 * Math.abs(Math.sin(ph * PI)) ;
        ballAt(g, h.x + Math.sin(h.h) * 0.32 - Math.cos(h.h) * 0.2 * h.s, hy, h.z + Math.cos(h.h) * 0.32 + Math.sin(h.h) * 0.2 * h.s);
        h.dribY = hy;
        if (b.t > 3.2 + (h.id % 3)) { b.st = 'shot'; b.t = 0; b.fx = b.x; b.fy = 1.9 * h.s / 1.2; b.fz = b.z; h.faceTo = Math.atan2(r.x - h.x, r.z - h.z); }
      } else if (b.st === 'shot') {                                // a high arc into the hoop
        var u = Math.min(1, b.t / 1.25), sx = b.fx + (r.x - b.fx) * u, sz = b.fz + (r.z - b.fz) * u, sy = b.fy + (r.y - b.fy) * u + Math.sin(u * PI) * 1.6;
        ballAt(g, sx, sy, sz); h.n = h.n || 0;
        if (u >= 1) { b.st = 'drop'; b.t = 0; }
      } else if (b.st === 'drop') {                                // falls through, bounces once, rolls to a team mate
        var u2 = Math.min(1, b.t / 0.55); ballAt(g, r.x, 0.14 + (r.y - 0.14) * (1 - u2 * u2), r.z);
        if (u2 >= 1) {
          var nx = null, k0 = Math.floor(rnd() * 4);
          for (i = 0; i < 4; i++) { var c = g.m[(i + k0) % 4]; if (c && c !== h && !c.path) { nx = c; break; } }
          b.to = nx || h; b.st = 'pass'; b.t = 0; b.fx = r.x; b.fz = r.z;
        }
      } else {                                                     // pass: a chest pass in a low arc
        var u3 = Math.min(1, b.t / 0.9), tx = b.to.x + Math.sin(b.to.h) * 0.3, tz = b.to.z + Math.cos(b.to.h) * 0.3;
        ballAt(g, b.fx + (tx - b.fx) * u3, 0.14 + (0.9 - 0.14) * u3 + Math.sin(u3 * PI) * 0.5, b.fz + (tz - b.fz) * u3);
        if (u3 >= 1) { b.holder = b.to; b.st = 'hold'; b.t = 0; }
      }
    }
  }
  function updateKicks(dt) {
    for (var gi = 0; gi < A.kicks.length; gi++) {
      var g = A.kicks[gi], b = g.ball, cnt = 0, i, h = b.holder;
      for (i = 0; i < 5; i++) if (g.m[i] && g.m[i].stO === g && !g.m[i].path) cnt++;
      if (cnt < 2) { P.hideBall(b.k); b.holder = null; b.st = 'wait'; continue; }
      if (!h || h.stO !== g || h.path) { b.holder = h = null; for (i = 0; i < 5; i++) if (g.m[i] && !g.m[i].path) { h = b.holder = g.m[i]; break; } b.st = 'wait'; b.t = 0; if (!h) continue; }
      b.t += dt;
      if (b.st === 'wait') {
        ballAt(g, h.x + Math.sin(h.h) * 0.5, 0.12, h.z + Math.cos(h.h) * 0.5);
        if (b.t > 1.4 + (h.id % 4) * 0.2) {
          var k0 = Math.floor(rnd() * 5), nx = null;
          for (i = 0; i < 5; i++) { var c = g.m[(i + k0) % 5]; if (c && c !== h && !c.path && c.stO === g) { nx = c; break; } }
          if (!nx) { b.t = 0; continue; }
          b.to = nx; b.st = 'kick'; b.t = 0; b.fx = b.x; b.fz = b.z; h.kickT = 0; h.faceTo = Math.atan2(nx.x - h.x, nx.z - h.z);
          b.dur = 0.7 + Math.hypot(nx.x - h.x, nx.z - h.z) * 0.12;
        }
      } else {
        var u = Math.min(1, (b.t - 0.18) / b.dur);
        if (b.t < 0.18) { h.kickT = b.t / 0.18; ballAt(g, b.fx, 0.12, b.fz); }
        else {
          var tx = b.to.x + Math.sin(b.to.h) * 0.5, tz = b.to.z + Math.cos(b.to.h) * 0.5;
          ballAt(g, b.fx + (tx - b.fx) * u, 0.12 + Math.abs(Math.sin(u * PI * 2)) * 0.35 * (1 - u * 0.5), b.fz + (tz - b.fz) * u);
          h.kickT = Math.max(-1, 1 - (b.t - 0.18) * 4);
          if (u >= 1) { b.holder = b.to; b.st = 'wait'; b.t = 0; b.to.faceTo = Math.atan2(h.x - b.to.x, h.z - b.to.z); }
        }
      }
    }
  }

  // ----- PE in the gym: 40 s of laps, 40 s of jumping jacks, 40 s of ball passing, repeated
  var pePhase = -1, peBalls = [];
  function updatePE(dt) {
    var ph = Math.floor((clock.now % 120) / 40), i, n;
    var gym = nav.spots['special:gym'];
    if (ph !== pePhase) {
      pePhase = ph;
      for (i = 0; i < npcs.length; i++) {
        n = npcs[i]; if (n.kind !== 'student' || n.act !== 'specials' || n.spRoom !== 'gym') continue;
        if (ph === 0) { if (!n.path && n.dest && n.dest.key === 'special:gym') { n.peHome = n.dest; n.peOn = 1; n.lap = (n.seatIdx * 3) % peRing.length; n.spdF = 0.72; n.lineUp = false; core.goTo(n, peRing[n.lap], 0.1 * (n.seatIdx % 5)); } }
        else if (n.peOn) { n.peOn = 0; n.spdF = 1; core.goTo(n, n.peHome, 0.2 * (n.seatIdx % 4)); }
      }
    }
    if (ph === 0) {
      for (i = 0; i < npcs.length; i++) {
        n = npcs[i]; if (n.peOn !== 1 || n.path || n.act !== 'specials') continue;
        n.lap = (n.lap + 1) % peRing.length; core.goTo(n, peRing[n.lap], 0);
      }
    }
  }
  var peSeq = 0;
  // balls for the PE passing phase: pairs of neighbouring spots (x, x+4)
  function updatePEBalls() {
    var gym = nav.spots['special:gym']; if (!gym) return;
    var any = false, used = 0;
    if (pePhase === 2) {
      for (var a = 0; a < 10; a++) {
        var ia = Math.floor(a / 5) * 10 + (a % 5), ib = ia + 5;       // columns (0,1) and (2,3), same row
        var pa = null, pb = null;
        for (var i = 0; i < npcs.length; i++) { var n = npcs[i]; if (n.act === 'specials' && n.spRoom === 'gym' && !n.path && !n.hidden) { if (n.dest === gym[ia]) pa = n; else if (n.dest === gym[ib]) pb = n; } }
        var k = BALL.pe + a;
        if (pa && pb) {
          var cyc = (clock.now * 0.7 + a * 0.37) % 2, u = cyc % 1, from = cyc < 1 ? pa : pb, to = cyc < 1 ? pb : pa;
          P.setBall(k, from.x + (to.x - from.x) * u, 1.0 + Math.sin(u * PI) * 0.9, from.z + (to.z - from.z) * u);
          pa.ballU = pb.ballU = u; pa.ballTo = cyc >= 1; pb.ballTo = cyc < 1; pa.ballMate = pb; pb.ballMate = pa; any = true; used++;
        } else P.hideBall(k);
      }
    } else if (peSeq) { for (var q = 0; q < 10; q++) P.hideBall(BALL.pe + q); }
    peSeq = pePhase === 2 ? 1 : 0;
  }

  // ================================================================ per sim step
  var armT = 0;
  B.update = function (dt) {
    updateLunch(dt);
    // stations: start once the kid has arrived on its spot, end when the time is up
    var now = clock.now, slideRank = 0;
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      if (n.lphase === -1 && n.act === 'lunch' && !n.hidden && !n.path && cafeIn && n.node === cafeIn.i) joinLine(n);
      if (n.stT && n.act === 'recess' && !n.hidden) {
        if (!n.arrived && !n.path && !n.scr && n.dest && n.node === n.dest.i) {
          if (n.stT === 'slide' && now - slideLast < 2.6) {            // one child at a time up the ladder: the next ones queue behind the foot of it
            var qx = A.slideFoot.x + (slideRank % 2 ? 0.4 : -0.4), qz = A.slideFoot.z - 0.8 - 0.7 * slideRank, qdx = qx - n.x, qdz = qz - n.z, qd = Math.hypot(qdx, qdz);
            slideRank++;
            if (qd > 0.06) {                                           // walk to the place in the queue (never jump)
              var qs2 = Math.min(qd, 2.2 * dt); n.x += qdx / qd * qs2; n.z += qdz / qd * qs2; n.h += wrap(Math.atan2(qdx, qdz) - n.h) * Math.min(1, dt * 10);
              n.moving = true; n.amp = 0.7; n.phase += dt * 5.5;
            } else { n.moving = false; n.faceTo = 0; }
          } else { n.arrived = true; startStation(n); }
        }
      }
    }
    updateArenas(dt); updateHoops(dt); updateKicks(dt); updatePE(dt); armT += dt;
  };
  var piT = 0;
  B.beginRender = function (px, pz, pl, camT) { B.px = px; B.pz = pz; B.pl = pl; B.camT = camT; updatePEBalls(); };

  // ================================================================ walking in lines
  // A class walking together keeps ~0.9 m between neighbours: nobody overtakes (or crowds) a classmate who is walking
  // the same way just ahead of them, so the class strings out into a loose line behind whoever leads (the teacher on escort).
  B.gate = function (n, spd) {
    var cl = n.cls;
    // Line-up gating ends at the cafeteria door: children in the serving line (1) or carrying a tray to their seat (3) are not gated.
    if (!n.lineUp || !cl || n.lphase === 1 || n.lphase === 3) { n.curSpd = spd; n.gated = false; return spd; }
    var st = cl.students, fx = Math.sin(n.h), fz = Math.cos(n.h), lim = spd, i, m, dx, dz, al, lat, gap = L.stairAt(n.x, n.z) ? 1.3 : 0.9;
    for (i = -1; i < st.length; i++) {
      m = i < 0 ? cl.teacher : st[i];
      if (m === n || m.hidden || !m.moving || m.level !== n.level) continue;
      dx = m.x - n.x; dz = m.z - n.z; al = dx * fx + dz * fz;
      if (al <= 0.05 || al > gap + 1.5) continue;
      lat = dx * fz - dz * fx; if (lat > 0.55 || lat < -0.55) continue;
      if (Math.sin(m.h) * fx + Math.cos(m.h) * fz < 0.6) continue;               // only people walking the same way
      var l2 = m.curSpd + (al - gap) * 2.2; if (l2 < 0) l2 = 0; if (l2 < lim) lim = l2;
    }
    n.curSpd = lim; n.gated = lim < spd * 0.9; return lim;     // (gated waiting is not 'stuck': see the watchdog in people.js)
  };

  // ====================================================================== pose
  // Targets for the current character; the helpers below fill them in and B.pose eases the character towards them.
  var T = { hy: 0, hp: 0, ln: 0, sx: 0, aL: 0, wL: 0, zL: 0, aR: 0, wR: 0, zR: 0, lL: 0, lR: 0, jy: 0 };
  function clearT() { T.hy = T.hp = T.ln = T.sx = T.aL = T.wL = T.zL = T.aR = T.wR = T.zR = T.lL = T.lR = T.jy = 0; }
  function armsOut(l, r) { T.aL = l; T.wL = 1; T.aR = r; T.wR = 1; }

  // nearest standing character of the same kind (for pairs who talk)
  function findMate(n) {
    var best = null, bd = 2.0 * 2.0;
    for (var i = 0; i < npcs.length; i++) {
      var o = npcs[i]; if (o === n || o.hidden || o.level !== n.level || o.moving || o.path || o.scr || o.sit > 0.2 || o.kind !== n.kind || (o.mate && o.mate !== n)) continue;
      var dx = o.x - n.x, dz = o.z - n.z, d = dx * dx + dz * dz; if (d < bd && d > 0.16) { bd = d; best = o; }
    }
    return best;
  }
  function toward(n, x, z) { return wrap(Math.atan2(x - n.x, z - n.z) - n.h); }

  B.pose = function (n, dt, full) {
    if (!full) {                                                    // position only: ease back to the neutral pose, then stop touching it
      if (n.posed) {
        var k0 = Math.min(1, dt * 7);
        n.hy *= 1 - k0; n.hp *= 1 - k0; n.wL *= 1 - k0; n.wR *= 1 - k0; n.zL *= 1 - k0; n.zR *= 1 - k0; n.lL *= 1 - k0; n.lR *= 1 - k0; n.ln *= 1 - k0; n.sx *= 1 - k0; n.jy = 0;
        if (Math.abs(n.hy) + Math.abs(n.hp) + n.wL + n.wR + Math.abs(n.zL) + Math.abs(n.zR) + Math.abs(n.ln) + Math.abs(n.lL) + Math.abs(n.lR) < 0.02) { n.posed = false; n.hy = n.hp = n.wL = n.wR = n.zL = n.zR = n.lL = n.lR = n.ln = n.sx = 0; }
      }
      return;
    }
    n.posed = true;
    var t = clock.now, id = n.id, sit = n.sit > 0.5;
    clearT();
    if (n.kind === 'student') studentPose(n, t, dt, sit); else staffPose(n, t, dt);
    var kf = Math.min(1, dt * 18), ks = Math.min(1, dt * 7);
    n.hy = ez(n.hy, T.hy, ks); n.hp = ez(n.hp, T.hp, ks); n.ln = ez(n.ln, T.ln, ks); n.sx = ez(n.sx, T.sx, ks);
    n.wL = ez(n.wL, T.wL, kf); n.wR = ez(n.wR, T.wR, kf);
    if (T.wL > 0.01) n.aL = ez(n.aL, T.aL, kf); if (T.wR > 0.01) n.aR = ez(n.aR, T.aR, kf);
    n.zL = ez(n.zL, T.zL, kf); n.zR = ez(n.zR, T.zR, kf); n.lL = ez(n.lL, T.lL, kf); n.lR = ez(n.lR, T.lR, kf); n.jy = T.jy;
  };

  function studentPose(n, t, dt, sit) {
    var id = n.id, act = n.act, moving = n.moving, scr = n.scr, st = n.stT, ph, g, cc, ef;
    if (scr && scr.type === 'swing') {                              // hold the chains, pump the legs, lean with the swing
      var sd = scr.sd, vel = Math.cos(t * 1.9 + sd.phase) * sd.amp;
      armsOut(-2.1, -2.1); T.zL = 0.12; T.zR = -0.12; T.lL = T.lR = 0.55 * vel * (sd.amp > 0.3 ? 1 : 0.2); T.ln = -sd.th * 0.4; T.hp = -0.1;
    } else if (scr && scr.type === 'slide') {
      ph = scr.ph;
      if (ph === 1) { cc = scr.t * 5.5; armsOut(-2.5 + Math.sin(cc) * 0.5, -2.5 - Math.sin(cc) * 0.5); T.lL = -Math.sin(cc) * 0.7; T.lR = Math.sin(cc) * 0.7; T.hp = -0.2; }
      else if (ph === 2) { T.ln = 0.7; armsOut(-0.6, -0.6); T.hp = 0.3; }
      else if (ph === 3) { armsOut(-2.6, -2.6); T.ln = -0.25; T.zL = 0.25; T.zR = -0.25; T.hp = -0.1; }
    } else if (scr && scr.type === 'tag') {
      T.ln = 0.2; T.hp = -0.05;
      if (st && n.stO.it === n && moving) armsOut(-1.6 + Math.sin(t * 9) * 0.3, -1.6 - Math.sin(t * 9) * 0.3);
    } else if (act === 'class' && sit && !moving) classPose(n, t);
    else if (act === 'lunch' && sit && n.prop !== 1) {              // waiting for a place in the line: just chatting, no tray, no eating
      T.hy = 0.7 * Math.sin(t * 0.4 + id * 2.1) * Math.sin(t * 0.17 + id); T.hp = 0.04; T.sx = 0.015 * Math.sin(t * 0.6 + id);
    } else if (act === 'lunch' && sit) {
      cc = (t + id * 1.37) % 5.2; ef = cc < 1.3 ? Math.sin(cc / 1.3 * PI) : 0;       // the hand goes to the mouth now and then
      T.aR = -0.55 - 1.7 * ef; T.wR = 1; T.ln = 0.06; T.hp = 0.12 + ef * 0.05;
      T.hy = 0.75 * Math.sin(t * 0.35 + id * 2.3) * (Math.sin(t * 0.21 + id) > 0 ? 1 : 0.25);
    } else if (act === 'specials' && n.spRoom && !moving) specialPose(n, t, sit);
    else if (st === 'bench' && sit) {
      var mate = n.stO.mate && n.stO.mate.taken, talk = Math.sin(t * 0.8 + id * 1.9) > 0.1;
      T.hy = mate ? toward(n, mate.x, mate.z) * 0.8 : 0.3 * Math.sin(t * 0.4 + id);
      T.hp = talk ? 0.05 + 0.08 * Math.sin(t * 5 + id) : 0.1;
      if (talk) { T.aR = -0.9 + Math.sin(t * 3.1 + id) * 0.45; T.wR = 1; T.zR = -0.25; }
    } else if (st === 'hop' && n.arrived && !n.path) {
      g = n.stO;
      if (n.stI === 0) { var hp1 = (t * 1.5 + id * 0.2) % 1, hop = Math.abs(Math.sin(hp1 * PI)); T.jy = 0.2 * hop; armsOut(0, 0); T.zL = 0.5; T.zR = -0.5; T.lL = T.lR = hop * 0.3; T.hp = 0.15; }
      else { cc = t * 6.0 + (n.stI === 1 ? 0 : PI); var sw = -0.5 + Math.sin(cc) * 0.9; armsOut(sw, sw); T.zL = 0.15; T.zR = -0.15; T.hp = 0.1; n.faceTo = Math.atan2(g.x - n.x, g.z - n.z); }
    } else if (st === 'hoop' && n.arrived && !n.path) hoopPose(n, t);
    else if (st === 'kick' && n.arrived && !n.path) kickPose(n, t);
    else if (!moving && !scr) idlePose(n, t, dt);
    else if (moving) {
      if (n.prop === 1) { armsOut(-1.15, -1.15); T.hp = 0.12; }
      else if (act !== 'recess') {                                  // hallway: a few kids wave when the player passes
        var pdx = n.x - B.px, pdz = n.z - B.pz;
        if (n.level === B.pl && pdx * pdx + pdz * pdz < 9 && t > n.waveCool) { n.waveCool = t + 14; if (hash(id, Math.floor(t / 9)) < 0.4) n.waveUntil = t + 1.6; }
      }
      if (n.act === 'recess' && n.rushing) T.ln = 0.12;
      T.hy = 0.25 * Math.sin(t * 0.9 + id * 1.7);
    }
    if (n.prop === 1 && sit) { T.ln = Math.max(T.ln, 0.06); }
    if (t < n.waveUntil && n.prop !== 1) {
      T.aR = -2.75; T.wR = 1; T.zR = -0.35 + Math.sin(t * 11) * 0.45; T.hy = clamp(0.6 * toward(n, B.px, B.pz), -0.9, 0.9);
    }
  }

  // ---- lessons: watch the board / teacher, write, glance at a neighbour, sway, put a hand up now and then
  function classPose(n, t) {
    var id = n.id, cyc = (t + id * 3.7) % 16, rt = (t + id * 1.7) % 20, rk = Math.floor((t + id * 1.7) / 20);
    var dur = 2 + (id % 3), rs = 1 + ((id * 7) % 13) * 1.2;           // a 2-4 s hand-raise window somewhere in each 20 s cycle
    var tc = n.cls.teacher, ty = toward(n, tc.x, tc.z), raising = rt > rs && rt < rs + dur && hash(id, rk) < 0.78;
    n.raise = raising ? 1 : 0;
    if (raising) { T.aR = -2.9; T.wR = 1; T.zR = -0.1 + Math.sin(t * 2.2 + id) * 0.08; T.hy = clamp(ty, -1, 1) * 0.8; T.hp = -0.08; }
    else if (cyc < 3.5 || cyc > 12.5) { T.hy = clamp(ty, -1.0, 1.0) * 0.85; T.hp = -0.04; }
    else if (cyc < 9.5) {                                           // writing
      T.hp = 0.5; T.ln = 0.12; T.hy = 0.12 * Math.sin(t * 0.7 + id);
      T.aR = -0.95 + 0.07 * Math.sin(t * 9 + id); T.wR = 1; T.zR = -0.1 + 0.08 * Math.sin(t * 5.3 + id * 2); T.aL = -0.7; T.wL = 1;
    } else { T.hy = ((id & 1) ? 0.7 : -0.7) * Math.sin((cyc - 9.5) / 3 * PI); T.hp = 0.05; }
    T.sx = 0.012 * Math.sin(t * 0.6 + id); T.ln += 0.02 * Math.sin(t * 0.8 + id * 1.3);
  }

  // ---- the specials rooms
  function specialPose(n, t, sit) {
    var id = n.id, r = n.spRoom, cc;
    if (r === 'gym') {
      var ph = Math.floor((clock.now % 120) / 40);
      if (ph === 0 && n.peOn === 1) { T.ln = 0.12; }
      else if (ph === 1) {                                          // jumping jacks
        cc = (t * 2.2 + (id % 3) * 0.02) % 1; var up = 0.5 - 0.5 * Math.cos(cc * 2 * PI);
        T.zL = 0.2 + 2.55 * up; T.zR = -T.zL; T.wL = T.wR = 1; T.aL = T.aR = 0; T.jy = 0.18 * Math.sin(cc * PI * 2 > 0 ? Math.abs(Math.sin(cc * PI)) : 0); T.lL = T.lR = up * 0.15;
      } else if (ph === 2 && n.ballMate) {                           // pass the ball to the partner
        T.hy = toward(n, n.ballMate.x, n.ballMate.z) * 0.9; n.faceTo = Math.atan2(n.ballMate.x - n.x, n.ballMate.z - n.z);
        var u = n.ballU || 0, catching = n.ballTo ? u : 1 - u, throwing = n.ballTo ? 1 - u : u;
        T.aL = T.aR = -1.2 - 0.6 * (catching > 0.7 ? 1 : 0) - (throwing < 0.15 ? 0.5 : 0); T.wL = T.wR = 1; T.zL = 0.15; T.zR = -0.15; T.hp = -0.1;
      } else { T.sx = 0.02 * Math.sin(t * 0.9 + id); }
    } else if (r === 'music') {                                     // sway together, singing up at the teacher
      T.sx = 0.06 * Math.sin(t * 2.1 + id * 0.15); T.ln = 0.03 * Math.sin(t * 2.1 + id * 0.15); T.hp = -0.18; T.hy = 0.05 * Math.sin(t * 2.1);
      T.zL = 0.12 + 0.06 * Math.sin(t * 2.1); T.zR = -T.zL;
    } else if (r === 'library') {                                   // reading: head down, a page turn every so often
      T.hp = 0.5; T.ln = 0.1; cc = (t + id * 2.9) % 9; var pt = cc < 1.2 ? Math.sin(cc / 1.2 * PI) : 0;
      T.aL = -0.8; T.wL = 1; T.aR = -0.8 - 0.5 * pt; T.wR = 1; T.zR = -0.2 * pt; T.hy = 0.1 * Math.sin(t * 0.3 + id);
    } else if (r === 'art') {                                       // drawing: the right hand moves in small strokes, head down
      T.hp = 0.45; T.ln = 0.14; T.aR = -1.0 + 0.12 * Math.sin(t * 6 + id); T.wR = 1; T.zR = -0.1 + 0.18 * Math.sin(t * 3.4 + id * 1.3); T.aL = -0.8; T.wL = 1; T.hy = 0.15 * Math.sin(t * 0.4 + id);
    } else if (r === 'computer') {                                  // typing
      T.hp = 0.12; T.aL = -1.0 + 0.1 * Math.sin(t * 11 + id); T.aR = -1.0 + 0.1 * Math.sin(t * 9.3 + id); T.wL = T.wR = 1; T.ln = 0.05; T.hy = 0.05 * Math.sin(t * 0.5 + id);
    } else {                                                        // stem: building something with both hands
      T.hp = 0.4; T.ln = 0.12; T.aL = -1.1 + 0.2 * Math.sin(t * 4 + id); T.aR = -1.1 + 0.2 * Math.sin(t * 5.1 + id); T.wL = T.wR = 1; T.hy = 0.25 * Math.sin(t * 0.6 + id);
    }
  }

  // basketball: the holder dribbles with the right hand, then shoots; the others watch and get ready for the pass
  function hoopPose(n, t) {
    var g = n.stO, b = g.ball, holder = b.holder === n, r = g.rim;
    if (holder && b.st === 'hold') {
      var by = n.dribY || 0.5; T.aR = -0.3 - 0.9 * clamp((by - 0.14) / 0.72, 0, 1); T.wR = 1; T.ln = 0.18; T.hp = 0.25; T.aL = -0.5; T.wL = 1; T.lL = 0.1;
      n.faceTo = toward(n, r.x, r.z) + n.h;
    } else if (holder && b.st === 'shot') {
      var u = Math.min(1, b.t / 1.25); T.aL = T.aR = -2.8 + (u > 0.2 ? 0.5 : 0); T.wL = T.wR = 1; T.hp = -0.3; T.ln = -0.1 - 0.12 * (u < 0.3 ? 1 : 0); T.jy = u < 0.35 ? 0.3 * Math.sin(u / 0.35 * PI) : 0; T.zL = 0.2; T.zR = -0.2;
    } else {
      T.hp = -0.05; T.hy = clamp(toward(n, b.x, b.z), -1, 1) * 0.9; T.ln = 0.08;
      var ready = b.st === 'pass' && b.to === n; T.aL = T.aR = ready ? -1.5 : -0.6; T.wL = T.wR = ready ? 1 : 0.7; T.zL = ready ? 0.3 : 0.1; T.zR = -T.zL;
      n.faceTo = Math.atan2(b.x - n.x, b.z - n.z);
    }
  }
  function kickPose(n, t) {
    var g = n.stO, b = g.ball;
    if (b.holder === n && n.kickT !== undefined && b.st === 'kick') {                // swing the kicking leg
      var k = n.kickT; T.lR = -1.1 * Math.sin(Math.max(0, Math.min(1, k)) * PI * 0.8) - 0.25 * (k > 0.9 ? 1 : 0); T.ln = -0.05; armsOut(0.5, -0.6); T.zL = 0.5; T.zR = -0.5;
    } else {
      T.hy = clamp(toward(n, b.x, b.z), -1.1, 1.1); T.hp = 0.15; T.ln = 0.1; T.sx = 0.02 * Math.sin(t * 1.3 + n.id);
      if (b.holder !== n && b.st === 'kick') { T.zL = 0.5; T.zR = -0.5; T.wL = T.wR = 1; T.aL = T.aR = -0.15; }
      if (b.holder !== n) n.faceTo = Math.atan2(b.x - n.x, b.z - n.z);
    }
  }

  // standing around: shift weight, look about, turn to chat with whoever is next to us
  function idlePose(n, t, dt) {
    var id = n.id;
    if (!n.mateT || t > n.mateT) {
      n.mateT = t + 2.5 + hash(id, Math.floor(t)) * 3;
      if (n.mate && (n.mate.hidden || n.mate.moving || n.mate.path || Math.hypot(n.mate.x - n.x, n.mate.z - n.z) > 2.6)) n.mate = null;
      if (!n.mate && n.act !== 'class' && !n.scr) { var m = findMate(n); if (m) { n.mate = m; if (!m.mate) m.mate = n; } }
    }
    var m2 = n.mate;
    T.sx = 0.022 * Math.sin(t * 0.55 + id * 1.9); T.ln = 0.02 * Math.sin(t * 0.7 + id);
    if (m2) {
      n.faceTo = Math.atan2(m2.x - n.x, m2.z - n.z);
      var turn = (id < m2.id) ? 0 : 1, sp = Math.sin(t * 0.9 + (turn ? PI : 0)) > 0;      // taking turns to talk
      T.hy = clamp(toward(n, m2.x, m2.z), -0.8, 0.8) * 0.5; T.hp = sp ? 0.04 + 0.08 * Math.sin(t * 5 + id) : 0.02;
      if (sp) { T.aR = -0.8 + 0.45 * Math.sin(t * 3.3 + id); T.wR = 1; T.zR = -0.3; if (Math.sin(t * 0.37 + id) > 0.3) { T.aL = -0.7 + 0.4 * Math.sin(t * 2.9); T.wL = 1; T.zL = 0.3; } }
    } else {
      T.hy = 0.75 * Math.sin(t * 0.45 + id * 1.7) * Math.sin(t * 0.13 + id * 0.7); T.hp = 0.05 * Math.sin(t * 0.31 + id);
    }
  }

  function staffPose(n, t, dt) {
    var id = n.id, moving = n.moving;
    if (n.role === 'Teacher' && n.cls && !moving && n.ctx === 'home' && n.cls.students[0].act === 'class' && inOwnRoom(n)) {
      var cyc = (t + id * 5.1) % 17, cdir = n.cls.room ? classDir(n) : 0;
      if (cyc < 6) {                                                 // facing the class, talking with the hands
        n.faceTo = cdir + PI; T.aR = -1.2 + 0.4 * Math.sin(t * 2.6); T.wR = 1; T.zR = -0.3; T.hy = 0.3 * Math.sin(t * 0.8);
        if (Math.sin(t * 0.5 + id) > 0.2) { T.aL = -0.9 + 0.3 * Math.sin(t * 2.2); T.wL = 1; T.zL = 0.35; }
      } else if (cyc < 11) {                                         // turned to the board, pointing and writing
        n.faceTo = cdir; T.aR = -1.9 + 0.12 * Math.sin(t * 3.1); T.wR = 1; T.zR = -0.15; T.hp = -0.1;
      } else {                                                       // open hands to the class
        n.faceTo = cdir + PI; T.aL = T.aR = -0.8 + 0.2 * Math.sin(t * 2); T.wL = T.wR = 1; T.zL = 0.55; T.zR = -0.55; T.hp = -0.03;
      }
      T.sx = 0.01 * Math.sin(t * 0.5 + id);
    } else if (!moving) {
      if (n.role === 'Cafeteria Helper' && n.act !== undefined && t > 0) { var sc = (t + id) % 3.2; if (sc < 1.4) { T.aR = -0.9 + 0.55 * Math.sin(sc / 1.4 * PI); T.wR = 1; T.hp = 0.2; } }
      T.sx = 0.02 * Math.sin(t * 0.5 + id); T.hy = 0.6 * Math.sin(t * 0.35 + id * 1.3) * Math.sin(t * 0.11 + id);
    }
  }
  function classDir(n) { return L.classLayouts[n.cls.id].heading; }     // the direction of the room's whiteboard
  function inOwnRoom(n) { var cl = n.cls, r = cl.room; return r && n.x > r.x0 - 0.3 && n.x < r.x1 + 0.3 && n.z > r.z0 - 0.3 && n.z < r.z1 + 0.3; }
})();
