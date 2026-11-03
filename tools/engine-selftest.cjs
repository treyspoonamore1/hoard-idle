// Headless self-test + pacing sim for js/data.js + js/engine.js.
// Usage: node tools/engine-selftest.cjs [minutes]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
// seeded Math.random so runs are reproducible
let seed = +process.env.SEED || 12345;
Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (const f of ['js/data.js', 'js/engine.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const H = globalThis.HOARD, E = H.engine, D = H.data;
if (process.env.TWEAK) eval(process.env.TWEAK); // e.g. TWEAK="D.buildings[3].gold=1e5"
let fails = 0;
function check(cond, msg) { if (!cond) { fails++; console.log('FAIL:', msg); } }
function finiteDeep(o, p = '') {
  if (typeof o === 'number') { if (!isFinite(o)) { check(false, 'non-finite at ' + p); } return; }
  if (o && typeof o === 'object') for (const k of Object.keys(o)) finiteDeep(o[k], p + '.' + k);
}

// ---------------------------------------------------------------- unit checks
const API = ['newState','deserialize','serialize','stats','tick','earn','coinCollected','strokeCollected','sweepCollect','noteStreak','gustReady','useGust','grabTreasure','buildingCost','buildingMax','buyBuilding','tierCost','tierMax','buyTier','upgradeList','buyUpgrade','isUnlocked','nextMilestone','missionInfo','claimMission','rankNeed','openChest','cardInfo','legendOnSleep','canSleep','sleep','offline','on','emit'];
for (const n of API) check(typeof E[n] === 'function', 'missing engine.' + n);
check(D.cards.length === 20, '20 cards');
check(H.fmt(0) === '0' && H.fmt(5.5) === '5.5' && H.fmt(999) === '999' && H.fmt(1234) === '1.23K' && H.fmt(12345) === '12.3K' && H.fmt(123456) === '123K' && H.fmt(1.5e6) === '1.50M' && H.fmt(2e36) === '2.00e36', 'fmt ' + [H.fmt(1234), H.fmt(1.5e6), H.fmt(2e36), H.fmt(999999)]);
check(H.fmtTime(8040) === '2h 14m' && H.fmtTime(185) === '3m 05s' && H.fmtTime(12) === '12s', 'fmtTime');
check(H.fmtRate(4500) === '4.50K/s', 'fmtRate');
// rates round (and keep 2 significant digits under 1): a 0.15/s Digger must not read "0.1/s"
check(H.fmtRate(0.15) === '0.15/s' && H.fmtRate(0.75) === '0.75/s' && H.fmtRate(0.05) === '0.05/s' && H.fmtRate(25.9) === '26/s' && H.fmtRate(4.26) === '4.3/s' && H.fmtRate(0) === '0/s' && H.fmtRate(NaN) === '0/s',
  'fmtRate small: ' + [0.15, 0.75, 0.05, 25.9, 4.26].map(H.fmtRate).join(' '));
// nestIn: exact chain projection (60 s, no milestone crossed) matches ticking; a projected buy grows it; pure
{
  let s = E.newState(); s.rank = 6; s.tiers = [1e6, 1000, 50, 2, 0]; s = E.deserialize(E.serialize(s));
  const before = JSON.stringify(s.tiers), p60 = E.nestIn(s, 60), p0 = E.nestIn(s, 0);
  check(JSON.stringify(s.tiers) === before && p0 === E.nestSize(s), 'nestIn(0) = nestSize, state untouched');
  const c = E.deserialize(E.serialize(s)); for (let i = 0; i < 600; i++) E.tick(c, 0.1);
  check(Math.abs(p60 / E.nestSize(c) - 1) < 1e-6, 'nestIn(60 s) = nest after 60 s of ticks (' + p60.toFixed(0) + ' vs ' + E.nestSize(c).toFixed(0) + ')');
  check(E.nestIn(s, 300, 2, 10) > E.nestIn(s, 300) && E.nestIn(s, 300, 4, 1) > E.nestIn(s, 300) && isFinite(E.nestIn(s, 1e9, 4, 1e300)), 'nestIn with a projected buy grows the nest, finite at extremes');
}
// garbage tolerance
for (const g of [null, undefined, '', '{bad', 42, [], { gold: 'x', tiers: 'no', missions: [{ tpl: 'zzz' }] }, { gold: Infinity, tiers: [NaN, -5, 1e400], buildings: { digger: -3 } }]) {
  const s = E.deserialize(g); finiteDeep(s, 'deser'); check(s.missions.length === 3, 'missions after deser');
}
{
  const s = E.newState();
  check(!E.buyBuilding(s, 'nope', 1) && !E.buyTier(s, 9, 1) && !E.buyUpgrade(s, 'x'), 'unknown ids false');
  E.tick(s, NaN); E.tick(s, -1); E.earn(s, NaN); E.coinCollected(s, NaN, NaN); E.strokeCollected(s, Infinity, 2);
  finiteDeep(s, 'garbage'); finiteDeep(E.stats(s), 'stats');
  const m1 = E.newState().missions.map(m => JSON.stringify(m)), m2 = E.newState().missions.map(m => JSON.stringify(m));
  check(JSON.stringify(m1) === JSON.stringify(m2), 'deterministic missions');
  const rt = E.deserialize(E.serialize(Object.assign(s, { _caveActive: true })));
  check(rt._caveActive === undefined && rt.missions.length === 3, 'serialize omits _ keys');
  check(E.nextMilestone('building', 0) === 10 && E.nextMilestone('building', 10) === 25 && E.nextMilestone('building', 200) === 300 && E.nextMilestone('tier', 1000) === null, 'nextMilestone');
  // Ember kilns keep the old 25 / 50 / 100 / 150 / 200 curve (no x2 at 10)
  check(E.milestoneMult('kiln', 10) === 1 && E.milestoneMult('kiln', 25) === 2 && E.milestoneMult('kiln', 300) === 64 && E.milestoneMult('building', 10) === 2 && E.nextMilestone('kiln', 0) === 25 && E.nextMilestone('kiln', 200) === 300, 'kiln milestones');
}
// offline accuracy: substeps vs fine Euler-free reference (exact integrator at 1s)
{
  const a = E.newState(); a.rank = 6; a.tiers = [0, 5, 5, 5, 5]; a.buildings.digger = 10;
  const b = JSON.parse(JSON.stringify(a)), c = E.deserialize(JSON.parse(JSON.stringify(a)));
  const r = E.offline(a, 3600);
  for (let i = 0; i < 36000; i++) E.tick(c, 0.1); // fine reference (cave inactive -> no sweep, no upgrades)
  const rel = Math.abs(a.tiers[0] - c.tiers[0]) / c.tiers[0];
  check(rel < 0.02, 'offline eggs accuracy rel=' + rel);
  check(r.seconds === 3600 && r.gold > 0 && r.minions[0] > 0, 'offline result');
  const r2 = E.offline(E.newState(), 1e9); check(r2.seconds === 8 * 3600, 'offline cap');
}

// ---------------------------------------------------------------- pacing sim
const MIN = +process.argv[2] || 90;
const DO_SLEEP = !!process.env.SLEEP; const MIXED = !!process.env.MIXED; const sleepLog = [];
const s = E.newState();
const st0 = E.stats(s);
let firstDigger = null, firstUpgrade = null, rank2 = null, firstSleep = null;
const rankAt = {};
const marks = new Set([1, 3, 5, 10, 20, 30, 40, 50, 60, 75, 90].filter(m => m <= MIN));
const rows = [];
let treasureT = 85, nextTreasure = 85;

function eqPrice(i) { // gold-equivalent price of one unit of tier i
  let p = E.tierCost(s, i, 1).gold;
  if (i > 0) p += D.tiers[i].prevCost * eqPrice(i - 1);
  return p;
}
function ensure(t, amt) { // buy missing minions of tier t (recursively)
  const have = s.tiers[t];
  if (have >= amt) return true;
  if (!E.isUnlocked(s, 'tier', t)) return false;
  const need = Math.ceil(amt - have - 1e-9);
  if (t > 0 && !ensure(t - 1, need * D.tiers[t].prevCost)) return false;
  return E.buyTier(s, t, need);
}
function needSoon(t) {
  let n = 0;
  for (const b of D.buildings) if (b.minionTier === t && E.isUnlocked(s, 'building', b.id)) n += E.buildingCost(s, b.id, 3).minions;
  if (t + 1 < 5 && E.isUnlocked(s, 'tier', t + 1)) n += 5 * D.tiers[t + 1].prevCost;
  return n;
}
function shop() {
  for (let guard = 0; guard < 200; guard++) {
    const st = E.stats(s);
    // upgrades first
    const up = E.upgradeList(s).filter(u => u.affordable).sort((a, b) => a.cost - b.cost)[0];
    if (up && E.buyUpgrade(s, up.id)) { if (firstUpgrade === null) firstUpgrade = s.time; continue; }
    // a sensible player saves for a cheap upgrade instead of another building
    const upNext = E.upgradeList(s).filter(u => !u.bought && u.visible).sort((a, b) => a.cost - b.cost)[0];
    const cheapB = Math.min(...D.buildings.filter(b => E.isUnlocked(s, 'building', b.id)).map(b => E.buildingCost(s, b.id, 1).gold));
    if (upNext && upNext.cost <= 3 * cheapB && upNext.cost > s.gold) break;
    // mission-directed tier buys
    let did = false;
    for (const m of s.missions) {
      if (m.tpl === 'tier' && !m.done) {
        const cost = (m.target - s.tiers[m.key]) * eqPrice(m.key);
        if (cost < s.gold * 0.5 && ensure(m.key, m.target)) { did = true; break; }
      }
    }
    if (did) continue;
    for (const m of s.missions) {
      if (m.tpl === 'building' && !m.done && E.isUnlocked(s, 'building', m.key)) {
        const c = E.buildingCost(s, m.key, 1);
        const missing = c.minionTier >= 0 ? Math.max(0, c.minions - s.tiers[c.minionTier]) : 0;
        const eq = c.gold + missing * (c.minionTier >= 0 ? eqPrice(c.minionTier) : 0);
        if (eq <= s.gold && (c.minionTier < 0 || ensure(c.minionTier, c.minions)) && E.buyBuilding(s, m.key, 1)) { did = true; break; }
      }
    }
    if (did) continue;
    let best = null;
    for (const b of D.buildings) {
      if (!E.isUnlocked(s, 'building', b.id)) continue;
      const c = E.buildingCost(s, b.id, 1);
      const missing = c.minionTier >= 0 ? Math.max(0, c.minions - s.tiers[c.minionTier]) : 0;
      const eq = c.gold + missing * (c.minionTier >= 0 ? eqPrice(c.minionTier) : 0);
      let val = st.buildingEach[b.id] / (st.frenzyActive ? 7 : 1);
      const owned = s.buildings[b.id], nm = E.nextMilestone('building', owned);
      if (nm && nm - owned <= 3) val *= 2;
      const ratio = eq / val;
      if (!best || ratio < best.ratio) best = { kind: 'b', id: b.id, eq, ratio, c };
    }
    for (let i = 1; i < 5; i++) {
      if (!E.isUnlocked(s, 'tier', i)) continue;
      const eq = eqPrice(i);
      const u = s.tiers[i - 1] < needSoon(i - 1) ? 1 : 0;
      const val = st.tierUnitRate[i] * eqPrice(i - 1) * u * 0.5;
      const ratio = eq / Math.max(val, 1e-9);
      if (!best || ratio < best.ratio) best = { kind: 't', id: i, eq, ratio };
    }
    if (!best || best.eq > s.gold) break;
    if (best.kind === 'b') {
      if (best.c.minionTier >= 0 && !ensure(best.c.minionTier, best.c.minions)) break;
      if (!E.buyBuilding(s, best.id, 1)) break;
      if (best.id === 'digger' && firstDigger === null) firstDigger = s.time;
    } else {
      if (!ensure(best.id - 1, D.tiers[best.id].prevCost)) break;
      if (!E.buyTier(s, best.id, 1)) break;
    }
  }
}

const dt = 0.5;
const src = { idle: 0, swipe: 0, other: 0 };
let lastShop = 0;
for (let step = 0; s.time < MIN * 60; step++) {
  s._caveActive = true;
  let g0 = s.earnedRun;
  E.tick(s, dt);
  src.idle += s.earnedRun - g0; g0 = s.earnedRun;
  const st = E.stats(s);
  // swiping: ~1.2 coins/s (more with spill upgrade), streak x2 average, 200px/s of path
  // MIXED=1: swipe 2 minutes, then leave the phone idle 2 minutes (treasures/gusts missed while idle)
  const active = !MIXED || Math.floor(s.time / 120) % 2 === 0;
  if (active) {
    E.coinCollected(s, Math.min(st.spillRate, 1.5 * 0.85) * 0.95 * dt, 2);
    E.strokeCollected(s, 200 * dt, 2);
  }
  src.swipe += s.earnedRun - g0; g0 = s.earnedRun;
  if (step % 20 === 0) E.noteStreak(s, s.time > 20 ? Math.min(st.maxStreak, s.time > 200 ? 8 : 5) : 2);
  if (st.sweepRate > 0) E.sweepCollect(s, st.sweepRate * dt);
  if (active && s.time > 10 && E.gustReady(s) && E.useGust(s)) E.coinCollected(s, 6, 1, st.gustWorthMult);
  if (s.time >= nextTreasure) {
    const r = active ? E.grabTreasure(s) : {};
    if (r.spawnCoins) E.coinCollected(s, r.spawnCoins, 2);
    const iv = st.treasureInterval; nextTreasure = s.time + (iv[0] + iv[1]) / 2;
  }
  src.other += s.earnedRun - g0;
  if (s.time - lastShop >= 1) {
    lastShop = s.time;
    for (let i = 0; i < 3; i++) {
      if (E.missionInfo(s, i).done) {
        const r = E.claimMission(s, i);
        if (r.rankUp) { rankAt[s.rank] = s.time; if (s.rank === 2) rank2 = s.time; }
        i = -1;
      }
    }
    while (s.chests > 0) E.openChest(s);
    shop();
  }
  if (firstSleep === null && E.canSleep(s)) firstSleep = s.time;
  if (firstDigger === null && s.buildings.digger > 0) firstDigger = s.time;
  if (DO_SLEEP && E.canSleep(s)) {
    const g = E.sleep(s); sleepLog.push((s.time / 60).toFixed(1) + 'min(+' + g + ')');
  }
  const minute = s.time / 60;
  if (marks.has(minute)) {
    marks.delete(minute);
    rows.push({ min: minute, gold: H.fmt(s.gold), earned: H.fmt(s.earnedRun), gps: H.fmt(st.gps), rank: s.rank,
      bld: D.buildings.map(b => s.buildings[b.id]).join('/'), tiers: s.tiers.map(x => H.fmt(x)).join('/'),
      legendNow: E.legendOnSleep(s), src: [src.idle, src.swipe, src.other].map(x => Math.round(100 * x / s.earnedRun)).join('/'), cards: Object.values(s.cards).reduce((a, b) => a + b, 0) });
  }
  finiteDeep(s, 'sim');
  if (fails > 5) break;
}
console.table(rows);
console.log('first Digger at', firstDigger, 's; first upgrade at', firstUpgrade, 's; rank 2 at', rank2 && (rank2 / 60).toFixed(2), 'min');
console.log('rank-up minutes:', Object.entries(rankAt).map(([r, t]) => r + '@' + (t / 60).toFixed(1)).join(' '));
console.log('first Sleep available at', firstSleep && (firstSleep / 60).toFixed(1), 'min');
if (DO_SLEEP) console.log('sleeps at:', sleepLog.join(' '));
console.log('missions now:', [0, 1, 2].map(i => E.missionInfo(s, i).title).join(' | '));
console.log('upgrades:', Object.keys(s.upgrades).join(','));
console.log(fails ? fails + ' FAILURES' : 'ALL CHECKS PASSED');
process.exitCode = fails ? 1 : 0;
