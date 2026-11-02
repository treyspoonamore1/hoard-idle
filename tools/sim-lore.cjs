// Lore / Myth balance sim (SPEC-V2 section 1). A scripted player through the real engine + js/lore.js.
// Usage: node tools/sim-lore.cjs [hours=6] [profile=moderate|active|casual|all]
//   The player swipes moderately, buys greedily (the v1 sim's shop), buys lore sensibly after each Sleep,
//   sleeps when the Legend gain >= ~50% of current Legend, and Ascends once the Myth gives 2 (or after waiting 10 min).
//   env: SEED=n  reproducible Math.random      EMBER=1  also load js/ember.js (and events.js)
//        QUIET=1 only the summary              TWEAK="..." eval'd after load (e.g. "HOARD.lore.node('greed').base=2")
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let seed = +process.env.SEED || 777;
Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const files = ['js/data.js', 'js/engine.js', 'js/lore.js'];
if (process.env.EMBER) files.push('js/events.js', 'js/ember.js');
for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const H = globalThis.HOARD, E = H.engine, D = H.data, C = D.C, L = H.lore;
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

// ---------------------------------------------------------------- one profile
function run(prof) {
  const s = E.newState();
  s.auto.master = true;
  const R = { name: prof.name, T: 0, sleeps: [], myths: [], mythAvail: [], rows: [], loreAt: [] };
  const dt = 0.5, end = HOURS * 3600;
  let pool = 0, poolV = 0, nextTr = 70 + Math.random() * 60, runStart = 0, gustWait = 0, availAt = null;
  let bought = [];
  while (R.T < end) {
    if (!prof.open(R.T)) { // closed app: jump to the next open moment, offline() once
      let T2 = R.T; while (T2 < end && !prof.open(T2)) T2 += 1;
      const gap = T2 - R.T;
      if (gap > 0) { E.offline(s, gap); R.T = T2; pool = 0; poolV = 0; }
      buyLore(s, bought);
      continue;
    }
    const swiping = prof.swipe(R.T);
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
      if (n > 0) { E.coinCollected(s, n, swiping ? 3 : 1, avg * st.gustWorthMult); pool -= n; poolV -= n * avg; }
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
        buyLore(s, rec.bought);
        rec.left = s.legendPts;
        R.sleeps.push(rec);
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
    if (s.legend > +(process.env.RUNAWAY || 1e5) || R.myths.length >= +(process.env.MAXMYTHS || 99)) { R.stopped = (s.legend > +(process.env.RUNAWAY || 1e5) ? 'runaway (Legend > ' + f(+(process.env.RUNAWAY || 1e5)) + ')' : 'myth cap') + ' at ' + hm(R.T); break; }
  }
  R.final = s;
  return R;
}

const profiles = {
  // app open the whole time; swipes 30 s of every minute; checks the shop every second
  moderate: { name: 'moderate', share: 0.5, open: () => true, swipe: T => (T % 60) < 30, buys: () => true },
  active: { name: 'active', share: 1, open: () => true, swipe: () => true, buys: () => true },
  // 10 minutes of swiping every 30 minutes, app closed in between (automation runs offline)
  casual: { name: 'casual', share: 0.3, open: T => (T % 1800) < 600, swipe: () => true, buys: () => true }
};

function report(R) {
  const s = R.final;
  console.log('\n================ ' + R.name + ' (' + HOURS + ' h) ================');
  if (!QUIET) console.table(R.rows);
  console.log('Sleep | at      | run     | +Legend | Legend after | rank | lore bought right after (pts -> left)');
  R.sleeps.forEach((x, i) => {
    console.log(String(i + 1).padStart(5) + ' | ' + mm(x.t).padStart(7) + ' | ' + mm(x.run).padStart(7) + ' | ' + f(x.gain).padStart(7) + ' | ' +
      f(x.before + x.gain).padStart(12) + ' | ' + String(x.rank).padStart(4) + ' | ' + (x.bought.join(', ') || '(nothing)') + '  (' + f(x.pts) + ' -> ' + f(x.left) + ')');
  });
  const empty = R.sleeps.filter(x => !x.bought.length).length;
  console.log('Sleeps with no lore buy: ' + empty + '/' + R.sleeps.length);
  console.log('Myth available at: ' + (R.mythAvail.map(hm).join(', ') || 'never'));
  R.myths.forEach((m, i) => console.log('Ascend ' + (i + 1) + ' at ' + hm(m.t) + ' (+' + m.gained + ' Myth, Legend ' + f(m.legend) + ', waited ' + mm(m.sinceAvail) + ')'));
  if (R.stopped) console.log('stopped: ' + R.stopped);
  console.log('final: legend ' + f(s.legend) + ' (pts ' + f(s.legendPts) + '), myth ' + s.myth + ' (pts ' + s.mythPts + '), sleeps ' + s.sleeps + ', gps ' + f(E.stats(s).baseGps) + ', relics ' + JSON.stringify(s.relics));
}

for (const n of (ONLY === 'all' ? Object.keys(profiles) : ONLY.split(','))) report(run(profiles[n]));
console.log('\nNaN/Infinity/negative issues:', bad.length ? '\n  ' + bad.slice(0, 20).join('\n  ') : 'none');
