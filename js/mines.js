/* Hoard — js/mines.js — the Mines (SPEC-MINES). Engine-side module, Node-safe: no DOM, no window.
 * The Mines open for good the first time a run reaches Dragon Rank 7, or once Call the Deep is learned. A 4-tier
 * chain digs Ore: Pick Crews dig Ore, Ore Carts bring Crews, Tunnel Borers bring Carts, Deep Delvers bring Borers.
 * A hire by hand costs Eggs (x2.5 per hire of a tier; units the chain makes are free). The Mines keep digging live and
 * offline and survive Long Sleep; at each Sleep the run's leftover Eggs recruit up to 3 of each open miner (the
 * tithe: a fixed pace, so a short live run counts as much as a long Dream Keeper run), an Ascend keeps 25%.
 * Ore buys Forge levels (swipe and gold power), Shaft Depth (never caps, opens the deep tiers), Stoke the Forge (never
 * caps) and Sky Lanterns; the lifetime Ore dug lights the Forge glow (gold/s and coin worth). 1 coin in 8 is an Ore
 * nugget (js/cave.js).
 * Also here: the 9 Deep cards (the old event-lair cards, dropped by Deep Chests at every power of ten of Ore dug),
 * the 'ore' and 'hire' quests (E.addMissionTemplate), and the one-time conversions of old saves (Ember -> the Mines,
 * event lairs retired; E.addLoadHook). raw.ember / raw.events stay in the save untouched.
 * The chain math (exact integration, geometric hire prices) is a small helper, makeChain(), so the later chains
 * (Treasury at rank 9, Sky at rank 11; SPEC-MINES B10) reuse it.
 * API: HOARD.mines (see the bottom of this file). */
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
  function int(x) { return Math.floor(pos(x)); }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function log10(x) { return Math.log(x) / Math.LN10; }
  function quiet() { return !!(E.isQuiet && E.isQuiet()); }
  function emit(name, d, s) { if (!quiet()) E.emit(name, d, s); }
  function fmt(n) { return typeof HOARD.fmt === 'function' ? HOARD.fmt(n) : String(Math.floor(n)); }

  // ---------------------------------------------------------------- tuning (SPEC-MINES B2)
  var C = {
    openRank: 7,
    gift: [3, 0, 0, 0],      // Pick Crews the Mines open with (no Ore)
    hireGrowth: 2.5,         // each hire by hand costs x2.5 the one before (the tithe and chain-made units do not count)
    // the tithe (playtest review C1): at each Long Sleep every open tier recruits 1 miner once the leftover Eggs reach
    // its first-hire price, 2 at x1000 that, 3 (the cap) at x1M. It never raises the hire price, so the player's short
    // live runs keep recruiting after a night of long Dream Keeper runs (the old Egg-budget tithe stalled at 0-1).
    titheCap: 3,
    titheStep: 3,            // log10 steps: one more recruit per x1000 Eggs above the first-hire price
    maxBuy: 10000,
    nugEvery: 8,             // 1 spilled coin in 8 is an Ore nugget (cave)
    nugMaxOnScreen: 6,
    nugSec: 2,               // a nugget is worth 2 s of the crews' Ore/s ...
    nugMin: 1,               // ... and never less than 1 Ore
    // glow = 1 + glowK x (heart ? heartMult : 1) x log10(1 + lifetime Ore)^glowExp. SPEC-MINES B2 said 0.008; the B12
    // sims (sim-lore 4 moderate) put the first Ascend at 1.84 h with it (gate 2.0-3.5 h), so the tuning order applies:
    // glowK 0.003, depthBase 3e4, the Forge dearer, Dragon's Hunger base 6, Deep Chests from 100K Ore (SPEC-MINES B12)
    glowK: 0.002,
    glowExp: 2.2,
    heartMult: 1.25,
    ascendKeep: 0.25,        // an Ascend keeps 25% of Ore, lifetime Ore and miners
    depthBase: 3e4,          // Shaft Depth D -> D+1 costs depthBase x depthGrowth^D Ore (spec 1e4; see glowK)
    depthGrowth: 10,
    depthMul: 1.25,          // miners x1.25^D (multiplies, so a deep level still matters; review C1: +0.5 each faded)
    depthMax: 300,
    relicMult: 3,            // Deep Veins (relic r_ember): miners x3
    seamSec: 60,             // Lucky Seam: a treasure also gives 60 s of Ore
    nightMult: 2,            // Night Shift: Ore dug while away x2
    chestBase10: 5,          // Deep Chest n (0-based) at 10^(5 + n) Ore dug (100K, 1M, 10M, ...; spec 3, see glowK)
    emberOreDiv: 5,          // save conversion: 5 embers = 1 Ore
    evOrePerStep: 500,       // save conversion: 500 Ore per event-lair quest step claimed
    oreQuestShare: 0.6       // a 'Dig N Ore' quest asks for this share of its activity time's Ore (see the quest)
  };
  // prod: what one unit makes per second (k = 0: Ore; k >= 1: units of tier k-1); eggs: the first hire's price
  var TIERS = [
    { id: 'crew', name: 'Pick Crews', one: 'Pick Crew', eggs: 1.6e7, prod: 0.1, depth: 0, verb: 'digs' },
    { id: 'cart', name: 'Ore Carts', one: 'Ore Cart', eggs: 1e12, prod: 0.005, depth: 0, verb: 'brings' },
    // Borers at Depth 3, Delvers at Depth 5 (spec 2 / 4; review C1: the player's converted Ore broke into both at once)
    { id: 'borer', name: 'Tunnel Borers', one: 'Tunnel Borer', eggs: 1e20, prod: 0.002, depth: 3, verb: 'brings' },
    { id: 'delver', name: 'Deep Delvers', one: 'Deep Delver', eggs: 1e28, prod: 0.0005, depth: 5, verb: 'brings' }
  ];
  function f2(x) { return String(Math.round(x * 100) / 100); }
  // each level is one deliberate press (no hold). cost(lv) = base x grow^lv Ore for the level after lv.
  // first levels as SPEC-MINES B2 (60 / 150 / 500 Ore), but pans and sieve grow x5 and chute x6 per level (spec x4 / x4
  // / x5); rails x4, anvil x5, seam / night / frenzy x3, heart x100 the spec price (B12 tuning, see glowK)
  // now(lv) = the effect at level lv in a few words (the UI shows now -> next)
  var FORGE = [
    { id: 'pans', name: 'Gilded Pans', max: 10, base: 60, grow: 5, now: function (l) { return 'Coins ×' + f2(1 + 0.15 * l); },
      text: function (l) { return 'Coins and strokes ×' + f2(1 + 0.15 * l); } },
    { id: 'sieve', name: 'Nugget Sieve', max: 5, base: 150, grow: 5, now: function (l) { return 'Nuggets ×' + f2(1 + 0.5 * l); },
      text: function (l) { return 'Nugget Ore ×' + f2(1 + 0.5 * l); } },
    { id: 'chute', name: 'Spill Chute', max: 5, base: 500, grow: 6, now: function (l) { return 'Spill ×' + f2(1 + 0.1 * l); },
      text: function (l) { return 'Coins spill ×' + f2(1 + 0.1 * l); } },
    { id: 'rails', name: 'Iron Rails', max: 3, base: 2e4, grow: 20, now: function (l) { return 'Miners ×' + Math.pow(2, l); },
      text: function (l) { return 'Miners ×' + Math.pow(2, l); } },
    { id: 'anvil', name: 'Searing Anvil', max: 2, base: 1e5, grow: 10, now: function (l) { return 'Gust ×' + f2(1 + 0.5 * l); },
      text: function (l) { return 'Wing Gust gold ×' + f2(1 + 0.5 * l); } },
    { id: 'seam', name: 'Lucky Seam', max: 1, base: 3e5, grow: 1, now: function (l) { return l ? '60s of Ore' : 'Off'; },
      text: function () { return 'Each treasure also gives 60s of Ore'; } },
    { id: 'night', name: 'Night Shift', max: 1, base: 3e6, grow: 1, now: function (l) { return l ? 'Away ×2' : 'Off'; },
      text: function () { return 'Mines dig ×2 while you are away'; } },
    { id: 'frenzy', name: 'Fire Frenzy', max: 2, base: 3e6, grow: 10, now: function (l) { return 'Frenzy ×' + f2(1 + 0.25 * l); },
      text: function (l) { return 'Gold Frenzy ×' + f2(1 + 0.25 * l) + ' stronger'; } },
    { id: 'heart', name: 'Heart of the Forge', max: 1, base: 1e11, grow: 1, now: function (l) { return l ? 'Glow +25%' : 'Off'; },
      text: function () { return 'Forge glow +25%'; } },
    // never caps (review C1: the Forge ran out after one night): the long Ore sink next to Shaft Depth
    { id: 'stoke', name: 'Stoke the Forge', max: 300, endless: true, base: 1e9, grow: 10,
      now: function (l) { return 'Glow +' + (10 * l) + '%'; },
      text: function (l) { return 'Forge glow +' + (10 * l) + '% (never caps)'; } }
  ];
  var FIDX = {};
  FORGE.forEach(function (f, i) { FIDX[f.id] = i; });
  // Deep Chests: the 9 Deep cards in this order while some are unowned
  var CHEST_ORDER = ['ev_frostfang', 'ev_rimefeather', 'ev_krakenink', 'ev_drownedcompass', 'ev_glacierheart',
    'ev_abyssalpearl', 'ev_magmatalon', 'ev_cindercrown', 'ev_obsidianheart'];

  // ---------------------------------------------------------------- the chain helper (shared with later chains)
  // growthOf = the price growth per hire (a number, or a function read on every call so tuning can change it).
  //   cost(base, hired, n): price of the next n hires = base x g^hired x (g^n - 1) / (g - 1)
  //   maxFor(base, hired, budget, cap): the most hires the budget pays for
  //   advance(x, a, dt): exact solution of the chain over dt with constant per-unit rates, where x[0] is the currency,
  //     x[j] (j >= 1) the units of tier j-1 and a[j] what one of them makes per second of level j-1. Returns the gains
  //     per level: gained_j = sum_{k>j} x_k x a_(j+1) .. a_k x dt^(k-j) / (k-j)!  (same polynomial as the Brood)
  function makeChain(growthOf) {
    var gf = typeof growthOf === 'function' ? growthOf : function () { return growthOf; };
    function cost(base, hired, n) {
      var growth = gf();
      n = Math.floor(fin(n, 0));
      if (n < 1) return 0;
      var c = base * Math.pow(growth, hired) * (Math.pow(growth, n) - 1) / (growth - 1);
      return isFinite(c) ? Math.min(c, MAXN) : MAXN;
    }
    function maxFor(base, hired, budget, cap) {
      var growth = gf(), lg = Math.log(growth);
      budget = pos(budget);
      var first = base * Math.pow(growth, hired);
      if (!(first > 0) || !isFinite(first) || budget < first * (1 - 1e-12)) return 0;
      var n = Math.floor(Math.log(1 + budget * (growth - 1) / first) / lg + 1e-9);
      if (!isFinite(n)) n = cap;
      n = Math.max(0, Math.min(cap, n));
      while (n > 0 && cost(base, hired, n) > budget * (1 + 1e-12)) n--;
      while (n < cap && cost(base, hired, n + 1) <= budget * (1 + 1e-12)) n++;
      return n;
    }
    function advance(x, a, dt, out) {
      var L = x.length, g = out || [], j, k;
      g.length = 0;
      for (j = 0; j < L; j++) {
        var sum = 0, coef = 1, fact = 1;
        for (k = j + 1; k < L; k++) {
          coef *= pos(a[k]) * dt;
          fact *= (k - j);
          if (!(coef > 0)) break;
          sum += pos(x[k]) * coef / fact;
        }
        g.push(isFinite(sum) ? Math.min(MAXN, sum) : MAXN);
      }
      return g;
    }
    return { cost: cost, maxFor: maxFor, advance: advance };
  }
  var CH = makeChain(function () { return C.hireGrowth; });

  // ---------------------------------------------------------------- Deep cards (the 9 former event-lair cards)
  // ids, rarity and powers unchanged so every copy the player owns keeps working. chest:false = never in normal chests.
  function f1(x) { var s = (Math.round(x * 100) / 100).toFixed(2); return s.replace(/0+$/, '').replace(/\.$/, ''); }
  function L1(lv) { return Math.max(1, lv); }
  function rimeCd(lv) { return Math.max(0.6, 1 - 0.05 * lv); }
  var DEEP_CARDS = [
    { id: 'ev_obsidianheart', group: 'volcano', name: 'Obsidian Heart', rarity: 'legendary',
      flavor: 'Still warm after a thousand years.',
      describe: function (lv) { return 'All gold ×' + f1(1 + 0.2 * L1(lv)) + '.'; },
      mod: function (s, M, lv) { M.gpsMult *= 1 + 0.2 * lv; M.coinFlat *= 1 + 0.2 * lv; } },
    { id: 'ev_magmatalon', group: 'volcano', name: 'Magma Talon', rarity: 'epic',
      flavor: 'It drips, but never runs dry.',
      describe: function (lv) { return 'Coins and strokes are worth ×' + f1(1 + 0.15 * L1(lv)) + '.'; },
      mod: function (s, M, lv) { M.coinMult *= 1 + 0.15 * lv; } },
    { id: 'ev_cindercrown', group: 'volcano', name: 'Cinder Crown', rarity: 'epic',
      flavor: 'The imps crowned their first king with it. He did not last.',
      describe: function (lv) { return 'Gold Frenzy lasts +' + (4 * L1(lv)) + 's and is ×' + f1(1 + 0.1 * L1(lv)) + ' stronger.'; },
      mod: function (s, M, lv) { M.frenzyDurAdd += 4 * lv; M.frenzyMult *= 1 + 0.1 * lv; } },
    { id: 'ev_glacierheart', group: 'frost', name: 'Heart of the Glacier', rarity: 'legendary',
      flavor: 'Time moves slower near it. So does everything else.',
      describe: function (lv) { return 'Gold while away ×' + f1(1 + 0.25 * L1(lv)) + ', away cap +' + L1(lv) + 'h.'; },
      mod: function (s, M, lv) { M.offlineMult *= 1 + 0.25 * lv; M.offlineCapAddH += lv; } },
    { id: 'ev_frostfang', group: 'frost', name: 'Frostbite Fang', rarity: 'epic',
      flavor: 'Pulled from a troll that bit the wrong dragon.',
      describe: function (lv) { return 'Building gold/s ×' + f1(1 + 0.3 * L1(lv)) + '.'; },
      mod: function (s, M, lv) { M.gpsMult *= 1 + 0.3 * lv; } },
    { id: 'ev_rimefeather', group: 'frost', name: 'Rime Feather', rarity: 'epic',
      flavor: 'Shed by a wyvern that flew above the weather.',
      describe: function (lv) { var l = L1(lv); return 'Wing Gust recharges ' + Math.round(100 * (1 - rimeCd(l))) + '% faster and gathers ×' + f1(1 + 0.25 * l) + ' gold.'; },
      mod: function (s, M, lv) { M.gustCdMult *= rimeCd(lv); M.gustMult *= 1 + 0.25 * lv; } },
    { id: 'ev_abyssalpearl', group: 'sea', name: 'Abyssal Pearl', rarity: 'legendary',
      flavor: 'Black as the trench it came from, and it hums.',
      describe: function (lv) { return 'Legend from each Long Sleep +' + (10 * L1(lv)) + '%.'; },
      mod: function (s, M, lv) { M.legendGainMult *= 1 + 0.1 * lv; } },
    { id: 'ev_krakenink', group: 'sea', name: 'Kraken Ink', rarity: 'epic',
      flavor: 'Write a name in it and the sea remembers.',
      describe: function (lv) { return 'All brood production ×' + f1(1 + 0.3 * L1(lv)) + '.'; },
      mod: function (s, M, lv) { for (var i = 1; i < 5; i++) M.tierMult[i] *= 1 + 0.3 * lv; } },
    { id: 'ev_drownedcompass', group: 'sea', name: 'Drowned Compass', rarity: 'epic',
      flavor: 'It no longer points north. It points to treasure.',
      describe: function (lv) { return 'Gleaming treasures appear ' + (10 * L1(lv)) + '% more often.'; },
      mod: function (s, M, lv) { M.treasureFreq *= 1 + 0.1 * lv; } }
  ];
  DEEP_CARDS.forEach(function (c) { c.chest = false; c.event = true; c.deep = true; });
  E.registerCards(DEEP_CARDS);

  // ---------------------------------------------------------------- state subtree (SPEC-MINES B3)
  function defaults() {
    return { open: false, openAt: 0, ore: 0, all: 0, peak: 0, units: [0, 0, 0, 0], hired: [0, 0, 0, 0],
      forge: {}, depth: 0, hearth: 1, chestN: 0, lastTithe: [0, 0, 0, 0], nug: 0, offline: 0 };
  }
  function arr4(a, intOnly) {
    a = Array.isArray(a) ? a : [];
    var o = [];
    for (var i = 0; i < 4; i++) o.push(intOnly ? int(a[i]) : pos(a[i]));
    return o;
  }
  function cleanForge(f) {
    var o = {};
    if (!isObj(f)) return o;
    for (var i = 0; i < FORGE.length; i++) {
      var d = FORGE[i], l = Math.min(d.max, int(f[d.id]));
      if (l > 0) o[d.id] = l;
    }
    return o;
  }
  function sanitize(saved, def) {
    var o = def || defaults();
    if (!isObj(saved)) return o;
    for (var k in saved) { // forward compatible: keep unknown JSON-safe keys
      if (!Object.prototype.hasOwnProperty.call(saved, k) || Object.prototype.hasOwnProperty.call(o, k)) continue;
      var j = U.jsonSafe ? U.jsonSafe(saved[k]) : undefined;
      if (j !== undefined) o[k] = j;
    }
    o.open = saved.open === true;
    o.openAt = pos(saved.openAt);
    o.ore = pos(saved.ore);
    o.all = pos(saved.all);
    o.peak = Math.max(pos(saved.peak), o.all);
    o.units = arr4(saved.units, false);
    o.hired = arr4(saved.hired, true);
    o.lastTithe = arr4(saved.lastTithe, true);
    o.forge = cleanForge(saved.forge);
    o.depth = Math.min(C.depthMax, int(saved.depth));
    var h = fin(saved.hearth, 1);
    o.hearth = h < 1 ? 1 : (h > 1e12 ? 1e12 : h);
    o.chestN = int(saved.chestN);
    o.nug = pos(saved.nug);
    o.offline = pos(saved.offline);
    return o;
  }
  E.addStateDefaults('mines', defaults, sanitize);

  // live states can be hand-made (tests, hot reload): repair the subtree in place, cheaply
  function sub(s) {
    if (!s || typeof s !== 'object') return null;
    var m = s.mines;
    if (!isObj(m)) { m = s.mines = defaults(); return m; }
    // no allocation on the per-tick path (code review #11)
    if (!Array.isArray(m.units) || m.units.length !== 4) m.units = arr4(m.units, false);
    if (!Array.isArray(m.hired) || m.hired.length !== 4) m.hired = arr4(m.hired, true);
    if (!Array.isArray(m.lastTithe) || m.lastTithe.length !== 4) m.lastTithe = arr4(m.lastTithe, true);
    if (!isObj(m.forge)) m.forge = {};
    return m;
  }
  function peek(s) { return (s && isObj(s.mines)) ? s.mines : null; }

  // ---------------------------------------------------------------- pure rules
  function callDeep(s) { return !!(s && isObj(s.lore) && fin(s.lore.wake_ember, 0) >= 1); }
  function isOpen(s) { var m = peek(s); return !!(m && m.open === true); }
  function forgeLv(m, id) { return (m && isObj(m.forge) && FIDX.hasOwnProperty(id)) ? Math.min(FORGE[FIDX[id]].max, int(m.forge[id])) : 0; }
  function depthOf(m) { return m ? Math.min(C.depthMax, int(m.depth)) : 0; }
  function tierOpen(s, k) { var t = TIERS[k], m = peek(s); return !!(t && m && m.open && depthOf(m) >= t.depth); }
  // glow = 1 + glowK x (Heart ? 1.25 : 1) x (1 + 0.1 x Stoke) x log10(1 + lifetime Ore)^2
  function glowFor(all, heart, stoke) {
    var Lg = log10(1 + pos(all));
    var g = 1 + C.glowK * (heart ? C.heartMult : 1) * (1 + 0.1 * int(stoke)) * Math.pow(Lg, C.glowExp);
    return isFinite(g) && g >= 1 ? Math.min(g, 1e12) : 1;
  }
  function glow(s) { var m = peek(s); return (m && m.open) ? glowFor(m.all, forgeLv(m, 'heart') > 0, forgeLv(m, 'stoke')) : 1; }
  function depthMult(d) { var v = Math.pow(C.depthMul, Math.max(0, Math.floor(fin(d, 0)))); return isFinite(v) ? Math.min(v, 1e100) : 1e100; }
  function hearth(s) { var m = peek(s); var h = m ? fin(m.hearth, 1) : 1; return h > 1 ? Math.min(h, 1e12) : 1; }
  // what one unit of tier k makes per second (k = 0: Ore; k >= 1: units of tier k-1), before Night Shift.
  // A tier the Shaft is not deep enough for makes nothing.
  function unitEach(s, k) {
    var t = TIERS[k], m = peek(s);
    if (!t || !m) return 0;
    var r = t.prod * Math.pow(2, forgeLv(m, 'rails')) * depthMult(depthOf(m));
    if (s && isObj(s.relics) && fin(s.relics.r_ember, 0) >= 1) r *= C.relicMult;
    return pos(r);
  }
  function unitTotal(s, k) { var m = peek(s); return (m && m.open && tierOpen(s, k)) ? cl(pos(m.units[k]) * unitEach(s, k)) : 0; }
  // Ore per second the crews dig right now (live, not counting the chain's growth or nuggets)
  function oreRate(s) { return unitTotal(s, 0); }
  function nugValue(s) {
    var m = peek(s);
    if (!m || !m.open) return 0;
    return cl(Math.max(C.nugMin, C.nugSec * oreRate(s)) * (1 + 0.5 * forgeLv(m, 'sieve')));
  }

  // ---------------------------------------------------------------- mod source: glow x Hearth + the Forge
  E.addModSource('mines', function (s, M) {
    var m = peek(s);
    if (!m) return;
    var h = hearth(s);
    var w = h * glow(s);
    if (w > 1) { M.gpsMult *= w; M.coinFlat *= w; }
    if (!m.open) return;
    var v;
    // stroke worth follows coin worth, so coinMult lifts strokes too (a strokeMult would square it)
    if ((v = forgeLv(m, 'pans'))) M.coinMult *= 1 + 0.15 * v;
    if ((v = forgeLv(m, 'chute'))) M.spillMult *= 1 + 0.1 * v;
    if ((v = forgeLv(m, 'anvil'))) M.gustMult *= 1 + 0.5 * v;
    if ((v = forgeLv(m, 'frenzy'))) M.frenzyMult *= 1 + 0.25 * v;
  });

  // ---------------------------------------------------------------- Ore: digging, Deep Chests
  function chestAt(n) { return Math.pow(10, C.chestBase10 + n); }
  function chestCard(s, n) {
    var cards = isObj(s.cards) ? s.cards : {};
    for (var i = 0; i < CHEST_ORDER.length; i++) if (!(fin(cards[CHEST_ORDER[i]], 0) >= 1)) return CHEST_ORDER[i];
    // all 9 owned: deterministic roll on the chest number, 80% epic / 20% legendary
    var h = U.hash32 ? U.hash32(n, 4241) : 0.5, h2 = U.hash32 ? U.hash32(n, 4243) : 0.5;
    var want = h < 0.8 ? 'epic' : 'legendary';
    var pool = DEEP_CARDS.filter(function (c) { return c.rarity === want; });
    return pool[Math.min(pool.length - 1, Math.floor(h2 * pool.length))].id;
  }
  function checkChests(s, m) {
    var guard = 0;
    while (guard++ < 60 && int(m.chestN) < C.depthMax && pos(m.peak) >= chestAt(int(m.chestN)) * (1 - 1e-12)) {
      var n = int(m.chestN), id = chestCard(s, n);
      m.chestN = n + 1;
      if (E.grantCard(s, id, 1)) emit('mines', { type: 'chest', card: id, n: n + 1, at: chestAt(n) }, s);
    }
  }
  // Ore the player dug (crews, nuggets, Lucky Seam): spendable Ore and lifetime Ore (the glow) both rise
  function addOre(s, m, n) {
    n = pos(n);
    if (!(n > 0)) return 0;
    m.ore = cl(pos(m.ore) + n);
    m.all = cl(pos(m.all) + n);
    if (m.all > pos(m.peak)) m.peak = m.all;
    checkChests(s, m);
    return n;
  }
  var AX = [0, 0, 0, 0, 0], AA = [0, 0, 0, 0, 0], AG = [];   // reused by advance() (no allocation per tick)
  // one step of the chain: exact over dt (the Brood's polynomial with level 0 = Ore). Locked tiers make nothing.
  function advance(s, dt, offline) {
    var m = sub(s);
    if (!m || !m.open || !(dt > 0)) return 0;
    var x = AX, a = AA;
    x[0] = pos(m.ore); a[0] = 0;
    for (var k = 0; k < 4; k++) { x[k + 1] = pos(m.units[k]); a[k + 1] = tierOpen(s, k) ? unitEach(s, k) : 0; }
    var g = CH.advance(x, a, dt, AG);
    for (k = 0; k < 3; k++) if (g[k + 1] > 0) m.units[k] = cl(pos(m.units[k]) + g[k + 1]);
    var ore = g[0];
    if (offline && forgeLv(m, 'night') > 0) ore *= C.nightMult;
    if (!(ore > 0)) return 0;
    addOre(s, m, ore);
    if (offline) {
      m.offline = cl(pos(m.offline) + ore);
      s._minesOffline = cl(pos(s._minesOffline) + ore);   // not saved: the UI tells the player once
    }
    return ore;
  }

  // ---------------------------------------------------------------- opening, digging, Sleep, Ascend
  function open(s) {
    var m = sub(s);
    if (!m || m.open) return false;
    m.open = true;
    m.openAt = pos(s.time);
    for (var k = 0; k < 4; k++) m.units[k] = cl(pos(m.units[k]) + C.gift[k]);
    E.dirty();
    emit('mines', { type: 'open' }, s);
    return true;
  }
  E.addTickHook('mines', function (s, dt, isOffline) {
    if (!isObj(s.mines)) sub(s);
    if (!isOpen(s)) {
      if (!(fin(s.rank, 1) >= C.openRank || callDeep(s)) || !open(s)) return;
      if (isOffline || quiet()) s._minesOpenedAway = true;   // not saved: the welcome-back sheet says so (no toast then)
    }
    advance(s, pos(dt), !!isOffline);
    if (isOffline) s._minesOfflineSec = cl(pos(s._minesOfflineSec) + pos(dt));
  });

  // ---- hiring (Eggs). hired[k] counts the hires (the price); units[k] also holds what the chain made (free).
  function hireCost(s, k, n) {
    var t = TIERS[k], m = peek(s);
    if (!t || !m) return 0;
    if (n === 'max') n = Math.max(1, hireMax(s, k));
    n = Math.max(1, Math.min(C.maxBuy, Math.floor(fin(n, 1))));
    return CH.cost(t.eggs, int(m.hired[k]), n);
  }
  function hireMax(s, k, eggs) {
    var t = TIERS[k], m = peek(s);
    if (!t || !m || !tierOpen(s, k)) return 0;
    var b = eggs === undefined || eggs === null ? pos(s.tiers && s.tiers[0]) : pos(eggs);
    return CH.maxFor(t.eggs, int(m.hired[k]), b, C.maxBuy);
  }
  function hireFree(m, k, n) { // the units arrive; the price of the next hire rises
    m.units[k] = cl(pos(m.units[k]) + n);
    m.hired[k] = int(m.hired[k]) + n;
  }
  function hire(s, k, n) {
    var m = sub(s);
    if (!m || !m.open || !TIERS[k] || !tierOpen(s, k) || !s || !Array.isArray(s.tiers)) return false;
    if (n === 'max') { n = hireMax(s, k); if (n < 1) return false; }
    n = Math.max(1, Math.min(C.maxBuy, Math.floor(fin(n, 1))));
    var c = CH.cost(TIERS[k].eggs, int(m.hired[k]), n);
    if (!(c > 0) || c > pos(s.tiers[0]) * (1 + 1e-12) + 1e-9) return false;
    s.tiers[0] = pos(pos(s.tiers[0]) - c);
    hireFree(m, k, n);
    E.dirty();
    emit('buy', { kind: 'miner', id: k, n: n, auto: E.inAuto ? E.inAuto() : false }, s);
    return true;
  }
  // the tithe: what `eggs` recruit at a Long Sleep (pure; never touches the run's Eggs). Each open tier on its own:
  // 1 recruit at its first-hire price, +1 per x1000 above it, at most titheCap.
  function titheOne(k, eggs) {
    var t = TIERS[k], e = pos(eggs);
    if (!t || !(e >= t.eggs * (1 - 1e-12))) return 0;
    var n = 1 + Math.floor(log10(e / t.eggs) / C.titheStep + 1e-9);
    return Math.max(0, Math.min(C.titheCap, isFinite(n) ? n : C.titheCap));
  }
  function titheFor(s, eggs) {
    var m = peek(s), out = [0, 0, 0, 0];
    if (!m || !m.open) return { n: out };
    for (var k = 0; k < 4; k++) if (tierOpen(s, k)) out[k] = titheOne(k, eggs);
    return { n: out };
  }
  function tithePreview(s) { return titheFor(s, s && s.tiers ? s.tiers[0] : 0).n; }
  // the Eggs the next tithe step needs: { k, n, eggs } for the cheapest tier that would recruit one more, or null
  function titheNext(s, eggs) {
    var best = null;
    for (var k = 0; k < 4; k++) {
      if (!tierOpen(s, k)) continue;
      var have = titheOne(k, eggs);
      if (have >= C.titheCap) continue;
      var need = TIERS[k].eggs * Math.pow(10, C.titheStep * have);
      if (!best || need < best.eggs) best = { k: k, n: have + 1, eggs: need };
    }
    return best;
  }

  // Long Sleep: the run's leftover Eggs (the snapshot taken before the reset) recruit miners. The Mines themselves are
  // never reset by a Long Sleep. An Ascend keeps a quarter of Ore, lifetime Ore and miners; the Forge, Depth, Hearth,
  // the open shaft, the most Ore ever dug and Deep Chest progress stay in full. Ore banked while the Mines are still
  // shut (the event-lair token) is not cut (code review #5).
  E.addSleepHook('mines', function (s, prev, reason) {
    var m = sub(s);
    if (!m) return;
    if (reason === 'ascend') {
      if (!m.open) return;
      var q = C.ascendKeep;
      m.ore = Math.floor(pos(m.ore) * q);
      m.all = Math.floor(pos(m.all) * q);
      for (var k = 0; k < 4; k++) { m.units[k] = Math.floor(pos(m.units[k]) * q); m.hired[k] = Math.floor(int(m.hired[k]) * q); }
      E.dirty();
      return;
    }
    if (reason !== 'sleep' || !m.open) return;
    var eggs = prev && Array.isArray(prev.tiers) ? pos(prev.tiers[0]) : 0;
    var t = titheFor(s, eggs);
    for (var j = 0; j < 4; j++) if (t.n[j] > 0) m.units[j] = cl(pos(m.units[j]) + t.n[j]);   // recruits: the hire price stays
    m.lastTithe = t.n.slice();
    E.dirty();
    emit('mines', { type: 'tithe', n: t.n.slice(), eggs: Math.round(eggs) }, s);
  });

  // ---- Ore as a currency: the Forge, Shaft Depth (and Sky Lanterns in js/sky.js)
  function spendOre(s, n) {
    var m = sub(s);
    n = pos(n);
    if (!m || !m.open || !(n > 0) || pos(m.ore) + 1e-9 < n) return false;
    m.ore = pos(pos(m.ore) - n); // spending never lowers lifetime Ore (the glow)
    E.dirty();
    return true;
  }
  function forgeCost(s, id) {
    var i = FIDX.hasOwnProperty(id) ? FIDX[id] : -1;
    if (i < 0) return 0;
    var f = FORGE[i], l = forgeLv(peek(s), id);
    if (l >= f.max) return 0;
    return cl(f.base * Math.pow(f.grow, l));
  }
  function forge(s, id) {
    var m = sub(s);
    if (!m || !m.open || !FIDX.hasOwnProperty(id)) return false;
    var f = FORGE[FIDX[id]], l = forgeLv(m, id);
    if (l >= f.max) return false;
    if (!spendOre(s, forgeCost(s, id))) return false;
    m.forge[id] = l + 1;
    E.dirty();
    emit('mines', { type: 'forge', id: id, lv: l + 1 }, s);
    return true;
  }
  function forgeList(s) {
    var m = peek(s), ore = m ? pos(m.ore) : 0;
    return FORGE.map(function (f) {
      var l = forgeLv(m, f.id), done = l >= f.max, c = done ? 0 : cl(f.base * Math.pow(f.grow, l));
      return { id: f.id, name: f.name, lv: l, max: f.max, endless: !!f.endless, done: done, cost: c, can: !!(m && m.open) && !done && ore + 1e-9 >= c,
        text: f.text(Math.max(1, l)), now: f.now(l), next: done ? '' : f.now(l + 1) };
    });
  }
  function depthCost(s) {
    var d = depthOf(peek(s));
    return d >= C.depthMax ? 0 : cl(C.depthBase * Math.pow(C.depthGrowth, d));
  }
  function dig(s) {
    var m = sub(s);
    if (!m || !m.open || depthOf(m) >= C.depthMax) return false;
    if (!spendOre(s, depthCost(s))) return false;
    m.depth = depthOf(m) + 1;
    E.dirty();
    var opened = null;
    for (var k = 0; k < 4; k++) if (TIERS[k].depth === m.depth) opened = k;
    emit('mines', { type: 'depth', d: m.depth, opens: opened }, s);
    return true;
  }
  // ---- swiping: Ore nuggets (cave) and Lucky Seam (treasures)
  function nuggets(s, k) {
    var m = sub(s);
    k = pos(k);
    if (!m || !m.open || !(k > 0)) return 0;
    var v = addOre(s, m, k * nugValue(s));
    m.nug = cl(pos(m.nug) + k);
    if (isObj(s.run)) s.run.nug = cl(pos(s.run.nug) + k);
    if (isObj(s.stat)) s.stat.nug = cl(pos(s.stat.nug) + k);
    E.dirty();
    return v;
  }
  E.on('treasure', function (res, s) {
    var m = peek(s);
    if (!m || !m.open || forgeLv(m, 'seam') < 1) return;
    var v = addOre(s, sub(s), C.seamSec * oreRate(s));
    if (!(v > 0)) return;
    E.dirty();
    if (res && typeof res === 'object') { res.ore = v; if (typeof res.text === 'string') res.text += ' +' + fmt(v) + ' Ore.'; }
  });

  // ---------------------------------------------------------------- quests (E.addMissionTemplate; group 'mines')
  function niceUp(x) {
    x = Math.max(1, fin(x, 1));
    if (x < 20) return Math.ceil(x);
    var e = Math.pow(10, Math.floor(log10(x)) - 1);
    return cl(Math.ceil(x / e * (1 - 1e-12)) * e);
  }
  var DC = (HOARD.data && HOARD.data.C) || {};
  // the Egg budget a 'hire' quest is sized for: Eggs now + T seconds of Eggs hatched and of gold put into Eggs
  function hireBudget(s, st, T) {
    var eggGold = 0;
    try { eggGold = pos(E.tierCost(s, 0, 1).gold); } catch (e) { eggGold = 0; }
    var rate = pos(st.baseGps) + 3 * pos(st.coinWorth) + pos(st.sweepGps);
    var eggRate = st.tierRates ? pos(st.tierRates[0]) : 0;
    return pos(pos(s.tiers[0]) + T * (eggRate + (eggGold > 0 ? 0.5 * rate / eggGold : 0)));
  }
  function hirePick(s, budget) {
    for (var k = 3; k >= 0; k--) {
      if (!tierOpen(s, k)) continue;
      var n = hireMax(s, k, budget);
      if (n >= 1) return { k: k, n: Math.min(5, n) };
    }
    return null;
  }
  function questT(s, roll) {
    var r = Math.floor(fin(s.rank, 1));
    return (fin(DC.missionTimeBase, 240) + fin(DC.missionTimePerRank, 80) * (r - 1)) * roll;
  }
  // minRank 3 (spec B7 said 7): the Mines stay open across Sleeps, and Dream Keeper sleeps this player at rank 4-5
  // (playtest review M5: at 5 the quests never reached the slots)
  var QUEST_RANK = 3;
  if (typeof E.addMissionTemplate === 'function') {
    E.addMissionTemplate({
      tpl: 'ore', minRank: QUEST_RANK, weight: 1, act: true, group: 'mines', text: 'Dig {n} Ore',
      offer: function (s) { return isOpen(s) && oreRate(s) >= 1; },
      make: function (s, mi, ctx) {
        var m = peek(s), st = ctx.st;
        var per = oreRate(s) + pos(st.spillRate) * fin(DC.missionCoinShare, 0.6) / C.nugEvery * nugValue(s);
        mi.key = null;
        mi.base = m ? pos(m.all) : 0;
        // half the activity time: nuggets only come while swiping, and Mines quests sit at rank 5+ where late runs
        // are a few minutes long (quest-balance.cjs rule (b) held the slow tail to <= 3 min only this way)
        mi.target = niceUp(Math.max(30, C.oreQuestShare * ctx.Ta * per));
      },
      cur: function (s, mi) { var m = peek(s); return m ? pos(pos(m.all) - pos(mi.base)) : 0; },
      title: function (mi) { return 'Dig ' + fmt(mi.target) + ' Ore'; }
    });
    E.addMissionTemplate({
      tpl: 'hire', minRank: QUEST_RANK, weight: 2, group: 'mines', text: 'Hire {n} {name}',
      // not offered when the Eggs already in the nest pay for it (a quest done by one press is no goal; review M5)
      offer: function (s, st) {
        if (!isOpen(s)) return false;
        var p = hirePick(s, hireBudget(s, st, questT(s, 0.75)));
        return !!p && hireMax(s, p.k) < p.n;
      },
      make: function (s, mi, ctx) {
        var m = peek(s), p = hirePick(s, hireBudget(s, ctx.st, ctx.T)) || { k: 0, n: 1 };
        var h = m ? int(m.hired[p.k]) : 0;
        mi.key = p.k;
        mi.base = h;
        mi.target = h + p.n;
      },
      cur: function (s, mi) { var m = peek(s), k = Math.floor(fin(mi.key, 0)); return m && TIERS[k] ? int(m.hired[k]) : 0; },
      title: function (mi) {
        var k = Math.floor(fin(mi.key, 0)), t = TIERS[k] || TIERS[0], n = Math.max(1, Math.round(pos(mi.target) - pos(mi.base)));
        return 'Hire ' + fmt(n) + ' ' + (n === 1 ? t.one : t.name);
      }
    });
  }

  // ================================================================ one-time save conversions (E.addLoadHook)
  function setFlag(o, k) { if (!isObj(o.flags)) o.flags = {}; o.flags[k] = 1; }
  function flagged(o, k) { return isObj(o.flags) && fin(o.flags[k], 0) >= 1; }

  // ---- T1: Ember -> Mines. Embers become Ore (1 per 5), lifetime embers freeze into Ember's Hearth (the old warmth),
  // Breaths become Forge levels, kilns become Pick Crews digging the same amount of Ore per second as the kilns made
  // embers (after the 5:1 rate).
  var KILN_BASE = [0.1, 0.8, 7, 65];
  var BREATH_FORGE = { molten: ['pans', 7], fanned: ['sieve', 4], searing: ['anvil', 2], etreas: ['seam', 1],
    smoulder: ['night', 1], ffrenzy: ['frenzy', 2], heart: ['heart', 1] };
  function kilnMilestones(n) {
    var c = 0, ms = [25, 50, 100, 150, 200];
    for (var i = 0; i < ms.length; i++) if (n >= ms[i]) c++;
    if (n >= 300) c += Math.floor((n - 200) / 100);
    return c;
  }
  function hearthFor(earned, heart) {
    var h = 1 + 0.15 * (heart ? 1.25 : 1) * Math.pow(log10(1 + pos(earned)), 1.6);
    return isFinite(h) ? Math.max(1, Math.min(1e12, h)) : 1;
  }
  function convertEmber(raw, o) {
    if (flagged(o, 'minesConv')) return;
    var em = raw && raw.ember;
    if (!isObj(em) || em.awake !== true) { setFlag(o, 'minesConv'); return; }
    var m = sub(o);
    var br = isObj(em.breaths) ? em.breaths : {};
    function has(id) { return br[id] === true; }
    m.open = true;
    m.openAt = pos(o.time);
    m.hearth = hearthFor(em.earned, has('heart'));
    var ore = Math.floor(pos(em.embers) / C.emberOreDiv);
    m.ore = cl(pos(m.ore) + ore);                         // not lifetime Ore: the glow starts at x1.00
    var rails = (has('kindle') ? 1 : 0) + (has('wildfire') ? 2 : 0);
    if (rails) m.forge.rails = Math.max(forgeLv(m, 'rails'), rails);
    for (var b in BREATH_FORGE) if (has(b)) m.forge[BREATH_FORGE[b][0]] = Math.max(forgeLv(m, BREATH_FORGE[b][0]), BREATH_FORGE[b][1]);
    m.forge = cleanForge(m.forge);                        // canonical order (FORGE), capped levels
    var relic = isObj(o.relics) && fin(o.relics.r_ember, 0) >= 1;
    var ks = Array.isArray(em.kilns) ? em.kilns : [];
    var oldRate = 0;
    for (var k = 0; k < 4; k++) { var n = Math.min(1e6, int(ks[k])); oldRate += n * KILN_BASE[k] * Math.pow(2, kilnMilestones(n)); }
    oldRate *= (has('kindle') ? 2 : 1) * (has('wildfire') ? 3 : 1) * (relic ? 3 : 1);
    var crewEach = 0.1 * Math.pow(2, forgeLv(m, 'rails')) * (relic ? C.relicMult : 1);
    var crews = Math.round(pos(oldRate) / C.emberOreDiv / crewEach);
    m.units[0] = cl(pos(m.units[0]) + crews);
    setFlag(o, 'minesConv');
    var info = { type: 'conv', ore: ore, hearth: Math.round(m.hearth * 1e4) / 1e4, crews: crews, forge: JSON.parse(JSON.stringify(m.forge)) };
    o._minesConv = info;   // not saved: ui-mines toasts it and writes it to the play log once (no emit here: a save is
                           // often deserialized twice on boot, code review #7)
  }

  // ---- T2: event lairs retired. Unopened chests and a finished-but-unclaimed step pay out their cards, every quest
  // step claimed is worth 500 Ore (banked even while the Mines are closed). Owned event cards are untouched.
  var EV_POOL = {
    volcano: ['ev_obsidianheart', 'ev_magmatalon', 'ev_cindercrown'],
    frost: ['ev_glacierheart', 'ev_frostfang', 'ev_rimefeather'],
    sea: ['ev_abyssalpearl', 'ev_krakenink', 'ev_drownedcompass']
  };
  var EV_QUESTS = [
    { kind: 'own', k: 0, n: 10, cards: 1 }, { kind: 'coins', n: 150, cards: 1 }, { kind: 'own', k: 1, n: 1, cards: 1, card: 1 },
    { kind: 'earn', n: 1e5, cards: 1 }, { kind: 'own', k: 2, n: 1, cards: 1, card: 2 }, { kind: 'own', k: 3, n: 1, cards: 1 },
    { kind: 'coins', n: 2000, cards: 1 }, { kind: 'earn', n: 5e10, cards: 1 }, { kind: 'earn', n: 5e11, cards: 1 },
    { kind: 'earn', n: 3e12, cards: 3, all: true }
  ];
  function poolRoll(pool, seed) {
    // rarity-weighted (legendary 1 : epic 3), deterministic so a reload converts the same way
    var w = [1, 3, 3], r = (U.hash32 ? U.hash32(seed, 7741) : 0.5) * 7;
    for (var i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function stepCards(pool, q, n, seed) {
    var out = [];
    if (q && q.all) out = pool.slice(0, n);
    else if (q && q.card !== undefined) out.push(pool[q.card] || pool[0]);
    while (out.length < n) out.push(poolRoll(pool, seed + out.length * 31));
    return out;
  }
  function convertEvents(raw, o) {
    if (flagged(o, 'eventsConv')) return;
    var ev = raw && raw.events;
    if (!isObj(ev)) { setFlag(o, 'eventsConv'); return; }
    var pool = EV_POOL[ev.lair] || null;
    var q = Math.max(0, Math.min(EV_QUESTS.length, int(ev.q)));
    var got = [];
    if (pool) {
      var chests = Math.min(50, int(ev.chests)), cc = Array.isArray(ev.chestCards) ? ev.chestCards : [];
      for (var i = 0; i < chests; i++) {
        var step = EV_QUESTS[Math.max(0, Math.min(EV_QUESTS.length - 1, q - chests + i))];
        var n = Math.max(1, Math.min(5, int(cc[i]) || 1));
        got = got.concat(stepCards(pool, step, n, i * 101 + q));
      }
      var cur = EV_QUESTS[q];
      if (cur) {
        var u = Array.isArray(ev.units) ? ev.units : [];
        var met = cur.kind === 'own' ? pos(u[cur.k]) >= cur.n : cur.kind === 'earn' ? pos(ev.earned) >= cur.n : pos(ev.coins) >= cur.n;
        if (met) got = got.concat(stepCards(pool, cur, cur.cards, 977 + q));
      }
    }
    if (!isObj(o.cards)) o.cards = {};
    got.forEach(function (id) { if (id) o.cards[id] = Math.floor(pos(o.cards[id])) + 1; });
    var m = sub(o);
    m.ore = cl(pos(m.ore) + C.evOrePerStep * q);
    setFlag(o, 'eventsConv');
    if (fin(ev.firstStart, 0) > 0) o._eventsClosed = { q: q, ore: C.evOrePerStep * q, cards: got };   // not saved: one toast
  }
  if (typeof E.addLoadHook === 'function') {
    E.addLoadHook('mines', convertEmber);
    E.addLoadHook('events-retire', convertEvents);
  }

  // ================================================================ API
  function takeOffline(s) {
    if (!s) return null;
    var o = pos(s._minesOffline), sec = pos(s._minesOfflineSec);
    delete s._minesOffline; delete s._minesOfflineSec;
    return o > 0 ? { ore: o, sec: sec } : null;
  }
  HOARD.mines = {
    C: C, TIERS: TIERS, FORGE: FORGE, DEEP_CARDS: DEEP_CARDS, CHEST_ORDER: CHEST_ORDER,
    chain: makeChain,
    // state and rates
    isOpen: isOpen,
    visible: function (s) { return isOpen(s) || callDeep(s); },
    open: open,
    ore: function (s) { var m = peek(s); return m ? pos(m.ore) : 0; },
    all: function (s) { var m = peek(s); return m ? pos(m.all) : 0; },
    units: function (s, k) { var m = peek(s); return m ? pos(m.units[k]) : 0; },
    hired: function (s, k) { var m = peek(s); return m ? int(m.hired[k]) : 0; },
    depth: function (s) { return depthOf(peek(s)); },
    oreRate: oreRate,
    unitEach: unitEach,
    unitTotal: unitTotal,
    glow: glow, glowFor: glowFor, hearth: hearth, hearthFor: hearthFor,
    // hiring
    tierOpen: tierOpen,
    hireCost: hireCost,
    hireMax: hireMax,
    hire: hire,
    tithePreview: tithePreview,
    titheFor: function (s, eggs) { return titheFor(s, eggs).n; },
    titheNext: function (s, eggs) { return titheNext(s, eggs === undefined ? (s && s.tiers ? s.tiers[0] : 0) : eggs); },
    lastTithe: function (s) { var m = peek(s); return m && Array.isArray(m.lastTithe) ? m.lastTithe.slice() : [0, 0, 0, 0]; },
    // the Forge and Shaft Depth
    forgeLevel: function (s, id) { return forgeLv(peek(s), id); },
    forgeOwned: function (s) {
      var m = peek(s);
      return FORGE.filter(function (f) { return forgeLv(m, f.id) > 0; })
        .map(function (f) { var l = forgeLv(m, f.id); return { id: f.id, name: f.name, lv: l, max: f.max, text: f.text(l) }; });
    },
    forgeList: forgeList,
    forgeCost: forgeCost,
    forge: forge,
    depthCost: depthCost,
    dig: dig,
    depthMult: depthMult,
    // currency and cave
    spendOre: spendOre,
    nuggets: nuggets,
    nugValue: nugValue,
    advance: function (s, dt, offline) { return advance(s, pos(dt), !!offline); },
    nextChestAt: function (s) { var m = peek(s); return chestAt(m ? int(m.chestN) : 0); },
    chestN: function (s) { var m = peek(s); return m ? int(m.chestN) : 0; },
    // the tab's dot: a Forge level or a Lantern the Ore pays for. Depth and Stoke never cap, so they only light it
    // once they cost <= 25% of the Ore (code review #9: the dot stayed lit for good)
    affordable: function (s) {
      var m = peek(s);
      if (!m || !m.open) return false;
      var ore = pos(m.ore);
      for (var i = 0; i < FORGE.length; i++) {
        var f = FORGE[i], c = forgeCost(s, f.id);
        if (c > 0 && ore + 1e-9 >= (f.endless ? 4 * c : c)) return true;
      }
      var dc = depthCost(s);
      if (dc > 0 && ore + 1e-9 >= 4 * dc) return true;
      var K = HOARD.sky;
      if (K && typeof K.on === 'function' && K.on(s)) { var lc = K.lanternCost(s); if (lc > 0 && ore + 1e-9 >= lc) return true; }
      return false;
    },
    takeOffline: takeOffline,
    takeConversion: function (s) { var c = s && s._minesConv; if (s) delete s._minesConv; return c || null; },
    takeEventsClosed: function (s) { var c = s && s._eventsClosed; if (s) delete s._eventsClosed; return c || null; }
  };
})();
