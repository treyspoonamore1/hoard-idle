/* Hoard — game rules. Pure state functions, save/load, offline progress.
 * Classic script; never touches the DOM. Runs in Node via vm.runInThisContext. */
(function () {
  'use strict';
  var G = globalThis;
  var HOARD = (G.HOARD = G.HOARD || {});
  var D = HOARD.data;
  var C = D.C;
  var MAXN = C.maxNum;

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

  var BIDX = {}; D.buildings.forEach(function (b, i) { BIDX[b.id] = i; });
  var UIDX = {}; D.upgrades.forEach(function (u, i) { UIDX[u.id] = i; });
  var CIDX = {}; D.cards.forEach(function (c, i) { CIDX[c.id] = i; });
  var CARD_BY_TARGET = {}; D.cards.forEach(function (c) { CARD_BY_TARGET[c.target] = c.id; });
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
  function emit(name, payload) {
    if (quiet > 0) return;
    var ls = listeners[name];
    if (!ls) return;
    for (var i = 0; i < ls.length; i++) {
      try { ls[i](payload); } catch (e) { try { console.error(e); } catch (e2) { /* ignore */ } }
    }
  }

  // ================================================================ state
  function freshRun() { return { coins: 0, treasures: 0, gusts: 0, bestStreak: 1, swipePx: 0 }; }
  function freshBuildings() { var o = {}; D.buildings.forEach(function (b) { o[b.id] = 0; }); return o; }

  function baseState() {
    return {
      v: 1,
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
      cards: {},
      chests: 0,
      legend: 0,
      sleeps: 0,
      gust: 1,
      effects: [],
      stat: { swipePx: 0, coins: 0, treasures: 0, gusts: 0, bestStreak: 1, sleepsGold: 0 },
      run: freshRun(),
      time: 0,
      savedAt: Date.now(),
      settings: { haptics: true, reducedMotion: false, buyAmt: 1 }
    };
  }

  function newState() {
    var s = baseState();
    fillMissions(s);
    return s;
  }

  function sanitize(s) {
    // repairs a state in place (used by deserialize and defensively elsewhere)
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
    if (isObj(s.cards)) D.cards.forEach(function (c) { var n = Math.floor(clamp(s.cards[c.id], 0, 1e9)); if (n > 0) o.cards[c.id] = n; });
    o.chests = Math.floor(clamp(s.chests, 0, 1e9));
    o.legend = Math.floor(clamp(s.legend, 0, MAXN));
    o.sleeps = Math.floor(clamp(s.sleeps, 0, 1e9));
    o.gust = clamp(s.gust, 0, 1);
    if (Array.isArray(s.effects)) {
      s.effects.forEach(function (e) {
        if (isObj(e) && (e.kind === 'frenzy' || e.kind === 'ember')) {
          o.effects.push({ kind: e.kind, mult: clamp(e.mult, 1, 1e6), until: fin(e.until, 0) });
        }
      });
    }
    if (isObj(s.stat)) {
      ['swipePx', 'coins', 'treasures', 'gusts', 'sleepsGold'].forEach(function (k) { o.stat[k] = pos(s.stat[k]); });
      o.stat.bestStreak = clamp(s.stat.bestStreak, 1, 1e6);
    }
    if (isObj(s.run)) {
      ['coins', 'treasures', 'gusts', 'swipePx'].forEach(function (k) { o.run[k] = pos(s.run[k]); });
      o.run.bestStreak = clamp(s.run.bestStreak, 1, 1e6);
    }
    o.time = pos(s.time);
    o.savedAt = fin(s.savedAt, 0) > 0 ? fin(s.savedAt, 0) : Date.now();
    if (isObj(s.settings)) {
      o.settings.haptics = s.settings.haptics !== false;
      o.settings.reducedMotion = s.settings.reducedMotion === true;
      var ba = s.settings.buyAmt;
      o.settings.buyAmt = (ba === 10 || ba === 'max') ? ba : 1;
    }
    if (Array.isArray(s.missions)) {
      s.missions.forEach(function (m) {
        if (o.missions.length >= 3 || !isObj(m)) return;
        if (!TPL.hasOwnProperty(m.tpl)) return;
        var key = m.key;
        if (m.tpl === 'building' && !bdef(key)) return;
        if (m.tpl === 'tier') { key = tierIdx(key); if (key < 0) return; }
        o.missions.push({
          uid: Math.floor(clamp(m.uid, 0, 2e9)), tpl: m.tpl, key: (key === undefined ? null : key),
          target: Math.max(1, pos(m.target)), base: pos(m.base), done: m.done === true
        });
      });
    }
    fillMissions(o);
    return o;
  }

  function deserialize(json) {
    try {
      var s = json;
      if (typeof json === 'string') {
        try { s = JSON.parse(json); } catch (e) { s = null; }
      }
      // tolerate a wrapper like { json: "...", savedAt }
      if (isObj(s) && typeof s.json === 'string' && s.v === undefined) {
        try { s = JSON.parse(s.json); } catch (e) { s = null; }
      }
      if (!isObj(s)) return newState();
      return sanitize(s);
    } catch (e) {
      return newState();
    }
  }

  function serialize(state) {
    try {
      if (isObj(state)) state.savedAt = Date.now();
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
  function cardLvl(state, target) {
    var id = CARD_BY_TARGET[target];
    if (!id) return 0;
    return levelFor(cardCopies(state, id));
  }

  // ================================================================ multipliers
  function legendMult(state) { return 1 + C.legendPer * pos(state.legend); }
  function rankMult(state) { return 1 + C.rankGpsPer * Math.max(0, fin(state.rank, 1) - C.rankGpsAfter); }
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

  function upgradeAgg(state) {
    var a = { coinMult: 1, scales: 0, sweep: 0, gustCd: C.gustCooldown, gleam: 1, spill: 1 };
    var ups = isObj(state.upgrades) ? state.upgrades : {};
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      if (ups[u.id] !== true) continue;
      var e = u.effect;
      if (e.kind === 'coinMult') a.coinMult *= e.mult;
      else if (e.kind === 'scales') a.scales += e.pct;
      else if (e.kind === 'sweep') a.sweep = Math.max(a.sweep, e.rate);
      else if (e.kind === 'gustCd') a.gustCd = Math.min(a.gustCd, e.sec);
      else if (e.kind === 'gleam') a.gleam *= e.mult;
      else if (e.kind === 'spill') a.spill *= e.mult;
    }
    return a;
  }

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

  // per-unit production multiplier of tier i (i>=1)
  function tierUnitRate(state, i) {
    var td = D.tiers[i];
    if (!td || !td.prod) return 0;
    var owned = Math.floor(pos(state.tiers[i]));
    var m = td.prod * pow2(milestoneCountTier(owned)) * legendMult(state);
    if (i >= 1) m *= 1 + 0.5 * cardLvl(state, 't:' + i);
    return cl(m);
  }

  // building gps without frenzy (the "base" gold/s that drives coin worth & missions)
  function buildingGpsEach(state, id) {
    var b = bdef(id);
    if (!b) return 0;
    var owned = Math.floor(pos(state.buildings[id]));
    return cl(b.gps * pow2(milestoneCountBuilding(owned)) * (1 + 0.5 * cardLvl(state, 'b:' + id)));
  }
  function globalGpsMult(state) {
    return legendMult(state) * rankMult(state) * (1 + 0.25 * cardLvl(state, 'gps'));
  }
  function baseGps(state) {
    var g = 0, gm = globalGpsMult(state);
    for (var i = 0; i < D.buildings.length; i++) {
      var id = D.buildings[i].id;
      g += buildingGpsEach(state, id) * Math.floor(pos(state.buildings[id]));
    }
    return cl(g * gm);
  }

  function maxStreak(state) {
    return (cardLvl(state, 'streak') >= 1 || fin(state.rank, 1) >= C.streakHighRank) ? C.streakCapHigh : C.streakCapLow;
  }
  function streakEff(state, mult) {
    mult = clamp(mult, 1, 1e6);
    var cap = maxStreak(state);
    if (mult > cap) mult = cap;
    return mult * (1 + 0.05 * cardLvl(state, 'streak'));
  }

  function coinWorthOf(state, gps, agg) {
    // gps already carries legendMult; divide it out so Legend applies once, and claws only scale the flat part
    var w = (agg.coinMult + (C.coinGpsPct + agg.scales) * gps / legendMult(state)) * (1 + 0.25 * cardLvl(state, 'coin')) *
      effectMult(state, 'ember') * legendMult(state);
    return cl(w);
  }

  function stats(state) {
    if (!ok(state)) state = baseState();
    var agg = upgradeAgg(state);
    var bg = baseGps(state);
    var frenzy = effectMult(state, 'frenzy');
    var gm = globalGpsMult(state);
    var gps = cl(bg * frenzy);
    var coinWorth = coinWorthOf(state, bg, agg);
    var strokeWorth = cl(C.strokeFrac * coinWorth * (1 + 0.5 * cardLvl(state, 'stroke')));
    var sweepRate = agg.sweep;
    var buildingGps = {}, buildingEach = {};
    for (var i = 0; i < D.buildings.length; i++) {
      var id = D.buildings[i].id;
      var each = cl(buildingGpsEach(state, id) * gm * frenzy);
      buildingEach[id] = each;
      buildingGps[id] = cl(each * Math.floor(pos(state.buildings[id])));
    }
    var tierRates = [0, 0, 0, 0, 0], unit = [0, 0, 0, 0, 0];
    for (var t = 1; t < 5; t++) {
      unit[t] = tierUnitRate(state, t);
      tierRates[t - 1] = cl(unit[t] * pos(state.tiers[t]));
    }
    var tf = agg.gleam * (1 + 0.1 * cardLvl(state, 'treasure'));
    var fL = effectLeft(state, 'frenzy'), eL = effectLeft(state, 'ember');
    return {
      gps: gps,
      baseGps: bg,
      coinWorth: coinWorth,
      strokeWorth: strokeWorth,
      spillRate: C.spillBase * agg.spill,
      sweepRate: sweepRate,
      sweepGps: cl(Math.min(sweepRate, C.spillBase * agg.spill) * coinWorth),
      gustCooldown: agg.gustCd,
      gustWorthMult: C.gustMult * (1 + 0.25 * cardLvl(state, 'gust')),
      treasureInterval: [C.treasureInterval[0] / tf, C.treasureInterval[1] / tf],
      tierRates: tierRates,
      tierUnitRate: unit,
      buildingGps: buildingGps,
      buildingEach: buildingEach,
      maxStreak: maxStreak(state),
      offlineCapHours: C.offlineCapHours + cardLvl(state, 'offline'),
      legendMult: legendMult(state),
      frenzyActive: fL > 0 && !state._noEffects,
      emberActive: eL > 0 && !state._noEffects,
      frenzyLeft: Math.max(0, fL),
      emberLeft: Math.max(0, eL)
    };
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
    return earn(state, g, 'coin');
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

  function sweepCollect(state, valueMult) {
    if (!ok(state)) return 0;
    if (valueMult === undefined || valueMult === null) valueMult = 1;
    var s = stats(state);
    if (s.sweepRate <= 0) return 0;
    state.run.coins = cl(pos(state.run.coins) + 1);
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
    return true;
  }

  // ================================================================ treasures
  function addEffect(state, kind, mult, dur) {
    var t = fin(state.time, 0);
    var until = t + dur;
    var keep = [];
    for (var i = 0; i < state.effects.length; i++) {
      var e = state.effects[i];
      if (e.kind === kind) until = Math.max(until, fin(e.until, 0));
      else keep.push(e);
    }
    keep.push({ kind: kind, mult: mult, until: until });
    state.effects = keep;
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
      var dur = C.frenzyDur + 3 * cardLvl(state, 'frenzy');
      addEffect(state, 'frenzy', C.frenzyMult, dur);
      res.text = 'Gold/s x' + C.frenzyMult + ' for ' + dur + 's!';
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
      res.minions = gained;
      res.text = '+' + HOARD.fmt(gained[0]) + ' Eggs' + (gained[1] > 0 ? ' and more of your brood' : '') + '!';
    }
    state.stat.treasures = pos(state.stat.treasures) + 1;
    state.run.treasures = pos(state.run.treasures) + 1;
    emit('treasure', res);
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

  function buildingCost(state, id, n) {
    var b = bdef(id);
    if (!b || !ok(state)) return { gold: 0, minionTier: -1, minions: 0 };
    var owned = Math.floor(pos(state.buildings[id]));
    n = normN(n, function () { return buildingMax(state, id); });
    n = Math.min(n, C.buildingMaxBuy);
    return {
      gold: goldSum(b.gold, owned, n),
      minionTier: b.minionTier,
      minions: b.minionTier >= 0 ? minionSum(b.minions, owned, n) : 0,
      n: n
    };
  }

  function canPayBuilding(state, b, owned, n) {
    if (goldSum(b.gold, owned, n) > pos(state.gold) * (1 + 1e-12)) return false;
    if (b.minionTier >= 0 && minionSum(b.minions, owned, n) > pos(state.tiers[b.minionTier]) + 1e-9) return false;
    return true;
  }

  function buildingMax(state, id) {
    var b = bdef(id);
    if (!b || !ok(state)) return 0;
    var owned = Math.floor(pos(state.buildings[id]));
    var g = C.buildingGrowth, gold = pos(state.gold);
    var p0 = b.gold * Math.pow(g, owned);
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
    state.gold = pos(state.gold - goldSum(b.gold, owned, n));
    if (b.minionTier >= 0) state.tiers[b.minionTier] = pos(state.tiers[b.minionTier] - minionSum(b.minions, owned, n));
    state.buildings[id] = owned + n;
    if (milestoneCountBuilding(owned + n) > before) emit('milestone', { kind: 'building', id: id, count: owned + n });
    return true;
  }

  // ================================================================ minions
  function tierGoldPrice(state, i) {
    var p = D.tiers[i].gold;
    if (i === 0) p *= 1 - Math.min(0.4, 0.04 * cardLvl(state, 't:0'));
    return p;
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
    var cnt = Math.floor(state.tiers[i]);
    if (milestoneCountTier(cnt) > before) emit('milestone', { kind: 'tier', id: i, count: cnt });
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
    var gold = pos(state.gold), bg = baseGps(state);
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
    return true;
  }

  // ================================================================ missions
  var TPL = {};
  D.missionTemplates.forEach(function (t) { TPL[t.tpl] = t; });

  function niceUp(x) {
    x = Math.max(1, fin(x, 1));
    if (x < 20) return Math.ceil(x);
    var e = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return cl(Math.ceil(x / e) * e);
  }
  var STREAK_STEPS = [2, 3, 5, 8];

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
    return '?';
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

    var active = {};
    (state.missions || []).forEach(function (x) { if (x) active[x.tpl + ':' + x.key] = true; active[x.tpl] = (active[x.tpl] || 0) + 1; });
    var cands = [];
    var unlockedB = D.buildings.filter(function (b) { return r >= b.rank; });
    var unlockedT = [0, 1, 2, 3, 4].filter(function (i) { return r >= i + 1; });
    var ms = maxStreak(state), bs = fin(state.run.bestStreak, 1);
    var nextStreak = 0;
    for (var s = 0; s < STREAK_STEPS.length; s++) if (STREAK_STEPS[s] > bs && STREAK_STEPS[s] <= ms) { nextStreak = STREAK_STEPS[s]; break; }

    D.missionTemplates.forEach(function (t) {
      if (r < t.minRank) return;
      if (t.tpl === 'streak' && !nextStreak) return;
      if (t.tpl === 'gps' && st.baseGps < 1) return;
      var w = t.weight;
      if (active[t.tpl]) w *= 0.15; // prefer variety
      cands.push({ t: t, w: w });
    });
    var tw = 0; cands.forEach(function (c) { tw += c.w; });
    var x = h1 * tw, pick = cands[0];
    for (var i = 0; i < cands.length; i++) { x -= cands[i].w; if (x < 0) { pick = cands[i]; break; } }
    m.tpl = pick.t.tpl;

    var rate = st.baseGps + 3 * st.coinWorth + st.sweepGps;
    // T = seconds of active play this mission should take (longer at higher rank)
    var T = (C.missionTimeBase + C.missionTimePerRank * (r - 1)) * (0.75 + 0.6 * h3);
    switch (m.tpl) {
      case 'building': {
        // favour the newest buildings
        var bl = unlockedB.filter(function (b) { return !active['building:' + b.id] && goldSum(b.gold, Math.floor(pos(state.buildings[b.id])), 1) <= rate * T * 1.5; });
        if (!bl.length) bl = unlockedB.slice(0, 1);
        var wsum = 0, ws = bl.map(function (b, k) { var w = k + 1; wsum += w; return w; });
        var y = h2 * wsum, bi = bl.length - 1;
        for (var k = 0; k < bl.length; k++) { y -= ws[k]; if (y < 0) { bi = k; break; } }
        var b = bl[bi];
        var own = Math.floor(pos(state.buildings[b.id]));
        var budget = rate * T * C.missionBuildShare, step = 1;
        while (step < C.missionBuildMaxStep && goldSum(b.gold, own, step + 1) <= budget) step++;
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
        m.target = niceUp(Math.max(30, st.spillRate * C.missionCoinShare * T));
        break;
      case 'streak':
        m.target = nextStreak;
        break;
      case 'treasures':
        m.base = pos(state.run.treasures);
        m.target = Math.min(4, Math.max(1, Math.round(0.6 * T / ((st.treasureInterval[0] + st.treasureInterval[1]) / 2))));
        break;
      case 'gusts':
        m.base = pos(state.run.gusts);
        m.target = Math.min(6, Math.max(2, Math.round(0.5 * T / st.gustCooldown)));
        break;
      case 'gps':
        m.target = niceUp(st.baseGps * (r >= 7 ? 1.25 + 0.3 * h2 : 1.5 + 0.6 * h2));
        break;
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
      if (missionCur(state, m, st) >= m.target) { m.done = true; emit('mission', i); }
    }
  }

  function claimMission(state, idx) {
    var fail = { ok: false, rankUp: false, chests: 0 };
    if (!ok(state) || !Array.isArray(state.missions)) return fail;
    idx = Math.floor(fin(idx, -1));
    var m = state.missions[idx];
    if (!isObj(m)) return fail;
    if (!m.done && missionCur(state, m) < m.target) return fail;
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
    // replace (after rank-up so the new mission scales with the new rank)
    state.missions.splice(idx, 1);
    var nm = genMission(state);
    state.missions.splice(idx, 0, nm);
    fillMissions(state);
    if (rankUp) {
      emit('rank', state.rank);
      D.buildings.forEach(function (b) { if (b.rank === state.rank) emit('unlock', { kind: 'building', id: b.id, name: b.name }); });
      D.tiers.forEach(function (t, i) { if (i + 1 === state.rank) emit('unlock', { kind: 'tier', id: i, name: t.name }); });
    }
    return { ok: true, rankUp: rankUp, chests: gained };
  }

  // ================================================================ cards
  function rollCard() {
    var total = 0, k;
    for (k = 0; k < D.rarityOrder.length; k++) total += D.rarities[D.rarityOrder[k]].weight;
    var r = Math.random() * total, rar = D.rarityOrder[0];
    for (k = 0; k < D.rarityOrder.length; k++) { r -= D.rarities[D.rarityOrder[k]].weight; if (r < 0) { rar = D.rarityOrder[k]; break; } }
    var pool = D.cards.filter(function (c) { return c.rarity === rar; });
    if (!pool.length) pool = D.cards;
    return pool[Math.min(pool.length - 1, Math.floor(Math.random() * pool.length))].id;
  }
  function openChest(state) {
    if (!ok(state) || Math.floor(pos(state.chests)) < 1) return [];
    state.chests = Math.floor(pos(state.chests)) - 1;
    var n = fin(state.rank, 1) >= C.chestCardsRank ? C.chestCardsHigh : C.chestCardsLow;
    var out = [];
    if (!isObj(state.cards)) state.cards = {};
    for (var i = 0; i < n; i++) {
      var id = rollCard();
      state.cards[id] = Math.floor(pos(state.cards[id])) + 1;
      out.push(id);
    }
    emit('chest', out);
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
    return { id: c.id, name: c.name, rarity: c.rarity, copies: copies, level: level, nextAt: nextAt, text: text, flavor: c.flavor || '', target: c.target };
  }

  // ================================================================ prestige
  function legendOnSleep(state) {
    if (!ok(state)) return 0;
    var g = Math.floor(Math.sqrt(pos(state.earnedRun) / C.legendDiv) * (1 + 0.1 * cardLvl(state, 'legend')));
    return Math.max(0, fin(g, 0));
  }
  function canSleep(state) { return ok(state) && pos(state.earnedRun) >= C.sleepReq; }
  function sleep(state) {
    if (!canSleep(state)) return 0;
    var gained = legendOnSleep(state);
    state.stat.sleepsGold = cl(pos(state.stat.sleepsGold) + pos(state.earnedRun));
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
    state.legend = cl(pos(state.legend) + gained);
    state.sleeps = Math.floor(pos(state.sleeps)) + 1;
    state.chests = Math.floor(pos(state.chests)) + 1;
    state.missions = [];
    fillMissions(state);
    emit('sleep', gained);
    return gained;
  }

  // ================================================================ simulation
  // exact integration of the chain over dt with constant per-unit rates
  // x_j(t) = sum_{k>=j} x_k * prod_{m=j+1..k} a_m * t^(k-j)/(k-j)!
  function advanceTiers(state, dt) {
    var a = [0, 0, 0, 0, 0], x = [0, 0, 0, 0, 0], i, j, k;
    for (i = 0; i < 5; i++) {
      x[i] = pos(state.tiers[i]);
      // a locked tier still produces if owned (e.g. after a load); fine
      if (i >= 1) a[i] = tierUnitRate(state, i);
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
      if (milestoneCountTier(Math.floor(nv)) > milestoneCountTier(before)) emit('milestone', { kind: 'tier', id: j, count: Math.floor(nv) });
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
    var earned = earn(state, g, offline ? 'offline' : 'idle');
    var mins = advanceTiers(state, dt);
    var cd = st.gustCooldown > 0 ? st.gustCooldown : C.gustCooldown;
    state.gust = clamp(fin(state.gust, 0) + dt / cd, 0, 1);
    return { gold: earned, minions: mins };
  }

  function pruneEffects(state) {
    if (!Array.isArray(state.effects)) { state.effects = []; return; }
    var t = fin(state.time, 0);
    state.effects = state.effects.filter(function (e) { return isObj(e) && fin(e.until, 0) > t; });
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
      step(state, dt, false);
      state.time = cl(pos(state.time) + dt);
      pruneEffects(state);
      if (!Array.isArray(state.missions) || state.missions.length !== 3) fillMissions(state);
      updateMissions(state, stats(state));
    } catch (e) {
      try { console.error('[HOARD] tick', e); } catch (e2) { /* ignore */ }
    }
  }

  function offline(state, seconds) {
    var res = { seconds: 0, gold: 0, minions: [0, 0, 0, 0, 0] };
    if (!ok(state)) return res;
    try {
      var cap = stats(state).offlineCapHours * 3600;
      seconds = clamp(seconds, 0, cap);
      res.seconds = seconds;
      pruneEffects(state);
      if (seconds <= 0) return res;
      var steps = Math.max(1, Math.min(C.offlineSteps, Math.ceil(seconds)));
      var dt = seconds / steps;
      quiet++;
      state._noEffects = true;
      try {
        for (var i = 0; i < steps; i++) {
          var r = step(state, dt, true);
          res.gold = cl(res.gold + r.gold);
          for (var j = 0; j < 5; j++) res.minions[j] = cl(res.minions[j] + r.minions[j]);
        }
      } finally {
        delete state._noEffects;
        quiet--;
      }
      updateMissions(state, stats(state));
    } catch (e) {
      try { console.error('[HOARD] offline', e); } catch (e2) { /* ignore */ }
    }
    return res;
  }

  HOARD.engine = {
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
    // extras (not in the contract, safe to ignore)
    cardLevel: function (state, id) { return levelFor(cardCopies(state, id)); },
    milestoneMult: function (kind, owned) { return pow2(kind === 'building' ? milestoneCountBuilding(fin(owned, 0)) : milestoneCountTier(fin(owned, 0))); }
  };
})();
