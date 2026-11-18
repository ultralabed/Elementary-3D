/*
 * main.js - bootstraps the renderer / scene / lights, owns the main loop and
 * exposes the CAMPUS.debug handle used by the automated tests.
 */
(function () {
  'use strict';
  var S = window.CAMPUS, L = S.layout, THREE = window.THREE;
  var started = false, renderer, scene, camera, sun, hemi, clockFps = 0, fpsAvg = 60, last = 0, info = { calls: 0, triangles: 0 };
  var marker = null, P, Pl, H, nearNpc = null, orbitT = 0, tmpV = null, touchTalk = null;
  var SKY = 0xCFE8FA, hudInfo = {};

  function boot() {
    var loadMsg = document.getElementById('loadMsg'), startBtn = document.getElementById('startBtn');
    startBtn.disabled = true;
    if (!window.THREE || !S.world || !S.player || !S.people) {
      loadMsg.textContent = 'The 3D engine could not load. Check your connection and reload.'; loadMsg.style.color = '#b00010'; loadMsg.style.fontWeight = '700';
      return;
    }
    tmpV = new THREE.Vector3();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) { loadMsg.textContent = 'WebGL is not available in this browser.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.id = 'scene';
    document.body.insertBefore(renderer.domElement, document.body.firstChild);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 140, 720);
    camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 2600);

    hemi = new THREE.HemisphereLight(0xE4EEFF, 0x9CB878, 0.55); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xFFF1D0, 0.5);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);

    loadMsg.textContent = 'Building the school...';
    // give the browser a moment to paint the overlay, then build the world
    setTimeout(function () {
      S.world.build(scene);
      S.nav.build();
      P = S.people; Pl = S.player; H = S.hud;
      P.init(scene);
      Pl.init(renderer.domElement);
      H.init();
      Pl.teleport(8, 54); Pl.heading = Math.PI;
      Pl.on.map = function () { H.toggleMap(); };
      Pl.on.help = function () { H.toggleHelp(); Pl.clearKeys(); };
      Pl.on.blocked = function () { return !started ? 'overlay' : (H.isHelpOpen() ? 'help' : false); };
      setupTouchButtons();
      Pl.on.mute = toggleMute;
      Pl.on.fast = function () { P.clock.fast = !P.clock.fast; H.toast(P.clock.fast ? 'Fast time x5' : 'Normal time', 1.4); };
      Pl.on.talk = talk; Pl.on.joy = H.joy;
      Pl.on.escape = function () { if (H.big) H.toggleMap(false); H.toggleHelp(false); Pl.clearKeys(); };
      startBtn.disabled = false; loadMsg.textContent = '';
      startBtn.addEventListener('click', start); startBtn.focus();
      window.addEventListener('keydown', function (e) { if (!started && (e.code === 'Enter')) start(); });
      window.addEventListener('resize', onResize);
      S.checks = { unreachable: S.nav.check().length };
      requestAnimationFrame(frame);
      document.documentElement.setAttribute('data-ready', '1');
    }, 30);
  }

  // Touch devices get two small on-screen buttons: Talk (same as F) and ? (help)
  // On-screen buttons: the speaker (mute) button is always there; Talk (same as F) and ? (help)
  // only on touch devices.  Buttons give the focus back so the keyboard keeps driving the player.
  function toggleMute() { if (!S.audio) return; var m = S.audio.toggleMute(); H.toast(m ? 'Sound off' : 'Sound on', 1.2); }
  function setupTouchButtons() {
    var mute = document.getElementById('btnMute');
    if (mute) mute.addEventListener('click', function () { if (S.audio) S.audio.init(); toggleMute(); mute.blur(); });
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var help = document.getElementById('btnHelp'); touchTalk = document.getElementById('btnTalk');
    if (!isTouch || !help || !touchTalk) { touchTalk = null; return; }
    touchTalk.hidden = false; help.hidden = false;
    touchTalk.addEventListener('click', function () { talk(); touchTalk.blur(); });
    help.addEventListener('click', function () { H.toggleHelp(); Pl.clearKeys(); });
  }
  function start() {
    if (started) return;
    if (S.audio) S.audio.init();          // we are inside a user gesture (click / key): audio may start
    started = true; Pl.enabled = true; document.getElementById('overlay').hidden = true; renderer.domElement.focus();
  }
  function onResize() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  }

  function talk() {
    if (!started) return;
    var n = P.nearestTo(Pl.x, Pl.z, 3.2, Pl.level);
    if (!n) { H.toast('Nobody close enough - walk up to someone and press F', 1.8); return; }
    // face the player and speak
    n.faceTo = Math.atan2(Pl.x - n.x, Pl.z - n.z); n.h = n.faceTo;
    H.say(n, P.speak(n), 3.4);
    if (S.audio) S.audio.talk(n);
  }

  // keep the sun's shadow box centred on the player, snapped to shadow texels
  var right = null, up = null, dir = null, tmpUp = null;
  function updateSun(cx, cz) {
    if (!right) { right = new THREE.Vector3(); up = new THREE.Vector3(); tmpUp = new THREE.Vector3(0, 1, 0); dir = S.world.sunDir.clone(); }
    right.crossVectors(tmpUp, dir).normalize(); up.crossVectors(dir, right).normalize();
    var texel = 110 / 2048, t = tmpV.set(cx, 0, cz);
    var a = Math.round(t.dot(right) / texel) * texel, b = Math.round(t.dot(up) / texel) * texel, c = t.dot(dir);
    sun.target.position.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(dir, c);
    sun.position.copy(sun.target.position).addScaledVector(dir, 160);
    sun.target.updateMatrixWorld();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
    if (started) {
      Pl.update(dt);
      Pl.updateCamera(camera, dt);
    } else {
      // title screen: slow orbit around the school
      orbitT += dt * 0.07;
      var a = orbitT + 0.6, rad = 118;
      camera.position.set(10 + Math.sin(a) * rad * 0.9, 42, 14 + Math.cos(a) * rad * 0.8);
      camera.lookAt(0, 4, 6);
      S.people.setPlayer(Pl.x, Pl.z, Pl.heading, false, 0, true, 0);
    }
    // cutaway uniforms: on only in third person while playing
    var cut = S.world.cut;
    cut.uCutCam.value.copy(camera.position); cut.uCutTarget.value.set(Pl.x, Pl.y + 1.3, Pl.z); cut.uCutOn.value = (started && !Pl.fp) ? 1 : 0;
    if (marker) marker.position.set(Pl.x, Pl.y + 1.3, Pl.z);
    applyVisibility(started);
    P.update(dt, camera, Pl.x, Pl.z, Pl.level);
    S.world.update(dt, camera, { x: Pl.x, z: Pl.z });
    updateSun(started ? Pl.x : 8, started ? Pl.z : 10);
    // nearby character for the F prompt
    nearNpc = started ? P.nearestTo(Pl.x, Pl.z, 3.2, Pl.level) : null;
    var place = L.placeAt(Pl.x, Pl.z, Pl.level);
    if (touchTalk) touchTalk.disabled = !nearNpc;
    hudInfo.player = Pl; hudInfo.place = place; hudInfo.nearNpc = nearNpc; hudInfo.project = project;
    H.update(hudInfo);
    if (S.audio) S.audio.update(dt, Pl, started);
    renderer.info.reset();
    renderer.render(scene, camera);
    info.calls = renderer.info.render.calls; info.triangles = renderer.info.render.triangles;
  }
  // What is shown depends on where the player is:
  //   outside            -> everything, both roofs
  //   inside, level 0    -> second floor (slab, walls, furniture, signs, people) and both roofs hidden
  //   inside, level 1    -> only the upper roof hidden (also on the upper half of a stair flight)
  // Hidden groups stop casting shadows too.
  function applyVisibility(playing) {
    var W = S.world, inside = playing && Pl.inside, tower = inside && !!L.stairAt(Pl.x, Pl.z), fp = Pl.fp;
    // first person keeps everything (you look up at ceilings); in a stair tower the upper floor
    // stays so nothing pops at mid-flight
    var down = inside && !fp && Pl.level === 0 && !tower;
    W.upperGroup.visible = !down;
    W.roofGroup.visible = !(inside && !fp && (Pl.level === 0 || tower));
    W.roofUpGroup.visible = !(inside && !fp);
    P.view.hideUpper = down; P.view.thirdPerson = playing && !fp;
    // draw-call savers: room contents nobody can see
    var c = camera.position, far = !playing || (!Pl.inside && (c.x < -56 || c.x > 24 || c.z < -32 || c.z > 16));
    W.upperInterior.visible = !far;                                       // upstairs furniture / desks / signs
    W.underGroup.visible = !far && !(inside && !fp && Pl.level === 1 && !tower);   // ground wing rooms are under the floor when upstairs
    W.updateCutMaterials(Pl.y, tower, Pl.level === 1 && !tower);
  }
  function project(x, y, z) {
    var v = tmpV.set(x, y, z).project(camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ---------------------------------------------------------------- debug
  S.debug = {
    teleport: function (x, z, level) { Pl.teleport(x, z, level); Pl.inside = L.insideBuilding(Pl.x, Pl.z, Pl.level); return { x: Pl.x, z: Pl.z, level: Pl.level, y: Pl.y }; },
    setTime: function (hours) { P.setTime(hours); },
    start: start,
    setYaw: function (yaw, pitch, dist) { Pl.yaw = yaw; if (pitch !== undefined) Pl.pitch = pitch; if (dist !== undefined) { Pl.dist = dist; Pl.camDist = dist; } },
    // test hook: replace the avatar by an unlit magenta sphere at the head and count its visible pixels.
    // Returns { seen, full }: pixels with normal depth testing vs. with nothing in front.
    markerTest: function (noCut, noPeople) {
      if (!marker) { marker = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false })); scene.add(marker); }
      Pl.hideAvatar = true; marker.visible = true; marker.position.set(Pl.x, Pl.y + 1.3, Pl.z);
      Pl.update(0); Pl.updateCamera(camera, 5);
      var cut = S.world.cut; cut.uCutCam.value.copy(camera.position); cut.uCutTarget.value.set(Pl.x, Pl.y + 1.3, Pl.z); cut.uCutOn.value = (Pl.fp || noCut) ? 0 : 1;
      applyVisibility(true); P.update(0, camera, Pl.x, Pl.z, Pl.level);
      var gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4), out = {};
      var parts = P.parts(), pk; for (pk in parts) parts[pk].visible = !noPeople;       // optionally ignore other characters as occluders
      [['seen', true], ['full', false]].forEach(function (q) {
        marker.material.depthTest = q[1]; marker.renderOrder = q[1] ? 0 : 999;
        renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        var c = 0; for (var i = 0; i < buf.length; i += 4) if (buf[i] > 235 && buf[i + 1] < 25 && buf[i + 2] > 235) c++;
        out[q[0]] = c;
      });
      for (pk in parts) parts[pk].visible = true;
      marker.material.depthTest = true; marker.renderOrder = 0; marker.visible = false; Pl.hideAvatar = false;
      return out;
    },
    setHeading: function (h) { Pl.heading = h; },
    audioState: function () { return S.audio ? S.audio.state() : { ctxState: 'none', muted: false, activeVoices: 0, crowdLevel: 0, ambience: 'out', masterGain: 0 }; },
    getState: function () {
      return {
        x: Pl.x, z: Pl.z, y: Pl.y, level: Pl.level, place: L.placeAt(Pl.x, Pl.z, Pl.level), period: P.blockName(), time: P.clock.t / 60, clock: P.fmtTime(),
        inside: Pl.inside, npcCount: P.count(), visibleNpc: P.visibleCount(), fps: Math.round(fpsAvg), calls: info.calls, triangles: info.triangles,
        roofVisible: S.world.roofGroup.visible, upperRoofVisible: S.world.roofUpGroup.visible, upperVisible: S.world.upperGroup.visible, upperDrawn: P.drawnOnLevel(1), programs: renderer.info.programs ? renderer.info.programs.length : 0, fast: P.clock.fast, started: started, fp: Pl.fp, muted: !!(S.audio && S.audio.muted), camDist: Pl.camDist, zoom: Pl.dist, cutOn: S.world.cut.uCutOn.value
      };
    },
    // advance only the simulation (no rendering) - used by tests
    simulate: function (seconds, dt, cb) {
      dt = dt || 0.1; var fakeCam = { position: new THREE.Vector3(0, 0, 0) };
      for (var t = 0; t < seconds; t += dt) { P.update(dt, fakeCam, Pl.x, Pl.z, Pl.level); if (cb) cb(t); }
    },
    npcs: function () { return P.list.filter(function (n) { return n !== P.player(); }); },
    renderInfo: function () { return { calls: info.calls, triangles: info.triangles }; },
    setFast: function (f) { P.clock.fast = !!f; },
    cameraObj: function () { return camera; },
    rendererObj: function () { return renderer; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
