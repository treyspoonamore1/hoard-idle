/* Hoard — js/events.js — event lairs (SPEC-V2 section 3). Engine-side module, Node-safe: no DOM, no window.
 * Owns state.events (addStateDefaults), the 'events' tick hook (schedule, live + offline production inside the
 * event window, swipe bonus) and the 9 exclusive event cards (registerCards, chest:false, each with a mod()).
 *
 * Schedule (wall clock, UTC-anchored, never Math.random): slot k starts at ANCHOR + k x 96 h; its lair
 * (k mod 3: Volcano Lair, Frozen Peak, Sunken Ship) runs 72 h, then a 24 h break. The player's first event starts
 * the moment the lairs unlock (Dragon Rank 3 in any run, or after a Long Sleep) and lasts a full 72 h; after it
 * the player follows the global schedule: a later slot that is already running is joined for its remaining time
 * (so the wait after the first lair is at most 24 h, or at most 48 h when the lairs unlocked during a break).
 * Tests: set HOARD.events._now = epochMs (or a function returning it) to fake the clock.
 * API: HOARD.events (see the bottom of this file). */
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
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function fmt(n) { return HOARD.fmt ? HOARD.fmt(n) : String(Math.floor(n)); }
  // round targets read better without padding zeros: 25.0K -> 25K, 2.50M -> 2.5M
  function fmtR(n) { return String(fmt(n)).replace(/\.(\d*?)0+(?=[A-Za-z]|$)/, function (m, d) { return d ? '.' + d : ''; }); }

  var H = 3600 * 1000;
  // ---------------------------------------------------------------- tuning (see tools/test-events.cjs pacing)
  var C = {
    anchor: Date.UTC(2026, 0, 5),  // Monday 2026-01-05 00:00 UTC: slot 0 (Volcano Lair) starts here
    runMs: 72 * H,
    slotMs: 96 * H,                // 72 h event + 24 h break
    startCur: 30,                  // currency each event starts with (three Imps right away)
    coinBase: 1,                   // currency per swiped coin ...
    coinRate: 0.05,                // ... plus this many seconds of tier-1 production per coin
    autoEvery: 1                   // seconds between Quest Scribe / Chest Kobold passes (live only)
  };
  // one chain shape for all three lairs (fair rotation); flavour differs.
  // tier 0 makes currency, tier k makes tier k-1. rate = units (or currency) per second per owned unit.
  var CHAIN = [
    { cost: 10, rate: 0.1 },
    { cost: 400, rate: 0.005 },
    { cost: 25000, rate: 0.0015 },
    { cost: 2.5e6, rate: 0.0005 }
  ];
  var LAIRS = [
    { id: 'volcano', name: 'Volcano Lair', short: 'Volcano', cur: 'Obsidian', icon: 'volcano',
      blurb: 'The mountain wakes. Its fire spits black glass, and the imps are hungry for it.',
      units: [
        { id: 'imp', name: 'Magma Imps', one: 'Magma Imp', verb: 'chips' },
        { id: 'hound', name: 'Lava Hounds', one: 'Lava Hound', verb: 'fetches' },
        { id: 'giant', name: 'Fire Giants', one: 'Fire Giant', verb: 'rouses' },
        { id: 'wyrm', name: 'Volcano Wyrms', one: 'Volcano Wyrm', verb: 'calls' }
      ] },
    { id: 'frost', name: 'Frozen Peak', short: 'Frozen Peak', cur: 'Frost Shards', icon: 'snow',
      blurb: 'Above the clouds the wind carves shards of blue ice. Kobolds in furs dig them out.',
      units: [
        { id: 'snowkob', name: 'Snow Kobolds', one: 'Snow Kobold', verb: 'chips' },
        { id: 'troll', name: 'Ice Trolls', one: 'Ice Troll', verb: 'herds' },
        { id: 'fwyvern', name: 'Frost Wyverns', one: 'Frost Wyvern', verb: 'drives' },
        { id: 'gwyrm', name: 'Glacier Wyrms', one: 'Glacier Wyrm', verb: 'calls' }
      ] },
    { id: 'sea', name: 'Sunken Ship', short: 'Sunken Ship', cur: 'Pearls', icon: 'wave',
      blurb: 'A treasure galleon sank in the bay. Its hold is full of pearls, and things with claws.',
      units: [
        { id: 'crab', name: 'Crab Divers', one: 'Crab Diver', verb: 'gathers' },
        { id: 'serpent', name: 'Sea Serpents', one: 'Sea Serpent', verb: 'leads' },
        { id: 'kraken', name: 'Kraken Mates', one: 'Kraken Mate', verb: 'hatches' },
        { id: 'awyrm', name: 'Abyssal Wyrms', one: 'Abyssal Wyrm', verb: 'calls' }
      ] }
  ];
  var LIDX = {};
  LAIRS.forEach(function (l, i) { LIDX[l.id] = i; });

  // 10-step quest line, the same shape in every lair. kinds: own (tier k count), earn (currency earned this
  // event), coins (coins swiped in the cave during this event). reward: event chest with `cards` cards;
  // `card` = a guaranteed card index in the lair's pool (else rolled).
  var QUESTS = [
    { kind: 'own', k: 0, n: 10, cards: 1 },
    { kind: 'coins', n: 150, cards: 1 },
    { kind: 'own', k: 1, n: 1, cards: 1, card: 1 },
    { kind: 'earn', n: 25000, cards: 1 },
    { kind: 'own', k: 2, n: 1, cards: 1, card: 2 },
    { kind: 'own', k: 3, n: 1, cards: 1 },
    { kind: 'coins', n: 2000, cards: 1 },
    { kind: 'earn', n: 5e8, cards: 1 },
    { kind: 'earn', n: 2e11, cards: 1 },
    { kind: 'earn', n: 3e13, cards: 3, all: true }
  ];

  // ---------------------------------------------------------------- exclusive cards (9, never in normal chests)
  function f1(x) { var s = (Math.round(x * 100) / 100).toFixed(2); return s.replace(/0+$/, '').replace(/\.$/, ''); }
  function L(lv) { return Math.max(1, lv); }
  var CARDS = [
    // volcano
    { id: 'ev_obsidianheart', group: 'volcano', name: 'Obsidian Heart', rarity: 'legendary',
      flavor: 'Still warm after a thousand years.',
      describe: function (lv) { return 'All gold ×' + f1(1 + 0.2 * L(lv)) + '.'; },
      // gold only (buildings and coins): an allMult would also speed up all four minion tiers
      mod: function (s, M, lv) { M.gpsMult *= 1 + 0.2 * lv; M.coinFlat *= 1 + 0.2 * lv; } },
    { id: 'ev_magmatalon', group: 'volcano', name: 'Magma Talon', rarity: 'epic',
      flavor: 'It drips, but never runs dry.',
      describe: function (lv) { return 'Coins and strokes are worth ×' + f1(1 + 0.15 * L(lv)) + '.'; },
      // stroke worth is a share of coin worth, so coinMult lifts strokes too (a strokeMult would square it)
      mod: function (s, M, lv) { M.coinMult *= 1 + 0.15 * lv; } },
    { id: 'ev_cindercrown', group: 'volcano', name: 'Cinder Crown', rarity: 'epic',
      flavor: 'The imps crowned their first king with it. He did not last.',
      describe: function (lv) { return 'Gold Frenzy lasts +' + (4 * L(lv)) + 's and is ×' + f1(1 + 0.1 * L(lv)) + ' stronger.'; },
      mod: function (s, M, lv) { M.frenzyDurAdd += 4 * lv; M.frenzyMult *= 1 + 0.1 * lv; } },
    // frozen peak
    { id: 'ev_glacierheart', group: 'frost', name: 'Heart of the Glacier', rarity: 'legendary',
      flavor: 'Time moves slower near it. So does everything else.',
      describe: function (lv) { return 'Gold while away ×' + f1(1 + 0.25 * L(lv)) + ', away cap +' + L(lv) + 'h.'; },
      mod: function (s, M, lv) { M.offlineMult *= 1 + 0.25 * lv; M.offlineCapAddH += lv; } },
    { id: 'ev_frostfang', group: 'frost', name: 'Frostbite Fang', rarity: 'epic',
      flavor: 'Pulled from a troll that bit the wrong dragon.',
      describe: function (lv) { return 'Building gold/s ×' + f1(1 + 0.3 * L(lv)) + '.'; },
      mod: function (s, M, lv) { M.gpsMult *= 1 + 0.3 * lv; } },
    { id: 'ev_rimefeather', group: 'frost', name: 'Rime Feather', rarity: 'epic',
      flavor: 'Shed by a wyvern that flew above the weather.',
      describe: function (lv) { var l = L(lv); return 'Wing Gust recharges ' + Math.round(100 * (1 - rimeCd(l))) + '% faster and gathers ×' + f1(1 + 0.25 * l) + ' gold.'; },
      mod: function (s, M, lv) { M.gustCdMult *= rimeCd(lv); M.gustMult *= 1 + 0.25 * lv; } },
    // sunken ship
    { id: 'ev_abyssalpearl', group: 'sea', name: 'Abyssal Pearl', rarity: 'legendary',
      flavor: 'Black as the trench it came from, and it hums.',
      describe: function (lv) { return 'Legend from each Long Sleep +' + (10 * L(lv)) + '%.'; },
      mod: function (s, M, lv) { M.legendGainMult *= 1 + 0.1 * lv; } },
    { id: 'ev_krakenink', group: 'sea', name: 'Kraken Ink', rarity: 'epic',
      flavor: 'Write a name in it and the sea remembers.',
      describe: function (lv) { return 'All brood production ×' + f1(1 + 0.3 * L(lv)) + '.'; },
      mod: function (s, M, lv) { for (var i = 1; i < 5; i++) M.tierMult[i] *= 1 + 0.3 * lv; } },
    { id: 'ev_drownedcompass', group: 'sea', name: 'Drowned Compass', rarity: 'epic',
      flavor: 'It no longer points north. It points to treasure.',
      describe: function (lv) { return 'Gleaming treasures appear ' + (10 * L(lv)) + '% more often.'; },
      mod: function (s, M, lv) { M.treasureFreq *= 1 + 0.1 * lv; } }
  ];
  function rimeCd(lv) { return Math.max(0.6, 1 - 0.05 * lv); }
  CARDS.forEach(function (c) { c.chest = false; c.event = true; });
  // pool per lair: [legendary, epic A, epic B] — quest steps 3 and 5 guarantee epics, the last step gives all three
  var POOL = {};
  LAIRS.forEach(function (l) { POOL[l.id] = CARDS.filter(function (c) { return c.group === l.id; }).map(function (c) { return c.id; }); });
  E.registerCards(CARDS);

  // ---------------------------------------------------------------- state subtree
  function defaults() {
    return {
      firstStart: 0,   // epoch ms the lairs unlocked (0 = locked); the first event starts right then
      firstSlot: 0,    // global slot whose lair the first event uses
      id: '',          // current/last event instance ('s' + slot); '' = none yet
      lair: '',
      start: 0, end: 0,
      over: false,     // the window of `id` has closed
      cur: 0, earned: 0, coins: 0, fromCoins: 0,
      units: [0, 0, 0, 0],
      bought: [0, 0, 0, 0],
      q: 0,            // quest steps claimed (0..10)
      chests: 0,       // unopened event chests (cards from this lair)
      chestCards: [],  // card count per unopened chest
      got: 0,          // event cards collected this event
      at: 0,           // wall ms up to which production has been simulated
      offGain: 0,      // currency produced in the last offline() run (UI note)
      last: {},        // summary of the previous event { id, lair, q, got }
      joined: 0, completed: 0
    };
  }
  function sanitize(saved, def) {
    var o = def || defaults();
    if (!isObj(saved)) return o;
    for (var k in saved) { // keep unknown keys (forward compatible)
      if (!Object.prototype.hasOwnProperty.call(saved, k) || Object.prototype.hasOwnProperty.call(o, k)) continue;
      var j = U.jsonSafe ? U.jsonSafe(saved[k]) : undefined;
      if (j !== undefined) o[k] = j;
    }
    ['firstStart', 'firstSlot', 'start', 'end', 'at'].forEach(function (k) { o[k] = Math.floor(fin(saved[k], o[k])); });
    if (o.firstStart < 0) o.firstStart = 0;
    ['cur', 'earned', 'coins', 'fromCoins', 'offGain', 'joined', 'completed', 'got'].forEach(function (k) { o[k] = pos(saved[k]); });
    o.q = Math.max(0, Math.min(QUESTS.length, Math.floor(pos(saved.q))));
    o.chests = Math.max(0, Math.min(50, Math.floor(pos(saved.chests))));
    o.chestCards = [];
    if (Array.isArray(saved.chestCards)) saved.chestCards.forEach(function (n) { if (o.chestCards.length < o.chests) o.chestCards.push(Math.max(1, Math.min(5, Math.floor(pos(n)) || 1))); });
    while (o.chestCards.length < o.chests) o.chestCards.push(1);
    o.id = typeof saved.id === 'string' ? saved.id.slice(0, 24) : '';
    o.lair = (typeof saved.lair === 'string' && LIDX.hasOwnProperty(saved.lair)) ? saved.lair : '';
    if (!o.lair) o.id = '';
    o.over = !!saved.over;
    ['units', 'bought'].forEach(function (k) {
      var a = Array.isArray(saved[k]) ? saved[k] : [];
      o[k] = [0, 0, 0, 0].map(function (z, i) { return pos(a[i]); });
    });
    o.last = isObj(saved.last) ? (U.jsonSafe ? U.jsonSafe(saved.last) : {}) || {} : {};
    return o;
  }
  E.addStateDefaults('events', defaults, sanitize);
  function ev(s) {
    if (!isObj(s)) return null;
    if (!isObj(s.events)) s.events = defaults();
    var e = s.events;
    if (!Array.isArray(e.units) || e.units.length !== 4) e.units = [0, 0, 0, 0];
    if (!Array.isArray(e.bought) || e.bought.length !== 4) e.bought = [0, 0, 0, 0];
    if (!Array.isArray(e.chestCards)) e.chestCards = [];
    return e;
  }

  // ---------------------------------------------------------------- clock + schedule
  function now() {
    var X = HOARD.events, f = X && X._now;
    var t = typeof f === 'function' ? f() : f;
    t = +t;
    return isFinite(t) && t > 0 ? t : Date.now();
  }
  function slotAt(t) { return Math.floor((t - C.anchor) / C.slotMs); }
  function slotStart(k) { return C.anchor + k * C.slotMs; }
  function lairOfSlot(k) { return LAIRS[((k % 3) + 3) % 3]; }
  // the player's schedule at wall time t:
  // { status: 'locked'|'active'|'break', id, slot, lair, start, end, next: { slot, lair, start } }
  function schedule(e, t) {
    if (!e || !(e.firstStart > 0)) return { status: 'locked' };
    var fs = e.firstStart, fEnd = fs + C.runMs, fSlot = Math.floor(fin(e.firstSlot, slotAt(fs)));
    var minNext = fSlot + 1; // never the same slot twice; a slot already running at fEnd is joined late
    if (t < fEnd) {
      return { status: 'active', first: true, id: 's' + fSlot, slot: fSlot, lair: lairOfSlot(fSlot), start: fs, end: fEnd,
        next: { slot: minNext, lair: lairOfSlot(minNext), start: slotStart(minNext) } };
    }
    var k = slotAt(t);
    if (k < minNext) return { status: 'break', next: { slot: minNext, lair: lairOfSlot(minNext), start: slotStart(minNext) } };
    var st = slotStart(k);
    if (t < st + C.runMs) {
      return { status: 'active', id: 's' + k, slot: k, lair: lairOfSlot(k), start: st, end: st + C.runMs,
        next: { slot: k + 1, lair: lairOfSlot(k + 1), start: slotStart(k + 1) } };
    }
    return { status: 'break', next: { slot: k + 1, lair: lairOfSlot(k + 1), start: slotStart(k + 1) } };
  }
  function eligible(s) { return fin(s.rank, 1) >= 3 || fin(s.sleeps, 0) >= 1 || fin(s.myths, 0) >= 1; }

  // ---------------------------------------------------------------- lifecycle
  function unlock(s, t) {
    var e = ev(s);
    if (!e || e.firstStart > 0) return false;
    var k = slotAt(t);
    e.firstStart = Math.floor(t);
    e.firstSlot = (t < slotStart(k) + C.runMs) ? k : k + 1; // in a break: start the upcoming lair early
    E.emit('event', { type: 'unlock' }, s);
    return true;
  }
  function begin(s, sch, t) {
    var e = ev(s);
    if (e.id && !e.over) finish(s);
    var keep = { firstStart: e.firstStart, firstSlot: e.firstSlot, last: e.last, joined: e.joined, completed: e.completed };
    var n = defaults();
    for (var k in keep) n[k] = keep[k];
    n.id = sch.id; n.lair = sch.lair.id; n.start = Math.floor(sch.start); n.end = Math.floor(sch.end);
    n.cur = C.startCur; n.at = Math.floor(t);
    n.joined = pos(e.joined) + 1;
    s.events = n;
    E.emit('event', { type: 'start', lair: n.lair, id: n.id, end: n.end }, s);
  }
  // closes the current event: unopened chests open by themselves (cards are permanent), summary kept in `last`
  function finish(s) {
    var e = ev(s);
    if (!e || !e.id || e.over) return null;
    var got = [];
    while (e.chests > 0) { var r = openChest(s, true); if (!r.length) break; got = got.concat(r); }
    e.over = true;
    e.last = { id: e.id, lair: e.lair, q: e.q, got: e.got, earned: e.earned };
    if (e.q >= QUESTS.length) e.completed = pos(e.completed) + 1;
    E.emit('event', { type: 'finish', lair: e.lair, id: e.id, quests: e.q, cards: got }, s);
    return got;
  }
  // brings the event state in line with the schedule (live only): unlock, start, finish
  function sync(s, t) {
    var e = ev(s);
    if (!e) return null;
    if (!(e.firstStart > 0)) { if (eligible(s)) unlock(s, t); else return { status: 'locked' }; }
    var sch = schedule(e, t);
    if (sch.status === 'active' && e.id !== sch.id) begin(s, sch, t);
    else if (sch.status !== 'active' && e.id && !e.over) finish(s);
    else if (e.id && !e.over && t >= e.end) finish(s);
    return sch;
  }

  // ---------------------------------------------------------------- production
  function lairDef(s) { var e = ev(s); return e && LIDX.hasOwnProperty(e.lair) ? LAIRS[LIDX[e.lair]] : null; }
  function running(s, t) {
    var e = ev(s);
    if (!e || !e.id || e.over) return false;
    t = t === undefined ? now() : t;
    return t >= e.start && t < e.end;
  }
  // exact closed form of the 4-tier chain over sec seconds (the top tier is constant)
  function produce(e, sec) {
    if (!(sec > 0)) return 0;
    var u = e.units, r0 = CHAIN[0].rate, r1 = CHAIN[1].rate, r2 = CHAIN[2].rate, r3 = CHAIN[3].rate;
    var t = sec, t2 = t * t / 2, t3 = t2 * t / 3, t4 = t3 * t / 4;
    var a0 = u[0], a1 = u[1], a2 = u[2], a3 = u[3];
    var gain = r0 * (a0 * t + r1 * (a1 * t2 + r2 * (a2 * t3 + r3 * a3 * t4)));
    u[2] = pos(a2 + r3 * a3 * t);
    u[1] = pos(a1 + r2 * (a2 * t + r3 * a3 * t2));
    u[0] = pos(a0 + r1 * (a1 * t + r2 * (a2 * t2 + r3 * a3 * t3)));
    gain = pos(gain);
    e.cur = cl(pos(e.cur) + gain);
    e.earned = cl(pos(e.earned) + gain);
    return gain;
  }
  // produce over the wall interval [from, to] clipped to the event window; returns currency gained
  function produceWall(e, from, to) {
    if (!e.id || e.over) return 0;
    var a = Math.max(from, e.start), b = Math.min(to, e.end);
    return b > a ? produce(e, (b - a) / 1000) : 0;
  }
  function rate(s) { var e = ev(s); return e ? pos(e.units[0]) * CHAIN[0].rate : 0; }      // currency / s
  function unitRate(s, k) {   // tier k-1 units (or currency for k = 0) per second from tier k
    var e = ev(s);
    if (!e || k < 0 || k > 3) return 0;
    return pos(e.units[k]) * CHAIN[k].rate;
  }
  function perCoin(s) { return C.coinBase + C.coinRate * rate(s); }

  var autoAcc = 0;
  // swiped coins (the engine's 'coin' event carries the state) add currency at once while a lair is open
  E.on('coin', function (n, s) {
    n = pos(n);
    if (!(n > 0) || n >= 1e9 || !s) return;
    var e = ev(s);
    if (!e || !(e.firstStart > 0) || !running(s)) return;
    var add = cl(n * perCoin(s));
    e.cur = cl(pos(e.cur) + add); e.earned = cl(pos(e.earned) + add);
    e.fromCoins = cl(pos(e.fromCoins) + add);
    e.coins = cl(pos(e.coins) + n);
  });

  E.addTickHook('events', function (s, dt, isOffline) {
    var e = ev(s);
    if (!e) return;
    var t = now();
    if (isOffline) {
      // offline sub-steps replay wall time from the last live tick onward, only inside the event window
      if (!e.id || e.over || !(e.firstStart > 0)) return;
      var from = e.at > 0 ? Math.min(e.at, t) : Math.min(fin(s.savedAt, t) || t, t);
      var to = Math.min(t, from + dt * 1000);
      var g = produceWall(e, from, to);
      e.at = Math.floor(to);
      e.offGain = cl(pos(e.offGain) + g);
      return;
    }
    sync(s, t);
    e = ev(s);
    if (!e.id || e.over) { e.at = Math.floor(t); return; }
    var lastAt = e.at > 0 ? Math.min(e.at, t) : t;
    produceWall(e, Math.max(lastAt, t - dt * 1000), t);
    e.at = Math.floor(t);
    autoAcc += dt;
    if (autoAcc >= C.autoEvery) { autoAcc = 0; automate(s); }
  });
  // offline() runs before the first live tick; reset the "while away" note at the start of each live session
  function takeOfflineGain(s) { var e = ev(s); if (!e) return 0; var g = pos(e.offGain); e.offGain = 0; return g; }

  // Quest Scribe / Chest Kobold (LORE automation) also work on event quests and chests
  function autoOn(s) { return !(isObj(s.auto) && s.auto.master === false); }
  function automate(s) {
    if (!isObj(s.lore) || !autoOn(s)) return;
    var LO = HOARD.lore;
    function on(id) {
      if (LO && typeof LO.nodeOn === 'function') return LO.nodeOn(s, id);
      return !!s.lore[id] && !(isObj(s.auto) && s.auto['n:' + id] === false);
    }
    E.automated(function () {
      if (on('auto_quest') && questInfo(s).done) claimQuest(s, true);
      if (on('auto_chest') && ev(s).chests > 0) openChest(s, true);
    });
  }

  // ---------------------------------------------------------------- buying
  function unitCost(s, k, n) {
    if (!(k >= 0 && k < 4)) return 0;
    if (n === 'max') n = unitMax(s, k);
    n = Math.floor(fin(n, 0));
    return n > 0 ? cl(CHAIN[k].cost * n) : 0;
  }
  function unitMax(s, k) {
    var e = ev(s);
    if (!e || !(k >= 0 && k < 4)) return 0;
    return Math.max(0, Math.min(1e15, Math.floor(pos(e.cur) / CHAIN[k].cost + 1e-9)));
  }
  function buyUnit(s, k, n) {
    var e = ev(s);
    if (typeof k === 'string') { var ld = lairDef(s); k = ld ? ld.units.map(function (u) { return u.id; }).indexOf(k) : -1; }
    k = Math.floor(fin(k, -1));
    if (!e || !running(s) || !(k >= 0 && k < 4)) return false;
    if (n === 'max') n = unitMax(s, k);
    n = Math.floor(fin(n, 0));
    if (!(n >= 1)) return false;
    var cost = CHAIN[k].cost * n;
    if (pos(e.cur) + 1e-9 < cost) return false;
    e.cur = pos(e.cur - cost);
    e.units[k] = cl(pos(e.units[k]) + n);
    e.bought[k] = cl(pos(e.bought[k]) + n);
    // no 'event' emit per buy: the playtest log records every 'event', and hold-to-buy repeats fast
    if (e.bought[k] === n) E.emit('event', { type: 'firstBuy', lair: e.lair, k: k }, s);
    return true;
  }

  // ---------------------------------------------------------------- quests
  function questText(q, ld) {
    if (!q || !ld) return '';
    if (q.kind === 'own') {
      var u = ld.units[q.k];
      return q.n === 1 ? (q.k === 3 ? 'Wake a' : 'Hire a') + ' ' + u.one : 'Own ' + fmtR(q.n) + ' ' + u.name;
    }
    if (q.kind === 'earn') return 'Gather ' + fmtR(q.n) + ' ' + ld.cur;
    if (q.kind === 'coins') return 'Swipe up ' + fmtR(q.n) + ' coins in the cave';
    return '';
  }
  function questCur(s, q) {
    var e = ev(s);
    if (q.kind === 'own') return Math.floor(pos(e.units[q.k]));
    if (q.kind === 'earn') return pos(e.earned);
    if (q.kind === 'coins') return Math.floor(pos(e.coins));
    return 0;
  }
  // info on quest step i (default: the current one)
  function questInfo(s, i) {
    var e = ev(s), ld = lairDef(s);
    if (i === undefined) i = e ? e.q : 0;
    var q = QUESTS[i];
    if (!e || !ld || !q) return { idx: i, title: '', cur: 0, target: 0, frac: 0, done: false, claimed: false, cards: 0, all: e ? e.q >= QUESTS.length : false };
    var claimed = i < e.q;
    var cur = claimed ? q.n : questCur(s, q);
    return { idx: i, title: questText(q, ld), kind: q.kind, cur: cur, target: q.n, frac: Math.max(0, Math.min(1, cur / q.n)),
      done: !claimed && i === e.q && cur >= q.n && running(s), claimed: claimed, cards: q.cards, current: i === e.q };
  }
  function claimQuest(s, auto) {
    var e = ev(s);
    if (!e) return false;
    var qi = questInfo(s);
    if (!qi.done) return false;
    var q = QUESTS[e.q];
    e.q += 1;
    e.chests = Math.min(50, e.chests + 1);
    e.chestCards.push(q.cards);
    E.emit('event', { type: 'quest', lair: e.lair, step: e.q, auto: !!auto }, s);
    if (e.q >= QUESTS.length) E.emit('event', { type: 'complete', lair: e.lair, id: e.id }, s);
    return true;
  }
  function rollPool(lair) {
    var p = POOL[lair] || [];
    if (!p.length) return null;
    var w = p.map(function (id) { var c = cardDefLocal(id); return c && c.rarity === 'legendary' ? 1 : 3; });
    var tot = w.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * tot;
    for (var i = 0; i < p.length; i++) { r -= w[i]; if (r < 0) return p[i]; }
    return p[p.length - 1];
  }
  function cardDefLocal(id) { for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i]; return null; }
  // opens one event chest; the chest of step i (in claim order) follows QUESTS[i].card / .all. Returns card ids.
  function openChest(s, quiet) {
    var e = ev(s);
    if (!e || !(e.chests > 0) || !POOL[e.lair]) return [];
    var stepIdx = e.q - e.chests;              // which quest this chest came from (oldest unopened first)
    var q = QUESTS[Math.max(0, Math.min(QUESTS.length - 1, stepIdx))] || {};
    var n = Math.max(1, Math.floor(pos(e.chestCards.shift())) || 1);
    e.chests -= 1;
    var pool = POOL[e.lair], out = [];
    if (q.all) out = pool.slice(0, n);
    else if (q.card !== undefined) { out.push(pool[q.card] || pool[0]); }
    while (out.length < n) out.push(rollPool(e.lair));
    out = out.filter(Boolean);
    out.forEach(function (id) { E.grantCard(s, id, 1); });
    e.got = pos(e.got) + out.length;
    E.emit('event', { type: 'chest', lair: e.lair, cards: out, auto: !!quiet }, s);
    return out;
  }

  // ---------------------------------------------------------------- read helpers for the UI
  function info(s, t) {
    var e = ev(s);
    t = t === undefined ? now() : t;
    var sch = schedule(e, t);
    var ld = sch.lair || null;
    var out = { status: sch.status, now: t, lair: ld, next: sch.next || null, left: 0, untilNext: 0, first: !!sch.first };
    if (sch.status === 'active') out.left = Math.max(0, (sch.end - t) / 1000);
    if (sch.next) out.untilNext = Math.max(0, (sch.next.start - t) / 1000);
    out.synced = !!(e && sch.status === 'active' && e.id === sch.id && !e.over);
    return out;
  }
  function cards(lairId) { return (POOL[lairId] || []).slice(); }
  function anyClaim(s) { var e = ev(s); return !!e && running(s) && (questInfo(s).done || e.chests > 0); }

  HOARD.events = {
    _now: (HOARD.events && HOARD.events._now) || null,   // tests: epoch ms or fn() -> epoch ms
    C: C, CHAIN: CHAIN, LAIRS: LAIRS, QUESTS: QUESTS, CARDS: CARDS,
    now: now,
    fmtR: fmtR,
    schedule: function (s, t) { return schedule(ev(s), t === undefined ? now() : t); },
    globalSlot: function (t) { var k = slotAt(t), st = slotStart(k); return { slot: k, lair: lairOfSlot(k), start: st, end: st + C.runMs, active: t < st + C.runMs }; },
    sync: function (s, t) { return sync(s, t === undefined ? now() : t); },
    info: info,
    unlocked: function (s) { var e = ev(s); return !!e && e.firstStart > 0; },
    eligible: function (s) { return isObj(s) && eligible(s); },
    active: function (s) { return running(s); },
    lair: lairDef,
    lairById: function (id) { return LIDX.hasOwnProperty(id) ? LAIRS[LIDX[id]] : null; },
    rate: rate, unitRate: unitRate, perCoin: perCoin,
    unitCost: unitCost, unitMax: unitMax, buyUnit: buyUnit,
    questInfo: questInfo, claimQuest: function (s) { return claimQuest(s, false); },
    openChest: function (s) { return openChest(s, false); },
    anyClaim: anyClaim,
    cards: cards,
    takeOfflineGain: takeOfflineGain,
    produce: function (s, sec) { var e = ev(s); return e && e.id && !e.over ? produce(e, pos(sec)) : 0; }
  };
})();
