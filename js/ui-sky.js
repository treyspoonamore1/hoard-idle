/* Hoard — js/ui-sky.js — Starfall + Growth, the UI side (SPEC-V2 "Starfall"): the cave launcher (one deliberate
 * press), the Starfall itself (a cave layer of falling stars and comets caught by swiping), the score sheet, the
 * Night Sky section in the Hoard tab, Sky Lanterns in the Mines tab, the dragon's growth (size + decorations) and
 * toasts/log/sound. Loaded after ui.js, before main.js. Engine-side rules live in js/sky.js.
 * Gold: none. Caught stars pay Stardust only and the normal coin spill keeps running while stars fall, so a Starfall
 * is gold-neutral by design (the same swipes still sweep coins). Toasts other than the sky's own wait until it ends. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui, E = HOARD.engine, X = HOARD.sky;
  if (!ui || !ui.addSection || !E || !X) return;
  var el = ui.el, add = ui.add, setText = ui.setText, setCls = ui.setCls, setHidden = ui.setHidden, setDis = ui.setDis;
  var INK = '#cfe3ff';
  var TAU = Math.PI * 2;
  function fmt(n) { return HOARD.fmt ? HOARD.fmt(n) : String(Math.round(n)); }
  function grp(n) { n = Math.floor(+n || 0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function S() { try { return ui.state(); } catch (e) { return null; } }
  function log(k, d) { try { if (HOARD.log && HOARD.log.event) HOARD.log.event(k, d); } catch (e) { /* ignore */ } }
  function snd(name, d) { try { if (HOARD.sound && HOARD.sound.play) HOARD.sound.play(name, d); } catch (e) { /* ignore */ } }
  function cave() { return HOARD.cave || null; }
  function rmOn() { try { return !!ui.reducedMotion(); } catch (e) { return false; } }
  function waitStr(sec) { sec = Math.max(0, +sec || 0); return sec < 60 ? Math.ceil(sec) + 's' : Math.ceil(sec / 60) + 'm'; }
  function perkOf(i) { var st = X.STAGES[i]; return st ? st.perk : ''; }
  function multTxt(m) { return '×' + (Math.round(m * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, ''); }

  // ================================================================ CSS (v1 tokens; classes prefixed .sky-)
  ui.css([
    '.sky-launch { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: 86px; width: 52px; height: 52px; border-radius: 50%; border: 0; padding: 0;',
    '  background: rgba(22, 19, 31, 0.78); color: ' + INK + '; cursor: pointer; touch-action: manipulation; -webkit-user-select: none; user-select: none; }',
    '.sky-launch[hidden] { display: none; }',
    '.sky-launch svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }',
    '.sky-launch .ring-bg { stroke: rgba(207, 227, 255, 0.14); }',
    '.sky-launch .ring { stroke: ' + INK + '; transition: stroke-dashoffset 0.25s linear; }',
    '.sky-launch .sl { position: relative; display: block; font-size: 13px; font-weight: 700; line-height: 1.05; letter-spacing: 0.02em; }',
    '.sky-launch .ss { display: block; font-size: 12px; font-weight: 500; color: rgba(207, 227, 255, 0.72); font-variant-numeric: tabular-nums; }',
    '.sky-launch:disabled { cursor: default; color: rgba(207, 227, 255, 0.55); }',
    '.sky-launch.full { box-shadow: 0 0 14px rgba(150, 190, 255, 0.45); animation: sky-pulse 2s ease-in-out infinite; }',
    '.sky-launch.run { pointer-events: none; background: rgba(22, 19, 31, 0.55); box-shadow: 0 0 16px rgba(150, 190, 255, 0.35); }',
    '.sky-launch.run .ss { color: ' + INK + '; }',
    '.sky-launch:active:not(:disabled) { filter: brightness(1.15); }',
    '@keyframes sky-pulse { 0%, 100% { box-shadow: 0 0 6px rgba(150, 190, 255, 0.25); } 50% { box-shadow: 0 0 18px rgba(150, 190, 255, 0.6); } }',
    '.toast.sky { border-color: rgba(207, 227, 255, 0.5); }',
    '.toast.sky b { color: ' + INK + '; }',
    '.sky-card { background: radial-gradient(120% 120% at 100% 0%, rgba(120, 150, 255, 0.16), rgba(120, 150, 255, 0) 60%), linear-gradient(160deg, #222a45 0%, var(--rock) 62%, #1a1828 100%); border-color: rgba(207, 227, 255, 0.22); }',
    '.sky-card .row { align-items: center; }',
    '.sky-pic { flex: none; width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 60%, rgba(207, 227, 255, 0.16), rgba(207, 227, 255, 0) 70%); color: ' + INK + '; }',
    '.sky-pic svg { display: block; width: 48px; height: 48px; overflow: visible; }',
    '.sky-xp { font-size: 15px; font-variant-numeric: tabular-nums; color: var(--ink); }',
    '.sky-xp b { color: ' + INK + '; font-weight: 700; }',
    '.sky-xp small { color: var(--ink-dim); font-size: 13px; }',
    '.bar.sky > i { background: linear-gradient(90deg, #4c5f96, #8fb1ea 60%, ' + INK + '); }',
    '.bar.sky.anim > i { transition: width 0.9s cubic-bezier(.2,.7,.2,1); }',
    '.sky-next { font-size: 14px; color: var(--ink-dim); margin: 8px 0 2px; }',
    '.sky-next b { color: ' + INK + '; font-weight: 700; }',
    '.sky-pips { letter-spacing: 2px; color: ' + INK + '; }',
    '.sky-card .kv span:last-child, .sky-sheet .kv span:last-child { color: var(--ink); }',
    '.sky-two { display: flex; gap: 14px; }',
    '.sky-two .kv { flex: 1 1 0; min-width: 0; }',
    '.sky-card .btn.wide { margin-top: 10px; }',
    '.btn.can.sky-go { background: linear-gradient(180deg, #eef5ff, #b9d2ff 55%, #8fadea); color: #121a33; border-color: #f2f7ff; box-shadow: 0 2px 12px rgba(150, 190, 255, 0.3); }',
    '.sky-sheet h3 { color: ' + INK + '; }',
    '.sky-sheet .sky-sub { font-size: 13px; color: var(--ink-dim); text-align: right; margin: -4px 0 4px; }',
    '.sky-sheet .sky-grow { margin-top: 10px; }',
    '.sky-sheet .bar-label { font-size: 13px; }',
    '.sky-up { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--radius); border: 1px solid rgba(242, 184, 75, 0.45); background: rgba(242, 184, 75, 0.08); color: var(--gold-hi); font-weight: 700; font-size: 15px; line-height: 1.3; }',
    '.sky-lant .name { font-size: 16px; }',
    '.sky-lant .btn { min-width: 104px; }',
    '.sky-lant .short { color: var(--ink-faint); }',
    '.sky-lant.done { text-align: center; color: ' + INK + '; font-weight: 700; }'
  ].join('\n'), 'sky');

  // ================================================================ the Starfall (module-level pools, no per-frame allocation)
  var NSTAR = 48, NCOMET = 2, NPUFF = 14, NTWIN = 8, NBG = 26, COMET_TAIL = 120;
  var stars = [], comets = [], puffs = [], twinsP = [], bgStars = [];
  var i0;
  for (i0 = 0; i0 < NSTAR; i0++) stars.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, pid: 0, ph: 0, r: 1 });
  for (i0 = 0; i0 < NCOMET; i0++) comets.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, ride: 0, touched: false, ridden: false, glow: 0, ang: 0 });
  for (i0 = 0; i0 < NPUFF; i0++) puffs.push({ on: false, x: 0, y: 0, t: 0 });
  for (i0 = 0; i0 < NTWIN; i0++) twinsP.push({ on: false, pid: 0, seq: -1, v: 0 });
  for (i0 = 0; i0 < NBG; i0++) bgStars.push({ x: Math.random(), y: Math.random() * 0.55, s: 0.5 + Math.random(), ph: Math.random() * TAU });
  var run = null;        // the Starfall in progress (never saved)
  var pairSeq = 0, nightA = 0, finishing = false;
  var spr = null, sprRm = null, tailGrad = null, tailCtx = null, nightGrad = null, nightKey = '';

  function makeSprites() {
    // soft pale-blue star: radial glow with a 10 px core (drawn at 26 px)
    spr = document.createElement('canvas'); spr.width = spr.height = 64;
    var g = spr.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.16, 'rgba(214,232,255,0.95)');
    gr.addColorStop(0.42, 'rgba(130,175,255,0.45)');
    gr.addColorStop(1, 'rgba(100,140,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    sparkle(g, 32, 32, 26, 3.2, 'rgba(240,247,255,0.9)');
    // reduced motion: a plain 4-point sparkle
    sprRm = document.createElement('canvas'); sprRm.width = sprRm.height = 64;
    sparkle(sprRm.getContext('2d'), 32, 32, 24, 5, INK);
  }
  function sparkle(g, x, y, r, w, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x + w * 0.35, y - w * 0.35, x + r, y);
    g.quadraticCurveTo(x + w * 0.35, y + w * 0.35, x, y + r);
    g.quadraticCurveTo(x - w * 0.35, y + w * 0.35, x - r, y);
    g.quadraticCurveTo(x - w * 0.35, y - w * 0.35, x, y - r);
    g.closePath(); g.fill();
  }
  function segHit(ax, ay, bx, by, cx, cy, r) {
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = 0;
    if (L > 0) { t = ((cx - ax) * dx + (cy - ay) * dy) / L; if (t < 0) t = 0; else if (t > 1) t = 1; }
    var ex = ax + dx * t - cx, ey = ay + dy * t - cy;
    return ex * ex + ey * ey <= r * r;
  }
  // the hoard's surface (same mound as cave.js)
  function groundAt(m, x) {
    var u = (x - m.w * 0.5) / (m.pileW || 1);
    if (u <= -1 || u >= 1) return m.baseY;
    var t = 1 - u * u;
    return m.baseY - (m.pileH || 0) * t * Math.sqrt(t);
  }
  function freeStar() { for (var i = 0; i < NSTAR; i++) if (!stars[i].on) return stars[i]; return null; }
  function spawnStar(x, y, vx, vy, pid) {
    var st = freeStar();
    if (!st) return null;
    st.on = true; st.x = x; st.y = y; st.vx = vx; st.vy = vy; st.pid = pid; st.ph = Math.random() * TAU; st.r = 0.85 + Math.random() * 0.3;
    run.total++;
    return st;
  }
  function spawn(m) {
    var p = run.p, w = m.w;
    var x = 22 + Math.random() * Math.max(1, w - 44), vy = (p.fallMin + Math.random() * (p.fallMax - p.fallMin)) * p.slow, vx = (Math.random() * 2 - 1) * 12;
    if (Math.random() < p.twinP && run.total + 2 <= run.max) {
      var off = 40 + Math.random() * 30, dir = (x + off > w - 22) ? -1 : (x - off < 22 ? 1 : (Math.random() < 0.5 ? -1 : 1));
      var x2 = Math.max(22, Math.min(w - 22, x + dir * off));
      pairSeq++;
      spawnStar(x, -12, vx, vy, pairSeq);
      spawnStar(x2, -12, vx, vy, pairSeq);
    } else if (run.total < run.max) spawnStar(x, -12, vx, vy, 0);
  }
  function startComet(m, k) {
    var c = comets[k], fromLeft = k % 2 === 0;
    var x0 = fromLeft ? -20 : m.w + 20, y0 = m.h * 0.06, x1 = fromLeft ? m.w + 20 : -20, y1 = m.h * 0.58;
    c.on = true; c.x = x0; c.y = y0; c.vx = (x1 - x0) / 1.6; c.vy = (y1 - y0) / 1.6; c.t = 0;
    c.ride = 0; c.touched = false; c.ridden = false; c.glow = 0; c.ang = Math.atan2(c.vy, c.vx);
  }
  // a twin star left the sky without being caught: free its pending pair slot (else 8 missed partners used them all)
  function freeTwin(pid) {
    if (!pid) return;
    for (var i = 0; i < NTWIN; i++) if (twinsP[i].on && twinsP[i].pid === pid) twinsP[i].on = false;
  }
  // distance^2 between segment a-b (the swipe) and segment c-d (a comet's head to its tail)
  function segSegD2(ax, ay, bx, by, cx, cy, dx, dy) {
    var m = Math.min(ptSegD2(ax, ay, cx, cy, dx, dy), ptSegD2(bx, by, cx, cy, dx, dy), ptSegD2(cx, cy, ax, ay, bx, by), ptSegD2(dx, dy, ax, ay, bx, by));
    // proper crossing
    var d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    var d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
    return m;
  }
  function ptSegD2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = 0;
    if (L > 0) { t = ((px - ax) * dx + (py - ay) * dy) / L; if (t < 0) t = 0; else if (t > 1) t = 1; }
    var ex = ax + dx * t - px, ey = ay + dy * t - py;
    return ex * ex + ey * ey;
  }
  function puff(x, y) {
    for (var i = 0; i < NPUFF; i++) if (!puffs[i].on) { var q = puffs[i]; q.on = true; q.x = x; q.y = y; q.t = 0; puffsOn++; return; }
  }

  // ---- swipe hook: segment (ax, ay) -> (bx, by) in canvas CSS px; seq = the finger-down it belongs to
  function onSwipe(ax, ay, bx, by, t, seq) {
    if (!run || run.ending) return;
    for (var i = 0; i < NSTAR; i++) {
      var st = stars[i];
      if (st.on && segHit(ax, ay, bx, by, st.x, st.y, 30)) catchStar(st, seq);
    }
    var dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
    for (var k = 0; k < NCOMET; k++) {
      var c = comets[k];
      if (!c.on || c.ridden) continue;
      // the whole comet counts, head to tail (a finger trailing it by 150 ms is ~40 px behind the head)
      var ca = Math.cos(c.ang), sa = Math.sin(c.ang);
      if (segSegD2(ax, ay, bx, by, c.x + ca * 6, c.y + sa * 6, c.x - ca * COMET_TAIL, c.y - sa * COMET_TAIL) > 40 * 40) continue;
      c.touched = true;
      var sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
      if (d > 0 && sp > 0 && (dx * c.vx + dy * c.vy) / (d * sp) >= 0.6) {
        c.ride += d; c.glow = 1;
        if (c.ride >= 160) rideComet(c);
      }
    }
  }
  function catchStar(st, seq) {
    var cv = cave();
    st.on = false;
    run.caught++;
    run.combo++;
    if (run.combo > run.best) run.best = run.combo;
    var v = 1 + Math.min(4, Math.floor(run.combo / 6));
    run.base += v;
    var label = '+' + v;
    if (st.pid) {
      var found = -1, partnerOn = false;
      for (var i = 0; i < NTWIN; i++) if (twinsP[i].on && twinsP[i].pid === st.pid) { found = i; break; }
      if (found >= 0) {
        var tw = twinsP[found];
        tw.on = false;
        if (tw.seq === seq) { run.base += tw.v + v; run.twins++; label = 'Twin +' + (2 * (tw.v + v)); }
      } else {
        for (var j = 0; j < NSTAR; j++) if (stars[j].on && stars[j].pid === st.pid) { partnerOn = true; break; }
        if (partnerOn) {
          for (var k2 = 0; k2 < NTWIN; k2++) if (!twinsP[k2].on) { var tp = twinsP[k2]; tp.on = true; tp.pid = st.pid; tp.seq = seq; tp.v = v; break; }
        }
      }
    }
    if (cv) {
      cv.burst(st.x, st.y, 6, 'star');
      cv.float(st.x, st.y - 6, label, label.length > 3, INK);
    }
    snd('star', { combo: run.combo });
    ui.buzz(6);
  }
  function rideComet(c) {
    var cv = cave();
    c.ridden = true;
    run.rides++;
    if (cv) { cv.burst(c.x, c.y, 26, 'star'); cv.float(c.x, c.y - 10, 'Comet ridden', true, INK); }
    try { E.setFlag(run.s, 'skyRide', 1); } catch (e) { /* ignore */ }
    snd('treasure', { kind: 'comet' });
    ui.buzz(25);
  }
  function endComet(c) {
    if (!c.on) return;
    c.on = false;
    if (!c.ridden && c.touched) run.cuts++;
  }
  function clearPools() {
    for (var i = 0; i < NSTAR; i++) stars[i].on = false;
    for (i = 0; i < NCOMET; i++) comets[i].on = false;
    for (i = 0; i < NTWIN; i++) twinsP[i].on = false;
  }

  // ---- start / finish / abort
  function canStart(s) { return !!(s && X.on(s) && !run && X.charges(s) >= 1 && !(s && s._skyRun)); }
  function startFall() {
    var s = S(), cv = cave();
    if (!canStart(s) || !cv || document.visibilityState === 'hidden') return false;
    if (ui.sheetOpen()) ui.closeSheet();
    var ch = X.charges(s), st = X.stage(s);
    var p = X.start(s);
    if (!p) return false;
    clearPools();
    run = { s: s, p: p, t: 0, spawnT: 0.35, total: 0, max: X.maxStars(p), caught: 0, combo: 0, best: 0, base: 0, twins: 0,
      rides: 0, cuts: 0, cometK: 0, ending: false, ch: ch, stage: st, xp0: (s.sky && +s.sky.xp) || 0, first: !((s.sky && s.sky.n) > 0),
      rideHint: !E.flag(s, 'skyRide'), seen: Date.now() };
    cv.addSwipeHook(onSwipe);
    if (cv.setHudDim) cv.setHudDim(0.3);
    ui.holdToasts(holdToast);
    log('starfall_start', { ch: ch, stage: st + 1 });
    snd('skyStart');
    ui.buzz(12);
    patchLauncher();
    ui.markDirty();
    return true;
  }
  function stopRun() {
    var cv = cave();
    if (cv) { cv.removeSwipeHook(onSwipe); if (cv.setHudDim) cv.setHudDim(1); }
    clearPools();
    run = null;
    ui.holdToasts(null);
    patchLauncher();
    ui.markDirty();
  }
  function abortFall(why) {
    if (!run) return;
    var sec = Math.round(run.t);
    try { X.abort(run.s); } catch (e) { /* ignore */ }
    stopRun();
    log('starfall_abort', { why: why, sec: sec });
  }
  // while stars fall only the sky's own toasts (and a dragon growing) show; the rest wait for the end
  function holdToast(t) { return !(t && (t.kind === 'sky' || /^Your dragon grew/.test(t.title || ''))); }
  function finishFall() {
    if (!run) return;
    var r = run, s = r.s, res = null;
    finishing = true;
    try { res = X.finish(s, { total: r.total, caught: r.caught, best: r.best, base: r.base, twins: r.twins, rides: r.rides, cuts: r.cuts }); } catch (e) { res = null; }
    finishing = false;
    stopRun();
    if (!res) return;
    log('starfall', { caught: res.caught, total: res.total, best: res.best, dust: res.dust, rides: res.rides, twins: res.twins, sec: Math.round(r.t),
      stage: res.stage + 1, rank: Math.floor(+s.rank || 1), grand: res.grand, ch: X.charges(s) });
    // never replace a sheet the player opened meanwhile (a card, a welcome back, a confirm): a toast sums it up instead
    try {
      if (ui.sheetOpen()) scoreToast(res);
      else showScore(s, r, res);
    } catch (e) {
      try { console.error('[HOARD] starfall score', e); } catch (e2) { /* ignore */ }
      scoreToast(res);
    }
  }
  function scoreToast(res) {
    ui.toast((res.grand ? 'Grand Starfall' : 'Starfall') + ': +' + grp(res.dust) + ' Stardust.',
      'Caught ' + res.caught + ' of ' + res.total + (res.stageUp ? '. Your dragon grew: ' + X.STAGES[res.stage].name + '.' : '.'), 'sky');
    if (res.stageUp) { snd('questDone'); ui.buzz(30); }
  }

  // ================================================================ score sheet
  function multWhy(s, r, res) {
    var why = [];
    var lv = (s.sky && +s.sky.lant) || 0;
    if (lv > 0) why.push(lv === 1 ? 'a Lantern' : 'Lanterns');
    if (res.rank >= 7) why.push('Rank ' + Math.floor(res.rank));
    if (res.grand) why.push('a Grand Starfall');
    if (!why.length) return '';
    return multTxt(res.mult) + ' from ' + (why.length > 1 ? why.slice(0, -1).join(', ') + ' and ' + why[why.length - 1] : why[0]);
  }
  function growLabel(s, xp) {
    var st = X.stageOfXp(xp), STG = X.STAGES;
    if (st < STG.length - 1) return STG[st].name + ' · ' + grp(xp) + ' / ' + grp(STG[st + 1].xp);
    var base = STG[st].xp, sc = Math.floor((xp - base) / X.SCALE_XP), lo = base + sc * X.SCALE_XP;
    return STG[st].name + ' · Star Scale ' + (sc + 1) + ' · ' + grp(xp - lo) + ' / ' + grp(X.SCALE_XP);
  }
  function fracOf(xp) {
    var st = X.stageOfXp(xp), STG = X.STAGES, lo, hi;
    if (st < STG.length - 1) { lo = STG[st].xp; hi = STG[st + 1].xp; }
    else { lo = STG[st].xp + Math.floor((xp - STG[st].xp) / X.SCALE_XP) * X.SCALE_XP; hi = lo + X.SCALE_XP; }
    return hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1;
  }
  function showScore(s, r, res) {
    var box = el('div');
    box.appendChild(el('h3', null, res.grand ? 'Grand Starfall' : 'Starfall'));
    var pct = res.total > 0 ? Math.round(100 * res.caught / res.total) : 0;
    add(box,
      ui.kv('Caught', el('span', null, res.caught + ' / ' + res.total + ' (' + pct + '%)')),
      ui.kv('Best combo', el('span', null, '×' + res.best)));
    if (r.p.comets >= 1) {
      var cm = res.rides > 0 ? (res.rides > 1 ? 'Ridden ×' + res.rides : 'Ridden') : (res.cuts > 0 ? 'Grazed' : 'Missed');
      box.appendChild(ui.kv(r.p.comets > 1 ? 'Comets' : 'Comet', el('span', null, cm)));
    }
    if (r.twins > 0) box.appendChild(ui.kv('Twin pairs', el('span', null, String(Math.min(r.twins, Math.floor(res.caught / 2))))));
    box.appendChild(ui.kv('Stardust', el('span', null, '+' + grp(res.dust))));
    var why = res.mult > 1.0001 ? multWhy(s, r, res) : '';
    if (why) box.appendChild(el('div', 'sky-sub', why));
    // growth bar: animates from the Stardust before to after
    var gw = el('div', 'sky-grow');
    var b = ui.bar('sky');
    var lab = el('div', 'bar-label');
    var lL = el('span'), lR = el('span');
    add(lab, lL, lR);
    add(gw, b, lab);
    box.appendChild(gw);
    var xp0 = r.xp0, xp1 = (s.sky && +s.sky.xp) || 0;
    var rm = rmOn();
    setText(lL, growLabel(s, rm ? xp1 : xp0));
    ui.setW(b.fill, fracOf(rm ? xp1 : xp0));
    if (!rm) {
      setTimeout(function () {
        b.classList.add('anim');
        if (res.stageUp || X.stageOfXp(xp1) > X.stageOfXp(xp0)) {
          ui.setW(b.fill, 1);
          setTimeout(function () {
            b.classList.remove('anim'); ui.setW(b.fill, 0); setText(lL, growLabel(s, xp1));
            setTimeout(function () { b.classList.add('anim'); ui.setW(b.fill, fracOf(xp1)); }, 40);
          }, 950);
        } else { ui.setW(b.fill, fracOf(xp1)); setText(lL, growLabel(s, xp1)); }
      }, 260);
    }
    if (res.stageUp) {
      var stn = X.STAGES[res.stage];
      box.appendChild(el('div', 'sky-up', 'Your dragon grew: ' + stn.name + '. ' + (stn.how || stn.perk) + '.'));
      setTimeout(function () { snd('questDone'); ui.buzz(30); }, rm ? 0 : 900);
    }
    var br = el('div', 'btn-row');
    var left = X.charges(s);
    if (left >= 1) br.appendChild(ui.button('can sky-go', 'Again (' + left + ' left)', function () { ui.closeSheet(); startFall(); }));
    br.appendChild(ui.button('ghost', 'Close', function () { ui.closeSheet(); }));
    box.appendChild(br);
    ui.sheet(box, { center: true, cls: 'sky-sheet', guardMs: 700 });
  }

  // ================================================================ cave layers
  var cv0 = cave();
  if (cv0 && cv0.addLayer) {
    // night tint + faint background stars, behind the dragon (fades in while a Starfall runs)
    cv0.addLayer({
      id: 'skynight', z: -2,
      draw: function (g, w, h, t, dt) {
        var want = run ? 1 : 0;
        nightA += (want - nightA) * Math.min(1, dt * (want ? 2.5 : 1.5));
        if (nightA < 0.01) { nightA = want ? nightA : 0; return; }
        var key = w + 'x' + h;
        if (!nightGrad || nightKey !== key || g !== tailCtx) {
          nightKey = key; tailCtx = g;
          nightGrad = g.createLinearGradient(0, 0, 0, h * 0.75);
          nightGrad.addColorStop(0, 'rgba(18,28,70,0.62)');
          nightGrad.addColorStop(0.6, 'rgba(18,28,70,0.22)');
          nightGrad.addColorStop(1, 'rgba(18,28,70,0)');
          tailGrad = g.createLinearGradient(0, 0, -140, 0);
          tailGrad.addColorStop(0, 'rgba(235,244,255,0.95)');
          tailGrad.addColorStop(0.25, 'rgba(170,200,255,0.5)');
          tailGrad.addColorStop(1, 'rgba(120,160,255,0)');
        }
        g.globalAlpha = nightA;
        g.fillStyle = nightGrad; g.fillRect(0, 0, w, h * 0.75);
        var m = cave().metrics(), rm = !!(m && m.reducedMotion);
        g.fillStyle = INK;
        for (var i = 0; i < NBG; i++) {
          var b = bgStars[i];
          g.globalAlpha = nightA * (rm ? 0.45 : 0.3 + 0.3 * Math.sin(t * 1.7 + b.ph));
          g.fillRect(b.x * w, b.y * h, b.s, b.s);
        }
        g.globalAlpha = 1;
      }
    });
    cv0.addLayer({ id: 'sky', z: 1, draw: drawSky });
  }

  // the layer must never throw: the cave drops a layer after 5 errors, and the Starfall's clock lives here
  var drawErr = 0;
  function drawSky(g, w, h, t, dt, s) {
    try { drawSkyInner(g, w, h, t, dt, s); } catch (e) {
      if (++drawErr <= 3) { try { console.error('[HOARD] starfall draw', e); } catch (e2) { /* ignore */ } }
      try { g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; } catch (e3) { /* ignore */ }
      if (run) abortFall('error');
    }
  }
  var puffsOn = 0;
  function drawSkyInner(g, w, h, t, dt, s) {
    // puffs of missed stars (also after the end)
    if (puffsOn > 0) {
      puffsOn = 0;
      g.fillStyle = 'rgb(150,145,160)';
      for (var q = 0; q < NPUFF; q++) {
        var pf = puffs[q];
        if (!pf.on) continue;
        pf.t += dt;
        if (pf.t >= 0.55) { pf.on = false; continue; }
        puffsOn++;
        var u = pf.t / 0.55;
        g.globalAlpha = 0.35 * (1 - u);
        g.beginPath(); g.arc(pf.x, pf.y - 4 - 6 * u, 3 + 7 * u, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    if (!run) return;
    var cv = cave(), m = cv && cv.metrics();
    if (!m || !m.inited) return;
    if (!spr) makeSprites();
    var rm = !!m.reducedMotion;
    if (s !== run.s) { abortFall('replaced'); return; }
    var p = run.p;
    run.t += dt;
    run.seen = Date.now();
    // spawn
    if (run.t < p.dur) {
      run.spawnT -= dt;
      while (run.spawnT <= 0) { spawn(m); run.spawnT += (1 / p.rate) * (0.8 + Math.random() * 0.4); }
    }
    if (run.cometK < p.comets && run.t >= p.dur * (run.cometK === 0 ? 0.3 : 0.65)) { startComet(m, run.cometK); run.cometK++; }
    // stars fall
    var anyOn = false;
    for (var i = 0; i < NSTAR; i++) {
      var st = stars[i];
      if (!st.on) continue;
      st.x += st.vx * dt; st.y += st.vy * dt;
      if (st.x < 8) { st.x = 8; st.vx = Math.abs(st.vx); } else if (st.x > w - 8) { st.x = w - 8; st.vx = -Math.abs(st.vx); }
      // a landed star halves the combo (a full reset made star values above 1 rare for anyone not aiming perfectly)
      if (st.y >= groundAt(m, st.x) - 3) { st.on = false; run.combo = Math.floor(run.combo / 2); freeTwin(st.pid); puff(st.x, st.y); continue; }
      anyOn = true;
    }
    // comets cross
    for (var k = 0; k < NCOMET; k++) {
      var c = comets[k];
      if (!c.on) continue;
      c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.glow > 0) c.glow = Math.max(0, c.glow - dt * 3);
      if (c.t >= 1.75) endComet(c); else anyOn = true;
    }
    // draw: twin threads, stars, comets
    g.strokeStyle = 'rgba(207,227,255,0.22)'; g.lineWidth = 1;
    for (i = 0; i < NSTAR; i++) {
      var a = stars[i];
      if (!a.on || !a.pid) continue;
      for (var j = i + 1; j < NSTAR; j++) {
        var b2 = stars[j];
        if (b2.on && b2.pid === a.pid) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.stroke(); break; }
      }
    }
    g.globalCompositeOperation = 'lighter';
    for (i = 0; i < NSTAR; i++) {
      var s2 = stars[i];
      if (!s2.on) continue;
      if (rm) { g.globalAlpha = 1; g.drawImage(sprRm, s2.x - 11, s2.y - 11, 22, 22); continue; }
      var tw = 0.82 + 0.18 * Math.sin(t * 7 + s2.ph), sz = 32 * s2.r * tw;
      // a short falling trail
      g.globalAlpha = 0.28;
      g.drawImage(spr, s2.x - sz * 0.22, s2.y - sz * 0.9 - 6, sz * 0.44, sz * 0.9);
      g.globalAlpha = 1;
      g.drawImage(spr, s2.x - sz * 0.5, s2.y - sz * 0.5, sz, sz);
    }
    g.globalAlpha = 1;
    if (tailGrad) {
      for (k = 0; k < NCOMET; k++) {
        var cm = comets[k];
        if (!cm.on) continue;
        g.save();
        g.translate(cm.x, cm.y); g.rotate(cm.ang);
        g.fillStyle = tailGrad;
        g.beginPath(); g.moveTo(4, 0); g.lineTo(-140, -4); g.lineTo(-140, 4); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(-60, -2, -140, 0); g.quadraticCurveTo(-60, 2, 0, 6); g.closePath(); g.fill();
        g.globalAlpha = 0.6 + 0.4 * cm.glow;
        g.drawImage(spr, -18 - 8 * cm.glow, -18 - 8 * cm.glow, 36 + 16 * cm.glow, 36 + 16 * cm.glow);
        g.globalAlpha = 1;
        g.restore();
      }
    }
    g.globalCompositeOperation = 'source-over';
    // HUD: progress line, combo, banners
    var fr = Math.min(1, run.t / p.dur);
    g.fillStyle = 'rgba(207,227,255,0.18)'; g.fillRect(0, 0, w, 2);
    g.fillStyle = INK; g.fillRect(0, 0, w * (1 - fr), 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (run.combo >= 3) {
      // the combo rides just above the finger (toasts can cover the top of the cave); top-centre while no finger is down
      var fa = cv.anchor('finger'), fx = w * 0.5, fy = 51;
      if (fa && (fa.x !== w * 0.5 || fa.y !== h * 0.5)) { fx = Math.max(30, Math.min(w - 30, fa.x)); fy = Math.max(24, fa.y - 64); }
      g.font = '600 26px "Grenze Gotisch", Georgia, serif';
      g.fillStyle = 'rgba(10,14,30,0.55)'; g.fillText('×' + run.combo, fx + 1, fy + 1);
      g.fillStyle = INK; g.fillText('×' + run.combo, fx, fy);
    }
    // the first comets: how to ride one, next to it
    if (run.rideHint) {
      for (k = 0; k < NCOMET; k++) {
        var ch2 = comets[k];
        if (!ch2.on || ch2.ridden || ch2.t > 1.45) continue;
        // a little ahead of the head and below its path (where the finger should go), on a dark pill, clear of the
        // top-left HUD band
        var hx = Math.max(96, Math.min(w - 96, ch2.x + ch2.vx * 0.3)), hy = Math.max(104, Math.min(h * 0.62, ch2.y + ch2.vy * 0.3 + 44));
        g.globalAlpha = Math.min(1, ch2.t * 4, (1.45 - ch2.t) * 4);
        g.fillStyle = 'rgba(12,16,34,0.78)';
        g.beginPath();
        if (typeof g.roundRect === 'function') g.roundRect(hx - 88, hy - 14, 176, 28, 14); else g.rect(hx - 88, hy - 14, 176, 28);
        g.fill();
        g.font = '700 16px "Alegreya Sans", system-ui, sans-serif';
        g.fillStyle = INK; g.fillText('Swipe along the comet', hx, hy + 1, 168);
        g.globalAlpha = 1;
      }
    }
    if (p.grand && run.t < 1.5) {
      g.globalAlpha = Math.min(1, (1.5 - run.t) * 2);
      g.font = '600 34px "Grenze Gotisch", Georgia, serif';
      g.fillStyle = 'rgba(10,14,30,0.6)'; g.fillText('Grand Starfall', w * 0.5 + 1, h * 0.34 + 1);
      g.fillStyle = INK; g.fillText('Grand Starfall', w * 0.5, h * 0.34);
      g.globalAlpha = 1;
    } else if (run.first && run.t < 3.5) {
      g.globalAlpha = Math.min(1, (3.5 - run.t) * 1.5);
      g.font = '600 18px "Alegreya Sans", system-ui, sans-serif';
      g.fillStyle = 'rgba(10,14,30,0.6)'; g.fillText('Swipe through the falling stars', w * 0.5 + 1, h * 0.36 + 1);
      g.fillStyle = INK; g.fillText('Swipe through the falling stars', w * 0.5, h * 0.36);
      g.globalAlpha = 1;
    }
    // end: once the last stars have landed (dur + 2.5 s; at most dur + 6 s with slow-falling stars)
    if (run.t >= p.dur + 2.5 && (!anyOn || run.t >= p.dur + 6)) { run.ending = true; finishFall(); }
  }

  // ================================================================ the dragon grows (size + decorations by stage)
  var P = null;
  function makePaths() {
    if (typeof Path2D !== 'function') return null;
    var o = {};
    o.horn1 = new Path2D('M -9 -6 Q -19 -15 -30 -32 Q -15 -20 -2 -10 Z');
    o.horn2 = new Path2D('M -2 -10 Q -7 -21 -11 -34 Q -1 -21 4 -11 Z');
    o.frill = new Path2D('M -8 -4 Q -22 -14 -29 -6 Q -22 -2 -28 4 Q -20 6 -25 14 Q -14 12 -6 6 Z');
    o.frillRib = new Path2D('M -8 -2 L -27 -5 M -8 2 L -26 4 M -7 5 L -23 13');
    o.spines = new Path2D('M -1 -10 L 5 -14 L 0 -16 Z M -2 -20 L 4 -25 L -2 -27 Z M -3 -30 L 2 -36 L -4 -37 Z M -4 -40 L -1 -47 L -7 -42 Z');
    o.star = new Path2D();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.9 : 4.6;
      if (i === 0) o.star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else o.star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    o.star.closePath();
    o.scales = new Path2D('M -12 -12 Q -8 -9 -4 -12 M -3 -10 Q 1 -7 5 -10 M 6 -9 Q 10 -6 14 -9 M -6 -17 Q -2 -14 2 -17 M 3 -16 Q 7 -13 11 -16');
    return o;
  }
  var bellyGrad = null, bellyCtx = null;
  var decorStage = 0, decorSet = null;
  function decor(g, part, clock, rm) {
    var st = decorStage;
    if (st < 2) return;
    if (!P) { P = makePaths(); if (!P) return; }
    if (part === 'headBack') {
      g.fillStyle = '#e4d3ae'; g.fill(P.horn1); g.fill(P.horn2);
      if (st >= 6) {
        g.fillStyle = '#e9bd62'; g.fill(P.frill);
        g.strokeStyle = '#a8742a'; g.lineWidth = 1.1; g.lineCap = 'round'; g.stroke(P.frillRib);
      }
    } else if (part === 'wing' && st >= 3) {
      g.fillStyle = '#f0c66a'; g.fill(P.spines);
    } else if (part === 'belly' && st >= 5) {
      if (!bellyGrad || bellyCtx !== g) {
        bellyCtx = g;
        bellyGrad = g.createRadialGradient(4, -14, 1, 4, -14, 26);
        bellyGrad.addColorStop(0, 'rgba(255,236,170,0.55)');
        bellyGrad.addColorStop(0.55, 'rgba(207,227,255,0.18)');
        bellyGrad.addColorStop(1, 'rgba(207,227,255,0)');
      }
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = rm ? 0.7 : 0.55 + 0.25 * Math.sin(clock * 1.4);
      g.fillStyle = bellyGrad; g.fillRect(-24, -40, 56, 52);
      g.globalAlpha = 0.8;
      g.strokeStyle = 'rgba(255,240,200,0.7)'; g.lineWidth = 1; g.stroke(P.scales);
    } else if (part === 'head' && st >= 7) {
      g.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 3; i++) {
        var x = -9 + i * 9, y = -22 + (i === 1 ? -5 : 0);
        var tw = rm ? 1 : 0.75 + 0.25 * Math.sin(clock * 2.2 + i * 2);
        if (spr) { g.globalAlpha = 0.55 * tw; g.drawImage(spr, x - 9, y - 9, 18, 18); }
        g.globalAlpha = 1;
        g.save(); g.translate(x, y); g.scale(i === 1 ? 1.15 : 0.85, i === 1 ? 1.15 : 0.85);
        g.fillStyle = '#fff3c4'; g.fill(P.star);
        g.restore();
      }
    }
  }
  function applyGrowth(s) {
    var cv = cave();
    if (!cv || !cv.setDragonScale) return;
    var st = s && X.on(s) ? X.stage(s) : 0;
    cv.setDragonScale(X.STAGES[st].scale);
    decorStage = st;
    var want = st >= 2 ? decor : null;
    if (cv.setDragonDecor && want !== decorSet) { decorSet = want; cv.setDragonDecor(want); }
  }

  // ================================================================ launcher (DOM button in the cave band)
  var L = null;
  var RING_C = 2 * Math.PI * 24;
  function buildLauncher() {
    var band = document.getElementById('caveband');
    if (!band || document.getElementById('skybtn')) return;
    var b = document.createElement('button');
    b.id = 'skybtn'; b.type = 'button'; b.className = 'sky-launch'; b.hidden = true;
    b.setAttribute('aria-label', 'Starfall');
    b.innerHTML = '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="ring-bg" cx="26" cy="26" r="24" fill="none" stroke-width="2"/>' +
      '<circle class="ring" cx="26" cy="26" r="24" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/></svg>';
    var lab = el('span', 'sl', 'Stars'), sub = el('span', 'ss', '');
    lab.appendChild(sub);
    b.appendChild(lab);
    // one deliberate press: a swipe that starts on the button and slides off (> 8 px) does not start a Starfall
    var dx0 = 0, dy0 = 0, moved = false;
    b.addEventListener('pointerdown', function (e) { dx0 = e.clientX; dy0 = e.clientY; moved = false; });
    b.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - dx0) > 8 || Math.abs(e.clientY - dy0) > 8) moved = true; });
    b.addEventListener('click', function () { if (moved) { moved = false; return; } startFall(); });
    band.appendChild(b);
    L = { b: b, ring: b.querySelector('.ring'), lab: lab.firstChild, sub: sub, off: -1, aria: '' };
  }
  function aria(o, v) { if (o.aria !== v) { o.aria = v; o.b.setAttribute('aria-label', v); } }
  function patchLauncher() {
    if (!L) return;
    var s = S();
    var vis = !!(s && X.on(s));
    setHidden(L.b, !vis);
    if (!vis) return;
    var frac, cap = X.cap(s);
    if (run) {
      setText(L.lab, Math.max(0, Math.ceil(run.p.dur - run.t)) + 's');
      setText(L.sub, '×' + run.combo);
      setCls(L.b, 'run', true); setCls(L.b, 'full', false); setDis(L.b, false);
      frac = 1 - Math.min(1, run.t / run.p.dur);
      aria(L, 'Starfall running');
    } else {
      var c = X.charges(s), ex = X.chargesExact(s);
      setCls(L.b, 'run', false);
      setText(L.lab, 'Stars');
      setText(L.sub, c >= 1 ? c + '/' + cap : 'in ' + waitStr(X.nextIn(s)));
      setDis(L.b, c < 1);
      setCls(L.b, 'full', c >= cap && !rmOn());
      frac = c >= cap ? 1 : ex - Math.floor(ex + 1e-9);
      aria(L, 'Starfall: ' + c + ' of ' + cap + ' ready');
    }
    var off = (RING_C * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1);
    if (L.off !== off) { L.off = off; L.ring.setAttribute('stroke-dashoffset', off); }
  }

  // ================================================================ Hoard tab: Night Sky
  var DRAGON_SVG = '<path fill="currentColor" d="M9 41c-3-1-5 1-7 0 2 3 6 3 9 2h22c4 0 8-2 9-5-3 2-6 2-9 1 1-2 1-5-1-8 2-3 3-7 2-10l3-2c2 1 4 1 6-1l-3-3c0-3-3-5-6-4l-3-4-1 4c-2 1-3 3-3 5l-4 6c-2-3-6-6-11-7 1 3 0 6-3 7 2 1 3 3 2 5-4 1-6 5-5 9z"/>' +
    '<path fill="none" stroke="rgba(22,19,31,0.55)" stroke-width="1.2" stroke-linecap="round" d="M15 33c3 0 5-2 7-4M30 18l3-1"/>';
  var CROWN_SVG = '<g fill="#fff3c4"><path d="M34 3l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z"/><path d="M28 6l.7 1.5 1.6.2-1.2 1 .3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1 1.6-.2z"/><path d="M40 6l.7 1.5 1.6.2-1.2 1 .3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1 1.6-.2z"/></g>';
  ui.addSection('hoard', {
    id: 'sky', order: -10,
    visible: function (s) { return X.on(s); },
    key: function (s) { return X.stage(s) + '|' + ((s.sky && s.sky.lant) || 0); },
    badge: function (s) { return X.on(s) && !run && X.charges(s) >= X.cap(s) ? true : 0; },
    build: function (host, s0) {
      var st0 = X.stage(s0), max = st0 >= X.STAGES.length - 1;
      host.appendChild(ui.secHead('Night Sky', X.STAGES[st0].name));
      var c = el('div', 'card sky-card');
      var r1 = el('div', 'row');
      var pic = el('div', 'sky-pic');
      var sc = (0.78 + 0.22 * st0 / 7).toFixed(3);
      pic.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="translate(24 46) scale(' + sc + ') translate(-24 -46)">' + DRAGON_SVG + (max ? CROWN_SVG : '') + '</g></svg>';
      var g1 = el('div', 'grow');
      var xpl = el('div', 'sky-xp');
      var xpv = el('b'), xpr = el('span'), xps = el('small', null, ' Stardust');
      add(xpl, xpv, xpr, xps);
      var b = ui.bar('sky');
      add(g1, xpl, b);
      add(r1, pic, g1);
      var next = el('div', 'sky-next');
      var kvReady = el('span'), kvBest = el('span'), kvPct = el('span');
      var two = el('div', 'sky-two');
      add(two, ui.kv('Best combo', kvBest), ui.kv('Best catch', kvPct));
      var go = ui.button('wide can sky-go', 'Start Starfall', function () { startFall(); });
      add(c, r1, next, ui.kv('Starfalls ready', kvReady), two, go);
      host.appendChild(c);
      if (!max) {
        var nx = X.STAGES[st0 + 1];
        add(next, document.createTextNode('Next: '), el('b', null, nx.name), document.createTextNode(' · ' + nx.perk));
      }
      var pips = max ? el('span', 'sky-pips') : null, pipN = max ? el('span') : null;
      if (max) add(next, document.createTextNode('Star Scales: '), pips, pipN);
      return function (s) {
        var k = s.sky || {}, pr = X.progress(s), cap = X.cap(s), ch = X.charges(s);
        setText(xpv, grp(pr.xp));
        setText(xpr, ' / ' + grp(pr.hi));
        ui.setW(b.fill, pr.frac);
        setText(kvReady, ch + ' of ' + cap + (ch >= cap ? ' · full' : ' · next in ' + waitStr(X.nextIn(s))));
        setText(kvBest, (k.best > 0 ? '×' + k.best : '–'));
        setText(kvPct, (k.bestPct > 0 ? Math.round(k.bestPct) + '%' : '–'));
        setText(go, run ? 'Starfall in progress' : (ch >= 1 ? 'Start Starfall' : 'Next Starfall in ' + waitStr(X.nextIn(s))));
        setDis(go, !!run || ch < 1);
        setCls(go, 'can', !run && ch >= 1);
        if (max) {
          var n = X.scales(s), on = n % 10, str = '';
          for (var i = 0; i < 10; i++) str += i < on ? '●' : '○';
          setText(pips, str);
          setText(pipN, ' ' + n);
        }
      };
    }
  });

  // ================================================================ Mines tab: Sky Lanterns (an Ore sink, Starfall only)
  function lantLine(lv) {
    return 'Lv ' + lv + '/5 · Stardust +' + Math.round(8 * lv) + '% · stars fall ' + (3 * lv) + '% slower';
  }
  function minesOpen(s) { return !!(HOARD.mines && HOARD.mines.isOpen(s)); }
  ui.addSection('mines', {
    id: 'lanterns', order: 80,
    visible: function (s) { return X.on(s) && minesOpen(s); },
    key: function (s) { return 'L' + ((s.sky && s.sky.lant) || 0); },
    build: function (host, s0) {
      host.classList.add('mn');
      var lv0 = (s0.sky && s0.sky.lant) || 0;
      host.appendChild(ui.secHead('Sky Lanterns'));
      host.appendChild(el('p', 'hint', lv0 > 0 ? lantLine(lv0) + '.' : 'Paper lanterns over the lair, lit with Ore. Each one: Starfalls give +8% Stardust and stars fall 3% slower.'));
      if (lv0 >= 5) { host.appendChild(el('div', 'card sky-lant done', 'All lanterns lit')); return null; }
      var c = el('div', 'card sky-lant');
      var r = el('div', 'row');
      var g = el('div', 'grow');
      var cost = el('div', 'cost');
      var cv = el('span', 'c-ore');
      cost.appendChild(cv);
      add(g, el('div', 'name', 'Lantern ' + (lv0 + 1)), el('div', 'sub', 'Stardust +8% · stars fall 3% slower'), cost);
      var btn = ui.buyButton();
      setText(btn.l, 'Light'); setText(btn.s, 'Lv ' + (lv0 + 1));
      // one level per deliberate press (five expensive one-off levels: holding must not empty the Ore)
      btn.addEventListener('click', function () { var s = S(); if (s && X.buyLantern(s)) { snd('buy', { kind: 'lantern' }); ui.markDirty(); } });
      add(r, g, btn);
      c.appendChild(r);
      host.appendChild(c);
      return function (s) {
        var cst = X.lanternCost(s), have = HOARD.mines ? HOARD.mines.ore(s) : 0, okk = have >= cst && cst > 0;
        setText(cv, fmt(cst) + ' Ore');
        setCls(cv, 'short', !okk);
        setCls(btn, 'can', okk);
      };
    }
  });

  // ================================================================ toasts + log
  E.on('sky', function (d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'open' || d.type === 'stage' || d.type === 'light' || d.type === 'lantern') log('sky', d);
    if (d.type === 'stage' && !finishing) {
      var st = X.STAGES[d.stage];
      if (st) { ui.toast('Your dragon grew: ' + st.name + '.', (st.how || st.perk) + '.', 'gold'); snd('questDone'); ui.buzz(30); }
    } else if (d.type === 'light') {
      ui.toast('First Light: Rank ' + d.rank + '.', '+' + grp(d.dust) + ' Stardust.', 'sky');
    } else if (d.type === 'lantern') {
      ui.toast('Sky Lantern lit.', lantLine(d.lv) + '.', 'mines');
    }
  });
  E.on('myth', function () { if (run) abortFall('ascend'); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (run) abortFall('hidden'); hiddenAt = Date.now(); }
    else if (hiddenAt && Date.now() - hiddenAt >= 5 * 60e3) { hiddenAt = 0; logOpen(); }
    else hiddenAt = 0;
  });
  var hiddenAt = 0;
  function awayToasts(aw) {
    if (aw.light >= 7) ui.toast('First Light: Rank ' + aw.light + '.', '+' + grp(aw.lightDust) + ' Stardust while you were away.', 'sky');
    if (aw.stage >= 1 && X.STAGES[aw.stage]) ui.toast('Your dragon grew: ' + X.STAGES[aw.stage].name + '.', X.STAGES[aw.stage].perk + '.', 'gold');
  }
  // the welcome-back sheet: Starfalls waiting, Ember's catches, growth and First Light while you were away
  if (typeof ui.addWelcomeLine === 'function') ui.addWelcomeLine(function (s) {
    if (!s || !X.on(s)) return null;
    var parts = [], c = X.charges(s), cap = X.cap(s);
    var aw = X.takeAway(s), em = X.takeEmber(s);
    if (aw && aw.light >= 7) parts.push('First Light at Rank ' + aw.light + ' (+' + grp(aw.lightDust) + ' Stardust).');
    if (em >= 1) { var n = Math.round(em / 10); parts.push('Ember caught ' + n + ' falling ' + ui.plural(n, 'star', 'stars') + ' (+' + grp(em) + ' Stardust).'); log('sky', { type: 'ember', n: n, dust: em }); }
    if (aw && aw.stage >= 1 && X.STAGES[aw.stage]) parts.push('Your dragon grew: ' + X.STAGES[aw.stage].name + '.');
    if (c >= 1) parts.push((c >= cap ? 'All ' + c + ' Starfalls are ready' : c + ' ' + ui.plural(c, 'Starfall is', 'Starfalls are') + ' ready') + ': press Stars in the cave.');
    return parts.length ? { cls: 'sky', text: 'Night sky: ' + parts.join(' ') } : null;
  });
  function logOpen() { var s = S(); if (s && X.on(s)) log('skyopen', { ch: X.charges(s), cap: X.cap(s) }); }
  function poll() {
    var s = S();
    if (!s) return;
    // watchdog: a Starfall whose clock stopped (its layer gone, no frames while visible) ends without spending a charge
    if (run && !document.hidden && Date.now() - run.seen > 2500) abortFall('stall');
    applyGrowth(s);
    patchLauncher();
    if (!X.on(s)) return;
    var aw = X.takeAway(s);   // the welcome-back sheet did not pick it up (a short absence): toast it
    if (aw) awayToasts(aw);
    if (!(s.sky && s.sky.n > 0) && !E.flag(s, 'skySeen')) {
      E.setFlag(s, 'skySeen', 1);
      var c = X.charges(s);
      ui.toast('The night sky opened over the lair.', c + ' ' + ui.plural(c, 'Starfall', 'Starfalls') + ' ready.', 'sky');
      ui.markDirty();
    }
    var d = X.takeEmber(s);
    if (d >= 1) {
      var n = Math.round(d / 10);
      ui.toast('Ember caught ' + n + ' falling ' + ui.plural(n, 'star', 'stars') + ':', '+' + grp(d) + ' Stardust.', 'ember');
      log('sky', { type: 'ember', n: n, dust: d });
    }
  }
  if (HOARD.whenReady) HOARD.whenReady(function () {
    buildLauncher();
    poll();
    logOpen();
    setInterval(function () { if (!document.hidden) poll(); }, 200);
  });

  // test hooks (smoke): read-only views of the running Starfall
  HOARD.skyUI = {
    running: function () { return !!run; },
    info: function () { return run ? { t: run.t, total: run.total, caught: run.caught, combo: run.combo, dur: run.p.dur } : null; },
    stars: function () { var o = []; for (var i = 0; i < NSTAR; i++) if (stars[i].on) o.push([stars[i].x, stars[i].y]); return o; },
    comets: function () { var o = []; for (var i = 0; i < NCOMET; i++) if (comets[i].on) o.push([comets[i].x, comets[i].y, comets[i].vx, comets[i].vy, comets[i].ridden]); return o; },
    start: startFall
  };
})();
