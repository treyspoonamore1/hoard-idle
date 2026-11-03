// Lore / Myth balance sim (SPEC-V2 section 1). A scripted player through the real engine + js/lore.js.
// Usage: node tools/sim-lore.cjs [hours=6] [profile=moderate|active|casual|all]
//   The player swipes moderately, buys greedily (the v1 sim's shop), buys lore sensibly after each Sleep,
//   sleeps when the Legend gain >= ~50% of current Legend, and Ascends once the Myth gives 2 (or after waiting 10 min).
//   profiles: moderate (open, swipes 30 s/min), active (always swiping), casual (10 min every 30 min),
//             casual5 (5 min of swiping every 30 min, app closed in between: offline() + offline automation)
//   env: SEED=n  reproducible Math.random      EMBER=1  also load js/ember.js and js/events.js; the sim player then
//        buys kilns / Fire Breaths (as tools/test-ember.cjs) and plays the event lair (as tools/test-events.cjs) on a
//        simulated wall clock (HOARD.events._now = sim time), so event cards feed the main game
//        NOEVENTS=1 with EMBER=1: Ember only (isolates the event cards' effect on pacing)
//        CURVE=1  instead of profiles: for Legend L = 10..1e12 (lore bought with L points, fresh run) print the minutes of
//                 active play until a Long Sleep gives +50% / +100% of L (shows whether runs shrink as Legend grows)
//        SNAP=dir writes the state right after Sleeps 1,2,3,5,8,12,16,20,30,40,60,80,100 to dir/<profile>-s<n>.json
//        PROBE=file.json (with CURVE=1): from that saved fresh-run state, minutes of active play to +50% / +100% Legend,
//                 once as saved and once per ablation (no cards / no event cards / no Myth / no relics / no Ember / no
//                 Power lore / no Legend passive) -- shows which system drives the run length
//        OFFPROBE=file.json[,...] [OFFH=8]: from a saved state, compare E.offline(OFFH h) against OFFH h of live idle ticks
//                 (app open, no swiping; automation runs in both), with Dream Keeper off / at 100% / at 25%
//        AUTOSLEEP=pct  owns-Dream-Keeper players switch it on at pct% (offline auto-sleeps are counted)
//        QUIET=1 only the summary              TWEAK="..." eval'd after load (e.g. "HOARD.lore.node('greed').base=2")
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let seed = +process.env.SEED || 777;
Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const files = ['js/data.js', 'js/engine.js', 'js/lore.js'];
if (process.env.EMBER) { if (!process.env.NOEVENTS) files.push('js/events.js'); files.push('js/ember.js'); }
for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const H = globalThis.HOARD, E = H.engine, D = H.data, C = D.C, L = H.lore, X = H.ember, EV = H.events;
const WALL0 = Date.UTC(2026, 10, 3, 8, 0, 0);
let simT = 0;
if (EV) EV._now = () => WALL0 + simT * 1000;
if (process.env.TWEAK) eval(process.env.TWEAK);
const HOURS = +process.argv[2] || 6;
const ONLY = process.argv[3] || 'moderate';
const QUIET = !!process.env.QUIET;
const f = H.fmt, mm = t => (t == null ? '-' : (t / 60).toFixed(1) + 'm'), hm = t => (t == null ? '-' : (t / 3600).toFixed(2) + 'h');
const isInt = x => Math.abs(x - Math.round(x)) < 1e-9;

const bad = [];
function scan(o, p, when) {
  if (typeof o === 'number') {
    if (!isFinite(o)) bad.push(when + ' non-finite ' + p + '=' + o);
    else if (o < 0 && !/(until|minionTier|prevTier)$/.test(p)) bad.push(when + ' negative ' + p + '=' + o);
    return;
  }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) scan(o[k], p + '.' + k, when);
}

// ---------------------------------------------------------------- greedy gold shop (same model as tools/sim.cjs)
const clone = s => JSON.parse(JSON.stringify(s));
function tierEq(s, i) { let eq = 0; for (let q = 0; q <= i; q++) eq = E.tierCost(s, q, 1).gold + (q > 0 ? D.tiers[q].prevCost * eq : 0); return eq; }
function planGold(s, t, amt) {
  const d = Math.max(0, Math.ceil(amt - s.tiers[t] - 1e-9));
  if (d === 0) return 0;
  if (!E.isUnlocked(s, 'tier', t)) return Infinity;
  let g = d * E.tierCost(s, t, 1).gold;
  if (t > 0) g += planGold(s, t - 1, d * D.tiers[t].prevCost);
  return g;
}
function ensure(s, t, amt) {
  const d = Math.max(0, Math.ceil(amt - s.tiers[t] - 1e-9));
  if (d === 0) return true;
  if (!E.isUnlocked(s, 'tier', t)) return false;
  if (t > 0 && !ensure(s, t - 1, d * D.tiers[t].prevCost)) return false;
  return E.buyTier(s, t, d);
}
function buildingPlan(s, id, n) {
  const c = E.buildingCost(s, id, n || 1);
  const extra = c.minionTier >= 0 ? planGold(s, c.minionTier, c.minions) : 0;
  return { gold: c.gold + extra, extra, c };
}
function demandSoon(s, t) {
  let n = 0;
  for (const b of D.buildings) if (b.minionTier === t && E.isUnlocked(s, 'building', b.id)) n += E.buildingCost(s, b.id, 5).minions;
  if (t + 1 < 5 && E.isUnlocked(s, 'tier', t + 1)) n += 10 * D.tiers[t + 1].prevCost;
  return n;
}
function swipeRate(s, st) { return Math.min(4, st.spillRate) * st.coinWorth * 3 + (600 / C.strokePx) * st.strokeWorth * 3; }
function model(s, prof) { const st = E.stats(s); return st.baseGps + prof.share * swipeRate(s, st) + (1 - prof.share) * st.sweepGps; }
function missionCands(s) {
  const out = [];
  for (const m of s.missions) {
    if (m.done) continue;
    if (m.tpl === 'building' && E.isUnlocked(s, 'building', m.key)) {
      const n = m.target - s.buildings[m.key];
      if (n > 0) out.push({ kind: 'mb', id: m.key, n, cost: buildingPlan(s, m.key, n).gold });
    } else if (m.tpl === 'tier' && E.isUnlocked(s, 'tier', m.key)) {
      const cost = planGold(s, m.key, m.target);
      if (isFinite(cost)) out.push({ kind: 'mt', id: m.key, n: m.target, cost });
    }
  }
  return out;
}
// Nest warmth (feel pass): building gold/s x (1 + nest / W0)^p, nest = brood counted in Eggs. A player sees the
// "x1.3 gold/s" it gives, so the sim values brood buys by the warmth they add now plus ~60 s of what they raise below.
function broodCands(s, st, inc, cands) {
  if (!(C.broodPow > 0) || !E.warmthAt) return;
  const eq = C.broodEggs, W = st.nestSize || 0, wf = E.warmthAt, w0 = wf(W);
  for (let i = 0; i < 5; i++) {
    if (!E.isUnlocked(s, 'tier', i)) continue;
    const one = planGold(s, i, s.tiers[i] + 1); if (!isFinite(one) || one <= 0) continue;
    const n = Math.max(1, Math.floor(s.gold * 0.25 / one));
    const cost = planGold(s, i, s.tiers[i] + n); if (!isFinite(cost)) continue;
    let dv = st.baseGps * (wf(W + n * eq[i] - (i > 0 ? n * D.tiers[i].prevCost * eq[i - 1] : 0)) / w0 - 1);
    if (i > 0) dv += st.baseGps * (wf(W + n * st.tierUnitRate[i] * 60 * eq[i - 1]) / w0 - 1) / 2;
    if (dv > inc * 1e-4) cands.push({ kind: 'tb', id: i, n, cost, dv });
  }
}
function shop(s, prof) {
  for (let guard = 0; guard < 400; guard++) {
    const st = E.stats(s), inc = Math.max(1e-9, model(s, prof)), cands = [];
    for (const b of D.buildings) {
      if (!E.isUnlocked(s, 'building', b.id)) continue;
      const p = buildingPlan(s, b.id, 1);
      if (!isFinite(p.gold)) continue;
      const c2 = clone(s); c2.gold = p.gold * 1.000001 + 1;
      if (p.c.minionTier >= 0) ensure(c2, p.c.minionTier, p.c.minions);
      if (!E.buyBuilding(c2, b.id, 1)) continue;
      cands.push({ kind: 'b', id: b.id, cost: p.gold, dv: model(c2, prof) - inc });
    }
    for (const u of E.upgradeList(s)) {
      if (u.bought || !u.visible) continue;
      const c2 = clone(s); c2.gold = u.cost;
      if (!E.buyUpgrade(c2, u.id)) continue;
      let dv = model(c2, prof) - inc;
      if (dv <= inc * 1e-6) dv = inc / 30;
      cands.push({ kind: 'u', id: u.id, cost: u.cost, dv });
    }
    for (let i = 1; i < 5; i++) {
      if (!E.isUnlocked(s, 'tier', i) || s.tiers[i - 1] >= demandSoon(s, i - 1)) continue;
      const cost = planGold(s, i, s.tiers[i] + 1);
      const dv = st.tierUnitRate[i] * tierEq(s, i - 1) * 0.5;
      if (dv > 0 && isFinite(cost)) cands.push({ kind: 't', id: i, cost, dv });
    }
    broodCands(s, st, inc, cands);
    let best = null;
    for (const c of cands) {
      if (!(c.dv > 0)) continue;
      c.score = Math.max(0, (c.cost - s.gold) / inc) + c.cost / c.dv;
      if (!best || c.score < best.score) best = c;
    }
    for (const c of missionCands(s)) if (c.cost <= 180 * inc) { c.score = Math.max(0, (c.cost - s.gold) / inc); if (!best || c.score <= best.score) best = c; }
    if (!best || best.cost > s.gold) break;
    let ok = false;
    if (best.kind === 'b' || best.kind === 'mb') {
      const n = best.n || 1, c = E.buildingCost(s, best.id, n);
      if (c.minionTier >= 0 && !ensure(s, c.minionTier, c.minions)) break;
      ok = E.buyBuilding(s, best.id, n);
    } else if (best.kind === 'u') ok = E.buyUpgrade(s, best.id);
    else if (best.kind === 'mt') ok = ensure(s, best.id, best.n);
    else if (best.kind === 'tb') ok = ensure(s, best.id, s.tiers[best.id] + best.n);
    else {
      const n = Math.max(1, Math.floor(s.gold * 0.25 / Math.max(best.cost, 1e-9)));
      ok = ensure(s, best.id, s.tiers[best.id] + n) || ensure(s, best.id, s.tiers[best.id] + 1);
    }
    if (!ok) break;
  }
}

// ---------------------------------------------------------------- sensible lore buyer
// value weight per node (how much a thoughtful player wants it), divided by cost; the best ratio is bought first.
const WANT = {
  greed: 1.0, halls: 1.3, clutches: 0.8, dreams: 1.4, bargain: 0.8, talons: 0.6, magpie: 0.5, watch: 0.15,
  start_gold: 1.6, start_rank: 1.3, start_brood: 0.8, keep_claws: 0.9, keep_broom: 0.5,
  auto_dig: 0.9, auto_build: 0.9, auto_brood: 0.7, auto_quest: 0.9, auto_chest: 0.8, auto_gust: 0.6, auto_upg: 0.7, auto_sleep: 0.05,
  wake_ember: 0.6, myth_gate: 0
};
const NOLORE = !!process.env.NOLORE, ONLYLORE = process.env.ONLYLORE ? process.env.ONLYLORE.split(',') : null;
const MINRUN = process.env.MINRUN != null ? +process.env.MINRUN : 90; // a person does not Sleep every few seconds
const SLEEPPCT = process.env.SLEEPPCT != null ? +process.env.SLEEPPCT : 50;
function buyLore(s, bought) {
  if (NOLORE) return;
  for (let g = 0; g < 200; g++) {
    // save up for the Myth gate once Legend gets close to the Myth threshold
    const gateNeeded = !L.mythGated(s) && s.legend >= Math.min(0.5 * L.mythNeed(s), 3 * L.cost(s, 'myth_gate'));
    if (gateNeeded) {
      if (L.canBuy(s, 'myth_gate')) { L.buy(s, 'myth_gate'); bought.push('myth_gate'); continue; }
    }
    const reserve = gateNeeded ? L.cost(s, 'myth_gate') : 0;
    let best = null;
    for (const n of L.nodes) {
      const c = L.cost(s, n.id);
      if (c === null || !L.reqMet(s, n.id) || !(WANT[n.id] > 0)) continue;
      if (ONLYLORE && ONLYLORE.indexOf(n.id) < 0) continue;
      if (s.legendPts - c < reserve - 1e-9) continue;
      if (c > s.legendPts) continue;
      // unlock-chain nodes also carry value for what they open
      const w = WANT[n.id] / c;
      if (!best || w > best.w) best = { id: n.id, w };
    }
    if (!best) break;
    if (!L.buy(s, best.id)) break;
    bought.push(best.id + (L.level(s, best.id) > 1 ? ':' + L.level(s, best.id) : ''));
  }
  // relics: cheapest affordable, Saga Stone first
  for (let g = 0; g < 20; g++) {
    const order = ['r_legend', 'r_start', 'r_keep', 'r_cards', 'r_time', 'r_ember'];
    const id = order.find(r => L.canBuyRelic(s, r));
    if (!id) break;
    L.buyRelic(s, id); bought.push(id);
  }
}

// ---------------------------------------------------------------- Ember and event players (EMBER=1)
function buyEmber(s) {
  if (!X || !X.isAwake(s)) return;
  for (let g = 0; g < 300; g++) {
    const open = X.breathList(s).filter(b => !b.bought);
    const aff = open.filter(b => b.affordable);
    if (aff.length) { X.buyBreath(s, aff[0].id); continue; }
    if (open.length && open[0].cost < X.rate(s) * 300) break;
    let best = -1, bv = 0;
    for (let k = 0; k < 4; k++) {
      if (!X.kilnVisible(s, k)) continue;
      const c = X.kilnCost(s, k, 1).embers;
      if (c > X.embers(s)) continue;
      const v = X.kilnEach(s, k) / c;
      if (v > bv) { bv = v; best = k; }
    }
    if (best < 0) break;
    X.buyKiln(s, best, 1);
  }
}
function playEvents(s, R) {
  if (!EV || !EV.active(s)) return;
  while (EV.questInfo(s).done) { EV.claimQuest(s); R.evClaims.push(simT); }
  while (s.events.chests > 0) EV.openChest(s);
  const q = EV.QUESTS[s.events.q];
  if (q && q.kind === 'own' && s.events.units[q.k] < q.n) EV.buyUnit(s, q.k, Math.min(q.n - Math.floor(s.events.units[q.k]), EV.unitMax(s, q.k)));
  for (let k = 3; k >= 0; k--) { if (q && q.kind === 'own' && k < q.k && s.events.units[q.k] < q.n) continue; EV.buyUnit(s, k, 'max'); }
}
const AUTOSLEEP = process.env.AUTOSLEEP ? +process.env.AUTOSLEEP : 0;

// ---------------------------------------------------------------- one profile
function run(prof) {
  const s = E.newState();
  s.auto.master = true;
  const R = { name: prof.name, T: 0, sleeps: [], myths: [], mythAvail: [], rows: [], loreAt: [], lt: {}, evClaims: [], off: [], warm: {}, wake: null };
  const dt = 0.5, end = HOURS * 3600;
  let pool = 0, poolV = 0, nextTr = 70 + Math.random() * 60, runStart = 0, gustWait = 0, availAt = null;
  let bought = [];
  while (R.T < end) {
    if (!prof.open(R.T)) { // closed app: jump to the next open moment, offline() once
      let T2 = R.T; while (T2 < end && !prof.open(T2)) T2 += 1;
      const gap = T2 - R.T;
      if (gap > 0) {
        const st0 = E.stats(s), sl0 = s.sleeps, er0 = s.earnedRun, L0 = s.legend;
        simT = T2;
        const res = E.offline(s, gap);
        R.off.push({ t: T2, sec: res.seconds, gold: res.gold, gps0: st0.baseGps, gps1: E.stats(s).baseGps, sleeps: s.sleeps - sl0, legend0: L0, legend1: s.legend, er0 });
        R.T = T2; pool = 0; poolV = 0;
        scan(s, 'state', prof.name + '@offline' + T2);
      }
      buyLore(s, bought);
      continue;
    }
    const swiping = prof.swipe(R.T);
    simT = R.T;
    s._caveActive = true;
    E.tick(s, dt);
    const st = E.stats(s);
    pool += st.spillRate * dt; poolV += st.spillRate * dt;
    if (pool > C.maxCoins) pool = C.maxCoins;
    if (swiping) {
      const take = Math.min(pool, 4 * dt);
      if (take > 0) { const avg = poolV / pool; E.coinCollected(s, take, 3, avg); poolV -= take * avg; pool -= take; }
      E.strokeCollected(s, 600 * dt, 3);
      E.noteStreak(s, isInt(R.T / 60) ? st.maxStreak : 3);
    }
    // gusts: the swiping player flicks whenever ready; Restless Wings fires on its own (8 coins or 10 s)
    const autoG = L.nodeOn(s, 'auto_gust');
    if (E.gustReady(s)) gustWait += dt; else gustWait = 0;
    if (E.gustReady(s) && (swiping || (autoG && (pool >= 8 || gustWait >= 10))) && E.useGust(s)) {
      const n = Math.floor(pool), avg = n > 0 ? poolV / pool : 0;
      const gv = avg * (1 + (st.gustWorthMult - 1) * Math.min(n, C.gustBonusCoins || n) / Math.max(1, n)); // x3 on <= gustBonusCoins
      if (n > 0) { E.coinCollected(s, n, swiping ? 3 : 1, gv); pool -= n; poolV -= n * avg; }
      const fl = Math.max(0, (C.gustFloorCoins || 0) - n);
      if (fl > 0) E.coinCollected(s, fl, swiping ? 3 : 1, st.gustWorthMult);
      gustWait = 0;
    }
    if (st.sweepRate > 0 && pool > 0) {
      const n = Math.min(pool, st.sweepRate * dt), avg = poolV / pool;
      E.sweepCollect(s, n * avg); pool -= n; poolV -= n * avg;
    }
    if (pool < 1e-9) { pool = 0; poolV = 0; }
    if (R.T >= nextTr) {
      if (swiping) { const r = E.grabTreasure(s); if (r.spawnCoins) { pool = Math.min(C.maxCoins, pool + r.spawnCoins); poolV += r.spawnCoins; } }
      const iv = st.treasureInterval; nextTr = R.T + iv[0] + Math.random() * (iv[1] - iv[0]);
    }
    R.T += dt;
    if (isInt(R.T)) { // ---- player decisions once per second
      for (let i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { E.claimMission(s, i); i = -1; }
      while (s.chests > 0) E.openChest(s);
      if (prof.buys(R.T)) shop(s, prof);
      buyLore(s, bought);
      if (AUTOSLEEP && L.level(s, 'auto_sleep') > 0 && !s.auto.sleep) { s.auto.sleep = true; s.auto.sleepPct = AUTOSLEEP; }
      buyEmber(s); playEvents(s, R);
      if (X && X.isAwake(s)) {
        if (R.wake == null) R.wake = R.T;
        for (const m of [600, 3600, 10800]) if (R.warm[m] == null && R.T - R.wake >= m) R.warm[m] = X.warmth(s);
      }
      if (L.canAscend(s) && availAt == null) { availAt = R.T; R.mythAvail.push(R.T); }
      const mg = L.mythOnAscend(s);
      if (L.canAscend(s) && (mg >= 2 || R.T - availAt >= 600)) {
        R.myths.push({ t: R.T, gained: mg, legend: s.legend, sinceAvail: R.T - availAt });
        R.loreAt.push({ t: R.T, what: 'ASCEND +' + mg + ' Myth', bought: bought }); bought = [];
        L.ascend(s); availAt = null; runStart = R.T; pool = 0; poolV = 0;
        buyLore(s, bought);
        continue;
      }
      const gain = E.legendOnSleep(s);
      if (E.canSleep(s) && gain >= Math.max(3, SLEEPPCT / 100 * s.legend) && R.T - runStart >= MINRUN) {
        const rec = { t: R.T, run: R.T - runStart, gain, before: s.legend, rank: s.rank, pts: 0, bought: [] };
        R.loreAt.push({ t: R.T, what: 'pre-sleep', bought: bought }); bought = [];
        E.sleep(s); runStart = R.T; pool = 0; poolV = 0;
        rec.pts = s.legendPts;
        for (const th of [100, 1000, 10000]) if (s.legend >= th && R.lt[th] == null && !R.myths.length) R.lt[th] = R.T;
        buyLore(s, rec.bought);
        rec.left = s.legendPts;
        R.sleeps.push(rec);
        if (process.env.SNAP && /^(1|2|3|5|8|12|16|20|30|40|60|80|100)$/.test(String(R.sleeps.length))) {
          try { fs.mkdirSync(process.env.SNAP, { recursive: true }); fs.writeFileSync(path.join(process.env.SNAP, prof.name + '-s' + R.sleeps.length + '.json'), E.serialize(s)); } catch (e) { /* ignore */ }
        }
      }
    }
    if (process.env.DEBUGL && s.legend >= +process.env.DEBUGL && !R.dbgDone && isInt(R.T / 5)) {
      const g1 = E.stats(s);
      console.log('dbg t+' + (R.T - runStart).toFixed(0) + 's gold ' + f(s.gold) + ' earned ' + f(s.earnedRun) + ' need ' + f(Math.pow(0.5 * s.legend / g1.M.legendGainMult, 2) * 1e6) + ' gps ' + f(g1.baseGps) + ' coin ' + f(g1.coinWorth) + ' swipe/s ' + f(swipeRate(s, g1)) + ' rank ' + s.rank + ' b ' + D.buildings.map(b => s.buildings[b.id]).join('/') + ' t ' + s.tiers.map(f).join('/') + ' all ' + f(g1.M.allMult) + ' gm ' + f(g1.M.gpsMult) + ' cm ' + f(g1.M.coinMult) + ' lgm ' + g1.M.legendGainMult.toFixed(2));
      if (R.T - runStart < 1) R.dbgStarted = (R.dbgStarted || 0) + 1;
      if (R.dbgStarted >= 2) R.dbgDone = true;
    }
    if (isInt(R.T / 1800)) {
      const g1 = E.stats(s);
      R.rows.push({ h: (R.T / 3600).toFixed(1), gold: f(s.gold), gps: f(g1.baseGps), rank: s.rank, legend: f(s.legend), pts: f(s.legendPts), myth: s.myth, sleeps: s.sleeps,
        lore: Object.keys(s.lore).filter(k => s.lore[k] > 0).map(k => k + (s.lore[k] > 1 ? s.lore[k] : '')).join(' ') });
    }
    if (isInt(R.T / 30)) { scan(s, 'state', prof.name + '@' + R.T); scan(E.stats(s), 'stats', prof.name + '@' + R.T); }
    if (bad.length > 20) break;
    if (s.legend > +(process.env.RUNAWAY || 1e250) || R.myths.length >= +(process.env.MAXMYTHS || 99)) { R.stopped = (s.legend > +(process.env.RUNAWAY || 1e250) ? 'runaway (Legend > ' + f(+(process.env.RUNAWAY || 1e250)) + ')' : 'myth cap') + ' at ' + hm(R.T); break; }
  }
  R.final = s;
  return R;
}

const profiles = {
  // app open the whole time; swipes 30 s of every minute; checks the shop every second
  moderate: { name: 'moderate', share: 0.5, open: () => true, swipe: T => (T % 60) < 30, buys: () => true },
  active: { name: 'active', share: 1, open: () => true, swipe: () => true, buys: () => true },
  // 10 minutes of swiping every 30 minutes, app closed in between (automation runs offline)
  casual: { name: 'casual', share: 0.3, open: T => (T % 1800) < 600, swipe: () => true, buys: () => true },
  // 5 minutes of swiping every 30 minutes
  casual5: { name: 'casual5', share: 0.3, open: T => (T % 1800) < 300, swipe: () => true, buys: () => true }
};

function report(R) {
  const s = R.final;
  if (process.env.SUMMARY) {
    const gaps = R.sleeps.slice(0, 10).map(x => (x.run / 60).toFixed(0)).join(',');
    console.log((process.env.LABEL || '') + ' | S1 ' + mm(R.sleeps[0] && R.sleeps[0].t) + ' runs ' + gaps + ' | mythAvail ' + (R.mythAvail.map(hm).join(',') || 'never') +
      ' | L100/1K/10K ' + [100, 1000, 10000].map(k => hm(R.lt[k])).join('/') + ' | asc ' + R.myths.map(m => hm(m.t) + '+' + m.gained).join(',') + ' | L ' + f(s.legend) + ' myth ' + s.myth + ' sleeps ' + s.sleeps + (R.stopped ? ' | ' + R.stopped : '') +
      ' | empty ' + R.sleeps.filter(x => !x.bought.length).length);
    return;
  }
  console.log('\n================ ' + R.name + ' (' + HOURS + ' h) ================');
  if (!QUIET) console.table(R.rows);
  console.log('Sleep | at      | run     | +Legend | Legend after | rank | lore bought right after (pts -> left)');
  R.sleeps.forEach((x, i) => {
    console.log(String(i + 1).padStart(5) + ' | ' + mm(x.t).padStart(7) + ' | ' + mm(x.run).padStart(7) + ' | ' + f(x.gain).padStart(7) + ' | ' +
      f(x.before + x.gain).padStart(12) + ' | ' + String(x.rank).padStart(4) + ' | ' + (x.bought.join(', ') || '(nothing)') + '  (' + f(x.pts) + ' -> ' + f(x.left) + ')');
  });
  const empty = R.sleeps.filter(x => !x.bought.length).length;
  console.log('Sleeps with no lore buy: ' + empty + '/' + R.sleeps.length + (s.sleeps > R.sleeps.length ? '  (+' + (s.sleeps - R.sleeps.length) + ' Dream Keeper sleeps)' : ''));
  // pacing digest (SPEC-V2 1: Sleep 2 ~20-25 min after Sleep 1, sleeps 3-6 each 12-20 min, Myth 1 ~3-5 h)
  const runs = R.sleeps.map(x => x.run / 60), med = a => { const b = a.slice().sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const floor = R.sleeps.filter(x => x.run <= MINRUN + 1).length;
  console.log('pacing: Sleep1 ' + mm(R.sleeps[0] && R.sleeps[0].t) + ' | run2 ' + (runs[1] != null ? runs[1].toFixed(1) + 'm' : '-') +
    ' | runs3-6 ' + runs.slice(2, 6).map(r => r.toFixed(1)).join('/') + 'm | median run after 6: ' + (med(runs.slice(6)) != null ? med(runs.slice(6)).toFixed(1) + 'm' : '-') +
    ' | runs at the ' + MINRUN + 's floor: ' + floor + '/' + R.sleeps.length + ' | first at floor: Sleep ' + (R.sleeps.findIndex(x => x.run <= MINRUN + 1) + 1));
  console.log('first choices: ' + R.sleeps.slice(0, 3).map((x, i) => 'S' + (i + 1) + '[' + (x.bought.join(' ') || '-') + ']').join(' ') +
    ' | first automation at Sleep ' + (R.sleeps.findIndex(x => x.bought.some(b => /^auto_/.test(b))) + 1));
  if (X) console.log('Ember: woke at ' + hm(R.wake) + ', warmth +10m x' + (R.warm[600] || 0).toFixed(2) + ', +1h x' + (R.warm[3600] || 0).toFixed(2) + ', +3h x' + (R.warm[10800] || 0).toFixed(2) + ', final x' + X.warmth(s).toFixed(2));
  if (EV) console.log('Event: quests claimed at (h) ' + (R.evClaims.map(t => (t / 3600).toFixed(1)).join(' ') || '-') + ' | step ' + (s.events ? s.events.q : '-') + '/10');
  if (R.off.length) {
    const offG = R.off.reduce((a, o) => a + o.gold, 0), mx = R.off.reduce((a, o) => Math.max(a, o.sec > 0 ? o.gold / o.sec / Math.max(1e-9, o.gps0) : 0), 0);
    const offS = R.off.reduce((a, o) => a + o.sleeps, 0);
    console.log('offline: ' + R.off.length + ' returns, gold/s while away up to x' + mx.toFixed(1) + ' of the gold/s at leaving (automation keeps buying), ' + offS + ' Dream Keeper sleeps while away' +
      (offS ? ', biggest Legend jump away x' + R.off.reduce((a, o) => Math.max(a, o.legend0 > 0 ? o.legend1 / o.legend0 : 1), 1).toFixed(1) : ''));
  }
  console.log('Myth available at: ' + (R.mythAvail.map(hm).join(', ') || 'never'));
  R.myths.forEach((m, i) => console.log('Ascend ' + (i + 1) + ' at ' + hm(m.t) + ' (+' + m.gained + ' Myth, Legend ' + f(m.legend) + ', waited ' + mm(m.sinceAvail) + ')'));
  if (R.stopped) console.log('stopped: ' + R.stopped);
  console.log('final: legend ' + f(s.legend) + ' (pts ' + f(s.legendPts) + '), myth ' + s.myth + ' (pts ' + s.mythPts + '), sleeps ' + s.sleeps + ', gps ' + f(E.stats(s).baseGps) + ', relics ' + JSON.stringify(s.relics));
}

function timeTo(s, Lg, prof) {
  let t = 0, t50 = null, t100 = null, g5 = null;
  while (t < 3600 && t100 == null) {
    s._caveActive = true; E.tick(s, 0.5);
    const st = E.stats(s);
    E.coinCollected(s, Math.min(4, st.spillRate) * 0.5, 3, 1); E.strokeCollected(s, 300, 3);
    t += 0.5;
    if (isInt(t)) {
      for (let i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { E.claimMission(s, i); i = -1; }
      while (s.chests > 0) E.openChest(s);
      shop(s, prof);
      const g = E.canSleep(s) ? E.legendOnSleep(s) : 0;
      if (t50 == null && g >= 0.5 * Lg) t50 = t;
      if (t100 == null && g >= Lg) t100 = t;
      if (t === 300) g5 = g;
    }
  }
  const m = x => (x == null ? '>60' : (x / 60).toFixed(1));
  return m(t50).padStart(6) + ' | ' + m(t100).padStart(6) + ' | gain@5min ' + (g5 / Lg).toFixed(2) + ' L';
}
function probe(file) {
  const base = fs.readFileSync(file, 'utf8');
  const s0 = E.deserialize(base);
  console.log(path.basename(file) + ': Legend ' + f(s0.legend) + ', myth ' + s0.myth + ', cards ' + Object.keys(s0.cards).length + ' (' + Object.values(s0.cards).reduce((a, b) => a + b, 0) + ' copies), warmth x' + (X ? X.warmth(s0).toFixed(2) : '-') + ', lore ' + JSON.stringify(s0.lore));
  const power = ['greed', 'halls', 'clutches', 'dreams', 'bargain', 'talons', 'magpie'];
  const abl = {
    'as saved': s => s,
    'no cards': s => { s.cards = {}; },
    'no event cards': s => { for (const k of Object.keys(s.cards)) if (/^ev_/.test(k)) delete s.cards[k]; },
    'no v1 cards': s => { for (const k of Object.keys(s.cards)) if (!/^ev_/.test(k)) delete s.cards[k]; },
    'no Myth': s => { s.myth = 0; },
    'no relics': s => { s.relics = {}; },
    'no Ember': s => { if (s.ember) s.ember.awake = false; s.lore.wake_ember = 0; },
    'no Power lore': s => { for (const k of power) s.lore[k] = 0; },
    'no Legend passive': s => { s._noLegendPassive = true; }
  };
  console.log('ablation            | min +50% | +100% | ');
  for (const k of Object.keys(abl)) {
    const s = E.deserialize(base); abl[k](s); E.dirty();
    const Lg = s0.legend;
    if (s._noLegendPassive && !globalThis.__pnl) { globalThis.__pnl = 1; E.addModSource('probe-nolegend', (q, M) => { if (q._noLegendPassive) M.allMult /= 1 + C.legendPer * q.legend; }); }
    console.log(k.padEnd(19) + ' | ' + timeTo(s, Lg, profiles.active));
  }
}
function curve() {
  if (process.env.PROBE) { for (const p of process.env.PROBE.split(',')) probe(p); return; }
  const prof = profiles.active;
  console.log('Legend L | lore bought with L | min to +50% L | min to +100% L | Legend gain at 5 min');
  for (let e = 1; e <= 12; e++) {
    const Lg = Math.pow(10, e), s = E.newState();
    s.auto.master = true; s.legend = Lg; s.legendPts = Lg; s.sleeps = 1;
    const b = []; buyLore(s, b);
    E.resetRun(s, 'sleep');
    const lore = Object.keys(s.lore).filter(k => s.lore[k] > 0).length;
    let t = 0, t50 = null, t100 = null, g5 = null;
    while (t < 3600 && t100 == null) {
      s._caveActive = true; E.tick(s, 0.5);
      const st = E.stats(s);
      E.coinCollected(s, Math.min(4, st.spillRate) * 0.5, 3, 1); E.strokeCollected(s, 300, 3);
      t += 0.5;
      if (isInt(t)) {
        for (let i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { E.claimMission(s, i); i = -1; }
        while (s.chests > 0) E.openChest(s);
        shop(s, prof);
        const g = E.canSleep(s) ? E.legendOnSleep(s) : 0;
        if (t50 == null && g >= 0.5 * Lg) t50 = t;
        if (t100 == null && g >= Lg) t100 = t;
        if (t === 300) g5 = g;
      }
    }
    console.log(f(Lg).padStart(8) + ' | ' + String(lore).padStart(18) + ' | ' + (t50 == null ? '>60' : (t50 / 60).toFixed(1)).padStart(13) + ' | ' + (t100 == null ? '>60' : (t100 / 60).toFixed(1)).padStart(14) + ' | ' + f(g5 || 0) + ' (' + (g5 / Lg).toFixed(2) + ' L)');
  }
}
function offProbe(file) {
  const base = fs.readFileSync(file, 'utf8'), sec = (+process.env.OFFH || 8) * 3600;
  console.log(path.basename(file) + ' (' + sec / 3600 + ' h away)');
  console.log('Dream Keeper | mode    | earnedRun x | Legend before -> after | sleeps | gold/s after | issues');
  for (const ds of [0, 100, 25]) {
    for (const mode of ['offline', 'live']) {
      const s = E.deserialize(base);
      s.auto.master = true;
      if (ds) { s.lore.auto_sleep = 1; s.auto.sleep = true; s.auto.sleepPct = ds; } else s.auto.sleep = false;
      E.dirty();
      const er0 = Math.max(1, s.earnedRun), L0 = s.legend, sl0 = s.sleeps;
      if (mode === 'offline') E.offline(s, sec);
      else for (let t = 0; t < sec; t++) { s._caveActive = false; E.tick(s, 1); }
      const nb = bad.length; scan(s, 'state', 'offprobe');
      console.log(String(ds ? ds + '%' : 'off').padEnd(12) + ' | ' + mode.padEnd(7) + ' | ' + f(s.earnedRun / er0).padStart(11) + ' | ' + (f(L0) + ' -> ' + f(s.legend)).padStart(22) + ' | ' + String(s.sleeps - sl0).padStart(6) + ' | ' + f(E.stats(s).baseGps).padStart(12) + ' | ' + (bad.length - nb));
    }
  }
}
if (process.env.OFFPROBE) { for (const p of process.env.OFFPROBE.split(',')) offProbe(p); }
else if (process.env.CURVE) curve();
else for (const n of (ONLY === 'all' ? Object.keys(profiles) : ONLY.split(','))) report(run(profiles[n]));
console.log('\nNaN/Infinity/negative issues:', bad.length ? '\n  ' + bad.slice(0, 20).join('\n  ') : 'none');
