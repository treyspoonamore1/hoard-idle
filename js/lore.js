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
  var CLAW_IDS = ['claws1', 'claws2', 'claws3', 'claws4', 'scales1', 'scales2', 'scales3'];
  var BROOM_IDS = ['broom1', 'broom2', 'broom3'];

  // costs: fixed list per level, or base * growth^level.  desc(lv) describes the effect AT level lv (lv >= 1).
  var NODES = [
    // ---- Automation (kept through Myth)
    { id: 'auto_dig', branch: 'auto', name: 'Kobold Foremen', costs: [2], toggle: true,
      desc: function () { return 'Buys a Kobold Digger whenever one costs under 10% of your gold.'; } },
    { id: 'auto_build', branch: 'auto', name: 'Master Builders', costs: [6], req: 'auto_dig', toggle: true,
      desc: function () { return 'Buys every unlocked building as gold comes in, best value first. Switch rows off in Lair.'; } },
    { id: 'auto_brood', branch: 'auto', name: 'Brood Matron', costs: [4], toggle: true,
      desc: function () { return 'Buys minions with up to half of your gold/s. Switch tiers off in Brood.'; } },
    { id: 'auto_quest', branch: 'auto', name: 'Quest Scribe', costs: [2], toggle: true,
      desc: function () { return 'Claims finished quests for you.'; } },
    { id: 'auto_chest', branch: 'auto', name: 'Chest Kobold', costs: [2], req: 'auto_quest', toggle: true,
      desc: function () { return 'Opens chests for you and tells you what was inside.'; } },
    { id: 'auto_gust', branch: 'auto', name: 'Restless Wings', costs: [3], toggle: true,
      desc: function () { return 'Wing Gust fires by itself once charged and 8 coins are out (or after 10s).'; } },
    { id: 'auto_upg', branch: 'auto', name: 'Lair Steward', costs: [12], req: 'auto_build', toggle: true,
      desc: function () { return 'Buys Lair upgrades as soon as you can afford them.'; } },
    { id: 'auto_sleep', branch: 'auto', name: 'Dream Keeper', costs: [30], req: 'auto_upg',
      desc: function () { return 'Optional: take the Long Sleep by itself once the Legend gain is big enough.'; } },
    // ---- Head start (reset by Myth)
    { id: 'start_gold', branch: 'start', name: 'Buried Cache', costs: [1, 4, 15, 60],
      what: 'Starting gold', val: function (lv) { return fmt(START_GOLD[Math.min(4, lv)]); },
      desc: function (lv) { return 'Start each run with ' + fmt(START_GOLD[Math.min(4, lv)]) + ' gold.'; } },
    { id: 'keep_claws', branch: 'start', name: 'Remembered Claws', costs: [3],
      desc: function () { return 'Sharper Claws and Golden Scales survive the Long Sleep.'; } },
    { id: 'keep_broom', branch: 'start', name: 'Loyal Brooms', costs: [3],
      desc: function () { return 'Kobold Broom Crew upgrades survive the Long Sleep.'; } },
    { id: 'start_rank', branch: 'start', name: 'Old Renown', costs: [5, 40],
      what: 'Starting Dragon Rank', val: function (lv) { return String(START_RANK[Math.min(2, lv)]); },
      desc: function (lv) { return 'Start each run at Dragon Rank ' + START_RANK[Math.min(2, lv)] + '.'; } },
    { id: 'start_brood', branch: 'start', name: 'Nest Egg', costs: [4, 20],
      desc: function (lv) { return lv >= 2 ? 'Start with 300 Eggs, 25 Wyrmlings, 12 Drakes and 3 Wyverns.' : 'Start each run with 300 Eggs and 25 Wyrmlings.'; } },
    // ---- Power (reset by Myth; cost growth x4 per level)
    { id: 'greed', branch: 'power', name: "Dragon's Greed", base: 1, growth: 4, max: 15, per: 0.25,
      what: 'Coin and stroke worth', val: function (lv) { return x(1 + this.per * lv); },
      desc: function (lv) { return 'Coins and strokes ' + x(1 + this.per * lv) + '.'; } },
    { id: 'halls', branch: 'power', name: 'Glittering Halls', base: 2, growth: 4, max: 15, per: 0.25,
      what: 'Building gold/s', val: function (lv) { return x(1 + this.per * lv); },
      desc: function (lv) { return 'Building gold/s ' + x(1 + this.per * lv) + '.'; } },
    { id: 'clutches', branch: 'power', name: 'Fertile Clutches', base: 2, growth: 4, max: 15, per: 0.25,
      what: 'Minion output', val: function (lv) { return x(1 + this.per * lv); },
      desc: function (lv) { return 'Minion output ' + x(1 + this.per * lv) + '.'; } },
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
    { id: 'bargain', branch: 'power', name: 'Kobold Haggling', base: 4, growth: 4, max: 5,
      what: 'Building and minion gold cost', val: function (lv) { return lv ? '-' + Math.round(100 - 100 * Math.pow(0.9, lv)) + '%' : 'full price'; },
      desc: function (lv) { return 'Buildings and minions cost ' + Math.round(100 - 100 * Math.pow(0.9, lv)) + '% less gold.'; } },
    // ---- Unlocks (kept through Myth: Ember stays awake, the Myth gate stays open)
    { id: 'wake_ember', branch: 'unlock', name: 'Wake Ember', costs: [12],
      desc: function () { return 'A second dragon whose kilns warm all your gold.'; } },
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
    { id: 'r_ember', name: "Ember's Brood", costs: [2],
      desc: function () { return 'Ember grows ×3 faster.'; } },
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
    if (id === 'wake_ember') s.lore.wake_ember = 1;
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
    if ((v = g('greed'))) M.coinMult *= 1 + NIDX.greed.per * v;
    if ((v = g('halls'))) M.gpsMult *= 1 + NIDX.halls.per * v;
    if ((v = g('clutches'))) for (var t = 1; t < 5; t++) M.tierMult[t] *= 1 + NIDX.clutches.per * v;
    if ((v = g('talons'))) { M.streakHigh = true; M.streakRamp *= TALON_RAMP[Math.min(3, v)]; }
    if ((v = g('magpie'))) { M.treasureFreq *= 1 + 0.25 * v; M.frenzyDurAdd += 8 * v; }
    if ((v = g('dreams'))) M.legendGainMult *= 1 + 0.2 * v;
    if ((v = g('watch'))) { M.offlineCapAddH += 4 * v; M.offlineMult *= Math.pow(1.15, v); }
    if ((v = g('bargain'))) { var f = Math.pow(0.9, v); M.costMultBuilding *= f; M.costMultTier *= f; }
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
  function seedBrood(s) {
    var l = lv(s, 'start_brood');
    if (l < 1) return;
    var want = l >= 2 ? [300, 25, 12, 3, 0] : [300, 25, 0, 0, 0];
    for (var i = 0; i < 5; i++) if (want[i] > 0) s.tiers[i] = cl(Math.max(pos(s.tiers[i]), want[i]));
  }
  function seedBuildings(s) {
    if (rlv(s, 'r_start') < 1) return;
    D.buildings.forEach(function (b) {
      if (s.rank >= b.rank) s.buildings[b.id] = Math.max(Math.floor(pos(s.buildings[b.id])), 10);
    });
  }
  function seedRun(s, prev) {
    var L = s.lore;
    var up = (prev && isObj(prev.upgrades)) ? prev.upgrades : {};
    if (lv(s, 'keep_claws')) CLAW_IDS.forEach(function (id) { if (up[id] === true) s.upgrades[id] = true; });
    if (lv(s, 'keep_broom')) BROOM_IDS.forEach(function (id) { if (up[id] === true) s.upgrades[id] = true; });
    var sg = startGoldFor(s);
    if (sg > 0) s.gold = cl(Math.max(pos(s.gold), sg));
    var r = startRankFor(s);
    if (r > s.rank) s.rank = r;
    seedBrood(s);
    seedBuildings(s);
    void L;
  }
  // a head start bought early in a run applies at once (otherwise it waits for the next run)
  function youngRun(s) { return pos(s.run && s.run.playActive) < 300 || pos(s.earnedRun) < 2 * startGoldFor(s); }
  function applyNow(s, id) {
    if (!youngRun(s) && id !== 'keep_claws' && id !== 'keep_broom') return;
    if (id === 'start_gold') {
      var sg = startGoldFor(s);
      if (pos(s.gold) < sg) s.gold = sg;
    } else if (id === 'start_rank' || id === 'r_start') {
      var r = startRankFor(s);
      if (r > s.rank) { s.rank = r; s.rankProgress = 0; note('rank', { rank: r }); }
      seedBuildings(s);
    } else if (id === 'start_brood') seedBrood(s);
  }
  E.addSleepHook('lore', function (s, prev) { seedRun(s, prev); });

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
  function wantsAutoSleep(s) {
    if (!autoSleepOn(s) || !E.canSleep(s)) return false;
    var gain = E.legendOnSleep(s);
    if (!(gain >= 1)) return false;
    return gain >= pos(s.legend) * autoSleepPct(s) / 100;
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
      if (g > 0) { did++; note('sleep', { gained: g, offline: !!offline }); }
    }
    return did;
  }
  E.addTickHook('lore', function (s, dt, isOffline) {
    if (!masterOn(s) || !anyAutoOwned(s)) { acc = 0; return; }
    if (isOffline) { runAuto(s, dt, true); return; }
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
    autoSleepPct: autoSleepPct,
    buildingAutoOn: buildingAutoOn,
    tierAutoOn: tierAutoOn,
    runAuto: runAuto,
    drainNotes: function () { var n = notes; notes = []; return n; }
  };
})();
