/*
 * hud.js - DOM HUD: place name, clock + period, minimap / big map, help panel,
 * talk prompt + speech bubble, touch joystick visuals.
 */
(function () {
  'use strict';
  var S = window.CAMPUS, L = S.layout;
  var H = S.hud = { big: false };
  var el = {}, last = { place: '', clock: '', period: '', fast: null, prompt: '' }, mapStatic = null, mapKey = '', lastMap = 0, bubbleNpc = null, bubbleUntil = 0, toastUntil = 0;
  var MAP = { x0: -150, x1: 165, z0: -135, z1: 112 };

  function $(id) { return document.getElementById(id); }
  H.init = function () {
    ['place', 'clock', 'period', 'speedTag', 'minimap', 'mapCanvas', 'mapHint', 'help', 'helpClose', 'talkPrompt', 'bubble', 'toast', 'joy', 'joyKnob', 'overlay', 'startBtn', 'loadMsg']
      .forEach(function (id) { el[id] = $(id); });
    el.ctx = el.mapCanvas.getContext('2d');
    el.helpClose.addEventListener('click', function () { H.toggleHelp(false); });
    el.minimap.addEventListener('click', function () { H.toggleMap(); });
    sizeMap();
    window.addEventListener('resize', sizeMap);
  };
  H.isHelpOpen = function () { return !el.help.hidden; };
  H.toggleHelp = function (on) { el.help.hidden = on === undefined ? !el.help.hidden : !on; if (!el.help.hidden) el.helpClose.focus(); };
  H.toggleMap = function (on) {
    H.big = on === undefined ? !H.big : on; el.minimap.classList.toggle('big', H.big);
    el.mapHint.textContent = H.big ? 'M or click: close map' : 'M: big map'; sizeMap(); lastMap = 0;
  };
  H.toast = function (text, sec) { el.toast.textContent = text; el.toast.hidden = false; toastUntil = performance.now() + (sec || 2.4) * 1000; };
  H.joy = function (on, ox, oy, jx, jz) {
    el.joy.hidden = !on; if (!on) return;
    el.joy.style.left = ox + 'px'; el.joy.style.top = oy + 'px';
    el.joyKnob.style.transform = 'translate(' + (jx * 40) + 'px,' + (jz * 40) + 'px)';
  };
  H.say = function (npc, text, sec) { bubbleNpc = npc; el.bubble.textContent = text; el.bubble.hidden = false; bubbleUntil = performance.now() + (sec || 3.2) * 1000; };

  // map canvas backing store follows its CSS size
  function sizeMap() {
    var r = el.mapCanvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(100, Math.round(r.width * d)), h = Math.max(80, Math.round(r.height * d));
    if (el.mapCanvas.width !== w || el.mapCanvas.height !== h) { el.mapCanvas.width = w; el.mapCanvas.height = h; mapStatic = null; }
  }
  // ---- map panels -------------------------------------------------------
  // small map: one campus panel showing the floor plan of the player's level.
  // big map: campus + 1st floor plan, and a zoomed 2nd floor plan beside (or below) it.
  var F2 = { x0: -58, x1: 26, z0: -32, z1: 16 };
  function panels(w, h, big, level) {
    function P(x, y, pw, ph, world, lv, fit) {
      var sx = pw / (world.x1 - world.x0), sz = ph / (world.z1 - world.z0), ox = x, oz = y;
      if (fit) { sx = sz = Math.min(sx, sz) * 0.92; ox = x + (pw - sx * (world.x1 - world.x0)) / 2; oz = y + (ph - sz * (world.z1 - world.z0)) / 2 + ph * 0.03; }
      return { x: x, y: y, w: pw, h: ph, level: lv, zoom: !!fit, X: function (v) { return ox + (v - world.x0) * sx; }, Z: function (v) { return oz + (v - world.z0) * sz; } };
    }
    if (!big) return [P(0, 0, w, h, MAP, level)];
    if (w / h > 1.5) { var lw = Math.round(h * 1.276); return [P(0, 0, lw, h, MAP, 0), P(lw, 0, w - lw, h, F2, 1, true)]; }
    var th = Math.round(w / 1.276); return [P(0, 0, w, th, MAP, 0), P(0, th, w, h - th, F2, 1, true)];
  }
  function roomLabel(r) {
    var short = ['PK', 'K', '1', '2', '3', '4', '5'];
    if (r.type === 'hall' && r.id.indexOf('wing') === 0) return '';
    if (r.grade >= 0 && r.sec) return short[r.grade] + r.sec;
    return { stem: 'STEM', computer: 'Comp', resource: 'Resource', lounge: 'Lounge', counselor: 'Counsel', hall: 'Main Hallway', uphall: 'Upper Hallway', sidehall: '', office: 'Office', stairW: 'Stairs', stairE: 'Stairs' }[r.id] !== undefined
      ? { stem: 'STEM', computer: 'Comp', resource: 'Resource', lounge: 'Lounge', counselor: 'Counsel', hall: 'Main Hallway', uphall: 'Upper Hallway', sidehall: '', office: 'Office', stairW: 'Stairs', stairE: 'Stairs' }[r.id] : r.name;
  }

  // static map layer (cached): terrain, zones, building rooms of the panel's level
  function drawStatic(w, h, big, level) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var c = cv.getContext('2d');
    panels(w, h, big, level).forEach(function (p) {
      var X = p.X, Z = p.Z;
      function rect(x0, z0, x1, z1, fill, stroke) { c.fillStyle = fill; c.fillRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0)); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0)); } }
      function polyPath(pts) { c.beginPath(); pts.forEach(function (q, i) { if (i) c.lineTo(X(q[0]), Z(q[1])); else c.moveTo(X(q[0]), Z(q[1])); }); c.closePath(); }
      c.save(); c.beginPath(); c.rect(p.x, p.y, p.w, p.h); c.clip();
      var fs = Math.max(8, Math.round((big ? p.h * 1.276 : w) / 90));
      if (p.zoom) { c.fillStyle = '#EEF3F8'; c.fillRect(p.x, p.y, p.w, p.h); }
      else {
        c.fillStyle = '#A7DD86'; c.fillRect(p.x, p.y, p.w, p.h);
        polyPath(S.site.grounds); c.fillStyle = '#C6EFA6'; c.fill(); c.strokeStyle = '#6FA84F'; c.lineWidth = 1.5; c.stroke();
        rect(-150, 87, 165, 107, '#8E94A2'); rect(-150, 95, 165, 99, '#9ADB7A');           // boulevard
        rect(-54, 99, -40, 112, '#8E94A2');
        rect(L.driveStrip.x0, L.driveStrip.z0, L.driveStrip.x1, L.driveStrip.z1, '#A8AEBB');
        rect(-64, 66, -56, 87, '#A8AEBB'); rect(96, 66, 104, 87, '#A8AEBB'); rect(96, 7, 104, 58, '#A8AEBB');
        polyPath(L.parkingPoly); c.fillStyle = '#9CA3B2'; c.fill();
        var T = L.track, pts = [], i, a, sgn;                                                // running track
        for (i = 0; i <= 48; i++) { a = i / 48 * Math.PI * 2; sgn = Math.sin(a) >= 0 ? 1 : -1; pts.push([T.cx + Math.cos(a) * T.rOut, T.cz + sgn * T.halfStraight + Math.sin(a) * T.rOut]); }
        polyPath(pts); c.fillStyle = '#E8836A'; c.fill();
        pts = []; for (i = 0; i <= 48; i++) { a = i / 48 * Math.PI * 2; sgn = Math.sin(a) >= 0 ? 1 : -1; pts.push([T.cx + Math.cos(a) * T.rIn, T.cz + sgn * T.halfStraight + Math.sin(a) * T.rIn]); }
        polyPath(pts); c.fillStyle = '#7BCB63'; c.fill();
        var z = L.zones;
        rect(z.playground.x0, z.playground.z0, z.playground.x1, z.playground.z1, '#E2BE8E', '#B58F5C');
        rect(z.court.x0, z.court.z0, z.court.x1, z.court.z1, '#6F9BE0', '#3E66B0');
        rect(z.garden.x0, z.garden.z0, z.garden.x1, z.garden.z1, '#E2D0A8', '#B59E70');
        rect(z.pavilion.x0, z.pavilion.z0, z.pavilion.x1, z.pavilion.z1, '#D8D2C2', '#9A9482');
        rect(z.courtyard.x0, z.courtyard.z0, z.courtyard.x1, z.courtyard.z1, '#E9E1D0', '#B8AE98');
      }
      // building: ground footprint in grey under the second-floor plan
      if (p.level === 1 && !p.zoom) L.rooms.forEach(function (r) { if (r.level !== 1) rect(r.x0, r.z0, r.x1, r.z1, '#D5D8DE'); });
      L.rooms.forEach(function (r) { if (r.level === p.level || r.level === 2) rect(r.x0, r.z0, r.x1, r.z1, r.floor, 'rgba(60,60,80,.45)'); });
      // floor tag
      c.font = '800 ' + (fs + (big ? 3 : 1)) + 'px "Trebuchet MS", system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
      var tag = p.level ? 'Floor 2' : 'Floor 1', tw = c.measureText(tag).width;
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(p.x + 4, p.y + 4, tw + 10, fs + 9); c.fillStyle = L.schoolColor; c.fillText(tag, p.x + 9, p.y + 7);
      if (big) {
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1f2a44';
        var rs = p.zoom ? Math.max(9, Math.round(p.w / 46)) : fs;
        L.rooms.forEach(function (r) {
          if (r.level !== p.level && r.level !== 2) return;
          var t = roomLabel(r); if (!t) return;
          c.font = '700 ' + (r.type === 'class' ? rs - 1 : rs) + 'px "Trebuchet MS", system-ui, sans-serif'; c.fillText(t, X(r.cx), Z(r.cz));
        });
        if (!p.zoom) {
          c.font = '800 ' + (fs + 2) + 'px "Trebuchet MS", system-ui, sans-serif'; c.fillStyle = '#16345e';
          [['Playground', -10, -55], ['Sports Field', -90, -35], ['Basketball', 34, -51], ['Garden', 69, -17.5], ['Pavilion', -48, -46], ['Parking', 100, -30], ['Courtyard', 34, -12],
            ['Drop-off Lane', 20, 62], ['Maple Boulevard', 20, 97], ['Star Lane', -47, 109], ['Front Lawn', 8, 50]].forEach(function (q) { c.fillText(q[0], X(q[1]), Z(q[2])); });
          c.fillStyle = L.schoolColor; c.fillText('MAPLE STAR ELEMENTARY', X(8), Z(46));
        } else {
          c.font = '800 ' + (rs + 3) + 'px "Trebuchet MS", system-ui, sans-serif'; c.fillStyle = '#16345e';
          c.fillText('Second floor: grades 3-5, Art, STEM, Computer Lab', p.x + p.w / 2, Z(F2.z1) + rs * 0.2);
          c.strokeStyle = 'rgba(31,42,68,.25)'; c.lineWidth = 2; c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        }
      }
      c.restore();
    });
    return cv;
  }

  function drawMap(player, npcs) {
    var cv = el.mapCanvas, w = cv.width, h = cv.height, c = el.ctx, lvl = (player.inside && player.level) ? 1 : 0, key = w + 'x' + h + H.big + lvl;
    if (!mapStatic || mapKey !== key) { mapStatic = drawStatic(w, h, H.big, lvl); mapKey = key; }
    c.drawImage(mapStatic, 0, 0);
    var me = S.people.player(), ps = panels(w, h, H.big, lvl);
    for (var k = 0; k < ps.length; k++) {
      var p = ps[k], r = Math.max(1.5, (p.zoom ? 2.2 : 1) * w / (H.big ? 300 : 110));
      for (var i = 0; i < npcs.length; i++) {
        var n = npcs[i]; if (n.hidden || n === me || n.level !== p.level) continue;
        c.fillStyle = n.kind === 'staff' ? '#2D5BD6' : '#F2A60C';
        c.fillRect(p.X(n.x) - r / 2, p.Z(n.z) - r / 2, r, r);
      }
      if (p.level !== lvl) continue;
      // player arrow (forward = avatar heading)
      var s = Math.max(5, w / (H.big ? 110 : 32)), a = player.heading;
      c.save(); c.translate(p.X(player.x), p.Z(player.z)); c.rotate(-a + Math.PI); // heading 0 = +Z = map down
      c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.7, s * 0.8); c.lineTo(0, s * 0.35); c.lineTo(-s * 0.7, s * 0.8); c.closePath();
      c.fillStyle = L.schoolColor; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    }
  }

  // called each frame
  H.update = function (info) {
    var now = performance.now(), pl = info.player, P = S.people;
    var ct = P.fmtTime(), pn = P.blockName();                  // only touch the DOM when a value changed
    if (info.place !== last.place) el.place.textContent = last.place = info.place;
    if (ct !== last.clock) el.clock.textContent = last.clock = ct;
    if (pn !== last.period) el.period.textContent = last.period = pn;
    if (P.clock.fast !== last.fast) { el.speedTag.hidden = !P.clock.fast; last.fast = P.clock.fast; }
    if (now - lastMap > (H.big ? 250 : 120)) { lastMap = now; drawMap(pl, P.list); }
    if (el.toast.hidden === false && now > toastUntil) el.toast.hidden = true;
    // talk prompt
    var near = info.nearNpc;
    var want = (near && !bubbleNpc) ? 'Press F to talk to ' + near.name : '';
    if (want !== last.prompt) { last.prompt = want; el.talkPrompt.hidden = !want; if (want) el.talkPrompt.textContent = want; }
    // speech bubble follows its speaker
    if (bubbleNpc) {
      if (now > bubbleUntil || bubbleNpc.hidden) { bubbleNpc = null; el.bubble.hidden = true; }
      else {
        var v = info.project(bubbleNpc.x, bubbleNpc.y + bubbleNpc.s * 1.35, bubbleNpc.z);
        if (v) { el.bubble.style.left = v.x + 'px'; el.bubble.style.top = v.y + 'px'; el.bubble.style.visibility = 'visible'; } else el.bubble.style.visibility = 'hidden';
      }
    }
  };
})();
