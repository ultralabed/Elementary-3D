/*
 * world.js - procedural scenery: ground, roads, outdoors, sky, scene lights.
 *
 * Rendering strategy (keeps draw calls low):
 *   - Every static thing is baked into merged BufferGeometries with vertex
 *     colours.  A `Layer` splits geometry into spatial chunks (50 m cells) so
 *     frustum culling and the shadow camera can skip far-away chunks.
 *   - Repeated small things (desks, chairs, ...) use InstancedMesh (interior.js).
 *   - One material style everywhere: MeshToonMaterial with a 4-step gradient.
 *
 * The utilities are exported as CAMPUS.world.util for interior.js.
 */
(function () {
  'use strict';
  if (!window.THREE) return;     // engine failed to load: main.js shows a message
  var S = window.CAMPUS, L = S.layout, THREE = window.THREE;
  var W = S.world = {};
  var U = W.util = {};
  W.sunDir = new THREE.Vector3(0.45, 0.8, 0.38).normalize();

  // ------------------------------------------------------------------ colour
  var colorCache = {};
  function C(hex) { // sRGB hex -> linear Color (vertex colours are not converted by three r128)
    var c = colorCache[hex];
    if (!c) { c = new THREE.Color(hex); c.convertSRGBToLinear(); colorCache[hex] = c; }
    return c;
  }
  U.C = C;

  // ------------------------------------------------------------------- batch
  function Batch() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
  var _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
  // add an indexed geometry transformed by matrix m, one flat colour
  Batch.prototype.geo = function (g, m, col) {
    var pos = g.attributes.position, nor = g.attributes.normal, idx = g.index, base = this.v, i;
    _nm.getNormalMatrix(m);
    for (i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize(); this.n.push(_n.x, _n.y, _n.z);
      this.c.push(col.r, col.g, col.b);
    }
    for (i = 0; i < idx.count; i++) this.i.push(base + idx.getX(i));
    this.v += pos.count;
  };
  // flat triangle; `hint` (optional [x,y,z]) = desired facing direction
  Batch.prototype.tri = function (a, b, c, col, hint) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { var t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    for (var k = 0; k < 3; k++) this.c.push(col.r, col.g, col.b);
    this.i.push(this.v, this.v + 1, this.v + 2); this.v += 3;
  };

  // Layer = spatial hash of batches (50 m cells)
  function Layer(cell) { this.cell = cell || 50; this.chunks = {}; }
  Layer.prototype.at = function (x, z) {
    var k = Math.floor((x + 5e4) / this.cell) + ',' + Math.floor((z + 5e4) / this.cell);   // offset: a huge cell is really one chunk
    return this.chunks[k] || (this.chunks[k] = new Batch());
  };
  Layer.prototype.build = function (material, cast, receive, group) {
    var out = [];
    for (var k in this.chunks) {
      var b = this.chunks[k]; if (!b.v) continue;
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.n), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.c), 3));
      g.setIndex(new THREE.BufferAttribute(b.v > 65000 ? new Uint32Array(b.i) : new Uint16Array(b.i), 1));
      g.computeBoundingSphere();
      var m = new THREE.Mesh(g, material);
      m.castShadow = !!cast; m.receiveShadow = !!receive; m.matrixAutoUpdate = false; m.updateMatrix();
      if (group) group.add(m);
      out.push(m);
    }
    return out;
  };
  U.Layer = Layer;

  // ------------------------------------------------------------- primitives
  var geoCache = {};
  function G(key, make) { return geoCache[key] || (geoCache[key] = make()); }
  var unitBox = function () { return G('box', function () { return new THREE.BoxGeometry(1, 1, 1); }); };
  var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function prim(ly, geo, x, y, z, sx, sy, sz, col, P, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    if (P) _m.premultiply(P);
    // which layer?  A piece is either wholly cut-able (solid) or wholly never-cut (low):
    // U.force decides for multi-part furniture, otherwise the top of this primitive does.
    if (W.ctx && ly === W.ctx.solid) {
      if (U.force) { if (U.force === 'low') ly = W.ctx.low; }
      else if (U.lowSplit) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (_m.elements[13] + geo.boundingBox.max.y * Math.abs(_m.elements[5]) <= 0.95) ly = W.ctx.low;
      }
    }
    _m.elements[13] += U.yOff;
    var wx = _m.elements[12], wz = _m.elements[14];
    ly.at(wx, wz).geo(geo, _m, typeof col === 'string' ? C(col) : col);
  }
  // box centred at (x,y,z), size sx,sy,sz, optional yaw ry (about its own centre) and parent frame P
  function box(ly, x, y, z, sx, sy, sz, col, ry, P) { prim(ly, unitBox(), x, y, z, sx, sy, sz, col, P, 0, ry || 0, 0); }
  // box from y0 up to y1 on an x/z rectangle
  function boxR(ly, x0, z0, x1, z1, y0, y1, col) { box(ly, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col); }
  function cyl(ly, x, y, z, rt, rb, h, col, seg, P, rx, ry, rz) {
    var s = seg || 10;
    prim(ly, G('cyl' + rt / rb + '_' + s, function () { return new THREE.CylinderGeometry(rt / rb, 1, 1, s); }), x, y, z, rb, h, rb, col, P, rx, ry, rz);
  }
  function sph(ly, x, y, z, rx, ry, rz, col, P, seg) {
    var s = seg || 8;
    prim(ly, G('sph' + s, function () { return new THREE.SphereGeometry(1, s, Math.max(4, s - 2)); }), x, y, z, rx, ry, rz, col, P);
  }
  function torus(ly, x, y, z, R, r, col, P, rx, ry, rz) {
    prim(ly, G('tor', function () { return new THREE.TorusGeometry(1, 0.08, 6, 14); }), x, y, z, R, R, R, col, P, rx, ry, rz);
  }
  function yaw(x, z, ry) { var m = new THREE.Matrix4().makeRotationY(ry || 0); m.setPosition(x, 0, z); return m; }
  U.boxGeo = unitBox; U.box = box; U.boxR = boxR; U.cyl = cyl; U.sph = sph; U.prim = prim; U.torus = torus; U.yaw = yaw;

  // flat horizontal shapes (normal +Y)
  var UP = [0, 1, 0];
  function flat(ly, x0, z0, x1, z1, y, col) {
    y += U.yOff;
    var b = ly.at((x0 + x1) / 2, (z0 + z1) / 2); col = typeof col === 'string' ? C(col) : col;
    b.tri([x0, y, z0], [x1, y, z0], [x1, y, z1], col, UP); b.tri([x0, y, z0], [x1, y, z1], [x0, y, z1], col, UP);
  }
  function poly(ly, pts, y, col) { // simple polygon (ear-clipped)
    y += U.yOff;
    col = typeof col === 'string' ? C(col) : col;
    var v = pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    if (v.length > 1 && v[0].equals(v[v.length - 1])) v.pop();
    var tris = THREE.ShapeUtils.triangulateShape(v, []);
    tris.forEach(function (t) {
      var a = v[t[0]], b = v[t[1]], c = v[t[2]];
      ly.at((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3).tri([a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], col, UP);
    });
  }
  function fan(ly, cx, cz, pts, y, col) { // convex shape as a fan
    y += U.yOff;
    col = typeof col === 'string' ? C(col) : col;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      ly.at(cx, cz).tri([cx, y, cz], [a[0], y, a[1]], [b[0], y, b[1]], col, UP);
    }
  }
  function strip(ly, outer, inner, y, col) { // quads between two point loops of equal length
    y += U.yOff;
    col = typeof col === 'string' ? C(col) : col;
    for (var i = 0; i < outer.length; i++) {
      var j = (i + 1) % outer.length, o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j];
      var b = ly.at((o0[0] + i0[0]) / 2, (o0[1] + i0[1]) / 2);
      b.tri([o0[0], y, o0[1]], [o1[0], y, o1[1]], [i1[0], y, i1[1]], col, UP);
      b.tri([o0[0], y, o0[1]], [i1[0], y, i1[1]], [i0[0], y, i0[1]], col, UP);
    }
  }
  function circlePts(cx, cz, r, n) { var a = []; for (var i = 0; i < n; i++) { var t = i / n * Math.PI * 2; a.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); } return a; }
  function disk(ly, cx, cz, r, y, col, n) { fan(ly, cx, cz, circlePts(cx, cz, r, n || 20), y, col); }
  function ring(ly, cx, cz, rIn, rOut, y, col, n) { strip(ly, circlePts(cx, cz, rOut, n || 28), circlePts(cx, cz, rIn, n || 28), y, col); }
  function outline(ly, x0, z0, x1, z1, y, t, col) { // rectangle outline of line width t
    flat(ly, x0, z0, x1, z0 + t, y, col); flat(ly, x0, z1 - t, x1, z1, y, col);
    flat(ly, x0, z0 + t, x0 + t, z1 - t, y, col); flat(ly, x1 - t, z0 + t, x1, z1 - t, y, col);
  }
  function stadium(cx, cz, r, half, n) { // convex oval: straight sides along Z
    var pts = [], i, t;
    for (i = 0; i <= n; i++) { t = i / n * Math.PI; pts.push([cx + Math.cos(t) * r, cz + half + Math.sin(t) * r]); }
    for (i = 0; i <= n; i++) { t = Math.PI + i / n * Math.PI; pts.push([cx + Math.cos(t) * r, cz - half + Math.sin(t) * r]); }
    return pts;
  }
  U.flat = flat; U.poly = poly; U.fan = fan; U.strip = strip; U.disk = disk; U.ring = ring; U.outline = outline; U.circlePts = circlePts;

  // ---------------------------------------------------------------- canvases
  function canvasTex(w, h, draw) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  function fitText(ctx, text, maxW, size, weight) {
    ctx.font = (weight || '800') + ' ' + size + 'px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
    while (ctx.measureText(text).width > maxW && size > 8) { size -= 2; ctx.font = (weight || '800') + ' ' + size + 'px "Trebuchet MS", "Segoe UI", system-ui, sans-serif'; }
    return size;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  U.canvasTex = canvasTex; U.fitText = fitText; U.roundRect = roundRect;

  // ---------------------------------------------------------------- materials
  var gradient = new THREE.DataTexture(new Uint8Array([110, 175, 228, 255]), 4, 1, THREE.LuminanceFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.generateMipmaps = false; gradient.needsUpdate = true;
  var matSolid = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  var matGlass = new THREE.MeshToonMaterial({ color: C('#BFE6FF'), gradientMap: gradient, transparent: true, opacity: 0.42, depthWrite: false });
  // unpatched twin of matSolid for things that must never be cut away (ground, floors, low furniture)
  var matPlain = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  U.matSolid = matSolid; U.matGlass = matGlass; U.matPlain = matPlain; U.gradient = gradient;
  W.matInstanced = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });

  // ------------------------------------------------------------- cutaway
  // The third-person camera keeps a fixed distance, so anything solid between the
  // camera and the player is made see-through instead: fragments inside a cone
  // around the segment camera -> player head are discarded (dithered rim).  One
  // shared patch + shared uniforms; main.js updates the uniforms every frame.
  // Not applied to ground / floors / low furniture / sky / characters, and depth
  // (shadow) materials are untouched so cut walls still cast shadows.
  var cut = W.cut = { uCutCam: { value: new THREE.Vector3() }, uCutTarget: { value: new THREE.Vector3(0, 1.3, 0) }, uCutOn: { value: 0 }, uCutMinY: { value: 0.12 } };
  function cutCompile(shader) {
    shader.uniforms.uCutCam = cut.uCutCam; shader.uniforms.uCutTarget = cut.uCutTarget; shader.uniforms.uCutOn = cut.uCutOn; shader.uniforms.uCutMinY = cut.uCutMinY;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        'vec4 cutW = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        '  cutW = instanceMatrix * cutW;',
        '#endif',
        'vCutWorld = ( modelMatrix * cutW ).xyz;'].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uCutCam;\nuniform vec3 uCutTarget;\nuniform float uCutOn;\nuniform float uCutMinY;')
      .replace('#include <clipping_planes_fragment>', [
        '#include <clipping_planes_fragment>',
        'if ( uCutOn > 0.5 && vCutWorld.y > uCutMinY ) {',      // floor guard: the floor the player stands on is never cut
        '  vec3 cutAB = uCutTarget - uCutCam;',
        '  float cutT = dot( vCutWorld - uCutCam, cutAB ) / dot( cutAB, cutAB );',
        '  if ( cutT > -0.05 && cutT < 1.0 ) {',                       // only things nearer the camera than the player
        '    float cutD = length( vCutWorld - ( uCutCam + cutAB * cutT ) );',
        '    float cutIn = ( mix( 1.0, 2.6, cutT ) - cutD ) / 0.5;',   // 0 at the rim .. 1 half a metre inside
        '    if ( cutIn > 0.0 ) {',
        '      float cutN = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',   // stable screen-door pattern
        '      if ( cutIn > cutN ) discard;',
        '    }',
        '  }',
        '}'].join('\n'));
  }
  function cutKey() { return 'campus-cut'; }
  U.cutPatch = function (m) { m.onBeforeCompile = cutCompile; m.customProgramCacheKey = cutKey; return m; };
  U.cutPatch(matSolid); U.cutPatch(matGlass);
  // The second floor's own floor and low furniture must be cut-able while the player is NOT
  // upstairs (the camera may sit inside an upper room looking down at a player outside), and
  // never cut while the player is upstairs: floors use the patched twin + the uCutMinY guard,
  // upper low furniture / desks swap between patched and plain materials (see updateCutMaterials).
  var matPlainCut = U.cutPatch(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient }));
  W.matInstancedCut = U.cutPatch(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient }));
  // interior.js switches this on while it places furniture: pieces whose top is below
  // 0.95 m go to the un-cut `low` layer so tables/desks never vanish around the player
  U.lowSplit = false;
  U.force = null;              // 'solid' | 'low': layer for every primitive of the piece being built
  U.piece = function (layer, fn) { var old = U.force; U.force = layer; fn(); U.force = old; };
  // second floor: U.setFloor(1) redirects the layers to the upper-floor set and lifts everything by one storey
  U.yOff = 0;
  U.setFloor = function (lv) {
    var c = W.ctx, q = c.sets[lv];
    c.solid = q.solid; c.ground = q.ground; c.glass = q.glass; c.low = q.low; U.yOff = lv * L.FLOOR_H; L.curLevel = lv;
  };

  // ------------------------------------------------------------ small props
  // Cartoon car (nose toward +X in its own frame), baked into a layer.
  function carBody(ly, x, z, ry, color) {
    var P = yaw(x, z, ry);
    box(ly, 0, 0.66, 0, 4.2, 0.6, 1.8, color, 0, P);
    box(ly, 0, 0.36, 0, 4.1, 0.28, 1.7, '#2B2F3A', 0, P);
    sph(ly, -0.2, 1.12, 0, 1.2, 0.55, 0.84, color, P, 8);
    sph(ly, -0.2, 1.18, 0, 1.0, 0.42, 0.86, '#BFE6FF', P, 8);
    box(ly, 2.1, 0.74, 0.55, 0.12, 0.2, 0.3, '#FFF3A8', 0, P); box(ly, 2.1, 0.74, -0.55, 0.12, 0.2, 0.3, '#FFF3A8', 0, P);
    box(ly, -2.1, 0.74, 0.6, 0.1, 0.18, 0.28, '#E03030', 0, P); box(ly, -2.1, 0.74, -0.6, 0.1, 0.18, 0.28, '#E03030', 0, P);
    [[1.35, 0.9], [1.35, -0.9], [-1.35, 0.9], [-1.35, -0.9]].forEach(function (w) {
      prim(ly, G('wheel', function () { return new THREE.CylinderGeometry(1, 1, 1, 10); }), w[0], 0.36, w[1], 0.36, 0.28, 0.36, '#23262E', P, Math.PI / 2, 0, 0);
      prim(ly, G('wheel', function () { return new THREE.CylinderGeometry(1, 1, 1, 10); }), w[0], 0.36, w[1] + Math.sign(w[1]) * 0.1, 0.18, 0.1, 0.18, '#C9CED6', P, Math.PI / 2, 0, 0);
    });
  }
  U.car = carBody;

  function bus(ly, b) {
    var P = yaw(b.x, b.z, 0), Y = '#F8C61E';
    box(ly, 0, 1.6, 0, 9.4, 2.4, 2.6, Y, 0, P);                 // body
    box(ly, 5.0, 1.0, 0, 1.6, 1.2, 2.4, Y, 0, P);                // hood
    box(ly, 0, 0.55, 0, 10.4, 0.5, 2.5, '#2B2F3A', 0, P);        // chassis
    box(ly, 0, 2.95, 0, 9.0, 0.3, 2.4, '#F2BA14', 0, P);         // roof cap
    box(ly, 0, 1.25, 0, 9.5, 0.14, 2.65, '#1E1E24', 0, P);       // black stripe
    for (var i = -4; i <= 3; i++) {                              // windows both sides
      box(ly, i * 1.12 - 0.2, 2.15, 1.31, 0.9, 0.8, 0.06, '#7FB8E6', 0, P);
      box(ly, i * 1.12 - 0.2, 2.15, -1.31, 0.9, 0.8, 0.06, '#7FB8E6', 0, P);
    }
    box(ly, 3.8, 1.75, -1.31, 1.0, 1.7, 0.08, '#BFE6FF', 0, P);  // door (school side, -Z)
    box(ly, 4.5, 2.15, 0, 0.06, 0.9, 2.3, '#7FB8E6', 0, P);      // windshield
    box(ly, 5.85, 1.05, 0.8, 0.1, 0.25, 0.4, '#FFF3A8', 0, P); box(ly, 5.85, 1.05, -0.8, 0.1, 0.25, 0.4, '#FFF3A8', 0, P);
    box(ly, -4.75, 1.0, 0, 0.1, 0.3, 2.0, '#E03030', 0, P);
    box(ly, 3.4, 1.6, -1.6, 0.08, 0.7, 0.7, '#E03030', 0, P);    // folded stop sign
    [[3.4, 1.28], [3.4, -1.28], [-3.1, 1.28], [-3.1, -1.28]].forEach(function (w) {
      prim(ly, G('wheel', function () { return new THREE.CylinderGeometry(1, 1, 1, 10); }), w[0], 0.55, w[1], 0.55, 0.4, 0.55, '#23262E', P, Math.PI / 2, 0, 0);
      prim(ly, G('wheel', function () { return new THREE.CylinderGeometry(1, 1, 1, 10); }), w[0], 0.55, w[1] + Math.sign(w[1]) * 0.12, 0.28, 0.12, 0.28, '#C9CED6', P, Math.PI / 2, 0, 0);
    });
  }

  // ------------------------------------------------------------------ build
  W.build = function (scene) {
    // layer sets: [0] ground floor + outdoors, [1] second floor (hidden while the player is downstairs inside)
    var sets = [{ solid: new Layer(50), ground: new Layer(90), glass: new Layer(60), low: new Layer(1000) },
                { solid: new Layer(1000), ground: new Layer(1000), glass: new Layer(1000), low: new Layer(1000) }];   // upper floor: one chunk each
    var solid = sets[0].solid, ground = sets[0].ground;
    var ctx = { sets: sets, roof: new Layer(1000), roofUp: new Layer(1000), stair: new Layer(1000), dyn: [], groups: {}, extra: [], extraUp: [] };
    W.ctx = ctx; U.setFloor(0);
    var site = S.site;

    // ---------- base grass, school lawn, sidewalks, roads (flat layers) ----------
    flat(ground, -1200, -1200, 1200, 1200, 0, '#86CE62');
    poly(ground, site.grounds, 0.03, '#9BE070');
    buildRoads(ground);
    buildPaths(ground);

    // ---------- building, interiors ----------
    S.interior.build(ctx);
    U.setFloor(0);

    // ---------- outdoor areas ----------
    buildCourtyard(ctx);
    buildPlayground(ctx);
    buildField(ground, solid);
    buildCourt(ctx);
    buildGarden(ctx);
    buildPavilion(ctx);
    buildParking(ctx);
    buildFront(ctx);
    buildTrees(solid);
    buildFence(solid);
    buildHouses(solid);
    L.fixNarrowGaps();                       // close sub-0.7 m pockets between colliders

    // ---------- turn layers into meshes ----------
    var cutMeshes = W.cutMeshes = [];        // solid chunks: patched material only near the line of sight
    var upSwap = W.upSwap = [];              // upper low furniture + upper desks/chairs
    function group(q, extra, upper) {
      var g = new THREE.Group();
      q.ground.build(upper ? matPlainCut : matPlain, false, true, g);
      q.low.build(matPlain, true, true, g).forEach(function (m) { if (upper) upSwap.push(m); });
      if (upper) extra.forEach(function (m) { if (m.isInstancedMesh) upSwap.push(m); });
      q.solid.build(matSolid, true, true, g).forEach(function (m) { cutMeshes.push(m); });
      q.glass.build(matGlass, false, false, g).forEach(function (m) { m.renderOrder = 5; });
      extra.forEach(function (m) { g.add(m); });
      scene.add(g); return g;
    }
    W.groundGroup = group(sets[0], ctx.extra);
    W.upperGroup = group(sets[1], ctx.extraUp, true);
    // stair flights: part of the floor while the player is on them (never cut), cut-able otherwise
    W.stairMeshes = ctx.stair.build(matPlain, true, true, W.groundGroup);
    W.roofGroup = new THREE.Group();          // single-storey roofs (front row, gym, hallway ends)
    ctx.roof.build(matSolid, true, true, W.roofGroup).forEach(function (m) { cutMeshes.push(m); });
    S.interior.finishRoof(ctx, W.roofGroup);
    W.roofUpGroup = new THREE.Group();        // roof of the two-storey block
    ctx.roofUp.build(matSolid, true, true, W.roofUpGroup).forEach(function (m) { cutMeshes.push(m); });
    scene.add(W.roofGroup); scene.add(W.roofUpGroup);

    buildSky(scene);
    buildMovingCars(scene);
    return W;
  };

  // Early-z friendliness: only solid chunks near the camera -> head segment keep the
  // material with the cutaway `discard`; all others use its unpatched twin (same program
  // as the ground).  Called once per frame by main.js.
  var _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  W.updateCutMaterials = function (playerUp, onStairs) {
    var on = cut.uCutOn.value > 0.5, list = W.cutMeshes, i;
    cut.uCutMinY.value = playerUp ? L.FLOOR_H + 0.12 : 0.12;
    for (i = 0; i < W.stairMeshes.length; i++) { var sm = onStairs ? matPlain : matPlainCut; if (W.stairMeshes[i].material !== sm) W.stairMeshes[i].material = sm; }
    for (i = 0; i < W.upSwap.length; i++) {
      var u = W.upSwap[i], wm = u.isInstancedMesh ? (playerUp ? W.matInstanced : W.matInstancedCut) : (playerUp ? matPlain : matPlainCut);
      if (u.material !== wm) u.material = wm;
    }
    _a.copy(cut.uCutCam.value); _b.copy(cut.uCutTarget.value).sub(_a); var l2 = _b.lengthSq() || 1;
    for (i = 0; i < list.length; i++) {
      var m = list[i], near = false;
      if (on) {
        var bs = m.geometry.boundingSphere; _c.copy(bs.center).sub(_a);
        var t = _c.dot(_b) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        near = _c.addScaledVector(_b, -t).length() < 3.1 + bs.radius;
      }
      var want = near ? matSolid : matPlain;
      if (m.material !== want) m.material = want;
    }
  };

  // ---------------------------------------------------------------- courtyard
  function buildCourtyard(ctx) {
    var g = ctx.ground, ly = ctx.solid, z = L.zones.courtyard, F = L.F;
    flat(g, 8.15, z.z0, 56, 7.85, 0.05, '#E4DCCB');
    for (var x = 12; x < 56; x += 8) flat(g, x, z.z0, x + 0.15, 7.85, 0.055, '#D2C8B2');
    for (var zz = -24; zz < 8; zz += 8) flat(g, 8.15, zz, 56, zz + 0.15, 0.055, '#D2C8B2');
    flat(g, 36.4, -28, 39.6, 7.85, 0.06, '#EFEAE0');                    // walk from the hallway door to the back
    F.planters.forEach(function (p, i) {
      U.piece('solid', function () {
        box(ly, p.x, 0.3, p.z, 3.2, 0.6, 3.2, '#B5654A'); box(ly, p.x, 0.58, p.z, 2.8, 0.1, 2.8, '#5A3A22');
        cyl(ly, p.x, 1.5, p.z, 0.16, 0.22, 1.9, '#8A5A3B', 7);
        sph(ly, p.x, 3.1, p.z, 1.5, 1.3, 1.5, i % 2 ? '#5DBB4A' : '#6CC95A', null, 8); sph(ly, p.x + 0.7, 2.7, p.z + 0.3, 1.0, 0.9, 1.0, '#4FAE49', null, 7);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c, k) { sph(ly, p.x + c[0], 0.78, p.z + c[1], 0.3, 0.26, 0.3, ['#FF6B6B', '#FFD23F', '#FF9FD2', '#FFFFFF'][k], null, 6); });
      });
      L.addBox(p.x - 1.6, p.z - 1.6, p.x + 1.6, p.z + 1.6, true);
    });
    F.courtBenches.forEach(function (b) { bench(ly, b.x, b.z, b.rot); L.addBox(b.x - 1.0, b.z - 0.4, b.x + 1.0, b.z + 0.4, false); });
    F.courtTables.forEach(function (t) { picnic(ly, t.x, t.z, 0); L.addBox(t.x - 1.2, t.z - 0.9, t.x + 1.2, t.z + 0.9, false, { navBlock: true }); });
  }
  function picnic(ly, x, z, rot) {           // low: never cut away
    var P = yaw(x, z, rot || 0);
    U.piece('low', function () {
      box(ly, 0, 0.78, 0, 2.2, 0.1, 0.9, '#C9894F', 0, P);
      box(ly, 0, 0.45, 1.0, 2.2, 0.1, 0.35, '#B7793F', 0, P); box(ly, 0, 0.45, -1.0, 2.2, 0.1, 0.35, '#B7793F', 0, P);
      box(ly, -0.8, 0.4, 0, 0.1, 0.8, 2.0, '#8A5A2E', 0, P); box(ly, 0.8, 0.4, 0, 0.1, 0.8, 2.0, '#8A5A2E', 0, P);
    });
  }

  // ------------------------------------------------------------------- roads
  function buildRoads(ly) {
    var asph = '#4B505C', line = '#F6F2E4', yel = '#F4C430';
    var x0 = -320, x1 = 320;
    // two carriageways with a grassy median between them
    [91, 103].forEach(function (z) {
      flat(ly, x0, z - 4, x1, z + 4, 0.05, asph);
      flat(ly, x0, z - 3.85, x1, z - 3.7, 0.07, line); flat(ly, x0, z + 3.7, x1, z + 3.85, 0.07, line);
      for (var x = x0; x < x1; x += 8) flat(ly, x, z - 0.08, x + 3.5, z + 0.08, 0.07, line);
    });
    flat(ly, x0, 95, x1, 99, 0.06, '#8BD468');                  // median
    flat(ly, x0, 94.8, x1, 95, 0.1, '#D9D4C7'); flat(ly, x0, 99, x1, 99.2, 0.1, '#D9D4C7');
    // sidewalk along the school front + opposite side
    flat(ly, x0, 82.8, x1, 87, 0.05, '#DAD5C8');
    flat(ly, x0, 107, x1, 110, 0.05, '#DAD5C8');
    // Star Lane
    flat(ly, -54, 99, -40, 320, 0.055, asph);
    for (var z = 108; z < 320; z += 8) flat(ly, -47.08, z, -46.92, z + 3.5, 0.075, yel);
    flat(ly, -53.9, 107, -53.75, 320, 0.075, line); flat(ly, -40.25, 107, -40.1, 320, 0.075, line);
    // drive strip + connectors + link road to the parking lot
    var d = L.driveStrip;
    flat(ly, d.x0, d.z0, d.x1, d.z1, 0.06, asph);
    flat(ly, -64, 66, -56, 87, 0.06, asph); flat(ly, 96, 66, 104, 87, 0.06, asph);
    flat(ly, 96, 7, 104, 58, 0.06, asph);
    for (var x = d.x0 + 2; x < d.x1 - 3; x += 7) flat(ly, x, 61.94, x + 3, 62.06, 0.08, yel);
    for (z = 70; z < 86; z += 4) { flat(ly, -60.06, z, -59.94, z + 2, 0.08, yel); flat(ly, 99.94, z, 100.06, z + 2, 0.08, yel); }
    for (z = 10; z < 56; z += 5) flat(ly, 99.94, z, 100.06, z + 2.5, 0.08, yel);
    // crosswalk stripes where the school walkway meets the drive
    for (var s = 0; s < 8; s++) flat(ly, 4.4 + s * 1.0, 58.4, 4.9 + s * 1.0, 65.6, 0.09, line);
    for (s = 0; s < 8; s++) flat(ly, -68 + s * 1.0, 74, -67.5 + s * 1.0, 76, 0.09, line);
    for (s = 0; s < 7; s++) flat(ly, -64 + s * 1.2, 87.4, -63.4 + s * 1.2, 90, 0.09, line);
  }

  // sidewalks / paths around the building and to the outdoor areas
  function buildPaths(ly) {
    var side = '#DDD8CB';
    // pavement hugging the building
    flat(ly, -43, 40.15, 59, 43, 0.05, side);                                  // front
    flat(ly, -43, -31, 11, -28.15, 0.05, side);                                // behind the wings
    flat(ly, -43, -31, -40.15, 1.85, 0.05, side); flat(ly, -43, 12.15, -40.15, 43, 0.05, side);
    flat(ly, -55, -1, -40.15, 1.85, 0.05, side); flat(ly, -55, -1, -52.15, 15, 0.05, side); flat(ly, -55, 12.15, -43, 15, 0.05, side);
    flat(ly, 56.15, 5, 59, 43, 0.05, side);
    // entrance plaza + walkway to the drive
    flat(ly, 1, 40, 15, 47, 0.06, '#E9E4D6'); flat(ly, 6, 47, 10, 58, 0.06, '#E9E4D6');
    flat(ly, 5.9, 46.5, 10.1, 58, 0.065, '#EFEAE0');
    // side doors to the field / parking / back
    flat(ly, -66, 8.4, -55, 11.6, 0.05, side); flat(ly, 59, 8.4, 84, 11.6, 0.05, side);
    L.wings.forEach(function (w) { if (!w.level) flat(ly, w.cx - 1.6, -45, w.cx + 1.6, -31, 0.05, side); });
    flat(ly, -46, -35, 58, -33, 0.05, side); flat(ly, 36.4, -33, 39.6, -28, 0.05, side);
    // ring links the front plaza
    flat(ly, -46, 44, 62, 46, 0.05, side);
    flat(ly, -58, 15, -55, 46, 0.05, side); flat(ly, -58, 44, -46, 46, 0.05, side); flat(ly, 59, -33, 62, 46, 0.05, side);
    flat(ly, -46, -33, -43.5, -31, 0.05, side);
    flat(ly, -2, -36, 6, -33, 0.05, side);
  }

  // -------------------------------------------------------------- playground
  function buildPlayground(ctx) {
    var ly = ctx.solid, g = ctx.ground, P = L.play, z = L.zones.playground;
    flat(g, z.x0, z.z0, z.x1, z.z1, 0.07, '#D2A878');                        // wood chips
    flat(g, z.x0, z.z0, z.x1, z.z0 + 0.3, 0.1, '#8C6B4A'); flat(g, z.x0, z.z1 - 0.3, z.x1, z.z1, 0.1, '#8C6B4A');
    flat(g, z.x0, z.z0, z.x0 + 0.3, z.z1, 0.1, '#8C6B4A'); flat(g, z.x1 - 0.3, z.z0, z.x1, z.z1, 0.1, '#8C6B4A');
    // slide tower: 4 posts, platform, roof, ladder, slide
    var t = P.tower, red = L.schoolColor;
    [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(function (c) { box(ly, t.x + c[0], 1.4, t.z + c[1], 0.2, 2.8, 0.2, '#3E8EDE'); });
    box(ly, t.x, 1.7, t.z, 2.7, 0.15, 2.7, '#FFD23F');
    box(ly, t.x, 2.8, t.z, 3.0, 0.2, 3.0, red);
    box(ly, t.x, 2.95, t.z, 2.0, 0.2, 2.0, '#FF6B6B');
    box(ly, t.x, 1.1, t.z + 1.2, 2.5, 0.1, 0.1, '#3E8EDE'); box(ly, t.x, 2.2, t.z + 1.2, 2.5, 0.1, 0.1, '#3E8EDE');
    for (var i = 0; i < 5; i++) box(ly, t.x - 1.0 + i * 0.5, 0.9 + i * 0.1, t.z - 1.45, 0.45, 0.08, 0.08, '#E8E8E8');
    box(ly, t.x - 1.0, 0.9, t.z - 1.45, 0.08, 1.8, 0.08, '#3E8EDE'); box(ly, t.x + 1.0, 0.9, t.z - 1.45, 0.08, 1.8, 0.08, '#3E8EDE');
    var sl = new THREE.Matrix4().makeRotationZ(-0.62); sl.setPosition(t.x + 3.0, 1.0, t.z);
    box(ly, 0, 0, 0, 3.6, 0.14, 0.9, '#7FDBFF', 0, sl);
    box(ly, 0, 0.18, 0.5, 3.6, 0.2, 0.1, '#3E8EDE', 0, sl); box(ly, 0, 0.18, -0.5, 3.6, 0.2, 0.1, '#3E8EDE', 0, sl);
    // swing set frame (swings themselves animate)
    var sw = P.swings, w2 = sw.w / 2;
    box(ly, sw.x, 3.0, sw.z, sw.w + 0.4, 0.2, 0.2, '#FF8A33');
    [[-w2, -0.9], [-w2, 0.9], [w2, -0.9], [w2, 0.9]].forEach(function (c) {
      var m = new THREE.Matrix4().makeRotationX(c[1] > 0 ? -0.3 : 0.3); m.setPosition(sw.x + c[0], 1.5, sw.z + c[1] * 0.5);
      box(ly, 0, 0, 0, 0.18, 3.2, 0.18, '#FF8A33', 0, m);
    });
    var swingMat = new THREE.Group(); swingMat.position.set(sw.x, 3.0, sw.z);
    [-2.4, 0, 2.4].forEach(function (dx, si) {
      var b = new Layer(1000);
      box(b, -0.25, -2.0, 0, 0.03, 2.0, 0.03, '#444'); box(b, 0.25, -2.0, 0, 0.03, 2.0, 0.03, '#444');
      box(b, 0, -2.45, 0, 0.7, 0.08, 0.3, ['#E03030', '#3E8EDE', '#4CB86B'][si]);
      var ms = b.build(matSolid, true, false, null)[0];
      var pivot = new THREE.Group(); pivot.position.set(dx, 0, 0); pivot.add(ms); ms.matrixAutoUpdate = true;
      swingMat.add(pivot); ctx.dyn.push({ type: 'swing', node: pivot, phase: si * 1.3 });
    });
    ctx.groups.swings = swingMat; ctx.swingGroup = swingMat;
    // climbing dome (half sphere of bars)
    var d = P.dome;
    for (i = 0; i < 6; i++) {
      var m2 = new THREE.Matrix4().makeRotationY(i * Math.PI / 6); m2.setPosition(d.x, 0, d.z);
      prim(ly, G('torus', function () { return new THREE.TorusGeometry(1, 0.04, 5, 16, Math.PI); }), 0, 0, 0, d.r, d.r, d.r, ['#E03030', '#FFD23F', '#3E8EDE'][i % 3], m2);
    }
    for (i = 1; i <= 3; i++) {
      var rr = d.r * Math.cos(i * 0.4), yy = d.r * Math.sin(i * 0.4);
      ring(ly, d.x, d.z, rr - 0.04, rr + 0.04, yy, '#FFD23F', 16);
    }
    ring(ly, d.x, d.z, d.r - 0.05, d.r + 0.05, 0.12, '#3E8EDE', 18);
    // spring riders
    P.riders.forEach(function (r, ri) {
      var c = ['#FF6B6B', '#4FB0F0', '#7BD88F'][ri];
      cyl(ly, r.x, 0.3, r.z, 0.15, 0.15, 0.6, '#888', 6);
      sph(ly, r.x, 0.85, r.z, 0.35, 0.28, 0.6, c); sph(ly, r.x + 0.3, 1.15, r.z, 0.2, 0.2, 0.2, c);
      box(ly, r.x - 0.1, 1.15, r.z, 0.05, 0.05, 0.9, '#444');
    });
    // benches
    P.benches.forEach(function (b) { bench(ly, b.x, b.z, b.rot); });
  }
  function bench(ly, x, z, rot) {           // low: never cut away
    var P = yaw(x, z, rot || 0);
    U.piece('low', function () {
      box(ly, 0, 0.45, 0, 2.0, 0.1, 0.5, '#B7793F', 0, P); box(ly, 0, 0.8, -0.22, 2.0, 0.4, 0.08, '#B7793F', 0, P);
      box(ly, -0.85, 0.22, 0, 0.1, 0.45, 0.45, '#444', 0, P); box(ly, 0.85, 0.22, 0, 0.1, 0.45, 0.45, '#444', 0, P);
    });
  }
  U.bench = bench;

  // ------------------------------------------------------------ field / track
  function buildField(g, ly) {
    var T = L.track, n = 22;
    var outer = stadium(T.cx, T.cz, T.rOut, T.halfStraight, n), mid1 = stadium(T.cx, T.cz, T.rIn + 2, T.halfStraight, n),
      mid2 = stadium(T.cx, T.cz, T.rIn + 4, T.halfStraight, n), inner = stadium(T.cx, T.cz, T.rIn, T.halfStraight, n);
    strip(g, outer, inner, 0.06, '#E2704F');
    strip(g, outer.map(function (p, i) { return [p[0] + (T.cx - p[0]) * 0.012, p[1] + (T.cz - p[1]) * 0.0]; }), outer, 0.07, '#FFFFFF');
    strip(g, mid1.map(function (p, i) { return p; }), mid1.map(function (p) { return [p[0] + (T.cx - p[0]) * 0.01, p[1]]; }), 0.07, '#FFFFFF');
    strip(g, mid2, mid2.map(function (p) { return [p[0] + (T.cx - p[0]) * 0.01, p[1]]; }), 0.07, '#FFFFFF');
    strip(g, inner, inner.map(function (p) { return [p[0] + (T.cx - p[0]) * 0.012, p[1]]; }), 0.07, '#FFFFFF');
    fan(g, T.cx, T.cz, inner, 0.06, '#6FCB5A');
    // mowing stripes on the infield
    for (var z = T.cz - 31; z < T.cz + 31; z += 8) flat(g, T.cx - 20, z, T.cx + 20, z + 4, 0.065, '#66C152');
    // pitch markings
    outline(g, T.cx - 17, T.cz - 31, T.cx + 17, T.cz + 31, 0.08, 0.2, '#FFFFFF');
    flat(g, T.cx - 17, T.cz - 0.1, T.cx + 17, T.cz + 0.1, 0.08, '#FFFFFF'); ring(g, T.cx, T.cz, 4.4, 4.6, 0.085, '#FFFFFF', 24);
    // soccer goals
    L.goals.forEach(function (gl) {
      var P = yaw(gl.x, gl.z, 0), d = gl.dir;
      box(ly, -2.4, 1.1, 0, 0.14, 2.2, 0.14, '#FFFFFF', 0, P); box(ly, 2.4, 1.1, 0, 0.14, 2.2, 0.14, '#FFFFFF', 0, P);
      box(ly, 0, 2.2, 0, 4.9, 0.14, 0.14, '#FFFFFF', 0, P);
      box(ly, 0, 1.1, d * 1.0, 4.8, 2.1, 0.05, '#F2F2F2', 0, P);
      box(ly, -2.4, 1.0, d * 0.5, 0.05, 2.0, 1.0, '#E8E8E8', 0, P); box(ly, 2.4, 1.0, d * 0.5, 0.05, 2.0, 1.0, '#E8E8E8', 0, P);
      L.addBox(gl.x - 2.5, gl.z + (d > 0 ? -0.1 : -1.1), gl.x + 2.5, gl.z + (d > 0 ? 1.1 : 0.1), false);
    });
    // bleacher + bench by the track
    bench(ly, -52, -36, Math.PI / 2); bench(ly, -52, -30, Math.PI / 2);
  }

  // ---------------------------------------------------------------- outdoor court
  function buildCourt(ctx) {
    var g = ctx.ground, ly = ctx.solid, z = L.zones.court;
    flat(g, z.x0, z.z0, z.x1, z.z1, 0.07, '#4A78C8');
    flat(g, z.x0 + 2, z.z0 + 2, z.x1 - 2, z.z1 - 2, 0.08, '#5E8FD8');
    var x0 = z.x0 + 2, x1 = z.x1 - 2, z0 = z.z0 + 2, z1 = z.z1 - 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L2 = '#FFFFFF';
    outline(g, x0, z0, x1, z1, 0.09, 0.15, L2);
    flat(g, cx - 0.075, z0, cx + 0.075, z1, 0.09, L2); ring(g, cx, cz, 2.25, 2.4, 0.095, L2, 24);
    flat(g, x0, cz - 2.4, x0 + 4.8, cz + 2.4, 0.085, '#E2704F'); flat(g, x1 - 4.8, cz - 2.4, x1, cz + 2.4, 0.085, '#E2704F');
    outline(g, x0, cz - 2.4, x0 + 4.8, cz + 2.4, 0.095, 0.12, L2); outline(g, x1 - 4.8, cz - 2.4, x1, cz + 2.4, 0.095, 0.12, L2);
    L.courtHoops.forEach(function (h) {
      var P = yaw(h.x, h.z, 0), d = h.dir;
      box(ly, -d * 0.4, 1.7, 0, 0.14, 3.4, 0.14, '#555B66', 0, P);
      box(ly, 0, 3.0, 0, 0.1, 1.0, 1.7, '#FFFFFF', 0, P);
      box(ly, d * 0.2, 2.7, 0, 0.6, 0.06, 0.08, '#FF6B6B', 0, P);
      torus(ly, d * 0.45, 2.9, 0, 0.3, 0.08, '#FF6B6B', P, Math.PI / 2, 0, 0);
    });
    // tetherball poles
    L.tetherballs.forEach(function (t, i) {
      cyl(ly, t.x, 1.5, t.z, 0.06, 0.06, 3.0, i ? '#E03030' : '#FFFFFF', 6);
      cyl(ly, t.x, 0.15, t.z, 0.25, 0.25, 0.3, '#444', 8);
      box(ly, t.x + 0.45, 2.55, t.z, 0.9, 0.02, 0.02, '#EEE'); sph(ly, t.x + 0.9, 1.6, t.z, 0.18, 0.18, 0.18, '#FFD23F', null, 8);
      box(ly, t.x + 0.9, 2.1, t.z, 0.02, 1.0, 0.02, '#EEE');
      flat(ctx.ground, t.x - 2, t.z - 2, t.x + 2, t.z + 2, 0.07, '#9FA6B3');
      ring(ctx.ground, t.x, t.z, 1.9, 2.0, 0.085, '#FFFFFF', 20);
    });
  }

  // ------------------------------------------------------------------- garden
  function buildGarden(ctx) {
    var ly = ctx.solid, g = ctx.ground, z = L.zones.garden;
    flat(g, z.x0, z.z0, z.x1, z.z1, 0.07, '#D9C29A');
    var rng = L.rng(9), cols = ['#FF6B6B', '#FFD23F', '#FF9FD2', '#B590F0', '#FFFFFF', '#FF9F5A'];
    L.gardenBeds.forEach(function (b) {
      box(ly, b.x, 0.3, b.z, b.w, 0.6, b.d, '#9A6A3A'); box(ly, b.x, 0.58, b.z, b.w - 0.3, 0.1, b.d - 0.3, '#5A3A22');
      for (var i = 0; i < 14; i++) {
        var px = b.x + (rng() - 0.5) * (b.w - 0.8), pz = b.z + (rng() - 0.5) * (b.d - 0.7), c = cols[Math.floor(rng() * cols.length)];
        cyl(ly, px, 0.85, pz, 0.025, 0.025, 0.5, '#3E9B3E', 4);
        sph(ly, px, 1.15, pz, 0.15, 0.15, 0.15, c, null, 6);
      }
    });
    // little shed + watering can
    box(ly, z.x1 - 1.5, 1.2, z.z0 + 1.2, 2.4, 2.4, 1.8, '#C97B4A'); box(ly, z.x1 - 1.5, 2.55, z.z0 + 1.2, 2.8, 0.3, 2.2, L.schoolColor);
    L.addBox(z.x1 - 2.7, z.z0 + 0.3, z.x1 - 0.3, z.z0 + 2.1, false);
  }

  // ------------------------------------------------------------------ pavilion
  function buildPavilion(ctx) {
    var ly = ctx.solid, g = ctx.ground, z = L.zones.pavilion;
    flat(g, z.x0, z.z0, z.x1, z.z1, 0.07, '#CFC8B8');
    [[z.x0 + 0.2, z.z0 + 0.2], [z.x1 - 0.2, z.z0 + 0.2], [z.x0 + 0.2, z.z1 - 0.2], [z.x1 - 0.2, z.z1 - 0.2]].forEach(function (p) {
      box(ly, p[0], 1.6, p[1], 0.35, 3.2, 0.35, '#F2F2F2');
    });
    var cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
    box(ly, cx, 3.25, cz, z.x1 - z.x0 + 0.6, 0.25, z.z1 - z.z0 + 0.6, '#F2F2F2');
    prim(ly, G('pyr', function () { return new THREE.ConeGeometry(1, 1, 4); }), cx, 4.2, cz, (z.x1 - z.x0 + 1.2) * 0.72, 1.7, (z.z1 - z.z0 + 1.2) * 0.72, L.schoolColor, null, 0, Math.PI / 4, 0);
    L.picnicTables.forEach(function (t) { picnic(ly, t.x, t.z, t.rot || 0); });
  }

  // ------------------------------------------------------------------ parking
  function buildParking(ctx) {
    var g = ctx.ground, ly = ctx.solid, pk = L.parking;
    poly(g, L.parkingPoly, 0.05, '#5C616D');
    pk.stalls.forEach(function (s) { // paint a stall separator on the +Z edge of each stall
      flat(g, s.x0 + 0.2, s.z - 1.4, s.x0 + 5.3, s.z - 1.3, 0.08, '#F6F2E4');
    });
    var lastRow = {};
    pk.stalls.forEach(function (s) { flat(g, s.x0 + 0.2, s.z + 1.3, s.x0 + 5.3, s.z + 1.4, 0.08, '#F6F2E4'); });
    pk.cars.forEach(function (c) { carBody(ly, c.x, c.z, c.rot, c.color); });
    // lamp posts
    [[90, -50], [90, -10], [112, -50], [112, -10], [101, -25]].forEach(function (p) {
      cyl(ly, p[0], 3, p[1], 0.08, 0.08, 6, '#4A4F5B', 6); box(ly, p[0], 6.1, p[1], 0.9, 0.18, 0.4, '#FFE9A0');
      L.addCircle(p[0], p[1], 0.2, false);
    });
  }

  // ------------------------------------------------------------- front of campus
  function buildFront(ctx) {
    var ly = ctx.solid, g = ctx.ground;
    L.buses.forEach(function (b) { bus(ly, b); });
    // school sign on the lawn
    var sg = L.sign;
    var tex = canvasTex(1024, 300, function (c, w, h) {
      c.fillStyle = L.schoolColor; roundRect(c, 0, 0, w, h, 36); c.fill();
      c.lineWidth = 10; c.strokeStyle = '#fff'; roundRect(c, 12, 12, w - 24, h - 24, 28); c.stroke();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      var s = fitText(c, 'MAPLE STAR', w - 100, 130); c.font = '800 ' + s + 'px "Trebuchet MS", system-ui, sans-serif'; c.fillText('MAPLE STAR', w / 2, h * 0.36);
      s = fitText(c, 'ELEMENTARY', w - 100, 110); c.fillText('ELEMENTARY', w / 2, h * 0.72);
    });
    var sm = U.cutPatch(new THREE.MeshBasicMaterial({ map: tex }));
    var plane = new THREE.PlaneGeometry(sg.w - 0.4, sg.h - 0.4);
    var pf = new THREE.Mesh(plane, sm); pf.position.set(sg.x, 1.9, sg.z + 0.27); ctx.extra.push(pf);
    var pb = new THREE.Mesh(plane, sm); pb.position.set(sg.x, 1.9, sg.z - 0.27); pb.rotation.y = Math.PI;
    ctx.extra.push(pb);
    box(ly, sg.x, 1.9, sg.z, sg.w, sg.h, 0.5, '#F5F0E6');
    box(ly, sg.x, 0.4, sg.z, sg.w + 0.6, 0.8, 0.9, '#B5654A');
    for (var i = 0; i < 8; i++) for (var j = 0; j < 3; j++) box(ly, sg.x - sg.w / 2 + 0.3 + i * (sg.w / 7.6), 0.15 + j * 0.28, sg.z + 0.46, 0.8, 0.02, 0.02, '#9A4F38');
    // flagpole
    var f = L.flag;
    cyl(ly, f.x, 4.6, f.z, 0.09, 0.09, 9.2, '#E8E8E8', 6); sph(ly, f.x, 9.3, f.z, 0.2, 0.2, 0.2, '#FFD23F', null, 6);
    box(ly, f.x + 1.5, 8.0, f.z, 3.0, 1.7, 0.05, L.schoolColor); box(ly, f.x + 1.5, 8.0, f.z, 3.02, 0.32, 0.07, '#FFFFFF');
    sph(ly, f.x + 0.6, 8.0, f.z, 0.34, 0.34, 0.1, '#FFFFFF', null, 6);
    cyl(ly, f.x, 0.1, f.z, 0.7, 0.7, 0.2, '#B8B3A6', 10);
    // bike rack, benches by walkway
    bench(ly, 2.5, 50, Math.PI / 2); bench(ly, 13.5, 50, -Math.PI / 2);
    L.addBox(1.9, 49, 3.1, 51, false); L.addBox(12.9, 49, 14.1, 51, false);
    // bushes (foundation planting + lawn)
    var greens = ['#58B848', '#4CAE44', '#66C554', '#3F9E48'];
    L.bushes.forEach(function (b) {
      var c = greens[Math.floor(b.hue * greens.length)];
      sph(ly, b.x, 0.5 * b.s, b.z, 0.8 * b.s, 0.6 * b.s, 0.8 * b.s, c, null, 7);
      sph(ly, b.x + 0.5 * b.s, 0.4 * b.s, b.z + 0.2, 0.55 * b.s, 0.45 * b.s, 0.55 * b.s, greens[(Math.floor(b.hue * 7)) % 4], null, 6);
    });
  }

  // -------------------------------------------------------------------- trees
  function buildTrees(ly) {
    var greens = ['#5DBB4A', '#4FAE49', '#6CC95A', '#47A857'], pines = ['#2F8F5B', '#37A06A'];
    L.trees.forEach(function (t) {
      var s = t.s;
      cyl(ly, t.x, 1.1 * s, t.z, 0.22 * s, 0.34 * s, 2.2 * s, '#8A5A3B', 7);
      if (t.kind === 0) {
        var c = greens[Math.floor(t.hue * 4)];
        sph(ly, t.x, 3.4 * s, t.z, 1.9 * s, 1.6 * s, 1.9 * s, c, null, 8);
        sph(ly, t.x + 1.0 * s, 2.9 * s, t.z + 0.4 * s, 1.3 * s, 1.1 * s, 1.3 * s, greens[(Math.floor(t.hue * 9) + 1) % 4], null, 7);
        sph(ly, t.x - 0.9 * s, 3.0 * s, t.z - 0.5 * s, 1.2 * s, 1.0 * s, 1.2 * s, greens[(Math.floor(t.hue * 13) + 2) % 4], null, 7);
      } else {
        for (var i = 0; i < 3; i++) prim(ly, G('cone8', function () { return new THREE.ConeGeometry(1, 1, 8); }),
          t.x, (2.6 + i * 1.3) * s, t.z, (2.0 - i * 0.55) * s, 1.9 * s, (2.0 - i * 0.55) * s, pines[i % 2]);
      }
    });
  }

  // -------------------------------------------------------------------- fence
  function buildFence(ly) {
    L.fence.forEach(function (e) {
      var dx = e[2] - e[0], dz = e[3] - e[1], len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 3)), ang = Math.atan2(dx, dz);
      for (var i = 0; i <= n; i++) {
        var x = e[0] + dx * i / n, z = e[1] + dz * i / n;
        box(ly, x, 0.7, z, 0.16, 1.4, 0.16, '#F2EFE6');
      }
      // two rails as long thin boxes along the edge
      var mx = (e[0] + e[2]) / 2, mz = (e[1] + e[3]) / 2;
      box(ly, mx, 0.5, mz, 0.07, 0.1, len, '#E5E0D3', ang); box(ly, mx, 1.1, mz, 0.07, 0.1, len, '#E5E0D3', ang);
    });
  }

  // ------------------------------------------------------------------- houses
  function buildHouses(ly) {
    var walls = ['#FFE1A8', '#FFC9C9', '#C9E8FF', '#D6F5C8', '#F5D6FF', '#FFE8D1', '#FFF3B0', '#CFE3FF'];
    var roofs = ['#C65A3C', '#7C8798', '#8E5B8A', '#4F7CB8', '#9C6B3F'];
    L.houses.forEach(function (h, hi) {
      var pts = h.pts, n = pts.length, area = 0, cx = 0, cz = 0, i;
      for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; cx += a[0]; cz += a[1]; }
      cx /= n; cz /= n; var ccw = area > 0;
      var wallH = h.height * 0.62, roofH = h.height * 0.38, wc = C(walls[hi % walls.length]), rc = C(roofs[(hi * 3) % roofs.length]);
      var bt = ly.at(cx, cz);
      for (i = 0; i < n; i++) {
        var p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1];
        var nrm = ccw ? [dz, 0, -dx] : [-dz, 0, dx];
        var A = [p[0], 0, p[1]], B = [q[0], 0, q[1]], Cc = [q[0], wallH, q[1]], D = [p[0], wallH, p[1]];
        bt.tri(A, B, Cc, wc, nrm); bt.tri(A, Cc, D, wc, nrm);
      }
      // hip-ish roof: every edge rises (with a little overhang) to the centroid peak
      var over = pts.map(function (p) { var vx = p[0] - cx, vz = p[1] - cz, l = Math.hypot(vx, vz) || 1; return [p[0] + vx / l * 0.7, p[1] + vz / l * 0.7]; });
      for (i = 0; i < n; i++) {
        var o1 = over[i], o2 = over[(i + 1) % n];
        bt.tri([o1[0], wallH - 0.2, o1[1]], [o2[0], wallH - 0.2, o2[1]], [cx, wallH + roofH, cz], i % 2 ? rc : C(roofs[(hi * 3) % roofs.length]), [(o1[0] + o2[0]) / 2 - cx, 0.6, (o1[1] + o2[1]) / 2 - cz]);
      }
      // simple door + window blobs on the first edge
      var e0 = pts[0], e1 = pts[1], mx = (e0[0] + e1[0]) / 2, mz = (e0[1] + e1[1]) / 2;
      box(ly, mx, 1.0, mz, 0.1, 2.0, 1.0, '#8A5A3B', Math.atan2(e1[0] - e0[0], e1[1] - e0[1]));
    });
  }

  // --------------------------------------------------------------------- sky
  function buildSky(scene) {
    var g = new THREE.SphereGeometry(1500, 24, 14), cols = [], pos = g.attributes.position;
    var top = C('#4FA3F0'), hor = C('#CDEBFF'), tmp = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var t = Math.max(0, pos.getY(i) / 1500); t = Math.pow(t, 0.6);
      tmp.copy(hor).lerp(top, Math.min(1, t * 1.15)); cols.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    var sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky); W.sky = sky;
    // sun disc
    var sun = new THREE.Mesh(new THREE.SphereGeometry(40, 12, 8), new THREE.MeshBasicMaterial({ color: 0xFFF2B0, fog: false }));
    sun.position.copy(W.sunDir).multiplyScalar(1300); sky.add(sun);
    // clouds: one merged mesh tiled three times, drifting along +X
    var ly = new Layer(100000), rng = L.rng(5);
    for (var k = 0; k < 14; k++) {
      var cx = -200 + rng() * 400, cz = -500 + rng() * 900, cy = 150 + rng() * 60, sc = 18 + rng() * 22;
      for (var j = 0; j < 5; j++) {
        sph(ly, cx + (j - 2) * sc * 0.55, cy + (j % 2) * sc * 0.15, cz + (rng() - 0.5) * sc * 0.4, sc * (0.5 + rng() * 0.3), sc * 0.35, sc * 0.5, j % 2 ? '#FFFFFF' : '#F1F7FF', null, 7);
      }
    }
    var cloudGroup = new THREE.Group();
    var base = ly.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), false, false, null)[0];
    for (var tt = -1; tt <= 1; tt++) { var m = base.clone(); m.position.x = tt * 400; m.matrixAutoUpdate = true; m.frustumCulled = false; cloudGroup.add(m); }
    scene.add(cloudGroup); ctx_clouds = cloudGroup;
  }
  var ctx_clouds = null;

  // ------------------------------------------------------ cars on the boulevard
  var movingCars = [];
  function buildMovingCars(scene) {
    var cols = ['#E24B4B', '#3E8EDE', '#F2C230', '#4CB86B', '#9A6CEA', '#FF8A33', '#FFFFFF', '#35B8C8'];
    for (var i = 0; i < 8; i++) {
      var ly = new Layer(100000); carBody(ly, 0, 0, 0, cols[i]);
      var mesh = ly.build(matSolid, true, false, null)[0]; mesh.matrixAutoUpdate = true;
      var dir = i % 2 ? 1 : -1, lane = i % 2 ? 93 : 89, lane2 = i % 2 ? 105 : 101;
      var z = (i < 4 ? lane : lane2);
      mesh.position.set(-250 + i * 70, 0, z); mesh.rotation.y = dir > 0 ? 0 : Math.PI;
      mesh.frustumCulled = true;
      scene.add(mesh);
      movingCars.push({ mesh: mesh, dir: dir, speed: 4 + (i % 3) * 1.5, z: z });
    }
  }

  // ------------------------------------------------------------------ per-frame
  var swingT = 0;
  W.update = function (dt, camera, player) {
    swingT += dt;
    var ctx = W.ctx;
    ctx.dyn.forEach(function (d) { if (d.type === 'swing') d.node.rotation.x = Math.sin(swingT * 1.6 + d.phase) * 0.45; });
    if (ctx_clouds) ctx_clouds.position.x = (swingT * 1.5) % 400;
    if (W.sky) W.sky.position.copy(camera.position);
    movingCars.forEach(function (c) {
      var m = c.mesh, sp = c.speed;
      // brake for the player standing in front of the car
      if (player) {
        var ax = (player.x - m.position.x) * c.dir, az = Math.abs(player.z - m.position.z);
        if (ax > 0 && ax < 10 && az < 2.5) sp = 0;
      }
      m.position.x += c.dir * sp * dt;
      if (m.position.x > 330) m.position.x = -330; else if (m.position.x < -330) m.position.x = 330;
    });
  };
})();
