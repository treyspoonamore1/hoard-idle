/* Hoard — js/sound.js — synthesized WebAudio sound effects (owner: POLISH agent, SPEC-V2.md section 4).
 * No audio files: every sound is built from oscillators, filtered noise and a small synthetic cave reverb.
 * Browser module loaded before cave.js/ui.js. Loads harmlessly in Node (no AudioContext -> silent), so
 * tools/test-polish.cjs can drive it with a fake context.
 *
 *   HOARD.sound.play(name, data)   'coin' {n, streak} | 'streakUp' {mult} | 'gust' | 'treasure' {kind} | 'buy' {kind}
 *                                  | 'rank' | 'sleep' | 'chest' {cards:[id], auto} | 'lore' {relic} | 'myth'
 *                                  | 'emberWake' | 'eventStart' | 'questDone' | 'preview'
 *   HOARD.sound.unlock()           create/resume the AudioContext (called on the first pointerdown by itself)
 *   HOARD.sound.enabled(s) / volume(s) / setEnabled(s, v) / setVolume(s, v)   state.settings.sound / .volume
 *   HOARD.sound.info()             { state, voices, played:{name:n}, dropped }
 *
 * Settings live in state.settings.sound (default on) and state.settings.volume (0..1, default 0.4).
 * The context is suspended while the page is hidden or sound is off; nothing is scheduled while it is not
 * running, so sounds never pile up and burst out on resume. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var G = globalThis;
  var hasDom = typeof document !== 'undefined' && typeof document.addEventListener === 'function';

  var DEF_VOL = 0.4;
  var MAX_VOICES = 56;     // oscillator/noise sources alive at once
  var SOFT_VOICES = 22;    // above this, low-priority sounds (coins, buys) are skipped

  // minimum seconds between two plays of the same sound (coin: <= 12/s, SPEC-V2 4)
  var GAP = { coin: 1 / 12, buy: 0.085, streakUp: 0.12, gust: 0.35, treasure: 0.3, rank: 0.7, sleep: 2.5,
    chest: 0.2, lore: 0.1, myth: 3, emberWake: 2, eventStart: 1, questDone: 0.3, preview: 0.12 };

  var ctx = null, out = null, send = null, master = null, noiseBuf = null;
  var factory = null;          // test hook: () -> AudioContext-like
  var getState = null;
  var voices = 0, dropped = 0, played = {}, last = {};
  var appliedVol = -1;
  var hidden = false;
  var chestQ = null;
  var lvl = 1;                 // per-sound loudness trim, applied to every voice of the sound being played
  // trims measured by rendering each sound offline (tools: OfflineAudioContext): at 40% volume the loud,
  // rare moments (rank, sleep, myth) peak near -16 dBFS, everyday sounds (coins, buys) near -26 dBFS
  var LEVEL = { coin: 5.6, preview: 5.6, buy: 3.2, streakUp: 4, gust: 3.2, treasure: 4, rank: 3.2, sleep: 3.2, chest: 3.5,
    lore: 4, myth: 3.2, emberWake: 3.4, eventStart: 3, questDone: 3.8 };

  // ---------------------------------------------------------------- settings
  function S() { try { return getState ? getState() : (HOARD.state || null); } catch (e) { return null; } }
  function fin(x, d) { x = +x; return isFinite(x) ? x : d; }
  function enabled(s) {
    s = s || S();
    return !(s && s.settings && s.settings.sound === false);
  }
  function volume(s) {
    s = s || S();
    var v = s && s.settings ? fin(s.settings.volume, DEF_VOL) : DEF_VOL;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function setEnabled(s, v) {
    if (!s) return;
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    s.settings.sound = !!v;
    if (!v) suspend();
    else { unlock(); applyVolume(s); }
  }
  function setVolume(s, v) {
    if (!s) return;
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    v = fin(v, DEF_VOL);
    s.settings.volume = Math.round((v < 0 ? 0 : (v > 1 ? 1 : v)) * 100) / 100;
    applyVolume(s);
  }
  // perceptual curve: 40% on the slider is a gentle level, 100% is still not harsh
  function gainFor(v) { return v <= 0 ? 0 : Math.pow(v, 1.5) * 0.9; }

  // ---------------------------------------------------------------- context
  function makeContext() {
    if (factory) return factory();
    var AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return null;
    try { return new AC({ latencyHint: 'interactive' }); } catch (e) {
      try { return new AC(); } catch (e2) { return null; }
    }
  }
  function build() {
    if (ctx) return ctx;
    var c = makeContext();
    if (!c) return null;
    ctx = c;
    try {
      // voices -> out -> warm lowpass -> gentle compressor -> master -> speakers
      //        \-> send -> cave reverb -> return ----^
      master = c.createGain();
      master.gain.value = 0;
      var comp = c.createDynamicsCompressor ? c.createDynamicsCompressor() : null;
      if (comp) {
        setP(comp.threshold, -10); setP(comp.knee, 10); setP(comp.ratio, 4);
        setP(comp.attack, 0.004); setP(comp.release, 0.22);
      }
      var warm = c.createBiquadFilter();
      warm.type = 'lowpass'; setP(warm.frequency, 7800); setP(warm.Q, 0.5);
      out = c.createGain(); out.gain.value = 1;
      send = c.createGain(); send.gain.value = 1;
      out.connect(warm);
      if (comp) { warm.connect(comp); comp.connect(master); } else warm.connect(master);
      master.connect(c.destination);
      if (c.createConvolver) {
        var verb = c.createConvolver();
        verb.buffer = impulse(c, 1.5);
        var ret = c.createGain(); ret.gain.value = 0.32;
        send.connect(verb); verb.connect(ret); ret.connect(warm);
      }
      noiseBuf = makeNoise(c, 1.5);
      appliedVol = -1;
      applyVolume(S());
    } catch (e) {
      ctx = null; out = send = master = null;
      return null;
    }
    return ctx;
  }
  function setP(p, v) { if (p) { try { p.value = v; } catch (e) { /* ignore */ } } }
  // stereo cave-ish impulse: short pre-delay, darkened decaying noise
  function impulse(c, sec) {
    var rate = c.sampleRate || 44100, len = Math.max(1, Math.floor(rate * sec));
    var b = c.createBuffer(2, len, rate), pre = Math.floor(rate * 0.012);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        var t = (i - pre) / (len - pre);
        var env = Math.pow(1 - t, 3.2);
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * t);  // gets darker as it decays
        d[i] = lp * env * 0.6;
      }
    }
    return b;
  }
  function makeNoise(c, sec) {
    var rate = c.sampleRate || 44100, len = Math.max(1, Math.floor(rate * sec));
    var b = c.createBuffer(1, len, rate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function running() { return !!ctx && ctx.state === 'running' && !hidden; }
  function unlock() {
    var s = S();
    if (!enabled(s)) return false;
    if (!build()) return false;
    if (ctx.state !== 'running' && !hidden) {
      try { var p = ctx.resume(); if (p && p.catch) p.catch(function () { /* blocked until a gesture */ }); } catch (e) { /* ignore */ }
    }
    applyVolume(s);
    return true;
  }
  function suspend() {
    if (!ctx || ctx.state !== 'running') return;
    try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
  }
  function applyVolume(s) {
    if (!ctx || !master) return;
    var g = enabled(s) ? gainFor(volume(s)) : 0;
    if (Math.abs(g - appliedVol) < 1e-4) return;
    var first = appliedVol < 0;
    appliedVol = g;
    if (first) { setP(master.gain, g); return; }   // a fresh context starts at the right level (no fade-in on the first sound)
    try { master.gain.setTargetAtTime(g, ctx.currentTime, 0.03); } catch (e) { setP(master.gain, g); }
  }

  // ---------------------------------------------------------------- voices
  function now() { return ctx ? fin(ctx.currentTime, 0) : 0; }
  function done(src, nodes) {
    src.onended = function () {
      voices = Math.max(0, voices - 1);
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ignore */ } }
    };
  }
  function pan(node, p) {
    if (!p || !ctx.createStereoPanner) return node;
    var sp = ctx.createStereoPanner();
    setP(sp.pan, p < -1 ? -1 : (p > 1 ? 1 : p));
    node.connect(sp);
    return sp;
  }
  function route(node, wet, nodes) {
    node.connect(out);
    if (wet > 0 && send) {
      var w = ctx.createGain();
      w.gain.value = wet;
      node.connect(w); w.connect(send);
      nodes.push(w);
    }
  }
  // one enveloped oscillator. o: { f, f2?, glide?, type, t, a, d, g, wet, pan, lp, det }
  function tone(o) {
    if (voices >= MAX_VOICES) { dropped++; return false; }
    var t0 = now() + fin(o.t, 0) + 0.005;
    var a = Math.max(0.001, fin(o.a, 0.004)), d = Math.max(0.02, fin(o.d, 0.2)), g = Math.max(0, fin(o.g, 0.1) * lvl);
    var osc = ctx.createOscillator(), env = ctx.createGain();
    var nodes = [osc, env];
    osc.type = o.type || 'sine';
    var f = Math.max(20, fin(o.f, 440));
    osc.frequency.setValueAtTime(f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, fin(o.f2, f)), t0 + Math.max(0.01, fin(o.glide, a + d)));
    if (o.det) setP(osc.detune, o.det);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(g, t0 + a);
    if (o.hold) env.gain.setValueAtTime(g, t0 + a + o.hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + a + fin(o.hold, 0) + d);
    var node = env;
    osc.connect(env);
    if (o.lp) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.max(40, o.lp), t0);
      if (o.lp2) lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.lp2), t0 + fin(o.lpT, a + d));
      setP(lp.Q, fin(o.q, 0.7));
      env.connect(lp); node = lp; nodes.push(lp);
    }
    var pn = pan(node, o.pan);
    if (pn !== node) nodes.push(pn);
    route(pn, fin(o.wet, 0), nodes);
    osc.start(t0);
    osc.stop(t0 + a + fin(o.hold, 0) + d + 0.05);
    voices++;
    done(osc, nodes);
    return true;
  }
  // filtered noise burst. o: { t, a, d, g, type:'bandpass'|'lowpass'|'highpass', f, f2, f3, q, wet, pan, pan2 }
  function noise(o) {
    if (voices >= MAX_VOICES || !noiseBuf) { dropped++; return false; }
    var t0 = now() + fin(o.t, 0) + 0.005;
    var a = Math.max(0.002, fin(o.a, 0.01)), d = Math.max(0.02, fin(o.d, 0.2)), g = Math.max(0, fin(o.g, 0.1) * lvl);
    var src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), env = ctx.createGain();
    var nodes = [src, flt, env];
    src.buffer = noiseBuf;
    src.loop = true;
    try { src.loopStart = 0; src.loopEnd = noiseBuf.duration || 1; } catch (e) { /* ignore */ }
    if (o.rate) setP(src.playbackRate, o.rate);
    flt.type = o.type || 'bandpass';
    var f = Math.max(40, fin(o.f, 800));
    flt.frequency.setValueAtTime(f, t0);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t0 + a + d * 0.35);
    if (o.f3) flt.frequency.exponentialRampToValueAtTime(Math.max(40, o.f3), t0 + a + d);
    setP(flt.Q, fin(o.q, 0.8));
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(g, t0 + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    src.connect(flt); flt.connect(env);
    var node = env;
    if ((o.pan || o.pan2) && ctx.createStereoPanner) {
      var sp = ctx.createStereoPanner();
      sp.pan.setValueAtTime(fin(o.pan, 0), t0);
      if (o.pan2 !== undefined) sp.pan.linearRampToValueAtTime(fin(o.pan2, 0), t0 + a + d);
      env.connect(sp); node = sp; nodes.push(sp);
    }
    route(node, fin(o.wet, 0), nodes);
    src.start(t0, Math.random() * 0.9);
    src.stop(t0 + a + d + 0.05);
    voices++;
    done(src, nodes);
    return true;
  }
  function semi(f, n) { return f * Math.pow(2, n / 12); }
  function jitter(cents) { return Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200); }
  // a soft bell: fundamental + quiet inharmonic partial
  function bell(f, t, g, d, wet, p) {
    tone({ f: f, t: t, a: 0.004, d: d, g: g, wet: wet, pan: p });
    tone({ f: f * 2.01, t: t, a: 0.002, d: d * 0.45, g: g * 0.22, wet: wet, pan: p });
    tone({ f: f * 3.98, t: t, a: 0.002, d: d * 0.2, g: g * 0.06, wet: wet, pan: p });
  }

  // ---------------------------------------------------------------- the sounds
  var STREAK_STEPS = [1, 2, 3, 5, 8];
  var PENTA = [0, 2, 4, 7, 9, 12, 14];
  function streakIdx(m) {
    m = fin(m, 1);
    var k = 0;
    for (var i = 0; i < STREAK_STEPS.length; i++) if (m >= STREAK_STEPS[i] - 1e-6) k = i;
    return k;
  }
  var RAR = { common: 0, rare: 1, epic: 2, legendary: 3 };
  function rarityOf(id) {
    try {
      var cs = HOARD.data && HOARD.data.cards;
      if (cs) for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return RAR[cs[i].rarity] || 0;
    } catch (e) { /* ignore */ }
    return 0;
  }
  function rarityChime(r, t, soft) {
    var g = soft ? 0.045 : 0.075;
    var base = 1046.5; // C6
    var seq = r >= 3 ? [0, 4, 7, 12] : (r === 2 ? [0, 4, 7] : (r === 1 ? [0, 7] : [4]));
    var sp = r >= 3 ? 0.075 : 0.06;
    for (var i = 0; i < seq.length; i++) bell(semi(base, seq[i]), t + i * sp, g, 0.4 + (r >= 2 ? 0.25 : 0), 0.45, (i % 2 ? 0.2 : -0.2));
    if (r >= 3 && !soft) { // legendary shimmer
      tone({ f: semi(base, 24), t: t + 0.3, a: 0.15, d: 1.1, g: 0.025, wet: 0.8, pan: 0.3 });
      tone({ f: semi(base, 19), t: t + 0.34, a: 0.15, d: 1.0, g: 0.022, wet: 0.8, pan: -0.3 });
    }
  }
  var SFX = {
    coin: function (d) {
      var k = streakIdx(d && d.streak), n = Math.max(1, Math.floor(fin(d && d.n, 1)));
      var f = semi(1318.5, PENTA[k]) * jitter(35);           // E6 rising through a pentatonic with the streak
      var g = 0.095 * (n > 3 ? 1.25 : 1);
      var p = (Math.random() - 0.5) * 0.5;
      tone({ f: f, a: 0.002, d: 0.11, g: g, wet: 0.12, pan: p });
      tone({ f: f * 2.76, a: 0.001, d: 0.045, g: g * 0.22, wet: 0.08, pan: p });
      tone({ f: f * 0.5, type: 'triangle', a: 0.002, d: 0.06, g: g * 0.18, pan: p });
    },
    streakUp: function (d) {
      var k = streakIdx(d && d.mult);
      var f = semi(659.25, PENTA[Math.min(PENTA.length - 1, k + 1)]);  // E5 + step
      bell(f, 0, 0.07, 0.45, 0.35, -0.15);
      bell(semi(f, 7), 0.075, 0.06, 0.55, 0.4, 0.15);
    },
    gust: function () {
      noise({ type: 'bandpass', f: 320, f2: 1700, f3: 420, q: 0.9, a: 0.09, d: 0.6, g: 0.3, wet: 0.35, pan: -0.55, pan2: 0.55 });
      noise({ type: 'lowpass', f: 500, f2: 260, q: 0.5, a: 0.05, d: 0.4, g: 0.12, wet: 0.2 });
      tone({ f: 110, f2: 70, type: 'sine', a: 0.04, d: 0.35, g: 0.05 });
    },
    treasure: function () {
      var seq = [0, 2, 4, 7, 9, 12];
      for (var i = 0; i < seq.length; i++) bell(semi(1046.5, seq[i]), i * 0.055, 0.05, 0.38, 0.5, (i % 2 ? 0.25 : -0.25));
      tone({ f: 523.25, t: 0, a: 0.02, d: 0.6, g: 0.035, wet: 0.4 });
    },
    buy: function (d) {
      var kind = d && d.kind;
      var f = kind === 'tier' ? 200 : (kind === 'kiln' ? 125 : 160);
      f *= jitter(60);
      tone({ f: f, f2: f * 0.48, glide: 0.08, a: 0.003, d: 0.09, g: 0.14 });
      noise({ type: 'lowpass', f: 900, q: 0.4, a: 0.002, d: 0.03, g: 0.035 });
      if (kind === 'upgrade') bell(1174.7, 0.03, 0.04, 0.3, 0.3, 0);
    },
    rank: function () {
      var notes = [523.25, 659.25, 783.99];                  // C5 E5 G5
      for (var i = 0; i < 3; i++) {
        var last = i === 2, t = i * 0.13;
        tone({ f: notes[i], type: 'triangle', t: t, a: 0.012, hold: last ? 0.18 : 0, d: last ? 0.8 : 0.16, g: 0.09, wet: 0.35, lp: 2600 });
        tone({ f: notes[i], type: 'sawtooth', t: t, a: 0.02, hold: last ? 0.18 : 0, d: last ? 0.7 : 0.14, g: 0.02, wet: 0.3, lp: 1400, det: 5 });
      }
      bell(1567.98, 0.28, 0.035, 0.7, 0.5, 0.2);
    },
    sleep: function () {
      var chord = [110, 164.81, 246.94, 277.18];              // A2 E3 B3 C#4: soft, open, dreamy
      for (var i = 0; i < chord.length; i++) {
        [-7, 7].forEach(function (det) {
          tone({ f: chord[i], type: 'sawtooth', det: det, a: 1.1, hold: 0.8, d: 2.6, g: 0.022, wet: 0.6,
            lp: 380, lp2: 900, lpT: 1.6, q: 0.6, pan: det < 0 ? -0.3 : 0.3 });
        });
      }
      tone({ f: 55, type: 'sine', a: 1.2, hold: 0.6, d: 2.4, g: 0.05 });
    },
    chest: function (d) {
      var cards = (d && Array.isArray(d.cards)) ? d.cards : [];
      var soft = !!(d && d.auto);
      var many = !!(d && d.many);
      if (!soft) {
        noise({ type: 'lowpass', f: 700, f2: 350, q: 0.6, a: 0.005, d: 0.14, g: 0.1, wet: 0.2 });
        tone({ f: 140, f2: 82, glide: 0.12, a: 0.004, d: 0.16, g: 0.11 });
        noise({ type: 'bandpass', f: 1400, f2: 900, q: 6, a: 0.04, d: 0.22, g: 0.025, t: 0.05 }); // creak
      }
      if (!cards.length) return;
      var rm = false;
      try { rm = !!(HOARD.ui && HOARD.ui.reducedMotion && HOARD.ui.reducedMotion()); } catch (e) { /* ignore */ }
      if (soft || many || rm) {
        // one chime per rarity found, ascending, quickly (bulk / auto / reduced-motion reveal all at once)
        var seen = {};
        cards.forEach(function (id) { seen[rarityOf(id)] = 1; });
        var rs = Object.keys(seen).map(Number).sort(), t = soft ? 0 : 0.25;
        if (soft) rs = [rs[rs.length - 1]];
        rs.forEach(function (r, i) { rarityChime(r, t + i * 0.22, soft); });
        return;
      }
      // matches the chest sheet's one-by-one reveal (380 ms + 520 ms per card)
      for (var i = 0; i < Math.min(cards.length, 6); i++) rarityChime(rarityOf(cards[i]), 0.38 + i * 0.52, false);
    },
    lore: function (d) {
      if (d && d.relic) {
        bell(587.33, 0, 0.06, 1.0, 0.55, -0.2);
        bell(880, 0.09, 0.055, 1.0, 0.55, 0.2);
        bell(1174.66, 0.18, 0.045, 1.2, 0.6, 0);
        return;
      }
      bell(783.99, 0, 0.065, 0.8, 0.5, -0.15);              // G5 then D6: an open fifth, like a page turning to gold
      bell(1174.66, 0.08, 0.055, 0.95, 0.55, 0.15);
    },
    myth: function () {
      var chord = [130.81, 196, 261.63, 329.63, 392];         // C3 G3 C4 E4 G4
      for (var i = 0; i < chord.length; i++) {
        tone({ f: chord[i], type: 'sawtooth', det: (i % 2 ? 6 : -6), a: 2.0, hold: 0.4, d: 2.6, g: 0.02, wet: 0.7,
          lp: 260, lp2: 3200, lpT: 2.2, q: 0.8, pan: (i - 2) * 0.2 });
      }
      [0, 4, 7, 12].forEach(function (n, k) { bell(semi(1046.5, n), 1.9 + k * 0.1, 0.045, 1.2, 0.7, (k % 2 ? 0.3 : -0.3)); });
    },
    emberWake: function () {
      tone({ f: 98, type: 'triangle', a: 0.6, hold: 0.3, d: 1.6, g: 0.06, wet: 0.5, lp: 600 });
      for (var i = 0; i < 7; i++) noise({ type: 'bandpass', f: 1800 + Math.random() * 2400, q: 8, a: 0.002, d: 0.035, g: 0.05, t: 0.15 + i * 0.13 + Math.random() * 0.06, pan: (Math.random() - 0.5) * 0.8 });
      bell(587.33, 0.5, 0.04, 0.9, 0.5, -0.1);
    },
    eventStart: function () {
      [0, 4, 7].forEach(function (n, k) { bell(semi(698.46, n), k * 0.09, 0.05, 0.6, 0.5, (k - 1) * 0.25); });
    },
    questDone: function () {
      bell(880, 0, 0.05, 0.4, 0.35, -0.1);
      bell(1318.5, 0.07, 0.045, 0.5, 0.4, 0.1);
    },
    star: function (d) {                                     // a caught falling star: a small bell rising with the combo
      var k = Math.min(PENTA.length - 1, Math.floor(Math.max(0, fin(d && d.combo, 0)) / 3));
      bell(semi(1567.98, PENTA[k]) * jitter(20), 0, 0.045, 0.3, 0.45, (Math.random() - 0.5) * 0.6);
    },
    preview: function () { SFX.coin({ n: 1, streak: 1 }); }
  };
  var LOW = { coin: 1, buy: 1, star: 1, preview: 1 };

  function play(name, data) {
    var fn = SFX[name];
    if (!fn) return false;
    var s = S();
    if (!enabled(s) || !running() || volume(s) <= 0) return false;
    if (LOW[name] && voices >= SOFT_VOICES) { dropped++; return false; }
    var t = now(), gap = GAP[name] || 0.05;
    if (last[name] !== undefined && t - last[name] < gap) return false;
    last[name] = t;
    applyVolume(s);
    lvl = LEVEL[name] || 3;
    try { fn(data || {}); } catch (e) { lvl = 1; return false; }
    lvl = 1;
    played[name] = (played[name] || 0) + 1;
    return true;
  }

  // ---------------------------------------------------------------- wiring
  // chests opened in one go (Open all, auto chests) arrive as many 'chest' events in one task -> batch them
  function chestEvent(cards, auto) {
    if (!chestQ) {
      chestQ = { cards: [], n: 0, auto: !!auto };
      var flush = function () {
        var q = chestQ; chestQ = null;
        if (!q) return;
        var sheet = false;
        try { sheet = !!(HOARD.ui && HOARD.ui.sheetOpen && HOARD.ui.sheetOpen()); } catch (e) { /* ignore */ }
        play('chest', { cards: q.cards, auto: q.auto || !sheet, many: q.n > 1 });
      };
      try { Promise.resolve().then(flush); } catch (e) { flush(); }
    }
    chestQ.n++;
    if (auto) chestQ.auto = true;
    if (Array.isArray(cards)) chestQ.cards = chestQ.cards.concat(cards.slice(0, 50));
  }
  var wired = false;
  function wireEngine() {
    var E = HOARD.engine;
    if (wired || !E || typeof E.on !== 'function') return;
    wired = true;
    E.on('buy', function (d) { if (d && !d.auto && !(E.inAuto && E.inAuto())) play('buy', d); });   // auto-buyers stay silent
    E.on('rank', function () { play('rank'); });
    E.on('sleep', function () { play('sleep'); });
    E.on('chest', function (cards) { chestEvent(cards, !!(E.inAuto && E.inAuto())); });   // Chest Kobold: quiet
    E.on('lore', function (d) { play('lore', d); });
    E.on('myth', function () { play('myth'); });
    E.on('ember', function (d) {
      if (!d) return;
      if (d.type === 'wake') play('emberWake');
      else if (d.type === 'breath') play('lore');
    });
    E.on('event', function (d) {
      if (!d) return;
      if (d.type === 'start') play('eventStart');
      else if (d.type === 'quest' && !d.auto) play('questDone');
      else if (d.type === 'complete') play('rank');
      else if (d.type === 'chest') chestEvent(d.cards, d.auto);
    });
  }
  function caveHook(name, d) {
    if (name === 'coin' || name === 'streakUp' || name === 'gust' || name === 'treasure') play(name, d);
  }
  function wireCave() {
    var C = HOARD.cave;
    if (!C || typeof C.addSfxHook !== 'function') return false;
    C.addSfxHook(caveHook);
    return true;
  }
  function wireDom() {
    if (!hasDom) return;
    var gesture = function () { unlock(); };
    document.addEventListener('pointerdown', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('touchend', function () { unlock(); }, true);   // iOS unlocks on touchend
    var vis = function () {
      hidden = !!document.hidden;
      if (hidden) suspend();
      else if (ctx && enabled()) unlock();
    };
    document.addEventListener('visibilitychange', vis);
    if (typeof G.addEventListener === 'function') {
      G.addEventListener('pagehide', function () { hidden = true; suspend(); });
      G.addEventListener('pageshow', function () { vis(); });
    }
    try { if (G.navigator && G.navigator.audioSession) G.navigator.audioSession.type = 'ambient'; } catch (e) { /* ignore */ }
  }

  function settingRows() {
    var ui = HOARD.ui;
    if (!ui || typeof ui.addSetting !== 'function' || typeof ui.el !== 'function') return;
    ui.addSetting({ id: 'sound', order: 30, build: function (host) {
      var el = ui.el;
      var t = ui.toggle('Sound', function (s) { return enabled(s); }, function (s, v) {
        setEnabled(s, v);
        if (v) setTimeout(function () { play('preview'); }, 60);
      });
      host.appendChild(t.row);
      var vr = el('div', 'toggle-row snd-vol');
      var lab = el('span', 'tl');
      lab.appendChild(el('span', null, 'Volume'));
      var pct = el('small', 'sub');
      lab.appendChild(pct);
      var rng = el('input', 'snd-range');
      rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '5';
      rng.setAttribute('aria-label', 'Sound volume');
      var s0 = S();
      rng.value = String(Math.round(volume(s0) * 100));
      var onIn = function () {
        var s = S();
        if (!s) return;
        unlock();
        setVolume(s, (+rng.value || 0) / 100);
        rng._p = rng.value + '%'; rng.style.setProperty('--p', rng._p);
        play('preview');
      };
      rng.addEventListener('input', onIn);
      rng.addEventListener('change', onIn);
      vr.appendChild(lab); vr.appendChild(rng);
      host.appendChild(vr);
      return function (s) {
        t.patch(s);
        var on = enabled(s);
        ui.setText(pct, on ? Math.round(volume(s) * 100) + '%' : 'Sound is off');
        ui.setCls(vr, 'off', !on);
        if (document.activeElement !== rng) {
          var v = String(Math.round(volume(s) * 100));
          if (rng.value !== v) rng.value = v;
        }
        var pv = rng.value + '%';
        if (rng._p !== pv) { rng._p = pv; rng.style.setProperty('--p', pv); }
      };
    } });
    ui.css(
      '.snd-vol{gap:14px}.snd-vol.off{opacity:.5}.snd-vol .tl small{font-variant-numeric:tabular-nums}' +
      '.snd-range{-webkit-appearance:none;appearance:none;flex:0 1 190px;min-width:120px;height:44px;margin:0;background:transparent;touch-action:pan-y;cursor:pointer}' +
      '.snd-range:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:6px}' +
      '.snd-range::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--gold-lo),var(--gold) var(--p,40%),var(--rock-3) var(--p,40%));box-shadow:inset 0 0 0 1px var(--line-2)}' +
      '.snd-range::-moz-range-track{height:6px;border-radius:3px;background:var(--rock-3)}' +
      '.snd-range::-moz-range-progress{height:6px;border-radius:3px;background:var(--gold)}' +
      '.snd-range::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;margin-top:-9px;border-radius:50%;background:var(--gold-hi);border:2px solid var(--cave);box-shadow:0 0 0 1px var(--gold-lo),0 2px 6px rgba(0,0,0,.5)}' +
      '.snd-range::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:var(--gold-hi);border:2px solid var(--cave)}',
      'sound');
  }

  var SND = {
    play: play,
    unlock: unlock,
    suspend: suspend,
    enabled: enabled,
    volume: volume,
    setEnabled: setEnabled,
    setVolume: setVolume,
    gainFor: gainFor,
    names: Object.keys(SFX),
    context: function () { return ctx; },
    info: function () {
      var p = {};
      for (var k in played) if (Object.prototype.hasOwnProperty.call(played, k)) p[k] = played[k];
      return { state: ctx ? ctx.state : 'none', voices: voices, played: p, dropped: dropped, volume: appliedVol, hidden: hidden };
    },
    // wiring entry points (browser: run by whenReady; tests call them directly)
    wire: function (gs) {
      if (typeof gs === 'function') getState = gs;
      wireEngine();
      wireCave();
    },
    // test hooks (tools/test-polish.cjs): a fake AudioContext factory and a state getter
    _test: {
      useFactory: function (fn) { factory = fn; ctx = null; out = send = master = noiseBuf = null; voices = 0; last = {}; played = {}; dropped = 0; },
      setState: function (fn) { getState = fn; },
      setHidden: function (h) { hidden = !!h; if (hidden) suspend(); },
      chestEvent: chestEvent,
      caveHook: caveHook
    }
  };
  HOARD.sound = SND;

  wireDom();
  if (typeof HOARD.whenReady === 'function') {
    HOARD.whenReady(function (gs) {
      SND.wire(gs);
      settingRows();
    });
  }
})();
