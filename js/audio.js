/*
 * audio.js - every sound in the game, synthesized with the Web Audio API.
 * No audio files, no network.  If Web Audio is missing or blocked the game is
 * simply silent: every entry point is a no-op.
 *
 *   master:  buses -> masterGain (mute) -> DynamicsCompressor (limiter) -> output
 *   babble:  a fixed pool of 6 "voices" (sawtooth -> two vowel formant band-passes
 *            -> syllable envelope -> muffle low-pass -> stereo pan).  Four times a
 *            second the nearest / loudest characters on the player's level are
 *            given to the pool; a filtered-noise murmur bed follows the crowd size.
 *   ambience: wind + bird chirps outdoors, quiet room tone indoors (cross-faded)
 *   one-shots: footsteps, school bell, talk blip, recess squeals, gym ball, music notes
 *
 * The per-frame path (update) only reads numbers and schedules AudioParams on
 * nodes created once in init(); it allocates nothing.
 */
(function () {
  'use strict';
  var S = window.CAMPUS = window.CAMPUS || {}, L = S.layout;
  var A = S.audio = { ok: false, muted: false, crowdLevel: 0, activeVoices: 0, ambience: 'out', bells: 0 };
  var POOL = 6, MASTER = 0.8;
  var ctx = null, master, limiter, analyser, peakBuf, crowdBus, sfxBus, ambBus;
  var voices = [], talkVoice = null, murmur, wind, windLfo = 0, room, tap, knock, thump;
  var noiseBuf = null, started = false;
  var VOWELS = [[1000, 1600], [600, 2300], [350, 2900], [550, 1000], [400, 900], [800, 1900]];
  var PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  // scratch state for the crowd scan (reused every tick)
  var bestN = [null, null, null, null, null, null], bestW = [0, 0, 0, 0, 0, 0], bestMuf = [false, false, false, false, false, false], bestCount = 0;
  var tick = 0, lastBlock = '', lastBell = -10, nextBird = 3, nextSqueal = 4, nextThump = 1, nextNote = 1, stepIndex = 0, recessNear = 0, gymLevel = 0, musicLevel = 0;

  function rnd(a, b) { return a + Math.random() * (b - a); }

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
      document.addEventListener('visibilitychange', function () { if (document.hidden) A.suspend(); else A.resume(); });
    } catch (e) { ctx = null; A.ok = false; }
  };
  A.resume = function () { if (ctx && ctx.state === 'suspended' && !document.hidden) { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* stay silent */ } } };
  A.suspend = function () { if (ctx && ctx.state === 'running') { try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } } };

  function gainNode(v, to) { var g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  function filter(type, f, q, to) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 1; if (to) b.connect(to); return b; }
  function noiseSource(to) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(to); s.start(); return s; }
  function osc(type, f, to) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; }

  function makeVoice(bus) {
    var v = { level: 0, pitch: 300, size: 1.15, next: 0 };
    v.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : gainNode(1);
    v.pan.connect(bus);
    v.muf = filter('lowpass', 7000, 0.7, v.pan);
    v.env = gainNode(0, v.muf);
    v.f1 = filter('bandpass', 800, 5, v.env); v.f2 = filter('bandpass', 1800, 7, gainNode(0.7, v.env));
    v.osc = ctx.createOscillator(); v.osc.type = 'sawtooth'; v.osc.frequency.value = 300;
    v.osc.connect(v.f1); v.osc.connect(v.f2); v.osc.start();
    return v;
  }

  function build() {
    var sr = ctx.sampleRate, i;
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    var d = noiseBuf.getChannelData(0); for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // master chain with a limiter at the end so nothing can clip
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.knee.value = 8; limiter.ratio.value = 14; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    var out = gainNode(0.9, ctx.destination);                  // head-room after the limiter's make-up gain
    limiter.connect(out);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; out.connect(analyser); peakBuf = new Float32Array(analyser.fftSize);
    master = gainNode(A.muted ? 0 : MASTER, limiter);
    crowdBus = gainNode(1, master); sfxBus = gainNode(1, master); ambBus = gainNode(1, master);
    // babble pool + one extra voice for the "talk" blip
    for (i = 0; i < POOL; i++) voices.push(makeVoice(crowdBus));
    talkVoice = makeVoice(sfxBus);
    // crowd murmur bed: band-passed noise
    murmur = { gain: gainNode(0, crowdBus) }; murmur.muf = filter('lowpass', 2600, 0.5, murmur.gain);
    noiseSource(filter('bandpass', 900, 0.6, murmur.muf));
    // ambience: wind (outdoors) and room tone (indoors)
    wind = { gain: gainNode(0, ambBus) }; wind.f = filter('lowpass', 420, 0.4, wind.gain); noiseSource(wind.f);
    room = { gain: gainNode(0, ambBus) }; noiseSource(filter('bandpass', 140, 0.8, room.gain));
    // footsteps: a noise tap and a wooden knock (stairs), both always running behind closed envelopes
    tap = { env: gainNode(0, sfxBus) }; tap.f = filter('bandpass', 1800, 1.2, tap.env); noiseSource(tap.f);
    knock = { env: gainNode(0, sfxBus) }; knock.osc = osc('triangle', 170, knock.env);
    // gym ball
    thump = { env: gainNode(0, sfxBus) }; thump.osc = osc('sine', 80, thump.env);
  }

  // ---------------------------------------------------------------- one-shots
  // a short sine "ping" with exponential decay (bell partials, music notes, birds, squeals)
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
  // one syllable on a voice
  function syllable(v, t, amp, dur) {
    var vw = VOWELS[(Math.random() * VOWELS.length) | 0];
    v.osc.frequency.setTargetAtTime(v.pitch * rnd(0.9, 1.14), t, 0.04);
    v.f1.frequency.setTargetAtTime(vw[0] * v.size, t, 0.015); v.f2.frequency.setTargetAtTime(vw[1] * v.size, t, 0.015);
    v.env.gain.setTargetAtTime(amp, t, 0.018); v.env.gain.setTargetAtTime(0, t + dur * 0.65, 0.03);
  }
  // F: a 2-3 syllable blip from the character being talked to
  A.talk = function (npc) {
    if (!A.ok || ctx.state !== 'running') return;
    var t = ctx.currentTime + 0.02, n = 2 + ((Math.random() * 2) | 0), v = talkVoice, staff = npc && npc.kind === 'staff';
    v.pitch = staff ? rnd(180, 240) : rnd(300, 430); v.size = staff ? 1.0 : 1.18;
    for (var i = 0; i < n; i++) { syllable(v, t, 0.5, 0.17); t += 0.19; }
  };
  function footstep(surface, running) {
    var t = ctx.currentTime + 0.005, vol = running ? 0.22 : 0.15;
    if (surface === 2) {                                    // stairs: hollow knock + a little tap
      knock.osc.frequency.setValueAtTime(190, t); knock.osc.frequency.exponentialRampToValueAtTime(120, t + 0.07);
      knock.env.gain.setTargetAtTime(vol * 0.9, t, 0.004); knock.env.gain.setTargetAtTime(0, t + 0.03, 0.025);
      tap.f.frequency.setValueAtTime(1200, t); vol *= 0.4;
    } else if (surface === 1) tap.f.frequency.setValueAtTime(2100, t);                  // tile
    else { tap.f.frequency.setValueAtTime(520, t); vol *= 1.3; }                       // grass / path
    tap.env.gain.setTargetAtTime(vol, t, 0.003); tap.env.gain.setTargetAtTime(0, t + (surface ? 0.02 : 0.045), surface ? 0.012 : 0.03);
  }

  // ------------------------------------------------------- the crowd scan
  // Four times a second: who is near the player on the same level?  Fills
  // crowdLevel and hands the loudest few to the voice pool.  No allocations.
  function inRect(r, n) { return n.x >= r.x0 && n.x <= r.x1 && n.z >= r.z0 && n.z <= r.z1; }
  function scan(Pl, camYaw) {
    var P = S.people, list = P.list, me = P.player(), px = Pl.x, pz = Pl.z, plv = Pl.level;
    var pr = Pl.inside ? L.roomAt(px, pz, plv) : null, sum = 0, i, j, gymN = 0, musN = 0;
    var gym = L.roomById.gym, mus = L.roomById.music;
    bestCount = 0; recessNear = 0;
    for (i = 0; i < list.length; i++) {
      var n = list[i]; if (n === me || n.hidden) continue;
      if (n.level === 0 && n.kind === 'student' && n.act === 'specials') { if (inRect(gym, n)) gymN++; else if (inRect(mus, n)) musN++; }
      if (n.level !== plv) continue;                                  // the other floor is (almost) inaudible
      var dx = n.x - px, dz = n.z - pz, d2 = dx * dx + dz * dz; if (d2 > 1225) continue;
      // how talkative: lunch / recess loud, walking chatty, sitting in class a quiet murmur, staff mostly quiet
      var act = n.kind === 'staff' ? (n.path ? 0.25 : 0.08) : (n.act === 'lunch' || n.act === 'recess') ? 1 : n.path ? 0.6 : (n.act === 'class' || n.act === 'specials') ? 0.12 : 0.4;
      var same = pr ? inRect(pr, n) : !L.insideBuilding(n.x, n.z, n.level);
      var w = act * (same ? 1 : 0.22) / (1 + d2 / 36);
      sum += w;
      if (same && n.act === 'recess' && d2 < 900) recessNear++;
      if (bestCount >= POOL && w <= bestW[POOL - 1]) continue;
      j = bestCount < POOL ? bestCount++ : POOL - 1;
      while (j > 0 && bestW[j - 1] < w) { bestW[j] = bestW[j - 1]; bestN[j] = bestN[j - 1]; bestMuf[j] = bestMuf[j - 1]; j--; }
      bestW[j] = w; bestN[j] = n; bestMuf[j] = !same;
    }
    A.crowdLevel = 1 - Math.exp(-sum / 3.5);
    // pool voices follow the loudest characters
    var t = ctx.currentTime, fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), act2 = 0;
    for (i = 0; i < POOL; i++) {
      var v = voices[i];
      if (i < bestCount && bestW[i] > 0.012) {
        var q = bestN[i], ddx = q.x - px, ddz = q.z - pz, dl = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
        v.level = Math.min(0.55, bestW[i] * 1.6) * (0.4 + 0.6 * A.crowdLevel);
        var staff = q.kind === 'staff';
        v.pitch = staff ? 180 + (q.id * 37 % 60) : 255 + (q.id * 53 % 190); v.size = staff ? 1.0 : 1.18;
        if (v.pan.pan) v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (ddx * -fz + ddz * fx) / dl)) * 0.8, t, 0.08);
        v.muf.frequency.setTargetAtTime(bestMuf[i] ? 550 : 7000, t, 0.1);
        act2++;
      } else v.level = 0;
    }
    A.activeVoices = act2;
    murmur.gain.gain.setTargetAtTime(Math.pow(A.crowdLevel, 1.3) * 0.2, t, 0.25);
    murmur.muf.frequency.setTargetAtTime(pr && A.crowdLevel < 0.3 ? 900 : 2600, t, 0.3);
    // gym ball / music room: full when in the room, faint from nearby on the ground floor
    var hereGym = pr === gym, hereMus = pr === mus;
    gymLevel = gymN >= 3 ? (hereGym ? 1 : (plv === 0 && Math.abs(px - gym.cx) < 30 && Math.abs(pz - gym.cz) < 26 ? 0.18 : 0)) : 0;
    musicLevel = musN >= 3 ? (hereMus ? 1 : (plv === 0 && Math.abs(px - mus.cx) < 22 && Math.abs(pz - mus.cz) < 20 ? 0.18 : 0)) : 0;
  }

  // ------------------------------------------------------------- per frame
  // info: the player object (x, z, level, inside, moving, running, phase, yaw)
  A.update = function (dt, Pl, playing) {
    if (!A.ok || ctx.state !== 'running') return;
    var t = ctx.currentTime, P = S.people, fast = P.clock.fast, i;
    // school bell on every period change
    var blk = P.blockName();
    if (blk !== lastBlock) { if (lastBlock && playing) bell(); lastBlock = blk; }
    if (!playing) return;
    tick -= dt;
    if (tick <= 0) {
      tick = 0.25;
      scan(Pl, Pl.yaw);
      // fast time: babble nearly off, everything else lower
      crowdBus.gain.setTargetAtTime(fast ? 0.12 : 1, t, 0.2); sfxBus.gain.setTargetAtTime(fast ? 0.5 : 1, t, 0.2); ambBus.gain.setTargetAtTime(fast ? 0.5 : 1, t, 0.2);
      // ambience cross-fade (time constant 0.17 s = about half a second)
      var out = !Pl.inside; A.ambience = out ? 'out' : 'in';
      windLfo += 0.25; wind.gain.gain.setTargetAtTime(out ? 0.05 + 0.025 * Math.sin(windLfo * 0.6) : 0, t, 0.17);
      wind.f.frequency.setTargetAtTime(380 + 120 * Math.sin(windLfo * 0.23), t, 0.4);
      room.gain.gain.setTargetAtTime(out ? 0 : 0.035, t, 0.17);
    }
    // babble: start the next syllable of every active voice when its time has come
    for (i = 0; i < POOL; i++) {
      var v = voices[i];
      if (v.level < 0.01 || t < v.next) continue;
      var dur = rnd(0.09, 0.24);
      syllable(v, t + 0.01, v.level * rnd(0.6, 1), dur);
      v.next = t + dur + (Math.random() < 0.22 ? rnd(0.3, 1.3) : 0.015);
    }
    // footsteps: one tap per half swing of the legs
    if (Pl.moving) {
      var si = Math.floor(Pl.phase / Math.PI);
      if (si !== stepIndex) { stepIndex = si; footstep(L.stairAt(Pl.x, Pl.z) ? 2 : Pl.inside ? 1 : 0, Pl.running); }
    }
    // occasional one-shots
    if (A.ambience === 'out') {
      nextBird -= dt;
      if (nextBird <= 0) { nextBird = rnd(3, 9); var bf = rnd(2600, 4200), bn = 2 + ((Math.random() * 3) | 0); for (i = 0; i < bn; i++) ping(bf, bf * rnd(1.15, 1.5), t + 0.02 + i * 0.13, 0.09, 0.035, 'sine', ambBus); }
      if (recessNear > 4) {
        nextSqueal -= dt;
        if (nextSqueal <= 0) { nextSqueal = rnd(1.6, 5); var sf = rnd(700, 1000); ping(sf, sf * 1.8, t + 0.02, 0.16, 0.06, 'triangle', crowdBus); if (Math.random() < 0.6) ping(sf * 1.3, sf * 2.0, t + 0.2, 0.18, 0.05, 'triangle', crowdBus); }
      }
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
    var b = document.getElementById('btnMute');
    if (b) { b.setAttribute('aria-pressed', A.muted ? 'true' : 'false'); b.classList.toggle('muted', A.muted); b.setAttribute('aria-label', A.muted ? 'Sound off - turn sound on' : 'Sound on - mute'); }
    return A.muted;
  };
  A.toggleMute = function () { return A.setMuted(!A.muted); };

  // ------------------------------------------------------------------- debug
  A.peak = function () {            // largest absolute sample in the analyser window right now
    if (!A.ok) return 0;
    analyser.getFloatTimeDomainData(peakBuf);
    var m = 0; for (var i = 0; i < peakBuf.length; i++) { var a = peakBuf[i] < 0 ? -peakBuf[i] : peakBuf[i]; if (a > m) m = a; }
    return m;
  };
  A.state = function () {
    return { ctxState: ctx ? ctx.state : 'none', muted: A.muted, activeVoices: A.activeVoices, crowdLevel: A.crowdLevel, ambience: A.ambience,
      masterGain: A.ok ? (A.muted ? 0 : MASTER) : 0, pool: POOL, bells: A.bells, peak: A.peak(), ok: A.ok };
  };
})();
