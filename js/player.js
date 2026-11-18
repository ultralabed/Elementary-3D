/*
 * player.js - input, the player's movement + collision, and the follow camera.
 *
 * Look control is mouse-drag (no pointer lock needed), Q/E or arrow-left/right.
 * Move with W/A/S/D or arrow up/down (relative to the camera), Shift runs.
 * A tiny touch fallback is included: left-half joystick, right-half drag to look.
 */
(function () {
  'use strict';
  if (!window.THREE) return;     // engine failed to load: main.js shows a message
  var S = window.CAMPUS, L = S.layout, THREE = window.THREE;
  var Pl = S.player = {
    x: 8, z: 54, y: 0, level: 0, heading: Math.PI, yaw: 0, pitch: 0.52, dist: 7.5, fp: false, inside: false,
    moving: false, running: false, speed: 0, phase: 0, camDist: 7.5, hideAvatar: false, enabled: false, on: {}
  };
  var RADIUS = 0.35, WALK = 4, RUN = 8, EYE = 1.12;
  var lastWheel = -1e9, ZOOM_LEAD = 3, ZOOM_SPEED = 3;      // target may lead by 3 m; camera moves at most 3 m/s
  var ZOOM_MIN = 3, ZOOM_MAX = 16, ZOOM_NOTCH = 0.6;      // metres; one wheel notch = 0.6 m
  var keys = {}, joy = { x: 0, z: 0, id: null, ox: 0, oy: 0 }, drag = { id: null, x: 0, y: 0 };

  var MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, KeyQ: 1, KeyE: 1, ShiftLeft: 1, ShiftRight: 1 };

  Pl.clearKeys = function () { keys = {}; joy.x = joy.z = 0; };
  Pl.init = function (canvas) {
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var c = e.code, t = e.target;
      if (c === 'Escape') { if (Pl.on.escape) Pl.on.escape(); return; }
      var blocked = Pl.on.blocked ? Pl.on.blocked() : false;          // 'overlay' | 'help' | false
      if (c === 'KeyH') { if (Pl.enabled && Pl.on.help) Pl.on.help(); return; }
      // game keys never act on buttons / the overlay / the help panel, nor while those are open
      var inUI = t && t !== document.body && (/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t.closest && t.closest('#overlay, #help')));
      if (!Pl.enabled || blocked || inUI) return;
      if (MOVE_KEYS[c]) { keys[c] = true; e.preventDefault(); return; }
      if (e.repeat) return;
      if (c === 'KeyV') Pl.fp = !Pl.fp;
      else if (c === 'KeyM' && Pl.on.map) Pl.on.map();
      else if (c === 'KeyF' && Pl.on.talk) Pl.on.talk();
      else if (c === 'KeyT' && Pl.on.fast) Pl.on.fast();
      else if (c === 'KeyN' && Pl.on.mute) Pl.on.mute();
    });
    window.addEventListener('keyup', function (e) { if (MOVE_KEYS[e.code]) { keys[e.code] = false; } });
    window.addEventListener('blur', function () { keys = {}; });
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45 && joy.id === null) {
        joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.z = 0;
        if (Pl.on.joy) Pl.on.joy(true, e.clientX, e.clientY, 0, 0);
      } else if (drag.id === null) { drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerId === joy.id) {
        var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, l = Math.hypot(dx, dy), m = Math.min(1, l / 55);
        joy.x = l > 4 ? dx / l * m : 0; joy.z = l > 4 ? dy / l * m : 0;
        if (Pl.on.joy) Pl.on.joy(true, joy.ox, joy.oy, joy.x, joy.z);
      } else if (e.pointerId === drag.id) {
        var ddx = e.clientX - drag.x, ddy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        Pl.yaw += ddx * 0.0055; Pl.pitch = clamp(Pl.pitch + ddy * 0.0045, Pl.fp ? -1.3 : 0.03, Pl.fp ? 1.3 : 1.3);
      }
    });
    function up(e) {
      if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.z = 0; if (Pl.on.joy) Pl.on.joy(false); }
      if (e.pointerId === drag.id) drag.id = null;
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      // Wheel input accumulates into a target distance (Pl.dist); the camera then eases to it at
      // no more than 3 m/s.  One notch (|deltaY| >= 50 px, or a line-mode tick) is 0.6 m, smaller
      // trackpad deltas count proportionally, and an isolated tiny delta (Mac mouse wheels send
      // about 4 px) still counts as a third of a notch.  The target may lead the camera by at
      // most 3 m, so a long trackpad flick cannot run through the whole range.
      var now = performance.now(), gap = now - lastWheel; lastWheel = now;
      var px = e.deltaMode === 1 ? e.deltaY * 33 : (e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY);
      var step = Math.abs(px) >= 50 ? Math.sign(px) : px / 100;
      if (gap > 150 && px !== 0 && Math.abs(px) < 30) step = Math.sign(px) * Math.max(Math.abs(step), 1 / 3);
      Pl.dist = clamp(Pl.dist + step * ZOOM_NOTCH, Math.max(ZOOM_MIN, Pl.camDist - ZOOM_LEAD), Math.min(ZOOM_MAX, Pl.camDist + ZOOM_LEAD));
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Put the player somewhere (pushed out of anything solid).
  Pl.teleport = function (x, z, level) {
    Pl.level = level ? 1 : 0;
    var r = L.resolve(x, z, RADIUS, false, Pl.level); Pl.x = r.x; Pl.z = r.z; L.surface(Pl);
  };

  Pl.update = function (dt) {
    // turning
    var turn = (keys.KeyQ || keys.ArrowLeft ? 1 : 0) - (keys.KeyE || keys.ArrowRight ? 1 : 0);
    Pl.yaw += turn * 1.9 * dt;
    // movement relative to the camera
    var fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.z;
    var str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x;
    var fx = -Math.sin(Pl.yaw), fz = -Math.cos(Pl.yaw), rx = -fz, rz = fx;
    var mx = fx * fwd + rx * str, mz = fz * fwd + rz * str, ml = Math.hypot(mx, mz);
    Pl.running = !!(keys.ShiftLeft || keys.ShiftRight) || Math.hypot(joy.x, joy.z) > 0.9;
    if (ml > 0.05) {
      var spd = (Pl.running ? RUN : WALK) * Math.min(1, ml);
      mx /= ml; mz /= ml;
      var total = spd * dt, steps = Math.max(1, Math.ceil(total / 0.1)), sx = mx * total / steps, sz = mz * total / steps;
      var ox = Pl.x, oz = Pl.z;
      for (var i = 0; i < steps; i++) {
        var r = L.resolve(Pl.x + sx, Pl.z + sz, RADIUS, false, Pl.level); Pl.x = r.x; Pl.z = r.z;
        L.surface(Pl);            // floor height; on a stair flight this also switches the level at mid-height
      }
      var moved = Math.hypot(Pl.x - ox, Pl.z - oz);
      Pl.speed = moved / Math.max(dt, 1e-4); Pl.moving = Pl.speed > 0.4;
      // face the direction of travel (smoothly)
      var target = Math.atan2(mx, mz), da = Math.atan2(Math.sin(target - Pl.heading), Math.cos(target - Pl.heading));
      Pl.heading += da * Math.min(1, dt * 12);
      Pl.phase += dt * Pl.speed * 3.6;
    } else { Pl.speed = 0; Pl.moving = false; }
    L.surface(Pl);
    Pl.inside = L.insideBuilding(Pl.x, Pl.z, Pl.level);
    S.people.setPlayer(Pl.x, Pl.z, Pl.heading, Pl.moving, Pl.running ? 1.2 : 0.9, !(Pl.fp || Pl.hideAvatar), Pl.phase, Pl.y, Pl.level);
  };

  var tgt = new THREE.Vector3();
  // Third-person camera at a FIXED distance: walls never shorten it, tilt it or switch the
  // view.  Whatever stands between camera and player is cut away in the shaders instead
  // (see the cutaway patch in world.js).  Only the wheel changes Pl.dist; Pl.camDist eases
  // toward it over about 0.2 s.
  Pl.updateCamera = function (camera, dt) {
    var diff = Pl.dist - Pl.camDist, mv = Math.min(Math.abs(diff), Math.min(ZOOM_SPEED, Math.abs(diff) * 10 + 0.4) * dt);
    Pl.camDist += Math.sign(diff) * mv;
    if (Pl.fp) {
      var ey = Pl.y + EYE + 0.05;
      camera.position.set(Pl.x, ey, Pl.z);
      var fx = -Math.sin(Pl.yaw), fz = -Math.cos(Pl.yaw), p = clamp(Pl.pitch, -1.3, 1.3);
      camera.lookAt(Pl.x + fx * Math.cos(p), ey - Math.sin(p), Pl.z + fz * Math.cos(p));
      return;
    }
    var head = Pl.y + 1.25, cd = Pl.camDist, pitch = clamp(Pl.pitch, 0.03, 1.3);
    camera.position.set(Pl.x + Math.sin(Pl.yaw) * Math.cos(pitch) * cd, Math.max(0.45, head + Math.sin(pitch) * cd), Pl.z + Math.cos(Pl.yaw) * Math.cos(pitch) * cd);
    tgt.set(Pl.x, head - 0.1, Pl.z); camera.lookAt(tgt);
  };
})();
