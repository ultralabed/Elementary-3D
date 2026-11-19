/*
 * audio.js - all sound in the game.
 *
 *   recordings:  the "kids talking" crowd is made of real public-domain recordings
 *                (audio/classroom.mp3, kids.mp3, cafeteria.mp3 - see README for credits),
 *                loaded after Start without blocking the game.  Each is turned into a
 *                seamless loop (equal-power cross-fade of its tail onto its head) and
 *                played from a random offset.  Any file may be missing: its layer is then
 *                simply silent (a loud crowd falls back to the kids layer); only if NO
 *                recording loads does a tiny noise murmur stand in.
 *   mixing:      a 4-times-a-second scan of the characters near the player (same level only)
 *                sets the target gain of each layer, how dull the crowd sounds (other room /
 *                outdoors) and where it sits in the stereo field (centroid of the crowd).
 *                All changes are smoothed; timing uses real elapsed time, so nothing
 *                depends on the frame rate.
 *   synthesized: bell, footsteps, wind, birds, room tone, gym ball, music notes, talk blip.
 *   speech:      F makes the character say its bubble line with the browser's speechSynthesis
 *                (falls back silently to the blip).
 *
 *   master: buses -> masterGain (mute) -> DynamicsCompressor (limiter) -> output
 *
 * If Web Audio is missing or blocked the game is simply silent: every entry point is a no-op.
 * The per-frame path (update) only reads numbers and schedules AudioParams on nodes created
 * once; it allocates nothing.
 */
(function () {
  'use strict';
  var S = window.CAMPUS = window.CAMPUS || {}, L = S.layout;
  var A = S.audio = { ok: false, muted: false, crowdLevel: 0, activeVoices: 0, ambience: 'out', bells: 0, decoded: 0, spoken: 0 };
  var CROWD_DIV = 3.5 * (((S.config && S.config.studentsPerClass) || 8) / 8);
  var MASTER = 0.8, NAMES = ['classroom', 'kids', 'cafeteria'], XFADE = 1.5, MIN_LEVEL = 0.03;
  var ctx = null, master, limiter, analyser, peakBuf, crowdBus, sfxBus, ambBus;
  var crowdPan, crowdHS, crowdLP, layers = {}, fallback = null, loadDone = false;
  var wind, windLfo = 0, room, tap, knock, thump, noiseBuf = null, started = false, lastT = 0;
  var PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  var tick = 0, lastBlock = '', lastBell = -10, nextBird = 3, nextThump = 1, nextNote = 1, stepTimer = 0, gymLevel = 0, musicLevel = 0, panTarget = 0;
  var STORE_KEY = 'campus-muted';

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function smooth(a, b, x) { x = (x - a) / (b - a); x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }

  // saved mute preference (private browsing / sandboxes may refuse storage: ignore)
  try { A.muted = window.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* default: sound on */ }

  // ------------------------------------------------------------------ set-up
  // Must be called from a user gesture (Start button, first key / touch).
  A.init = function () {
    if (started) { A.resume(); return; }
    started = true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      build();
      A.ok = true;
      A.resume();
      document.addEventListener('visibilitychange', function () { if (document.hidden) { A.suspend(); cancelSpeech(); } else A.resume(); });
      loadRecordings();
    } catch (e) { ctx = null; A.ok = false; }
  };
  A.resume = function () { if (ctx && ctx.state === 'suspended' && !document.hidden) { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* stay silent */ } } };
  A.suspend = function () { if (ctx && ctx.state === 'running') { try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } } };

  function gainNode(v, to) { var g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  function filter(type, f, q, to) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 1; if (to) b.connect(to); return b; }
  function noiseSource(to) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(to); s.start(); return s; }
  function osc(type, f, to) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; }

  function build() {
    var sr = ctx.sampleRate, i;
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    var d = noiseBuf.getChannelData(0); for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // master chain with a limiter at the end so nothing can clip
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.knee.value = 8; limiter.ratio.value = 14; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    var out = gainNode(0.9, ctx.destination);                  // head-room after the limiter's make-up gain
    limiter.connect(out);
    analyser = ctx.createAnalyser(); analyser.fftSize = 32768;       // about 0.7 s: peak() also catches short taps
    out.connect(analyser); peakBuf = new Float32Array(analyser.fftSize);
    master = gainNode(A.muted ? 0 : MASTER, limiter);
    crowdBus = gainNode(1, master); sfxBus = gainNode(1, master); ambBus = gainNode(1, master);
    // crowd chain: layers -> pan (crowd centroid) -> high-shelf (outdoors) -> low-pass (other room) -> bus
    crowdLP = filter('lowpass', 12000, 0.5, crowdBus); crowdHS = filter('highshelf', 3500, 0.7, crowdLP); crowdHS.gain.value = 0;
    crowdPan = ctx.createStereoPanner ? ctx.createStereoPanner() : gainNode(1); crowdPan.connect(crowdHS);
    // ambience: wind (outdoors) and room tone (indoors)
    wind = { gain: gainNode(0, ambBus) }; wind.f = filter('lowpass', 420, 0.4, wind.gain); noiseSource(wind.f);
    room = { gain: gainNode(0, ambBus) }; noiseSource(filter('bandpass', 140, 0.8, room.gain));
    // footsteps: a noise tap and a wooden knock (stairs), both always running behind closed envelopes
    tap = { env: gainNode(0, sfxBus) }; tap.f = filter('lowpass', 600, 0.6, tap.env); noiseSource(tap.f);
    knock = { env: gainNode(0, sfxBus) }; knock.osc = osc('triangle', 170, knock.env);
    // gym ball (through its own low-pass so it can be muffled when heard from next door)
    thump = { lp: filter('lowpass', 8000, 0.5, sfxBus) }; thump.env = gainNode(0, thump.lp); thump.osc = osc('sine', 80, thump.env);
  }

  // ------------------------------------------------------------- recordings
  // Source of each file: base64 embedded in the single-file build (window.CAMPUS_AUDIO_DATA),
  // otherwise audio/<name>.mp3 next to the page, listed in audio/manifest.json (so a file that
  // is not there is never requested and nothing is logged).  Not available from file:// pages.
  function b64ToBuffer(b64) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function decode(ab) {
    return new Promise(function (res, rej) { var p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  }
  // seamless loop: the last XFADE seconds are cross-faded (equal power) onto the first XFADE seconds
  function makeLoop(buf) {
    var sr = buf.sampleRate, n = buf.length, xf = Math.min(Math.floor(sr * XFADE), Math.floor(n / 3)), len = n - xf, i;
    var src = buf.getChannelData(0), out = ctx.createBuffer(1, len, sr), dst = out.getChannelData(0);
    for (i = 0; i < len; i++) dst[i] = src[i];
    for (i = 0; i < xf; i++) { var a = i / xf; dst[i] = src[i] * Math.sqrt(a) + src[len + i] * Math.sqrt(1 - a); }
    return out;
  }
  function startLayer(name, buf) {
    var g = gainNode(0, crowdPan), s = ctx.createBufferSource();
    s.buffer = makeLoop(buf); s.loop = true; s.connect(g); s.start(0, Math.random() * s.buffer.duration);
    layers[name] = { gain: g, target: 0, level: 1 };
    A.decoded++;
  }
  function loadOne(name, getBuffer) {
    return getBuffer().then(decode).then(function (buf) { if (ctx) startLayer(name, buf); }).catch(function () { /* this layer stays silent */ });
  }
  function loadRecordings() {
    var data = window.CAMPUS_AUDIO_DATA, jobs = [];
    try {
      if (data) {
        NAMES.forEach(function (n) { if (data[n]) jobs.push(loadOne(n, function () { return Promise.resolve(b64ToBuffer(data[n])); })); });
      } else if (window.fetch && /^https?:$/.test(location.protocol)) {
        jobs.push(fetch('audio/manifest.json').then(function (r) { return r.ok ? r.json() : { files: [] }; }).then(function (m) {
          var list = (m && m.files) || [], all = [];
          NAMES.forEach(function (n) {
            if (list.indexOf(n) < 0) return;
            all.push(loadOne(n, function () { return fetch('audio/' + n + '.mp3').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }); }));
          });
          return Promise.all(all);
        }).catch(function () { /* no recordings */ }));
      }
    } catch (e) { /* no recordings */ }
    Promise.all(jobs).then(function () {
      loadDone = true;
      if (!A.decoded && ctx) {                      // nothing could be loaded: a small noise murmur stands in
        fallback = { gain: gainNode(0, crowdPan) }; noiseSource(filter('bandpass', 900, 0.6, filter('lowpass', 2600, 0.5, fallback.gain)));
      }
    });
  }

  // ---------------------------------------------------------------- one-shots
  // a short sine "ping" with exponential decay (bell partials, music notes, birds, talk blip)
  function ping(f0, f1, t, dur, vol, type, bus) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function bell() {
    var t = ctx.currentTime + 0.02;
    if (t - lastBell < 1) return;                      // at most one chime per second (fast time)
    lastBell = t; A.bells++;
    [[659.25, 0], [523.25, 0.42], [783.99, 0.84]].forEach(function (n) {
      ping(n[0], n[0], t + n[1], 1.4, 0.16, 'sine'); ping(n[0] * 2, n[0] * 2, t + n[1], 0.9, 0.05, 'sine'); ping(n[0] * 3.01, n[0] * 3.01, t + n[1], 0.5, 0.02, 'sine');
    });
  }
  // debug.setTime jumps the clock: forget the current period so that jump does not ring the bell
  A.syncBlock = function () { lastBlock = ''; };

  // ----------------------------------------------------------- talk (F)
  var voiceCache = null;
  function englishVoice() {
    var ss = window.speechSynthesis;
    if (!voiceCache || !voiceCache.length) { try { voiceCache = ss.getVoices(); } catch (e) { voiceCache = []; } }
    var best = null;
    for (var i = 0; i < voiceCache.length; i++) {
      var v = voiceCache[i], l = (v.lang || '').replace('_', '-');
      if (l === 'en-US') { best = v; break; }
      if (!best && l.indexOf('en') === 0) best = v;
    }
    return best;
  }
  function cancelSpeech() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  // Say `text` with the browser's own speech.  Returns true when it was handed to speechSynthesis.
  function speak(text, npc) {
    try {
      var ss = window.speechSynthesis;
      if (!ss || typeof window.SpeechSynthesisUtterance === 'undefined' || !text) return false;
      if (A.muted) return true;                       // muted: nothing to hear and no blip either
      ss.cancel();                                    // a new talk replaces the previous utterance
      var u = new window.SpeechSynthesisUtterance(text), id = npc ? npc.id : 0, staff = npc && npc.kind === 'staff', v = englishVoice();
      u.lang = 'en-US'; if (v) u.voice = v;
      u.pitch = staff ? 0.9 + (id * 37 % 21) / 100 : 1.5 + ((id * 53 % 11) - 5) / 50;   // staff 0.9-1.1, kids about 1.4-1.6
      u.rate = staff ? 0.95 + (id * 29 % 11) / 100 : 1.05; u.volume = 0.9;
      u.onerror = function () { /* ignore */ };
      ss.speak(u); A.spoken++;
      return true;
    } catch (e) { return false; }
  }
  // F: speak the bubble line; if speech is unavailable fall back to a short 2-3 syllable blip
  A.talk = function (npc, text) {
    if (!A.ok) return;
    if (speak(text, npc)) return;
    if (ctx.state !== 'running' || A.muted) return;
    var t = ctx.currentTime + 0.02, n = 2 + ((Math.random() * 2) | 0), staff = npc && npc.kind === 'staff', f = staff ? rnd(190, 230) : rnd(330, 420);
    for (var i = 0; i < n; i++) { ping(f * rnd(0.92, 1.1), f * rnd(0.85, 1.05), t, 0.14, 0.12, 'triangle'); t += 0.17; }
  };

  // Footsteps are deliberately quiet, dull taps (low-passed noise, 8 ms+ attack, no click);
  // each step varies a little in level and tone, and running is only slightly louder.
  function footstep(surface, running) {
    var t = ctx.currentTime + 0.005, vol = (running ? 0.036 : 0.03) * rnd(0.8, 1.15), tone = rnd(0.88, 1.12);
    if (surface === 2) {                                    // stairs: a soft low knock under the tap
      knock.osc.frequency.setValueAtTime(150 * tone, t); knock.osc.frequency.exponentialRampToValueAtTime(105 * tone, t + 0.09);
      knock.env.gain.setTargetAtTime(vol * 0.8, t, 0.01); knock.env.gain.setTargetAtTime(0, t + 0.035, 0.035);
      tap.f.frequency.setTargetAtTime(420 * tone, t, 0.005); vol *= 0.6;
    } else if (surface === 1) tap.f.frequency.setTargetAtTime(620 * tone, t, 0.005);     // tile / floor
    else { tap.f.frequency.setTargetAtTime(330 * tone, t, 0.005); vol *= 1.15; }          // grass / path
    tap.env.gain.setTargetAtTime(vol, t, 0.009); tap.env.gain.setTargetAtTime(0, t + 0.03, 0.04);
  }

  // ------------------------------------------------------- the crowd scan
  // Four times a second: who is near the player on the same level?  Sets crowdLevel, the target
  // gain of every recorded layer, the dullness and the stereo position of the crowd.
  function inRect(r, n) { return n.x >= r.x0 && n.x <= r.x1 && n.z >= r.z0 && n.z <= r.z1; }
  function rectDist(r, x, z) { var dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1); return Math.sqrt(dx * dx + dz * dz); }
  function setTarget(name, v) {
    var l = layers[name]; if (!l) return;
    l.target = v; l.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.4);
  }
  function scan(Pl, camYaw) {
    var P = S.people, list = P.list, me = P.player(), px = Pl.x, pz = Pl.z, plv = Pl.level;
    var pr = Pl.inside ? L.roomAt(px, pz, plv) : null, sum = 0, sumSame = 0, sumQuiet = 0, cdx = 0, cdz = 0, i, gymN = 0, musN = 0;
    var gym = L.roomById.gym, mus = L.roomById.music;
    for (i = 0; i < list.length; i++) {
      var n = list[i]; if (n === me || n.hidden) continue;
      if (n.level === 0 && n.kind === 'student' && n.act === 'specials') { if (inRect(gym, n)) gymN++; else if (inRect(mus, n)) musN++; }
      if (n.level !== plv || n.kind === 'staff') continue;            // the other floor is (almost) inaudible; teachers alone make no crowd
      var dx = n.x - px, dz = n.z - pz, d2 = dx * dx + dz * dz; if (d2 > 1225) continue;
            var act = (n.act === 'lunch' || n.act === 'recess') ? 1 : n.path ? 0.6 : (n.act === 'class' || n.act === 'specials') ? 0.12 : 0.4;   // how talkative a student is
      var same = pr ? inRect(pr, n) : !L.insideBuilding(n.x, n.z, n.level);
      var w = act * (same ? 1 : 0.22) / (1 + d2 / 36);
      sum += w; if (same) sumSame += w; if (act <= 0.12) sumQuiet += w;
      cdx += w * dx; cdz += w * dz;
    }
    var lvl = A.crowdLevel = 1 - Math.exp(-sum / CROWD_DIV), t = ctx.currentTime;   // CROWD_DIV: more children per class, same loudness per place
    var sameFrac = sum > 1e-6 ? sumSame / sum : 1, lesson = sum > 1e-6 ? sumQuiet / sum : 0;
    var out = !Pl.inside;
    // ---- recorded layers
    var on = lvl >= MIN_LEVEL ? lvl : 0;                              // an empty place: recordings completely silent
    var loud = smooth(0.55, 0.9, on), place = (out ? 0.55 : 1) * (sameFrac < 0.5 ? 0.25 : 1);   // other room -12 dB, outdoors quieter
    var kids = on * (1 - 0.8 * lesson) * (1 - 0.55 * loud), cafe = loud * on * 1.2, cls = lesson * Math.min(1, on * 2.5) * 0.8;
    if (!layers.cafeteria) kids = Math.max(kids, loud * on * 0.9);    // no cafeteria recording: the kids layer carries a loud crowd
    setTarget('classroom', cls * place * 1.0); setTarget('kids', kids * place * 1.3); setTarget('cafeteria', cafe * place);
    if (fallback) fallback.gain.gain.setTargetAtTime(on * place * 0.18, t, 0.4);
    // dull when the crowd is in another room or outdoors
    crowdLP.frequency.setTargetAtTime(sameFrac < 0.5 ? 700 : 12000, t, 0.4);
    crowdHS.gain.setTargetAtTime(out ? -7 : 0, t, 0.4);
    // stereo: toward the crowd's centroid relative to the camera, at most +-0.6, slow
    var fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), cl = Math.sqrt(cdx * cdx + cdz * cdz), rx = -fz, rz = fx;
    panTarget = sum > 1e-6 ? Math.max(-0.6, Math.min(0.6, ((cdx * rx + cdz * rz) / (sum * 6 + cl + 1e-6)) * 1.6)) : 0;
    if (crowdPan.pan) crowdPan.pan.setTargetAtTime(panTarget, t, 0.7);
    A.activeVoices = 0;
    // gym ball / music room: full in the room, heavily muffled and quiet in the space right next to it
    var hereGym = pr === gym, hereMus = pr === mus;
    gymLevel = gymN >= 3 ? (hereGym ? 1 : (plv === 0 && rectDist(gym, px, pz) < 6 ? 0.12 : 0)) : 0;          // -18 dB next door
    musicLevel = musN >= 3 ? (hereMus ? 1 : (plv === 0 && rectDist(mus, px, pz) < 6 ? 0.15 : 0)) : 0;
    thump.lp.frequency.setTargetAtTime(hereGym ? 8000 : 160, t, 0.2);
  }

  // ------------------------------------------------------------- per frame
  // Pl: the player object (x, z, level, inside, moving, running, speed, yaw).  All timing comes
  // from the real clock, never from the frame count, so a slow frame rate changes nothing audible.
  A.update = function (dtFrame, Pl, playing) {
    if (!A.ok || ctx.state !== 'running') return;
    var now = performance.now() * 0.001, dt = lastT ? Math.min(1, now - lastT) : 0.016; lastT = now;
    var t = ctx.currentTime, P = S.people, fast = P.clock.fast, i;
    // school bell on every period change
    var blk = P.blockName();
    if (blk !== lastBlock) { if (lastBlock && playing) bell(); lastBlock = blk; }
    if (!playing) return;
    tick -= dt;
    if (tick <= 0) {
      tick = 0.25;
      scan(Pl, Pl.yaw);
      // fast time: crowd nearly off, everything else lower
      crowdBus.gain.setTargetAtTime(fast ? 0.12 : 1, t, 0.3); sfxBus.gain.setTargetAtTime(fast ? 0.5 : 1, t, 0.3); ambBus.gain.setTargetAtTime(fast ? 0.5 : 1, t, 0.3);
      // ambience cross-fade (time constant 0.17 s = about half a second)
      var out = !Pl.inside; A.ambience = out ? 'out' : 'in';
      windLfo += 0.25; wind.gain.gain.setTargetAtTime(out ? 0.05 + 0.025 * Math.sin(windLfo * 0.6) : 0, t, 0.17);
      wind.f.frequency.setTargetAtTime(380 + 120 * Math.sin(windLfo * 0.23), t, 0.4);
      room.gain.gain.setTargetAtTime(out ? 0 : 0.035, t, 0.17);
    }
    // footsteps: paced by the player's speed, never faster than 3.2 steps a second
    if (Pl.moving) {
      stepTimer -= dt;
      if (stepTimer <= 0) {
        var rate = Math.max(1.6, Math.min(3.2, (Pl.speed || 4) * 0.37));          // steps per second
        stepTimer = 1 / rate; footstep(L.stairAt(Pl.x, Pl.z) ? 2 : Pl.inside ? 1 : 0, Pl.running);
      }
    } else stepTimer = 0.12;
    // occasional one-shots
    if (A.ambience === 'out') {
      nextBird -= dt;
      if (nextBird <= 0) { nextBird = rnd(3, 9); var bf = rnd(2600, 4200), bn = 2 + ((Math.random() * 3) | 0); for (i = 0; i < bn; i++) ping(bf, bf * rnd(1.15, 1.5), t + 0.02 + i * 0.13, 0.09, 0.035, 'sine', ambBus); }
    }
    if (gymLevel > 0) {
      nextThump -= dt;
      if (nextThump <= 0) {
        nextThump = rnd(0.45, 1.3);
        thump.osc.frequency.setValueAtTime(110, t + 0.01); thump.osc.frequency.exponentialRampToValueAtTime(55, t + 0.1);
        thump.env.gain.setTargetAtTime(0.3 * gymLevel, t + 0.01, 0.004); thump.env.gain.setTargetAtTime(0, t + 0.04, 0.04);
      }
    }
    if (musicLevel > 0) {
      nextNote -= dt;
      if (nextNote <= 0) { nextNote = rnd(0.4, 1.4); var nf = PENTA[(Math.random() * PENTA.length) | 0]; ping(nf, nf, t + 0.02, 1.1, 0.07 * musicLevel, 'triangle'); }
    }
  };

  // -------------------------------------------------------------------- mute
  A.setMuted = function (m) {
    A.muted = !!m;
    if (A.ok) master.gain.setTargetAtTime(A.muted ? 0 : MASTER, ctx.currentTime, 0.03);
    if (A.muted) cancelSpeech();
    try { window.localStorage.setItem(STORE_KEY, A.muted ? '1' : '0'); } catch (e) { /* not persisted */ }
    var b = document.getElementById('btnMute');
    if (b) { b.setAttribute('aria-pressed', A.muted ? 'true' : 'false'); b.classList.toggle('muted', A.muted); }
    return A.muted;
  };
  A.toggleMute = function () { return A.setMuted(!A.muted); };
  A.setMuted(A.muted);                  // show the saved state on the button

  // ------------------------------------------------------------------- debug
  A.peak = function () {            // largest absolute sample in the analyser window (about 0.7 s) right now
    if (!A.ok) return 0;
    analyser.getFloatTimeDomainData(peakBuf);
    var m = 0; for (var i = 0; i < peakBuf.length; i++) { var a = peakBuf[i] < 0 ? -peakBuf[i] : peakBuf[i]; if (a > m) m = a; }
    return m;
  };
  A.state = function () {
    var g = {}, k;
    for (k = 0; k < NAMES.length; k++) g[NAMES[k]] = layers[NAMES[k]] ? layers[NAMES[k]].target : 0;
    return { ctxState: ctx ? ctx.state : 'none', muted: A.muted, activeVoices: 0, crowdLevel: A.crowdLevel, ambience: A.ambience,
      masterGain: A.ok ? (A.muted ? 0 : MASTER) : 0, bells: A.bells, peak: A.peak(), ok: A.ok,
      layers: g, decoded: A.decoded, loadDone: loadDone, pan: panTarget, spoken: A.spoken, fallback: !!fallback, gym: gymLevel, music: musicLevel };
  };
})();
