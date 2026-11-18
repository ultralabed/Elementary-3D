/*
 * interior.js - the school building shell (walls, doorways, windows, roof) and
 * everything inside on both floors: floors, slab, stairs, wall stripes, door signs,
 * classroom furniture, gym / cafeteria / library / music / lobby / office / nurse props.
 *
 * Second-floor content is built with U.setFloor(1): the same code, lifted by one storey
 * and written to the upper layer set so it can be hidden as a whole.
 *
 * Desks and chairs are InstancedMesh (one draw call each for the whole school).
 * Other props are baked into the shared chunked layers from world.js.
 */
(function () {
  'use strict';
  if (!window.THREE) return;     // engine failed to load: main.js shows a message
  var S = window.CAMPUS, L = S.layout, THREE = window.THREE;
  var I = S.interior = {};
  var U = S.world.util, C = U.C, box = U.box, boxR = U.boxR, cyl = U.cyl, sph = U.sph, prim = U.prim, flat = U.flat,
    disk = U.disk, ring = U.ring, outline = U.outline, yaw = U.yaw, torus = U.torus;
  var CREAM = '#F7EDD9', RED = L.schoolColor;

  // ------------------------------------------------- instanced desks / chairs
  var desks = [[], [], []], chairs = [[], [], []];      // per layer set (ground, upper, under the slab)
  function addDesk(x, z, ry, color, sx, sz) { desks[U.setIdx].push({ y: U.yOff, x: x, z: z, ry: ry || 0, color: color, sx: sx || 1, sz: sz || 1 }); }
  function addChair(x, z, heading, color) { chairs[U.setIdx].push({ y: U.yOff, x: x, z: z, ry: heading || 0, color: color }); }

  function makeInstanced(list, geo, material) {
    var mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    list.forEach(function (d, i) {
      e.set(0, d.ry, 0); q.setFromEuler(e); p.set(d.x, d.y || 0, d.z); s.set(d.sx || 1, 1, d.sz || 1);
      m.compose(p, q, s); mesh.setMatrixAt(i, m); mesh.setColorAt(i, C(d.color));
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    return mesh;
  }
  function geoFrom(fn) {
    var ly = new U.Layer(1e6); fn(ly);
    return ly.build(S.world.matInstanced, false, false, null)[0].geometry;
  }

  // ------------------------------------------------------------------ helpers
  function sofa(ly, x, z, ry, col) {
    var P = yaw(x, z, ry), old = U.force; U.force = 'solid';       // multi-part pieces are cut (or kept) as a whole
    box(ly, 0, 0.3, 0, 2.0, 0.5, 0.9, col, 0, P); box(ly, 0, 0.7, -0.38, 2.0, 0.6, 0.2, col, 0, P);
    box(ly, -0.95, 0.5, 0, 0.2, 0.5, 0.9, col, 0, P); box(ly, 0.95, 0.5, 0, 0.2, 0.5, 0.9, col, 0, P);
    box(ly, 0, 0.58, 0.05, 1.7, 0.12, 0.7, '#FFFFFF', 0, P);
    U.force = old;
  }
  function plant(ly, x, z, s) {
    var old = U.force; U.force = 'solid';
    cyl(ly, x, 0.25 * s, z, 0.25 * s, 0.2 * s, 0.5 * s, '#C9744A', 8); sph(ly, x, 0.8 * s, z, 0.35 * s, 0.4 * s, 0.35 * s, '#4CAE44', null, 6);
    sph(ly, x + 0.1 * s, 1.0 * s, z, 0.22 * s, 0.25 * s, 0.22 * s, '#66C554', null, 6);
    U.force = old;
  }
  function shelfUnit(ly, x0, z0, x1, z1, rng, h, faceX) { // bookshelf box with colourful book strips on the open side
    var old = U.force; U.force = 'solid';
    boxR(ly, x0, z0, x1, z1, 0, h, '#B98A55');
    var cols = ['#E03030', '#3E8EDE', '#FFD23F', '#4CB86B', '#9A6CEA', '#FF8A33', '#FF9FD2', '#35B8C8'], rows = Math.max(2, Math.floor(h / 0.55));
    var len = faceX ? (x1 - x0) : (z1 - z0);
    for (var r = 0; r < rows; r++) {
      var y = 0.35 + r * 0.5;
      for (var t = 0; t < len; t += 0.3) {
        var c = cols[Math.floor(rng() * cols.length)], bh = 0.28 + rng() * 0.12;
        if (faceX) { box(ly, x0 + t + 0.15, y + bh / 2, z1 + 0.03, 0.24, bh, 0.06, c); box(ly, x0 + t + 0.15, y + bh / 2, z0 - 0.03, 0.24, bh, 0.06, c); }
        else { box(ly, x1 + 0.03, y + bh / 2, z0 + t + 0.15, 0.06, bh, 0.24, c); box(ly, x0 - 0.03, y + bh / 2, z0 + t + 0.15, 0.06, bh, 0.24, c); }
      }
    }
    U.force = old;
  }

  // ---------------------------------------------------------------- the build
  I.build = function (ctx) {
    var rng = L.rng(31);
    U.setFloor(0);
    floors(ctx);
    shell(ctx);
    stripes(ctx);
    windows(ctx);
    signs(ctx);
    hallways(ctx, rng);
    stairs(ctx);
    U.lowSplit = true;      // furniture pieces whose top is below 0.95 m are never cut away by the camera cutaway
    classrooms(ctx, rng);
    U.setFloor(0);
    U.piece('solid', function () { gym(ctx); });
    cafeteria(ctx); library(ctx, rng); music(ctx); lounge(ctx); lobby(ctx); office(ctx); nurse(ctx);
    U.lowSplit = false; U.force = null;
    roofs(ctx);

    // instanced furniture, one pair of meshes per floor
    var deskGeo = geoFrom(function (l) {
      box(l, 0, 0.64, 0, 0.7, 0.05, 0.9, '#FFFFFF'); box(l, 0, 0.46, 0, 0.58, 0.04, 0.78, '#E6E0D0');
      [[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.4], [0.3, 0.4]].forEach(function (c) { box(l, c[0], 0.32, c[1], 0.04, 0.62, 0.04, '#7A808C'); });
    });
    var chairGeo = geoFrom(function (l) {
      box(l, 0, 0.42, 0, 0.4, 0.05, 0.4, '#FFFFFF'); box(l, 0, 0.7, -0.18, 0.4, 0.42, 0.05, '#F0F0F0');
      [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(function (c) { box(l, c[0], 0.2, c[1], 0.035, 0.4, 0.035, '#7A808C'); });
    });
    [ctx.extra, ctx.extraUp, ctx.extraUnder].forEach(function (list, lv) {
      list.push(makeInstanced(desks[lv], deskGeo, S.world.matInstanced)); list.push(makeInstanced(chairs[lv], chairGeo, S.world.matInstanced));
    });
    I.counts = { desks: desks[0].length + desks[1].length + desks[2].length, chairs: chairs[0].length + chairs[1].length + chairs[2].length };
  };

  // ------------------------------------------------------------------ floors
  function floors(ctx) {
    L.rooms.forEach(function (r) { U.setFloor(r.level === 1 ? 1 : 0); flat(ctx.ground, r.x0, r.z0, r.x1, r.z1, 0.06, r.floor); });
    // accent runners down the halls
    U.setFloor(0); flat(ctx.ground, -51.8, 9.55, 55.8, 10.45, 0.075, '#F2B8BD'); flat(ctx.ground, 41.1, 12, 41.9, 40, 0.075, '#F2B8BD');
    U.setFloor(1); flat(ctx.ground, -41.8, 9.55, 9.8, 10.45, 0.075, '#F2B8BD');
    L.wings.forEach(function (w) { U.setFloor(w.level); flat(ctx.ground, w.cx - 0.5, -28, w.cx + 0.5, 8, 0.075, w.runner); });
    // the floor slab of the second floor (its top is covered by the upper floors, which are never cut)
    U.setFloor(1);
    boxR(ctx.solid, -39.9, -27.9, 7.9, 8, -0.4, -0.02, CREAM); boxR(ctx.solid, -41.9, 8, 9.9, 11.9, -0.4, -0.02, CREAM);
    U.setFloor(0);
    var g = ctx.ground;
    // cafeteria stripes, lobby rug, library rug
    for (var x = -16; x < 4; x += 4) flat(g, x, 12, x + 2, 40, 0.07, '#E4EEF7');
    flat(g, 4.8, 16, 11.2, 36, 0.07, RED); flat(g, 5.4, 16.6, 10.6, 35.4, 0.075, '#F7EDD9'); disk(g, 8, 26, 2.2, 0.08, RED, 24);
    var rg = L.F.libRug; disk(g, rg.x, rg.z, rg.r, 0.07, '#8E6BD1', 28); disk(g, rg.x, rg.z, rg.r - 0.5, 0.075, '#B59BEB', 28); disk(g, rg.x, rg.z, rg.r - 1.2, 0.08, '#8E6BD1', 24);
    // gym court lines
    var c = L.F.court, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    for (var z = 12.2; z < 40; z += 1.2) flat(g, -39.85, z, -16.15, z + 0.04, 0.065, '#C8985A');
    flat(g, c.x0 - 0.4, c.z0 - 0.4, c.x1 + 0.4, c.z1 + 0.4, 0.068, '#D8A867');
    outline(g, c.x0, c.z0, c.x1, c.z1, 0.09, 0.12, '#FFFFFF'); flat(g, c.x0, cz - 0.06, c.x1, cz + 0.06, 0.09, '#FFFFFF'); ring(g, cx, cz, 1.7, 1.82, 0.095, '#FFFFFF', 24);
    [c.z0, c.z1].forEach(function (zz, i) {
      var d = i ? -1 : 1, zk = zz + d * 5.5;
      flat(g, cx - 2.4, Math.min(zz, zk), cx + 2.4, Math.max(zz, zk), 0.07, '#E2704F');
      outline(g, cx - 2.4, Math.min(zz, zk), cx + 2.4, Math.max(zz, zk), 0.1, 0.1, '#FFFFFF');
      ring(g, cx, zk, 1.7, 1.8, 0.1, '#FFFFFF', 20);
    });
  }

  // -------------------------------------------------------- walls & doorways
  function shell(ctx) {
    L.walls.forEach(function (w) {
      U.setFloor(w.lv);
      boxR(ctx.solid, w.x0, w.z0, w.x1, w.z1, 0, w.h, CREAM);
      if (w.ext && !w.lv) {                                    // low plinth on outside walls
        if ((w.x1 - w.x0) < 0.5) boxR(ctx.solid, w.x0 - 0.05, w.z0, w.x1 + 0.05, w.z1, 0, 0.55, '#C9B896');
        else boxR(ctx.solid, w.x0, w.z0 - 0.05, w.x1, w.z1 + 0.05, 0, 0.55, '#C9B896');
      }
    });
    L.lintels.forEach(function (l) {
      U.setFloor(l.lv);
      var r = l.room && L.roomById[l.room];
      boxR(ctx.solid, l.x0, l.z0, l.x1, l.z1, l.y0, l.y1, l.ext ? RED : (r && r.type !== 'hall' && r.type !== 'stair' ? r.wall : CREAM));
    });
    // door jambs (red outside, grade colour for classrooms)
    L.doors.forEach(function (d) {
      if (d.kind !== 'door') return;
      U.setFloor(d.lv);
      var ly = ctx.solid, r = d.room && L.roomById[d.room];
      var col = d.ext ? RED : (r && r.type !== 'hall' && r.type !== 'stair' ? r.wall : '#E8DCC0');
      var t = L.T + 0.12, jw = 0.12;
      if (d.axis === 'x') { boxR(ly, d.g0 - 0.02, d.c - t / 2, d.g0 + jw, d.c + t / 2, 0, L.DOOR_H, col); boxR(ly, d.g1 - jw, d.c - t / 2, d.g1 + 0.02, d.c + t / 2, 0, L.DOOR_H, col); }
      else { boxR(ly, d.c - t / 2, d.g0 - 0.02, d.c + t / 2, d.g0 + jw, 0, L.DOOR_H, col); boxR(ly, d.c - t / 2, d.g1 - jw, d.c + t / 2, d.g1 + 0.02, 0, L.DOOR_H, col); }
    });
    U.setFloor(0);
    // entrance canopy with two posts
    var ly0 = ctx.solid;
    box(ly0, 8, 3.5, 42.4, 10.4, 0.28, 4.6, RED); box(ly0, 8, 3.72, 42.4, 10.0, 0.1, 4.2, '#FFFFFF');
    cyl(ly0, 3.5, 1.7, 44.2, 0.14, 0.14, 3.4, '#FFFFFF', 8); cyl(ly0, 12.5, 1.7, 44.2, 0.14, 0.14, 3.4, '#FFFFFF', 8);
    L.addCircle(3.5, 44.2, 0.2, true); L.addCircle(12.5, 44.2, 0.2, true);
  }

  // coloured wainscot stripe on the inside of every room and hall
  function stripes(ctx) {
    var y0 = 0.9, y1 = 1.25, off = 0.17, tk = 0.04;
    function side(axis, c, dir, a0, a1, col, lv) {
      var gaps = L.doors.filter(function (d) { return d.lv === lv && d.axis === axis && Math.abs(d.c - c) < 0.01 && d.g1 > a0 && d.g0 < a1; })
        .map(function (d) { return [Math.max(a0, d.g0), Math.min(a1, d.g1)]; }).sort(function (p, q) { return p[0] - q[0]; }), cur = a0;
      function seg(s, e) {
        if (e - s < 0.05) return;
        if (axis === 'x') boxR(ctx.solid, s, c + dir * off - tk / 2, e, c + dir * off + tk / 2, y0, y1, col);
        else boxR(ctx.solid, c + dir * off - tk / 2, s, c + dir * off + tk / 2, e, y0, y1, col);
      }
      gaps.forEach(function (g) { seg(cur, g[0]); cur = g[1]; }); seg(cur, a1);
    }
    L.rooms.forEach(function (r) {
      if (r.type === 'hall' || r.type === 'stair') return;
      U.setFloor(r.level);
      side('x', r.z0, +1, r.x0 + 0.15, r.x1 - 0.15, r.wall, r.level); side('x', r.z1, -1, r.x0 + 0.15, r.x1 - 0.15, r.wall, r.level);
      side('z', r.x0, +1, r.z0 + 0.15, r.z1 - 0.15, r.wall, r.level); side('z', r.x1, -1, r.z0 + 0.15, r.z1 - 0.15, r.wall, r.level);
    });
    L.wings.forEach(function (w) {
      U.setFloor(w.level);
      side('z', w.hx0, +1, -27.85, 7.85, w.accent, w.level); side('z', w.hx1, -1, -27.85, 7.85, w.accent, w.level);
    });
    U.setFloor(0);
    // main hallway (the wing hall openings and the lobby opening are skipped by hand)
    [[-49.9, -30.2], [-25.8, -6.2], [-1.8, 17.9], [20.1, 36.4], [39.6, 55.85]].forEach(function (q) { side('x', 8, +1, q[0], q[1], '#E8777F', 0); });
    [[-51.85, 3.9], [12.1, 39.9], [43.1, 55.85]].forEach(function (q) { side('x', 12, -1, q[0], q[1], '#E8777F', 0); });
    U.setFloor(1);
    [[-39.9, -30.2], [-25.8, -6.2], [-1.8, 7.9]].forEach(function (q) { side('x', 8, +1, q[0], q[1], '#E8777F', 1); });
    side('x', 12, -1, -41.85, 9.85, '#E8777F', 1);
    U.setFloor(0);
  }

  // ------------------------------------------------------------------ windows
  function windows(ctx) {
    var tk = L.T + 0.04;
    L.windows.forEach(function (w) {
      U.setFloor(w.lv);
      var ly = ctx.solid, gl = ctx.glass, h = w.y1 - w.y0, yc = (w.y0 + w.y1) / 2;
      if (w.axis === 'x') {
        box(ly, w.at, yc, w.c, w.w + 0.2, h + 0.2, tk, '#FFFFFF');
        box(gl, w.at, yc, w.c, w.w, h, tk + 0.04, '#BFE6FF');
        box(ly, w.at, yc, w.c, 0.06, h, tk + 0.06, '#FFFFFF'); box(ly, w.at, yc, w.c, w.w, 0.06, tk + 0.06, '#FFFFFF');
      } else {
        box(ly, w.c, yc, w.at, tk, h + 0.2, w.w + 0.2, '#FFFFFF');
        box(gl, w.c, yc, w.at, tk + 0.04, h, w.w, '#BFE6FF');
        box(ly, w.c, yc, w.at, tk + 0.06, h, 0.06, '#FFFFFF'); box(ly, w.c, yc, w.at, tk + 0.06, 0.06, w.w, '#FFFFFF');
      }
    });
    U.setFloor(0);
  }

  // ---------------------------------------------------------- door name signs
  // One canvas atlas holds every room name; each sign is a quad with its own UVs,
  // so the signs are one draw call per floor.
  function signs(ctx) {
    var items = [], names = {};
    L.doors.forEach(function (d) {
      if (d.kind !== 'door' || !d.room) return;
      var r = L.roomById[d.room]; if (!r) return;
      var n = d.axis === 'z' ? [r.cx < d.c ? 1 : -1, 0] : [0, r.cz < d.c ? 1 : -1];
      var name = r.type === 'stair' ? (d.lv ? 'Stairs Down' : 'Stairs Up') : r.name;
      items.push({ name: name, col: r.type === 'stair' ? '#6B7385' : r.wall, x: d.x + n[0] * 0.17, z: d.z + n[1] * 0.17, y: 3.3, w: 1.7, h: 0.5, n: n, lv: d.lv });
    });
    L.wings.forEach(function (w) {
      items.push({ name: w.name, col: w.accent, x: w.cx, z: 7.7, y: 3.3, w: 3.4, h: 0.85, n: [0, 1], lv: w.level });
      items.push({ name: w.name, col: w.accent, x: w.cx, z: 7.62, y: 3.3, w: 3.4, h: 0.85, n: [0, -1], lv: w.level });
    });
    var list = [];
    items.forEach(function (it) { if (names[it.name + it.col] === undefined) { names[it.name + it.col] = list.length; list.push(it); } });
    var cw = 256, chh = 64, cols = 4, rows = Math.ceil(list.length / cols), AH = Math.max(256, Math.pow(2, Math.ceil(Math.log2(rows * chh))));
    var tex = U.canvasTex(cols * cw, AH, function (c) {
      list.forEach(function (it, i) {
        var x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
        c.fillStyle = it.col; c.fillRect(x, y, cw, chh); c.fillStyle = 'rgba(0,0,0,.12)'; U.roundRect(c, x + 2, y + 2, cw - 4, chh - 4, 14); c.fill(); c.fillStyle = it.col; U.roundRect(c, x + 3, y + 3, cw - 6, chh - 6, 14); c.fill();
        c.lineWidth = 4; c.strokeStyle = '#fff'; U.roundRect(c, x + 6, y + 6, cw - 12, chh - 12, 11); c.stroke();
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        U.fitText(c, it.name, cw - 36, 34); c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 3;
        c.fillText(it.name, x + cw / 2, y + chh / 2 + 2); c.shadowBlur = 0;
      });
    });
    var mat = U.cutPatch(new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    [0, 1].forEach(function (lv) {
      var pos = [], uv = [], idx = [];
      items.forEach(function (it) {
        if (it.lv !== lv) return;
        var ci = names[it.name + it.col], u0 = (ci % cols) * cw / (cols * cw), u1 = u0 + cw / (cols * cw);
        var v1 = 1 - Math.floor(ci / cols) * chh / AH, v0 = v1 - chh / AH;
        var rx = it.n[1], rz = -it.n[0], hw = it.w / 2, hh = it.h / 2, base = pos.length / 3, y = it.y + lv * L.FLOOR_H;   // right = up x n
        [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].forEach(function (q) {
          pos.push(it.x + rx * hw * q[0], y + hh * q[1], it.z + rz * hw * q[0]); uv.push(q[2], q[3]);
        });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      var m = new THREE.Mesh(g, mat); m.frustumCulled = false; (lv ? ctx.extraUp : ctx.extra).push(m);
    });
  }

  // ------------------------------------------------- hallways: lockers, boards
  function hallways(ctx, rng) {
    var lc = ['#3E8EDE', '#E03030', '#F2C230', '#4CB86B'], n = 0;
    L.walls.forEach(function (w) {
      var horiz = (w.x1 - w.x0) > 0.5, vert = (w.z1 - w.z0) > 0.5;
      U.setFloor(w.lv);
      var ly = ctx.solid;
      if (horiz && Math.abs((w.z0 + w.z1) / 2 - 8) < 0.01) {                    // hallway north walls: lockers
        var lim = w.lv ? [-41.5, 9.5] : [-49.7, 19.9];
        var s = Math.max(w.x0 + 0.3, lim[0]), e = Math.min(w.x1 - 0.3, lim[1]);
        if (e - s < 1.5) return;
        var col = lc[n++ % 4];
        boxR(ly, s, w.z1, e, w.z1 + 0.5, 0, 2.2, col);
        for (var x = s; x <= e + 0.01; x += 0.9) box(ly, x, 1.1, w.z1 + 0.51, 0.03, 2.1, 0.02, '#1F2530');
        for (x = s + 0.45; x < e; x += 0.9) box(ly, x, 1.5, w.z1 + 0.52, 0.12, 0.05, 0.03, '#E8E8E8');
        L.addBox(s, w.z1, e, w.z1 + 0.5, false);
      } else if (!w.lv && horiz && Math.abs((w.z0 + w.z1) / 2 - 12) < 0.01 && w.h < 5) {   // main hall south wall: bulletin boards
        var s2 = Math.max(w.x0 + 0.8, -51), e2 = Math.min(w.x1 - 0.8, 54);
        if (e2 - s2 < 2) return;
        boardRow(ctx, rng, s2, e2, w.z0 - 0.03, -1, 'x');
      } else if (vert && w.z1 - w.z0 > 3 && w.h < 5) {
        // wing hall walls: boards between doorways
        L.wings.forEach(function (wg) {
          if (wg.level !== w.lv) return;
          var c = (w.x0 + w.x1) / 2;
          if (Math.abs(c - wg.hx0) < 0.01) boardRow(ctx, rng, w.z0 + 0.5, w.z1 - 0.5, w.x1 + 0.03, +1, 'z');
          else if (Math.abs(c - wg.hx1) < 0.01) boardRow(ctx, rng, w.z0 + 0.5, w.z1 - 0.5, w.x0 - 0.03, -1, 'z');
        });
      }
    });
    U.setFloor(0);
    // exterior door mats
    [[-50.6, 10], [54.6, 10]].forEach(function (p) { flat(ctx.ground, p[0] - 0.8, p[1] - 1.2, p[0] + 0.8, p[1] + 1.2, 0.09, '#8C3A3A'); });
    L.wings.forEach(function (wg) { if (!wg.level) flat(ctx.ground, wg.cx - 1, -27.4, wg.cx + 1, -25.4, 0.09, '#8C3A3A'); });
    flat(ctx.ground, 37, 8.4, 39, 9.4, 0.09, '#8C3A3A');
  }
  function boardRow(ctx, rng, s, e, c, dir, axis) { // cork bulletin board with pinned papers
    var ly = ctx.solid, papers = ['#FFD23F', '#FF6B6B', '#4FB0F0', '#7BD88F', '#FFFFFF', '#FF9FD2'];
    if (axis === 'x') {
      boxR(ly, s, c - 0.02, e, c + 0.02, 1.0, 2.5, '#C9985A'); boxR(ly, s - 0.06, c - 0.015, e + 0.06, c + 0.015, 0.94, 2.56, '#8A5A2E');
      for (var x = s + 0.3; x < e - 0.3; x += 0.55 + rng() * 0.3) box(ly, x, 1.2 + rng() * 1.0, c + dir * 0.04, 0.4, 0.3, 0.02, papers[Math.floor(rng() * papers.length)]);
    } else {
      boxR(ly, c - 0.02, s, c + 0.02, e, 1.0, 2.5, '#C9985A'); boxR(ly, c - 0.015, s - 0.06, c + 0.015, e + 0.06, 0.94, 2.56, '#8A5A2E');
      for (var z = s + 0.3; z < e - 0.3; z += 0.55 + rng() * 0.3) box(ly, c + dir * 0.03, 1.2 + rng() * 1.0, z, 0.02, 0.3, 0.4, papers[Math.floor(rng() * papers.length)]);
    }
  }


  // ------------------------------------------------------------------ stairs
  // One straight flight per tower: chunky steps (never cut while the player is on them),
  // the upper landing, and a handrail along each side wall.
  function stairs(ctx) {
    U.setFloor(0);
    var ly = ctx.solid, FH = L.FLOOR_H;
    L.stairs.forEach(function (s) {
      var dir = s.xTop > s.xBot ? 1 : -1, n = 16, run = Math.abs(s.xTop - s.xBot) / n, rise = FH / n, z0 = s.z0 + 0.15, z1 = s.z1 - 0.15, i;
      var sl = ctx.stair;                                      // own layer: see W.updateCutMaterials
      for (i = 0; i < n; i++) {
        var xa = s.xBot + dir * i * run, xb = xa + dir * run;
        boxR(sl, Math.min(xa, xb), z0, Math.max(xa, xb), z1, 0, (i + 1) * rise, i % 2 ? '#D9D2C2' : '#CBC2AE');
        boxR(sl, Math.min(xa, xa + dir * 0.08), z0, Math.max(xa, xa + dir * 0.08), z1, (i + 1) * rise, (i + 1) * rise + 0.012, RED);   // nosing
      }
      boxR(sl, dir > 0 ? s.xTop : s.x0 + 0.15, z0, dir > 0 ? s.x1 - 0.15 : s.xTop, z1, FH - 0.4, FH, '#D9D2C2');           // upper landing
      var len = Math.hypot(s.xTop - s.xBot, FH), ang = dir * Math.atan2(FH, Math.abs(s.xTop - s.xBot)), mx = (s.xBot + s.xTop) / 2;
      U.piece('solid', function () {
        [z0 + 0.12, z1 - 0.12].forEach(function (z) {
          prim(ly, U.boxGeo(), mx, FH / 2 + 0.95, z, len, 0.09, 0.09, RED, null, 0, 0, ang);
          for (i = 0; i <= n; i += 4) { var x = s.xBot + dir * i * run; box(ly, x, i * rise + 0.5, z, 0.07, 1.0, 0.07, '#7A808C'); }
        });
      });
    });
  }

  // ----------------------------------------------------------- classroom-like
  function classrooms(ctx, rng) {
    L.bandRooms.forEach(function (r) {
      U.setFloor(r.level ? 1 : 2);             // ground wing rooms: the "under the slab" set
      var ly = ctx.solid, g = ctx.ground, c = r.cl, acc = r.wall;
      // whiteboard on the far wall + tray
      var bw = c.board;
      box(ly, bw.x, 1.75, bw.z, 0.06, 1.3, 5.0, '#FFFFFF'); box(ly, bw.x + c.sgn * 0.012, 1.75, bw.z, 0.05, 1.42, 5.14, '#9AA3B2');
      box(ly, bw.x - c.sgn * 0.1, 1.07, bw.z, 0.15, 0.05, 4.8, '#9AA3B2');
      if (r.desks) {
        // student desks + chairs
        c.desks.forEach(function (d) {
          addDesk(d.x, d.z, 0, acc); addChair(d.cx, d.cz, c.heading, acc);
          L.addBox(d.x - 0.4, d.z - 0.5, d.x + 0.4, d.z + 0.5, false, { navBlock: true });
        });
        // teacher desk + chair
        var td = c.teacherDesk, tc = c.W(9.35, 3.2);
        addDesk(td.x, td.z, 0, '#C9894F', 1.0, 1.8); addChair(tc.x, tc.z, c.heading + Math.PI, '#7A808C');
        L.addBox(td.x - 0.5, td.z - 0.95, td.x + 0.5, td.z + 0.95, false, { navBlock: true });
        if (r.id === 'computer') c.desks.forEach(function (d) { U.piece('solid', function () { box(ly, d.x - 0.1 * c.sgn, 0.9, d.z, 0.06, 0.3, 0.45, '#3A4150'); box(ly, d.x - 0.1 * c.sgn + c.sgn * 0.02, 0.9, d.z, 0.02, 0.24, 0.38, '#7FDBFF'); box(ly, d.x - 0.1 * c.sgn, 0.72, d.z, 0.1, 0.1, 0.2, '#3A4150'); }); });
        // rug
        var rg = c.rug; disk(g, rg.x, rg.z, 1.4, 0.075, acc, 22); disk(g, rg.x, rg.z, 0.9, 0.08, '#FFFFFF', 18); disk(g, rg.x, rg.z, 0.45, 0.085, acc, 14);
      }
      // shelf along one side wall + cubbies
      var a = c.W(4.5, -4.15), b = c.W(8.2, -4.15);
      shelfUnit(ly, Math.min(a.x, b.x), a.z - 0.2, Math.max(a.x, b.x), a.z + 0.2, rng, 1.2, true);
      L.addBox(Math.min(a.x, b.x), a.z - 0.2, Math.max(a.x, b.x), a.z + 0.2, false, { navBlock: true });
      var a2 = c.W(3.0, 4.15), b2 = c.W(5.4, 4.15);
      U.piece('solid', function () {
        boxR(ly, Math.min(a2.x, b2.x), a2.z - 0.2, Math.max(a2.x, b2.x), a2.z + 0.2, 0, 1.0, '#E8D9B8');
        for (var q = 0; q < 6; q++) { var pp = c.W(3.2 + q * 0.4, 4.15); box(ly, pp.x, 0.55, pp.z - 0.21, 0.3, 0.3, 0.03, ['#FF6B6B', '#4FB0F0', '#FFD23F'][q % 3]); }
      });
      L.addBox(Math.min(a2.x, b2.x), a2.z - 0.2, Math.max(a2.x, b2.x), a2.z + 0.2, false, { navBlock: true });
      plant(ly, c.W(9.2, -4.0).x, c.W(9.2, -4.0).z, 1);
      // specifics
      if (r.id === 'stem') {
        U.piece('solid', function () {
          var t = c.W(8.0, -3.2); box(ly, t.x, 0.45, t.z, 0.9, 0.9, 1.4, '#C9894F'); box(ly, t.x, 1.05, t.z, 0.5, 0.4, 0.5, '#3E8EDE');
          cyl(ly, t.x, 1.4, t.z, 0.08, 0.08, 0.3, '#444', 6);
          var rb = c.W(6.4, 3.8); cyl(ly, rb.x, 0.5, rb.z, 0.28, 0.28, 1.0, '#FFD23F', 10); sph(ly, rb.x, 1.2, rb.z, 0.3, 0.26, 0.3, '#E03030', null, 8);
          box(ly, rb.x, 0.75, rb.z + 0.38, 0.14, 0.14, 0.5, '#FFD23F'); box(ly, rb.x, 0.75, rb.z - 0.38, 0.14, 0.14, 0.5, '#FFD23F');
          L.addBox(t.x - 0.5, t.z - 0.7, t.x + 0.5, t.z + 0.7, false, { navBlock: true });
        });
      } else if (r.id === 'art') {
        var cols = ['#E03030', '#FFD23F', '#3E8EDE', '#4CB86B', '#9A6CEA', '#FF8A33'];
        U.piece('solid', function () {
          [-2.6, -1.0].forEach(function (o, i) {                       // two easels beside the whiteboard
            var e = c.W(8.9, o), P = yaw(e.x, e.z, c.sgn > 0 ? 0 : Math.PI);
            box(ly, 0, 1.0, 0, 0.05, 2.0, 0.05, '#C9894F', 0, P); box(ly, 0.3, 0.9, 0.3, 0.05, 1.8, 0.05, '#C9894F', 0, P); box(ly, 0.3, 0.9, -0.3, 0.05, 1.8, 0.05, '#C9894F', 0, P);
            box(ly, -0.05, 1.3, 0, 0.04, 0.8, 0.7, '#FFFFFF', 0, P);
            box(ly, -0.08, 1.4, -0.1, 0.02, 0.3, 0.3, cols[i], 0, P); box(ly, -0.08, 1.2, 0.15, 0.02, 0.25, 0.25, cols[i + 2], 0, P);
          });
        });
        c.desks.forEach(function (d, i) { cyl(ly, d.x, 0.74, d.z + 0.25, 0.07, 0.07, 0.14, cols[i % 6], 6); });   // paint pots
      } else if (r.id === 'counselor') {
        var s1 = c.W(8.2, 2.5); sofa(ly, s1.x, s1.z, c.sgn < 0 ? Math.PI / 2 : -Math.PI / 2, '#B88AE0');
        var tb = c.W(6.3, 2.5); cyl(ly, tb.x, 0.3, tb.z, 0.5, 0.5, 0.6, '#C9894F', 10);
        var dk = c.W(8.4, -2.5); box(ly, dk.x, 0.38, dk.z, 0.9, 0.76, 1.6, '#C9894F'); addChair(c.W(9.2, -2.5).x, c.W(9.2, -2.5).z, c.heading + Math.PI, '#B88AE0');
        L.addBox(s1.x - 0.5, s1.z - 1.0, s1.x + 0.5, s1.z + 1.0, false, { navBlock: true }); L.addBox(dk.x - 0.5, dk.z - 0.85, dk.x + 0.5, dk.z + 0.85, false, { navBlock: true });
      }
    });
    U.setFloor(0);
  }

  // ---------------------------------------------------------- teacher lounge
  function lounge(ctx) {
    var ly = ctx.solid, F = L.F;
    F.loungeSofas.forEach(function (q, i) { sofa(ly, q.x, q.z, q.ry, i ? '#5E7DB8' : '#E58C5F'); L.addBox(q.x - 0.5, q.z - 1.0, q.x + 0.5, q.z + 1.0, false, { navBlock: true }); });
    var t = F.loungeTable; cyl(ly, t.x, 0.4, t.z, t.r, t.r, 0.8, '#C9894F', 12);
    L.addBox(t.x - t.r, t.z - t.r, t.x + t.r, t.z + t.r, false, { navBlock: true });
    U.piece('solid', function () { box(ly, 55.3, 1.0, 27.2, 0.8, 2.0, 0.9, '#E03030'); box(ly, 54.88, 1.3, 27.2, 0.04, 1.0, 0.6, '#BFE6FF'); });   // vending machine
    L.addBox(54.9, 26.7, 55.8, 27.7, false);
    U.piece('solid', function () { boxR(ly, 44.2, 39.2, 49, 39.8, 0, 0.95, '#E8D2A8'); box(ly, 45, 1.15, 39.5, 0.4, 0.4, 0.3, '#7A808C'); }); // counter + coffee machine
    L.addBox(44.2, 39.2, 49, 39.8, false);
    plant(ly, 44, 27, 1.1);
  }

  // --------------------------------------------------------------------- gym
  function gym(ctx) {
    var ly = ctx.solid;
    L.F.hoops.forEach(function (h) {
      var d = h.dir, P = yaw(h.x, h.z, 0);
      box(ly, 0, 3.15, d * 0.04, 1.8, 1.05, 0.08, '#FFFFFF', 0, P); box(ly, 0, 2.9, d * 0.06, 0.6, 0.45, 0.04, '#E03030', 0, P);
      box(ly, 0, 3.05, d * 0.28, 0.06, 0.06, 0.45, '#FF6B6B', 0, P);
      torus(ly, 0, 3.05, d * 0.55, 0.23, 0.08, '#FF6B6B', P, Math.PI / 2, 0, 0);
      box(ly, 0, 2.7, d * 0.55, 0.3, 0.3, 0.3, '#FFFFFF', 0, P);
    });
    // bleachers on the west wall
    for (var i = 0; i < 3; i++) boxR(ly, -39.85, 19, -39.85 + 1.0 + i * 0.8, 31, 0, 0.45 * (3 - i), i % 2 ? '#C9894F' : '#B7793F');
    for (i = 0; i < 3; i++) boxR(ly, -39.85 + i * 0.8, 19, -39.85 + 0.8 + i * 0.8, 31, 0, 0.45 * (i + 1), i % 2 ? '#C9894F' : '#B7793F');
    L.addBox(-39.85, 19, -37.4, 31, false);
    // scoreboard + banners + padded wall strip
    box(ly, -28, 5.8, 39.7, 4, 1.2, 0.2, '#2B2F3A'); box(ly, -28, 5.8, 39.58, 3.6, 0.8, 0.03, '#FFD23F');
    box(ly, -22, 5.8, 12.4, 1.6, 2.0, 0.05, RED);
    // balls
    [[-36, 13.5], [-35.2, 13.8]].forEach(function (p) { sph(ly, p[0], 0.2, p[1], 0.2, 0.2, 0.2, '#FF8A33', null, 7); });
  }

  // --------------------------------------------------------------- cafeteria
  function cafeteria(ctx) {
    var ly = ctx.solid, F = L.F;
    F.cafeTables.forEach(function (t, ti) {
      var col = ti % 2 ? '#F2C230' : '#4FB0F0';
      box(ly, t.x, 0.74, t.z, t.len, 0.07, 0.9, '#F5EBD5'); box(ly, t.x, 0.7, t.z, t.len - 0.1, 0.03, 0.8, col);
      [-1, 1].forEach(function (sd) {
        box(ly, t.x, 0.43, t.z + sd * 0.95, t.len, 0.07, 0.38, col);
        [-1, 1].forEach(function (e) { box(ly, t.x + e * (t.len / 2 - 0.4), 0.2, t.z + sd * 0.95, 0.08, 0.4, 0.3, '#7A808C'); });
      });
      [-1, 1].forEach(function (e) { box(ly, t.x + e * (t.len / 2 - 0.5), 0.35, t.z, 0.08, 0.7, 0.7, '#7A808C'); });
      L.addBox(t.x - t.len / 2, t.z - 1.2, t.x + t.len / 2, t.z + 1.2, false, { navBlock: true });
    });
    U.force = 'solid';
    var st = F.cafeStage; boxR(ly, st.x0, st.z0, st.x1, st.z1, 0, st.h, '#B7793F');
    boxR(ly, st.x0, st.z1 - 0.1, st.x1, st.z1, st.h, 3.4, '#B71C2B');
    boxR(ly, st.x0 + 3.5, st.z0 - 0.7, st.x1 - 3.5, st.z0, 0, 0.3, '#B7793F');
    cyl(ly, (st.x0 + st.x1) / 2, st.h + 0.6, st.z0 + 0.8, 0.05, 0.05, 1.2, '#444', 6);
    L.addBox(st.x0, st.z0 - 0.7, st.x1, st.z1, false);
    var co = F.cafeCounter; boxR(ly, co.x0, co.z0, co.x1, co.z1, 0, 1.0, '#E8E8E8'); boxR(ly, co.x0 - 0.05, co.z0, co.x1 + 0.05, co.z1, 1.0, 1.08, '#8CC8F0');
    box(ly, co.x0 + 0.45, 1.8, (co.z0 + co.z1) / 2, 0.05, 0.9, co.z1 - co.z0 - 0.4, '#FFFFFF', 0);
    for (var z = co.z0 + 0.8; z < co.z1 - 0.5; z += 1.4) { box(ly, co.x0 + 0.4, 1.18, z, 0.5, 0.1, 0.4, '#C9894F'); sph(ly, co.x0 + 0.4, 1.3, z, 0.18, 0.1, 0.18, '#FFB74D', null, 5); }
    L.addBox(co.x0, co.z0, co.x1, co.z1, true);
    U.force = null;
    // trash cans
    [[-14.5, 13.2], [-14.5, 38.5], [2.8, 38.5]].forEach(function (p) { cyl(ly, p[0], 0.45, p[1], 0.28, 0.25, 0.9, '#3E8EDE', 8); });
  }

  // ----------------------------------------------------------------- library
  function library(ctx, rng) {
    var ly = ctx.solid, F = L.F;
    F.libShelves.forEach(function (s) {
      var faceX = (s.x1 - s.x0) > (s.z1 - s.z0);
      shelfUnit(ly, s.x0, s.z0, s.x1, s.z1, rng, 2.0, faceX);
      L.addBox(s.x0 - 0.05, s.z0, s.x1 + 0.05, s.z1, false, { navBlock: true });
    });
    F.libTables.forEach(function (t) {
      box(ly, t.x, 0.74, t.z, t.len, 0.07, 1.2, '#E8D2A8'); box(ly, t.x, 0.35, t.z, t.len - 0.3, 0.7, 0.9, '#C9894F');
      addChair(t.x - 0.8, t.z - 1.0, 0, '#3E8EDE'); addChair(t.x + 0.8, t.z - 1.0, 0, '#E03030');
      addChair(t.x - 0.8, t.z + 1.0, Math.PI, '#FFD23F'); addChair(t.x + 0.8, t.z + 1.0, Math.PI, '#4CB86B');
      L.addBox(t.x - t.len / 2, t.z - 0.65, t.x + t.len / 2, t.z + 0.65, false, { navBlock: true });
    });
    F.libBeanbags.forEach(function (b) { sph(ly, b.x, 0.28, b.z, 0.55, 0.32, 0.55, b.color, null, 8); sph(ly, b.x, 0.42, b.z, 0.35, 0.18, 0.35, b.color, null, 6); });
    var c = F.libCounter; boxR(ly, c.x0, c.z0, c.x1, c.z1, 0, 1.05, '#C9894F'); boxR(ly, c.x0 - 0.05, c.z0 - 0.05, c.x1 + 0.05, c.z1 + 0.05, 1.05, 1.12, '#8E6BD1');
    box(ly, 35.6, 1.3, 13.8, 0.5, 0.35, 0.05, '#3A4150');
    L.addBox(c.x0, c.z0, c.x1, c.z1, false, { navBlock: true });
    U.force = 'solid';
    // globe + reading lamp
    cyl(ly, 24.1, 0.45, 13.6, 0.04, 0.04, 0.9, '#444', 5); sph(ly, 24.1, 1.1, 13.6, 0.3, 0.3, 0.3, '#4FB0F0', null, 8);
    plant(ly, 38.8, 13.6, 1.2);
    U.force = null;
  }

  // ------------------------------------------------------------------- music
  function music(ctx) {
    var ly = ctx.solid, F = L.F;
    F.musicRisers.forEach(function (r) { boxR(ly, r.x0, F.musicRiserZ[0], r.x1, F.musicRiserZ[1], 0, r.h, '#B7793F'); boxR(ly, r.x0, F.musicRiserZ[0], r.x1, F.musicRiserZ[1], r.h - 0.02, r.h + 0.01, '#8E6BD1'); });
    L.addBox(51, 14.6, 55.1, 24.4, false);
    U.force = 'solid';
    var p = F.piano, P = yaw(p.x, p.z, 0);
    box(ly, 0, 0.8, 0, 1.4, 0.35, 1.9, '#1F2530', 0, P); box(ly, 0, 0.62, 0.85, 1.3, 0.12, 0.3, '#FFFFFF', 0, P);
    box(ly, 0.75, 1.1, 0, 0.06, 0.5, 1.8, '#1F2530', 0, P);
    [[-0.6, -0.8], [0.6, -0.8], [0, 0.8]].forEach(function (c) { box(ly, c[0], 0.3, c[1], 0.12, 0.6, 0.12, '#1F2530', 0, P); });
    box(ly, p.x, 0.45, p.z + 1.6, 0.7, 0.1, 0.4, '#C9894F'); box(ly, p.x, 0.22, p.z + 1.6, 0.1, 0.45, 0.1, '#444');
    L.addBox(p.x - 0.75, p.z - 1.0, p.x + 0.75, p.z + 1.0, false, { navBlock: true });
    var d = F.drums;
    cyl(ly, d.x, 0.45, d.z, 0.45, 0.45, 0.6, '#E03030', 12); cyl(ly, d.x - 0.7, 0.8, d.z - 0.4, 0.3, 0.3, 0.3, '#FFD23F', 10);
    cyl(ly, d.x + 0.7, 0.8, d.z - 0.4, 0.28, 0.28, 0.3, '#3E8EDE', 10); cyl(ly, d.x - 0.9, 1.2, d.z + 0.3, 0.3, 0.3, 0.03, '#E8C23A', 10);
    cyl(ly, d.x + 0.9, 1.3, d.z + 0.2, 0.3, 0.3, 0.03, '#E8C23A', 10);
    cyl(ly, d.x - 0.9, 0.6, d.z + 0.3, 0.02, 0.02, 1.2, '#888', 4); cyl(ly, d.x + 0.9, 0.65, d.z + 0.2, 0.02, 0.02, 1.3, '#888', 4);
    L.addCircle(d.x, d.z, 1.1, false);
    // wall instruments
    [[48, 12.35, '#E8C23A'], [50, 12.35, '#E03030'], [52, 12.35, '#4FB0F0']].forEach(function (g) { sph(ly, g[0], 1.9, g[1], 0.25, 0.4, 0.1, g[2], null, 6); box(ly, g[0], 2.5, g[1], 0.05, 0.6, 0.05, '#7A4A2A'); });
    U.force = null;
  }

  // ------------------------------------------------------------------- lobby
  function lobby(ctx) {
    var ly = ctx.solid, F = L.F;
    U.force = 'low';
    var b = F.lobbyBench; boxR(ly, b.x0, b.z0, b.x1, b.z1, 0.35, 0.5, '#B7793F'); boxR(ly, b.x0, b.z0, b.x0 + 0.1, b.z1, 0.5, 1.0, '#B7793F');
    boxR(ly, b.x0 + 0.1, b.z0 + 0.05, b.x1 - 0.1, b.z0 + 0.2, 0, 0.35, '#444'); boxR(ly, b.x0 + 0.1, b.z1 - 0.2, b.x1 - 0.1, b.z1 - 0.05, 0, 0.35, '#444');
    L.addBox(b.x0, b.z0, b.x1, b.z1, false);
    U.force = 'solid';
    var t = F.trophyCase; boxR(ly, t.x0, t.z0, t.x1, t.z1, 0, 0.8, '#B7793F');
    box(ctx.glass, (t.x0 + t.x1) / 2 - 0.05, 1.45, (t.z0 + t.z1) / 2, 0.5, 1.3, t.z1 - t.z0 - 0.1, '#BFE6FF');
    boxR(ly, t.x0, t.z0, t.x1, t.z1, 2.1, 2.2, '#B7793F');
    for (var i = 0; i < 5; i++) { var z = t.z0 + 0.6 + i * 1.1; cyl(ly, (t.x0 + t.x1) / 2 - 0.05, 1.05, z, 0.12, 0.08, 0.35, '#FFD23F', 6); sph(ly, (t.x0 + t.x1) / 2 - 0.05, 1.3, z, 0.14, 0.12, 0.14, '#FFD23F', null, 6); }
    L.addBox(t.x0, t.z0, t.x1, t.z1, false);
    U.force = null;
    // welcome banner hung wall to wall
    var tex = U.canvasTex(1024, 160, function (c, w, h) {
      c.fillStyle = RED; U.roundRect(c, 0, 0, w, h, 24); c.fill(); c.fillStyle = '#FFF'; c.textAlign = 'center'; c.textBaseline = 'middle';
      U.fitText(c, 'Welcome to Maple Star!', w - 80, 100); c.fillText('Welcome to Maple Star!', w / 2, h / 2 + 4);
    });
    var bm = U.cutPatch(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    var bn = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.0), bm); bn.position.set(8, 3.3, 24); ctx.extra.push(bn);
    plant(ly, 5.0, 13.6, 1.3); plant(ly, 11.0, 38.8, 1.3); plant(ly, 5.0, 38.8, 1.3);
    // front mats
    flat(ctx.ground, 6.2, 38.6, 9.8, 39.8, 0.09, '#8C3A3A');
  }

  // ------------------------------------------------------------------ office
  function office(ctx) {
    var ly = ctx.solid, F = L.F;
    F.officeCounters.forEach(function (c) { boxR(ly, c.x0, c.z0, c.x1, c.z1, 0, 1.05, '#C9894F'); boxR(ly, c.x0 - 0.05, c.z0 - 0.02, c.x1 + 0.05, c.z1 + 0.02, 1.05, 1.12, '#8DA9D4'); L.addBox(c.x0, c.z0, c.x1, c.z1, false); });
    U.force = 'low';
    F.officeDesks.forEach(function (d, i) {
      box(ly, d.x, 0.38, d.z, 1.0, 0.76, 2.0, '#C9894F'); box(ly, d.x - 0.2, 0.9, d.z, 0.05, 0.3, 0.5, '#3A4150');
      addChair(d.x + 0.9, d.z, -Math.PI / 2, '#8DA9D4');
      L.addBox(d.x - 0.55, d.z - 1.05, d.x + 0.55, d.z + 1.05, false, { navBlock: true });
    });
    U.force = null;
    for (var z = 27; z < 40; z += 1.1) if (z < 32 || z > 36) boxR(ly, 21.2, z, 21.8, z + 0.9, 0, 1.4, '#9AA3B2');
    L.addBox(21.1, 27, 21.9, 39.5, false);
    plant(ly, 13, 27.2, 1.1); plant(ly, 13, 39.2, 1.1);
  }

  // ------------------------------------------------------------------- nurse
  function nurse(ctx) {
    var ly = ctx.solid, F = L.F;
    F.cots.forEach(function (c) {
      var P = yaw(c.x, c.z, Math.PI / 2);
      box(ly, 0, 0.3, 0, 1.9, 0.14, 0.8, '#FFFFFF', 0, P); box(ly, 0.2, 0.42, 0, 1.3, 0.1, 0.78, '#7FD6C4', 0, P); box(ly, -0.75, 0.46, 0, 0.35, 0.12, 0.5, '#FFFFFF', 0, P);
      [[-0.9, -0.35], [-0.9, 0.35], [0.9, -0.35], [0.9, 0.35]].forEach(function (l) { box(ly, l[0], 0.12, l[1], 0.06, 0.24, 0.06, '#9AA3B2', 0, P); });
      L.addBox(c.x - 0.45, c.z - 1.0, c.x + 0.45, c.z + 1.0, false, { navBlock: true });
    });
    U.force = 'low';
    var d = F.nurseDesk; box(ly, d.x, 0.38, d.z, 1.0, 0.76, 1.8, '#C9894F'); addChair(d.x + 0.9, d.z, -Math.PI / 2, '#7FD6C4');
    L.addBox(d.x - 0.5, d.z - 0.95, d.x + 0.5, d.z + 0.95, false, { navBlock: true });
    U.force = 'solid';
    boxR(ly, 12.2, 21, 12.8, 24, 0, 1.8, '#FFFFFF'); box(ly, 12.84, 1.2, 22.5, 0.02, 0.5, 0.15, '#E03030'); box(ly, 12.84, 1.2, 22.5, 0.02, 0.15, 0.5, '#E03030');
    L.addBox(12.15, 21, 12.8, 24, false);
    // eye chart
    box(ly, 17, 1.6, 25.8, 0.6, 0.8, 0.03, '#FFFFFF');
    plant(ly, 21.2, 25.2, 1);
    U.force = null;
  }

  // -------------------------------------------------------------------- roofs
  // ctx.roof: single-storey roofs (front row, gym, hallway ends); ctx.roofUp: the
  // roof of the two-storey block (wings, upper hallway, stair towers).
  function roofs(ctx) {
    var rf = ctx.roof, up = ctx.roofUp, tr = '#FFFFFF', slab = '#D3D9E1', seam = '#BAC3CF', t = 0.35;
    U.setFloor(0);
    function trim(ly, x0, z0, x1, z1, y) { boxR(ly, x0, z0, x1, z1, y - 0.35, y + 0.55, RED); }
    // ---- low roofs (y 4.3) ----
    boxR(rf, -52.17, 7.85, -42, 12.17, 3.95, 4.3, slab);                 // hallway west end
    boxR(rf, 10, 7.85, 56.17, 12.17, 3.95, 4.3, slab);                   // hallway east part
    boxR(rf, -16.2, 12.0, 56.17, 40.17, 3.95, 4.3, slab);                // front row
    boxR(rf, -40.17, 12.0, -15.8, 40.17, 7.95, 8.3, slab);               // gym (taller)
    for (var x = -8; x < 56; x += 12) boxR(rf, x, 12, x + 0.12, 40, 4.3, 4.34, seam);
    boxR(rf, -16, 24, 56, 24.12, 4.3, 4.34, seam); boxR(rf, -40, 24, -16, 24.12, 8.3, 8.34, seam);
    trim(rf, -16.2, 40.2 - t, 56.2, 40.2, 4.3);                          // south
    trim(rf, 56.2 - t, 7.8, 56.2, 40.2, 4.3);                            // east
    trim(rf, 20.2, 7.8, 56.2, 7.8 + t, 4.3);                             // hallway north edge (courtyard side)
    trim(rf, -52.2, 8.2, -52.2 + t, 12.2, 4.3); trim(rf, -52.2, 12.2 - t, -40.2, 12.2, 4.3);   // hallway west end
    trim(rf, -40.2, 12.0, -40.2 + t, 40.2, 8.3); trim(rf, -40.2, 40.2 - t, -15.8, 40.2, 8.3); trim(rf, -15.8 - t, 12.2, -15.8, 40.2, 8.3);   // gym
    boxR(rf, -16.0, 40.2 - t - 0.05, 56.0, 40.2 - t, 3.95, 4.75, tr);
    [[20, 28], [44, 30], [-4, 22], [30, 10]].forEach(function (p) {
      boxR(rf, p[0] - 1.4, p[1] - 1.0, p[0] + 1.4, p[1] + 1.0, 4.3, 5.3, '#A9B3C2'); cyl(rf, p[0], 5.35, p[1], 0.7, 0.7, 0.1, '#6A7382', 10);
      boxR(rf, p[0] - 1.5, p[1] - 1.1, p[0] + 1.5, p[1] + 1.1, 4.3, 4.45, '#8B95A5');
    });
    [[-28, 30], [-24, 22], [-30, 36]].forEach(function (p) { boxR(rf, p[0] - 1.2, p[1] - 1, p[0] + 1.2, p[1] + 1, 8.3, 9.2, '#A9B3C2'); });
    // entrance sign board with big letters (plane added in finishRoof)
    box(rf, 8, 5.5, 40.0, 14.2, 2.0, 0.5, RED); box(rf, 8, 4.65, 40.0, 14.6, 0.3, 0.7, '#FFFFFF');
    // ---- upper roof (walls end at 8.4) ----
    var y0 = 8.35, y1 = 8.7;
    boxR(up, -40.17, -28.17, 8.17, 8, y0, y1, slab);                      // wings
    boxR(up, -42.17, 8, 10.17, 12.17, y0, y1, slab);                      // upper hallway
    boxR(up, -52.17, 1.83, -40.17, 8.17, y0, y1, slab); boxR(up, 8.17, 1.83, 20.17, 8.17, y0, y1, slab);   // stair towers
    for (x = -28; x < 8; x += 12) boxR(up, x, -28, x + 0.12, 8, y1, y1 + 0.04, seam);
    boxR(up, -40, -10, 8, -9.88, y1, y1 + 0.04, seam);
    trim(up, -40.2, -28.2, 8.2, -28.2 + t, y1);                           // north
    trim(up, -40.2, -28.2, -40.2 + t, 1.8, y1); trim(up, 8.2 - t, -28.2, 8.2, 1.8, y1);          // wing sides
    trim(up, -52.2, 1.8, -40.2, 1.8 + t, y1); trim(up, -52.2, 1.8, -52.2 + t, 8.2, y1); trim(up, -52.2, 8.2 - t, -42.2, 8.2, y1);   // west tower
    trim(up, 8.2, 1.8, 20.2, 1.8 + t, y1); trim(up, 20.2 - t, 1.8, 20.2, 8.2, y1); trim(up, 10.2, 8.2 - t, 20.2, 8.2, y1);          // east tower
    trim(up, -42.2, 8.2, -42.2 + t, 12.2, y1); trim(up, 10.2 - t, 8.2, 10.2, 12.2, y1); trim(up, -42.2, 12.2 - t, 10.2, 12.2, y1);   // upper hallway
    [[-30, -18], [-8, -14], [-20, 2], [0, -22]].forEach(function (p) {
      boxR(up, p[0] - 1.4, p[1] - 1.0, p[0] + 1.4, p[1] + 1.0, y1, y1 + 1.0, '#A9B3C2'); cyl(up, p[0], y1 + 1.05, p[1], 0.7, 0.7, 0.1, '#6A7382', 10);
    });
    cyl(up, 6, y1 + 2, 6, 0.12, 0.12, 4.0, '#E8E8E8', 6);
  }
  I.finishRoof = function (ctx, roofGroup) {
    var tex = U.canvasTex(2048, 256, function (c, w, h) {
      c.fillStyle = RED; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      var s = U.fitText(c, 'MAPLE STAR ELEMENTARY', w - 120, 170, '900'); c.fillText('MAPLE STAR ELEMENTARY', w / 2, h / 2 + 6);
    });
    var m = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 1.7), U.cutPatch(new THREE.MeshBasicMaterial({ map: tex })));
    m.position.set(8, 5.5, 40.27); roofGroup.add(m);
  };
})();
