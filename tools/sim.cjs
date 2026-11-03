// Headless balance sim for Hoard: three player profiles through the real engine API (dt = 0.5 s).
// Usage: node tools/sim.cjs [hours=3] [profile=all|active,casual,idle,mixed]
//   FIXES=1  applies the reviewer's recommended balance package in memory (see FIX_PATCH / FIX_TWEAK below)
//   env: SEED=n            reproducible Math.random (treasures, chests)
//        TWEAK="D.C.legendDiv=1e7"            eval'd after load (data constants)
//        PATCH="s => s.replace('a', 'b')"     rewrites engine.js source in memory (game files untouched)
//        MAXSLEEPS=n       stop taking Long Sleeps after n      QUIET=1  no timeline tables
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let seed = +process.env.SEED || 777;
Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// recommended package (balance review 2026-11): coinWorth gps-term w/o claws & legend double-count, broom coins count
// for "collect coins" missions, gust missions halved; building gps/moon/elder prices; treasure missions from rank 3
const FIX_PATCH = s => s
  .replace('(1 + C.coinGpsPct * gps + agg.scales * gps) * agg.coinMult', '(agg.coinMult + (C.coinGpsPct + agg.scales) * gps / legendMult(state))')
  .replace('if (offline || !state._caveActive) g += st.sweepGps * dt;', 'if (offline || !state._caveActive) { g += st.sweepGps * dt; state.run.coins += Math.min(st.sweepRate, st.spillRate) * dt; }')
  .replace("return earn(state, cl(s.coinWorth * pos(valueMult)), 'sweep');", "state.run.coins = cl(pos(state.run.coins) + 1); return earn(state, cl(s.coinWorth * pos(valueMult)), 'sweep');")
  .replace('Math.min(12, Math.max(2, Math.round(T / st.gustCooldown)))', 'Math.min(6, Math.max(2, Math.round(0.5 * T / st.gustCooldown)))');
const FIX_TWEAK = "D.buildings[1].gps=1; D.buildings[2].gps=6; D.buildings[3].gps=40; D.buildings[4].gps=320; D.buildings[5].gps=3500; D.buildings[5].gold=3e6; D.tiers[4].gold=6e5; var tt=D.missionTemplates.find(t=>t.tpl==='treasures'); tt.weight=0.3; tt.minRank=3;";
const patch = process.env.PATCH ? eval(process.env.PATCH) : (process.env.FIXES ? FIX_PATCH : null);
for (const f of ['js/data.js', 'js/engine.js']) {
  let src = fs.readFileSync(path.join(root, f), 'utf8');
  if (patch && f === 'js/engine.js') { const p2 = patch(src); if (p2 === src) { console.error('PATCH did not change engine.js'); process.exit(2); } src = p2; }
  vm.runInThisContext(src, { filename: f });
}
const H = globalThis.HOARD, E = H.engine, D = H.data, C = D.C;
if (process.env.FIXES && !process.env.TWEAK) eval(FIX_TWEAK);
if (process.env.TWEAK) eval(process.env.TWEAK);
const HOURS = +process.argv[2] || 3;
const ONLY = process.argv[3] || 'all';
const QUIET = !!process.env.QUIET;
const MAXSLEEPS = process.env.MAXSLEEPS != null ? +process.env.MAXSLEEPS : 1e9;
const f = H.fmt, mm = t => (t == null ? '-' : (t / 60).toFixed(1) + 'm');
const isInt = x => Math.abs(x - Math.round(x)) < 1e-9;

// ---------------------------------------------------------------- NaN / Infinity / negative hunting
const bad = [];
function scan(o, p, when) {
  if (typeof o === 'number') {
    if (!isFinite(o)) bad.push(when + ' non-finite ' + p + '=' + o);
    else if (o < 0 && !/(until|minionTier|prevTier)$/.test(p)) bad.push(when + ' negative ' + p + '=' + o);
    return;
  }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) scan(o[k], p + '.' + k, when);
}

// ---------------------------------------------------------------- chain helpers
const clone = s => JSON.parse(JSON.stringify(s));
function tierEq(s, i) { let eq = 0; for (let q = 0; q <= i; q++) eq = E.tierCost(s, q, 1).gold + (q > 0 ? D.tiers[q].prevCost * eq : 0); return eq; }
function planGold(s, t, amt) { // gold needed to have `amt` of tier t, buying the missing chain bottom-up
  const d = Math.max(0, Math.ceil(amt - s.tiers[t] - 1e-9));
  if (d === 0) return 0;
  if (!E.isUnlocked(s, 'tier', t)) return Infinity;
  let g = d * E.tierCost(s, t, 1).gold;
  if (t > 0) g += planGold(s, t - 1, d * D.tiers[t].prevCost);
  return g;
}
function ensure(s, t, amt, M) {
  const d = Math.max(0, Math.ceil(amt - s.tiers[t] - 1e-9));
  if (d === 0) return true;
  if (!E.isUnlocked(s, 'tier', t)) return false;
  if (t > 0 && !ensure(s, t - 1, d * D.tiers[t].prevCost, M)) return false;
  const g = d * E.tierCost(s, t, 1).gold;
  const ok = E.buyTier(s, t, d);
  if (ok && M) M.tierGold += g;
  return ok;
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

// ---------------------------------------------------------------- income model (values purchases per profile)
function swipeRate(s, st) {
  const coins = Math.min(4, st.spillRate);
  return coins * st.coinWorth * 3 + (600 / C.strokePx) * st.strokeWorth * 3;
}
function treasureRate(s, st, share) {
  const iv = (st.treasureInterval[0] + st.treasureInterval[1]) / 2;
  const v = 0.35 * (C.frenzyMult - 1) * st.baseGps * C.frenzyDur + 0.25 * Math.min(0.15 * s.gold + 13, 900 * st.baseGps) +
    0.2 * (C.emberMult - 1) * swipeRate(s, st) * C.emberDur * 0.9 + 0.12 * C.swarmCoins * st.coinWorth * 3;
  return share * v / iv;
}
function model(s, prof) {
  const st = E.stats(s);
  return st.baseGps + prof.share * swipeRate(s, st) + treasureRate(s, st, prof.share) + (1 - prof.share) * st.sweepGps;
}

// ---------------------------------------------------------------- greedy shop: min(wait + payback), mission-aware
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
function shop(s, prof, R, M) {
  for (let guard = 0; guard < 400; guard++) {
    const st = E.stats(s);
    const inc = Math.max(1e-9, model(s, prof));
    const cands = [];
    for (const b of D.buildings) {
      if (!E.isUnlocked(s, 'building', b.id)) continue;
      const p = buildingPlan(s, b.id, 1);
      if (!isFinite(p.gold)) continue;
      const c2 = clone(s); c2.gold = p.gold * 1.000001 + 1;
      if (p.c.minionTier >= 0) ensure(c2, p.c.minionTier, p.c.minions);
      if (!E.buyBuilding(c2, b.id, 1)) continue;
      cands.push({ kind: 'b', id: b.id, cost: p.gold, extra: p.extra, dv: model(c2, prof) - inc, c: p.c });
    }
    for (const u of E.upgradeList(s)) {
      if (u.bought || !u.visible) continue;
      const c2 = clone(s); c2.gold = u.cost;
      if (!E.buyUpgrade(c2, u.id)) continue; // req not met
      let dv = model(c2, prof) - inc;
      if (dv <= inc * 1e-6) dv = inc / 30; // utility upgrades: worth ~30 s of income
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
    // missions: a player finishes "own N" missions when it costs <= 3 min of income
    for (const c of missionCands(s)) {
      if (c.cost <= 180 * inc) { c.score = Math.max(0, (c.cost - s.gold) / inc); if (!best || c.score <= best.score) best = c; }
    }
    if (!best || best.cost > s.gold) break;
    let ok = false;
    if (best.kind === 'b' || best.kind === 'mb') {
      const n = best.n || 1, c = E.buildingCost(s, best.id, n);
      if (c.minionTier >= 0) {
        const extra = planGold(s, c.minionTier, c.minions);
        M.minionGoldForBuildings += extra; M.minionNeed += c.minions; M.minionFromStock += Math.min(s.tiers[c.minionTier], c.minions);
        if (extra > 0.1 * c.gold) M.minionLimitedBuys++;
        if (!ensure(s, c.minionTier, c.minions, M)) break;
      }
      ok = E.buyBuilding(s, best.id, n);
      if (ok) { M.goldOnBuildings += c.gold; M.buys++; if (M.firstB[best.id] == null) M.firstB[best.id] = R.T; }
    } else if (best.kind === 'u') {
      ok = E.buyUpgrade(s, best.id);
      if (ok) M.upgradeAt[best.id] = R.T;
    } else if (best.kind === 'mt') {
      ok = ensure(s, best.id, best.n, M);
    } else if (best.kind === 'tb') {
      ok = ensure(s, best.id, s.tiers[best.id] + best.n, M);
    } else {
      const n = Math.max(1, Math.floor(s.gold * 0.25 / Math.max(best.cost, 1e-9)));
      ok = ensure(s, best.id, s.tiers[best.id] + n, M) || ensure(s, best.id, s.tiers[best.id] + 1, M);
    }
    if (!ok) break;
    R.lastBuy = R.T;
  }
  for (let i = 0; i < 5; i++) if (s.tiers[i] > 0 && M.firstT[i] == null) M.firstT[i] = R.T;
}
function anyAffordable(s) {
  for (const b of D.buildings) if (E.isUnlocked(s, 'building', b.id) && buildingPlan(s, b.id, 1).gold <= s.gold) return true;
  for (const u of E.upgradeList(s)) if (u.visible && u.affordable) return true;
  return false;
}

// ---------------------------------------------------------------- one profile
function newRunMetrics(T) {
  return { start: T, rankAt: { 1: T }, firstB: {}, firstT: {}, upgradeAt: {}, sleepAvail: null, tierGold: 0, minionGoldForBuildings: 0,
    minionNeed: 0, minionFromStock: 0, minionLimitedBuys: 0, buys: 0, goldOnBuildings: 0,
    src: { idle: 0, coin: 0, stroke: 0, gust: 0, sweep: 0, treasure: 0, offline: 0 }, dead: { cur: 0, max: 0, at: 0, list: [] }, maxGap: 0, maxGapAt: 0 };
}
function run(prof) {
  const s = E.newState();
  const R = { name: prof.name, T: 0, runs: [newRunMetrics(0)], sleeps: [], rows: [], lastBuy: 0, offlineRes: null, missionLife: {} };
  const dt = 0.5, end = HOURS * 3600;
  let pool = 0, poolV = 0, nextTr = 70 + Math.random() * 60, offlineDone = false, win0 = { gps: 0 };
  const M = () => R.runs[R.runs.length - 1];
  const addSrc = (k, g) => { M().src[k] += g; };
  while (R.T < end) {
    if (prof.offlineAt != null && !offlineDone && R.T >= prof.offlineAt) { // ---- the 8 h gap (not counted in play time)
      offlineDone = true;
      const st0 = E.stats(s), o = { at: R.T, gpsBefore: st0.baseGps, sweepGps: st0.sweepGps, goldBefore: s.gold, earnedBefore: s.earnedRun, tiersBefore: s.tiers.slice(), rank: s.rank, bBefore: D.buildings.map(b => s.buildings[b.id]).join('/') };
      const r = E.offline(s, prof.offlineSec);
      Object.assign(o, { sec: r.seconds, gold: r.gold, tiersAfter: s.tiers.slice() });
      addSrc('offline', r.gold);
      scan(s, 'state', 'offline-gap');
      shop(s, prof, R, M());
      Object.assign(o, { gpsAfterBuy: E.stats(s).baseGps, goldAfterBuy: s.gold, bAfter: D.buildings.map(b => s.buildings[b.id]).join('/') });
      R.offlineRes = o;
      continue;
    }
    const active = prof.active(R.T);
    s._caveActive = active;
    let e0 = s.earnedAll;
    if (active) E.tick(s, dt); else E.offline(s, dt); // closed app == offline()
    addSrc(active ? 'idle' : 'offline', s.earnedAll - e0);
    const st = E.stats(s);
    if (active) { // ---- cave: coin pool fed by spill, emptied by the finger (<= 4 coins/s), broom and gusts
      pool += st.spillRate * dt; poolV += st.spillRate * dt;
      if (pool > C.maxCoins) pool = C.maxCoins; // over cap: value merges into existing coins
      const take = Math.min(pool, 4 * dt);
      if (take > 0) { const avg = poolV / pool; e0 = s.earnedAll; E.coinCollected(s, take, 3, avg); addSrc('coin', s.earnedAll - e0); poolV -= take * avg; pool -= take; }
      e0 = s.earnedAll; E.strokeCollected(s, 600 * dt, 3); addSrc('stroke', s.earnedAll - e0);
      E.noteStreak(s, isInt(R.T / 60) ? st.maxStreak : 3); // an occasional long swipe
      if (E.gustReady(s) && E.useGust(s)) { // gusts whenever ready (collects whatever is on screen)
        const n = Math.floor(pool), avg = n > 0 ? poolV / pool : 0;
        const gv = avg * (1 + (st.gustWorthMult - 1) * Math.min(n, C.gustBonusCoins || n) / Math.max(1, n)); // x3 on <= gustBonusCoins
        if (n > 0) { e0 = s.earnedAll; E.coinCollected(s, n, 3, gv); addSrc('gust', s.earnedAll - e0); pool -= n; poolV -= n * avg; }
        const fl = Math.max(0, (C.gustFloorCoins || 0) - n); // engine floor: a gust always pays >= gustFloorCoins coins
        if (fl > 0) { e0 = s.earnedAll; E.coinCollected(s, fl, 3, st.gustWorthMult); addSrc('gust', s.earnedAll - e0); }
      }
      if (st.sweepRate > 0 && pool > 0) {
        const n = Math.min(pool, st.sweepRate * dt), avg = poolV / pool;
        e0 = s.earnedAll; E.sweepCollect(s, n * avg); addSrc('sweep', s.earnedAll - e0); pool -= n; poolV -= n * avg;
      }
      if (pool < 1e-9) { pool = 0; poolV = 0; }
    } else { pool = 0; poolV = 0; }
    if (R.T >= nextTr) { // ---- treasures: grabbed only while the cave is on screen
      if (active) {
        e0 = s.earnedAll; const r = E.grabTreasure(s); addSrc('treasure', s.earnedAll - e0);
        if (r.spawnCoins) { pool = Math.min(C.maxCoins, pool + r.spawnCoins); poolV += r.spawnCoins; }
      }
      const iv = st.treasureInterval; nextTr = R.T + iv[0] + Math.random() * (iv[1] - iv[0]);
    }
    R.T += dt;
    if (active && isInt(R.T)) { // ---- player actions, once per second while playing
      for (let i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { const r = E.claimMission(s, i); if (r.rankUp && M().rankAt[s.rank] == null) M().rankAt[s.rank] = R.T; i = -1; }
      while (s.chests > 0) E.openChest(s);
      shop(s, prof, R, M());
      if (E.canSleep(s) && M().sleepAvail == null) M().sleepAvail = R.T;
      const gain = E.legendOnSleep(s);
      if (E.canSleep(s) && gain >= Math.max(3, s.legend) && s.sleeps < MAXSLEEPS) {
        R.sleeps.push({ t: R.T, gain, legendBefore: s.legend, rank: s.rank, earned: s.earnedRun, runLen: R.T - M().start });
        E.sleep(s); pool = 0; poolV = 0;
        R.runs.push(newRunMetrics(R.T)); R.lastBuy = R.T;
      }
    }
    if (prof.name === 'active' && isInt(R.T)) { // ---- dead zones / purchase gaps
      const d = M().dead;
      if (!anyAffordable(s)) { d.cur++; if (d.cur > d.max) { d.max = d.cur; d.at = R.T; } }
      else { if (d.cur >= 60) d.list.push([R.T - d.cur, d.cur]); d.cur = 0; }
      const gap = R.T - R.lastBuy; if (gap > M().maxGap) { M().maxGap = gap; M().maxGapAt = R.lastBuy; }
    }
    if (isInt(R.T / 60)) for (const m of s.missions) {
      const L = R.missionLife[m.uid] = R.missionLife[m.uid] || { tpl: m.tpl, key: m.key, target: m.target, from: R.T, rank: s.rank, sleep: s.sleeps };
      L.to = R.T;
    }
    if (isInt(R.T / 600)) {
      const g1 = E.stats(s), sw = swipeRate(s, g1);
      R.rows.push({ min: R.T / 60, gold: f(s.gold), earnedRun: f(s.earnedRun), gps: f(g1.baseGps), 'gps x/10m': win0.gps > 0 ? (g1.baseGps / win0.gps).toFixed(2) : '-',
        'swipe/s': f(sw), 'swipe:gps': g1.baseGps > 0 ? (sw / g1.baseGps).toFixed(2) : 'inf', rank: s.rank, legend: f(s.legend), onSleep: f(E.legendOnSleep(s)),
        bld: D.buildings.map(b => s.buildings[b.id]).join('/'), tiers: s.tiers.map(x => f(x)).join('/') });
      win0 = { gps: g1.baseGps };
    }
    scan(s, 'state', prof.name + '@' + R.T);
    if (isInt(R.T / 30)) scan(E.stats(s), 'stats', prof.name + '@' + R.T);
    if (bad.length > 20) break;
  }
  R.final = s;
  return R;
}

// ---------------------------------------------------------------- profiles
const profiles = {
  active: { name: 'active', share: 1, active: () => true },
  casual: { name: 'casual', share: 0.1, active: T => (T % 600) < 60 },
  // extra reference profile for the SPEC "mixed active/idle" pacing target: 5 min swiping, 5 min away
  mixed: { name: 'mixed', share: 0.5, active: T => (T % 600) < 300 },
  // swipes the first 4 minutes to bootstrap, then a 20 s check-in every 15 minutes; one 8 h offline gap at minute 30
  idle: { name: 'idle', share: 0.03, offlineAt: 1800, offlineSec: 8 * 3600, active: T => T < 240 || (T % 900) < 20 }
};

// ---------------------------------------------------------------- report
function report(R) {
  const s = R.final;
  console.log('\n================ PROFILE: ' + R.name + ' (' + HOURS + ' h of play' + (R.offlineRes ? ' + one 8 h offline gap' : '') + ') ================');
  if (!QUIET) console.table(R.rows);
  console.log('sleeps (' + R.sleeps.length + '):', R.sleeps.slice(0, 6).map(x => mm(x.t) + ' +' + f(x.gain) + 'L (had ' + f(x.legendBefore) + ', rank ' + x.rank + ', run ' + mm(x.runLen) + ')').join('; ') || 'none',
    R.sleeps.length > 6 ? ' ... last ' + mm(R.sleeps[R.sleeps.length - 1].t) + ', legend now ' + f(s.legend) : '');
  R.runs.slice(0, 3).forEach((m, k) => {
    console.log('-- run ' + (k + 1) + ' (from ' + mm(m.start) + ')');
    console.log('   ranks:', Object.entries(m.rankAt).map(([r, t]) => r + '@' + mm(t)).join(' '), ' sleep available:', mm(m.sleepAvail));
    console.log('   first building:', D.buildings.map(b => b.id + '@' + mm(m.firstB[b.id])).join(' '));
    console.log('   first tier:', D.tiers.map((t, i) => t.id + '@' + mm(m.firstT[i])).join(' '));
    console.log('   upgrades:', Object.entries(m.upgradeAt).map(([u, t]) => u + '@' + mm(t)).join(' '));
    const tot = Object.values(m.src).reduce((a, b) => a + b, 0) || 1;
    console.log('   income %:', Object.entries(m.src).filter(([, v]) => v > 0).map(([k2, v]) => k2 + ' ' + (100 * v / tot).toFixed(1)).join(', '));
    console.log('   chain: gold on tiers ' + f(m.tierGold) + ' vs on buildings ' + f(m.goldOnBuildings) + '; building minion cost from free stock ' + (m.minionNeed ? Math.round(100 * m.minionFromStock / m.minionNeed) : '-') + '%; minion-limited building buys ' + m.minionLimitedBuys + '/' + m.buys);
    if (R.name === 'active') console.log('   longest NOTHING-affordable: ' + m.dead.max + 's ending ' + mm(m.dead.at) + '; stretches>=60s: ' + (m.dead.list.map(([a, d]) => mm(a) + ':' + d + 's').join(' ') || 'none') + '; longest purchase gap ' + m.maxGap.toFixed(0) + 's from ' + mm(m.maxGapAt));
  });
  const life = Object.values(R.missionLife).map(m => Object.assign(m, { dur: m.to - m.from })).sort((a, b) => b.dur - a.dur).slice(0, 4);
  console.log('longest-lived missions:', life.map(m => m.tpl + (m.key != null ? ':' + m.key : '') + ' ' + f(m.target) + ' (rank ' + m.rank + ', run ' + (m.sleep + 1) + ') ' + Math.round(m.dur / 60) + 'min').join(' | '));
  if (R.offlineRes) {
    const o = R.offlineRes;
    console.log('OFFLINE at ' + mm(o.at) + ' for ' + o.sec / 3600 + 'h: +' + f(o.gold) + ' gold (gps ' + f(o.gpsBefore) + ' + sweep ' + f(o.sweepGps) + ' => ' + (o.gold / Math.max(1e-9, o.gpsBefore + o.sweepGps) / 3600).toFixed(2) + ' h of rate; gold before ' + f(o.goldBefore) + ', earnedRun before ' + f(o.earnedBefore) + ', rank ' + o.rank + ')');
    console.log('   tiers ' + o.tiersBefore.map(f).join('/') + ' -> ' + o.tiersAfter.map(f).join('/') + '; buildings ' + o.bBefore + ' -> ' + o.bAfter + '; gps after spending ' + f(o.gpsAfterBuy) + ' (x' + (o.gpsAfterBuy / Math.max(1e-9, o.gpsBefore)).toFixed(1) + ')');
  }
  console.log('final: gold ' + f(s.gold) + ', gps ' + f(E.stats(s).baseGps) + ', rank ' + s.rank + ', legend ' + f(s.legend) + ', sleeps ' + s.sleeps + ', cards ' + Object.values(s.cards).reduce((a, b) => a + b, 0));
}

// ---------------------------------------------------------------- edge probes
function probes() {
  const s = E.newState();
  s.gold = 1e300; s.earnedRun = 1e300; s.rank = 12; s.tiers = [1e300, 1e300, 1e300, 1e300, 1e300];
  for (const b of D.buildings) E.buyBuilding(s, b.id, 'max');
  for (let i = 0; i < 5; i++) E.buyTier(s, i, 'max');
  E.tick(s, 1); E.offline(s, Infinity); E.coinCollected(s, 1e300, 1e300, 1e300); E.strokeCollected(s, 1e300, 8);
  scan(s, 'state', 'probe-huge'); scan(E.stats(s), 'stats', 'probe-huge');
  E.sleep(s); E.tick(s, 1); scan(s, 'state', 'probe-sleep-huge'); scan(E.stats(s), 'stats', 'probe-sleep-huge');
  const s2 = E.newState(); s2.legend = 1e300; E.tick(s2, 1); E.coinCollected(s2, 10, 3); scan(s2, 'state', 'probe-legend'); scan(E.stats(s2), 'stats', 'probe-legend');
  const s3 = E.newState(); s3.rank = 6; s3.gold = 1e9; s3.tiers = [1e6, 1e6, 1e6, 1e6, 1e6];
  for (const b of D.buildings) {
    scan(E.buildingCost(s3, b.id, 'max'), 'cost.' + b.id, 'probe-cost');
    const s4 = clone(s3), n = E.buildingMax(s4, b.id);
    if (n > 0 && !E.buyBuilding(s4, b.id, n)) bad.push('buildingMax(' + b.id + ')=' + n + ' but buyBuilding(n) failed');
  }
  for (let i = 0; i < 5; i++) scan(E.tierCost(s3, i, 'max'), 'tcost' + i, 'probe-cost');
}

probes();
for (const n of (ONLY === 'all' ? ['active', 'casual', 'idle', 'mixed'] : ONLY.split(','))) report(run(profiles[n]));
console.log('\nNaN/Infinity/negative issues:', bad.length ? '\n  ' + bad.slice(0, 20).join('\n  ') : 'none');
