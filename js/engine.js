/* Hoard — game rules. Pure state functions, save/load (with versioned migrations), offline progress,
 * and the v2 extension points (modifier pipeline, tick/sleep hooks, state defaults, card registry).
 * Classic script; never touches the DOM. Runs in Node via vm.runInThisContext. See EXTENSIONS.md. */
(function () {
  'use strict';
  var G = globalThis;
  var HOARD = (G.HOARD = G.HOARD || {});
  var D = HOARD.data;
  var C = D.C;
  var MAXN = C.maxNum;
  var VERSION = 2;

  // ================================================================ helpers
  function fin(x, d) { x = +x; return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function cl(x) {
    x = +x;
    if (x !== x) return 0;
    if (x > MAXN) return MAXN;
    if (x < -MAXN) return -MAXN;
    return x;
  }
  function pos(x) { x = cl(x); return x > 0 ? x : 0; }
  function clamp(x, a, b) { x = fin(x, a); return x < a ? a : (x > b ? b : x); }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function logErr(tag, e) { try { console.error('[HOARD] ' + tag, e); } catch (e2) { /* ignore */ } }

  // JSON-safe deep copy: finite numbers only, no functions, no `_`-prefixed keys, bounded depth/size
  function jsonSafe(v, depth) {
    depth = depth || 0;
    if (depth > 10) return null;
    if (v === null) return null;
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? cl(v) : 0;
    if (t === 'boolean') return v;
    if (t === 'string') return v.length > 20000 ? v.slice(0, 20000) : v;
    if (Array.isArray(v)) {
      var a = [];
      for (var i = 0; i < v.length && i < 5000; i++) { var x = jsonSafe(v[i], depth + 1); a.push(x === undefined ? null : x); }
      return a;
    }
    if (t === 'object') {
      var o = {}, n = 0;
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k) || k.charAt(0) === '_') continue;
        if (++n > 2000) break;
        var y = jsonSafe(v[k], depth + 1);
        if (y !== undefined) o[k] = y;
      }
      return o;
    }
    return undefined;
  }
  function clone(o) { var r = jsonSafe(o); return r === undefined ? null : r; }
  // fill a saved subtree from its defaults: keeps saved values whose type matches the default;
  // an empty-object default ({}) is a free-form map (all JSON-safe entries kept); extra saved keys are kept too
  function fillDefaults(def, saved) {
    if (Array.isArray(def)) return Array.isArray(saved) ? jsonSafe(saved) : jsonSafe(def);
    if (isObj(def)) {
      var out = {}, k;
      var src = isObj(saved) ? saved : {};
      for (k in def) if (Object.prototype.hasOwnProperty.call(def, k)) out[k] = fillDefaults(def[k], src[k]);
      for (k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k) || k.charAt(0) === '_' || Object.prototype.hasOwnProperty.call(out, k)) continue;
        var y = jsonSafe(src[k]);
        if (y !== undefined) out[k] = y;
      }
      return out;
    }
    if (typeof def === 'number') return (typeof saved === 'number' && isFinite(saved)) ? cl(saved) : def;
    if (typeof def === 'boolean') return typeof saved === 'boolean' ? saved : def;
    if (typeof def === 'string') return typeof saved === 'string' ? jsonSafe(saved) : def;
    if (def === null) { var z = jsonSafe(saved); return z === undefined ? null : z; }
    return jsonSafe(def);
  }
  function jsonMap(v) { return isObj(v) ? jsonSafe(v) : {}; }

  var BIDX = {}, UIDX = {}, CIDX = {};
  function rebuildIndexes() {
    BIDX = {}; D.buildings.forEach(function (b, i) { BIDX[b.id] = i; });
    UIDX = {}; D.upgrades.forEach(function (u, i) { UIDX[u.id] = i; });
    CIDX = {}; D.cards.forEach(function (c, i) { CIDX[c.id] = i; });
  }
  rebuildIndexes();
  function bdef(id) { return BIDX.hasOwnProperty(id) ? D.buildings[BIDX[id]] : null; }
  function udef(id) { return UIDX.hasOwnProperty(id) ? D.upgrades[UIDX[id]] : null; }
  function cdef(id) { return CIDX.hasOwnProperty(id) ? D.cards[CIDX[id]] : null; }
  function tierIdx(i) { i = Math.floor(fin(i, -1)); return (i >= 0 && i < D.tiers.length) ? i : -1; }

  // seeded 32-bit hash -> [0,1)
  function hash32(a, b) {
    var h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ================================================================ events
  var listeners = {};
  var quiet = 0; // >0 suppresses events (offline simulation)
  function on(name, fn) {
    if (typeof fn !== 'function' || typeof name !== 'string') return;
    (listeners[name] = listeners[name] || []).push(fn);
  }
  function off(name, fn) {
    var ls = listeners[name];
    if (!ls) return;
    var i = ls.indexOf(fn);
    if (i >= 0) ls.splice(i, 1);
  }
  // listeners get (payload, state): state is the game state the event happened in (undefined when the
  // caller has none), so feature modules can credit it directly instead of buffering in module globals
  function emit(name, payload, state) {
    if (quiet > 0) return;
    var ls = listeners[name];
    if (!ls) return;
    ls = ls.slice();
    for (var i = 0; i < ls.length; i++) {
      try { ls[i](payload, state); } catch (e) { logErr('event ' + name, e); }
    }
  }

  // automation context: feature modules run their auto-buyers/claimers inside automated(fn); events fired
  // there carry auto:true (buy) and inAuto() is true, so listeners can tell them from the player's own actions
  var autoDepth = 0;
  function automated(fn) {
    if (typeof fn !== 'function') return undefined;
    autoDepth++;
    try { return fn(); } finally { autoDepth--; }
  }
  function inAuto() { return autoDepth > 0; }

  // ================================================================ extension registries
  var modSources = [];    // { name, fn(state, M) }
  var tickHooks = [];     // { name, fn(state, dt, isOffline) }
  var sleepHooks = [];    // { name, fn(state, prevSnapshot, reason) }
  var stateDefs = [];     // { name, fn() -> default subtree, sanitize?(saved, defaults) -> subtree }
  var loadHooks = [];     // { name, fn(raw, o) }: one-time save conversions, run at the end of sanitize()
  var errCount = {};
  function upsert(list, item) {
    for (var i = 0; i < list.length; i++) if (list[i].name === item.name) { list[i] = item; return; }
    list.push(item);
  }
  function guarded(kind, item, args) {
    var k = kind + ':' + item.name;
    if ((errCount[k] || 0) >= 5) return; // a hook that keeps throwing is switched off
    try { item.fn.apply(null, args); } catch (e) { errCount[k] = (errCount[k] || 0) + 1; logErr(k, e); }
  }
  function addModSource(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    upsert(modSources, { name: name, fn: fn }); dirty(); return true;
  }
  function addTickHook(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    upsert(tickHooks, { name: name, fn: fn }); return true;
  }
  function addSleepHook(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    upsert(sleepHooks, { name: name, fn: fn }); return true;
  }
  // fn(raw, o): runs at the end of every sanitize() (each load, cloud pull, import), after the module subtrees and the
  // unknown top-level keys are in o and before the missions are rebuilt. raw = the migrated raw save (read only),
  // o = the sanitized state (write here). A conversion must guard itself with a flag in o.flags so it runs once.
  function addLoadHook(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    upsert(loadHooks, { name: name, fn: fn }); return true;
  }
  // fn(state) -> the longest offline sub-step (seconds) the module can live with, or 0 for no wish. offline() then uses
  // more sub-steps for a long absence (never fewer than C.offlineSteps, at most C.offlineStepsMax). Lore automation
  // uses it so Dream Keeper and the auto-buyers see a night away in steps of ~30 s instead of ~144 s.
  var offlineStepHooks = [];
  function addOfflineStepHook(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    upsert(offlineStepHooks, { name: name, fn: fn }); return true;
  }
  function offlineStepCount(state, seconds) {
    var steps = Math.max(1, Math.min(C.offlineSteps, Math.ceil(seconds)));
    var want = 0;
    for (var i = 0; i < offlineStepHooks.length; i++) {
      var d = 0;
      try { d = fin(offlineStepHooks[i].fn(state), 0); } catch (e) { logErr('offlineStep:' + offlineStepHooks[i].name, e); d = 0; }
      if (d > 0 && (!(want > 0) || d < want)) want = d;
    }
    if (want > 0) steps = Math.max(steps, Math.min(fin(C.offlineStepsMax, 960), Math.ceil(seconds / Math.max(1, want))));
    return steps;
  }
  var CORE_KEYS = null; // filled after baseState exists
  function addStateDefaults(name, fn, sanitizeFn) {
    if (typeof name !== 'string' || !name || name.charAt(0) === '_' || typeof fn !== 'function') return false;
    if (CORE_KEYS && CORE_KEYS.indexOf(name) >= 0 && CORE_MAPS.indexOf(name) < 0) { logErr('addStateDefaults', 'core key ' + name); return false; }
    upsert(stateDefs, { name: name, fn: fn, sanitize: typeof sanitizeFn === 'function' ? sanitizeFn : null });
    return true;
  }
  function defaultsOf(def) {
    var d = null;
    try { d = def.fn(); } catch (e) { logErr('defaults:' + def.name, e); d = {}; }
    var j = jsonSafe(d);
    return j === undefined ? {} : j;
  }
  function sanitizeSub(def, saved) {
    var d = defaultsOf(def);
    if (def.sanitize) {
      try {
        var r = def.sanitize(saved, d);
        var j = jsonSafe(r);
        if (j !== undefined && j !== null) return j;
      } catch (e) { logErr('sanitize:' + def.name, e); }
      return d;
    }
    try { return fillDefaults(d, saved); } catch (e) { return d; }
  }
  function ensureDefaults(state) {
    for (var i = 0; i < stateDefs.length; i++) {
      var n = stateDefs[i].name;
      if (state[n] === undefined || state[n] === null) state[n] = defaultsOf(stateDefs[i]);
    }
  }

  // ================================================================ stats cache
  var epoch = 1;
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function dirty() { epoch++; }

  // ================================================================ state
  function freshRun() { return { coins: 0, treasures: 0, gusts: 0, bestStreak: 1, swipePx: 0, playActive: 0 }; }
  function freshBuildings() { var o = {}; D.buildings.forEach(function (b) { o[b.id] = 0; }); return o; }

  function baseState() {
    var s = {
      v: VERSION,
      gold: 0,
      earnedRun: 0,
      earnedAll: 0,
      tiers: [0, 0, 0, 0, 0],
      buildings: freshBuildings(),
      upgrades: {},
      rank: 1,
      rankProgress: 0,
      missions: [],
      missionSeq: 0,
      missionPace: 0,  // quest pace (play time / design time of recent gold quests); 0 = not measured yet
      cards: {},
      chests: 0,
      legend: 0,       // Legend earned this Myth (drives the +10%/Legend passive bonus)
      legendPts: 0,    // spendable Legend (v2)
      sleeps: 0,
      myth: 0,         // Myth earned in total (v2; lore module drives it)
      mythPts: 0,      // spendable Myth (v2)
      myths: 0,        // Ascends taken (v2)
      lore: {},        // lore node id -> level (v2)
      relics: {},      // relic id -> level (v2)
      flags: {},       // tiny shared flags (v2)
      auto: {},        // automation toggles (v2)
      gust: 1,
      effects: [],
      stat: { swipePx: 0, coins: 0, treasures: 0, gusts: 0, bestStreak: 1, sleepsGold: 0, playActive: 0, fastestSleep: 0 },
      run: freshRun(),
      time: 0,
      savedAt: Date.now(),
      settings: { haptics: true, reducedMotion: false, buyAmt: 1 }
    };
    for (var i = 0; i < stateDefs.length; i++) s[stateDefs[i].name] = defaultsOf(stateDefs[i]);
    return s;
  }
  // core subtrees a module may also register defaults for (they are free-form maps in the core state)
  var CORE_MAPS = ['lore', 'relics', 'flags', 'auto'];
  CORE_KEYS = Object.keys(baseState());

  function newState() {
    var s = baseState();
    fillMissions(s);
    return s;
  }

  // ---------------------------------------------------------------- migrations
  // MIGRATIONS[n](raw) upgrades a parsed save object from version n to n+1 in place.
  var MIGRATIONS = {
    1: function (s) {
      // v1 -> v2: keep everything; Legend already earned becomes spendable right away
      if (s.legendPts === undefined) s.legendPts = fin(s.legend, 0);
      if (!isObj(s.lore)) s.lore = {};
      if (s.myth === undefined) s.myth = 0;
      if (s.mythPts === undefined) s.mythPts = 0;
      if (!isObj(s.relics)) s.relics = {};
      if (s.myths === undefined) s.myths = 0;
      if (!isObj(s.flags)) s.flags = {};
      if (!isObj(s.auto)) s.auto = {};
      // v1 did not track active play time; game time (s.time) is the closest estimate
      var t0 = pos(s.time);
      if (isObj(s.stat)) { if (s.stat.playActive === undefined) s.stat.playActive = t0; if (s.stat.fastestSleep === undefined) s.stat.fastestSleep = 0; }
      if (isObj(s.run) && s.run.playActive === undefined) s.run.playActive = fin(s.sleeps, 0) >= 1 ? 0 : t0;
      s.v = 2;
    }
  };

  function sanitize(s) {
    // builds a clean state from a (migrated) raw save object
    var b = baseState();
    if (!isObj(s)) return b;
    var o = b;
    o.gold = pos(s.gold);
    o.earnedRun = pos(s.earnedRun);
    o.earnedAll = Math.max(pos(s.earnedAll), o.earnedRun);
    if (Array.isArray(s.tiers)) for (var i = 0; i < 5; i++) o.tiers[i] = pos(s.tiers[i]);
    if (isObj(s.buildings)) D.buildings.forEach(function (bd) { o.buildings[bd.id] = Math.floor(clamp(s.buildings[bd.id], 0, 1e7)); });
    if (isObj(s.upgrades)) D.upgrades.forEach(function (u) { if (s.upgrades[u.id] === true) o.upgrades[u.id] = true; });
    o.rank = Math.floor(clamp(s.rank, 1, C.maxRank));
    o.rankProgress = Math.floor(clamp(s.rankProgress, 0, 1e6));
    o.missionSeq = Math.floor(clamp(s.missionSeq, 0, 2e9));
    o.missionPace = clamp(s.missionPace, 0, C.missionPaceMax);
    if (isObj(s.cards)) {
      // known cards first (registered event cards included); unknown ids are kept so a module that failed to load loses nothing
      for (var ck in s.cards) {
        if (!Object.prototype.hasOwnProperty.call(s.cards, ck) || ck.charAt(0) === '_') continue;
        var n = Math.floor(clamp(s.cards[ck], 0, 1e9));
        if (n > 0) o.cards[ck] = n;
      }
    }
    o.chests = Math.floor(clamp(s.chests, 0, 1e9));
    o.legend = Math.floor(clamp(s.legend, 0, MAXN));
    o.legendPts = Math.floor(clamp(s.legendPts, 0, MAXN));
    o.sleeps = Math.floor(clamp(s.sleeps, 0, 1e9));
    o.myth = Math.floor(clamp(s.myth, 0, MAXN));
    o.mythPts = Math.floor(clamp(s.mythPts, 0, MAXN));
    o.myths = Math.floor(clamp(s.myths, 0, 1e9));
    o.lore = jsonMap(s.lore);
    o.relics = jsonMap(s.relics);
    o.flags = jsonMap(s.flags);
    o.auto = jsonMap(s.auto);
    o.gust = clamp(s.gust, 0, 1);
    if (Array.isArray(s.effects)) {
      s.effects.forEach(function (e) {
        if (isObj(e) && typeof e.kind === 'string' && e.kind && o.effects.length < 50) {
          o.effects.push({ kind: e.kind, mult: clamp(e.mult, 0, 1e6), until: fin(e.until, 0) });
        }
      });
    }
    if (isObj(s.stat)) {
      ['swipePx', 'coins', 'treasures', 'gusts', 'sleepsGold', 'playActive', 'fastestSleep'].forEach(function (k) { o.stat[k] = pos(s.stat[k]); });
      o.stat.bestStreak = clamp(s.stat.bestStreak, 1, 1e6);
      for (var sk in s.stat) if (Object.prototype.hasOwnProperty.call(s.stat, sk) && !Object.prototype.hasOwnProperty.call(o.stat, sk) && typeof s.stat[sk] === 'number') o.stat[sk] = pos(s.stat[sk]);
    }
    if (isObj(s.run)) {
      ['coins', 'treasures', 'gusts', 'swipePx', 'playActive'].forEach(function (k) { o.run[k] = pos(s.run[k]); });
      o.run.bestStreak = clamp(s.run.bestStreak, 1, 1e6);
      for (var rk in s.run) if (Object.prototype.hasOwnProperty.call(s.run, rk) && !Object.prototype.hasOwnProperty.call(o.run, rk) && typeof s.run[rk] === 'number') o.run[rk] = pos(s.run[rk]);
    }
    o.time = pos(s.time);
    o.savedAt = fin(s.savedAt, 0) > 0 ? fin(s.savedAt, 0) : Date.now();
    if (isObj(s.settings)) {
      var st0 = jsonMap(s.settings);
      for (var sk2 in st0) if (!Object.prototype.hasOwnProperty.call(o.settings, sk2)) o.settings[sk2] = st0[sk2]; // module settings (sound volume ...)
      o.settings.haptics = s.settings.haptics !== false;
      o.settings.reducedMotion = s.settings.reducedMotion === true;
      var ba = s.settings.buyAmt;
      o.settings.buyAmt = (ba === 10 || ba === 'max') ? ba : 1;
    }
    // module subtrees (addStateDefaults)
    for (var d = 0; d < stateDefs.length; d++) {
      var def = stateDefs[d];
      if (CORE_MAPS.indexOf(def.name) >= 0) { o[def.name] = def.sanitize ? sanitizeSub(def, o[def.name]) : fillDefaults(defaultsOf(def), o[def.name]); continue; }
      o[def.name] = sanitizeSub(def, s[def.name]);
    }
    // unknown top-level keys (a newer version, or a module that did not load this time) survive untouched
    for (var uk in s) {
      if (!Object.prototype.hasOwnProperty.call(s, uk) || uk.charAt(0) === '_' || Object.prototype.hasOwnProperty.call(o, uk)) continue;
      var uv = jsonSafe(s[uk]);
      if (uv !== undefined) o[uk] = uv;
    }
    if (!isObj(o.flags)) o.flags = {};
    for (var lh = 0; lh < loadHooks.length; lh++) guarded('load', loadHooks[lh], [s, o]);
    o.v = VERSION;
    if (Array.isArray(s.missions)) {
      s.missions.forEach(function (m) {
        if (o.missions.length >= 3 || !isObj(m)) return;
        if (!TPL.hasOwnProperty(m.tpl)) return;
        var key = m.key;
        if (m.tpl === 'building' && !bdef(key)) return;
        if (m.tpl === 'tier') { key = tierIdx(key); if (key < 0) return; }
        var om = {
          uid: Math.floor(clamp(m.uid, 0, 2e9)), tpl: m.tpl, key: (key === undefined ? null : key),
          target: Math.max(1, pos(m.target)), base: pos(m.base), done: m.done === true
        };
        // quest timing (newer saves only; a mission without them is a legacy one)
        if (typeof m.T === 'number' && m.T > 0) om.T = clamp(m.T, 1, 1e7);
        if (typeof m.t0 === 'number') om.t0 = pos(m.t0);
        if (typeof m.t1 === 'number') om.t1 = pos(m.t1);
        o.missions.push(om);
      });
    }
    fixLegacyMissions(o);
    fillMissions(o);
    return o;
  }

  function parseSave(json) {
    var s = json;
    if (typeof json === 'string') {
      try { s = JSON.parse(json); } catch (e) { s = null; }
    }
    // tolerate a wrapper like { json: "...", savedAt }
    if (isObj(s) && typeof s.json === 'string' && s.v === undefined) {
      try { s = JSON.parse(s.json); } catch (e) { s = null; }
    }
    return isObj(s) ? s : null;
  }
  // version number of a raw save (string / object / cloud wrapper); 0 if it is not a save
  function saveVersion(raw) {
    try {
      var s = parseSave(raw);
      if (!s) return 0;
      var v = Math.floor(fin(s.v, 1));
      return v >= 1 ? v : 1;
    } catch (e) { return 0; }
  }

  function deserialize(json) {
    try {
      var raw = parseSave(json);
      if (!raw) return newState();
      var s = clone(raw); // never mutate the caller's object
      if (!isObj(s)) return newState();
      var from = Math.floor(fin(s.v, 1));
      if (from < 1) from = 1;
      var v = from;
      while (v < VERSION && MIGRATIONS[v]) {
        try { MIGRATIONS[v](s); } catch (e) { logErr('migrate v' + v, e); }
        v++;
      }
      var o = sanitize(s);
      if (from < VERSION) o._migratedFrom = from;
      if (from > VERSION) o._futureVersion = from;
      return o;
    } catch (e) {
      logErr('deserialize', e);
      return newState();
    }
  }

  function serialize(state) {
    try {
      if (isObj(state)) { state.savedAt = Date.now(); state.v = VERSION; }
      return JSON.stringify(state, function (k, v) {
        if (typeof k === 'string' && k.charAt(0) === '_') return undefined;
        if (typeof v === 'number' && !isFinite(v)) return 0;
        return v;
      });
    } catch (e) {
      return JSON.stringify(baseState());
    }
  }

  function ok(state) { return isObj(state) && Array.isArray(state.tiers) && isObj(state.buildings); }

  // ================================================================ cards
  function cardCopies(state, id) { return (state && isObj(state.cards)) ? Math.floor(fin(state.cards[id], 0)) : 0; }
  function levelFor(copies) {
    var l = 0, t = D.cardThresholds;
    for (var i = 0; i < t.length; i++) if (copies >= t[i]) l = i + 1;
    return l;
  }
  // v1 card effects, expressed as modifier contributions (keyed by the card's target)
  function v1CardMod(target) {
    if (typeof target !== 'string') return null;
    if (target.indexOf('b:') === 0) {
      var bid = target.slice(2);
      return function (s, M, l) { M.buildingMult[bid] = (M.buildingMult[bid] || 1) * (1 + 0.5 * l); };
    }
    if (target === 't:0') return function (s, M, l) { M.tierCostMult[0] *= 1 - Math.min(0.4, 0.04 * l); };
    if (target.indexOf('t:') === 0) {
      var ti = tierIdx(target.slice(2));
      if (ti < 1) return null;
      return function (s, M, l) { M.tierMult[ti] *= 1 + 0.5 * l; };
    }
    switch (target) {
      case 'coin': return function (s, M, l) { M.coinMult *= 1 + 0.25 * l; };
      case 'stroke': return function (s, M, l) { M.strokeMult *= 1 + 0.5 * l; };
      case 'gust': return function (s, M, l) { M.gustMult *= 1 + 0.25 * l; };
      case 'treasure': return function (s, M, l) { M.treasureFreq *= 1 + 0.1 * l; };
      case 'frenzy': return function (s, M, l) { M.frenzyDurAdd += 3 * l; };
      case 'offline': return function (s, M, l) { M.offlineCapAddH += l; };
      case 'streak': return function (s, M, l) { if (l >= 1) M.streakHigh = true; M.streakBonus *= 1 + 0.05 * l; };
      case 'gps': return function (s, M, l) { M.gpsMult *= 1 + 0.25 * l; };
      case 'legend': return function (s, M, l) { M.legendGainMult *= 1 + 0.1 * l; };
    }
    return null;
  }
  D.cards.forEach(function (c) { if (typeof c.mod !== 'function') { var f = v1CardMod(c.target); if (f) c.mod = f; } });

  function registerCards(list) {
    if (!Array.isArray(list)) list = [list];
    var added = 0;
    list.forEach(function (c) {
      if (!isObj(c) || typeof c.id !== 'string' || !c.id) return;
      if (!D.rarities[c.rarity]) c.rarity = 'epic';
      if (typeof c.name !== 'string') c.name = c.id;
      if (typeof c.describe !== 'function') { var txt = typeof c.text === 'string' ? c.text : ''; c.describe = function () { return txt; }; }
      if (typeof c.mod !== 'function') { var f = v1CardMod(c.target); if (f) c.mod = f; }
      if (CIDX.hasOwnProperty(c.id)) D.cards[CIDX[c.id]] = c; // re-registration (hot reload) replaces
      else { D.cards.push(c); added++; }
      rebuildIndexes();
    });
    dirty();
    return added;
  }

  // ================================================================ modifier pipeline
  function freshM() {
    return {
      // ---- SPEC-V2 0.1 fields
      gpsMult: 1,              // all building gold/s
      buildingMult: {},        // id -> mult
      tierMult: [1, 1, 1, 1, 1], // minion production per tier (index = producing tier)
      coinMult: 1,             // coin worth (flat part AND gps part)
      strokeMult: 1,
      costMultBuilding: 1,     // gold cost of buildings (>= 0.05)
      costMultTier: 1,         // gold cost of minions (>= 0.05)
      legendGainMult: 1,
      offlineCapAddH: 0,
      offlineMult: 1,          // offline gold x
      streakHigh: false,       // unlocks the x8 streak cap
      streakRamp: 1,           // >1 = reach streak levels faster (divides the time thresholds)
      treasureFreq: 1,         // >1 = more often
      frenzyDurAdd: 0,         // seconds
      gustCdMult: 1,           // <1 = faster recharge
      gustMult: 1,             // gust coin worth x
      chestCardsAdd: 0,
      sweepMult: 1,            // broom crew coins/s x
      // ---- foundation extras (documented in EXTENSIONS.md)
      allMult: 1,              // gold/s AND coin worth AND minion production, applied once (how Legend works)
      coinFlat: 1,             // flat coin value (Sharper Claws multiply it)
      coinGpsPct: 0,           // extra share of gold/s per coin, added to the base 0.5% (Golden Scales)
      spillMult: 1,            // coin spill rate x
      sweepRate: 0,            // base broom coins/s (Broom Crew sets the max)
      gustCd: C.gustCooldown,  // base gust cooldown seconds (Bigger Wings set the min)
      streakBonus: 1,          // streak multiplier value x (Comet Shard)
      tierCostMult: [1, 1, 1, 1, 1], // per-tier minion gold cost x (Ember Egg)
      frenzyMult: 1            // Gold Frenzy strength x
    };
  }
  function mClamp(x, a, b, d) { x = +x; if (!isFinite(x)) return d; return x < a ? a : (x > b ? b : x); }
  function sanitizeM(M) {
    var K1 = ['gpsMult', 'coinMult', 'strokeMult', 'legendGainMult', 'offlineMult', 'gustMult', 'sweepMult', 'allMult', 'coinFlat', 'spillMult', 'streakBonus', 'frenzyMult'];
    for (var i = 0; i < K1.length; i++) M[K1[i]] = mClamp(M[K1[i]], 0, MAXN, 1);
    M.costMultBuilding = mClamp(M.costMultBuilding, 0.05, MAXN, 1);
    M.costMultTier = mClamp(M.costMultTier, 0.05, MAXN, 1);
    M.offlineCapAddH = mClamp(M.offlineCapAddH, 0, 1e6, 0);
    M.streakHigh = !!M.streakHigh;
    M.streakRamp = mClamp(M.streakRamp, 0.1, 100, 1);
    M.treasureFreq = mClamp(M.treasureFreq, 0.01, 1000, 1);
    M.frenzyDurAdd = mClamp(M.frenzyDurAdd, 0, 1e6, 0);
    M.gustCdMult = mClamp(M.gustCdMult, 0.02, 100, 1);
    M.chestCardsAdd = Math.floor(mClamp(M.chestCardsAdd, 0, 100, 0));
    M.coinGpsPct = mClamp(M.coinGpsPct, 0, 1e6, 0);
    M.sweepRate = mClamp(M.sweepRate, 0, 1e6, 0);
    M.gustCd = mClamp(M.gustCd, 1, 1e6, C.gustCooldown);
    if (!isObj(M.buildingMult)) M.buildingMult = {};
    for (var k in M.buildingMult) if (Object.prototype.hasOwnProperty.call(M.buildingMult, k)) M.buildingMult[k] = mClamp(M.buildingMult[k], 0, MAXN, 1);
    ['tierMult', 'tierCostMult'].forEach(function (f) {
      var a = Array.isArray(M[f]) ? M[f] : [];
      var o = [];
      for (var j = 0; j < 5; j++) o.push(f === 'tierCostMult' ? mClamp(a[j], 0.05, MAXN, 1) : mClamp(a[j], 0, MAXN, 1));
      M[f] = o;
    });
    return M;
  }
  function runMods(state) {
    var M = freshM();
    for (var i = 0; i < modSources.length; i++) guarded('mod', modSources[i], [state, M]);
    return sanitizeM(M);
  }
  function modBreakdown(state) {
    var out = [];
    if (!ok(state)) return out;
    for (var i = 0; i < modSources.length; i++) {
      var M = freshM();
      try { modSources[i].fn(state, M); } catch (e) { /* shown as neutral */ }
      out.push({ name: modSources[i].name, M: sanitizeM(M) });
    }
    return out;
  }

  // ---------------------------------------------------------------- v1 bonuses as mod sources
  function legendMult(state) { return 1 + C.legendPer * pos(state.legend); }
  addModSource('legend', function (s, M) { M.allMult *= legendMult(s); });
  // Dragon Rank gives no gold/s of its own (ranks 7..12 open the Mines and First Light instead): only the high streaks
  addModSource('rank', function (s, M) {
    if (fin(s.rank, 1) >= C.streakHighRank) M.streakHigh = true;
  });
  addModSource('upgrades', function (s, M) {
    var ups = isObj(s.upgrades) ? s.upgrades : {};
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      if (ups[u.id] !== true) continue;
      var e = u.effect;
      if (e.kind === 'coinMult') M.coinFlat *= e.mult;
      else if (e.kind === 'scales') M.coinGpsPct += e.pct;
      else if (e.kind === 'sweep') M.sweepRate = Math.max(M.sweepRate, e.rate);
      else if (e.kind === 'gustCd') M.gustCd = Math.min(M.gustCd, e.sec);
      else if (e.kind === 'gleam') M.treasureFreq *= e.mult;
      else if (e.kind === 'spill') M.spillMult *= e.mult;
    }
  });
  addModSource('cards', function (s, M) {
    for (var i = 0; i < D.cards.length; i++) {
      var c = D.cards[i];
      if (typeof c.mod !== 'function') continue;
      var l = levelFor(cardCopies(s, c.id));
      if (l > 0) c.mod(s, M, l);
    }
  });

  // ================================================================ multipliers
  function milestoneCountBuilding(owned) {
    var n = 0, m = D.buildingMilestones;
    for (var i = 0; i < m.length; i++) if (owned >= m[i]) n++;
    if (owned >= 300) n += Math.floor((owned - 200) / 100);
    return n;
  }
  function milestoneCountTier(owned) {
    var n = 0, m = D.tierMilestones;
    for (var i = 0; i < m.length; i++) if (owned >= m[i]) n++;
    return n;
  }
  // owned count at which the n-th milestone (1-based) is reached
  function milestoneAt(kind, n) {
    var m = kind === 'building' ? D.buildingMilestones : D.tierMilestones;
    if (n <= m.length) return m[Math.max(0, n - 1)];
    return kind === 'building' ? 200 + (n - m.length) * 100 : m[m.length - 1];
  }
  // emits 'milestone' only when a milestone is passed for the first time this run (a tier spent on buildings
  // and bought back must not announce the same milestone again). Marks live in state.run (reset by Sleep).
  function milestoneCheck(state, kind, id, before, after) {
    if (kind === 'tier' && id === 0) return; // Eggs produce nothing, so their count milestones do nothing: no "x2" toast
    var c = kind === 'building' ? milestoneCountBuilding(after) : milestoneCountTier(after);
    if (!(c > before) || !isObj(state.run)) return;
    var key = (kind === 'building' ? 'msb_' : 'mst_') + id;
    var hw = Math.floor(pos(state.run[key]));
    if (c <= hw) return;
    state.run[key] = c;
    emit('milestone', { kind: kind, id: id, count: milestoneAt(kind, c), owned: after }, state);
  }
  function nextMilestone(kind, owned) {
    owned = Math.floor(fin(owned, 0));
    if (kind === 'building') {
      var m = D.buildingMilestones;
      for (var i = 0; i < m.length; i++) if (owned < m[i]) return m[i];
      return (Math.floor(owned / 100) + 1) * 100;
    }
    if (kind === 'tier') {
      var t = D.tierMilestones;
      for (var j = 0; j < t.length; j++) if (owned < t[j]) return t[j];
      return null;
    }
    return null;
  }
  function pow2(n) { return n > 900 ? MAXN : Math.pow(2, n); }

  function effectMult(state, kind) {
    var m = 1, t = fin(state.time, 0);
    if (!Array.isArray(state.effects) || state._noEffects) return 1;
    for (var i = 0; i < state.effects.length; i++) {
      var e = state.effects[i];
      if (e && e.kind === kind && fin(e.until, 0) > t) m *= fin(e.mult, 1);
    }
    return m;
  }
  function effectLeft(state, kind) {
    var left = 0, t = fin(state.time, 0);
    if (!Array.isArray(state.effects)) return 0;
    for (var i = 0; i < state.effects.length; i++) {
      var e = state.effects[i];
      if (e && e.kind === kind) left = Math.max(left, fin(e.until, 0) - t);
    }
    return left;
  }

  // per-unit production of tier i (i>=1)
  function tierUnitRate(state, i, M) {
    var td = D.tiers[i];
    if (!td || !td.prod) return 0;
    var owned = Math.floor(pos(state.tiers[i]));
    return cl(td.prod * pow2(milestoneCountTier(owned)) * M.allMult * M.tierMult[i]);
  }
  // building gps each, before global multipliers and frenzy
  function buildingGpsEach(state, id, M) {
    var b = bdef(id);
    if (!b) return 0;
    var owned = Math.floor(pos(state.buildings[id]));
    var bm = M.buildingMult[id];
    return cl(b.gps * pow2(milestoneCountBuilding(owned)) * (bm === undefined ? 1 : bm));
  }

  // Nest warmth: building gold/s x (1 + W / W0)^p, W = nest size in Eggs. Pure, reads state.tiers only.
  function nestSize(state) {
    var w = 0, eq = C.broodEggs || [];
    for (var i = 0; i < 5; i++) w += pos(state.tiers[i]) * fin(eq[i], 0);
    return cl(w);
  }
  // (1 + w/W0)^p up to the knee, then it keeps growing only with the log of the nest (same slope at the knee), so a
  // late-game brood of 1e30 Eggs warms ~x20, not x1e3: every Egg still helps, but it cannot run away with the game
  function warmthOf(w) {
    var w0 = fin(C.broodW0, 1000), p = fin(C.broodPow, 0), knee = fin(C.broodKnee, 0);
    if (!(w0 > 0) || !(p > 0)) return 1;
    var x = Math.log(1 + pos(w) / w0);
    var xk = knee > 0 ? Math.log(1 + knee / w0) : Infinity;
    if (x <= xk) return cl(Math.exp(p * x));
    return cl(Math.exp(p * xk) * (1 + p * (x - xk)));
  }

  // The nest a brood grows into over `sec` seconds of production (exact chain polynomial at today's per-unit rates,
  // nothing spent). With tier/n: as if n more of that tier were bought now, paying n x prevCost of the tier below.
  // UI previews ("Buy x10: +1.2K gold/s in 10 min") and tests; pure, never changes state.
  function nestIn(state, sec, tier, n) {
    var st = stats(state), r = st.tierUnitRate, eq = C.broodEggs || [], a = [], i, j, k;
    for (i = 0; i < 5; i++) a.push(pos(state.tiers[i]));
    tier = Math.floor(fin(tier, -1)); n = pos(n);
    if (tier >= 0 && tier < 5 && n > 0) {
      a[tier] = cl(a[tier] + n);
      if (tier > 0) a[tier - 1] = Math.max(0, a[tier - 1] - n * pos(D.tiers[tier].prevCost));
    }
    var t = pos(sec), w = 0;
    for (j = 0; j < 5; j++) {          // units of tier j after t: sum over k >= j of a_k x r_k..r_(j+1) x t^(k-j)/(k-j)!
      var u = 0, f = 1;
      for (k = j; k < 5; k++) {
        if (k > j) f = f * pos(r[k]) * t / (k - j);
        u += a[k] * f;
      }
      w += cl(u) * fin(eq[j], 0);
    }
    return cl(w);
  }

  function mods(state) { return stats(state).M; }
  function maxStreak(state) { return stats(state).maxStreak; }
  function streakEff(state, mult) {
    var st = stats(state);
    mult = clamp(mult, 1, 1e6);
    var cap = st.maxStreak;
    if (mult > cap) mult = cap;
    return mult * st.M.streakBonus;
  }

  function computeStats(state) {
    ensureDefaults(state);
    var M = runMods(state);
    var gm = M.allMult * M.gpsMult;
    var frenzy = effectMult(state, 'frenzy');
    var buildingGps = {}, buildingEach = {}, g = 0;
    var eachRaw = {};
    for (var i = 0; i < D.buildings.length; i++) {
      var id = D.buildings[i].id;
      var e0 = buildingGpsEach(state, id, M);
      eachRaw[id] = e0;
      g += e0 * Math.floor(pos(state.buildings[id]));
    }
    var nest = nestSize(state), brood = warmthOf(nest);
    var bg = cl(g * gm * brood);
    for (i = 0; i < D.buildings.length; i++) {
      var id2 = D.buildings[i].id;
      var each = cl(eachRaw[id2] * gm * brood * frenzy);
      buildingEach[id2] = each;
      buildingGps[id2] = cl(each * Math.floor(pos(state.buildings[id2])));
    }
    var gps = cl(bg * frenzy);
    // the gps part already carries allMult; divide it out so allMult (Legend, ...) applies to coins once
    // the Nest warmth reaches coins only by its broodCoin share (buildings and brood carry the growth)
    var bc = clamp(C.broodCoin, 0, 1);
    var bgCoin = bc >= 1 ? bg : cl(bg / Math.pow(brood, 1 - bc));
    var gpsPart = M.allMult > 0 ? (C.coinGpsPct + M.coinGpsPct) * bgCoin / M.allMult : 0;
    var coinWorth = cl((M.coinFlat + gpsPart) * M.coinMult * effectMult(state, 'ember') * M.allMult);
    var strokeWorth = cl(C.strokeFrac * coinWorth * M.strokeMult);
    var spillRate = C.spillBase * M.spillMult;
    var sweepRate = M.sweepRate * M.sweepMult;
    var tierRates = [0, 0, 0, 0, 0], unit = [0, 0, 0, 0, 0];
    for (var t = 1; t < 5; t++) {
      unit[t] = tierUnitRate(state, t, M);
      tierRates[t - 1] = cl(unit[t] * pos(state.tiers[t]));
    }
    var tf = M.treasureFreq;
    var fL = effectLeft(state, 'frenzy'), eL = effectLeft(state, 'ember');
    return {
      gps: gps,
      baseGps: bg,
      coinWorth: coinWorth,
      strokeWorth: strokeWorth,
      spillRate: spillRate,
      sweepRate: sweepRate,
      sweepGps: cl(Math.min(sweepRate, spillRate) * coinWorth),
      gustCooldown: M.gustCd * M.gustCdMult,
      gustWorthMult: C.gustMult * M.gustMult,
      treasureInterval: [C.treasureInterval[0] / tf, C.treasureInterval[1] / tf],
      tierRates: tierRates,
      tierUnitRate: unit,
      buildingGps: buildingGps,
      buildingEach: buildingEach,
      broodMult: brood,
      nestSize: nest,
      maxStreak: M.streakHigh ? C.streakCapHigh : C.streakCapLow,
      streakRamp: M.streakRamp,
      streakBonus: M.streakBonus,
      offlineCapHours: C.offlineCapHours + M.offlineCapAddH,
      offlineMult: M.offlineMult,
      legendMult: legendMult(state),
      frenzyActive: fL > 0 && !state._noEffects,
      emberActive: eL > 0 && !state._noEffects,
      frenzyLeft: Math.max(0, fL),
      emberLeft: Math.max(0, eL),
      M: M
    };
  }

  // cached per (state object, state.time, global dirty epoch); treat the result as read-only
  function stats(state) {
    if (!ok(state)) state = baseState();
    var ne = !!state._noEffects;
    var c = cache ? cache.get(state) : state._statsCache;
    if (c && c.t === state.time && c.e === epoch && c.ne === ne) return c.st;
    var st = computeStats(state);
    var rec = { t: state.time, e: epoch, ne: ne, st: st };
    if (cache) cache.set(state, rec);
    else { try { Object.defineProperty(state, '_statsCache', { value: rec, writable: true, configurable: true, enumerable: false }); } catch (e) { /* ignore */ } }
    return st;
  }

  // ================================================================ earning
  function earn(state, amount, source) {
    if (!ok(state)) return 0;
    amount = pos(amount);
    if (amount <= 0) return 0;
    state.gold = cl(pos(state.gold) + amount);
    state.earnedRun = cl(pos(state.earnedRun) + amount);
    state.earnedAll = cl(pos(state.earnedAll) + amount);
    return amount;
  }

  function coinCollected(state, n, streakMult, valueMult) {
    if (!ok(state)) return 0;
    n = pos(n);
    if (n <= 0) return 0;
    if (valueMult === undefined || valueMult === null) valueMult = 1;
    valueMult = pos(valueMult);
    var s = stats(state);
    var g = cl(n * s.coinWorth * streakEff(state, streakMult) * valueMult);
    state.stat.coins = cl(pos(state.stat.coins) + n);
    state.run.coins = cl(pos(state.run.coins) + n);
    var got = earn(state, g, 'coin');
    emit('coin', n, state);
    return got;
  }

  function strokeCollected(state, px, streakMult) {
    if (!ok(state)) return 0;
    px = pos(px);
    if (px <= 0) return 0;
    var s = stats(state);
    var g = cl(px / C.strokePx * s.strokeWorth * streakEff(state, streakMult));
    state.stat.swipePx = cl(pos(state.stat.swipePx) + px);
    state.run.swipePx = cl(pos(state.run.swipePx) + px);
    return earn(state, g, 'stroke');
  }

  // one broom-swept coin (count: several at once, e.g. a headless sim; valueMult is then their total worth)
  function sweepCollect(state, valueMult, count) {
    if (!ok(state)) return 0;
    if (valueMult === undefined || valueMult === null) valueMult = 1;
    var s = stats(state);
    if (s.sweepRate <= 0) return 0;
    state.run.coins = cl(pos(state.run.coins) + (count === undefined || count === null ? 1 : pos(count)));
    return earn(state, cl(s.coinWorth * pos(valueMult)), 'sweep');
  }

  function noteStreak(state, mult) {
    if (!ok(state)) return;
    mult = clamp(mult, 1, 1e6);
    if (mult > fin(state.stat.bestStreak, 1)) state.stat.bestStreak = mult;
    if (mult > fin(state.run.bestStreak, 1)) state.run.bestStreak = mult;
  }

  function gustReady(state) { return ok(state) && fin(state.gust, 0) >= 1; }
  function useGust(state) {
    if (!gustReady(state)) return false;
    state.gust = 0;
    state.stat.gusts = pos(state.stat.gusts) + 1;
    state.run.gusts = pos(state.run.gusts) + 1;
    emit('gust', undefined, state);
    return true;
  }

  // ================================================================ treasures
  function addEffect(state, kind, mult, dur) {
    if (!ok(state) || typeof kind !== 'string') return;
    if (!Array.isArray(state.effects)) state.effects = [];
    var t = fin(state.time, 0);
    var until = t + pos(dur);
    var keep = [];
    for (var i = 0; i < state.effects.length; i++) {
      var e = state.effects[i];
      if (e.kind === kind) until = Math.max(until, fin(e.until, 0));
      else keep.push(e);
    }
    keep.push({ kind: kind, mult: clamp(mult, 0, 1e6), until: until });
    state.effects = keep;
    dirty();
  }

  function grabTreasure(state) {
    if (!ok(state)) return { kind: 'none', title: '', text: '' };
    var list = D.treasures, total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    var r = Math.random() * total, pick = list[0];
    for (i = 0; i < list.length; i++) { r -= list[i].weight; if (r < 0) { pick = list[i]; break; } }
    var s = stats(state);
    var res = { kind: pick.kind, title: pick.title, text: pick.text };
    if (pick.kind === 'frenzy') {
      var dur = C.frenzyDur + s.M.frenzyDurAdd;
      var fm = C.frenzyMult * s.M.frenzyMult;
      addEffect(state, 'frenzy', fm, dur);
      res.text = 'Gold/s x' + (Math.round(fm * 100) / 100) + ' for ' + dur + 's!';
    } else if (pick.kind === 'lucky') {
      var amt = Math.min(0.15 * pos(state.gold) + 13, 900 * s.baseGps);
      amt = Math.max(amt, 50 * s.coinWorth);
      amt = earn(state, amt, 'treasure');
      res.gold = amt;
      res.text = '+' + HOARD.fmt(amt) + ' gold!';
    } else if (pick.kind === 'ember') {
      addEffect(state, 'ember', C.emberMult, C.emberDur);
      res.text = 'Coins and strokes x' + C.emberMult + ' for ' + C.emberDur + 's!';
    } else if (pick.kind === 'swarm') {
      res.spawnCoins = C.swarmCoins;
    } else if (pick.kind === 'clutch') {
      var gained = [0, 0, 0, 0, 0];
      for (i = 0; i < 5; i++) {
        if (!isUnlocked(state, 'tier', i)) continue;
        var add = pos(state.tiers[i]) * 0.1;
        if (i === 0) add = Math.max(add, 5);
        add = Math.floor(add);
        state.tiers[i] = cl(pos(state.tiers[i]) + add);
        gained[i] = add;
      }
      dirty();
      res.minions = gained;
      res.text = '+' + HOARD.fmt(gained[0]) + ' Eggs' + (gained[1] > 0 ? ' and more of your brood' : '') + '!';
    }
    state.stat.treasures = pos(state.stat.treasures) + 1;
    state.run.treasures = pos(state.run.treasures) + 1;
    emit('treasure', res, state);
    return res;
  }

  // ================================================================ unlocks
  function isUnlocked(state, kind, idOrIndex) {
    if (!ok(state)) return false;
    var r = fin(state.rank, 1);
    if (kind === 'building') { var b = bdef(idOrIndex); return !!b && r >= b.rank; }
    if (kind === 'tier') { var i = tierIdx(idOrIndex); return i >= 0 && r >= i + 1; }
    if (kind === 'sleep') return canSleep(state) || fin(state.sleeps, 0) > 0;
    return false;
  }

  // ================================================================ buildings
  function normN(n, maxFn) {
    if (n === 'max') { var m = maxFn(); return m > 0 ? m : 1; }
    n = Math.floor(fin(n, 1));
    return n < 1 ? 1 : n;
  }

  function minionSum(base, owned, n) {
    // sum_{k=0}^{n-1} ceil(base * 1.1^(owned+k))
    if (base <= 0 || n <= 0) return 0;
    var g = C.buildingMinionGrowth;
    var start = base * Math.pow(g, owned);
    if (n > 400) return cl(Math.ceil(start * (Math.pow(g, n) - 1) / (g - 1)) + n);
    var sum = 0, c = start;
    for (var k = 0; k < n; k++) {
      sum += Math.ceil(c * (1 - 1e-12));
      c *= g;
      if (sum > MAXN) return MAXN;
    }
    return sum;
  }
  function goldSum(base, owned, n) {
    var g = C.buildingGrowth;
    return cl(base * Math.pow(g, owned) * (Math.pow(g, n) - 1) / (g - 1));
  }
  // base gold price of a building's first unit with M.costMultBuilding applied
  function bGold(state, b) { return b.gold * stats(state).M.costMultBuilding; }

  function buildingCost(state, id, n) {
    var b = bdef(id);
    if (!b || !ok(state)) return { gold: 0, minionTier: -1, minions: 0 };
    var owned = Math.floor(pos(state.buildings[id]));
    n = normN(n, function () { return buildingMax(state, id); });
    n = Math.min(n, C.buildingMaxBuy);
    return {
      gold: goldSum(bGold(state, b), owned, n),
      minionTier: b.minionTier,
      minions: b.minionTier >= 0 ? minionSum(b.minions, owned, n) : 0,
      n: n
    };
  }

  function canPayBuilding(state, b, owned, n) {
    if (goldSum(bGold(state, b), owned, n) > pos(state.gold) * (1 + 1e-12)) return false;
    if (b.minionTier >= 0 && minionSum(b.minions, owned, n) > pos(state.tiers[b.minionTier]) + 1e-9) return false;
    return true;
  }

  function buildingMax(state, id) {
    var b = bdef(id);
    if (!b || !ok(state)) return 0;
    var owned = Math.floor(pos(state.buildings[id]));
    var g = C.buildingGrowth, gold = pos(state.gold);
    var p0 = bGold(state, b) * Math.pow(g, owned);
    if (!(p0 > 0) || gold < p0) return 0;
    var n = Math.floor(Math.log(1 + gold * (g - 1) / p0) / Math.log(g));
    if (b.minionTier >= 0) {
      var have = pos(state.tiers[b.minionTier]);
      var mg = C.buildingMinionGrowth, m0 = b.minions * Math.pow(mg, owned);
      var nm = Math.floor(Math.log(1 + have * (mg - 1) / m0) / Math.log(mg));
      if (nm < n) n = nm;
    }
    n = Math.max(0, Math.min(C.buildingMaxBuy, fin(n, 0)));
    while (n > 0 && !canPayBuilding(state, b, owned, n)) n--;
    if (n < C.buildingMaxBuy && canPayBuilding(state, b, owned, n + 1)) n++;
    return n;
  }

  function buyBuilding(state, id, n) {
    var b = bdef(id);
    if (!b || !ok(state) || !isUnlocked(state, 'building', id)) return false;
    var owned = Math.floor(pos(state.buildings[id]));
    if (n === 'max') { n = buildingMax(state, id); if (n < 1) return false; }
    n = Math.min(C.buildingMaxBuy, Math.max(1, Math.floor(fin(n, 1))));
    if (!canPayBuilding(state, b, owned, n)) return false;
    var before = milestoneCountBuilding(owned);
    state.gold = pos(state.gold - goldSum(bGold(state, b), owned, n));
    if (b.minionTier >= 0) state.tiers[b.minionTier] = pos(state.tiers[b.minionTier] - minionSum(b.minions, owned, n));
    state.buildings[id] = owned + n;
    dirty();
    milestoneCheck(state, 'building', id, before, owned + n);
    emit('buy', { kind: 'building', id: id, n: n, auto: autoDepth > 0 }, state);
    return true;
  }

  // ================================================================ minions
  function tierGoldPrice(state, i) {
    var M = stats(state).M;
    return D.tiers[i].gold * M.tierCostMult[i] * M.costMultTier;
  }
  function tierCost(state, i, n) {
    i = tierIdx(i);
    if (i < 0 || !ok(state)) return { gold: 0, prevTier: -1, prev: 0 };
    n = normN(n, function () { return tierMax(state, i); });
    var td = D.tiers[i];
    return {
      gold: cl(n * tierGoldPrice(state, i)),
      prevTier: i > 0 ? i - 1 : -1,
      prev: i > 0 ? cl(n * td.prevCost) : 0,
      n: n
    };
  }
  function tierMax(state, i) {
    i = tierIdx(i);
    if (i < 0 || !ok(state)) return 0;
    var n = Math.floor(pos(state.gold) / tierGoldPrice(state, i) * (1 + 1e-12));
    if (i > 0) n = Math.min(n, Math.floor(pos(state.tiers[i - 1]) / D.tiers[i].prevCost * (1 + 1e-12)));
    return Math.max(0, Math.min(C.tierMaxBuy, fin(n, 0)));
  }
  function buyTier(state, i, n) {
    i = tierIdx(i);
    if (i < 0 || !ok(state) || !isUnlocked(state, 'tier', i)) return false;
    if (n === 'max') { n = tierMax(state, i); if (n < 1) return false; }
    n = Math.min(C.tierMaxBuy, Math.max(1, Math.floor(fin(n, 1))));
    var g = n * tierGoldPrice(state, i);
    var p = i > 0 ? n * D.tiers[i].prevCost : 0;
    if (g > pos(state.gold) * (1 + 1e-12) + 1e-9) return false;
    if (i > 0 && p > pos(state.tiers[i - 1]) * (1 + 1e-12) + 1e-9) return false;
    var before = milestoneCountTier(Math.floor(pos(state.tiers[i])));
    state.gold = pos(state.gold - g);
    if (i > 0) state.tiers[i - 1] = pos(state.tiers[i - 1] - p);
    state.tiers[i] = cl(pos(state.tiers[i]) + n);
    dirty();
    var cnt = Math.floor(state.tiers[i]);
    milestoneCheck(state, 'tier', i, before, cnt);
    emit('buy', { kind: 'tier', id: i, n: n, auto: autoDepth > 0 }, state);
    return true;
  }

  // ================================================================ upgrades
  function upgradeReqMet(state, u) {
    var r = u.req;
    if (!r) return true;
    if (r.building && Math.floor(pos(state.buildings[r.building])) < r.n) return false;
    if (r.upgrade && state.upgrades[r.upgrade] !== true) return false;
    return true;
  }
  function upgradeList(state) {
    if (!ok(state)) return [];
    var gold = pos(state.gold), bg = stats(state).baseGps;
    var out = [], cheapest = null;
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      var bought = state.upgrades[u.id] === true;
      var req = upgradeReqMet(state, u);
      var vis = !bought && req && (u.cost <= 3 * gold || u.cost <= 120 * bg);
      var item = { id: u.id, name: u.name, text: u.text, cost: u.cost, bought: bought, visible: vis, affordable: !bought && req && gold >= u.cost };
      if (!bought && req && (!cheapest || u.cost < cheapest.cost)) cheapest = item;
      out.push(item);
    }
    if (cheapest) cheapest.visible = true; // always show the next goal
    return out;
  }
  function buyUpgrade(state, id) {
    var u = udef(id);
    if (!u || !ok(state)) return false;
    if (state.upgrades[id] === true || !upgradeReqMet(state, u)) return false;
    if (pos(state.gold) < u.cost) return false;
    state.gold = pos(state.gold - u.cost);
    state.upgrades[id] = true;
    dirty();
    emit('buy', { kind: 'upgrade', id: id, n: 1, auto: autoDepth > 0 }, state);
    return true;
  }

  // ================================================================ missions
  var TPL = {};
  D.missionTemplates.forEach(function (t) { TPL[t.tpl] = t; });
  var CORE_TPL = {};
  D.missionTemplates.forEach(function (t) { CORE_TPL[t.tpl] = 1; });
  // feature modules add quest kinds (EXTENSIONS.md 2.6c): def = { tpl, minRank, weight, act, group, text,
  //   offer(state, st) -> bool, make(state, m, ctx), cur(state, m, st) -> progress, title(m) -> string }.
  // ctx = { T, Ta, roll, st, rate, h2 }. A group holds at most one quest in the 3 slots. Saved quests of a
  // registered tpl survive load (sanitize keeps m.key as saved); isAct / notePace treat them like the core ones.
  function addMissionTemplate(def) {
    if (!isObj(def) || typeof def.tpl !== 'string' || !def.tpl || CORE_TPL[def.tpl]) return false;
    if (typeof def.make !== 'function' || typeof def.cur !== 'function') return false;
    var t = { tpl: def.tpl, minRank: Math.max(1, Math.floor(fin(def.minRank, 1))), weight: Math.max(0, fin(def.weight, 1)),
      act: !!def.act, group: typeof def.group === 'string' && def.group ? def.group : null, text: typeof def.text === 'string' ? def.text : '', def: def };
    var list = D.missionTemplates, found = false;
    for (var i = 0; i < list.length; i++) if (list[i].tpl === t.tpl) { list[i] = t; found = true; }
    if (!found) list.push(t);
    TPL[t.tpl] = t;
    return true;
  }
  function tplDef(tpl) { return TPL.hasOwnProperty(tpl) && TPL[tpl].def ? TPL[tpl].def : null; }

  function niceUp(x) {
    x = Math.max(1, fin(x, 1));
    if (x < 20) return Math.ceil(x);
    var e = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return cl(Math.ceil(x / e) * e);
  }
  var STREAK_STEPS = [2, 3, 5, 8];

  function isAct(tpl) { return !!(TPL[tpl] && TPL[tpl].act); }

  // ---- quest pace: how fast this player's gold quests (building/tier/earn) really go, as play time / design time.
  // Legend makes gold quests finish in seconds in late runs while coins/gusts need real minutes, so activity
  // quests are sized from the pace (rank-gate review 2026-11: they had become the rank wall of short late runs).
  // A log-space (geometric) moving average with each quest's ratio capped at 1: one slow gold quest must not lift
  // the pace enough to bring back full-size coins quests (a plain average went 0.04 -> 0.4 on one 15 min quest).
  // 'Reach X gold/s' quests are left out: how long they take depends on the shop and the Nest, not on play.
  function missionPace(state) {
    var p = fin(state.missionPace, 0);
    if (p > 0) return clamp(p, C.missionPaceMin, C.missionPaceMax);
    return C.missionPacePrior[fin(state.sleeps, 0) >= 1 ? 1 : 0];
  }
  function notePace(state, m) {
    if (!isObj(m) || isAct(m.tpl) || m.tpl === 'gps' || !(fin(m.T, 0) > 0) || typeof m.t0 !== 'number') return;
    var t1 = typeof m.t1 === 'number' ? m.t1 : pos(state.run.playActive);
    var lo = C.missionPaceMin, hi = C.missionPaceMax;
    var r = clamp((t1 - m.t0) / m.T, lo, hi);
    var a = clamp(C.missionPaceAlpha, 0, 1);
    state.missionPace = clamp(Math.exp((1 - a) * Math.log(missionPace(state)) + a * Math.log(r)), lo, hi);
  }
  // design seconds of play for a quest at rank r (roll = the quest's own 0.75..1.35 size roll)
  function missionT(r, roll) { return (C.missionTimeBase + C.missionTimePerRank * (r - 1)) * roll; }
  // the seconds an activity quest is sized for: K x pace x design time, within [minT x roll, design time]
  function actTime(state, T, roll) {
    var f = Math.min(1, pos(C.missionActPaceK) * missionPace(state));
    return Math.min(T, Math.max(pos(C.missionActMinT) * roll, T * f));
  }
  // activity quest targets (coins, gusts, treasures; streak is the next streak step)
  function actTarget(state, tpl, Ta, st) {
    switch (tpl) {
      case 'coins': return niceUp(Math.max(30, st.spillRate * C.missionCoinShare * Ta));
      case 'treasures': return Math.min(4, Math.max(1, Math.round(0.6 * Ta / ((st.treasureInterval[0] + st.treasureInterval[1]) / 2))));
      // the gust cooldown in effect now (Bigger Wings, cards): about half the time budget in cooldowns, rounded
      // down (the meter is often part-way when the quest appears, so n gusts can take nearly n full cooldowns)
      case 'gusts': return Math.min(6, Math.max(2, Math.floor(0.5 * Ta / Math.max(1, st.gustCooldown))));
    }
    return 0;
  }
  // saves from before the quest pace: an activity quest sized for the old fixed minutes is shrunk to the largest
  // target a new one could get now (progress kept: base is untouched, so it may simply be done), and a second
  // unfinished activity quest gives its slot back (fillMissions draws a gold quest for it).
  function fixLegacyMissions(state) {
    var ms = state.missions, st = null, seen = false;
    if (!Array.isArray(ms)) return;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!isObj(m) || !isAct(m.tpl)) continue;
      if (!(fin(m.T, 0) > 0) && m.uid >= C.tutorialMissions.length && m.tpl !== 'streak') {
        st = st || stats(state);
        var r = Math.floor(fin(state.rank, 1)), roll = 1.35;
        var Tl = missionT(r, roll), cap = actTarget(state, m.tpl, actTime(state, Tl, roll), st);
        if (cap > 0 && m.target > cap) m.target = cap;
        m.T = Math.round(Tl); // re-sized once: later loads leave it alone (no t0, so it never feeds the pace)
      }
      if (m.done === true || missionCur(state, m) >= m.target) continue; // finished: stays to be claimed
      if (seen) { ms.splice(i, 1); i--; continue; }
      seen = true;
    }
  }

  function rankNeed(state) {
    var r = ok(state) ? Math.floor(fin(state.rank, 1)) : 1;
    return r + 2;
  }

  function missionCur(state, m, st) {
    switch (m.tpl) {
      case 'building': return Math.floor(pos(state.buildings[m.key]));
      case 'tier': return Math.floor(pos(state.tiers[m.key]));
      case 'earn': return pos(state.earnedRun - m.base);
      case 'coins': return Math.floor(pos(state.run.coins - m.base));
      case 'streak': return fin(state.run.bestStreak, 1);
      case 'treasures': return pos(state.run.treasures - m.base);
      case 'gusts': return pos(state.run.gusts - m.base);
      case 'gps': return (st || stats(state)).baseGps;
    }
    var df = tplDef(m.tpl);
    if (df) { try { return pos(df.cur(state, m, st || stats(state))); } catch (e) { logErr('mission.cur:' + m.tpl, e); } }
    return 0;
  }
  function missionTitle(m) {
    var n = HOARD.fmt(m.target);
    switch (m.tpl) {
      case 'building': var b = bdef(m.key); return 'Own ' + n + ' ' + (b ? (m.target === 1 ? b.one : b.name) : '?');
      case 'tier': var t = D.tiers[m.key]; return 'Own ' + n + ' ' + (t ? (m.target === 1 ? t.one : t.name) : '?');
      case 'earn': return 'Earn ' + n + ' gold this Sleep';
      case 'coins': return 'Collect ' + n + ' coins';
      case 'streak': return 'Reach a x' + n + ' swipe streak';
      case 'treasures': return 'Grab ' + n + ' gleaming treasure' + (m.target === 1 ? '' : 's');
      case 'gusts': return 'Use ' + n + ' Wing Gust' + (m.target === 1 ? '' : 's');
      case 'gps': return 'Reach ' + n + ' gold/s';
    }
    var df = tplDef(m.tpl);
    if (df && typeof df.title === 'function') { try { return String(df.title(m)); } catch (e) { logErr('mission.title:' + m.tpl, e); } }
    return '?';
  }

  // the gold/s one could add by spending `budget` gold on a single unlocked building (the best one for it) at today's
  // multipliers. Milestone doublings and the Nest's own growth are left out, so a quest sized from it is reachable.
  function gpsReach(state, st, budget) {
    var best = 0, g = C.buildingGrowth, r = Math.floor(fin(state.rank, 1));
    var fr = st.baseGps > 0 ? Math.max(1, st.gps / st.baseGps) : 1; // buildingEach carries Gold Frenzy; baseGps not
    for (var i = 0; i < D.buildings.length; i++) {
      var b = D.buildings[i];
      if (r < b.rank) continue;
      var c0 = bGold(state, b) * Math.pow(g, Math.floor(pos(state.buildings[b.id])));
      if (!(c0 > 0) || !(budget > 0)) continue;
      var n = Math.floor(Math.log(1 + budget * (g - 1) / c0) / Math.log(g) + 1e-9);
      best = Math.max(best, n * pos(st.buildingEach[b.id]) / fr);
    }
    return cl(best);
  }

  // gold-equivalent price of one unit of tier i (its gold plus the gold of the units it consumes)
  function tierEq(state, i) {
    var eq = 0;
    for (var q = 0; q <= i; q++) eq = tierGoldPrice(state, q) + (q > 0 ? D.tiers[q].prevCost * eq : 0);
    return eq;
  }

  function genMission(state) {
    var seq = Math.floor(fin(state.missionSeq, 0));
    state.missionSeq = seq + 1;
    var r = Math.floor(fin(state.rank, 1));
    var st = stats(state);
    var h1 = hash32(seq, 1), h2 = hash32(seq, 2), h3 = hash32(seq, 3);
    var m = { uid: seq, tpl: 'coins', key: null, target: 1, base: 0, done: false };

    // first three missions ever: a gentle tutorial
    var tut = C.tutorialMissions;
    if (seq < tut.length) {
      m.tpl = tut[seq].tpl; m.key = tut[seq].key === undefined ? null : tut[seq].key; m.target = tut[seq].target;
      if (m.tpl === 'coins') m.base = pos(state.run.coins);
      if (m.tpl === 'earn') m.base = pos(state.earnedRun);
      return m;
    }

    var active = {}, actBusy = false, groupBusy = {};
    (state.missions || []).forEach(function (x) {
      if (!x) return;
      active[x.tpl + ':' + x.key] = true; active[x.tpl] = (active[x.tpl] || 0) + 1;
      if (isAct(x.tpl)) actBusy = true;
      if (TPL[x.tpl] && TPL[x.tpl].group) groupBusy[TPL[x.tpl].group] = true;
    });
    var cands = [];
    var unlockedB = D.buildings.filter(function (b) { return r >= b.rank; });
    var unlockedT = [0, 1, 2, 3, 4].filter(function (i) { return r >= i + 1; });
    var ms = maxStreak(state), bs = fin(state.run.bestStreak, 1);
    var nextStreak = 0;
    for (var s = 0; s < STREAK_STEPS.length; s++) if (STREAK_STEPS[s] > bs && STREAK_STEPS[s] <= ms) { nextStreak = STREAK_STEPS[s]; break; }

    D.missionTemplates.forEach(function (t) {
      if (r < t.minRank) return;
      if (t.act && actBusy) return; // one activity quest at a time: two would both gate on the player's own play
      if (t.tpl === 'streak' && !nextStreak) return;
      if (t.tpl === 'gps' && st.baseGps < 1) return;
      if (t.group && groupBusy[t.group]) return; // one quest per group (e.g. one Mines quest) in the slots
      if (t.def && typeof t.def.offer === 'function') {
        var offered = false;
        try { offered = !!t.def.offer(state, st); } catch (e) { logErr('mission.offer:' + t.tpl, e); offered = false; }
        if (!offered) return;
      }
      var w = t.weight;
      if (!(w > 0)) return;
      if (active[t.tpl]) w *= 0.15; // prefer variety
      cands.push({ t: t, w: w });
    });
    var tw = 0; cands.forEach(function (c) { tw += c.w; });
    var x = h1 * tw, pick = cands[0];
    for (var i = 0; i < cands.length; i++) { x -= cands[i].w; if (x < 0) { pick = cands[i]; break; } }
    m.tpl = pick.t.tpl;

    var rate = st.baseGps + 3 * st.coinWorth + st.sweepGps;
    // T = seconds of active play this mission should take (longer at higher rank)
    var roll = 0.75 + 0.6 * h3, T = missionT(r, roll);
    m.T = Math.round(T); m.t0 = pos(state.run.playActive);
    var Ta = actTime(state, T, roll); // activity quests: sized from the quest pace, not the fixed design time
    switch (m.tpl) {
      case 'building': {
        // favour the newest buildings
        var bl = unlockedB.filter(function (b) { return !active['building:' + b.id] && goldSum(bGold(state, b), Math.floor(pos(state.buildings[b.id])), 1) <= rate * T * 1.5; });
        if (!bl.length) bl = unlockedB.slice(0, 1);
        var wsum = 0, ws = bl.map(function (b, k) { var w = k + 1; wsum += w; return w; });
        var y = h2 * wsum, bi = bl.length - 1;
        for (var k = 0; k < bl.length; k++) { y -= ws[k]; if (y < 0) { bi = k; break; } }
        var b = bl[bi];
        var own = Math.floor(pos(state.buildings[b.id]));
        var budget = rate * T * C.missionBuildShare, step = 1;
        while (step < C.missionBuildMaxStep && goldSum(bGold(state, b), own, step + 1) <= budget) step++;
        var tgt = own + step;
        if (tgt >= 20) tgt = Math.ceil(tgt / 5) * 5;
        m.key = b.id; m.target = tgt;
        break;
      }
      case 'tier': {
        var tl = unlockedT.filter(function (i2) { return !active['tier:' + i2] && (i2 === 0 || pos(state.tiers[i2 - 1]) > 0) && tierEq(state, i2) <= rate * T; });
        if (!tl.length) tl = [0];
        var ti = tl[Math.min(tl.length - 1, Math.floor(h2 * tl.length))];
        var have = Math.floor(pos(state.tiers[ti]));
        var eq = tierEq(state, ti);
        var add = rate * T * C.missionBuildShare / Math.max(eq, 1e-9) + st.tierRates[ti] * T;
        add = Math.max(add, [10, 3, 2, 2, 1][ti]);
        m.key = ti; m.target = niceUp(have + add);
        break;
      }
      case 'earn':
        m.base = pos(state.earnedRun);
        m.target = niceUp(Math.max(100 * r, rate * T));
        break;
      case 'coins':
        m.base = pos(state.run.coins);
        m.target = actTarget(state, 'coins', Ta, st);
        break;
      case 'streak':
        m.target = nextStreak;
        break;
      case 'treasures':
        m.base = pos(state.run.treasures);
        m.target = actTarget(state, 'treasures', Ta, st);
        break;
      case 'gusts':
        m.base = pos(state.run.gusts);
        m.target = actTarget(state, 'gusts', Ta, st);
        break;
      case 'gps': {
        // a multiple of today's gold/s, but no more than spending the building-quest budget on the best building
        // gives (rank-gate review 2026-11: at rank 5+ the plain multiple took 15-35 min and became the new wall)
        var gm = st.baseGps * (r >= 7 ? 1.25 + 0.3 * h2 : 1.5 + 0.6 * h2);
        var reach = st.baseGps + gpsReach(state, st, rate * T * C.missionBuildShare);
        m.target = niceUp(Math.max(st.baseGps * C.missionGpsMinStep, Math.min(gm, reach)));
        break;
      }
      default: {
        var df = tplDef(m.tpl), made = false;
        if (df) {
          try { df.make(state, m, { T: T, Ta: Ta, roll: roll, st: st, rate: rate, h2: h2 }); made = true; } catch (e) { logErr('mission.make:' + m.tpl, e); }
        }
        if (!made) { m.tpl = 'earn'; m.key = null; m.base = pos(state.earnedRun); m.target = niceUp(Math.max(100 * r, rate * T)); }
      }
    }
    m.target = Math.max(1, cl(m.target));
    return m;
  }

  function fillMissions(state) {
    if (!Array.isArray(state.missions)) state.missions = [];
    var guard = 0;
    while (state.missions.length < 3 && guard++ < 10) state.missions.push(genMission(state));
    if (state.missions.length > 3) state.missions.length = 3;
  }

  function missionInfo(state, idx, st) {
    if (!ok(state) || !Array.isArray(state.missions)) return { title: '', cur: 0, target: 1, frac: 0, done: false };
    var m = state.missions[Math.floor(fin(idx, -1))];
    if (!isObj(m)) return { title: '', cur: 0, target: 1, frac: 0, done: false };
    var cur = cl(missionCur(state, m, st));
    var target = Math.max(1, pos(m.target));
    var done = m.done === true || cur >= target;
    return { title: missionTitle(m), cur: done ? Math.max(cur, target) : cur, target: target, frac: done ? 1 : clamp(cur / target, 0, 1), done: done };
  }

  function updateMissions(state, st) {
    if (!Array.isArray(state.missions)) return;
    for (var i = 0; i < state.missions.length; i++) {
      var m = state.missions[i];
      if (!isObj(m) || m.done) continue;
      if (missionCur(state, m, st) >= m.target) {
        m.done = true;
        if (typeof m.t0 === 'number') m.t1 = pos(state.run.playActive); // for the quest pace
        emit('mission', i, state);
      }
    }
  }

  function claimMission(state, idx) {
    var fail = { ok: false, rankUp: false, chests: 0 };
    if (!ok(state) || !Array.isArray(state.missions)) return fail;
    idx = Math.floor(fin(idx, -1));
    var m = state.missions[idx];
    if (!isObj(m)) return fail;
    if (!m.done && missionCur(state, m) < m.target) return fail;
    notePace(state, m);
    var gained = 1;
    state.chests = Math.floor(pos(state.chests)) + 1;
    state.rankProgress = Math.floor(pos(state.rankProgress)) + 1;
    var rankUp = false;
    if (state.rank < C.maxRank && state.rankProgress >= rankNeed(state)) {
      state.rankProgress = 0;
      var old = state.rank;
      state.rank = old + 1;
      state.chests += 1; gained += 1;
      rankUp = true;
    }
    if (state.rank >= C.maxRank) state.rankProgress = Math.min(state.rankProgress, rankNeed(state));
    dirty();
    // replace (after rank-up so the new mission scales with the new rank)
    state.missions.splice(idx, 1);
    var nm = genMission(state);
    state.missions.splice(idx, 0, nm);
    fillMissions(state);
    if (rankUp) {
      emit('rank', state.rank, state);
      D.buildings.forEach(function (b) { if (b.rank === state.rank) emit('unlock', { kind: 'building', id: b.id, name: b.name }, state); });
      D.tiers.forEach(function (t, i) { if (i + 1 === state.rank) emit('unlock', { kind: 'tier', id: i, name: t.name }, state); });
    }
    return { ok: true, rankUp: rankUp, chests: gained };
  }

  // ================================================================ cards
  // rolls one card id by rarity weight. Cards with `chest: false` (event cards) never drop from normal chests.
  // filter(cardDef) -> bool narrows the pool further (optional).
  function rollCard(filter) {
    var total = 0, k;
    for (k = 0; k < D.rarityOrder.length; k++) total += D.rarities[D.rarityOrder[k]].weight;
    var r = Math.random() * total, rar = D.rarityOrder[0];
    for (k = 0; k < D.rarityOrder.length; k++) { r -= D.rarities[D.rarityOrder[k]].weight; if (r < 0) { rar = D.rarityOrder[k]; break; } }
    var base = D.cards.filter(function (c) {
      if (typeof filter === 'function') { try { return !!filter(c); } catch (e) { return false; } }
      return c.chest !== false;
    });
    if (!base.length) return null;
    var pool = base.filter(function (c) { return c.rarity === rar; });
    if (!pool.length) pool = base;
    return pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))].id;
  }
  function grantCard(state, id, n) {
    if (!ok(state) || !cdef(id)) return false;
    n = Math.floor(fin(n, 1));
    if (n < 1) return false;
    if (!isObj(state.cards)) state.cards = {};
    state.cards[id] = Math.floor(pos(state.cards[id])) + n;
    dirty();
    emit('card', { id: id, n: n }, state);
    return true;
  }
  function openChest(state) {
    if (!ok(state) || Math.floor(pos(state.chests)) < 1) return [];
    state.chests = Math.floor(pos(state.chests)) - 1;
    var n = (fin(state.rank, 1) >= C.chestCardsRank ? C.chestCardsHigh : C.chestCardsLow) + stats(state).M.chestCardsAdd;
    var out = [];
    if (!isObj(state.cards)) state.cards = {};
    for (var i = 0; i < n; i++) {
      var id = rollCard();
      if (!id) break;
      state.cards[id] = Math.floor(pos(state.cards[id])) + 1;
      out.push(id);
    }
    dirty();
    emit('chest', out, state);
    return out;
  }
  function cardInfo(state, cardId) {
    var c = cdef(cardId);
    if (!c) return { id: cardId, name: '???', rarity: 'common', copies: 0, level: 0, nextAt: null, text: '' };
    var copies = cardCopies(state, cardId);
    var level = levelFor(copies);
    var nextAt = level < D.cardThresholds.length ? D.cardThresholds[level] : null;
    var text = '';
    try { text = c.describe(level); } catch (e) { text = ''; }
    return { id: c.id, name: c.name, rarity: c.rarity, copies: copies, level: level, nextAt: nextAt, text: text, flavor: c.flavor || '', target: c.target, group: c.group || '' };
  }

  // ================================================================ prestige
  function legendOnSleep(state) {
    if (!ok(state)) return 0;
    // v2: cube-root gain (v1 used sqrt(earnedRun / 1e6)). Same 3 Legend at the 1e7 minimum, but gold per run
    // grows roughly with Legend^2, so a sqrt gain gave each Sleep a fixed share of Legend and runs collapsed.
    var g = Math.floor(fin(C.legendK, 3.2) * Math.cbrt(pos(state.earnedRun) / C.sleepReq) * stats(state).M.legendGainMult + 1e-9);
    return Math.max(0, fin(g, 0));
  }
  function canSleep(state) { return ok(state) && pos(state.earnedRun) >= C.sleepReq; }

  // resets everything a Long Sleep resets, then runs the sleep hooks and refills missions.
  // between(state, snapshot) runs after the reset and before the hooks (sleep adds Legend there).
  // Returns the pre-reset snapshot (JSON copy). Used by sleep() and by the Myth "Ascend".
  function resetRun(state, reason, between) {
    if (!ok(state)) return null;
    var snap = clone(state);
    state.gold = 0;
    state.earnedRun = 0;
    state.tiers = [0, 0, 0, 0, 0];
    state.buildings = freshBuildings();
    state.upgrades = {};
    state.rank = 1;
    state.rankProgress = 0;
    state.effects = [];
    state.run = freshRun();
    state.gust = 1;
    state.missions = [];
    dirty();
    if (typeof between === 'function') { try { between(state, snap); } catch (e) { logErr('resetRun', e); } }
    reason = reason || 'sleep';
    for (var i = 0; i < sleepHooks.length; i++) { guarded('sleep', sleepHooks[i], [state, snap, reason]); dirty(); }
    state.missions = [];
    if (reason === 'ascend') state.missionPace = 0; // Legend is gone: gold quests are slow again, measure afresh
    dirty();
    fillMissions(state);
    return snap;
  }
  function sleep(state) {
    if (!canSleep(state)) return 0;
    var gained = legendOnSleep(state);
    state.stat.sleepsGold = cl(pos(state.stat.sleepsGold) + pos(state.earnedRun));
    var ra = pos(state.run && state.run.playActive);
    if (ra > 0 && (!(pos(state.stat.fastestSleep) > 0) || ra < state.stat.fastestSleep)) state.stat.fastestSleep = ra;
    resetRun(state, 'sleep', function (s) {
      s.legend = cl(pos(s.legend) + gained);
      s.legendPts = cl(pos(s.legendPts) + gained);
      s.sleeps = Math.floor(pos(s.sleeps)) + 1;
      s.chests = Math.floor(pos(s.chests)) + 1;
    });
    emit('sleep', gained, state);
    return gained;
  }

  // ================================================================ small shared helpers for feature modules
  function flag(state, key) { return (state && isObj(state.flags)) ? state.flags[key] : undefined; }
  function setFlag(state, key, v) {
    if (!ok(state) || typeof key !== 'string') return;
    if (!isObj(state.flags)) state.flags = {};
    if (v === undefined || v === null) delete state.flags[key];
    else { var j = jsonSafe(v); if (j !== undefined) state.flags[key] = j; }
    dirty();
  }
  // spend a numeric currency field (e.g. 'legendPts', 'mythPts', 'gold'): false if short
  function spend(state, field, amount) {
    if (!ok(state) || typeof field !== 'string') return false;
    amount = pos(amount);
    if (!(pos(state[field]) + 1e-9 >= amount)) return false;
    state[field] = pos(pos(state[field]) - amount);
    dirty();
    return true;
  }

  // ================================================================ simulation
  // exact integration of the chain over dt with constant per-unit rates
  // x_j(t) = sum_{k>=j} x_k * prod_{m=j+1..k} a_m * t^(k-j)/(k-j)!
  function advanceTiers(state, dt) {
    var a = [0, 0, 0, 0, 0], x = [0, 0, 0, 0, 0], i, j, k;
    var M = stats(state).M;
    for (i = 0; i < 5; i++) {
      x[i] = pos(state.tiers[i]);
      // a locked tier still produces if owned (e.g. after a load); fine
      if (i >= 1) a[i] = tierUnitRate(state, i, M);
    }
    var gained = [0, 0, 0, 0, 0];
    for (j = 0; j < 4; j++) {
      var sum = 0, coef = 1, fact = 1;
      for (k = j + 1; k < 5; k++) {
        coef *= a[k] * dt;
        fact *= (k - j);
        if (coef === 0) break;
        sum += x[k] * coef / fact;
      }
      gained[j] = pos(sum);
    }
    for (j = 0; j < 4; j++) {
      if (gained[j] <= 0) continue;
      var before = Math.floor(x[j]);
      var nv = cl(x[j] + gained[j]);
      state.tiers[j] = nv;
      milestoneCheck(state, 'tier', j, milestoneCountTier(before), Math.floor(nv));
    }
    return gained;
  }

  function step(state, dt, offline) {
    var st = stats(state);
    var g = st.gps * dt;
    if (offline || !state._caveActive) {
      g += st.sweepGps * dt;
      state.run.coins = cl(pos(state.run.coins) + Math.min(st.sweepRate, st.spillRate) * dt);
    }
    if (offline) g *= st.M.offlineMult;
    var earned = earn(state, g, offline ? 'offline' : 'idle');
    var mins = advanceTiers(state, dt);
    dirty(); // tier counts moved (offline sub-steps do not advance state.time)
    var cd = st.gustCooldown > 0 ? st.gustCooldown : C.gustCooldown;
    state.gust = clamp(fin(state.gust, 0) + dt / cd, 0, 1);
    return { gold: earned, minions: mins };
  }

  function runTickHooks(state, dt, isOffline) {
    for (var i = 0; i < tickHooks.length; i++) guarded('tick', tickHooks[i], [state, dt, !!isOffline]);
  }

  function pruneEffects(state) {
    if (!Array.isArray(state.effects)) { state.effects = []; return; }
    var t = fin(state.time, 0);
    var n = state.effects.length;
    state.effects = state.effects.filter(function (e) { return isObj(e) && fin(e.until, 0) > t; });
    if (state.effects.length !== n) dirty();
  }

  function tick(state, dt) {
    try {
      if (!ok(state)) return;
      dt = clamp(dt, 0, 3600);
      if (dt <= 0) return;
      // repair the bits a buggy caller could have broken
      if (!isObj(state.stat)) state.stat = baseState().stat;
      if (!isObj(state.run)) state.run = freshRun();
      if (!isObj(state.upgrades)) state.upgrades = {};
      for (var i = 0; i < 5; i++) state.tiers[i] = pos(state.tiers[i]);
      state.gold = pos(state.gold);
      ensureDefaults(state);
      dirty(); // callers (tests, UI, other modules) may have edited state directly since the last frame
      step(state, dt, false);
      state.time = cl(pos(state.time) + dt);
      state.stat.playActive = cl(pos(state.stat.playActive) + dt);
      state.run.playActive = cl(pos(state.run.playActive) + dt);
      pruneEffects(state);
      if (tickHooks.length) runTickHooks(state, dt, false);
      if (!Array.isArray(state.missions) || state.missions.length !== 3) fillMissions(state);
      updateMissions(state, stats(state));
    } catch (e) {
      logErr('tick', e);
    }
  }

  function offline(state, seconds) {
    var res = { seconds: 0, gold: 0, minions: [0, 0, 0, 0, 0] };
    if (!ok(state)) return res;
    try {
      ensureDefaults(state);
      dirty();
      var cap = stats(state).offlineCapHours * 3600;
      seconds = clamp(seconds, 0, cap);
      res.seconds = seconds;
      pruneEffects(state);
      if (seconds <= 0) return res;
      var steps = offlineStepCount(state, seconds);
      var dt = seconds / steps;
      quiet++;
      state._noEffects = true;
      dirty();
      try {
        for (var i = 0; i < steps; i++) {
          var r = step(state, dt, true);
          res.gold = cl(res.gold + r.gold);
          for (var j = 0; j < 5; j++) res.minions[j] = cl(res.minions[j] + r.minions[j]);
          if (tickHooks.length) runTickHooks(state, dt, true);
        }
      } finally {
        delete state._noEffects;
        dirty();
        quiet--;
      }
      updateMissions(state, stats(state));
    } catch (e) {
      logErr('offline', e);
    }
    return res;
  }

  HOARD.engine = {
    // ---- v1 contract (SPEC.md)
    newState: newState,
    deserialize: deserialize,
    serialize: serialize,
    stats: stats,
    tick: tick,
    earn: earn,
    coinCollected: coinCollected,
    strokeCollected: strokeCollected,
    sweepCollect: sweepCollect,
    noteStreak: noteStreak,
    gustReady: gustReady,
    useGust: useGust,
    grabTreasure: grabTreasure,
    buildingCost: buildingCost,
    buildingMax: buildingMax,
    buyBuilding: buyBuilding,
    tierCost: tierCost,
    tierMax: tierMax,
    buyTier: buyTier,
    upgradeList: upgradeList,
    buyUpgrade: buyUpgrade,
    isUnlocked: isUnlocked,
    nextMilestone: nextMilestone,
    missionInfo: function (state, idx) { return missionInfo(state, idx); },
    claimMission: claimMission,
    rankNeed: rankNeed,
    openChest: openChest,
    cardInfo: cardInfo,
    legendOnSleep: legendOnSleep,
    canSleep: canSleep,
    sleep: sleep,
    offline: offline,
    on: on,
    emit: emit,
    // v1 extras
    cardLevel: function (state, id) { return levelFor(cardCopies(state, id)); },
    // Nest warmth (feel pass): nest size in Eggs, and the building gold/s multiplier a nest of w Eggs gives
    nestSize: function (state) { return ok(state) ? nestSize(state) : 0; },
    warmthAt: function (w) { return warmthOf(w); },
    nestIn: function (state, sec, tier, n) { return ok(state) ? nestIn(state, sec, tier, n) : 0; },
    milestoneMult: function (kind, owned) { return pow2(kind === 'building' ? milestoneCountBuilding(fin(owned, 0)) : milestoneCountTier(fin(owned, 0))); },
    // ---- v2 extension points (EXTENSIONS.md)
    version: VERSION,
    addModSource: addModSource,
    addTickHook: addTickHook,
    addSleepHook: addSleepHook,
    addOfflineStepHook: addOfflineStepHook,
    addLoadHook: addLoadHook,
    addMissionTemplate: addMissionTemplate,
    addStateDefaults: addStateDefaults,
    registerCards: registerCards,
    flag: flag,
    setFlag: setFlag,
    off: off,
    dirty: function () { dirty(); },
    mods: mods,
    modBreakdown: modBreakdown,
    freshMods: freshM,
    resetRun: resetRun,
    addEffect: addEffect,
    effectLeft: function (state, kind) { return ok(state) ? Math.max(0, effectLeft(state, kind)) : 0; },
    grantCard: grantCard,
    rollCard: rollCard,
    spend: spend,
    levelFor: levelFor,
    saveVersion: saveVersion,
    migrations: MIGRATIONS,
    isQuiet: function () { return quiet > 0; },
    automated: automated,
    inAuto: inAuto,
    util: { fin: fin, cl: cl, pos: pos, clamp: clamp, isObj: isObj, hash32: hash32, clone: clone, jsonSafe: jsonSafe, pow2: pow2, MAXN: MAXN }
  };
})();
