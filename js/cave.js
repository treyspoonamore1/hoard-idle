/* Hoard — cave.js
 * HOARD.cave: the canvas scene (stalactite cave, gold hoard, baby dragon, coins,
 * treasures, particles) and all swipe input (coins, stroke gold, streak, wing gust).
 * Owns only visual state; every gold change goes through HOARD.engine.*.
 */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var cave = (HOARD.cave = HOARD.cave || {});
  if (typeof cave.onFloat === 'undefined') cave.onFloat = null;

  if (typeof document === 'undefined') {
    // Node / headless sim: harmless no-op API.
    cave.init = cave.frame = cave.resize = cave.gust = cave.addLayer = cave.removeLayer = cave.addSfxHook = cave.float = cave.burst = function () {};
    cave.addSwipeHook = cave.removeSwipeHook = cave.setHudDim = cave.setDragonScale = cave.setDragonDecor = function () {};
    cave.hudDim = function () { return 1; };
    cave.streak = function () { return 1; };
    cave.anchor = function () { return { x: 0, y: 0, cx: 0, cy: 0 }; };
    cave.metrics = function () { return null; };
    cave.coinCount = cave.nugCount = function () { return 0; };
    cave.nuggets = function () { return []; };
    return;
  }

  // ---------------------------------------------------------------- constants
  var MAX_COINS = 70, MAX_PARTS = 120, MAX_FLOATS = 20, TRAIL_N = 48, GH_N = 40, DUST_N = 18;
  var COIN_HIT = 36, TREASURE_HIT = 36, STROKE_STEP = 120;
  var ST_LV = [1, 2, 3, 5, 8], ST_AT = [0, 1.5, 4, 8, 15];
  var ST_MIN_SPEED = 50, ST_DECAY = 0.7;
  var GUST_PATH = 140, GUST_MS = 220, GUST_SPEED = 1400;
  var GRAV = 680, AIR_DRAG = 2.0, MAGNET_R = 70, MAGNET_V = 600, TRAIL_LIFE = 0.34, TREASURE_LIFE = 13, FLOAT_BATCH = 0.15;
  var P_SPARK = 0, P_FLY = 1, P_LINE = 2, P_SMOKE = 3, P_STAR = 4;
  var TAU = Math.PI * 2;
  var FONT_D = '"Grenze Gotisch", Georgia, serif';
  var FONT_B = '"Alegreya Sans", system-ui, sans-serif';
  var F_FLOAT = '600 20px ' + FONT_D, F_FLOAT_BIG = '600 30px ' + FONT_D;
  var F_STREAK = '600 18px ' + FONT_D, F_TITLE = '600 30px ' + FONT_D, F_TEXT = '500 15px ' + FONT_B;
  var F_FINGER = '600 15px ' + FONT_D;

  // dragon / kobold colours (original creature palette; jade dragon on gold)
  var D_HI = '#72c6b2', D_MID = '#3f8f84', D_LO = '#24555a', D_BELLY = '#efdcae', D_BELLY_LINE = 'rgba(150,110,60,0.45)';
  var D_HORN = '#f3e6c8', D_SPIKE = '#f0c66a', D_DARK = '#173634', D_PAW = '#3a8076';
  var K_BODY = '#8c7a52', K_BELLY = '#c9b483', K_EAR = '#6e5e3e', K_STICK = '#7a5130', K_STRAW = '#d6b25e';
  var GEMS = ['#e0445a', '#4f8cff', '#3fc58a', '#b06cff', '#ffe08a'];

  // ---------------------------------------------------------------- scene state
  var canvas = null, ctx = null, getState = null, inited = false;
  var W = 1, H = 1, dpr = 1, baseY = 1, unit = 1, coinR = 8, dk = 1, sizeKey = '';
  var rectL = 0, rectT = 0;
  var bgCv = null, pileCv = null, pileKey = -999, pileW = 40, pileH = 12, pileCw = 1, pileCh = 1, pileOx = 0, pileOy = 0;
  var sprFace = null, sprLie = null, sprGlow = null, sprEmber = null, sprStar = null, sprNug = null;
  var glowGrad = null, glowHot = null, dragonGrad = null, headGrad = null, wingGrad = null;
  var C = {
    cave: '#16131f', rock: '#221d2e', rock2: '#2d2640', gold: '#f2b84b', goldHi: '#ffe08a',
    ember: '#e8633a', moss: '#7fc29b', ink: '#efe6d6', inkDim: '#a59cb3',
    goldRGB: '242,184,75', goldHiRGB: '255,224,138', emberRGB: '232,99,58', rock2RGB: '45,38,64'
  };
  var S = null, E = null, clock = 0, rm = false, mql = null;
  var st = { coinWorth: 1, spillRate: 1.5, sweepRate: 0, gustWorthMult: 3, maxStreak: 5, emberActive: false, frenzyActive: false, minesOpen: false };
  // Ore nuggets (js/mines.js, SPEC-MINES B6): while the Mines are open 1 spilled coin in NUG_EVERY is a blue-grey nugget.
  // It pays like a coin and also digs Ore; it never merges, brooms leave it, only swipes and the player's own gusts
  // collect it (Restless Wings' auto-gust leaves nuggets on the floor: they are the swipe reward, review M1). Resting
  // nuggets keep out from under the Gust and Stars buttons (review M2) and fully on screen (code review #4).
  var NUG_EVERY = 8, NUG_MAX = 6, NUG_FILL = '#6fa3cf', NUG_FLOAT = '#9fc3d9', pendNug = 0;
  // canvas-local x spans of the buttons that sit over the floor (refreshed 4x a second; no allocation per frame)
  var nugZones = [{ l: 0, r: 0 }, { l: 0, r: 0 }], nugZoneN = 0, NUG_BTN_IDS = ['gust', 'skybtn'];
  var stT = 0, stTop = 3, tiMin = 70, tiMax = 130;

  // pools
  var coins = [], coinCount = 0, mergeCur = 0, i0;
  for (i0 = 0; i0 < MAX_COINS; i0++) coins.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, r: 8, v: 1, born: 0, spin: 0, sv: 0, g: false, pulse: 0, yo: 0, n: false, ph: 0 });
  var parts = [], partCount = 0;
  for (i0 = 0; i0 < MAX_PARTS; i0++) parts.push({ on: false, k: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s: 1, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, rot: 0 });
  var floats = [];
  for (i0 = 0; i0 < MAX_FLOATS; i0++) floats.push({ on: false, x: 0, y: 0, txt: '', life: 0, max: 1, big: false, col: '' });
  var dust = [];
  for (i0 = 0; i0 < DUST_N; i0++) dust.push({ x: 0, y: 0, s: 1, ph: 0, sp: 1 });
  var tX = new Float32Array(TRAIL_N), tY = new Float32Array(TRAIL_N), tT = new Float64Array(TRAIL_N), tB = new Uint8Array(TRAIL_N);
  var tHead = 0, tCount = 0;
  var ghX = new Float64Array(GH_N), ghY = new Float64Array(GH_N), ghT = new Float64Array(GH_N), ghD = new Float64Array(GH_N);
  var ghHead = 0, ghN = 0;

  // pointer / swipe
  var down = false, pid = -1, px = 0, py = 0, fx = -1, fy = -1, frameMove = 0, spd = 0, newStroke = true;
  var strokePx = 0, pendN = 0, pendV = 0, gainX = 0, gainY = 0;
  var gA = { g: 0, t: 0, x: 0, y: 0 }, gB = { g: 0, t: 0, x: 0, y: 0 }, gO = { g: 0, t: 0, x: 0, y: 0, ore: true };
  // streak
  var stkT = 0, stkIdx = 0, stillT = 0, decayT = 0, stkPulse = 0, stkShow = 0, stkLabel = '×1', stkLabelV = 1;
  // spill
  var spillAcc = 0, swarmLeft = 0, swarmAcc = 0, swarmX = 0, swarmY = 0;
  // sweeper kobold
  var kob = { on: false, x: 0, dir: -1, tgt: -1, re: 0, sweep: 0, walk: 0 }, sweepAcc = 0;
  // treasure
  var tr = { on: false, kind: 0, x: 0, y: 0, x0: 0, y0: 0, dir: 1, t: 0, spark: 0 }, trTimer = 40;
  var bn = { life: 0, max: 2.8, title: '', text: '' };
  // dragon + fx
  var blinkT = 3, blinkA = 0, lookX = 0, lookY = 0, wingA = 0, hopT = 0, smokeT = 5;
  var shakeT = 0, flashA = 0, pileBump = 0, glintT = 0;

  // ---------------------------------------------------------------- extension hooks (SPEC-V2 0.4, EXTENSIONS.md)
  var layers = [];      // { id, z, draw(ctx, w, h, t, dt, state), _err }
  var sfxHooks = [];    // fn(name, data)
  var frameDt = 0, stRamp = 1;
  // Starfall (js/ui-sky.js): swipe hooks see every swipe segment, the top-left HUD can dim, the dragon can grow
  var swipeHooks = [];  // { fn(px, py, x, y, t, strokeSeq), err }
  var strokeSeq = 0, hudDim = 1, dScale = 1, decor = null, decorErr = 0;
  function dkS() { return dk * dScale; }
  function runSwipeHooks(ax, ay, bx, by, t) {
    for (var i = 0; i < swipeHooks.length; i++) {
      var h = swipeHooks[i];
      try { h.fn(ax, ay, bx, by, t, strokeSeq); } catch (e) {
        h.err++;
        if (h.err === 1) { try { console.error('[HOARD] cave swipe hook', e); } catch (e2) { /* ignore */ } }
        if (h.err >= 5) { swipeHooks.splice(i, 1); i--; }
      }
    }
  }
  // dragon decorations drawn inside the dragon's own transform (so they follow its hop, breath and head turn)
  function drawDecor(g, part) {
    if (!decor || decorErr >= 5) return;
    g.save();
    try { decor(g, part, clock, rm); } catch (e) {
      decorErr++;
      if (decorErr === 1) { try { console.error('[HOARD] dragon decor', e); } catch (e2) { /* ignore */ } }
    }
    g.restore();
  }
  function sfx(name, data) {
    for (var i = 0; i < sfxHooks.length; i++) {
      try { sfxHooks[i](name, data); } catch (e) { /* a sound bug must never break swiping */ }
    }
  }
  function drawLayers(front) {
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if ((L.z >= 0) !== front || L._err >= 5) continue;
      ctx.save();
      try { L.draw(ctx, W, H, clock, frameDt, S); } catch (e) {
        L._err = (L._err || 0) + 1;
        if (L._err === 1) { try { console.error('[HOARD] cave layer ' + L.id, e); } catch (e2) { /* ignore */ } }
      }
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---------------------------------------------------------------- helpers
  function num(v, fb) { return (typeof v === 'number' && isFinite(v)) ? v : fb; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRGB(hex, fb) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return fb;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  function fmtNum(n) {
    var f = HOARD.fmt;
    if (typeof f === 'function') { try { var s = f(n); if (typeof s === 'string') return s; } catch (e) { /* fall through */ } }
    if (!(n >= 0) || !isFinite(n)) return '0';
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
    var u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'], i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + u[i];
  }
  function eNum(name, a, b, c) {
    var f = E && E[name];
    if (typeof f !== 'function' || !S) return 0;
    try { var r = f(S, a, b, c); return num(r, 0); } catch (err) { return 0; }
  }
  function eCall(name, a, b) {
    var f = E && E[name];
    if (typeof f !== 'function' || !S) return undefined;
    try { return f(S, a, b); } catch (err) { return undefined; }
  }
  function buzz(ms) {
    if (!S || !S.settings || !S.settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }
  function segHit(ax, ay, bx, by, cx, cy, r) {
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = 0;
    if (L > 0) { t = ((cx - ax) * dx + (cy - ay) * dy) / L; if (t < 0) t = 0; else if (t > 1) t = 1; }
    var ex = ax + dx * t - cx, ey = ay + dy * t - cy;
    return ex * ex + ey * ey <= r * r;
  }
  function ell(g, x, y, rx, ry, rot) {
    g.beginPath();
    g.ellipse(x, y, rx > 0 ? rx : 0.01, ry > 0 ? ry : 0.01, rot || 0, 0, TAU);
  }
  function moundH(dx, pw, ph) {
    var u = dx / pw;
    if (u <= -1 || u >= 1) return 0;
    var t = 1 - u * u;
    return ph * t * Math.sqrt(t);
  }
  function groundY(x) { return baseY - moundH(x - W * 0.5, pileW, pileH); }
  function dragonHalf() { return 44 * dkS(); }
  function peakY() { return baseY - pileH; }

  // ---------------------------------------------------------------- palette + sprites
  function readPalette() {
    var cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    function v(name, fb) {
      var s = cs ? String(cs.getPropertyValue(name) || '').trim() : '';
      return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? s : fb;
    }
    C.cave = v('--cave', '#16131f'); C.rock = v('--rock', '#221d2e'); C.rock2 = v('--rock-2', '#2d2640');
    C.gold = v('--gold', '#f2b84b'); C.goldHi = v('--gold-hi', '#ffe08a'); C.ember = v('--ember', '#e8633a');
    C.moss = v('--moss', '#7fc29b'); C.ink = v('--ink', '#efe6d6'); C.inkDim = v('--ink-dim', '#a59cb3');
    C.goldRGB = hexRGB(C.gold, '242,184,75'); C.goldHiRGB = hexRGB(C.goldHi, '255,224,138');
    C.emberRGB = hexRGB(C.ember, '232,99,58'); C.rock2RGB = hexRGB(C.rock2, '45,38,64');
  }
  function makeSprite(w, h, fn) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * dpr)); cv.height = Math.max(1, Math.ceil(h * dpr));
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    fn(g, w, h);
    cv.cw = w; cv.ch = h;
    return cv;
  }
  function makeSprites() {
    sprFace = makeSprite(24, 24, function (g) {
      g.translate(12, 12);
      var rg = g.createRadialGradient(-3, -4, 1, 0, 0, 10);
      rg.addColorStop(0, C.goldHi); rg.addColorStop(0.55, C.gold); rg.addColorStop(1, '#a8701f');
      g.fillStyle = rg; ell(g, 0, 0, 10, 10); g.fill();
      g.lineWidth = 1.3; g.strokeStyle = '#7d5214'; g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,236,180,0.55)'; ell(g, 0, 0, 6.6, 6.6); g.stroke();
      g.fillStyle = 'rgba(140,90,20,0.55)';
      g.beginPath(); g.moveTo(0, -3.4); g.lineTo(2.4, 0); g.lineTo(0, 3.4); g.lineTo(-2.4, 0); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,240,0.9)'; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, 7.8, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
    });
    sprLie = makeSprite(24, 14, function (g) {
      g.translate(12, 6);
      g.fillStyle = '#8a5a16'; ell(g, 0, 2.4, 10, 4.6); g.fill();
      var rg = g.createRadialGradient(-3, -1.5, 0.5, 0, 0, 10);
      rg.addColorStop(0, C.goldHi); rg.addColorStop(0.6, C.gold); rg.addColorStop(1, '#b37a24');
      g.fillStyle = rg; ell(g, 0, 0, 10, 4.4); g.fill();
      g.strokeStyle = 'rgba(255,236,180,0.55)'; g.lineWidth = 0.9; ell(g, 0, 0, 6.4, 2.8); g.stroke();
      g.strokeStyle = 'rgba(255,255,240,0.85)'; g.lineWidth = 1.2; g.lineCap = 'round';
      g.beginPath(); g.ellipse(0, 0, 8, 3.3, 0, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    });
    function glow(rgbA, rgbB) {
      return makeSprite(64, 64, function (g) {
        var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        rg.addColorStop(0, 'rgba(' + rgbA + ',1)'); rg.addColorStop(0.3, 'rgba(' + rgbB + ',0.42)');
        rg.addColorStop(1, 'rgba(' + rgbB + ',0)');
        g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      });
    }
    sprGlow = glow(C.goldHiRGB, C.goldRGB);
    // Ore nugget: a lumpy steel-blue rock with a darker edge and two pale facets (the glint is drawn live)
    sprNug = makeSprite(28, 28, function (g) {
      var pts = [[-0.86, -0.18], [-0.52, -0.78], [0.08, -0.9], [0.66, -0.6], [0.92, 0.02], [0.6, 0.7], [-0.04, 0.88], [-0.7, 0.56]];
      g.translate(14, 14);
      g.beginPath();
      for (var i = 0; i < pts.length; i++) { var q = pts[i]; if (i) g.lineTo(q[0] * 12, q[1] * 12); else g.moveTo(q[0] * 12, q[1] * 12); }
      g.closePath();
      var rg = g.createLinearGradient(-10, -10, 10, 12);
      rg.addColorStop(0, '#b6d8f2'); rg.addColorStop(0.45, NUG_FILL); rg.addColorStop(1, '#2f5f86');   // bluer than the pile's gems (review N9)
      g.fillStyle = rg; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = '#2f4656'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.beginPath(); g.moveTo(-6, -7); g.lineTo(1, -9.5); g.lineTo(-1, -3); g.closePath(); g.fill();
      g.fillStyle = 'rgba(20,36,48,0.35)';
      g.beginPath(); g.moveTo(3, 3); g.lineTo(10, 1); g.lineTo(6, 8); g.closePath(); g.fill();
    });
    sprEmber = glow('255,200,140', C.emberRGB);
    sprStar = makeSprite(32, 32, function (g) {
      g.translate(16, 16);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, 9);
      rg.addColorStop(0, 'rgba(255,250,225,0.9)'); rg.addColorStop(1, 'rgba(' + C.goldHiRGB + ',0)');
      g.fillStyle = rg; g.fillRect(-16, -16, 32, 32);
      g.fillStyle = '#fffbe8';
      g.beginPath();
      g.moveTo(0, -15); g.quadraticCurveTo(1.4, -1.4, 15, 0); g.quadraticCurveTo(1.4, 1.4, 0, 15);
      g.quadraticCurveTo(-1.4, 1.4, -15, 0); g.quadraticCurveTo(-1.4, -1.4, 0, -15);
      g.fill();
    });
  }
  function drawSpr(spr, x, y, w, h) { ctx.drawImage(spr, x - w * 0.5, y - h * 0.5, w, h); }

  function makeGradients() {
    var R = Math.max(W, H);
    glowGrad = ctx.createRadialGradient(W * 0.5, baseY, 0, W * 0.5, baseY, R * 0.75);
    glowGrad.addColorStop(0, 'rgba(' + C.goldRGB + ',0.34)');
    glowGrad.addColorStop(0.4, 'rgba(' + C.goldRGB + ',0.08)');
    glowGrad.addColorStop(1, 'rgba(' + C.goldRGB + ',0)');
    glowHot = ctx.createRadialGradient(W * 0.5, baseY, 0, W * 0.5, baseY, R * 0.85);
    glowHot.addColorStop(0, 'rgba(' + C.emberRGB + ',0.42)');
    glowHot.addColorStop(0.45, 'rgba(' + C.emberRGB + ',0.10)');
    glowHot.addColorStop(1, 'rgba(' + C.emberRGB + ',0)');
    // dragon gradients live in the dragon's local (unscaled) space
    dragonGrad = ctx.createLinearGradient(0, -62, 0, 10);
    dragonGrad.addColorStop(0, D_HI); dragonGrad.addColorStop(0.55, D_MID); dragonGrad.addColorStop(1, D_LO);
    headGrad = ctx.createLinearGradient(0, -14, 0, 13);
    headGrad.addColorStop(0, D_HI); headGrad.addColorStop(1, D_MID);
    wingGrad = ctx.createLinearGradient(-20, -40, 0, 8);
    wingGrad.addColorStop(0, '#5aa898'); wingGrad.addColorStop(1, '#2b5f5d');
  }

  // ---------------------------------------------------------------- backdrop (baked per resize)
  function spike(g, rnd, x, y0, w, len, dir, dark, mid, light, warm) {
    var tipX = x + (rnd() - 0.5) * w * 0.35, tipY = y0 + dir * len;
    var j1 = (rnd() - 0.5) * w * 0.2, j2 = (rnd() - 0.5) * w * 0.2;
    g.beginPath();
    g.moveTo(x - w / 2, y0);
    g.quadraticCurveTo(x - w * 0.42 + j1, y0 + dir * len * 0.35, x - w * 0.16 + j1, y0 + dir * len * 0.62);
    g.quadraticCurveTo(tipX - w * 0.06, y0 + dir * len * 0.9, tipX, tipY);
    g.quadraticCurveTo(tipX + w * 0.07, y0 + dir * len * 0.85, x + w * 0.18 + j2, y0 + dir * len * 0.55);
    g.quadraticCurveTo(x + w * 0.44 + j2, y0 + dir * len * 0.28, x + w / 2, y0);
    g.closePath();
    var litRight = x < W * 0.5;
    var hg = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    hg.addColorStop(0, litRight ? dark : light); hg.addColorStop(0.55, mid); hg.addColorStop(1, litRight ? light : dark);
    g.fillStyle = hg; g.fill();
    if (warm > 0) {
      var vg = g.createLinearGradient(0, y0, 0, tipY);
      vg.addColorStop(0, 'rgba(' + C.goldRGB + ',0)'); vg.addColorStop(1, 'rgba(' + C.goldRGB + ',' + warm + ')');
      g.fillStyle = vg; g.fill();
    }
    if (dir > 0 && rnd() < 0.22) {
      g.fillStyle = 'rgba(' + C.goldHiRGB + ',0.45)';
      ell(g, tipX, tipY + 2, 1.3, 1.8); g.fill();
    }
  }
  function bakeBg() {
    bgCv.width = Math.max(1, Math.round(W * dpr)); bgCv.height = Math.max(1, Math.round(H * dpr));
    var g = bgCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var rnd = rng(9137 + Math.round(W) * 31 + Math.round(H));
    var i, n, x, y, R = Math.max(W, H);
    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#0b0912'); lg.addColorStop(0.5, C.cave); lg.addColorStop(1, C.rock);
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    var rg = g.createRadialGradient(W / 2, baseY, 0, W / 2, baseY, R * 0.95);
    rg.addColorStop(0, 'rgba(' + C.goldRGB + ',0.22)'); rg.addColorStop(0.35, 'rgba(' + C.goldRGB + ',0.07)');
    rg.addColorStop(1, 'rgba(' + C.goldRGB + ',0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    // rock texture blotches
    for (i = 0; i < 34; i++) {
      g.fillStyle = 'rgba(' + C.rock2RGB + ',' + (0.12 + rnd() * 0.22).toFixed(3) + ')';
      ell(g, rnd() * W, rnd() * H * 0.92, 18 + rnd() * 70, 8 + rnd() * 36, rnd() * Math.PI); g.fill();
    }
    // faint gold veins in the far wall
    g.lineWidth = 1; g.lineCap = 'round';
    for (i = 0; i < 7; i++) {
      x = rnd() * W; y = H * (0.15 + rnd() * 0.6);
      g.strokeStyle = 'rgba(' + C.goldRGB + ',' + (0.07 + rnd() * 0.08).toFixed(3) + ')';
      g.beginPath(); g.moveTo(x, y);
      for (n = 0; n < 9; n++) { x += (rnd() - 0.3) * 22; y += (rnd() - 0.5) * 14; g.lineTo(x, y); }
      g.stroke();
      g.fillStyle = 'rgba(' + C.goldHiRGB + ',0.35)';
      ell(g, x, y, 1, 1); g.fill();
    }
    // far stalactites
    n = Math.ceil(W / 16);
    for (i = 0; i < n; i++) {
      spike(g, rnd, (i + rnd() * 0.8) / n * W, -2, 10 + rnd() * 22, H * (0.05 + rnd() * 0.22), 1, '#1a1626', C.rock2, '#3c3354', 0.10);
    }
    // mid stalactites
    n = Math.ceil(W / 34);
    for (i = 0; i < n; i++) {
      spike(g, rnd, (i + 0.2 + rnd() * 0.6) / n * W, -2, 22 + rnd() * 30, H * (0.12 + rnd() * 0.26), 1, '#110e19', C.rock, '#30283f', 0.07);
    }
    // stalagmites on the sides
    for (i = 0; i < 6; i++) {
      x = (i % 2) ? W * (0.8 + rnd() * 0.22) : W * (rnd() * 0.2);
      spike(g, rnd, x, baseY + 6, 22 + rnd() * 38, H * (0.08 + rnd() * 0.2), -1, '#0f0c17', '#1c1727', '#2c2539', 0.06);
    }
    // near silhouettes framing the scene
    spike(g, rnd, W * 0.04, -6, Math.max(60, W * 0.22), H * 0.52, 1, '#07060b', '#0b0911', '#16121f', 0.05);
    spike(g, rnd, W * 0.97, -6, Math.max(56, W * 0.2), H * 0.46, 1, '#07060b', '#0b0911', '#16121f', 0.05);
    spike(g, rnd, W * 0.2, -4, 28, H * 0.2, 1, '#08070d', '#0c0a12', '#17131f', 0.04);
    spike(g, rnd, W * 0.83, -4, 24, H * 0.24, 1, '#08070d', '#0c0a12', '#17131f', 0.04);
    // ceiling band
    g.fillStyle = '#09070e';
    g.beginPath(); g.moveTo(0, 0);
    for (x = 0; x <= W + 10; x += 10) g.lineTo(x, 3 + rnd() * 10);
    g.lineTo(W, 0); g.closePath(); g.fill();
    // crystal clusters glowing faintly on the walls
    for (i = 0; i < 3; i++) {
      var cx = (i === 1) ? W * (0.84 + rnd() * 0.1) : W * (0.04 + rnd() * 0.12) + (i === 2 ? W * 0.02 : 0);
      var cy = H * (0.36 + rnd() * 0.32) + (i === 2 ? H * 0.12 : 0);
      var cg = g.createRadialGradient(cx, cy, 0, cx, cy, 46);
      cg.addColorStop(0, 'rgba(150,130,255,0.22)'); cg.addColorStop(1, 'rgba(150,130,255,0)');
      g.fillStyle = cg; g.fillRect(cx - 46, cy - 46, 92, 92);
      var m = 3 + Math.floor(rnd() * 3);
      for (n = 0; n < m; n++) {
        var a = -Math.PI / 2 + (rnd() - 0.5) * 1.6, L = 9 + rnd() * 16, wd = 2.5 + rnd() * 2.5;
        g.save(); g.translate(cx + (rnd() - 0.5) * 12, cy + 6); g.rotate(a + Math.PI / 2);
        var pg = g.createLinearGradient(-wd, 0, wd, 0);
        pg.addColorStop(0, '#3b2f7a'); pg.addColorStop(0.5, '#9a8bff'); pg.addColorStop(1, '#4a3d93');
        g.fillStyle = pg; g.globalAlpha = 0.8;
        g.beginPath(); g.moveTo(-wd, 0); g.lineTo(-wd, -L); g.lineTo(0, -L - wd * 1.6); g.lineTo(wd, -L); g.lineTo(wd, 0); g.closePath(); g.fill();
        g.globalAlpha = 1; g.restore();
      }
    }
    // floor
    var fy0 = baseY + 1, pts = [];
    for (x = 0; x <= W + 14; x += 14) pts.push(x, fy0 + rnd() * 5);
    var fg = g.createLinearGradient(0, fy0, 0, H);
    fg.addColorStop(0, '#16121f'); fg.addColorStop(1, '#0a0810');
    g.fillStyle = fg;
    g.beginPath(); g.moveTo(0, H);
    for (i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.lineTo(W, H); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(' + C.goldRGB + ',0.16)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
    // vignette
    var vg = g.createRadialGradient(W / 2, H * 0.58, Math.min(W, H) * 0.32, W / 2, H * 0.58, R * 0.78);
    vg.addColorStop(0, 'rgba(6,4,12,0)'); vg.addColorStop(1, 'rgba(6,4,12,0.72)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- treasure shapes (shared by pile + drifting treasures)
  function shapeGoblet(g, s) {
    g.fillStyle = '#b5791f';
    g.beginPath(); g.moveTo(-0.7 * s, -0.66 * s);
    g.quadraticCurveTo(-0.72 * s, 0.18 * s, 0, 0.22 * s);
    g.quadraticCurveTo(0.72 * s, 0.18 * s, 0.7 * s, -0.66 * s);
    g.closePath(); g.fill();
    g.fillStyle = C.gold;
    g.beginPath(); g.moveTo(-0.62 * s, -0.66 * s);
    g.quadraticCurveTo(-0.6 * s, 0.08 * s, 0, 0.12 * s);
    g.quadraticCurveTo(0.2 * s, -0.2 * s, 0.1 * s, -0.66 * s);
    g.closePath(); g.fill();
    g.fillStyle = C.goldHi; ell(g, 0, -0.68 * s, 0.7 * s, 0.17 * s); g.fill();
    g.fillStyle = '#6b4310'; ell(g, 0, -0.68 * s, 0.56 * s, 0.1 * s); g.fill();
    g.fillStyle = C.gold; g.fillRect(-0.1 * s, 0.18 * s, 0.2 * s, 0.42 * s);
    g.fillStyle = '#c88a2a'; ell(g, 0, 0.66 * s, 0.46 * s, 0.14 * s); g.fill();
    g.fillStyle = GEMS[0]; ell(g, 0, -0.26 * s, 0.15 * s, 0.15 * s); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; ell(g, -0.05 * s, -0.31 * s, 0.05 * s, 0.05 * s); g.fill();
  }
  function shapeCrown(g, s) {
    g.fillStyle = C.gold;
    g.beginPath(); g.moveTo(-0.8 * s, 0.1 * s); g.lineTo(-0.85 * s, -0.55 * s); g.lineTo(-0.42 * s, -0.12 * s);
    g.lineTo(0, -0.78 * s); g.lineTo(0.42 * s, -0.12 * s); g.lineTo(0.85 * s, -0.55 * s); g.lineTo(0.8 * s, 0.1 * s);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,240,190,0.55)';
    g.beginPath(); g.moveTo(-0.7 * s, 0.05 * s); g.lineTo(-0.75 * s, -0.4 * s); g.lineTo(-0.42 * s, -0.05 * s); g.closePath(); g.fill();
    g.fillStyle = '#b5791f'; g.fillRect(-0.82 * s, 0.08 * s, 1.64 * s, 0.4 * s);
    g.fillStyle = C.goldHi; g.fillRect(-0.82 * s, 0.08 * s, 1.64 * s, 0.1 * s);
    g.fillStyle = C.goldHi;
    ell(g, -0.85 * s, -0.58 * s, 0.1 * s, 0.1 * s); g.fill();
    ell(g, 0, -0.82 * s, 0.11 * s, 0.11 * s); g.fill();
    ell(g, 0.85 * s, -0.58 * s, 0.1 * s, 0.1 * s); g.fill();
    g.fillStyle = GEMS[0]; ell(g, 0, 0.28 * s, 0.12 * s, 0.12 * s); g.fill();
    g.fillStyle = GEMS[1]; ell(g, -0.45 * s, 0.28 * s, 0.09 * s, 0.09 * s); g.fill();
    g.fillStyle = GEMS[2]; ell(g, 0.45 * s, 0.28 * s, 0.09 * s, 0.09 * s); g.fill();
  }
  function shapeRing(g, s) {
    g.lineWidth = 0.24 * s; g.strokeStyle = '#b5791f';
    ell(g, 0, 0.18 * s, 0.6 * s, 0.6 * s); g.stroke();
    g.lineWidth = 0.1 * s; g.strokeStyle = C.goldHi;
    g.beginPath(); g.arc(0, 0.18 * s, 0.6 * s, Math.PI * 0.95, Math.PI * 1.6); g.stroke();
    g.fillStyle = C.gold; ell(g, 0, -0.42 * s, 0.26 * s, 0.14 * s); g.fill();
    g.fillStyle = '#6fb0ff';
    g.beginPath(); g.moveTo(-0.3 * s, -0.5 * s); g.lineTo(-0.16 * s, -0.78 * s); g.lineTo(0.16 * s, -0.78 * s);
    g.lineTo(0.3 * s, -0.5 * s); g.lineTo(0, -0.3 * s); g.closePath(); g.fill();
    g.fillStyle = 'rgba(230,245,255,0.8)';
    g.beginPath(); g.moveTo(-0.16 * s, -0.78 * s); g.lineTo(0, -0.5 * s); g.lineTo(-0.3 * s, -0.5 * s); g.closePath(); g.fill();
  }
  function shapeGem(g, s, col) {
    g.fillStyle = col || '#c27cff';
    g.beginPath(); g.moveTo(-0.7 * s, -0.2 * s); g.lineTo(-0.4 * s, -0.56 * s); g.lineTo(0.4 * s, -0.56 * s);
    g.lineTo(0.7 * s, -0.2 * s); g.lineTo(0, 0.72 * s); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.beginPath(); g.moveTo(-0.4 * s, -0.56 * s); g.lineTo(-0.15 * s, -0.2 * s); g.lineTo(0, 0.72 * s); g.lineTo(-0.7 * s, -0.2 * s); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.moveTo(0.4 * s, -0.56 * s); g.lineTo(0.7 * s, -0.2 * s); g.lineTo(0, 0.72 * s); g.lineTo(0.2 * s, -0.2 * s); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = Math.max(0.6, s * 0.05);
    g.beginPath(); g.moveTo(-0.7 * s, -0.2 * s); g.lineTo(0.7 * s, -0.2 * s); g.stroke();
  }
  function drawShape(g, kind, s) {
    if (kind === 0) shapeGoblet(g, s);
    else if (kind === 1) shapeCrown(g, s);
    else if (kind === 2) shapeRing(g, s);
    else shapeGem(g, s, '#c27cff');
  }

  // ---------------------------------------------------------------- hoard pile (baked per size bucket)
  function pileCoin(g, x, y, r, tone, tilt) {
    g.save(); g.translate(x, y); g.rotate(tilt);
    g.fillStyle = tone < 0.3 ? '#94601a' : '#a66d1d'; ell(g, 0, r * 0.24, r, r * 0.42); g.fill();
    g.fillStyle = tone < 0.33 ? C.gold : tone < 0.7 ? '#e9a93c' : '#f9d071'; ell(g, 0, 0, r, r * 0.4); g.fill();
    g.strokeStyle = 'rgba(255,236,170,0.55)'; g.lineWidth = 0.8; ell(g, 0, 0, r * 0.62, r * 0.24); g.stroke();
    g.restore();
  }
  function updatePile() {
    var gold = S ? num(S.gold, 0) : 0;
    var s = Math.log(Math.max(0, gold) + 1) / Math.LN10;
    if (!isFinite(s)) s = 0;
    var key = Math.round(Math.min(s, 80) * 4);
    if (key === pileKey) return;
    pileKey = key;
    var sq = key / 4;
    var f = sq < 15 ? sq / 15 : 1 + Math.min(0.2, (sq - 15) / 100);
    pileW = W * (0.13 + 0.25 * f);
    pileH = Math.max(10, H * (0.05 + 0.24 * f));
    bakePile(f, sq);
  }
  function bakePile(f, s) {
    var pw = pileW, ph = pileH, i, x, y, k;
    pileOx = pw + 16; pileOy = ph + 26; pileCw = pw * 2 + 32; pileCh = ph + 36;
    pileCv.width = Math.max(1, Math.ceil(pileCw * dpr)); pileCv.height = Math.max(1, Math.ceil(pileCh * dpr));
    var g = pileCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, pileCw, pileCh);
    var rnd = rng(4242);
    g.fillStyle = 'rgba(8,4,2,0.45)'; ell(g, pileOx, pileOy + 3, pw * 1.08, 7); g.fill();
    g.beginPath(); g.moveTo(pileOx - pw, pileOy);
    for (i = 0; i <= 48; i++) { x = -pw + 2 * pw * i / 48; g.lineTo(pileOx + x, pileOy - moundH(x, pw, ph)); }
    g.lineTo(pileOx + pw, pileOy); g.closePath();
    var mg = g.createLinearGradient(0, pileOy - ph, 0, pileOy);
    mg.addColorStop(0, '#d99a35'); mg.addColorStop(0.5, '#a86e22'); mg.addColorStop(1, '#5e3810');
    g.fillStyle = mg; g.fill();
    var list = [];
    var cr = coinR * 0.78;
    var N = Math.round(24 + 180 * Math.min(1, f));
    for (i = 0; i < N; i++) {
      x = (rnd() * 2 - 1) * pw * 0.97;
      var top = moundH(x, pw, ph);
      var dep = rnd(); dep = dep * dep * top * 0.9;
      list.push({ x: x, y: pileOy - top + dep + 2, r: cr * (0.8 + rnd() * 0.45), tone: rnd(), tilt: (rnd() - 0.5) * 0.5 });
    }
    for (x = -pw * 0.95; x <= pw * 0.95; x += cr * 1.45) {
      var h1 = moundH(x, pw, ph), sl = (moundH(x + 2, pw, ph) - moundH(x - 2, pw, ph)) / 4;
      list.push({ x: x + (rnd() - 0.5) * 3, y: pileOy - h1 + 1.5, r: cr * (0.85 + rnd() * 0.3), tone: rnd(), tilt: -Math.atan(sl) * 0.8 });
    }
    list.sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < list.length; i++) { var c = list[i]; pileCoin(g, pileOx + c.x, c.y, c.r, c.tone, c.tilt); }
    // relics poke out as the hoard grows
    function relic(kind, fx, sz, rot) {
      var rx = fx * pw, ry = pileOy - moundH(rx, pw, ph) + sz * 0.3;
      g.save(); g.translate(pileOx + rx, ry); g.rotate(rot); drawShape(g, kind, sz); g.restore();
    }
    var us = Math.min(1.3, unit);
    if (s >= 2.5) relic(0, -0.5, 11 * us, -0.45);
    if (s >= 5.5) relic(1, 0.48, 12 * us, 0.38);
    if (s >= 8.5) relic(2, -0.22, 10 * us, -0.2);
    if (s >= 11.5) relic(3, 0.7, 9 * us, 0.5);
    var gemN = Math.min(10, Math.floor(s * 0.75));
    for (k = 0; k < gemN; k++) {
      x = (rnd() * 2 - 1) * pw * 0.82;
      y = pileOy - moundH(x, pw, ph) * (0.3 + rnd() * 0.65);
      g.save(); g.translate(pileOx + x, y); g.rotate((rnd() - 0.5) * 0.8);
      shapeGem(g, (3.6 + rnd() * 2.6) * us, GEMS[k % 4]); g.restore();
    }
    // sheen along the top surface
    g.strokeStyle = 'rgba(' + C.goldHiRGB + ',0.35)'; g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath();
    for (i = 6; i <= 42; i++) { x = -pw + 2 * pw * i / 48; y = pileOy - moundH(x, pw, ph) + 1; if (i === 6) g.moveTo(pileOx + x, y); else g.lineTo(pileOx + x, y); }
    g.stroke();
  }

  // ---------------------------------------------------------------- resize
  function resize() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    rectL = r.left; rectT = r.top;
    var nw = Math.max(1, r.width), nh = Math.max(1, r.height);
    var nd = Math.min(2.5, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    var key = nw.toFixed(1) + 'x' + nh.toFixed(1) + '@' + nd;
    if (key === sizeKey) return;
    sizeKey = key;
    W = nw; H = nh; dpr = nd;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    baseY = H - Math.max(24, H * 0.12); // keep the floor (and settled coins) up in the swipe zone, clear of the panel
    unit = clamp(Math.min(W / 412, H / 380), 0.7, 1.4);
    coinR = 8.5 * clamp(W / 412, 0.85, 1.25);
    dk = clamp(Math.min(W / 400, H / 330), 0.62, 1.3);
    readPalette();
    makeSprites();
    makeGradients();
    bakeBg();
    pileKey = -999;
    updatePile();
    for (var i = 0; i < MAX_COINS; i++) {
      var c = coins[i];
      if (!c.on) continue;
      c.r = coinRadius(c.v);
      c.x = clamp(c.x, c.r, W - c.r);
      if (c.y > groundY(c.x)) c.y = groundY(c.x) - c.r * 0.3;
    }
    for (i = 0; i < DUST_N; i++) { var d = dust[i]; d.x = Math.random() * W; d.y = H * (0.2 + Math.random() * 0.8); }
    kob.x = clamp(kob.x, 0, W);
  }

  // ---------------------------------------------------------------- pools
  function coinRadius(v) { return coinR * (1 + Math.min(0.9, (Math.log(Math.max(1, v)) / Math.LN10) * 0.45)); }
  function spawnPart(k, x, y, vx, vy, life, s) {
    var cap = rm ? 40 : MAX_PARTS;
    if (partCount >= cap) return null;
    for (var i = 0; i < MAX_PARTS; i++) {
      var p = parts[i];
      if (p.on) continue;
      p.on = true; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.s = s; p.rot = Math.random() * TAU;
      partCount++;
      return p;
    }
    return null;
  }
  function spawnFly(x, y, r) {
    var tx = W * 0.5 + (Math.random() - 0.5) * pileW * 0.9, ty = peakY() + pileH * (0.25 + Math.random() * 0.4);
    var p = spawnPart(P_FLY, x, y, 0, 0, 0.42 + Math.random() * 0.22, r);
    if (!p) return;
    p.a = x; p.b = y; p.c = tx; p.d = ty;
    p.e = (x + tx) * 0.5 + (Math.random() - 0.5) * 60; p.f = Math.min(y, ty) - 50 - Math.random() * 60;
  }
  function sparks(x, y, n, sp, kind) {
    if (rm) n = Math.ceil(n / 3);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, v = sp * (0.35 + Math.random() * 0.65);
      spawnPart(kind === undefined ? P_SPARK : kind, x, y, Math.cos(a) * v, Math.sin(a) * v - sp * 0.3, 0.35 + Math.random() * 0.45, 0.6 + Math.random() * 0.8);
    }
  }
  function spawnFloat(x, y, g, big) {
    var f = null;
    for (var i = 0; i < MAX_FLOATS; i++) if (!floats[i].on) { f = floats[i]; break; }
    if (!f) { // recycle the oldest
      f = floats[0];
      for (i = 1; i < MAX_FLOATS; i++) if (floats[i].life < f.life) f = floats[i];
    }
    f.on = true; f.x = clamp(x, 34, W - 34); f.y = clamp(y, 24, H - 10); f.txt = '+' + fmtNum(g);
    f.max = big ? 1.6 : 1.05; f.life = f.max; f.big = !!big; f.col = '';
    if (typeof cave.onFloat === 'function' && g > 0) { try { cave.onFloat(g, x, y); } catch (e) { /* ignore */ } }
    return f;
  }
  function addGain(acc, g, x, y) {
    if (!(g > 0)) return;
    acc.g += g; acc.x = x; acc.y = y;
  }
  function flushGain(acc, dt) {
    if (acc.g <= 0) { acc.t = 0; return; }
    acc.t += dt;
    if (acc.t >= FLOAT_BATCH) {
      if (acc.ore) { // "+5.6K Ore" in muted steel, a little above the gold float of the same swipe
        var f = spawnFloat(acc.x, acc.y - 46, 0, false);
        if (f) {
          f.txt = '+' + fmtNum(acc.g) + ' Ore'; f.col = NUG_FLOAT;
          // the label is wider than a gold number: keep all of it on screen and clear of the top HUD (code review #1)
          var tw = 60;
          try { if (ctx) { ctx.font = F_FLOAT; tw = ctx.measureText(f.txt).width; } } catch (e) { tw = 60; }
          f.x = clamp(f.x, tw * 0.5 + 6, Math.max(tw * 0.5 + 6, W - tw * 0.5 - 6));
          f.y = clamp(f.y, 64, Math.max(64, H - 10));
        }
      } else spawnFloat(acc.x, acc.y - 22, acc.g, false);
      acc.g = 0; acc.t = 0;
    }
  }

  // ---------------------------------------------------------------- coins
  function spawnCoin(mode, sx, sy) {
    if (W < 20) return;
    var c = null;
    if (coinCount < MAX_COINS) for (var i = 0; i < MAX_COINS; i++) if (!coins[i].on) { c = coins[i]; break; }
    if (!c) { mergeCoin(); return; }
    c.on = true; coinCount++;
    c.v = 1; c.r = coinR; c.born = clock; c.g = false; c.pulse = 0; c.ph = Math.random() * TAU;
    c.n = st.minesOpen && Math.random() < 1 / NUG_EVERY && nugsOnScreen() < NUG_MAX;
    c.spin = Math.random() * TAU; c.sv = 7 + Math.random() * 9; c.yo = Math.random() * 3;
    if (mode === 1) {
      var a = Math.random() * TAU, sp = 120 + Math.random() * 280;
      c.x = sx; c.y = sy; c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp - 200;
      return;
    }
    var side = Math.random();
    if (side < 0.18) { c.x = c.r; c.y = H * (0.12 + Math.random() * 0.3); c.vx = 130 + Math.random() * 170; c.vy = -60 - Math.random() * 90; }
    else if (side < 0.36) { c.x = W - c.r; c.y = H * (0.12 + Math.random() * 0.3); c.vx = -(130 + Math.random() * 170); c.vy = -60 - Math.random() * 90; }
    else {
      var x = W * (0.05 + Math.random() * 0.9), dz = dragonHalf() + 8;
      if (Math.abs(x - W * 0.5) < dz) x = W * 0.5 + (x < W * 0.5 ? -dz : dz) * (1 + Math.random() * 0.4);
      c.x = clamp(x, c.r, W - c.r); c.y = -c.r * 2; c.vx = (Math.random() - 0.5) * 50; c.vy = Math.random() * 90;
    }
    if (c.n) c.x = clamp(c.x, NUG_EDGE * c.r, W - NUG_EDGE * c.r);
  }
  var NUG_EDGE = 1.3;   // a nugget is drawn about 2.45 r wide: keep its centre 1.3 r from the edges
  function refreshNugZones() {
    nugZoneN = 0;
    if (!canvas || typeof document === 'undefined') return;
    try {
      var cr = canvas.getBoundingClientRect();
      for (var i = 0; i < NUG_BTN_IDS.length; i++) {
        var b = document.getElementById(NUG_BTN_IDS[i]);
        if (!b || b.hidden || b.offsetParent === null) continue;
        var a = b.getBoundingClientRect();
        if (!(a.width > 0)) continue;
        var l = a.left - cr.left, r = a.right - cr.left, bot = a.bottom - cr.top;
        if (bot < baseY - pileH * 0.2 - 30) continue;   // only a button low enough to sit over the floor
        var z = nugZones[nugZoneN++];
        z.l = l; z.r = r;
        if (nugZoneN >= nugZones.length) break;
      }
    } catch (e) { nugZoneN = 0; }
  }
  // a resting nugget under a button slides to the button's inner side (towards the pile), where a swipe finds it
  function nugKeepOut(c) {
    var pad = NUG_EDGE * c.r;
    for (var i = 0; i < nugZoneN; i++) {
      var z = nugZones[i];
      if (c.x > z.l - pad && c.x < z.r + pad) {
        var spread = (c.ph / TAU) * c.r * 2;   // a fixed per-nugget offset, so several do not stack on one spot
        var inner = (z.l + z.r) * 0.5 > W * 0.5 ? z.l - pad - spread : z.r + pad + spread;
        if (inner > pad && inner < W - pad) { c.x = inner; c.vx = 0; }
      }
    }
  }
  function nugsOnScreen() {
    var n = 0;
    for (var i = 0; i < MAX_COINS; i++) if (coins[i].on && coins[i].n) n++;
    return n;
  }
  function mergeCoin() {
    var pass, k, c;
    for (pass = 0; pass < 2; pass++) {
      for (k = 0; k < MAX_COINS; k++) {
        mergeCur = (mergeCur + 1) % MAX_COINS;
        c = coins[mergeCur];
        if (c.on && !c.n && (c.g || pass === 1)) { // nuggets never merge and are never merge targets
          c.v += 1; c.r = coinRadius(c.v); c.pulse = 1;
          if (!rm && Math.random() < 0.5) spawnPart(P_STAR, c.x, c.y - 2, 0, -10, 0.45, 0.6);
          return;
        }
      }
    }
  }
  function collectCoin(c, x, y) {
    c.on = false; coinCount--;
    pendN++; pendV += c.v;
    if (c.n) { pendNug++; c.n = false; }
    gainX = x; gainY = y;
    spawnFly(c.x, c.y, c.r);
    if (!rm) spawnPart(P_STAR, c.x, c.y, 0, 0, 0.3, 0.7 + Math.min(1, c.v * 0.05));
  }
  function updateCoins(dt) {
    var hx = W * 0.5, dz = dragonHalf(), fr = Math.max(0, 1 - 4 * dt), mag = down && fx >= 0;
    for (var i = 0; i < MAX_COINS; i++) {
      var c = coins[i];
      if (!c.on) continue;
      if (c.pulse > 0) c.pulse = Math.max(0, c.pulse - dt * 2);
      if (mag) { // soft magnet: coins near the fingertip get pulled into the trail
        var mx = fx - c.x, my = fy - c.y, md2 = mx * mx + my * my;
        if (md2 < MAGNET_R * MAGNET_R) {
          var md = Math.sqrt(md2);
          if (md < COIN_HIT * 0.5) { collectCoin(c, fx, fy); continue; }
          var stp = Math.min(md, MAGNET_V * dt) / md;
          c.x += mx * stp; c.y += my * stp; c.vx = 0; c.vy = 0; c.g = false;
          continue;
        }
      }
      var gy;
      if (!c.g) {
        c.vy += GRAV * dt;
        if (c.vy > 0) c.vy *= Math.max(0, 1 - AIR_DRAG * dt); // air drag: coins drift down through the swipe zone
        c.x += c.vx * dt; c.y += c.vy * dt; c.spin += c.sv * dt;
        if (c.x < c.r) { c.x = c.r; c.vx = Math.abs(c.vx) * 0.5; }
        else if (c.x > W - c.r) { c.x = W - c.r; c.vx = -Math.abs(c.vx) * 0.5; }
        gy = groundY(c.x) - c.r * 0.3 + c.yo;
        if (c.y >= gy) {
          c.y = gy;
          if (c.vy > 170) { c.vy = -c.vy * 0.33; c.vx *= 0.6; c.sv *= 0.5; }
          else { c.g = true; c.vy = 0; }
        }
      } else {
        var sl = (groundY(c.x + 2) - groundY(c.x - 2)) * 0.25;
        var dx = c.x - hx, push = 0;
        if (dx > -dz && dx < dz) push = (dx < 0 ? -1 : 1) * 520;
        c.vx += (sl * 1400 + push) * dt;
        c.vx *= fr;
        if (push === 0 && sl > -0.14 && sl < 0.14 && c.vx > -18 && c.vx < 18) c.vx = 0;
        c.x += c.vx * dt;
        var lo = c.n ? NUG_EDGE * c.r : c.r;
        if (c.x < lo) { c.x = lo; c.vx = 0; } else if (c.x > W - lo) { c.x = W - lo; c.vx = 0; }
        if (c.n && nugZoneN) nugKeepOut(c);
        c.y = groundY(c.x) - c.r * 0.3 + c.yo;
      }
    }
  }

  // ---------------------------------------------------------------- streak
  function computeTop() {
    var ms = st.maxStreak > 0 ? st.maxStreak : 5, t = 0;
    for (var i = 1; i < ST_LV.length; i++) if (ST_LV[i] <= ms + 1e-6) t = i;
    return t;
  }
  function idxFor(t) {
    var r = 0;
    for (var j = 1; j <= stTop; j++) if (t >= ST_AT[j]) r = j;
    return r;
  }
  function multFor(idx) {
    if (idx > stTop) idx = stTop;
    var m = ST_LV[idx];
    if (idx === stTop && st.maxStreak > m) m = st.maxStreak;
    return m;
  }
  function streakMult() { return multFor(stkIdx); }
  function updateStreak(dt) {
    var inst = dt > 0 ? frameMove / dt : 0;
    frameMove = 0;
    spd += (inst - spd) * Math.min(1, dt * 12);
    if (down && spd >= ST_MIN_SPEED) { stkT += dt * stRamp; stillT = 0; decayT = 0; }
    else {
      stillT += dt;
      if (!down || stillT > ST_DECAY) {
        decayT += dt;
        while (decayT >= ST_DECAY) {
          decayT -= ST_DECAY;
          var ci = idxFor(stkT);
          stkT = ci > 0 ? ST_AT[ci - 1] : 0;
        }
      }
    }
    var capT = ST_AT[stTop] + (stTop === ST_AT.length - 1 ? 1 : 0.5);
    if (stkT > capT) stkT = capT;
    var ni = idxFor(stkT);
    if (ni > stkIdx) {
      var m = multFor(ni);
      eCall('noteStreak', m);
      sfx('streakUp', { mult: m });
      buzz(10);
      stkPulse = 1;
      if (fx >= 0) sparks(fx, fy, 10, 260, P_STAR);
    }
    stkIdx = ni;
    var mv = streakMult();
    if (mv !== stkLabelV) { stkLabelV = mv; stkLabel = '×' + (mv % 1 ? mv.toFixed(1) : String(mv)); }
    if (stkPulse > 0) stkPulse = Math.max(0, stkPulse - dt * 3);
    var want = (mv > 1) ? 1 : 0;
    stkShow += (want - stkShow) * Math.min(1, dt * 6);
  }

  // ---------------------------------------------------------------- input
  function pushGH(x, y, t) {
    var prev = (ghHead - 1 + GH_N) % GH_N;
    var d = ghN > 0 ? ghD[prev] + Math.sqrt((x - ghX[prev]) * (x - ghX[prev]) + (y - ghY[prev]) * (y - ghY[prev])) : 0;
    ghX[ghHead] = x; ghY[ghHead] = y; ghT[ghHead] = t; ghD[ghHead] = d;
    ghHead = (ghHead + 1) % GH_N;
    if (ghN < GH_N) ghN++;
  }
  function checkGust(x, y, t) {
    if (!S || !E || coinCount < 1 || ghN < 2) return;
    if (typeof E.gustReady === 'function') { var ok = false; try { ok = !!E.gustReady(S); } catch (e) { ok = false; } if (!ok) return; }
    else if (!(S.gust >= 1)) return;
    var newest = (ghHead - 1 + GH_N) % GH_N, oldT = ghT[newest], path = 0;
    for (var j = 1; j < ghN; j++) {
      var idx = (newest - j + GH_N) % GH_N;
      if (t - ghT[idx] > GUST_MS) break;
      oldT = ghT[idx]; path = ghD[newest] - ghD[idx];
    }
    var el = t - oldT;
    if (path >= GUST_PATH && el > 0 && (path / el) * 1000 >= GUST_SPEED) {
      ghN = 0;
      doGust(x, y);
    }
  }
  function trailPush(x, y, brk) {
    if (!brk && tCount > 0) {
      var last = (tHead - 1 + TRAIL_N) % TRAIL_N, dx = x - tX[last], dy = y - tY[last];
      if (dx * dx + dy * dy < 16) { tX[last] = x; tY[last] = y; tT[last] = clock; return; }
    }
    tX[tHead] = x; tY[tHead] = y; tT[tHead] = clock; tB[tHead] = brk ? 1 : 0;
    tHead = (tHead + 1) % TRAIL_N;
    if (tCount < TRAIL_N) tCount++;
  }
  function processPoint(x, y, t) {
    var dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
    if (d2 < 0.5) return;
    var d = Math.sqrt(d2);
    if (d > 500) { px = x; py = y; return; }
    frameMove += d; strokePx += d;
    for (var i = 0; i < MAX_COINS; i++) {
      var c = coins[i];
      if (c.on && segHit(px, py, x, y, c.x, c.y, COIN_HIT)) collectCoin(c, x, y);
    }
    if (tr.on && segHit(px, py, x, y, tr.x, tr.y, TREASURE_HIT)) grabTreasure();
    if (swipeHooks.length) runSwipeHooks(px, py, x, y, t);
    trailPush(x, y, newStroke);
    newStroke = false;
    pushGH(x, y, t);
    px = x; py = y; fx = x; fy = y;
    checkGust(x, y, t);
  }
  function onDown(e) {
    if (down && e.pointerId !== pid) return;
    if (e.button !== undefined && e.button > 0) return;
    down = true; pid = e.pointerId; strokeSeq++;
    try { canvas.setPointerCapture(pid); } catch (err) { /* ignore */ }
    var r = canvas.getBoundingClientRect();
    rectL = r.left; rectT = r.top;
    px = e.clientX - rectL; py = e.clientY - rectT; fx = px; fy = py;
    ghN = 0; pushGH(px, py, e.timeStamp || performance.now());
    stillT = 0; newStroke = true;
    trailPush(px, py, true); newStroke = false;
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    if (!down || e.pointerId !== pid) return;
    var list = null;
    if (typeof e.getCoalescedEvents === 'function') { try { list = e.getCoalescedEvents(); } catch (err) { list = null; } }
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        var ev = list[i];
        processPoint(ev.clientX - rectL, ev.clientY - rectT, ev.timeStamp || e.timeStamp);
      }
    } else processPoint(e.clientX - rectL, e.clientY - rectT, e.timeStamp || performance.now());
  }
  function onUp(e) {
    if (e.pointerId !== pid) return;
    down = false; pid = -1; ghN = 0; newStroke = true;
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  // ---------------------------------------------------------------- gust
  function doGust(x, y) {
    if (!S || !E || typeof E.useGust !== 'function') return false;
    var used = false;
    try { used = !!E.useGust(S); } catch (e) { used = false; }
    if (!used) return false;
    var n = 0, sv = 0, kept = 0, nugs = 0;
    var auto = false;
    try { auto = !!(E && typeof E.inAuto === 'function' && E.inAuto()); } catch (e) { auto = false; }
    for (var i = 0; i < MAX_COINS; i++) {
      var c = coins[i];
      if (!c.on) continue;
      if (c.n && auto) { kept++; continue; }   // Restless Wings leaves the nuggets: they are for the player's swipe
      n++; sv += c.v;
      if (c.n) { pendNug++; nugs++; c.n = false; }
      c.on = false;
      spawnFly(c.x, c.y, c.r);
    }
    coinCount = kept;
    // the "+Ore" float rises from above the pile, just over the gust's big gold number (code review #1; flushGain puts
    // the Ore label 46 px above gainY)
    if (nugs) { gainX = W * 0.5; gainY = peakY() - 70 * dk + 4 - 36; }
    // a gust always pays at least gustFloorCoins coins, so pressing it when ready is never wasted
    var floorN = (HOARD.data && HOARD.data.C && HOARD.data.C.gustFloorCoins) || 0;
    if (n < floorN) { sv += floorN - n; n = floorN; }
    if (n > 0) {
      var gm = st.gustWorthMult > 0 ? st.gustWorthMult : 3;
      // the gust's x3 lands on at most gustBonusCoins coins (their average worth); the rest are swept up at normal worth,
      // so a screen left full for the gust never pays more than swiping over the coins as they fall
      var nb = (HOARD.data && HOARD.data.C && HOARD.data.C.gustBonusCoins) || n;
      var vm = (sv / n) * (1 + (gm - 1) * Math.min(n, nb) / n);
      var g = eNum('coinCollected', n, streakMult(), vm); // gust mult rides valueMult so the engine's streak cap can't clip it
      if (g > 0) spawnFloat(W * 0.5, peakY() - 70 * dk, g, true);
    }
    var lines = rm ? 6 : 18;
    for (i = 0; i < lines; i++) {
      var a = (i / lines) * TAU + Math.random() * 0.3, v = 700 + Math.random() * 500;
      spawnPart(P_LINE, x + Math.cos(a) * 14, y + Math.sin(a) * 14, Math.cos(a) * v, Math.sin(a) * v, 0.3 + Math.random() * 0.15, 1);
    }
    sparks(x, y, 14, 380, P_STAR);
    sfx('gust', { n: n });
    wingA = 1; flashA = rm ? 0.12 : 0.32;
    if (!rm) shakeT = 0.32;
    buzz(15);
    stT = 0;
    return true;
  }

  // ---------------------------------------------------------------- treasure
  function scheduleTreasure() { trTimer = tiMin + Math.random() * Math.max(0, tiMax - tiMin); }
  function spawnTreasure() {
    if (W < 60) { trTimer = 5; return; }
    tr.on = true; tr.kind = Math.floor(Math.random() * 4); tr.t = 0; tr.spark = 0;
    tr.dir = Math.random() < 0.5 ? 1 : -1;
    tr.x0 = tr.dir > 0 ? -40 : W + 40;
    tr.y0 = H * (0.22 + Math.random() * 0.3);
    tr.x = tr.x0; tr.y = tr.y0;
  }
  function grabTreasure() {
    if (!tr.on) return;
    tr.on = false;
    scheduleTreasure();
    var g0 = S ? num(S.gold, 0) : 0;
    var res = eCall('grabTreasure');
    var g1 = S ? num(S.gold, 0) : 0;
    bn.title = (res && typeof res.title === 'string') ? res.title : 'Treasure!';
    bn.text = (res && typeof res.text === 'string') ? res.text : '';
    bn.life = bn.max;
    sfx('treasure', { kind: res && typeof res.kind === 'string' ? res.kind : '' });
    if (g1 > g0) spawnFloat(tr.x, tr.y - 30, g1 - g0, true);
    if (res && res.spawnCoins > 0) {
      swarmLeft += Math.min(200, Math.floor(res.spawnCoins)); swarmX = clamp(tr.x, 20, W - 20); swarmY = tr.y;
    }
    sparks(tr.x, tr.y, 16, 320, P_STAR);
    sparks(tr.x, tr.y, 14, 260, P_SPARK);
    flashA = Math.max(flashA, rm ? 0.08 : 0.2);
    hopT = 0.5;
    buzz(12);
    stT = 0;
  }
  function updateTreasure(dt) {
    if (!tr.on) {
      trTimer -= dt;
      if (trTimer <= 0) spawnTreasure();
      return;
    }
    tr.t += dt;
    var u = tr.t / TREASURE_LIFE;
    tr.x = tr.x0 + tr.dir * (W + 80) * u;
    tr.y = tr.y0 + Math.sin(tr.t * 1.3) * 18 * unit;
    if (tr.t >= TREASURE_LIFE) { tr.on = false; scheduleTreasure(); return; }
    tr.spark -= dt;
    if (tr.spark <= 0) {
      tr.spark = rm ? 0.2 : 0.06;
      spawnPart(P_STAR, tr.x - tr.dir * 16 * unit + (Math.random() - 0.5) * 16, tr.y + (Math.random() - 0.5) * 16, -tr.dir * 14, 8 + Math.random() * 16, 0.7, 0.45 + Math.random() * 0.4);
    }
  }

  // ---------------------------------------------------------------- sweeper kobold
  function updateKobold(dt) {
    var rate = st.sweepRate > 0 ? st.sweepRate : 0;
    if (rate <= 0) { kob.on = false; sweepAcc = 0; return; }
    if (!kob.on) { kob.on = true; kob.x = W + 20; kob.dir = -1; kob.tgt = -1; }
    sweepAcc = Math.min(2, sweepAcc + rate * dt);
    if (kob.sweep > 0) kob.sweep -= dt;
    kob.re -= dt;
    var tc = kob.tgt >= 0 ? coins[kob.tgt] : null;
    if (kob.re <= 0 || !tc || !tc.on || !tc.g || tc.n) {
      kob.re = 0.3; kob.tgt = -1; tc = null;
      var best = Infinity;
      for (var i = 0; i < MAX_COINS; i++) { var c = coins[i]; if (c.on && c.g && !c.n && c.born < best) { best = c.born; kob.tgt = i; } } // brooms leave nuggets
      if (kob.tgt >= 0) tc = coins[kob.tgt];
    }
    var tx, speed;
    if (tc && sweepAcc >= 1) { tx = tc.x; speed = Math.max(110, rate * 140) * unit; }
    else { tx = W * 0.5 + pileW + 26 * unit; speed = 40 * unit; if (tx > W - 16) tx = W - 16; }
    var dx = tx - kob.x;
    if (Math.abs(dx) > 2) {
      var step = Math.min(Math.abs(dx), speed * dt);
      kob.x += dx > 0 ? step : -step; kob.dir = dx > 0 ? 1 : -1; kob.walk += dt * (speed > 60 ? 16 : 8);
    }
    if (tc && sweepAcc >= 1 && Math.abs(tc.x - kob.x) < 12) {
      var g = eNum('sweepCollect', tc.v);
      tc.on = false; coinCount--;
      spawnFly(tc.x, tc.y, tc.r);
      addGain(gB, g, tc.x, tc.y - 14);
      sweepAcc -= 1; kob.tgt = -1; kob.sweep = 0.25;
    }
  }

  // ---------------------------------------------------------------- particles / floats / ambience
  function updateParts(dt) {
    for (var i = 0; i < MAX_PARTS; i++) {
      var p = parts[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.on = false; partCount--;
        if (p.k === P_FLY) { pileBump = Math.min(1, pileBump + 0.12); }
        continue;
      }
      if (p.k === P_FLY) {
        var u = 1 - p.life / p.max, e = u * u, ie = 1 - e;
        p.x = ie * ie * p.a + 2 * ie * e * p.e + e * e * p.c;
        p.y = ie * ie * p.b + 2 * ie * e * p.f + e * e * p.d;
        p.rot += dt * 14;
      } else if (p.k === P_SMOKE) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.s += dt * 1.4;
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        var dmp = p.k === P_LINE ? 1 - 5 * dt : 1 - 2.2 * dt;
        p.vx *= dmp; p.vy *= dmp;
        if (p.k === P_SPARK) p.vy += 300 * dt;
        p.rot += dt * 3;
      }
    }
    for (i = 0; i < MAX_FLOATS; i++) {
      var f = floats[i];
      if (!f.on) continue;
      f.life -= dt; f.y -= (f.big ? 26 : 38) * dt;
      if (f.life <= 0) f.on = false;
    }
  }
  function updateAmbience(dt) {
    // dragon
    blinkT -= dt;
    if (blinkT <= 0) { blinkA = 0.16; blinkT = 2.4 + Math.random() * 4; if (Math.random() < 0.2) blinkT = 0.25; }
    if (blinkA > 0) blinkA = Math.max(0, blinkA - dt);
    var ex = W * 0.5 + 41 * dkS(), ey = peakY() + 4 * dk - 64 * dkS(), tx = 0.35, ty = 0.1;
    if (down && fx >= 0) { tx = (fx - ex) / 110; ty = (fy - ey) / 110; }
    else if (tr.on) { tx = (tr.x - ex) / 110; ty = (tr.y - ey) / 110; }
    else if (kob.on) { tx = (kob.x - ex) / 160; ty = 0.6; }
    var tl = Math.sqrt(tx * tx + ty * ty);
    if (tl > 1) { tx /= tl; ty /= tl; }
    var k = Math.min(1, dt * 8);
    lookX += (tx - lookX) * k; lookY += (ty - lookY) * k;
    if (wingA > 0) wingA = Math.max(0, wingA - dt * 1.6);
    if (hopT > 0) hopT = Math.max(0, hopT - dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    if (flashA > 0) flashA = Math.max(0, flashA - dt * 1.4);
    if (pileBump > 0) pileBump = Math.max(0, pileBump - dt * 3);
    if (bn.life > 0) bn.life = Math.max(0, bn.life - dt);
    if (!rm) {
      smokeT -= dt;
      if (smokeT <= 0) {
        smokeT = 4 + Math.random() * 5;
        var nx = W * 0.5 + 60 * dkS(), ny = peakY() + 4 * dk - 59 * dkS();
        spawnPart(P_SMOKE, nx, ny, 18, -22, 1.6, 3 * dk);
        spawnPart(P_SMOKE, nx + 3, ny + 1, 26, -14, 1.4, 2.2 * dk);
      }
      for (var i = 0; i < DUST_N; i++) {
        var d = dust[i];
        d.y -= d.sp * dt * 7; d.x += Math.sin(clock * 0.5 + d.ph) * dt * 4;
        if (d.y < H * 0.1) { d.y = H; d.x = Math.random() * W; }
      }
    }
    glintT -= dt;
    if (glintT <= 0) {
      glintT = rm ? 1.2 : 0.35;
      var gx = W * 0.5 + (Math.random() * 2 - 1) * pileW * 0.85;
      spawnPart(P_STAR, gx, groundY(gx) + Math.random() * pileH * 0.35, 0, 0, 0.7, 0.5 + Math.random() * 0.5);
    }
  }

  // ---------------------------------------------------------------- drawing
  function drawDragon(x, y, k) {
    var g = ctx;
    var br = Math.sin(clock * 1.7) * 0.5 + 0.5;
    var hop = hopT > 0 ? Math.sin((1 - hopT / 0.5) * Math.PI) * 12 : 0;
    g.save();
    g.translate(x, y - hop);
    g.scale(k, k);
    g.fillStyle = 'rgba(30,14,4,0.35)'; ell(g, 0, 2, 50, 7); g.fill();
    // back ridge spikes
    g.fillStyle = D_SPIKE;
    var by = 22 * (1 + br * 0.04);
    for (var i = 0; i < 5; i++) {
      var a = Math.PI * (1.1 + i * 0.16), cx = -6 + Math.cos(a) * 34, cy = -24 + Math.sin(a) * by;
      var nx = Math.cos(a), ny = Math.sin(a), sz = 7 - Math.abs(i - 2) * 0.8;
      g.beginPath();
      g.moveTo(cx + ny * 4.5, cy - nx * 4.5);
      g.lineTo(cx + nx * sz, cy + ny * sz);
      g.lineTo(cx - ny * 4.5, cy + nx * 4.5);
      g.closePath(); g.fill();
    }
    // body
    g.fillStyle = dragonGrad; ell(g, -6, -24, 36, by); g.fill();
    // belly with scale ridges
    g.fillStyle = D_BELLY; ell(g, 4, -13, 25, 11); g.fill();
    g.strokeStyle = D_BELLY_LINE; g.lineWidth = 1.2;
    for (i = 0; i < 3; i++) { g.beginPath(); g.arc(-5 + i * 9, -20, 7, 0.28 * Math.PI, 0.72 * Math.PI); g.stroke(); }
    if (decor) drawDecor(g, 'belly');
    // folded wing
    g.save();
    g.translate(-14, -38);
    g.rotate(-0.15 - wingA * 0.95 + br * 0.05);
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(-6, -22, -4, -40);
    g.quadraticCurveTo(-14, -31, -22, -31);
    g.quadraticCurveTo(-26, -21, -36, -19);
    g.quadraticCurveTo(-31, -8, -38, 2);
    g.quadraticCurveTo(-20, 3, 0, 8);
    g.closePath();
    g.fillStyle = wingGrad; g.fill();
    g.strokeStyle = '#1f4845'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(-4, -40);
    g.moveTo(-2, -14); g.lineTo(-22, -31);
    g.moveTo(-3, -8); g.lineTo(-36, -19);
    g.moveTo(-3, -2); g.lineTo(-38, 2);
    g.stroke();
    g.fillStyle = D_HORN; ell(g, -4, -40, 1.8, 1.8); g.fill();
    if (decor) drawDecor(g, 'wing');
    g.restore();
    // neck
    g.fillStyle = dragonGrad;
    g.beginPath(); g.moveTo(12, -40); g.quadraticCurveTo(22, -56, 32, -60); g.lineTo(44, -48);
    g.quadraticCurveTo(32, -38, 30, -16); g.lineTo(12, -14); g.closePath(); g.fill();
    // tail wrapped around the front
    g.fillStyle = D_MID;
    g.beginPath(); g.moveTo(-36, -14);
    g.bezierCurveTo(-60, -2, -46, 11, -12, 9);
    g.bezierCurveTo(10, 8, 28, 6, 43, 0);
    g.bezierCurveTo(28, 1.5, 10, 1.5, -12, 1.5);
    g.bezierCurveTo(-34, 1, -42, -4, -28, -18);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-40, -8); g.bezierCurveTo(-50, 2, -30, 5, -12, 3.5); g.stroke();
    g.fillStyle = D_SPIKE;
    g.beginPath(); g.moveTo(40, 1); g.lineTo(50, -7); g.lineTo(55, 2); g.lineTo(46, 6); g.closePath(); g.fill();
    // front paw
    g.fillStyle = D_PAW; ell(g, 25, -5, 8.5, 5.5); g.fill();
    g.fillStyle = D_HORN;
    ell(g, 31, -2.5, 1.5, 1.5); g.fill(); ell(g, 33, -5, 1.5, 1.5); g.fill(); ell(g, 32, -7.6, 1.3, 1.3); g.fill();
    // head
    g.save();
    g.translate(40, -60);
    g.rotate(lookY * 0.08 + Math.sin(clock * 0.9) * 0.03);
    if (decor) drawDecor(g, 'headBack');
    g.fillStyle = D_HORN;
    g.beginPath(); g.moveTo(-9, -6); g.quadraticCurveTo(-17, -13, -24, -25); g.quadraticCurveTo(-12, -17, -2, -10); g.closePath(); g.fill();
    g.fillStyle = '#d9c7a3';
    g.beginPath(); g.moveTo(-2, -10); g.quadraticCurveTo(-6, -18, -9, -27); g.quadraticCurveTo(-1, -19, 4, -11); g.closePath(); g.fill();
    g.fillStyle = D_SPIKE;
    g.beginPath(); g.moveTo(-12, -1); g.lineTo(-22, 3); g.lineTo(-12, 6); g.closePath(); g.fill();
    g.fillStyle = headGrad; ell(g, 0, 0, 15, 12.5); g.fill(); ell(g, 13, 4, 11, 7.5); g.fill();
    g.fillStyle = D_DARK; ell(g, 21, 1.5, 1.6, 1.1); g.fill();
    g.strokeStyle = D_DARK; g.lineWidth = 1.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(10, 8.2); g.quadraticCurveTo(16, 10.6, 22, 7.2); g.stroke();
    g.fillStyle = 'rgba(255,170,120,0.28)'; ell(g, 6, 6.5, 4, 2.4); g.fill();
    var ex = 3, ey = -2, open = blinkA > 0 ? Math.abs(blinkA / 0.08 - 1) : 1;
    if (open > 1) open = 1;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5 + (st.frenzyActive ? 0.3 : 0);
    drawSpr(sprGlow, ex, ey, 30, 30);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = D_DARK; ell(g, ex, ey, 5.6, 6.2); g.fill();
    if (open > 0.08) {
      g.fillStyle = C.goldHi; ell(g, ex, ey, 4.6, 5.4 * open); g.fill();
      g.fillStyle = '#2a1606'; ell(g, ex + lookX * 1.9, ey + lookY * 1.4 * open, 1.4, 3.8 * open); g.fill();
      g.fillStyle = '#ffffff'; ell(g, ex - 1.4 + lookX * 0.6, ey - 2.1 * open, 1.1, 1.1); g.fill();
    } else {
      g.strokeStyle = D_DARK; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(ex - 5, ey); g.quadraticCurveTo(ex, ey + 2.4, ex + 5, ey); g.stroke();
    }
    if (decor) drawDecor(g, 'head');
    g.restore();
    g.restore();
  }
  function drawKobold() {
    var g = ctx, x = kob.x, y = groundY(kob.x) + 1, ks = 1.15 * unit;
    var bob = Math.abs(Math.sin(kob.walk)) * 2, sw = kob.sweep > 0 ? Math.sin(kob.sweep * 25) * 0.4 : 0;
    g.save(); g.translate(x, y); g.scale(kob.dir * ks, ks);
    // broom
    g.save(); g.translate(5, -14 - bob); g.rotate(0.9 + sw);
    g.strokeStyle = K_STICK; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 20); g.stroke();
    g.fillStyle = K_STRAW;
    g.beginPath(); g.moveTo(-1.5, 18); g.lineTo(-5, 27); g.lineTo(5, 27); g.lineTo(1.5, 18); g.closePath(); g.fill();
    g.restore();
    // legs
    g.strokeStyle = K_EAR; g.lineWidth = 2.2;
    var ls = Math.sin(kob.walk) * 3;
    g.beginPath(); g.moveTo(-2, -5); g.lineTo(-2 + ls, 0); g.moveTo(2, -5); g.lineTo(2 - ls, 0); g.stroke();
    // tail
    g.beginPath(); g.moveTo(-5, -6 - bob); g.quadraticCurveTo(-12, -4, -13, -10); g.stroke();
    // body + head
    g.fillStyle = K_BODY; ell(g, 0, -10 - bob, 6.5, 7.5); g.fill();
    g.fillStyle = K_BELLY; ell(g, 2, -9 - bob, 3.5, 5); g.fill();
    g.fillStyle = K_EAR;
    g.beginPath(); g.moveTo(-1, -24 - bob); g.lineTo(-9, -30 - bob); g.lineTo(-3, -20 - bob); g.closePath(); g.fill();
    g.fillStyle = K_BODY; ell(g, 3, -21 - bob, 6, 5); g.fill(); ell(g, 8, -20 - bob, 4, 3); g.fill();
    g.fillStyle = C.goldHi; ell(g, 4.5, -22 - bob, 1.3, 1.3); g.fill();
    g.restore();
  }
  function drawTreasure() {
    var g = ctx, s = 24 * unit, t = tr.t;
    var fade = Math.min(1, t / 0.4, (TREASURE_LIFE - t) / 0.6);
    g.save();
    g.globalAlpha = clamp(fade, 0, 1);
    g.globalCompositeOperation = 'lighter';
    var pulse = 0.55 + 0.25 * Math.sin(t * 5);
    g.globalAlpha *= pulse;
    drawSpr(sprGlow, tr.x, tr.y, s * 5, s * 5);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(fade, 0, 1);
    g.strokeStyle = 'rgba(' + C.goldHiRGB + ',' + (0.25 + 0.2 * Math.sin(t * 3)).toFixed(3) + ')';
    g.lineWidth = 1.5;
    ell(g, tr.x, tr.y, s * 1.55 + Math.sin(t * 3) * 2, s * 1.55 + Math.sin(t * 3) * 2); g.stroke();
    g.translate(tr.x, tr.y);
    g.rotate(Math.sin(t * (rm ? 0.8 : 2)) * 0.35);
    g.scale(0.78 + 0.22 * Math.cos(t * (rm ? 1 : 3)), 1);
    drawShape(g, tr.kind, s);
    g.restore();
    var gl = (t * 0.9) % 1;
    if (gl < 0.25) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      var a = Math.sin(gl / 0.25 * Math.PI), ss = s * 1.4 * a;
      g.globalAlpha = a * clamp(fade, 0, 1);
      drawSpr(sprStar, tr.x + s * 0.45, tr.y - s * 0.45, ss, ss);
      g.restore();
    }
  }
  function drawCoins() {
    var g = ctx;
    for (var i = 0; i < MAX_COINS; i++) {
      var c = coins[i];
      if (!c.on) continue;
      if (c.v > 1 || c.pulse > 0) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(0.6, 0.18 + c.v * 0.01) + c.pulse * 0.5;
        drawSpr(sprGlow, c.x, c.y, c.r * 4, c.r * 4);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      }
      var r = c.r * (1 + c.pulse * 0.25);
      if (c.n) { drawNug(g, c, r); continue; }
      if (c.g) drawSpr(sprLie, c.x, c.y, r * 2.4, r * 1.4);
      else {
        var sx = Math.abs(Math.cos(c.spin));
        if (sx < 0.14) sx = 0.14;
        drawSpr(sprFace, c.x, c.y, r * 2.4 * sx, r * 2.4);
      }
    }
  }
  // a nugget: the rock sprite (tumbling while it falls) and a white glint that twinkles (still under reduced motion)
  function drawNug(g, c, r) {
    var sz = r * 2.45;
    if (c.g) drawSpr(sprNug, c.x, c.y - r * 0.12, sz, sz * 0.86);
    else {
      g.save(); g.translate(c.x, c.y); g.rotate(rm ? 0 : c.spin * 0.25);
      drawSpr(sprNug, 0, 0, sz, sz);
      g.restore();
    }
    var tw = rm ? 0.8 : 0.45 + 0.55 * Math.max(0, Math.sin(clock * 2.6 + c.ph));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = tw;
    var gs = r * (rm ? 1.1 : 0.8 + 0.6 * tw);
    drawSpr(sprStar, c.x - r * 0.32, c.y - r * 0.42, gs, gs);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function drawParts(additive) {
    var g = ctx;
    for (var i = 0; i < MAX_PARTS; i++) {
      var p = parts[i];
      if (!p.on) continue;
      var a = p.life / p.max;
      if (!additive) {
        if (p.k === P_FLY) {
          var r = p.s * (0.6 + 0.4 * a), sx = Math.abs(Math.cos(p.rot));
          g.globalAlpha = 1;
          drawSpr(sprFace, p.x, p.y, r * 2.4 * (sx < 0.15 ? 0.15 : sx), r * 2.4);
        } else if (p.k === P_SMOKE) {
          g.globalAlpha = a * 0.28;
          g.fillStyle = '#b9b0c8';
          ell(g, p.x, p.y, p.s * 3, p.s * 3); g.fill();
        }
      } else {
        if (p.k === P_SPARK) {
          g.globalAlpha = a;
          var sz = 10 * p.s;
          drawSpr(st.emberActive ? sprEmber : sprGlow, p.x, p.y, sz, sz);
        } else if (p.k === P_STAR) {
          var tw = Math.sin(a * Math.PI);
          g.globalAlpha = tw;
          var ss = 18 * p.s * (0.4 + tw * 0.6);
          drawSpr(sprStar, p.x, p.y, ss, ss);
        } else if (p.k === P_LINE) {
          g.globalAlpha = a * 0.8;
          g.strokeStyle = C.goldHi; g.lineWidth = 2.2 * a + 0.5;
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); g.stroke();
        }
      }
    }
    g.globalAlpha = 1;
  }
  function drawTrail() {
    if (tCount < 2) return;
    var g = ctx, oldest = (tHead - tCount + TRAIL_N) % TRAIL_N, j, i, p, age, a;
    var col = st.emberActive ? C.ember : C.goldHi;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalCompositeOperation = 'lighter';
    for (var pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass === 0 ? col : '#fff6d8';
      for (j = 1; j < tCount; j++) {
        i = (oldest + j) % TRAIL_N;
        if (tB[i]) continue;
        age = clock - tT[i];
        a = 1 - age / TRAIL_LIFE;
        if (a <= 0) continue;
        p = (i - 1 + TRAIL_N) % TRAIL_N;
        if (pass === 0) { g.globalAlpha = a * 0.28; g.lineWidth = 5 + 16 * a; }
        else { g.globalAlpha = a * 0.9; g.lineWidth = 1.2 + 4 * a; }
        g.beginPath(); g.moveTo(tX[p], tY[p]); g.lineTo(tX[i], tY[i]); g.stroke();
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function drawFloats() {
    var g = ctx;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    for (var i = 0; i < MAX_FLOATS; i++) {
      var f = floats[i];
      if (!f.on) continue;
      var a = f.life < 0.35 ? f.life / 0.35 : 1, el = f.max - f.life;
      var sc = el < 0.12 ? 0.7 + el / 0.12 * 0.3 : 1;
      g.save();
      g.globalAlpha = a;
      g.translate(f.x, f.y); g.scale(sc, sc);
      g.font = f.big ? F_FLOAT_BIG : F_FLOAT;
      g.lineWidth = f.big ? 5 : 3.5;
      g.strokeStyle = 'rgba(22,12,6,0.8)';
      g.strokeText(f.txt, 0, 0);
      g.fillStyle = f.col || (f.big ? C.goldHi : C.gold);
      g.fillText(f.txt, 0, 0);
      g.restore();
    }
  }
  // first-run hints: how to swipe, then how to gust (hidden for good once the player has done it)
  var HINT_PX = 800, hintA = 0, gHintA = 0;
  function drawHints() {
    var dt = 1 / 60;
    var sp = S && S.stat ? +S.stat.swipePx || 0 : HINT_PX;
    var wantS = sp < HINT_PX && !down ? 1 : 0;
    var wantG = (S && S.stat && !(S.stat.gusts > 0) && S.gust >= 1 && coinCount >= 8 && clock > 20 && sp >= HINT_PX) ? 1 : 0;
    hintA += (wantS - hintA) * Math.min(1, dt * 5);
    gHintA += (wantG - gHintA) * Math.min(1, dt * 4);
    var g = ctx;
    if (hintA > 0.02) {
      var cy = H * 0.42, amp = Math.min(W * 0.32, 130), ph = rm ? 0.25 : (clock * 0.55) % 1;
      g.save();
      if (!rm) { // ghost fingertip sweeping an S-curve, with a fading gold trail
        g.globalCompositeOperation = 'lighter';
        for (var k = 0; k < 14; k++) {
          var q = ph - k * 0.018; if (q < 0) break;
          var tx = W * 0.5 + amp * Math.sin(q * TAU), ty = cy + 26 * Math.sin(q * TAU * 2);
          g.globalAlpha = hintA * 0.5 * (1 - k / 14);
          drawSpr(sprGlow, tx, ty, 26 - k, 26 - k);
        }
        var hx = W * 0.5 + amp * Math.sin(ph * TAU), hy = cy + 26 * Math.sin(ph * TAU * 2);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = hintA * 0.75;
        g.fillStyle = 'rgba(239,230,214,0.85)'; ell(g, hx, hy, 11, 11); g.fill();
        g.strokeStyle = 'rgba(' + C.goldHiRGB + ',0.9)'; g.lineWidth = 2; ell(g, hx, hy, 16, 16); g.stroke();
      }
      g.globalAlpha = hintA * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 3)));
      hintLabel(g, 'Swipe to gather gold', W * 0.5, cy + 56);
      g.restore();
    }
    if (gHintA > 0.02) {
      g.save();
      g.globalAlpha = gHintA * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(clock * 3)));
      hintLabel(g, 'Flick fast for a Wing Gust', W * 0.5, H * 0.3);
      g.restore();
    }
  }
  function hintLabel(g, text, x, y) {
    g.font = F_TEXT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 4; g.lineJoin = 'round'; g.strokeStyle = 'rgba(12,9,18,0.8)';
    g.strokeText(text, x, y);
    g.fillStyle = C.goldHi; g.fillText(text, x, y);
  }
  function drawStreak() {
    var g = ctx, mv = stkLabelV;
    // meter in the top-left of the cave
    if (stkShow > 0.02) {
      var x = 30, y = 30, r = 19 * (1 + stkPulse * 0.25);
      var nextT = stkIdx < stTop ? ST_AT[stkIdx + 1] : -1;
      var prog = nextT > 0 ? clamp((stkT - ST_AT[stkIdx]) / (nextT - ST_AT[stkIdx]), 0, 1) : 1;
      var hot = mv >= 5;
      g.save();
      g.globalAlpha = stkShow * hudDim;
      g.fillStyle = 'rgba(12,9,18,0.62)'; ell(g, x, y, r + 4, r + 4); g.fill();
      g.lineWidth = 4; g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.1)'; ell(g, x, y, r, r); g.stroke();
      g.strokeStyle = hot ? C.ember : C.gold;
      g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + prog * TAU); g.stroke();
      g.font = F_STREAK; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = hot ? '#ffd2a8' : C.goldHi;
      g.fillText(stkLabel, x, y + 1);
      g.restore();
    }
    // soft glow + small arc at the fingertip while swiping
    if (down && fx >= 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.28 + Math.min(0.3, spd / 3000);
      drawSpr(st.emberActive ? sprEmber : sprGlow, fx, fy, 64, 64);
      g.restore();
      if (mv > 1) {
        g.save();
        g.globalAlpha = 0.85;
        g.font = F_FINGER; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = 'rgba(22,12,6,0.75)'; g.lineJoin = 'round';
        var ly = fy - 40 < 14 ? fy + 40 : fy - 40;
        g.strokeText(stkLabel, fx, ly);
        g.fillStyle = mv >= 5 ? '#ffc79a' : C.goldHi;
        g.fillText(stkLabel, fx, ly);
        g.restore();
      }
    }
  }
  function drawBanner() {
    if (bn.life <= 0) return;
    var g = ctx, el = bn.max - bn.life;
    var a = Math.min(1, el / 0.25, bn.life / 0.5);
    var y = H * 0.24, sc = el < 0.25 ? 0.85 + 0.15 * (el / 0.25) : 1;
    g.save();
    g.globalAlpha = a;
    var bg = g.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, 'rgba(10,8,16,0)'); bg.addColorStop(0.5, 'rgba(10,8,16,0.72)'); bg.addColorStop(1, 'rgba(10,8,16,0)');
    g.fillStyle = bg; g.fillRect(0, y - 34, W, bn.text ? 70 : 52);
    g.translate(W / 2, y); g.scale(sc, sc);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = F_TITLE;
    g.shadowColor = 'rgba(' + C.goldRGB + ',0.8)'; g.shadowBlur = 14;
    g.fillStyle = C.goldHi; g.fillText(bn.title, 0, -8);
    g.shadowBlur = 0;
    if (bn.text) { g.font = F_TEXT; g.fillStyle = C.ink; g.fillText(bn.text, 0, 20); }
    g.restore();
  }
  function draw() {
    var g = ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (bgCv) g.drawImage(bgCv, 0, 0, W, H);
    else { g.fillStyle = C.cave; g.fillRect(0, 0, W, H); }
    if (shakeT > 0 && !rm) {
      var amp = 7 * (shakeT / 0.32);
      g.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }
    // ambient glow, breathing
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.55 + 0.12 * Math.sin(clock * 0.8);
    g.fillStyle = st.frenzyActive ? glowHot : glowGrad;
    g.fillRect(0, 0, W, H);
    if (st.frenzyActive) { g.globalAlpha = 0.25 + 0.15 * Math.sin(clock * 6); g.fillStyle = glowHot; g.fillRect(0, 0, W, H); }
    if (!rm) {
      for (var i = 0; i < DUST_N; i++) {
        var d = dust[i];
        g.globalAlpha = 0.25 + 0.25 * Math.sin(clock * 1.3 + d.ph);
        drawSpr(sprGlow, d.x, d.y, 6 * d.s, 6 * d.s);
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    // hoard pile
    var bump = 1 + pileBump * 0.035;
    g.save();
    g.translate(W * 0.5, baseY); g.scale(1 + pileBump * 0.012, bump);
    g.drawImage(pileCv, -pileOx, -pileOy, pileCw, pileCh);
    g.restore();
    if (layers.length) drawLayers(false); // z < 0: behind the dragon, in front of the hoard
    if (kob.on) drawKobold();
    drawDragon(W * 0.5, peakY() + 4 * dk, dkS());
    drawCoins();
    if (tr.on) drawTreasure();
    drawParts(false);
    g.globalCompositeOperation = 'lighter';
    drawParts(true);
    g.globalCompositeOperation = 'source-over';
    if (layers.length) drawLayers(true); // z >= 0: in front of dragon, coins and particles
    drawTrail();
    drawFloats();
    drawStreak();
    drawHints();
    drawBanner();
    if (flashA > 0) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = flashA;
      g.fillStyle = glowGrad; g.fillRect(0, 0, W, H);
      g.globalAlpha = flashA * 0.35; g.fillStyle = C.goldHi; g.fillRect(0, 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
  }

  // ---------------------------------------------------------------- update
  function refreshStats() {
    stT = 0.25;
    refreshNugZones();
    if (!E || !S || typeof E.stats !== 'function') return;
    var s = null;
    try { s = E.stats(S); } catch (e) { s = null; }
    if (!s) return;
    st.coinWorth = num(s.coinWorth, st.coinWorth);
    st.spillRate = Math.max(0, num(s.spillRate, 1.5));
    st.sweepRate = Math.max(0, num(s.sweepRate, 0));
    st.gustWorthMult = num(s.gustWorthMult, 3) || 3;
    st.maxStreak = num(s.maxStreak, 5) || 5;
    stRamp = clamp(num(s.streakRamp, 1), 0.1, 100);
    st.emberActive = !!s.emberActive;
    st.frenzyActive = !!s.frenzyActive;
    try { st.minesOpen = !!(HOARD.mines && typeof HOARD.mines.isOpen === 'function' && HOARD.mines.isOpen(S)); } catch (e) { st.minesOpen = false; }
    var ti = s.treasureInterval;
    if (ti && ti.length >= 2) {
      tiMin = Math.max(1, num(ti[0], 70));
      tiMax = Math.max(tiMin, num(ti[1], 130));
      if (!tr.on && trTimer > tiMax) trTimer = tiMin + Math.random() * (tiMax - tiMin);
    }
    stTop = computeTop();
  }
  function update(dt) {
    if (S && E) {
      updateStreak(dt);
      var mult = streakMult();
      if (pendN > 0) {
        var g = eNum('coinCollected', pendN, mult, pendV / pendN);
        addGain(gA, g, gainX, gainY);
        sfx('coin', { n: pendN, streak: mult });
        pendN = 0; pendV = 0;
      }
      if (pendNug > 0) {
        var M = HOARD.mines, ore = 0;
        try { ore = M && typeof M.nuggets === 'function' ? num(M.nuggets(S, pendNug), 0) : 0; } catch (e) { ore = 0; }
        pendNug = 0;
        if (ore > 0) { gO.g += ore; gO.x = gainX; gO.y = gainY; }
      }
      if (strokePx >= STROKE_STEP) {
        var n = Math.floor(strokePx / STROKE_STEP);
        strokePx -= n * STROKE_STEP;
        var g2 = eNum('strokeCollected', n * STROKE_STEP, mult);
        addGain(gA, g2, px, py);
      }
      spillAcc += st.spillRate * dt;
      if (spillAcc > 4) spillAcc = 4;
      while (spillAcc >= 1) { spillAcc -= 1; spawnCoin(0, 0, 0); }
      if (swarmLeft > 0) {
        swarmAcc += dt * 60;
        while (swarmAcc >= 1 && swarmLeft > 0) { swarmAcc -= 1; swarmLeft--; spawnCoin(1, swarmX, swarmY); }
      } else swarmAcc = 0;
      updateKobold(dt);
      updateTreasure(dt);
    } else {
      frameMove = 0;
    }
    updateCoins(dt);
    updateParts(dt);
    flushGain(gA, dt);
    flushGain(gB, dt);
    flushGain(gO, dt);
    updateAmbience(dt);
    updatePile();
  }

  // ---------------------------------------------------------------- public API
  cave.init = function (canvasEl, gs) {
    if (!canvasEl || typeof canvasEl.getContext !== 'function') return;
    getState = typeof gs === 'function' ? gs : function () { return null; };
    if (inited && canvasEl === canvas) { resize(); return; }
    canvas = canvasEl;
    ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    if (!ctx) return;
    var cs = canvas.style;
    cs.touchAction = 'none'; cs.userSelect = 'none'; cs.webkitUserSelect = 'none';
    cs.webkitTapHighlightColor = 'transparent'; cs.webkitTouchCallout = 'none';
    bgCv = document.createElement('canvas');
    pileCv = document.createElement('canvas');
    try { mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mql = null; }
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', onUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(function () { resize(); }).observe(canvas); } catch (e) { /* ignore */ }
    }
    window.addEventListener('resize', resize);
    for (var i = 0; i < DUST_N; i++) { dust[i].s = 0.6 + Math.random() * 1.2; dust[i].ph = Math.random() * TAU; dust[i].sp = 0.5 + Math.random(); }
    inited = true;
    sizeKey = '';
    resize();
    trTimer = 35 + Math.random() * 20; // first treasure a little sooner than the steady 70-130 s cadence
    kob.x = W + 20;
  };
  cave.frame = function (dt) {
    if (!inited || !ctx) return;
    dt = +dt;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    frameDt = dt;
    var s = null;
    try { s = getState ? getState() : null; } catch (e) { s = null; }
    S = (s && typeof s === 'object') ? s : null;
    E = HOARD.engine || null;
    if (S) S._caveActive = true;
    rm = !!(S && S.settings && S.settings.reducedMotion) || !!(mql && mql.matches);
    stT -= dt;
    if (stT <= 0) refreshStats();
    update(dt);
    draw();
  };
  cave.resize = function () { sizeKey = ''; resize(); };
  cave.gust = function () {
    if (!inited) return false;
    if (!S) { try { S = getState ? getState() : null; } catch (e) { S = null; } E = HOARD.engine || null; }
    return doGust(W * 0.5, peakY() - 40 * dk);
  };
  cave.streak = function () { return streakMult(); };

  // ---- v2 hooks
  cave.addLayer = function (def) {
    if (!def || typeof def.id !== 'string' || typeof def.draw !== 'function') return false;
    var L = { id: def.id, z: num(+def.z, 1), draw: def.draw, _err: 0 };
    for (var i = 0; i < layers.length; i++) if (layers[i].id === L.id) { layers.splice(i, 1); break; }
    layers.push(L);
    layers.sort(function (a, b) { return a.z - b.z; });
    return true;
  };
  cave.removeLayer = function (id) {
    for (var i = 0; i < layers.length; i++) if (layers[i].id === id) { layers.splice(i, 1); return true; }
    return false;
  };
  // Starfall hooks (EXTENSIONS.md 4): fn(px, py, x, y, t, strokeSeq) for every swipe segment, after the coins and
  // the treasure (canvas-local CSS px; strokeSeq goes up by one per finger-down). A hook that throws 5 times is dropped.
  cave.addSwipeHook = function (fn) {
    if (typeof fn !== 'function') return false;
    for (var i = 0; i < swipeHooks.length; i++) if (swipeHooks[i].fn === fn) return false;
    swipeHooks.push({ fn: fn, err: 0 });
    return true;
  };
  cave.removeSwipeHook = function (fn) {
    for (var i = 0; i < swipeHooks.length; i++) if (swipeHooks[i].fn === fn) { swipeHooks.splice(i, 1); return true; }
    return false;
  };
  // dim the streak meter in the top-left (and, by reading cave.hudDim(), other top-of-cave HUD layers) while a
  // Starfall needs that space: 0.2..1
  cave.setHudDim = function (a) { a = +a; hudDim = isFinite(a) ? clamp(a, 0.2, 1) : 1; };
  cave.hudDim = function () { return hudDim; };
  // grow the dragon: 1..1.25 (its eye anchor and the coin keep-out zone follow)
  cave.setDragonScale = function (k) { k = +k; dScale = isFinite(k) ? clamp(k, 1, 1.25) : 1; };
  cave.dragonScale = function () { return dScale; };
  // fn(g, part, clock, reducedMotion) draws inside the dragon's transform (dragon units, origin at its feet);
  // part: 'wing' (folded-wing frame), 'belly', 'headBack' (head frame, before the horns), 'head' (head frame, on top)
  cave.setDragonDecor = function (fn) { decor = typeof fn === 'function' ? fn : null; decorErr = 0; };
  cave.addSfxHook = function (fn) {
    if (typeof fn !== 'function' || sfxHooks.indexOf(fn) >= 0) return false;
    sfxHooks.push(fn);
    return true;
  };
  // named points in canvas-local CSS px (x, y) plus viewport coordinates (cx, cy)
  cave.anchor = function (name) {
    var x = W * 0.5, y = H * 0.5;
    if (name === 'hoard') { x = W * 0.5; y = peakY() + pileH * 0.35; }
    else if (name === 'dragon') { x = W * 0.5 + 41 * dkS(); y = peakY() + 4 * dk - 64 * dkS(); }
    else if (name === 'floor') { x = W * 0.5; y = baseY; }
    else if (name === 'nookL') { x = Math.max(36, W * 0.13); y = baseY - 6 * dk; }
    else if (name === 'nookR') { x = Math.min(W - 36, W * 0.87); y = baseY - 6 * dk; }
    else if (name === 'streak') { x = 30; y = 30; }
    else if (name === 'finger') { if (down && fx >= 0) { x = fx; y = fy; } }
    else if (name === 'gustBtn') {
      try {
        var gb = document.getElementById('gust');
        if (gb && canvas) {
          var a = gb.getBoundingClientRect(), r = canvas.getBoundingClientRect();
          x = a.left + a.width * 0.5 - r.left; y = a.top + a.height * 0.5 - r.top;
        }
      } catch (e) { /* ignore */ }
    }
    var cx = x, cy = y;
    try { if (canvas) { var rr = canvas.getBoundingClientRect(); cx = rr.left + x; cy = rr.top + y; } } catch (e) { /* ignore */ }
    return { x: x, y: y, cx: cx, cy: cy };
  };
  cave.metrics = function () {
    return { w: W, h: H, dpr: dpr, unit: unit, dk: dk, baseY: baseY, peakY: peakY(), pileW: pileW, pileH: pileH, coinR: coinR, reducedMotion: rm, inited: inited, coins: coinCount };
  };
  // coins on screen right now (Restless Wings auto-gust reads this minus nugCount(): it leaves nuggets alone)
  cave.coinCount = function () { return inited ? coinCount : 0; };
  cave.nugCount = function () { return inited ? nugsOnScreen() : 0; };
  // test hook (cave-check / smoke): screen positions of the nuggets on screen
  cave.nuggets = function () { var o = []; for (var i = 0; i < MAX_COINS; i++) if (coins[i].on && coins[i].n) o.push([coins[i].x, coins[i].y]); return o; };
  // floating label like the gold numbers (text is drawn as given; color optional)
  cave.float = function (x, y, text, big, color) {
    if (!inited) return;
    var f = spawnFloat(num(+x, W * 0.5), num(+y, H * 0.5), 0, !!big);
    if (f) { f.txt = String(text); f.col = typeof color === 'string' ? color : ''; }
  };
  // a burst of particles: kind 'star' (default) | 'spark'
  cave.burst = function (x, y, n, kind) {
    if (!inited) return;
    sparks(num(+x, W * 0.5), num(+y, H * 0.5), clamp(Math.floor(num(+n, 10)), 1, 40), 260, kind === 'spark' ? P_SPARK : P_STAR);
  };
})();
