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
    L.bandRooms.forEach(function (r) {
      var c = r.cl, id = r.id; LV = r.level;
      hub(id + ':door', c.door.x, c.door.z);
      var depths = [c.chairD[0], c.chairD[1], 7.5];
      depths.forEach(function (d, di) {
        c.aisleO.forEach(function (o, oi) { var p = c.W(d, o); hub(id + ':a' + di + '_' + oi, p.x, p.z); });
      });
      if (r.desks) {
        // student chairs
        c.desks.forEach(function (d, di) {
          var oi = d.ci, nb = oi === 0 ? [0] : oi === 1 ? [0, 1] : oi === 2 ? [1, 2] : [2];
          spot('seat:' + id, d.cx, d.cz, { h: c.heading, sit: true, k: 2,
            hubs: nb.map(function (q) { return id + ':a' + d.ri + '_' + q; }) });
        });
        // standing spots for specials (aisle positions)
        [0, 1, 2].forEach(function (di) { [0, 1, 2].forEach(function (oi) {
          var p = c.W(depths[di] + 0.0, c.aisleO[oi] + (oi === 0 ? -0.0 : 0));
          spot('floor:' + id, p.x, p.z, { h: c.heading, hubs: [id + ':a' + di + '_' + oi] });
        }); });
      }
      // teacher / staff strolling spots
      var ts = [c.W(8.5, -2.4), c.W(8.5, 1.4), c.W(7.2, 3.2), c.W(4.1, -0.0)];
      if (!r.desks) ts = [c.W(5.5, -1.5), c.W(7.5, 1.8), c.W(3.5, 2)];
      if (id === 'lounge') ts = [];
      ts.forEach(function (p, q) {
        spot('stroll:' + id, p.x, p.z, { h: q === 0 ? c.heading : null, maxd: 7,
          hubs: r.desks ? [[id + ':a2_0', id + ':a2_1'], [id + ':a2_1', id + ':a2_2'], [id + ':a2_2'], [id + ':a1_1']][q] : null });
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
    var cx = [-10.5, -6, -1.5], zk = [], kk;
    for (kk = 0; kk < 6; kk++) zk.push(13.9 + 4.2 * kk);
    zk.forEach(function (z, ki) {
      cx.forEach(function (x, xi) { if (!(ki === 0 && xi === 1)) hub('cf' + ki + '_' + xi, x, z); });
      hub('cfe' + ki, 2.4, z);
    });
    byName['cf0_1'] = byName['cafeIn'];
    L.F.cafeTables.forEach(function (t, ti) {
      var row = Math.round((t.z - 16) / 4.2), xi = t.x < -6 ? 0 : 2;
      [-1, 1].forEach(function (side) {
        for (var s = -2; s <= 2; s++) {
          var kz = side < 0 ? row : row + 1, hubs = [xi, xi === 0 ? 1 : 1].map(function (q, qi) { return 'cf' + kz + '_' + (qi === 0 ? xi : 1); });
          spot('lunch', t.x + s * 1.3, t.z + side * 1.0, { sit: true, h: side < 0 ? 0 : Math.PI, hubs: hubs, k: 2 });
        }
      });
    });
    [17.5, 21.5, 25].forEach(function (z) { spot('stroll:counter', 2.3, z, { h: Math.PI / 2, hubs: ['cfe' + (z < 19 ? 1 : z < 23 ? 2 : 3)] }); });
    spot('stroll:cafe', -6, 21, {}); spot('stroll:cafe', -6, 30, {});

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
    // supervisor posts
    spot('post:playground', -10, -42, { maxd: 22 }); spot('post:field', -62, -30, { maxd: 30 }); spot('post:court', 34, -44, { maxd: 14 });
    spot('post:front', 4, 54, { maxd: 14 }); spot('post:front', 14, 54, { maxd: 14 }); spot('post:front', 3, 43, { maxd: 14 });

    // -------------------------------------------------------------- edges
    var hubs = nodes.filter(function (q) { return !q.leaf; });
    function link(a, b, d) { a.adj.push({ j: b.i, d: d }); b.adj.push({ j: a.i, d: d }); }
    for (i = 0; i < hubs.length; i++) for (j = i + 1; j < hubs.length; j++) {
      var a = hubs[i], b = hubs[j], d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 62 || a.level !== b.level) continue;
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
    nav.built = true;
  }

  // ------------------------------------------------------------ A* routing
  var cache = {};
  nav.route = function (a, b) {
    if (a === b) return [a];
    var key = a + '>' + b; if (cache[key]) return cache[key].slice();
    var N = nodes, g = {}, came = {}, closed = {}, heap = [], tx = N[b].x, tz = N[b].z;
    function push(i, f) { heap.push([f, i]); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } } return top; }
    g[a] = 0; push(a, 0);
    while (heap.length) {
      var cur = pop()[1];
      if (cur === b) { var path = [b]; while (path[0] !== a) path.unshift(came[path[0]]); cache[key] = path; return path.slice(); }
      if (closed[cur]) continue; closed[cur] = true;
      if (N[cur].leaf && cur !== a) continue;       // leaves are never stepping stones
      var adj = N[cur].adj;
      for (var q = 0; q < adj.length; q++) {
        var e = adj[q], ng = g[cur] + e.d;
        if (g[e.j] === undefined || ng < g[e.j]) {
          g[e.j] = ng; came[e.j] = cur;
          push(e.j, ng + Math.hypot(N[e.j].x - tx, N[e.j].z - tz));
        }
      }
    }
    return null;
  };

  // nearest hub reachable (used when something must start from an arbitrary point)
  nav.nearestHub = function (x, z) {
    var best = null, bd = 1e9;
    nodes.forEach(function (h) { if (h.leaf || h.level) return; var d = Math.hypot(h.x - x, h.z - z); if (d < bd && !L.segBlocked(x, z, h.x, h.z, 0.3, -1)) { bd = d; best = h; } });
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
