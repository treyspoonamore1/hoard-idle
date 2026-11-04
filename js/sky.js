/* Hoard — js/sky.js — Starfall + Growth (SPEC-V2 "Starfall"). Engine-side module, Node-safe: no DOM, no window,
 * no Math.random. Owns state.sky (addStateDefaults), the 'sky' tick hook (unlock, Starfall charges, Ember watching
 * the sky, First Light) and the 'sky' sleep hook (First Light resets on Ascend).
 * It gives NO gold, Legend or card power: no mod source, no cards, never E.earn, and caught stars pay no gold (the
 * normal coin spill keeps running during a Starfall, so gold is neutral by design). Stardust (sky.xp) only grows the
 * dragon and its Starfalls.
 * A running Starfall is never saved: it lives in s._skyRun (keys starting with '_' are not serialized).
 * Tests: set HOARD.sky._now = epochMs (or a function returning it) to fake the clock.
 * API: HOARD.sky (see the bottom of this file). */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var E = HOARD.engine;
  if (!E || typeof E.addTickHook !== 'function') return;
  var U = E.util || {};
  var MAXN = U.MAXN || 1e300;
  function fin(x, d) { x = +x; return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function cl(x) { x = fin(x, 0); return x > MAXN ? MAXN : (x < -MAXN ? -MAXN : x); }
  function pos(x) { x = cl(x); return x > 0 ? x : 0; }
  function int(x) { return Math.floor(pos(x)); }
  function clamp(x, a, b) { x = fin(x, a); return x < a ? a : (x > b ? b : x); }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  // ---------------------------------------------------------------- growth stages (Stardust = sky.xp, never spent)
  // perk: what reaching the stage changes (shown as "Next: Young · Starfalls last 30 s")
  var STAGES = [
    { id: 'hatchling', name: 'Hatchling', xp: 0, scale: 1.00, perk: 'Starfalls of 25 s' },
    { id: 'fledgling', name: 'Fledgling', xp: 100, scale: 1.04, perk: 'A comet crosses each Starfall',
      how: 'A comet crosses each Starfall: swipe along it, the same way it flies, to ride it' },
    { id: 'juvenile', name: 'Juvenile', xp: 600, scale: 1.08, perk: 'Hold 5 Starfalls' },
    { id: 'young', name: 'Young', xp: 2000, scale: 1.12, perk: 'Starfalls last 30 s' },
    { id: 'adult', name: 'Adult', xp: 6000, scale: 1.16, perk: 'Two comets, more twin stars' },
    { id: 'great', name: 'Great', xp: 15000, scale: 1.19, perk: 'A Starfall every 25 min' },
    { id: 'elder', name: 'Elder', xp: 35000, scale: 1.22, perk: 'Hold 6 Starfalls' },
    { id: 'ancient', name: 'Ancient', xp: 75000, scale: 1.25, perk: 'Every 5th Starfall is Grand' }
  ];
  var SCALE_XP = 25000;                                   // a Star Scale per 25,000 Stardust past Ancient
  var LANT_COST = [2e6, 1e7, 5e7, 2.5e8, 1.25e9];         // Sky Lanterns, in embers
  var C = {
    unlockRank: 4,
    giftCharges: 2,
    dustPerEmberStar: 10,  // Ember catches a falling star for you while the Starfalls sit at the cap
    emberMax: 4,           // at most 4 per at-cap stretch
    rankDust: 0.10,        // +10% Stardust per rank past 6 (ranks 7..12)
    lantDust: 0.08,        // +8% Stardust per Lantern
    lantSlow: 0.03,        // stars fall 3% slower per Lantern
    grandDust: 1.5,
    rideDust: 15,
    lightDust: 40          // First Light: 40 x (rank - 6)
  };

  function stageOfXp(xp) {
    xp = pos(xp);
    for (var i = STAGES.length - 1; i > 0; i--) if (xp >= STAGES[i].xp) return i;
    return 0;
  }
  function paramsAt(st, n, lant) {
    var grand = st >= 7 && ((int(n) + 1) % 5 === 0);
    var p = {
      dur: st >= 3 ? 30 : 25,
      rate: 1.4,
      twinP: st >= 4 ? 0.25 : 0.15,
      comets: st >= 4 ? 2 : (st >= 1 ? 1 : 0),
      cap: st >= 6 ? 6 : (st >= 2 ? 5 : 4),
      period: st >= 5 ? 25 : 30,
      grand: grand,
      fallMin: 90,
      fallMax: 150,
      slow: 1 - C.lantSlow * clamp(Math.floor(fin(lant, 0)), 0, 5)
    };
    if (grand) { p.dur = 45; p.rate = 2.2; }
    return p;
  }
  // the most stars a Starfall can count (spawn jitter and twin luck need headroom over the expected count)
  function maxStars(p) { return Math.ceil(p.dur * p.rate * (1 + p.twinP) * 1.2) + 4; }

  // ---------------------------------------------------------------- state subtree
  function defaults() {
    return { on: false, xp: 0, ch: 0, at: 0, n: 0, caught: 0, stars: 0, best: 0, bestPct: 0,
      capAt: 0, eCaught: 0, lant: 0, lit: 0, gift: false };
  }
  function now() {
    var X = HOARD.sky, f = X && X._now;
    var t = typeof f === 'function' ? f() : f;
    t = +t;
    return isFinite(t) && t > 0 ? t : Date.now();
  }
  function time(x, t) { x = pos(x); return x > t ? t : x; }   // epoch ms: finite, >= 0, never in the future
  function sanitize(saved, def) {
    var o = def || defaults();
    if (!isObj(saved)) return o;
    for (var k in saved) {   // forward compatible: unknown keys are kept (the engine drops what is not JSON-safe)
      if (Object.prototype.hasOwnProperty.call(saved, k) && !Object.prototype.hasOwnProperty.call(o, k) && k.charAt(0) !== '_') o[k] = saved[k];
    }
    var t = now();
    o.on = saved.on === true;
    o.gift = saved.gift === true;
    o.xp = pos(saved.xp);
    var cap = paramsAt(stageOfXp(o.xp), 0, 0).cap;
    o.ch = clamp(pos(saved.ch), 0, cap);
    o.at = time(saved.at, t);
    o.capAt = time(saved.capAt, t);
    o.n = int(saved.n);
    o.caught = int(saved.caught);
    o.stars = int(saved.stars);
    o.best = int(saved.best);
    o.bestPct = Math.min(100, pos(saved.bestPct));
    o.eCaught = Math.min(C.emberMax, int(saved.eCaught));
    o.lant = Math.min(5, int(saved.lant));
    var lit = Math.min(12, int(saved.lit));
    o.lit = lit >= 7 ? lit : 0;
    return o;
  }
  E.addStateDefaults('sky', defaults, sanitize);

  function peek(s) { return (s && isObj(s.sky)) ? s.sky : null; }
  function sub(s) {
    if (!isObj(s)) return null;
    if (!isObj(s.sky)) s.sky = defaults();
    return s.sky;
  }
  function emit(name, d, s) { try { E.emit(name, d, s); } catch (e) { /* ignore */ } }
  // what happened while the app was closed (events are quiet offline): the UI reads it once (takeAway) for the
  // welcome-back sheet / a toast. Transient ('_' keys are never saved).
  function away(s) { return isObj(s._skyAway) ? s._skyAway : (s._skyAway = { stage: 0, light: 0, lightDust: 0 }); }
  function quietNow() { try { return typeof E.isQuiet === 'function' && E.isQuiet(); } catch (e) { return false; } }
  function emberAwake(s) { var X = HOARD.ember; return !!(X && typeof X.isAwake === 'function' && X.isAwake(s)); }

  // ---------------------------------------------------------------- pure readers (null-safe)
  function on(s) { var k = peek(s); return !!(k && k.on === true); }
  function stage(s) { var k = peek(s); return k ? stageOfXp(k.xp) : 0; }
  function stageName(s, i) { var st = i === undefined ? stage(s) : clamp(Math.floor(fin(i, 0)), 0, STAGES.length - 1); return STAGES[st].name; }
  function params(s) { var k = peek(s); return paramsAt(stage(s), k ? k.n : 0, k ? k.lant : 0); }
  function cap(s) { return params(s).cap; }
  function periodMs(s) { return params(s).period * 60000; }
  // charges right now (the stored ch moves once a second; readers project it to the clock)
  function chNow(s) {
    var k = peek(s);
    if (!k || !k.on) return 0;
    var c = cap(s), ch = clamp(pos(k.ch), 0, c), t = now(), at = pos(k.at);
    if (at > 0 && t > at) ch = Math.min(c, ch + (t - at) / periodMs(s));
    return ch;
  }
  function charges(s) { return Math.floor(chNow(s) + 1e-9); }
  function nextIn(s) {
    var c = cap(s), ch = chNow(s);
    if (!on(s) || ch >= c) return 0;
    var fr = ch - Math.floor(ch + 1e-9);
    return Math.max(0, (1 - fr) * periodMs(s) / 1000);
  }
  // progress toward the next stage (past Ancient: toward the next Star Scale)
  function progress(s) {
    var k = peek(s), xp = k ? pos(k.xp) : 0, st = stageOfXp(xp);
    var lo, hi;
    if (st < STAGES.length - 1) { lo = STAGES[st].xp; hi = STAGES[st + 1].xp; }
    else { var base = STAGES[st].xp; lo = base + Math.floor((xp - base) / SCALE_XP) * SCALE_XP; hi = lo + SCALE_XP; }
    return { xp: xp, stage: st, lo: lo, hi: hi, frac: hi > lo ? clamp((xp - lo) / (hi - lo), 0, 1) : 1, max: st >= STAGES.length - 1 };
  }
  function xpToNext(s) { var p = progress(s); return Math.max(0, p.hi - p.xp); }
  function scales(s) { var k = peek(s), xp = k ? pos(k.xp) : 0, a = STAGES[STAGES.length - 1].xp; return xp >= a ? Math.floor((xp - a) / SCALE_XP) : 0; }
  function lanternCost(s) { var k = peek(s), lv = k ? Math.min(5, int(k.lant)) : 0; return lv >= 5 ? 0 : LANT_COST[lv]; }
  function rankMult(r) { return 1 + C.rankDust * clamp(Math.floor(fin(r, 1)) - 6, 0, 6); }
  function lantMult(lv) { return 1 + C.lantDust * clamp(Math.floor(fin(lv, 0)), 0, 5); }

  // ---------------------------------------------------------------- mutators
  // add Stardust; emits 'stage' when the dragon grows (live only: events are quiet offline)
  function addXp(s, d) {
    var k = sub(s);
    if (!k || !(d > 0)) return false;
    var st0 = stageOfXp(k.xp);
    k.xp = pos(pos(k.xp) + d);
    var st1 = stageOfXp(k.xp);
    if (st1 > st0) {
      if (quietNow()) away(s).stage = st1;
      emit('sky', { type: 'stage', stage: st1, name: STAGES[st1].name }, s);
      return true;
    }
    return false;
  }
  function unlock(s) {
    var k = sub(s);
    if (!k) return;
    if (!k.on && (pos(s.sleeps) >= 1 || pos(s.myths) >= 1 || fin(s.rank, 1) >= C.unlockRank)) {
      k.on = true;
      if (!k.gift) { k.ch = Math.max(pos(k.ch), C.giftCharges); k.gift = true; }
      k.at = now();
      emit('sky', { type: 'open', ch: Math.floor(k.ch) }, s);
    }
  }
  // charges and Ember's catches. capAt is the moment the charges reached the cap (worked out from the accrual, so a
  // long time away counts the same as the same time live)
  function accrue(s) {
    var k = peek(s);
    if (!k || !k.on) return;
    var t = now(), at = pos(k.at);
    if (!(at > 0) || at > t) { k.at = t; return; }
    var c = cap(s), per = periodMs(s), ch0 = clamp(pos(k.ch), 0, c);
    var ch = Math.min(c, ch0 + (t - at) / per);
    k.ch = ch;
    k.at = t;
    if (ch >= c) { if (!(pos(k.capAt) > 0)) k.capAt = ch0 >= c ? t : Math.min(t, at + (c - ch0) * per); }
    else { k.capAt = 0; k.eCaught = 0; }
    if (pos(k.capAt) > 0 && emberAwake(s)) {
      var n = Math.min(C.emberMax, Math.floor((t - k.capAt) / per)) - int(k.eCaught);
      if (n > 0) {
        var d = C.dustPerEmberStar * n;
        k.eCaught = int(k.eCaught) + n;
        addXp(s, d);
        s._skyEmber = pos(s._skyEmber) + d;
        emit('sky', { type: 'ember', n: n, dust: d }, s);
      }
    }
  }
  function firstLight(s) {
    var k = peek(s);
    if (!k || !k.on) return;
    var r = Math.floor(fin(s.rank, 1)), lit = int(k.lit);
    if (r < 7 || r <= lit) return;
    for (var x = Math.max(7, lit + 1); x <= Math.min(12, r); x++) {
      var d = C.lightDust * (x - 6);
      k.lit = x;
      if (quietNow()) { var aw = away(s); aw.light = x; aw.lightDust += d; }
      addXp(s, d);
      emit('sky', { type: 'light', rank: x, dust: d }, s);
    }
  }
  var acc = 0;
  E.addTickHook('sky', function (s, dt, isOffline) {
    if (!isObj(s)) return;
    unlock(s);
    if (!on(s)) return;
    firstLight(s);
    if (isOffline) { accrue(s); return; }
    acc += pos(dt);
    if (acc < 1 && pos(s.sky.at) > 0) return;
    acc = 0;
    accrue(s);
  });
  E.addSleepHook('sky', function (s, prev, reason) {
    if (reason === 'ascend' && isObj(s.sky)) s.sky.lit = 0;   // First Light comes once per Myth
  });

  // start a Starfall: needs a whole charge; does NOT spend it (finish does), so leaving early costs nothing
  function start(s) {
    var k = peek(s);
    if (!k || !k.on || (s && s._skyRun)) return null;
    accrue(s);
    if (Math.floor(pos(k.ch) + 1e-9) < 1) return null;
    var p = params(s);
    s._skyRun = { rank: Math.floor(fin(s.rank, 1)), p: p, t0: now() };
    return p;
  }
  function abort(s) {
    if (!s || !s._skyRun) return false;
    delete s._skyRun;
    return true;
  }
  // r = { total, caught, best, base, twins, rides, cuts } as counted by the UI; clamped to what the Starfall allows
  function finish(s, r) {
    var k = peek(s), run = s && s._skyRun;
    if (!k || !isObj(run) || !isObj(run.p)) { if (s && s._skyRun) delete s._skyRun; return null; }
    var p = run.p;
    r = isObj(r) ? r : {};
    var total = Math.min(int(r.total), maxStars(p));
    var caught = Math.min(int(r.caught), total);
    var best = Math.min(int(r.best), caught);
    var twins = Math.min(int(r.twins), Math.floor(caught / 2));
    var rides = Math.min(int(r.rides), p.comets);
    var cuts = Math.min(int(r.cuts), p.comets - rides);
    var base = Math.min(int(r.base), 10 * caught);
    var raw = base + C.rideDust * rides + cuts;
    var mult = rankMult(Math.max(fin(run.rank, 1), fin(s.rank, 1))) * lantMult(k.lant) * (p.grand ? C.grandDust : 1);
    var dust = Math.round(raw * mult);
    if (!(dust >= 0)) dust = 0;
    var pct = total > 0 ? Math.round(100 * caught / total) : 0;
    var st0 = stageOfXp(k.xp);
    accrue(s);
    k.n = int(k.n) + 1;
    k.caught = int(k.caught) + caught;
    k.stars = int(k.stars) + total;
    k.best = Math.max(int(k.best), best);
    if (total >= 10) k.bestPct = Math.max(Math.min(100, pos(k.bestPct)), pct);
    k.ch = Math.max(0, pos(k.ch) - 1);
    k.capAt = 0;
    k.eCaught = 0;
    delete s._skyRun;
    emit('sky', { type: 'fall', dust: dust, caught: caught, total: total, best: best }, s);
    var up = addXp(s, dust);
    return { dust: dust, mult: mult, stageUp: up, stage: stageOfXp(k.xp), stage0: st0, pct: pct, grand: !!p.grand,
      total: total, caught: caught, best: best, rides: rides, cuts: cuts, twins: twins, rank: Math.max(fin(run.rank, 1), fin(s.rank, 1)) };
  }

  // Sky Lanterns: an ember sink with no gold power (Starfall only). Spends embers, never Ember's lifetime 'earned'.
  function buyLantern(s) {
    var k = peek(s);
    if (!k || !k.on || !emberAwake(s) || !isObj(s.ember)) return false;
    var lv = Math.min(5, int(k.lant));
    if (lv >= 5) return false;
    var cost = LANT_COST[lv], have = pos(s.ember.embers);
    if (!(have + 1e-9 >= cost)) return false;
    s.ember.embers = pos(have - cost);
    k.lant = lv + 1;
    E.dirty();
    emit('sky', { type: 'lantern', lv: k.lant }, s);
    return true;
  }

  HOARD.sky = {
    _now: (HOARD.sky && HOARD.sky._now) || null,   // tests: epoch ms or fn() -> epoch ms
    STAGES: STAGES,
    LANT_COST: LANT_COST,
    SCALE_XP: SCALE_XP,
    C: C,
    on: on,
    stage: stage,
    stageName: stageName,
    stageOfXp: stageOfXp,
    params: params,
    maxStars: maxStars,
    charges: charges,
    chargesExact: chNow,
    nextIn: nextIn,
    cap: cap,
    progress: progress,
    xpToNext: xpToNext,
    scales: scales,
    lanternCost: lanternCost,
    lantMult: lantMult,
    rankMult: rankMult,
    running: function (s) { return !!(s && s._skyRun); },
    start: start,
    abort: abort,
    finish: finish,
    accrue: accrue,
    buyLantern: buyLantern,
    takeEmber: function (s) { var d = s ? pos(s._skyEmber) : 0; if (s) delete s._skyEmber; return d; },
    // { stage (0 = none), light (highest First Light rank, 0 = none), lightDust } from the last offline catch-up, once
    takeAway: function (s) {
      var a = s && isObj(s._skyAway) ? s._skyAway : null;
      if (s) delete s._skyAway;
      return a ? { stage: int(a.stage), light: int(a.light), lightDust: pos(a.lightDust) } : null;
    }
  };
})();
