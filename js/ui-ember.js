/* Hoard — js/ui-ember.js — Ember, the second dragon: the Ember tab (warmth header, kilns, Fire Breaths),
 * the cave layer (a small ember-red dragon curled in the left nook who wakes when Wake Ember is bought),
 * swipe-feed motes and toasts. Loaded after ui.js, before main.js. Engine-side rules live in js/ember.js. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui, E = HOARD.engine, X = HOARD.ember;
  if (!ui || !ui.addTab || !E || !X) return;
  var fmt = function (n) { return HOARD.fmt(n); };
  var fmtRate = function (n) { return HOARD.fmtRate(n); };
  var EMBER_HOT = '#ff9a5c';

  // ================================================================ CSS (v1 tokens; classes prefixed .emb-)
  ui.css([
    '.emb-head { background: radial-gradient(120% 140% at 0% 0%, rgba(232,99,58,0.30), rgba(232,99,58,0) 60%), linear-gradient(160deg, #3a2027 0%, var(--rock) 60%, #1d1927 100%); border-color: rgba(232,99,58,0.45); }',
    '.emb-head .row { align-items: flex-start; }',
    '.emb-lab { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); }',
    '.emb-warm { font-family: var(--font-d); font-size: 40px; line-height: 1; color: #ffb27a; font-variant-numeric: tabular-nums; text-shadow: 0 0 18px rgba(232,99,58,0.45); margin-top: 2px; white-space: nowrap; }',
    '.emb-warm small { font-family: var(--font-b); font-size: 15px; font-weight: 700; color: var(--ink-dim); text-shadow: none; margin-left: 4px; }',
    '.emb-pool { text-align: right; flex: none; }',
    '.emb-num { font-family: var(--font-d); font-size: 30px; line-height: 1; color: var(--gold-hi); font-variant-numeric: tabular-nums; margin-top: 2px; white-space: nowrap; }',
    '.emb-rate { font-size: 14px; color: #ffb27a; font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.emb-note { font-size: 14px; color: var(--ink-dim); margin-top: 10px; line-height: 1.3; }',
    '.emb-note b { color: var(--ink); font-weight: 700; }',
    '.emb-goal { margin-top: 8px; }',
    '.emb-goal .bar > i { background: linear-gradient(90deg, #8a3420, var(--ember), #ffb27a); }',
    '.emb-ico { display: inline-block; width: 16px; height: 16px; vertical-align: -2px; color: var(--ember); margin-right: 5px; }',
    '.emb-ico svg, .emb-tag svg { display: block; width: 100%; height: 100%; }',
    '.emb .cost .c-emb { color: #ffb27a; font-weight: 700; }',
    '.emb .cost .short { color: var(--ink-faint); }',
    '.emb .bar.emb-ms > i { background: linear-gradient(90deg, #8a3420, var(--ember)); }',
    '.emb .btn.can { background: linear-gradient(180deg, #ffc196, #f08a52 55%, #cf5a30); color: #2a0d04; border-color: #ffd5b8; box-shadow: 0 2px 10px rgba(232,99,58,0.3); }',
    '.emb-breath .name { font-size: 16px; }',
    '.emb-breath .btn { min-width: 104px; }',
    '.emb-breath.can-buy { border-color: rgba(232,99,58,0.55); }',
    '.emb-learned { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }',
    '.emb-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(232,99,58,0.4); color: #ffcfae; font-size: 13px; font-weight: 700; background: rgba(232,99,58,0.08); }',
    '.emb-tag > span { display: inline-block; width: 14px; height: 14px; }'
  ].join('\n'), 'ember');

  function icon(name, cls) {
    var sp = ui.el('span', cls || 'emb-ico');
    sp.innerHTML = (ui.icons && (ui.icons[name] || ui.icons.flame)) || '';
    return sp;
  }

  // ================================================================ tab
  function visibleKilns(s) { var n = 0; for (var k = 0; k < X.KILNS.length; k++) if (X.kilnVisible(s, k)) n++; return n; }
  function warmStr(w) { return w >= 100 ? fmt(w) : (Math.round(w * 100) / 100).toFixed(2); }

  // warmth goal: the next power of ten of lifetime embers
  function goal(earned) {
    var L = earned > 0 ? Math.floor(Math.log(earned + 1) / Math.LN10) : 0;
    var lo = L <= 0 ? 0 : Math.pow(10, L), hi = Math.pow(10, L + 1);
    return { lo: lo, hi: hi };
  }

  function buildHeader(host) {
    var c = ui.el('div', 'card emb-head');
    var r = ui.el('div', 'row');
    var left = ui.el('div', 'grow');
    var lab = ui.el('div', 'emb-lab');
    lab.appendChild(icon('ember'));
    lab.appendChild(document.createTextNode("Ember's warmth"));
    var warm = ui.el('div', 'emb-warm');
    var wv = ui.el('span', null, '×1.00');
    ui.add(warm, wv, ui.el('small', null, 'gold'));
    ui.add(left, lab, warm);
    var right = ui.el('div', 'emb-pool');
    var en = ui.el('div', 'emb-num', '0');
    var er = ui.el('div', 'emb-rate', '+0/s');
    ui.add(right, ui.el('div', 'emb-lab', 'Embers'), en, er);
    ui.add(r, left, right);
    var note = ui.el('div', 'emb-note');
    var feed = ui.el('b', null, '0');
    ui.add(note, document.createTextNode('Warms all gold/s and coin worth. Every coin you swipe feeds her '), feed,
      document.createTextNode(' embers.'));
    var gl = ui.el('div', 'emb-goal');
    var gb = ui.bar();
    var glab = ui.el('div', 'bar-label');
    var gL = ui.el('span'), gR = ui.el('span');
    ui.add(glab, gL, gR);
    ui.add(gl, gb, glab);
    ui.add(c, r, note, gl);
    host.appendChild(c);
    return function (s) {
      var w = X.warmth(s), earned = X.earned(s);
      ui.setText(wv, '×' + warmStr(w));
      ui.setText(en, fmt(Math.floor(X.embers(s))));
      ui.setText(er, '+' + fmtRate(X.rate(s)));
      var y = X.coinYield(s);
      ui.setText(feed, y >= 10 ? fmt(y) : (y >= 1 ? y.toFixed(1) : y.toFixed(2)));
      var g = goal(earned);
      var span = Math.log(g.hi + 1) - Math.log(g.lo + 1);
      ui.setW(gb.fill, span > 0 ? (Math.log(earned + 1) - Math.log(g.lo + 1)) / span : 0);
      ui.setText(gL, fmt(Math.floor(earned)) + ' embers stoked');
      ui.setText(gR, '×' + warmStr(X.warmthFor(g.hi, X.has(s, 'heart'))) + ' at ' + fmt(g.hi));
    };
  }

  function buildKilns(host, s0) {
    var parts = [];
    var head = ui.secHead('Kilns');
    var tog = ui.amtToggle();
    head.appendChild(tog);
    host.appendChild(head);
    parts.push(function (s) { tog.patch(s); });
    var teased = false;
    X.KILNS.forEach(function (kd, k) {
      if (!X.kilnVisible(s0, k)) {
        if (!teased) {
          teased = true;
          host.appendChild(ui.el('div', 'card locked', 'Light a ' + X.KILNS[k - 1].name + ' to find the ' + kd.name + '.'));
        }
        return;
      }
      var row = {};
      var c = ui.el('div', 'card');
      var r1 = ui.el('div', 'row');
      var g1 = ui.el('div', 'grow');
      row.rate = ui.el('div', 'sub num');
      ui.add(g1, ui.el('div', 'name', kd.name), row.rate);
      row.owned = ui.el('div', 'owned');
      ui.add(r1, g1, row.owned);
      var r2 = ui.el('div', 'row');
      var g2 = ui.el('div', 'grow');
      row.cost = ui.el('div', 'cost');
      row.cv = ui.el('span', 'c-emb');
      row.cost.appendChild(row.cv);
      g2.appendChild(row.cost);
      ui.milestoneBits(row, g2);
      row.mbar.classList.add('emb-ms');
      row.btn = ui.buyButton();
      ui.bindHold(row.btn, function () {
        var s = ui.state();
        return !!(s && X.buyKiln(s, k, ui.buyAmt(s)));
      });
      ui.add(r2, g2, row.btn);
      ui.add(c, r1, r2);
      host.appendChild(c);
      parts.push(function (s) {
        var owned = X.kilnCount(s, k);
        ui.setText(row.owned, fmt(owned));
        var each = X.kilnEach(s, k);
        ui.setText(row.rate, owned > 0 ? fmtRate(each) + ' each · ' + fmtRate(each * owned) + ' total' : fmtRate(each) + ' each · ' + kd.text);
        var amt = ui.buyAmt(s);
        var cost = X.kilnCost(s, k, amt);
        var max = X.kilnMax(s, k);
        ui.setText(row.cv, fmt(Math.ceil(cost.embers)) + ' embers');
        ui.setCls(row.cv, 'short', X.embers(s) < cost.embers);
        ui.setCls(row.btn, 'can', max >= (amt === 'max' ? 1 : amt));
        ui.setText(row.btn.s, '×' + fmt(Math.max(1, cost.n)));
        ui.milestonePatch(row, 'kiln', owned);
      });
    });
    return function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); };
  }

  function buildBreaths(host, s0) {
    var parts = [];
    var list = X.breathList(s0);
    var open = list.filter(function (b) { return !b.bought; });
    var done = list.filter(function (b) { return b.bought; });
    host.appendChild(ui.secHead('Fire Breaths', done.length + ' of ' + list.length + ' learned'));
    if (!open.length) host.appendChild(ui.el('p', 'hint', 'Ember knows every breath. Her kilns keep the warmth growing.'));
    else host.appendChild(ui.el('p', 'hint', 'One-time gifts of fire, paid in embers.'));
    open.forEach(function (b) {
      var c = ui.el('div', 'card emb-breath');
      var r = ui.el('div', 'row');
      var g = ui.el('div', 'grow');
      ui.add(g, ui.el('div', 'name', b.name), ui.el('div', 'sub', b.text));
      var btn = ui.button('buy', '');
      var bl = ui.el('span', null, 'Learn');
      var bs = ui.el('small', null, fmt(b.cost) + ' embers');
      ui.add(btn, bl, bs);
      btn.addEventListener('click', function () {
        var s = ui.state();
        if (s && X.buyBreath(s, b.id)) { ui.buzz(12); ui.refresh(); }
      });
      ui.add(r, g, btn);
      c.appendChild(r);
      host.appendChild(c);
      parts.push(function (s) {
        var can = X.embers(s) >= b.cost;
        ui.setCls(btn, 'can', can);
        ui.setCls(c, 'can-buy', can);
      });
    });
    if (done.length) {
      var wrap = ui.el('div', 'emb-learned');
      done.forEach(function (b) {
        var t = ui.el('span', 'emb-tag');
        t.title = b.text;
        t.appendChild(icon('check', ''));
        t.appendChild(document.createTextNode(b.name));
        wrap.appendChild(t);
      });
      host.appendChild(wrap);
    }
    return function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); };
  }

  ui.addTab({
    id: 'ember', label: 'Ember', icon: ui.icons.ember || ui.icons.flame, order: 70,
    visible: function (s) { return X.visible(s); },
    key: function (s) { return 'E' + (X.isAwake(s) ? 1 : 0) + ':' + visibleKilns(s) + ':' + X.breathsOwned(s); },
    badge: function (s) {
      if (!X.isAwake(s)) return 0;
      var em = X.embers(s), bl = X.BREATHS;
      for (var i = 0; i < bl.length; i++) if (!X.has(s, bl[i].id) && em >= bl[i].cost) return true;
      return 0;
    },
    build: function (host, s) {
      host.classList.add('emb');
      if (!X.isAwake(s)) {
        host.appendChild(ui.el('div', 'card locked', 'Ember is stirring in her nook…'));
        return null;
      }
      var p1 = buildHeader(host);
      var p2 = buildKilns(host, s);
      var p3 = buildBreaths(host, s);
      return function (s2, st) { p1(s2, st); p2(s2, st); p3(s2, st); };
    }
  });

  // ================================================================ toasts
  E.on('ember', function (x) {
    if (!x) return;
    if (x.type === 'wake') {
      ui.toast('Ember wakes', 'A second dragon stirs in the nook. Her kilns are in the Ember tab.', 'ember');
      ui.refresh();
    } else if (x.type === 'breath') {
      var b = null;
      for (var i = 0; i < X.BREATHS.length; i++) if (X.BREATHS[i].id === x.id) b = X.BREATHS[i];
      if (b) ui.toast(b.name, b.text, 'ember');
    } else if (x.type === 'milestone') {
      var kd = null;
      for (var j = 0; j < X.KILNS.length; j++) if (X.KILNS[j].id === x.id) kd = X.KILNS[j];
      if (kd) ui.toast(kd.name + ' ×2', 'for owning ' + fmt(x.count) + '.', 'ember');
    }
  });
  if (HOARD.whenReady) HOARD.whenReady(function (getState) {
    // kilns burn offline too: tell the player once after a return (welcome sheet shows the gold)
    setInterval(function () {
      if (document.hidden) return;
      var s = null;
      try { s = getState(); } catch (e) { s = null; }
      if (!s || !X.isAwake(s)) return;
      var g = X.takeOffline(s);
      if (g >= 1) ui.toast("Ember's kilns", '+' + fmt(Math.floor(g)) + ' embers while you were away.', 'ember');
    }, 1500);
  });

  // ================================================================ cave: Ember in the left nook
  var cave = HOARD.cave;
  if (!cave || !cave.addLayer) return;

  // palettes: index 0 = asleep (smouldering, dim) .. STEPS = awake; precomputed so drawing never allocates
  var STEPS = 12;
  var PAL_SLEEP = { body: [92, 38, 34], mid: [70, 28, 26], belly: [120, 66, 48], spike: [44, 18, 18], horn: [130, 112, 96], wing: [64, 26, 24], vein: [40, 16, 16] };
  var PAL_AWAKE = { body: [200, 66, 44], mid: [156, 46, 32], belly: [242, 166, 96], spike: [96, 28, 20], horn: [236, 214, 178], wing: [132, 36, 26], vein: [86, 22, 16] };
  var PAL = [];
  (function () {
    for (var i = 0; i <= STEPS; i++) {
      var f = i / STEPS, p = {};
      for (var key in PAL_AWAKE) {
        var a = PAL_SLEEP[key], b = PAL_AWAKE[key];
        p[key] = 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
      }
      PAL.push(p);
    }
  })();

  var glowGrad = null, glowCtx = null;
  var nook = { x: 0, y: 0, w: -1, h: -1 };
  var lastWoke = -1, wakeBurst = false, floatT = 0, blinkT = 2.5, blinkA = 0;
  // swipe-feed motes: coins collected fly a few sparks over to Ember
  var MOTES = 18, motes = [], moteT = 0;
  for (var mi = 0; mi < MOTES; mi++) motes.push({ on: false, x0: 0, y0: 0, t: 0, d: 0.7, o: 0 });

  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function ease(p) { return p * p * (3 - 2 * p); }
  function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function scale(m) { return (m && m.dk ? m.dk : 1) * 0.86; }
  function headPos(lift) {
    return { x: 17 + 7 * lift, y: -5 - 22 * lift };
  }

  cave.addSfxHook(function (name, data) {
    if (name !== 'coin' && name !== 'gust') return;
    var s = ui.state();
    if (!s || !X.isAwake(s)) return;
    var m = cave.metrics();
    if (!m || m.reducedMotion) return;
    var now = Date.now() / 1000;
    if (now - moteT < 0.16) return; // a few motes per second at most
    moteT = now;
    var a = cave.anchor(name === 'gust' ? 'hoard' : 'finger');
    var n = name === 'gust' ? 5 : 1 + Math.min(2, Math.floor(((data && data.n) || 1) / 3));
    for (var i = 0; i < MOTES && n > 0; i++) {
      var mo = motes[i];
      if (mo.on) continue;
      mo.on = true; mo.x0 = a.x + (Math.random() - 0.5) * 18; mo.y0 = a.y + (Math.random() - 0.5) * 18;
      mo.t = 0; mo.d = 0.55 + Math.random() * 0.35; mo.o = (Math.random() - 0.5) * 60;
      n--;
    }
  });

  cave.addLayer({
    id: 'ember', z: -1,
    draw: function (g, w, h, t, dt, s) {
      var m = cave.metrics();
      if (!m || !m.inited) return;
      if (nook.w !== w || nook.h !== h) {
        var a = cave.anchor('nookL');
        nook.x = a.x; nook.y = a.y; nook.w = w; nook.h = h;
      }
      if (glowCtx !== g) {
        glowCtx = g;
        glowGrad = g.createRadialGradient(4, -14, 2, 4, -14, 52);
        glowGrad.addColorStop(0, 'rgba(255,120,60,0.55)');
        glowGrad.addColorStop(0.5, 'rgba(232,99,58,0.18)');
        glowGrad.addColorStop(1, 'rgba(232,99,58,0)');
      }
      var rm = !!m.reducedMotion;
      var awake = !!(s && X.isAwake(s));
      var p = 0;
      if (awake) {
        var wk = s.ember ? +s.ember.wokeAt || 0 : 0;
        p = clamp01(((+s.time || 0) - wk) / 3.2);
        if (wk !== lastWoke) { lastWoke = wk; wakeBurst = p < 1; }
      }
      var k = scale(m);
      var x = nook.x, y = nook.y;
      var lift = ease(clamp01(p * 1.4));
      var pal = PAL[Math.round(clamp01(p * 1.6) * STEPS)];
      var br = Math.sin(t * (awake ? 1.6 : 0.9)) * 0.5 + 0.5; // breathing
      var heat = awake ? Math.min(1, 0.35 + 0.08 * Math.log(1 + X.rate(s)) / Math.LN10 * 2) : 0.12;

      if (wakeBurst && p > 0.3) {
        wakeBurst = false;
        var hp0 = headPos(1);
        if (cave.burst) cave.burst(x + hp0.x * k, y + hp0.y * k, rm ? 8 : 26, 'spark');
      }
      // blink
      if (awake && !rm) {
        blinkT -= dt;
        if (blinkT <= 0) { blinkA = 0.16; blinkT = 2.5 + Math.random() * 4; }
      }
      if (blinkA > 0) blinkA = Math.max(0, blinkA - dt);

      g.save();
      g.translate(x, y);
      g.scale(k, k);
      // warm glow from her belly-fire
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (0.35 + 0.65 * heat) * (0.75 + 0.25 * br) * (awake ? 1 : 0.5);
      g.fillStyle = glowGrad;
      g.fillRect(-56, -70, 112, 112);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // shadow
      g.fillStyle = 'rgba(10,6,12,0.45)'; ell(g, 0, 1, 30, 4.5); g.fill();
      // tail curling round the front, spade tip
      var sway = awake && !rm ? Math.sin(t * 1.3) * 2.2 : 0;
      g.fillStyle = pal.mid;
      g.beginPath();
      g.moveTo(-17, -9);
      g.bezierCurveTo(-34, -2, -26, 6, -6, 5);
      g.bezierCurveTo(6, 4.5, 16, 3, 24 + sway, -1);
      g.bezierCurveTo(15, 0.5, 6, 0.5, -6, 0.8);
      g.bezierCurveTo(-20, 0.5, -24, -3, -13, -12);
      g.closePath(); g.fill();
      g.fillStyle = pal.spike;
      g.beginPath(); g.moveTo(23 + sway, -1); g.lineTo(29 + sway, -6); g.lineTo(31 + sway, 0); g.lineTo(26 + sway, 3); g.closePath(); g.fill();
      // back spikes
      var by = 11 * (1 + br * 0.05);
      g.fillStyle = pal.spike;
      for (var i = 0; i < 4; i++) {
        var an = Math.PI * (1.15 + i * 0.2), cx = -3 + Math.cos(an) * 20, cy = -11 + Math.sin(an) * by;
        var nx = Math.cos(an), ny = Math.sin(an), sz = 4.2 - Math.abs(i - 1.5) * 0.6;
        g.beginPath();
        g.moveTo(cx + ny * 2.6, cy - nx * 2.6);
        g.lineTo(cx + nx * sz, cy + ny * sz);
        g.lineTo(cx - ny * 2.6, cy + nx * 2.6);
        g.closePath(); g.fill();
      }
      // body + belly
      g.fillStyle = pal.body; ell(g, -3, -11, 21, by); g.fill();
      g.fillStyle = pal.belly; ell(g, 3, -5.5, 13, 5); g.fill();
      // wing (folded asleep, stretches while waking, half-raised awake)
      var wa = p > 0 && p < 1 ? Math.sin(p * Math.PI) * 0.9 : 0;
      var wingRot = -0.1 - (awake ? 0.22 : 0) - wa - (awake && !rm ? Math.sin(t * 0.8) * 0.04 : 0);
      g.save();
      g.translate(-8, -19);
      g.rotate(wingRot);
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(-3, -12, -2, -22);
      g.quadraticCurveTo(-8, -17, -13, -17);
      g.quadraticCurveTo(-16, -11, -22, -10);
      g.quadraticCurveTo(-18, -3, -22, 2);
      g.quadraticCurveTo(-11, 2.5, 0, 5);
      g.closePath();
      g.fillStyle = pal.wing; g.fill();
      g.strokeStyle = pal.vein; g.lineWidth = 1.1; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(-2, -22);
      g.moveTo(-1, -8); g.lineTo(-13, -17);
      g.moveTo(-2, -4); g.lineTo(-22, -10);
      g.stroke();
      g.restore();
      // neck + head
      var hp = headPos(lift);
      g.strokeStyle = pal.body; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(8, -13); g.quadraticCurveTo(14, -14 - 8 * lift, hp.x - 2, hp.y + 1); g.stroke();
      g.save();
      g.translate(hp.x, hp.y);
      var tilt = 0.28 * (1 - lift) - 0.08 * lift + (awake && !rm ? Math.sin(t * 0.7) * 0.05 : 0);
      g.rotate(tilt);
      // horns
      g.fillStyle = pal.horn;
      g.beginPath(); g.moveTo(-4, -4); g.quadraticCurveTo(-9, -8, -14, -13); g.quadraticCurveTo(-8, -9, -1, -6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-1, -5.5); g.quadraticCurveTo(-3, -10, -5, -15); g.quadraticCurveTo(0, -10, 2.5, -6); g.closePath(); g.fill();
      g.fillStyle = pal.body; ell(g, 0, 0, 8, 6.6); g.fill(); ell(g, 7, 1.8, 6, 4); g.fill();
      g.fillStyle = pal.spike; ell(g, 11.6, 0.6, 0.9, 0.7); g.fill(); // nostril
      g.strokeStyle = pal.spike; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(5, 4.6); g.quadraticCurveTo(8.5, 6, 12, 4); g.stroke();
      var ex = 1.5, ey = -1.5;
      var open = awake ? clamp01((p - 0.35) / 0.4) : 0;
      if (blinkA > 0) open *= Math.abs(blinkA / 0.08 - 1);
      if (open > 0.1) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,150,70,0.35)'; ell(g, ex, ey, 6, 6); g.fill();
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#2a0e08'; ell(g, ex, ey, 3.2, 3.5); g.fill();
        g.fillStyle = '#ffb347'; ell(g, ex, ey, 2.6, 3 * open); g.fill();
        g.fillStyle = '#3a1004'; ell(g, ex + 0.5, ey, 0.7, 2.2 * open); g.fill();
        g.fillStyle = '#fff4dc'; ell(g, ex - 0.8, ey - 1.2 * open, 0.6, 0.6); g.fill();
      } else {
        g.strokeStyle = pal.spike; g.lineWidth = 1;
        g.beginPath(); g.moveTo(ex - 2.8, ey); g.quadraticCurveTo(ex, ey + 1.6, ex + 2.8, ey); g.stroke();
      }
      g.restore();

      // breath: smoke curls asleep; tiny spark puffs awake (stateless, phase-driven)
      var nx0 = hp.x + 12, ny0 = hp.y + 1;
      if (!awake) {
        for (var j = 0; j < 3; j++) {
          var ph = (t * 0.3 + j / 3) % 1;
          g.fillStyle = 'rgba(170,150,160,' + ((1 - ph) * 0.18).toFixed(3) + ')';
          ell(g, nx0 + ph * 8 + Math.sin(ph * 6 + j) * 2, ny0 - ph * 18, 1.4 + ph * 3, 1.4 + ph * 3); g.fill();
        }
      } else if (!rm) {
        var cyc = (t + 1.7) % 5.5;
        if (cyc < 1.1) {
          var q = cyc / 1.1;
          g.globalCompositeOperation = 'lighter';
          for (var si = 0; si < 9; si++) {
            var hs = hash(si + Math.floor((t + 1.7) / 5.5) * 13);
            var dq = clamp01(q * (1.1 + hs * 0.5) - hs * 0.2);
            if (dq <= 0 || dq >= 1) continue;
            var sx = nx0 + dq * (16 + hs * 12), sy = ny0 - dq * (4 + hs * 10) + dq * dq * 6;
            var rr = (1 - dq) * (1.4 + hs * 1.2);
            g.fillStyle = dq < 0.4 ? 'rgba(255,214,140,0.9)' : 'rgba(255,110,50,' + (0.9 * (1 - dq)).toFixed(3) + ')';
            ell(g, sx, sy, rr, rr); g.fill();
          }
          g.globalCompositeOperation = 'source-over';
        } else {
          // a faint ember glow at the nostril between puffs
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,120,60,' + (0.12 + 0.1 * br).toFixed(3) + ')';
          ell(g, nx0, ny0, 2.5, 2.5); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      }
      g.restore(); // back to the cave's own transform (CSS px + shake) for the motes
      if (!awake) return;
      // swipe-feed motes flying to Ember
      var tx = x + hp.x * k, ty = y + hp.y * k;
      g.globalCompositeOperation = 'lighter';
      for (var mi2 = 0; mi2 < MOTES; mi2++) {
        var mo = motes[mi2];
        if (!mo.on) continue;
        mo.t += dt;
        var u = mo.t / mo.d;
        if (u >= 1) { mo.on = false; continue; }
        var uu = ease(u);
        var cx2 = (mo.x0 + tx) * 0.5 + mo.o, cy2 = Math.min(mo.y0, ty) - 40;
        var px = (1 - uu) * (1 - uu) * mo.x0 + 2 * (1 - uu) * uu * cx2 + uu * uu * tx;
        var py = (1 - uu) * (1 - uu) * mo.y0 + 2 * (1 - uu) * uu * cy2 + uu * uu * ty;
        var a2 = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85 * 0.6;
        g.fillStyle = 'rgba(255,140,70,' + (0.85 * a2).toFixed(3) + ')';
        ell(g, px, py, 3, 3); g.fill();
        g.fillStyle = 'rgba(255,220,160,' + (0.7 * a2).toFixed(3) + ')';
        ell(g, px, py, 1.4, 1.4); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      // subtle batched "+N embers" float from swiping
      floatT += dt;
      if (floatT >= 2.2) {
        floatT = 0;
        var gain = X.takeCoinGain();
        if (gain >= 0.05 && cave.float) cave.float(tx + 6, ty - 10, '+' + (gain >= 10 ? fmt(gain) : gain.toFixed(1)) + ' embers', false, EMBER_HOT);
      }
    }
  });
})();
