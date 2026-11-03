/* Hoard — js/ember.js — Ember, the second dragon (SPEC-V2 section 2). Engine-side module, Node-safe:
 * no DOM, no window. Owns state.ember (via addStateDefaults), the 'ember' mod source (Ember's warmth),
 * the 'ember' tick hook (kilns live + offline, embers fed by swiping) and the 'ember' sleep hook (Ascend).
 * API: HOARD.ember (see the bottom of this file). */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var E = HOARD.engine;
  if (!E || typeof E.addModSource !== 'function') return;
  var U = E.util || {};
  var MAXN = U.MAXN || 1e300;
  function fin(x, d) { x = +x; return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function cl(x) { x = fin(x, 0); return x > MAXN ? MAXN : (x < -MAXN ? -MAXN : x); }
  function pos(x) { x = cl(x); return x > 0 ? x : 0; }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  // ---------------------------------------------------------------- tuning (see tools/test-ember.cjs pacing)
  var C = {
    kilnGrowth: 1.18,       // kiln ember cost growth per owned
    wakeGift: 15,           // embers Ember wakes up with (first Coal Kiln right away)
    coinFeed: 0.02,         // embers per collected coin = coinFeed x kilnPower
    coinFeedMin: 1,         // kilnPower used for the coin feed is at least this (swiping helps from second one)
    warmthK: 0.15,          // warmth = 1 + warmthK x log10(1 + earned)^warmthExp
    warmthExp: 1.6,
    ascendKeep: 0.25,       // Ascend keeps 25% of embers, lifetime embers and kilns
    treasureSec: 60,        // Ember Treasures: seconds of ember production per treasure
    maxKilns: 1e6
  };
  // base ember/s is SPEC-V2's 1 / 8 / 70 / 650 scaled x0.1: at full speed the log warmth curve front-loads
  // (x3.6 at 10 min, then a plateau near x8); scaled it gives ~x1.6 at 10 min, ~x3.2 at 1 h, ~x6 at 3 h
  var KILNS = [
    { id: 'coal', name: 'Coal Kiln', rate: 0.1, cost: 10, text: 'Banked coals glow under the hoard.' },
    { id: 'bellows', name: 'Bellows', rate: 0.8, cost: 150, text: 'Kobolds pump the fire bright.' },
    { id: 'magma', name: 'Magma Vent', rate: 7, cost: 2500, text: 'A crack down to the molten deep.' },
    { id: 'sun', name: 'Sunfurnace', rate: 65, cost: 45000, text: 'A captured scrap of noon.' }
  ];
  // one-time Fire Breaths, bought with embers (shown cheapest first)
  var BREATHS = [
    { id: 'kindle', name: 'Kindle', cost: 200, text: 'Kilns burn ×2 hotter.' },
    { id: 'molten', name: 'Molten Coins', cost: 1000, text: 'Stroke gold ×2.' },
    { id: 'fanned', name: 'Fanned Flames', cost: 4000, text: 'Swiped coins feed Ember ×3.' },
    { id: 'searing', name: 'Searing Gust', cost: 15000, text: 'Wing Gust gold ×2.' },
    { id: 'etreas', name: 'Ember Treasures', cost: 50000, text: 'Each treasure also gives 60s of ember production.' },
    { id: 'smoulder', name: 'Smoulder', cost: 120000, text: 'Kilns make ×2 embers while you are away.' },
    { id: 'ffrenzy', name: 'Fire Frenzy', cost: 3e5, text: 'Gold Frenzy ×1.5 stronger.' },
    { id: 'wildfire', name: 'Wildfire', cost: 8e5, text: 'Kilns burn ×3 hotter.' },
    { id: 'heart', name: 'Heart of the Kiln', cost: 4e6, text: "Ember's warmth +25%." }
  ];
  var KIDX = {}, BIDX = {};
  KILNS.forEach(function (k, i) { KIDX[k.id] = i; });
  BREATHS.forEach(function (b, i) { BIDX[b.id] = i; });

  // ---------------------------------------------------------------- state subtree
  function defaults() {
    return { awake: false, wokeAt: 0, embers: 0, earned: 0, kilns: [0, 0, 0, 0], breaths: {}, fromCoins: 0, offline: 0 };
  }
  function sanitize(saved, def) {
    var o = def || defaults();
    if (!isObj(saved)) return o;
    // forward compatible: keep unknown JSON-safe keys
    for (var k in saved) {
      if (!Object.prototype.hasOwnProperty.call(saved, k) || Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = saved[k];
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) o[k] = v;
      else if (typeof v === 'object') { try { o[k] = JSON.parse(JSON.stringify(v)); } catch (e) { /* drop */ } }
    }
    o.awake = saved.awake === true;
    o.wokeAt = pos(saved.wokeAt);
    o.embers = pos(saved.embers);
    o.earned = Math.max(pos(saved.earned), 0);
    o.fromCoins = pos(saved.fromCoins);
    o.offline = pos(saved.offline);
    var ks = Array.isArray(saved.kilns) ? saved.kilns : [];
    o.kilns = [];
    for (var i = 0; i < KILNS.length; i++) o.kilns.push(Math.floor(Math.min(C.maxKilns, pos(ks[i]))));
    o.breaths = {};
    if (isObj(saved.breaths)) for (var j = 0; j < BREATHS.length; j++) if (saved.breaths[BREATHS[j].id] === true) o.breaths[BREATHS[j].id] = true;
    return o;
  }
  E.addStateDefaults('ember', defaults, sanitize);

  // live states can be hand-made (tests, hot reload): repair the subtree in place, cheaply
  function sub(s) {
    if (!s || typeof s !== 'object') return null;
    var em = s.ember;
    if (!isObj(em)) { em = s.ember = defaults(); return em; }
    if (!Array.isArray(em.kilns) || em.kilns.length !== KILNS.length) {
      var ks = Array.isArray(em.kilns) ? em.kilns : [];
      em.kilns = [];
      for (var i = 0; i < KILNS.length; i++) em.kilns.push(Math.floor(Math.min(C.maxKilns, pos(ks[i]))));
    }
    if (!isObj(em.breaths)) em.breaths = {};
    return em;
  }
  // read-only view for mod sources (never mutates)
  function peek(s) { return (s && isObj(s.ember)) ? s.ember : null; }

  // ---------------------------------------------------------------- pure rules
  function loreWants(s) { return !!(s && isObj(s.lore) && fin(s.lore.wake_ember, 0) >= 1); }
  function isAwake(s) { var em = peek(s); return !!(em && em.awake === true); }
  function has(em, id) { return !!(em && isObj(em.breaths) && em.breaths[id] === true); }
  function kilnCount(em, k) { return (em && Array.isArray(em.kilns)) ? Math.floor(pos(em.kilns[k])) : 0; }
  function milestoneMult(owned) { return (E.milestoneMult ? fin(E.milestoneMult('kiln', owned), 1) : 1) || 1; }

  // global kiln multiplier (breaths, relic)
  function kilnMult(s) {
    var em = peek(s), m = 1;
    if (has(em, 'kindle')) m *= 2;
    if (has(em, 'wildfire')) m *= 3;
    if (s && isObj(s.relics) && fin(s.relics.r_ember, 0) >= 1) m *= 3; // Ember's Brood: "Ember grows x3 faster"
    return m;
  }
  function kilnEach(s, k) {
    var kd = KILNS[k];
    if (!kd) return 0;
    var em = peek(s);
    return pos(kd.rate * milestoneMult(kilnCount(em, k)) * kilnMult(s));
  }
  function kilnTotal(s, k) { return pos(kilnEach(s, k) * kilnCount(peek(s), k)); }
  function rate(s) {
    if (!isAwake(s)) return 0;
    var r = 0;
    for (var k = 0; k < KILNS.length; k++) r += kilnTotal(s, k);
    return pos(r);
  }
  function coinYield(s) {
    if (!isAwake(s)) return 0;
    var em = peek(s);
    return pos(C.coinFeed * Math.max(C.coinFeedMin, rate(s)) * (has(em, 'fanned') ? 3 : 1));
  }
  function warmthFor(earned, heart) {
    var L = Math.log(1 + pos(earned)) / Math.LN10;
    var w = 1 + C.warmthK * (heart ? 1.25 : 1) * Math.pow(L, C.warmthExp);
    return isFinite(w) && w >= 1 ? Math.min(w, 1e12) : 1;
  }
  function warmth(s) {
    if (!isAwake(s)) return 1;
    var em = peek(s);
    return warmthFor(em.earned, has(em, 'heart'));
  }

  // ---------------------------------------------------------------- mod source: Ember's warmth + breaths
  // warmth multiplies building gold/s and coin worth (flat part here; the gps part follows gpsMult)
  E.addModSource('ember', function (s, M) {
    if (!isAwake(s)) return;
    var em = peek(s);
    var w = warmth(s);
    if (w > 1) { M.gpsMult *= w; M.coinFlat *= w; }
    if (has(em, 'molten')) M.strokeMult *= 2;
    if (has(em, 'searing')) M.gustMult *= 2;
    if (has(em, 'ffrenzy')) M.frenzyMult *= 1.5;
  });

  // ---------------------------------------------------------------- earning embers
  function addEmbers(s, n, kind) {
    var em = sub(s);
    n = pos(n);
    if (!em || n <= 0) return 0;
    em.embers = cl(pos(em.embers) + n);
    em.earned = cl(pos(em.earned) + n);
    if (kind === 'coin') em.fromCoins = cl(pos(em.fromCoins) + n);
    return n;
  }

  // swiping feeds Ember: the engine's 'coin' event carries the state the coins were collected in (gust coins
  // too), so embers are credited at once. coinGainAcc only feeds the UI's subtle cave float.
  var coinGainAcc = 0;
  E.on('coin', function (n, s) {
    n = pos(n);
    if (!(n > 0) || n >= 1e9 || !s || !isAwake(s)) return;
    coinGainAcc = cl(coinGainAcc + addEmbers(s, n * coinYield(s), 'coin'));
  });
  // Ember Treasures: a grabbed treasure also gives 60s of kiln production
  E.on('treasure', function (res, s) {
    if (!s || !isAwake(s) || !has(sub(s), 'etreas')) return;
    addEmbers(s, rate(s) * C.treasureSec, 'treasure');
  });
  // LORE emits 'lore' {id:'wake_ember'}; the tick hook wakes Ember on the next frame anyway

  function wake(s) {
    var em = sub(s);
    if (!em || em.awake) return false;
    em.awake = true;
    em.wokeAt = pos(s.time);
    addEmbers(s, C.wakeGift, 'gift');
    E.dirty();
    if (!E.isQuiet || !E.isQuiet()) E.emit('ember', { type: 'wake' }, s);
    return true;
  }

  E.addTickHook('ember', function (s, dt, isOffline) {
    if (!isAwake(s)) {
      if (loreWants(s)) wake(s); else return;
    }
    var em = sub(s);
    dt = pos(dt);
    var r = rate(s);
    if (isOffline) {
      var g = r * dt * (has(em, 'smoulder') ? 2 : 1);
      addEmbers(s, g, 'offline');
      em.offline = cl(pos(em.offline) + g);
      s._emberOffline = cl(pos(s._emberOffline) + g); // not saved: UI shows it once after a return
      return;
    }
    if (r > 0 && dt > 0) addEmbers(s, r * dt, 'kiln');
  });

  // Long Sleep keeps Ember untouched. Ascend (Myth) keeps her awake but leaves 25% of embers and kilns.
  function ascendReset(s) {
    var em = sub(s);
    if (!em) return;
    var keep = C.ascendKeep;
    em.embers = pos(Math.floor(pos(em.embers) * keep));
    em.earned = pos(Math.floor(pos(em.earned) * keep));
    for (var k = 0; k < KILNS.length; k++) em.kilns[k] = Math.floor(kilnCount(em, k) * keep);
    E.dirty();
  }
  E.addSleepHook('ember', function (s, prev, reason) {
    var em = sub(s);
    if (!em) return;
    // a Myth may reset the Wake Ember lore node; Ember stays awake (SPEC-V2 2)
    if (reason === 'ascend' && em.awake) ascendReset(s);
  });

  // ---------------------------------------------------------------- kilns
  function geoSum(base, owned, n) {
    var g = C.kilnGrowth;
    return pos(base * Math.pow(g, owned) * (Math.pow(g, n) - 1) / (g - 1));
  }
  function kilnMax(s, k) {
    k = kidx(k);
    if (k < 0 || !isAwake(s)) return 0;
    var em = peek(s), kd = KILNS[k];
    var have = pos(em.embers), owned = kilnCount(em, k);
    var first = kd.cost * Math.pow(C.kilnGrowth, owned);
    if (!(first > 0) || !isFinite(first) || have < first) return 0;
    var g = C.kilnGrowth;
    var n = Math.floor(Math.log(1 + have * (g - 1) / first) / Math.log(g));
    n = Math.max(0, Math.min(10000, n, C.maxKilns - owned));
    while (n > 0 && geoSum(kd.cost, owned, n) > have * (1 + 1e-12)) n--;
    return n;
  }
  function kidx(k) {
    if (typeof k === 'string' && KIDX.hasOwnProperty(k)) return KIDX[k];
    k = Math.floor(fin(k, -1));
    return (k >= 0 && k < KILNS.length) ? k : -1;
  }
  function normN(s, k, n) {
    if (n === 'max') return Math.max(1, kilnMax(s, k));
    n = Math.floor(fin(n, 1));
    return n < 1 ? 1 : Math.min(n, 10000);
  }
  function kilnCost(s, k, n) {
    k = kidx(k);
    if (k < 0) return { embers: 0, n: 0 };
    n = normN(s, k, n);
    return { embers: geoSum(KILNS[k].cost, kilnCount(peek(s), k), n), n: n };
  }
  function buyKiln(s, k, n) {
    k = kidx(k);
    if (k < 0 || !isAwake(s)) return false;
    if (n === 'max' && kilnMax(s, k) < 1) return false;
    n = normN(s, k, n);
    var em = sub(s), owned = kilnCount(em, k);
    if (owned + n > C.maxKilns) return false;
    var cost = geoSum(KILNS[k].cost, owned, n);
    if (!(cost > 0) || pos(em.embers) < cost * (1 - 1e-12)) return false;
    var before = milestoneMult(owned);
    em.embers = pos(pos(em.embers) - cost);
    em.kilns[k] = owned + n;
    E.dirty();
    E.emit('buy', { kind: 'kiln', id: KILNS[k].id, n: n }, s);
    if (milestoneMult(owned + n) > before) E.emit('ember', { type: 'milestone', id: KILNS[k].id, count: owned + n }, s);
    return true;
  }
  function kilnVisible(s, k) {
    var em = peek(s);
    if (k === 0) return true;
    return kilnCount(em, k) > 0 || kilnCount(em, k - 1) > 0;
  }

  // ---------------------------------------------------------------- Fire Breaths
  function breathList(s) {
    var em = peek(s), have = em ? pos(em.embers) : 0;
    return BREATHS.map(function (b) {
      var bought = has(em, b.id);
      return { id: b.id, name: b.name, text: b.text, cost: b.cost, bought: bought, affordable: !bought && isAwake(s) && have >= b.cost };
    });
  }
  function buyBreath(s, id) {
    if (!isAwake(s) || !BIDX.hasOwnProperty(id)) return false;
    var em = sub(s), b = BREATHS[BIDX[id]];
    if (has(em, id) || pos(em.embers) < b.cost) return false;
    em.embers = pos(pos(em.embers) - b.cost);
    em.breaths[id] = true;
    E.dirty();
    E.emit('ember', { type: 'breath', id: id }, s);
    return true;
  }
  function breathsOwned(s) { var em = peek(s), n = 0; for (var i = 0; i < BREATHS.length; i++) if (has(em, BREATHS[i].id)) n++; return n; }

  HOARD.ember = {
    C: C, KILNS: KILNS, BREATHS: BREATHS,
    isAwake: isAwake,
    wantsWake: loreWants,
    visible: function (s) { return isAwake(s) || loreWants(s); },
    wake: wake,
    rate: rate,                              // embers/s from kilns (live)
    kilnEach: kilnEach, kilnTotal: kilnTotal, kilnMult: kilnMult,
    kilnCount: function (s, k) { k = kidx(k); return k < 0 ? 0 : kilnCount(peek(s), k); },
    kilnCost: kilnCost, kilnMax: kilnMax, buyKiln: buyKiln, kilnVisible: kilnVisible,
    coinYield: coinYield,                    // embers per swiped coin
    warmth: warmth, warmthFor: warmthFor,
    embers: function (s) { var em = peek(s); return em ? pos(em.embers) : 0; },
    earned: function (s) { var em = peek(s); return em ? pos(em.earned) : 0; },
    has: function (s, id) { return has(peek(s), id); },
    breathList: breathList, buyBreath: buyBreath, breathsOwned: breathsOwned,
    addEmbers: function (s, n) { var g = addEmbers(s, n, 'other'); if (g > 0) E.dirty(); return g; },
    ascendReset: ascendReset,
    // UI helpers: amounts gained since the last call (cave floats / welcome-back toast)
    takeCoinGain: function () { var g = coinGainAcc; coinGainAcc = 0; return g; },
    takeOffline: function (s) { var g = s ? pos(s._emberOffline) : 0; if (s) delete s._emberOffline; return g; },
  };
})();
