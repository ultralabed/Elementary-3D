/*
 * nav.js - waypoint graph + shortest-path routing for the pretend school day.
 *
 * Two kinds of nodes:
 *   hub  - routing waypoints (hallway centre lines, door points, aisles, outdoor
 *          path nodes).  Hubs are linked automatically when the straight segment
 *          between them is not blocked by a wall / big prop / piece of furniture
 *          (visibility graph with clearance), so nobody can route through a wall.
 *   spot - "leaf" destinations (a chair, a bench seat, a recess spot ...).  A leaf
 *          only links to nearby hubs and is never used as a stepping stone.
 *
 * Spots are grouped in lists (nav.spots['seat:c_3A'], nav.spots.lunch, ...) that
 * people.js picks from.  nav.route(a, b) returns node indices a..b.
 */
(function () {
  'use strict';
  var S = window.CAMPUS, L = S.layout;
  var nav = S.nav = { nodes: [], spots: {}, built: false };
  var nodes = nav.nodes, byName = {};
  var LV = 0;        // level given to the nodes being created (0 ground / outdoors, 1 second floor)

  function node(x, z, leaf, name) {
    var n = { i: nodes.length, x: x, z: z, y: 0, h: null, sit: false, leaf: !!leaf, adj: [], name: name || '', link: null, maxd: 0, level: LV };
    nodes.push(n); if (name) byName[name] = n; return n;
  }
  function hub(name, x, z) { return node(x, z, false, name); }
  // spot(listKey, x, z, opts{h, sit, y, hubs:[names or nodes], maxd, k})
  function spot(key, x, z, o) {
    o = o || {};
    var n = node(x, z, true);
    n.h = o.h == null ? null : o.h; n.sit = !!o.sit; n.y = o.y || 0;
    n.link = o.hubs || null; n.maxd = o.maxd || 9; n.k = o.k || 2; n.rec = key.indexOf('rec:') === 0;
    // seated characters sit a little behind the chair centre so their knees clear the desk
    if (n.sit && n.h != null) { n.x -= Math.sin(n.h) * 0.12; n.z -= Math.cos(n.h) * 0.12; }
    n.key = key;
    (nav.spots[key] = nav.spots[key] || []).push(n);
    return n;
  }
  nav.hubByName = function (n) { return byName[n]; };

  function build() {
    var i, j, k, r, w, n;
    var R = L.roomById;

    // ------------------------------------------------ outdoor path network
    // ring around the building
    var ringX = [-44, -30, -14, 0, 20, 36, 52, 60], ringZ = [44];
    ringX.forEach(function (x) { hub('f' + x, x, 44); });
    hub('f8', 8, 44);
    [28, 10, -8, -20].forEach(function (z) { hub('w' + z, -56, z); hub('e' + z, 60, z); });
    hub('bw', -44, -33); hub('be', 60, -33);
    L.wings.forEach(function (wg) { if (!wg.level) hub('bk' + wg.id, wg.cx, -33); });
    // courtyard (east of the ground wings, north of the main hallway)
    hub('cyDoor', 38, 6.2); hub('cy1', 38, -4); hub('cy2', 38, -24); hub('cy3', 22, -11); hub('cy4', 52, -11);
    hub('bk-10', -10, -33); hub('bk8', 8, -33); hub('bk32', 32, -33);
    // drop-off sidewalk
    [-60, -48, -36, -22, -10, 0, 8, 20, 34, 46, 58, 70, 82, 94].forEach(function (x) { hub('d' + x, x, 56.5); });
    hub('walk1', 8, 50); hub('doorOut', 8, 41.8);
    // field
    [-60, -90, -118].forEach(function (x) { [-8, -35, -62].forEach(function (z) { hub('fl' + x + '_' + z, x, z); }); });
    hub('fgate', -52, -20); hub('fgate2', -52, -45);
    // playground
    [[-24, -44], [-6, -44], [-24, -56], [-8, -58], [4, -44], [4, -62], [-14, -68], [-26, -68], [-13, -42]].forEach(function (p, q) { hub('pg' + q, p[0], p[1]); });
    hub('pgIn1', -16, -36); hub('pgIn2', 0, -36);
    // court
    hub('ct0', 34, -38); hub('ct1', 34, -47); hub('ct2', 27, -55); hub('ct3', 41, -55); hub('ct4', 34, -56);
    hub('ctIn', 34, -33);

    // ------------------------------------------------------------- lobby
    hub('lobIn', 8, 38); hub('lob34', 9.4, 34); hub('lob26', 8, 26); hub('lob18', 8, 18); hub('lob13', 8, 13.6);
    // main hallway centre line + doors off it
    var hallX = { 'hW': -50.6, 'hStW': -51, 'h-45': -45, 'hGym': -36.5, 'h-16': -16, 'hCafe': -6, 'h8': 8, 'hNurse': 17, 'hStE': 19, 'hLib': 31, 'hCy': 38, 'hSide': 41.5, 'h54': 54.6 };
    for (k in hallX) hub(k, hallX[k], 10);
    L.wings.forEach(function (wg) { LV = wg.level; hub('hm' + wg.id, wg.cx, 10); });
    // upper hallway (second floor)
    LV = 1; hub('uW', -41, 10); hub('uMid', -16, 10); hub('uE', 9, 10);
    // stairs: a hub on each landing, joined by one edge along the flight
    LV = 0; hub('stWg', -51, 5); hub('stEg', 19, 5);
    LV = 1; hub('stWu', -41, 5); hub('stEu', 9, 5);
    LV = 0;
    // side hall
    [14, 19, 26, 33, 38].forEach(function (z) { hub('sh' + z, 41.5, z); });

    // --------------------------------------------------------- wing halls
    L.wings.forEach(function (wg) {
      LV = wg.level;
      L.bands.forEach(function (b, bi) { hub(wg.id + 'b' + bi, wg.cx, (b[0] + b[1]) / 2); });
      if (!wg.level) { hub(wg.id + 'bk', wg.cx, -26.4); hub(wg.id + 'out', wg.cx, -30.6); }
    });
    LV = 0;

    // ------------------------------------------------- band rooms (desks)
    // Desk rooms: a corridor of hubs runs behind each row of chairs (every chair has a hub straight behind it), the centre aisle
    // joins the corridors to the door and to the front of the room.  These hubs only link inside their own room (and to the door hub).
    L.bandRooms.forEach(function (r) {
      var c = r.cl, id = r.id; LV = r.level;
      hub(id + ':door', c.door.x, c.door.z);
      if (r.desks) {
        c.cd.forEach(function (d, di) { c.OS.forEach(function (o, k) { var p = c.W(d, o), h = hub(id + ':r' + di + '_' + k, p.x, p.z); h.rm = id; }); });
        [-1.7, 0, 1.5].forEach(function (o, k) { var p = c.W(8.1, o), h = hub(id + ':f' + k, p.x, p.z); h.rm = id; });
        c.desks.forEach(function (d) {              // student chairs
          spot('seat:' + id, d.cx, d.cz, { h: c.heading, sit: true, k: 2, hubs: [id + ':r' + d.ri + '_' + c.OS.indexOf(c.colO[d.ci])] });
        });
        // standing spots in the corridors (aisle spots for specials and for teachers walking an aisle)
        [0, 1, 2].forEach(function (di) { [1, 3, 5].forEach(function (k) {
          var p = c.W(c.cd[di] + 0.0, c.OS[k]);
          spot('floor:' + id, p.x, p.z, { h: c.heading, hubs: [id + ':r' + di + '_' + k] });
        }); });
      }
      // teacher / staff strolling spots
      var ts = [c.W(8.6, -1.4), c.W(8.6, 0.6), c.W(8.1, 1.6)];
      if (!r.desks) ts = [c.W(5.5, -1.5), c.W(7.5, 1.8), c.W(3.5, 2)];
      if (id === 'lounge') ts = [];
      ts.forEach(function (p, q) {
        spot('stroll:' + id, p.x, p.z, { h: q === 0 ? c.heading : null, maxd: 7,
          hubs: r.desks ? [[id + ':f0', id + ':f1'], [id + ':f1', id + ':f2'], [id + ':f2']][q] : null });
      });
      if (!r.desks) { hub(id + ':mid', c.W(5, 0).x, c.W(5, 0).z); }
    });

    LV = 0;
    // --------------------------------------------------------------- gym
    hub('gymIn', -36.5, 13.6);
    [-34, -28, -22].forEach(function (x) { [16, 24, 32, 38].forEach(function (z) { hub('gym' + x + '_' + z, x, z); }); });
    [-34, -30, -26, -22].forEach(function (x) { [18, 22, 26, 30, 34].forEach(function (z) {
      spot('special:gym', x, z, { maxd: 7, h: Math.PI });
    }); });
    spot('stroll:gym', -28, 25, { h: 0 }); spot('stroll:gym', -24, 16, {}); spot('stroll:gym', -33, 31, {});

    // -------------------------------------------------------- cafeteria
    hub('cafeIn', -6, 13.9);
    var cx = [-11, -6.8, -1.5], zk = [], kk;
    for (kk = 0; kk < 6; kk++) zk.push(13.9 + 4.2 * kk);
    zk.forEach(function (z, ki) {
      cx.forEach(function (x, xi) { hub('cf' + ki + '_' + xi, x, z); });
      hub('cfe' + ki, 2.4, z).strip = true;
    });
    L.F.cafeTables.forEach(function (t, ti) {
      var row = Math.round((t.z - 16) / 4.2), xi = t.x < -6 ? 0 : 2;
      [-1, 1].forEach(function (side) {
        for (var s6 = 0; s6 < 6; s6++) {
          var s = (s6 - 2.5) * 1.05 / 1.3, kz = side < 0 ? row : row + 1, hubs = [xi, xi === 0 ? 1 : 1].map(function (q, qi) { return 'cf' + kz + '_' + (qi === 0 ? xi : 1); });
          spot('lunch', t.x + s * 1.3, t.z + side * 1.0, { sit: true, h: side < 0 ? 0 : Math.PI, hubs: hubs, k: 2 });
        }
      });
    });
    spot('stroll:counter', 1.9, 14.6, { h: Math.PI / 2, hubs: ['cfe0'] }); spot('stroll:counter', 1.3, 28.4, { h: Math.PI / 2, hubs: ['cfe3', 'cfe4'] });
    spot('stroll:counter', 1.9, 35.2, { h: Math.PI / 2, hubs: ['cfe5'] });
    // serving line: 26 slots along the counter wall (hubs, so people can walk from slot to slot); slot 0 is the head
    nav.queue = [];
    for (i = 0; i < 26; i++) { var qh = hub('q' + i, 2.45, 15.9 + 0.7 * i); qh.strip = true; qh.qi = i; nav.queue.push(qh); }
    spot('stroll:cafe', -6, 21, {}); spot('stroll:cafe', -6, 30, {});
    [[-14.8, 14.2], [-1, 13.6], [-15, 36.2], [-1.5, 36.4], [-9.5, 36.4]].forEach(function (p) { spot('stroll:cafe', p[0], p[1], {}); });

    // ----------------------------------------------------------- library
    hub('libIn', 31, 13.8);
    [['A1', 31, 18.8], ['A2', 31, 23.3], ['A3', 31, 27.6], ['A4', 31, 32], ['A5', 31, 37.3], ['N1', 27, 18.8], ['N2', 35, 18.8], ['S1', 27, 23.3], ['S2', 35, 23.3]]
      .forEach(function (h) { hub('lib' + h[0], h[1], h[2]); });
    L.F.libTables.forEach(function (t, ti) {
      [-0.8, 0.8].forEach(function (dx) {
        spot('special:library', t.x + dx, t.z - 1.0, { sit: true, h: 0, hubs: ['lib' + (ti ? 'N2' : 'N1')], k: 1 });
        spot('special:library', t.x + dx, t.z + 1.0, { sit: true, h: Math.PI, hubs: ['lib' + (ti ? 'S2' : 'S1')], k: 1 });
      });
    });
    L.F.libBeanbags.forEach(function (b) {
      spot('special:library', b.x, b.z, { sit: true, h: Math.atan2(31 - b.x, 32 - b.z), hubs: ['libA4', 'libA3'] });
    });
    [[30, 31.2], [32.2, 31.2], [29.8, 33.2], [32.4, 33.4]].forEach(function (p) { spot('special:library', p[0], p[1], { sit: true, hubs: ['libA4'], h: 0 }); });
    [[24.4, 19], [24.4, 30], [37.6, 19], [37.6, 30]].forEach(function (p) { spot('special:library', p[0], p[1], { hubs: ['libN1', 'libA3'], maxd: 8, h: p[0] < 30 ? -Math.PI / 2 : Math.PI / 2 }); });
    spot('stroll:library', 35.6, 15.4, { hubs: ['libIn', 'libA1'], h: Math.PI });
    spot('stroll:library', 31, 29.6, { hubs: ['libA3'] }); spot('stroll:library', 24.6, 24, { hubs: ['libN1', 'libS1'], maxd: 8 });

    // -------------------------------------------------------------- music
    hub('musIn', 44.8, 19); hub('mus1', 48.4, 19.3); hub('mus2', 50, 16.2); hub('mus3', 50, 22.4);
    [51.7, 53.1, 54.4].forEach(function (x, xi) {
      [15.8, 17.8, 19.8, 21.8, 23.6].forEach(function (z) {
        spot('special:music', x, z, { y: [0.25, 0.5, 0.75][xi], h: Math.PI / 2, hubs: ['mus2', 'mus3', 'mus1'], maxd: 8, k: 2 });
      });
    });
    [[46.5, 18], [46.5, 21], [46.5, 23.6], [48.6, 20.8], [48.2, 17.2]].forEach(function (p) { spot('special:music', p[0], p[1], { h: Math.PI / 2, hubs: ['mus1', 'musIn'], maxd: 8 }); });
    spot('stroll:music', 47, 17.2, { hubs: ['mus1'], h: Math.PI / 2 }); spot('stroll:music', 46.4, 22.5, { hubs: ['mus1'] });
    spot('stroll:music', 48.5, 15.5, { hubs: ['mus2', 'mus1'], maxd: 8, h: Math.PI / 2 });

    // ------------------------------------------------------ teacher lounge
    hub('loungeIn', 44.8, 33); hub('lounge1', 47, 29.5); hub('lounge2', 47, 37);
    spot('stroll:lounge', 46.4, 30.5, { hubs: ['lounge1'] }); spot('stroll:lounge', 51.8, 33, { hubs: ['lounge1', 'lounge2'], maxd: 9 });
    spot('stroll:lounge', 46.4, 36.6, { hubs: ['lounge2'] });

    // ---------------------------------------------- nurse / office / misc
    hub('nurIn', 17, 13.8); hub('nur2', 16.5, 20); hub('nur3', 16.5, 23.5);
    spot('stroll:nurse', 15.6, 17.8, { hubs: ['nur2', 'nurIn'], maxd: 8, h: -Math.PI / 2 }); spot('stroll:nurse', 17.5, 22.5, { hubs: ['nur2', 'nur3'] });
    spot('stroll:nurse', 18.2, 16.5, { hubs: ['nurIn'], maxd: 8 });
    hub('offDoor', 10.6, 34); hub('offIn', 13.4, 34); hub('off1', 17, 34); hub('off2', 17, 29); hub('off3', 17, 38.2);
    spot('stroll:office', 18.2, 28.9, { hubs: ['off2'], h: Math.PI / 2 }); spot('stroll:office', 18.2, 38.9, { hubs: ['off3'], h: Math.PI / 2 });
    spot('stroll:office', 16.6, 31.6, { hubs: ['off2', 'off1'] }); spot('stroll:office', 13, 30, { hubs: ['offIn'], maxd: 8 });
    spot('stroll:lobby', 6, 36, { hubs: ['lobIn'] }); spot('stroll:lobby', 10.2, 28, { hubs: ['lob26'] }); spot('stroll:lobby', 6.3, 20, { hubs: ['lob18'] });
    spot('stroll:hall', -20, 10, {}); spot('stroll:hall', 12, 10, {}); spot('stroll:hall', 36, 10, {}); spot('stroll:hall', -4, 9.5, {});
    spot('stroll:hall', 24, 10.5, {}); spot('stroll:hall', -33, 10.5, {});

    // ---------------------------------------- outdoor: drop-off / pick-up
    L.buses.forEach(function (b, bi) {
      for (i = -3; i <= 3; i++) spot('bus' + bi, b.x + i * 1.35, 60.3, { maxd: 12 });
    });
    for (i = 0; i < 18; i++) spot('car', 52 + i * 2.3, 59.6, { maxd: 12 });
    for (i = 0; i < 12; i++) spot('drop', (i < 6 ? L.buses[0].x : L.buses[1].x) + ((i % 6) - 2.5) * 1.4, 60.2, { maxd: 12 });

    // --------------------------------------------------- outdoor: recess
    // recess spots are generated on grids, skipping anything solid, so even the biggest group (88) has its own spot
    function free(x, z, m) { return !L.segBlocked(x, z, x + 0.01, z, m, 0.6); }
    for (var gx = -28; gx <= 8.5; gx += 3.2) for (var gz = -70; gz <= -40; gz += 3.2)
      if (free(gx, gz, 1.3)) spot('rec:playground', gx, gz, { maxd: 24, k: 2 });
    for (var fx = -116; fx <= -64; fx += 7.5) for (var fz = -70; fz <= -6; fz += 8) {
      if (Math.hypot(fx + 90, fz + 67) < 4 || Math.hypot(fx + 90, fz + 3) < 4) continue;
      spot('rec:field', fx, fz, { maxd: 40, k: 2 });
    }
    for (var cx2 = 24; cx2 <= 46; cx2 += 3.6) for (var cz2 = -57; cz2 <= -45; cz2 += 3) if (free(cx2, cz2, 1.2)) spot('rec:court', cx2, cz2, { maxd: 16, k: 2 });
    [[24, -8], [50, -8], [38, -16], [30, 2], [46, 2]].forEach(function (p) { spot('rec:yard', p[0], p[1], { maxd: 20 }); });   // courtyard
    [[-20, -34], [-6, -34], [-34, -34], [14, -34], [27, -34]].forEach(function (p) { spot('rec:yard', p[0], p[1], { maxd: 14 }); });
    [[-48, -46], [-48, -44]].forEach(function (p) { spot('rec:pavilion', p[0], p[1], { maxd: 14 }); });
    // recess activity stations (see behavior.js).  All coordinates were chosen clear of the equipment.
    var A = nav.act = { swing: [], bench: [], arenas: [], hoops: [], kicks: [], hops: [], patrol: {} };
    L.play.swingSets.forEach(function (sw) { sw.seats.forEach(function (dx) { A.swing.push(spot('act:swing', sw.x + dx, sw.z - 1.35, { maxd: 60, h: 0 })); }); });
    var tw = L.play.tower;
    A.slideFoot = spot('act:slide', tw.x, tw.z - 2.5, { maxd: 60, h: 0 }); A.slideOut = spot('act:slideout', tw.x + 5.2, tw.z, { maxd: 60, h: Math.PI / 2 });
    L.play.benches.forEach(function (b, bi) {          // two sitters per bench, turned a little towards each other
      var fx = Math.sin(b.rot), fz = Math.cos(b.rot), rx = Math.cos(b.rot), rz = -Math.sin(b.rot);   // facing / along-bench directions
      [-0.5, 0.5].forEach(function (o, k) {
        var h = b.rot + (k ? -0.85 : 0.85);
        var sp = spot('act:bench', b.x + rx * o - fx * 0.0, b.z + rz * o, { sit: true, y: 0.12, h: h, maxd: 60 });
        sp.bench = bi; sp.mate = null; A.bench.push(sp);
      });
    });
    for (i = 0; i < A.bench.length; i += 2) { A.bench[i].mate = A.bench[i + 1]; A.bench[i + 1].mate = A.bench[i]; }
    // tag arenas (entry spot in the middle; rectangles are roamed freely by the chase script)
    [{ id: 'playground', x0: -27, z0: -57, x1: -18.5, z1: -45 }, { id: 'field', x0: -108, z0: -28, x1: -96, z1: -16 }, { id: 'court', x0: 30.5, z0: -56, x1: 39.5, z1: -46 }].forEach(function (a) {
      a.cx = (a.x0 + a.x1) / 2; a.cz = (a.z0 + a.z1) / 2; a.zone = a.id; a.spot = spot('act:tag', a.cx, a.cz, { maxd: 60 }); A.arenas.push(a);
    });
    // basketball: four players around each hoop; the ball goes between them
    L.courtHoops.forEach(function (hp, hi) {
      var d = hp.dir, g = { hoop: hp, rim: { x: hp.x + d * 0.45, y: 2.9, z: hp.z }, spots: [] };
      [[4.2, -2.6], [4.2, 2.6], [6.4, 0.0], [2.6, 0.0]].forEach(function (o) { g.spots.push(spot('act:hoop', hp.x + d * o[0], hp.z + o[1], { maxd: 40, h: d > 0 ? -Math.PI / 2 : Math.PI / 2 })); });
      A.hoops.push(g);
    });
    // kickball circles on the field (five players, ball passed around)
    [[-76, -46], [-100, -50], [-78, -14]].forEach(function (c) {
      var g = { x: c[0], z: c[1], spots: [] };
      for (var q = 0; q < 5; q++) { var an = q * 1.2566 + 0.3; g.spots.push(spot('act:kick', c[0] + Math.sin(an) * 3.4, c[1] + Math.cos(an) * 3.4, { maxd: 60, h: an + Math.PI })); }
      A.kicks.push(g);
    });
    // jump rope: the jumper in the middle, two turners either side
    [{ x: -7, z: -46.5, zone: 'playground' }, { x: -86, z: -30, zone: 'field' }, { x: 35, z: -49, zone: 'court', skip: true }].forEach(function (c) {
      if (c.skip) return;
      var g = { zone: c.zone, x: c.x, z: c.z, spots: [spot('act:hop', c.x, c.z, { maxd: 60, h: 0 }), spot('act:hop', c.x - 1.9, c.z, { maxd: 60, h: Math.PI / 2 }), spot('act:hop', c.x + 1.9, c.z, { maxd: 60, h: -Math.PI / 2 })] };
      A.hops.push(g);
    });
    // no plain recess spot within 1.4 m of a game station (keeps the idle kids off the players)
    var stn = [A.slideFoot, A.slideOut].concat(A.swing, A.bench, A.arenas.map(function (q) { return q.spot; }));
    A.hoops.forEach(function (g) { stn = stn.concat(g.spots); }); A.kicks.forEach(function (g) { stn = stn.concat(g.spots); }); A.hops.forEach(function (g) { stn = stn.concat(g.spots); });
    ['rec:playground', 'rec:field', 'rec:court'].forEach(function (k) {
      nav.spots[k] = nav.spots[k].filter(function (q) { return !stn.some(function (t) { return Math.hypot(t.x - q.x, t.z - q.z) < 1.4; }); });
    });
    // dismissal posts along the front lawn (enough for every supervising teacher, coach and the principals) and the places teachers wait in the cafeteria
    for (i = 0; i < 24; i++) spot('post:front', -6 + (i % 12) * 2.8, i < 12 ? 52.6 : 54.8, { maxd: 14 });
    for (i = 0; i < 10; i++) {
      var ez = 24.5 + i * 1.2, kn = Math.max(0, Math.min(4, Math.round((ez - 13.9) / 4.2 - 0.5)));
      spot('escort:cafe', -6.8, ez, { maxd: 9, hubs: ['cf' + kn + '_1', 'cf' + (kn + 1) + '_1'] });
    }
    // teachers on duty walk the edge of their yard
    A.patrol.playground = [[-27, -43], [7, -44], [7, -68.5], [-27, -68.5]].map(function (p) { return spot('patrol:playground', p[0], p[1], { maxd: 60 }); });
    A.patrol.field = [[-66, -8], [-66, -66], [-112, -66], [-112, -8]].map(function (p) { return spot('patrol:field', p[0], p[1], { maxd: 60 }); });
    A.patrol.court = [[24, -44], [46, -44], [46, -58.5], [24, -58.5]].map(function (p) { return spot('patrol:court', p[0], p[1], { maxd: 60 }); });
    // supervisor posts
    spot('post:playground', -10, -42, { maxd: 22 }); spot('post:field', -62, -30, { maxd: 30 }); spot('post:court', 34, -44, { maxd: 14 });
    spot('post:front', 4, 54, { maxd: 14 }); spot('post:front', 14, 54, { maxd: 14 }); spot('post:front', 3, 43, { maxd: 14 });

    // -------------------------------------------------------------- edges
    var hubs = nodes.filter(function (q) { return !q.leaf; });
    function link(a, b, d) { a.adj.push({ j: b.i, d: d }); b.adj.push({ j: a.i, d: d }); }
    for (i = 0; i < hubs.length; i++) for (j = i + 1; j < hubs.length; j++) {
      var a = hubs[i], b = hubs[j], d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 62 || a.level !== b.level) continue;
      if (a.strip || b.strip) {                           // the serving line and the counter-side hubs are never a through route: they only link sideways to the aisles (and to each other along the line)
        var sa = a.strip, sb = b.strip, other = sa ? b : a;
        if (sa && sb) { if (!(a.qi !== undefined && b.qi !== undefined && Math.abs(a.qi - b.qi) === 1)) continue; }
        else if (!(/^cf\d_2$/.test(other.name) && d <= 7)) continue;
      }
      if ((a.rm || b.rm) && a.rm !== b.rm && !(a.rm && b.name === a.rm + ':door') && !(b.rm && a.name === b.rm + ':door')) continue;   // classroom corridor hubs stay in their room
      if (L.segBlocked(a.x, a.z, b.x, b.z, 0.45, 0.25, a.level)) continue;
      link(a, b, d);
    }
    // the two stair flights (true walking length incl. the rise)
    link(byName.stWg, byName.stWu, 9.2 + 2); link(byName.stEg, byName.stEu, 9.2 + 2);
    nodes.forEach(function (lf) {
      if (!lf.leaf) return;
      var cand = [];
      if (lf.link) {
        lf.link.forEach(function (h) { var hn = typeof h === 'string' ? byName[h] : h; if (hn) cand.push(hn); });
        if (!cand.length) console.warn('spot with unknown hubs', lf.x, lf.z);
        cand.forEach(function (hn) { link(lf, hn, Math.hypot(lf.x - hn.x, lf.z - hn.z)); });
        return;
      }
      hubs.forEach(function (h) {
        var d = Math.hypot(lf.x - h.x, lf.z - h.z);
        if (h.level === lf.level && d <= lf.maxd && !L.segBlocked(lf.x, lf.z, h.x, h.z, 0.3, -1, lf.level)) cand.push({ h: h, d: d });
      });
      cand.sort(function (p, q) { return p.d - q.d; });
      cand.slice(0, lf.k || 2).forEach(function (c) { link(lf, c.h, c.d); });
    });
    // direct links between the slide's foot and its exit (leaves are never stepping stones, but a route may start or end on one)
    (function () { var a = nav.act.slideFoot, b = nav.act.slideOut; var d = Math.hypot(a.x - b.x, a.z - b.z); a.adj.push({ j: b.i, d: d }); b.adj.push({ j: a.i, d: d }); })();
    [byName.stWg, byName.stWu, byName.stEg, byName.stEu].forEach(function (h) { if (h) h.lane = true; });      // walkers use two lanes on the flights
    nav.built = true;
  }

  // ------------------------------------------------------------ A* routing
  // Routing.  A* runs between hubs only (typed arrays + a visit stamp, nothing allocated per node); a route between two spots is
  // assembled from the best of the (at most 2 x 2) hub routes at their ends, so that the hub-to-hub results are shared by everybody
  // walking the same corridors.  Spots linked straight to other spots (slide foot / exit) fall back to a plain A*.
  var cache = {}, hubCache = {}, AN = 0, gS = null, cameS = null, seenS = null, closedS = null, stampS = 0, lastCost = 0;
  function astar(a, b) {
    var N = nodes, n = N.length, heap = [], tx = N[b].x, tz = N[b].z;
    if (AN !== n) { AN = n; gS = new Float64Array(n); cameS = new Int32Array(n); seenS = new Int32Array(n); closedS = new Int32Array(n); stampS = 0; }
    stampS++;
    function push(i, f) { heap.push([f, i]); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } } return top; }
    gS[a] = 0; seenS[a] = stampS; push(a, 0);
    while (heap.length) {
      var cur = pop()[1];
      if (cur === b) { var path = [b]; while (path[0] !== a) path.unshift(cameS[path[0]]); lastCost = gS[b]; return path; }
      if (closedS[cur] === stampS) continue; closedS[cur] = stampS;
      if (N[cur].leaf && cur !== a) continue;       // leaves are never stepping stones
      var adj = N[cur].adj;
      for (var q = 0; q < adj.length; q++) {
        var e = adj[q];
        if (N[e.j].leaf && e.j !== b) continue;                          // (a leaf is only ever the end of a route)
        var ng = gS[cur] + e.d;
        if (seenS[e.j] !== stampS || ng < gS[e.j]) {
          gS[e.j] = ng; cameS[e.j] = cur; seenS[e.j] = stampS;
          push(e.j, ng + Math.hypot(N[e.j].x - tx, N[e.j].z - tz));
        }
      }
    }
    return null;
  }
  function hubRoute(a, b) {
    var key = a * 4096 + b, r = hubCache[key];
    if (r === undefined) { var p = astar(a, b); r = hubCache[key] = p ? { path: p, cost: lastCost } : null; }
    return r;
  }
  nav.route = function (a, b) {
    if (a === b) return [a];
    var key = a * 4096 + b, c = cache[key]; if (c) return c.slice();
    var A = nodes[a], Bn = nodes[b], so = A.leaf ? A.adj : null, eo = Bn.leaf ? Bn.adj : null, i, j, direct = false;
    if (so) for (i = 0; i < so.length; i++) if (nodes[so[i].j].leaf) direct = true;
    if (eo) for (i = 0; i < eo.length; i++) if (nodes[eo[i].j].leaf) direct = true;
    var path;
    if (direct) path = astar(a, b);
    else {
      var sl = so ? so.length : 1, el = eo ? eo.length : 1, best = null, bestCost = 1e18, combos = [];
      for (i = 0; i < sl; i++) for (j = 0; j < el; j++) {
        var ha0 = so ? so[i].j : a, hb0 = eo ? eo[j].j : b, d0 = (so ? so[i].d : 0) + (eo ? eo[j].d : 0);
        combos.push([d0 + Math.hypot(nodes[ha0].x - nodes[hb0].x, nodes[ha0].z - nodes[hb0].z), ha0, hb0, d0]);
      }
      combos.sort(function (p, q) { return p[0] - q[0]; });
      for (i = 0; i < combos.length; i++) {              // cheapest lower bound first; stop when no combination can win any more
        var cb = combos[i]; if (cb[0] >= bestCost) break;
        var cost, hp;
        if (cb[1] === cb[2]) { cost = cb[3]; hp = [cb[1]]; }
        else { var hr = hubRoute(cb[1], cb[2]); if (!hr) continue; cost = cb[3] + hr.cost; hp = hr.path; }
        if (cost < bestCost) { bestCost = cost; best = hp; }
      }
      if (!best) return null;
      path = best.slice(); if (so) path.unshift(a); if (eo) path.push(b);
    }
    if (path) cache[key] = path;
    return path ? path.slice() : null;
  };

  // nearest hub reachable (used when something must start from an arbitrary point)
  nav.nearestHub = function (x, z, level) {
    var best = null, bd = 1e9; level = level || 0;
    nodes.forEach(function (h) { if (h.leaf || h.level !== level) return; var d = Math.hypot(h.x - x, h.z - z); if (d < bd && !L.segBlocked(x, z, h.x, h.z, 0.3, -1, level)) { bd = d; best = h; } });
    return best;
  };
  // connectivity sanity check: every spot must be reachable from the lobby door
  nav.check = function () {
    var from = byName.lobIn.i, bad = [];
    nodes.forEach(function (n) { if (n.leaf && !nav.route(from, n.i)) bad.push(n); });   // unreachable hubs in unused corners are harmless
    return bad;
  };
  nav.build = build;
})();
