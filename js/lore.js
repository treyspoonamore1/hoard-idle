/* Hoard — js/lore.js — Legend economy: Lore tree, automation, Myth (Ascend) and Relics. SPEC-V2 section 1.
 * Engine-side feature module. Node-safe: no DOM, no window. Codes against EXTENSIONS.md.
 *
 * State it owns (core maps created by the engine): state.lore {id: level}, state.relics {id: level},
 * state.auto { master, 'b:<building>', 't:<tier>', 'n:<node>', sleep, sleepPct }.
 * Public API: HOARD.lore (see the bottom of the file). */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var E = HOARD.engine, D = HOARD.data;
  if (!E || !D || typeof E.addModSource !== 'function') return;
  var U = E.util, fin = U.fin, pos = U.pos, cl = U.cl, isObj = U.isObj;
  var fmt = typeof HOARD.fmt === 'function' ? HOARD.fmt : function (n) { return String(Math.round(n)); };

  // ================================================================ content
  var BRANCHES = [
    { id: 'auto', name: 'Automation', text: 'Kept forever, even through a Myth.' },
    { id: 'start', name: 'Head start', text: 'Each run begins further ahead. Reset by a Myth.' },
    { id: 'power', name: 'Power', text: 'Raw strength, many levels. Reset by a Myth.' },
    { id: 'unlock', name: 'Unlocks', text: 'Open new parts of the world. Kept through a Myth.' }
  ];
  function x(v) { return '×' + (v >= 1000 ? fmt(v) : String(Math.round(v * 100) / 100)); }
  var START_GOLD = [0, 500, 5e4, 5e6, 5e8];
  var START_RANK = [1, 3, 4];   // Old Renown levels; Ancestral Lair also gives RELIC_RANK
  var RELIC_RANK = 5;
  var TALON_RAMP = [1, 1.5, 2, 2.5];

  // costs: fixed list per level, or base * growth^level.  desc(lv) describes the effect AT level lv (lv >= 1).
  var NODES = [
    // ---- Automation (kept through Myth)
    { id: 'auto_dig', branch: 'auto', short: 'Buys Kobold Diggers for you', name: 'Kobold Foremen', costs: [2], toggle: true,
      desc: function () { return 'Buys a Kobold Digger whenever one costs under 10% of your gold. While you are away with an empty lair, they gather spilled coins for the first one.'; } },
    { id: 'auto_build', branch: 'auto', short: 'Buys buildings, best value first', name: 'Master Builders', costs: [6], req: 'auto_dig', toggle: true,
      desc: function () { return 'Buys every unlocked building as gold comes in, best value first. Switch rows off in Lair.'; } },
    { id: 'auto_brood', branch: 'auto', short: 'Buys minions with half your gold/s', name: 'Brood Matron', costs: [4], toggle: true,
      desc: function () { return 'Buys minions with up to half of your gold/s. Switch tiers off in Brood.'; } },
    { id: 'auto_quest', branch: 'auto', short: 'Claims finished quests', name: 'Quest Scribe', costs: [2], toggle: true,
      desc: function () { return 'Claims finished quests for you.'; } },
    { id: 'auto_chest', branch: 'auto', short: 'Opens chests for you', name: 'Chest Kobold', costs: [2], req: 'auto_quest', toggle: true,
      desc: function () { return 'Opens chests for you and tells you what was inside.'; } },
    { id: 'auto_gust', branch: 'auto', short: 'Fires Wing Gust once charged', name: 'Restless Wings', costs: [3], toggle: true,
      desc: function () { return 'Wing Gust fires by itself once charged and 8 coins are out (or after 10s).'; } },
    { id: 'auto_upg', branch: 'auto', short: 'Buys Lair upgrades', name: 'Lair Steward', costs: [12], req: 'auto_build', toggle: true,
      desc: function () { return 'Buys Lair upgrades as soon as you can afford them.'; } },
    { id: 'auto_sleep', branch: 'auto', short: 'Takes the Long Sleep by itself', name: 'Dream Keeper', costs: [30], req: 'auto_upg',
      desc: function () { return 'Optional: take the Long Sleep by itself once the Legend gain is big enough and the run has grown long enough to be worth ending.'; } },
    // ---- Head start (reset by Myth)
    { id: 'start_gold', branch: 'start', name: 'Buried Cache', costs: [1, 4, 15, 60],
      what: 'Starting gold', val: function (lv) { return fmt(START_GOLD[Math.min(4, lv)]); },
      desc: function (lv) { return 'Start each run with ' + fmt(START_GOLD[Math.min(4, lv)]) + ' gold.'; } },
    { id: 'start_rank', branch: 'start', name: 'Old Renown', costs: [5, 40],
      what: 'Starting Dragon Rank', val: function (lv) { return String(START_RANK[Math.min(2, lv)]); },
      desc: function (lv) { return 'Start each run at Dragon Rank ' + START_RANK[Math.min(2, lv)] + '.'; } },
    // ---- Power (reset by Myth; cost growth x4 per level)
    // Dragon's Hunger (id 'greed') merges the old Greed, Glittering Halls and Fertile Clutches into one node
    // base 6 (SPEC-MINES A3 said 5): the last step of the B12 tuning order, so the Mines keep the first Ascend >= 2 h
    { id: 'greed', branch: 'power', name: "Dragon's Hunger", base: 6, growth: 4, max: 15, per: 0.25,
      what: 'Coins, building gold/s and minions', val: function (lv) { return x(1 + this.per * lv); },
      desc: function (lv) { return 'Coins, strokes, building gold/s and minion output ' + x(1 + this.per * lv) + '.'; } },
    { id: 'talons', branch: 'power', name: 'Steady Talons', base: 3, growth: 4, max: 3,
      what: 'Streak speed', val: function (lv) { return x(TALON_RAMP[Math.min(3, lv)]); },
      desc: function (lv) { return 'Streaks build ' + x(TALON_RAMP[Math.min(3, lv)]) + ' faster; ×8 streaks always open.'; } },
    { id: 'magpie', branch: 'power', name: 'Magpie Instinct', base: 3, growth: 4, max: 4,
      what: 'Treasures', val: function (lv) { return '+' + (25 * lv) + '%'; },
      what2: 'Gold Frenzy', val2: function (lv) { return '+' + (8 * lv) + 's'; },
      desc: function (lv) { return 'Treasures +' + (25 * lv) + '% more often; Gold Frenzy +' + (8 * lv) + 's.'; } },
    { id: 'dreams', branch: 'power', name: 'Deep Dreams', base: 6, growth: 4, max: 6,
      what: 'Legend per Long Sleep', val: function (lv) { return '+' + (20 * lv) + '%'; },
      desc: function (lv) { return 'Legend from each Long Sleep +' + (20 * lv) + '%.'; } },
    { id: 'watch', branch: 'power', name: 'Long Watch', base: 2, growth: 4, max: 4,
      what: 'Away time', val: function (lv) { return (8 + 4 * lv) + 'h'; },
      what2: 'Gold while away', val2: function (lv) { return x(Math.pow(1.15, lv)); },
      desc: function (lv) { return 'Away time counts up to ' + (8 + 4 * lv) + 'h; gold while away ' + x(Math.pow(1.15, lv)) + '.'; } },
    // ---- Unlocks (kept through Myth: the Mines stay open, the Myth gate stays open)
    // 'wake_ember' keeps its old id (and the Legend the player paid for it): it now opens the Mines early
    { id: 'wake_ember', branch: 'unlock', name: 'Call the Deep', costs: [12],
      desc: function () { return 'Open the Mines now, without waiting for Dragon Rank 7.'; } },
    { id: 'myth_gate', branch: 'unlock', name: 'The First Myth', costs: [40],
      desc: function () { return 'Unlocks Ascend: once you earn ' + fmt(MYTH.minLegend) + ' Legend in one Myth, trade it for Myth and Relics.'; } }
  ];
  var RELICS = [
    { id: 'r_legend', name: 'Saga Stone', costs: [1, 3, 9],
      what: 'Legend gain', val: function (lv) { return x(Math.pow(2, lv)); },
      desc: function (lv) { return 'Legend gain ' + x(Math.pow(2, lv)) + '.'; } },
    { id: 'r_start', name: 'Ancestral Lair', costs: [2],
      desc: function () { return 'Each run starts at Dragon Rank ' + RELIC_RANK + ' with 10 of every unlocked building.'; } },
    { id: 'r_keep', name: 'Unfading Lore', costs: [3],
      desc: function () { return 'Keep a quarter of your Power lore levels through each Ascend.'; } },
    { id: 'r_cards', name: 'Gilded Chests', costs: [2],
      desc: function () { return 'Every chest holds one more card.'; } },
    { id: 'r_ember', name: 'Deep Veins', costs: [2],
      desc: function () { return 'Miners dig ×3.'; } },
    { id: 'r_time', name: 'Timeless Sleep', costs: [4],
      desc: function () { return 'Away time counts 12h longer, and gold while away ×2.'; } }
  ];
  // Myth: available with The First Myth learned and Legend this Myth >= need, need = minLegend x grow^Ascends.
  //   formula 'log'  (default): gained = 1 + floor(log_step(legend / need))  (+1 at the need, +1 per x`step` beyond)
  //   formula 'sqrt' (SPEC-V2 literal with need 150, k 3.75): gained = floor(sqrt(legend * k / need))
  // The Legend economy is super-linear late in a Myth (Legend gain grows with Legend), so a sqrt Myth gain
  // would feed 1.5^myth back into it and run away; the log gain keeps each Ascend worth a few Myth.
  var MYTH = { gate: 'myth_gate', formula: 'log', minLegend: 2e4, grow: 30, step: 3, k: 3.75, prodPer: 1.5, goldOnly: true };

  var NIDX = {}, RIDX = {};
  NODES.forEach(function (n) { n.max = n.costs ? n.costs.length : n.max; NIDX[n.id] = n; });
  RELICS.forEach(function (r) { r.max = r.costs.length; RIDX[r.id] = r; });

  // ================================================================ one-time Lore trim (SPEC-MINES A3/A4), on load
  // Dragon's Hunger (greed) takes the highest of the old greed / halls / clutches levels, so no effect ever drops;
  // the cut nodes (Kobold Haggling, Remembered Claws, Loyal Brooms, Nest Egg) refund every Legend paid for them.
  var CUT_REFUND = { keep_claws: [3], keep_broom: [3], start_brood: [4, 20] };
  function trimLore(raw, o) {
    if (isObj(o.flags) && fin(o.flags.loreTrim1, 0) >= 1) return;
    if (!isObj(o.flags)) o.flags = {};
    var Lr = isObj(o.lore) ? o.lore : (o.lore = {});
    function l(id) { return Math.max(0, Math.floor(fin(Lr[id], 0))); }
    var refund = 0, hunger = Math.max(l('greed'), l('halls'), l('clutches'));
    if (hunger > 0) Lr.greed = Math.min(NIDX.greed.max, hunger);
    delete Lr.halls; delete Lr.clutches;
    for (var i = 0, b = Math.min(5, l('bargain')); i < b; i++) refund += Math.ceil(4 * Math.pow(4, i) - 1e-9);
    delete Lr.bargain;
    for (var id in CUT_REFUND) {
      var n = Math.min(CUT_REFUND[id].length, l(id));
      for (var j = 0; j < n; j++) refund += CUT_REFUND[id][j];
      delete Lr[id];
    }
    if (refund > 0) o.legendPts = cl(pos(o.legendPts) + refund);
    o.flags.loreTrim1 = 1;
    if (refund > 0 || hunger > 0) o._loreTrim = { refund: refund, hunger: hunger };   // not saved
  }
  if (typeof E.addLoadHook === 'function') E.addLoadHook('lore-trim', trimLore);

  // ================================================================ levels, costs, buying
  function lv(s, id) { return (s && isObj(s.lore)) ? Math.max(0, Math.floor(fin(s.lore[id], 0))) : 0; }
  function rlv(s, id) { return (s && isObj(s.relics)) ? Math.max(0, Math.floor(fin(s.relics[id], 0))) : 0; }
  function costAt(def, l) {
    if (!def || l >= def.max) return null;
    if (def.costs) return def.costs[l];
    return Math.ceil(def.base * Math.pow(def.growth, l) - 1e-9);
  }
  function cost(s, id) { var d = NIDX[id]; return d ? costAt(d, lv(s, id)) : null; }
  function reqMet(s, id) { var d = NIDX[id]; return !!d && (!d.req || lv(s, d.req) > 0); }
  function canBuy(s, id) {
    var c = cost(s, id);
    return c !== null && reqMet(s, id) && pos(s.legendPts) + 1e-9 >= c;
  }
  function buy(s, id) {
    var d = NIDX[id];
    if (!d || !s || !isObj(s.lore) || !reqMet(s, id)) return false;
    var c = cost(s, id);
    if (c === null || !E.spend(s, 'legendPts', c)) return false;
    var nl = lv(s, id) + 1;
    s.lore[id] = nl;
    applyNow(s, id, nl);
    E.dirty();
    E.emit('lore', { id: id, level: nl }, s);
    return true;
  }
  function relicCost(s, id) { var d = RIDX[id]; return d ? costAt(d, rlv(s, id)) : null; }
  function canBuyRelic(s, id) { var c = relicCost(s, id); return c !== null && pos(s.mythPts) + 1e-9 >= c; }
  function buyRelic(s, id) {
    var d = RIDX[id];
    if (!d || !s) return false;
    if (!isObj(s.relics)) s.relics = {};
    var c = relicCost(s, id);
    if (c === null || !E.spend(s, 'mythPts', c)) return false;
    s.relics[id] = rlv(s, id) + 1;
    if (id === 'r_start') applyNow(s, id, 1);
    E.dirty();
    E.emit('lore', { id: id, level: s.relics[id], relic: true }, s);
    return true;
  }
  function anyAffordable(s) {
    if (!s) return false;
    for (var i = 0; i < NODES.length; i++) if (canBuy(s, NODES[i].id)) return true;
    for (var j = 0; j < RELICS.length; j++) if (canBuyRelic(s, RELICS[j].id)) return true;
    return false;
  }
  function affordableCount(s) {
    var n = 0;
    if (!s) return 0;
    for (var i = 0; i < NODES.length; i++) if (canBuy(s, NODES[i].id)) n++;
    return n;
  }

  // ================================================================ modifier source
  E.addModSource('lore', function (s, M) {
    var L = isObj(s.lore) ? s.lore : {};
    function g(id) { return Math.max(0, Math.floor(fin(L[id], 0))); }
    var v;
    // stroke worth is 0.25 x coin worth, so coinMult already lifts strokes by the same factor (no strokeMult, or it would square)
    if ((v = g('greed'))) {
      var hu = 1 + NIDX.greed.per * v;
      M.coinMult *= hu; M.gpsMult *= hu;
      for (var t = 1; t < 5; t++) M.tierMult[t] *= hu;
    }
    if ((v = g('talons'))) { M.streakHigh = true; M.streakRamp *= TALON_RAMP[Math.min(3, v)]; }
    if ((v = g('magpie'))) { M.treasureFreq *= 1 + 0.25 * v; M.frenzyDurAdd += 8 * v; }
    if ((v = g('dreams'))) M.legendGainMult *= 1 + 0.2 * v;
    if ((v = g('watch'))) { M.offlineCapAddH += 4 * v; M.offlineMult *= Math.pow(1.15, v); }
  });
  E.addModSource('myth', function (s, M) {
    var m = Math.max(0, fin(s.myth, 0));
    if (m > 0) {
      var mm = Math.pow(MYTH.prodPer, Math.min(m, 1500));
      // gold production (buildings and coins); the minion chain is left alone so the Myth does not compound 4 times
      if (MYTH.goldOnly) { M.gpsMult *= mm; M.coinFlat *= mm; } else M.allMult *= mm;
    }
    var R = isObj(s.relics) ? s.relics : {};
    var r = Math.max(0, Math.floor(fin(R.r_legend, 0)));
    if (r) M.legendGainMult *= Math.pow(2, r);
    if (fin(R.r_cards, 0) >= 1) M.chestCardsAdd += 1;
    if (fin(R.r_time, 0) >= 1) { M.offlineCapAddH += 12; M.offlineMult *= 2; }
  });

  // ================================================================ head starts (sleep hook + right after a purchase)
  function startGoldFor(s) { return START_GOLD[Math.min(4, lv(s, 'start_gold'))]; }
  function startRankFor(s) {
    var r = START_RANK[Math.min(2, lv(s, 'start_rank'))];
    if (rlv(s, 'r_start') >= 1) r = Math.max(r, RELIC_RANK);
    return r;
  }
  function seedBuildings(s) {
    if (rlv(s, 'r_start') < 1) return;
    D.buildings.forEach(function (b) {
      if (s.rank >= b.rank) s.buildings[b.id] = Math.max(Math.floor(pos(s.buildings[b.id])), 10);
    });
  }
  function seedRun(s) {
    var sg = startGoldFor(s);
    if (sg > 0) s.gold = cl(Math.max(pos(s.gold), sg));
    var r = startRankFor(s);
    if (r > s.rank) s.rank = r;
    seedBuildings(s);
  }
  // a head start bought early in a run applies at once (otherwise it waits for the next run)
  function youngRun(s) { return pos(s.run && s.run.playActive) < 300 || pos(s.earnedRun) < 2 * startGoldFor(s); }
  function applyNow(s, id) {
    if (!youngRun(s)) return;
    if (id === 'start_gold') {
      var sg = startGoldFor(s);
      if (pos(s.gold) < sg) s.gold = sg;
    } else if (id === 'start_rank' || id === 'r_start') {
      var r = startRankFor(s);
      if (r > s.rank) { s.rank = r; s.rankProgress = 0; note('rank', { rank: r }); }
      seedBuildings(s);
    }
  }
  E.addSleepHook('lore', function (s) {
    seedRun(s);
    if (isObj(s.run)) s.run.dkPre = 1; // a fresh run starts below the Sleep threshold (Dream Keeper's warm-up clock)
  });

  // ================================================================ Myth / Ascend
  function mythGainMult(s) { void s; return 1; }   // no relic boosts Myth directly (yet)
  function mythScale(s) { return Math.pow(MYTH.grow, Math.min(60, Math.floor(pos(s && s.myths)))); }
  function mythNeed(s) { return MYTH.minLegend * mythScale(s); }
  function mythOnAscend(s) {
    if (!s) return 0;
    var need = mythNeed(s), l = pos(s.legend);
    if (!(l >= need) || !(need > 0)) return 0;
    var g = MYTH.formula === 'sqrt' ? Math.floor(Math.sqrt(l * MYTH.k / need) + 1e-9)
      : 1 + Math.floor(Math.log(l / need) / Math.log(MYTH.step) + 1e-9);
    g = Math.max(1, g) * mythGainMult(s);
    return Math.max(0, Math.min(1e6, fin(g, 0)));
  }
  // Legend at which the Ascend would give one more Myth
  function mythNextAt(s) {
    var g = Math.max(0, mythOnAscend(s)), need = mythNeed(s);
    if (MYTH.formula === 'sqrt') return Math.max(need, need * (g + 1) * (g + 1) / MYTH.k);
    return need * Math.pow(MYTH.step, g);
  }
  function mythGated(s) { return lv(s, MYTH.gate) > 0; }
  function canAscend(s) { return !!s && mythGated(s) && pos(s.legend) >= mythNeed(s) && mythOnAscend(s) >= 1; }
  function ascend(s) {
    if (!canAscend(s)) return 0;
    var gained = mythOnAscend(s);
    var keepPow = rlv(s, 'r_keep') >= 1;
    var nl = {};
    NODES.forEach(function (n) {
      var l = lv(s, n.id);
      if (!l) return;
      if (n.branch === 'auto' || n.branch === 'unlock') nl[n.id] = l;
      else if (n.branch === 'power' && keepPow) { var k = Math.floor(l * 0.25); if (k > 0) nl[n.id] = k; }
    });
    // unknown keys (future nodes) are kept as they are
    for (var k2 in s.lore) if (Object.prototype.hasOwnProperty.call(s.lore, k2) && !NIDX[k2]) nl[k2] = s.lore[k2];
    // the reset happens inside resetRun's `between`, so its pre-reset snapshot (sleep hooks, play log) still
    // holds the Myth-ending lore and Legend; the lore sleep hook runs after it, so head starts still apply
    E.resetRun(s, 'ascend', function (st) {
      st.lore = nl;
      st.legend = 0;
      st.legendPts = 0;
      st.myth = cl(pos(st.myth) + gained);
      st.mythPts = cl(pos(st.mythPts) + gained);
      st.myths = Math.floor(pos(st.myths)) + 1;
    });
    E.dirty();
    E.emit('myth', gained, s);
    return gained;
  }
  function mythMult(s) { return Math.pow(MYTH.prodPer, Math.max(0, Math.min(1500, fin(s && s.myth, 0)))); }

  // ================================================================ automation
  function autoMap(s) { if (!isObj(s.auto)) s.auto = {}; return s.auto; }
  function masterOn(s) { return !(s && isObj(s.auto) && s.auto.master === false); }
  function keyOn(s, key) { return !(s && isObj(s.auto) && s.auto[key] === false); }
  function nodeOn(s, id) { return lv(s, id) > 0 && masterOn(s) && keyOn(s, 'n:' + id); }
  function anyAutoOwned(s) {
    for (var i = 0; i < NODES.length; i++) if (NODES[i].branch === 'auto' && lv(s, NODES[i].id) > 0) return true;
    return false;
  }
  function autoSleepOn(s) { return lv(s, 'auto_sleep') > 0 && masterOn(s) && isObj(s.auto) && s.auto.sleep === true; }
  function autoSleepPct(s) {
    var p = isObj(s && s.auto) ? fin(s.auto.sleepPct, 100) : 100;
    return Math.max(50, Math.min(300, Math.round(p)));
  }
  function setAuto(s, key, v) {
    if (!s || typeof key !== 'string') return;
    autoMap(s)[key] = v;
    E.dirty();
  }
  function buildingAutoOn(s, id) {
    if (!masterOn(s) || !keyOn(s, 'b:' + id)) return false;
    if (lv(s, 'auto_build') > 0 && keyOn(s, 'n:auto_build')) return true;
    return id === 'digger' && lv(s, 'auto_dig') > 0 && keyOn(s, 'n:auto_dig');
  }
  function tierAutoOn(s, i) { return nodeOn(s, 'auto_brood') && keyOn(s, 't:' + i); }

  var lastManual = -1e9, lastManualState = null, acc = 0, broodBudget = 0, budgetState = null;
  var notes = [];
  function note(kind, data) {
    // repeated auto-buys merge into one note so the UI can summarise them
    var last = notes.length ? notes[notes.length - 1] : null;
    if (kind === 'autobuy' && last && last.kind === 'autobuy' && last.data.id === data.id) {
      last.data.n += data.n; last.data.gold = cl(last.data.gold + data.gold); return;
    }
    notes.push({ kind: kind, data: data });
    if (notes.length > 40) notes.shift();
  }
  // a buy by the player (not inside E.automated) pauses the auto-buyers for 1.5 s on that state
  E.on('buy', function (d, s) {
    if ((d && d.auto) || E.inAuto() || !s) return;
    lastManual = fin(s.time, 0); lastManualState = s;
  });

  // gold gain of one more building (milestone aware), per second, net of the Nest bonus its minion cost takes away
  // (late in a run a building can cost so many Eggs or Wyrmlings that the smaller nest loses more than it adds)
  function buildGain(s, st, id, c) {
    var owned = Math.floor(pos(s.buildings[id]));
    var each = fin(st.buildingEach[id], 0) / (st.frenzyActive ? Math.max(1, fin(D.C.frenzyMult, 7) * fin(st.M.frenzyMult, 1)) : 1);
    var m0 = E.milestoneMult('building', owned), m1 = E.milestoneMult('building', owned + 1);
    var gain = m0 > 0 ? each * ((owned + 1) * m1 / m0 - owned) : each;
    c = c || E.buildingCost(s, id, 1);
    var eq = D.C.broodEggs, w0 = fin(st.broodMult, 1), bg = pos(st.baseGps);
    if (c && c.minionTier >= 0 && eq && typeof E.warmthAt === 'function' && w0 > 0) {
      var w1 = fin(E.warmthAt(Math.max(0, pos(st.nestSize) - pos(c.minions) * fin(eq[c.minionTier], 0))), w0);
      gain = (bg + gain) * w1 / w0 - bg;
    }
    return gain;
  }
  function minionsOk(s, c) { return c.minionTier < 0 || pos(s.tiers[c.minionTier]) + 1e-9 >= c.minions; }
  function autoBuildings(s, offline) {
    var full = lv(s, 'auto_build') > 0 && keyOn(s, 'n:auto_build');
    var did = 0, cap = offline ? 400 : 40;
    if (!full) {
      // Kobold Foremen: diggers while one costs at most 10% of the gold on hand
      if (!buildingAutoOn(s, 'digger')) return 0;
      var spentF = 0;
      for (var g = 0; g < cap; g++) {
        var c0 = E.buildingCost(s, 'digger', 1);
        if (!(c0.gold > 0) || c0.gold > 0.1 * pos(s.gold) || !E.buyBuilding(s, 'digger', 1)) break;
        did++; spentF += c0.gold;
      }
      if (did && !offline) note('autobuy', { id: 'auto_dig', n: did, gold: spentF });
      return did;
    }
    // Master Builders: best payback first (time to afford + cost / gain); waits (saves up) for the best one
    var spentB = 0;
    for (var k = 0; k < cap; k++) {
      var st = E.stats(s), inc = Math.max(1e-9, st.baseGps), best = null;
      for (var i = 0; i < D.buildings.length; i++) {
        var id = D.buildings[i].id;
        if (!E.isUnlocked(s, 'building', id) || !buildingAutoOn(s, id)) continue;
        var c = E.buildingCost(s, id, 1);
        if (!(c.gold > 0) || !minionsOk(s, c)) continue;
        var gain = buildGain(s, st, id, c);
        if (!(gain > 0)) continue;
        var score = Math.max(0, (c.gold - pos(s.gold)) / inc) + c.gold / gain;
        if (!best || score < best.score) best = { id: id, score: score, cost: c.gold };
      }
      if (!best || best.cost > pos(s.gold) || !E.buyBuilding(s, best.id, 1)) break;
      did++; spentB += best.cost;
    }
    if (did && !offline) note('autobuy', { id: 'auto_build', n: did, gold: spentB });
    return did;
  }
  // minions needed soon by buildings that use tier t (two more of each)
  function reserve(s, t) {
    var n = 0;
    for (var i = 0; i < D.buildings.length; i++) {
      var b = D.buildings[i];
      if (b.minionTier !== t || !E.isUnlocked(s, 'building', b.id)) continue;
      n += E.buildingCost(s, b.id, 2).minions;
    }
    return n;
  }
  function eggQuest(s) {
    var m = s.missions, n = 0;
    if (!Array.isArray(m)) return 0;
    for (var i = 0; i < m.length; i++) {
      var q = m[i];
      if (isObj(q) && q.tpl === 'tier' && +q.key === 0 && q.done !== true) n = Math.max(n, pos(q.target));
    }
    return n;
  }
  function autoBrood(s, dt, offline) {
    var st = E.stats(s);
    if (budgetState !== s) { budgetState = s; broodBudget = 0; }
    // never more than half of gold/s goes to minions; unused budget carries over (up to 60 s of it)
    broodBudget = Math.min(broodBudget + 0.5 * pos(st.baseGps) * dt, 30 * pos(st.baseGps) + 50, pos(s.gold));
    if (!(broodBudget > 0)) return 0;
    var did = 0, tiers = [];
    for (var i = 4; i >= 0; i--) if (E.isUnlocked(s, 'tier', i) && tierAutoOn(s, i)) tiers.push(i);
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j], share = broodBudget / (tiers.length - j);
      var unit = E.tierCost(s, t, 1);
      if (!(unit.gold > 0)) continue;
      var n = Math.floor(share / unit.gold);
      if (t > 0) {
        var spare = pos(s.tiers[t - 1]) - reserve(s, t - 1);
        n = Math.min(n, Math.floor(spare / Math.max(1, D.tiers[t].prevCost)));
      } else {
        // Eggs: only top up to what raids and new Wyrmlings need soon
        var want = reserve(s, 0) + 20 + (E.isUnlocked(s, 'tier', 1) && tierAutoOn(s, 1) ? 10 * Math.max(1, Math.floor(share / Math.max(1, E.tierCost(s, 1, 1).gold))) : 0);
        // while you are away nobody else can: at rank 1 (Eggs only, nothing hatches more of them) also work toward an
        // open "Own N Eggs" quest (else a rank-1 run whose quests are Eggs + a swipe quest sat at rank 1 all night)
        if (offline && !E.isUnlocked(s, 'tier', 1)) want = Math.max(want, eggQuest(s));
        n = Math.min(n, Math.ceil(want - pos(s.tiers[0])));
      }
      n = Math.min(n, offline ? 1e15 : 1e12);
      if (n < 1) continue;
      var c = E.tierCost(s, t, n);
      if (E.buyTier(s, t, n)) { broodBudget = Math.max(0, broodBudget - c.gold); did++; }
    }
    return did;
  }
  function autoUpgrades(s) {
    var did = 0;
    for (var g = 0; g < 20; g++) {
      var list = E.upgradeList(s), best = null;
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        if (u.bought || !u.affordable) continue;
        if (!best || u.cost < best.cost) best = u;
      }
      if (!best || !E.buyUpgrade(s, best.id)) break;
      did++;
    }
    return did;
  }
  function autoQuests(s) {
    var did = 0;
    for (var g = 0; g < 12; g++) {
      var hit = -1;
      for (var i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { hit = i; break; }
      if (hit < 0) break;
      var r = E.claimMission(s, hit);
      if (!r.ok) break;
      did++;
    }
    return did;
  }
  function autoChests(s) {
    var n = 0, cards = [];
    for (var g = 0; g < 50 && Math.floor(pos(s.chests)) > 0; g++) {
      var got = E.openChest(s);
      if (!got.length) break;
      n++; cards = cards.concat(got);
    }
    if (n) note('chest', { chests: n, cards: cards });
    return n;
  }
  // ---- Dream Keeper's run clock. A run's time = its active play + the away time caught up offline (offline() does
  // not advance run.playActive). run.dkPre marks a run seen below the Sleep threshold; run.dkReady is the run time at
  // which it first could Sleep (its warm-up). Both live in state.run, so a Sleep or an Ascend clears them.
  function runClock(s) { return pos(s.run && s.run.playActive) + pos(s.run && s.run.away); }
  function trackRun(s, dt, offline) {
    if (!isObj(s.run)) return;
    if (offline) s.run.away = cl(pos(s.run.away) + pos(dt));
    if (!E.canSleep(s)) { s.run.dkPre = 1; delete s.run.dkReady; return; }
    // first seen able to Sleep: the warm-up is the run time so far (a run already past the threshold when first seen,
    // e.g. an older save, has no measured warm-up and waits for nothing)
    if (!(fin(s.run.dkReady, -1) >= 0)) s.run.dkReady = s.run.dkPre ? runClock(s) : 0;
  }
  function warmup(s) { return isObj(s.run) ? Math.max(0, fin(s.run.dkReady, 0)) : 0; }
  // a run Dream Keeper ends always lasts at least this long (run time: active play + away). An Ancestral Lair start
  // is already past the Sleep threshold, so its measured warm-up is ~10 s; without the floor it slept every 15-40 s.
  var DK_MIN_RUN = 90;
  // Dream Keeper sleeps when the Sleep is worth it:
  //  1. it gives at least sleepPct% of the Legend you have (the setting; the bigger the gain next to your Legend,
  //     the faster the next run), and
  //  2. the run has paid back its warm-up: every run spends time (W) building up to the Sleep threshold before it
  //     earns any Legend, and pays that again after each Sleep; Dream Keeper lets the run go on at least another W
  //     past the threshold (run time >= 2W). With little Legend (a fresh Myth, Legend 0 or 10) condition 1 is met the
  //     moment the run can Sleep, so without 2 it slept every ~1e7 gold, and in offline catch-up it ended a run that
  //     had hours left to grow. Late in a Myth W is a few seconds, so its timing is unchanged there.
  // autoSleepState says what Dream Keeper is waiting for: { on, can, gain, need (the Legend gain it wants),
  // warm (the run seconds it wants), run (run seconds so far), ready }
  function autoSleepState(s) {
    var r = { on: !!s && autoSleepOn(s), can: !!s && E.canSleep(s), gain: 0, need: 0, warm: 0, run: 0, ready: false };
    if (!s) return r;
    r.gain = r.can ? E.legendOnSleep(s) : 0;
    r.need = Math.max(1, Math.ceil(pos(s.legend) * autoSleepPct(s) / 100 - 1e-9));
    r.run = runClock(s);
    r.warm = r.can ? Math.max(2 * warmup(s), DK_MIN_RUN) : 0;
    r.ready = r.on && r.can && r.gain >= 1 && r.gain >= pos(s.legend) * autoSleepPct(s) / 100 && r.run >= r.warm;
    return r;
  }
  function wantsAutoSleep(s) {
    if (!autoSleepOn(s) || !E.canSleep(s)) return false;
    return autoSleepState(s).ready;
  }
  // ---- offline restart: a run with no income at all (a fresh run without starting gold: no buildings, no brooms)
  // earns nothing while you are away, so automation could never buy its first building. While away, the Kobold
  // Foremen gather a quarter of the coins that spill until the first building stands; then the lair takes over.
  var FOREMEN_SHARE = 0.25;
  function lairIdle(s, st) {
    if (pos(st.baseGps) > 0 || pos(st.sweepGps) > 0) return false;
    for (var i = 0; i < D.buildings.length; i++) if (pos(s.buildings[D.buildings[i].id]) >= 1) return false;
    return true;
  }
  function foremenGather(s, dt) {
    if (!buildingAutoOn(s, 'digger')) return 0;
    var st = E.stats(s);
    if (!lairIdle(s, st)) return 0;
    var g = pos(st.spillRate) * pos(st.coinWorth) * FOREMEN_SHARE * pos(dt);
    if (!(g > 0)) return 0;
    return E.earn(s, g, 'offline');
  }
  // one automation pass; returns the number of actions
  function runAuto(s, dt, offline) {
    if (!s || !masterOn(s) || !anyAutoOwned(s)) return 0;
    return E.automated(function () { return autoPass(s, dt, offline); });
  }
  function autoPass(s, dt, offline) {
    var did = 0;
    if (nodeOn(s, 'auto_quest')) did += autoQuests(s);
    if (nodeOn(s, 'auto_chest')) did += autoChests(s);
    var manualRecent = !offline && lastManualState === s && fin(s.time, 0) - lastManual < 1.5 && fin(s.time, 0) >= lastManual;
    if (!manualRecent) {
      if (nodeOn(s, 'auto_upg')) did += autoUpgrades(s);
      did += autoBuildings(s, offline);
      if (nodeOn(s, 'auto_brood')) did += autoBrood(s, dt, offline);
    }
    if (wantsAutoSleep(s)) {
      var g = E.sleep(s);
      if (g > 0) {
        did++; note('sleep', { gained: g, offline: !!offline });
        // for the welcome-back sheet (js/ui-lore.js reads and clears it; '_' keys are never saved)
        if (offline) { var aw = isObj(s._dkAway) ? s._dkAway : (s._dkAway = { n: 0, gain: 0 }); aw.n++; aw.gain = cl(aw.gain + g); }
      }
    }
    return did;
  }
  // a long absence with automation running is caught up in steps of at most 30 s (engine offline(), C.offlineStepsMax):
  // with 200 fixed steps an 8 h night moved in 144 s jumps, so Dream Keeper's Legend swung 1.5k..9k with the hours away
  if (typeof E.addOfflineStepHook === 'function') E.addOfflineStepHook('lore', function (s) {
    return masterOn(s) && anyAutoOwned(s) ? 30 : 0;
  });
  E.addTickHook('lore', function (s, dt, isOffline) {
    trackRun(s, dt, isOffline);
    if (!masterOn(s) || !anyAutoOwned(s)) { acc = 0; return; }
    if (isOffline) { foremenGather(s, dt); runAuto(s, dt, true); return; }
    acc += dt;
    if (acc < 0.5) return;
    var d = Math.min(acc, 5);
    acc = 0;
    runAuto(s, d, false);
  });

  // ================================================================ public API
  HOARD.lore = {
    branches: BRANCHES,
    nodes: NODES,
    relics: RELICS,
    MYTH: MYTH,
    START_GOLD: START_GOLD,
    START_RANK: START_RANK,
    node: function (id) { return NIDX[id] || null; },
    relic: function (id) { return RIDX[id] || null; },
    level: lv,
    relicLevel: rlv,
    cost: cost,
    costAt: costAt,
    reqMet: reqMet,
    canBuy: canBuy,
    buy: buy,
    relicCost: relicCost,
    canBuyRelic: canBuyRelic,
    buyRelic: buyRelic,
    anyAffordable: anyAffordable,
    affordableCount: affordableCount,
    // gold/s one more building adds, net of the Nest bonus its minion cost takes (what Master Builders compares)
    buildGain: function (s, id) { return buildGain(s, E.stats(s), id); },
    // { now, next } effect strings for a node or relic (next is null at max level), or null when it has no value line
    effect: function (s, id) {
      var d = NIDX[id] || RIDX[id];
      if (!d || typeof d.val !== 'function') return null;
      var l = NIDX[id] ? lv(s, id) : rlv(s, id);
      try {
        var e = { what: d.what, now: d.val(l), next: l < d.max ? d.val(l + 1) : null };
        if (typeof d.val2 === 'function') e.second = { what: d.what2, now: d.val2(l), next: l < d.max ? d.val2(l + 1) : null };
        return e;
      } catch (e2) { return null; }
    },
    describe: function (id, l) { var d = NIDX[id] || RIDX[id]; if (!d) return ''; try { return d.desc.call(d, Math.max(1, l)); } catch (e) { return ''; } },
    // Myth
    mythOnAscend: mythOnAscend,
    mythNeed: mythNeed,
    mythNextAt: mythNextAt,
    canAscend: canAscend,
    mythGated: mythGated,
    ascend: ascend,
    mythMult: mythMult,
    // automation
    masterOn: masterOn,
    keyOn: keyOn,
    nodeOn: nodeOn,
    setAuto: setAuto,
    anyAutoOwned: anyAutoOwned,
    autoSleepOn: autoSleepOn,
    autoSleepState: autoSleepState,
    autoSleepPct: autoSleepPct,
    buildingAutoOn: buildingAutoOn,
    tierAutoOn: tierAutoOn,
    runAuto: runAuto,
    drainNotes: function () { var n = notes; notes = []; return n; }
  };
})();
