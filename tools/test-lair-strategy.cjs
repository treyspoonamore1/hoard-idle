// Event lair strategy test: is climbing the chain the right play, does the number go up, and how fast can an active
// player finish? Loads data.js + engine.js + events.js in a Node vm (as tools/test-events.cjs does), fakes the wall
// clock with HOARD.events._now, and plays the real lair with the REAL buy functions (unitPrice / unitMax / buyUnit)
// under several simple strategies:
//   never      buys nothing, never swipes
//   swipe      swipes coins in the cave, buys nothing
//   impOnly    the degenerate play: all currency into tier 0, plus the one higher unit a quest asks for
//   topFirst   highest affordable tier first (Max of the top tier, then the next one down, ...)
//   greedy     best payback: buys the unit whose own production pays its price back soonest (a tier-k unit
//              returns R_k t^(k+1)/(k+1)! currency after t seconds, R_k = product of the chain rates up to k)
//   capK       greedy limited to tiers 0..K, no quests (the clean "should I climb to tier K?" comparison)
// Buying strategies buy the unit an "own" quest asks for, saving up for it only while it costs <= 5 min of income.
// Active play = swiping 2 coins/s (so the swipe rush is on) and one decision per second. Casual = check-ins of a few
// minutes at fixed UTC hours, offline production in between (capped like the game).
// Asserts: (a) climbing beats more imps early (hounds within ~5 min, giants within ~20 min, wyrms within ~1-2 h),
// imps-only is clearly worse at every horizon from 10 min on; (b) income accelerates (10 min >= 10x 2 min,
// 30 min >= 10x 10 min, never flat in the first 2.5 h); (c) pacing: non-stop active play finishes in 1.5-3 h,
// 4 x 5 min a day in <= ~55 h, 3 x 5 min a day finishes, 2 x 10 min gets 8+ steps; (d) no NaN / Infinity /
// negatives, including absurd saves.
// Usage: node tools/test-lair-strategy.cjs      (exit code 1 on any failure)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function badNum(o, p) {
  if (typeof o === 'number') return isFinite(o) ? (o < 0 && !/(until|minionTier|prevTier|firstSlot)$/.test(p) ? p + '<0' : null) : p;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = badNum(o[k], p + '.' + k); if (r) return r; }
  return null;
}
function load(seed) {
  seed = seed || 321;
  const sb = { console, Date, JSON, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['js/data.js', 'js/engine.js', 'js/events.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  return sb.HOARD;
}
const H = load(), E = H.engine, X = H.events;
const HR = 3600e3;
let T = 0;
X._now = () => T;
const fmt = n => (n === 0 ? '0' : n.toExponential(2));

// ---------------------------------------------------------------- strategies (real buy functions only)
const FACT = [1, 1, 2, 6, 24];
const R = []; X.CHAIN.reduce((a, c, k) => (R[k] = a * c.rate), 1);
function payback(s, k) { return Math.pow(FACT[k + 1] * X.unitPrice(s, k) / R[k], 1 / (k + 1)); }
const COINS = 2; // coins swiped per second while playing (a relaxed swipe)
function income(s) { return X.rate(s) * X.speed(s) + (X.rushing(s) ? COINS * X.perCoin(s) : 0); }
// buys the unit the current "own" quest asks for; true while saving up for it (only when it is within ~5 min of income)
function questHelp(s) {
  const q = X.QUESTS[s.events.q];
  if (!q || q.kind !== 'own' || s.events.units[q.k] >= q.n) return false;
  const need = Math.ceil(q.n - s.events.units[q.k]);
  const m = X.unitMax(s, q.k);
  if (m > 0) X.buyUnit(s, q.k, Math.min(need, m));
  if (s.events.units[q.k] >= q.n) return false;
  return X.unitCost(s, q.k, need) <= 300 * income(s);
}
function greedyTo(maxK, quests) {
  return function (s, picks) {
    if (quests && questHelp(s)) return;
    for (let i = 0; i < 500; i++) {
      let bk = 0, bt = Infinity;
      for (let k = 0; k <= maxK; k++) { const t = payback(s, k); if (t < bt) { bt = t; bk = k; } }
      if (!X.buyUnit(s, bk, 1)) return; // save up for the best buy
      if (picks) picks.push([T, bk]);
    }
  };
}
const STRATS = {
  never: { swipe: false, buy: null },
  swipe: { swipe: true, buy: null },
  impOnly: { swipe: true, buy(s) { if (!questHelp(s)) X.buyUnit(s, 0, 'max'); } },
  topFirst: { swipe: true, climbs: true, buy(s) { if (questHelp(s)) return; for (let k = 3; k >= 0; k--) X.buyUnit(s, k, 'max'); } },
  greedy: { swipe: true, climbs: true, buy: greedyTo(3, true) },
  cap0: { swipe: true, buy: greedyTo(0, false) },
  cap1: { swipe: true, buy: greedyTo(1, false) },
  cap2: { swipe: true, buy: greedyTo(2, false) },
  cap3: { swipe: true, buy: greedyTo(3, false) }
};
const MAIN = ['never', 'swipe', 'impOnly', 'topFirst', 'greedy'];

// ---------------------------------------------------------------- one run
// prof: { cont: seconds } continuous from the moment the lair opens (marks: minutes to record earned/income at),
// or { hours: [UTC hours], mins } check-ins (the lair opens at the first one, 08:00 UTC), optional { contFirst: s }.
function play(name, prof) {
  const st = STRATS[name];
  T = Date.UTC(2026, 10, 3, 8, 0, 0);
  const t0 = T, end = t0 + 72 * HR;
  const s = E.newState(); s.rank = 3;
  E.tick(s, 0.01); // unlocks the lairs: the first lair opens now for 72 h
  const claims = [], picks = [], earned = {}, inc = {};
  function act() {
    while (X.questInfo(s).done) { X.claimQuest(s); claims.push((T - t0) / HR); }
    while (s.events.chests > 0) X.openChest(s);
    if (st.buy) st.buy(s, picks);
  }
  function second() {
    T += 1000;
    if (st.swipe) E.coinCollected(s, COINS, 1);
    E.tick(s, 1);
    act();
  }
  function session(sec) { for (let i = 0; i < sec && T < end; i++) second(); s.savedAt = T; }
  if (prof.cont) {
    for (let i = 1; i <= prof.cont; i++) { second(); if (i % 60 === 0) { earned[i / 60] = s.events.earned; inc[i / 60] = income(s); } }
  } else {
    if (prof.contFirst) session(prof.contFirst);
    for (let day = 0; T < end; day++) {
      for (const h of prof.hours) {
        const at = Date.UTC(2026, 10, 3 + day, 0, 0, 0) + h * HR;
        if (at < T) continue;
        if (at >= end) break;
        const gap = (at - T) / 1000;
        T = at;
        E.offline(s, Math.min(gap, E.stats(s).offlineCapHours * 3600));
        act();
        session(prof.mins * 60);
      }
      if (day > 4) break;
    }
    if (T < end) { const gap = (end - T) / 1000; T = end; E.offline(s, Math.min(gap, E.stats(s).offlineCapHours * 3600)); }
  }
  const first = [0, 1, 2, 3].map(k => { const p = picks.find(x => x[1] === k); return p ? (p[0] - t0) / 60e3 : Infinity; });
  return { name, s, earned: s.events.earned, q: s.events.q, claims, done: s.events.q >= X.QUESTS.length,
    at: claims.length ? claims[claims.length - 1] : 0, picks, first, marks: earned, inc, bought: s.events.bought.slice(), bad: badNum(s, 'state') };
}
const ACTIVE_MIN = 180;
const fm = m => (m === Infinity ? '-' : m.toFixed(1) + 'm');

// ---------------------------------------------------------------- (a) strategy comparison + climbing
const CASUAL = { hours: [8, 12.5, 18, 22.5], mins: 5 };
const act = {}, cas = {};
for (const n of Object.keys(STRATS)) {
  act[n] = play(n, { cont: ACTIVE_MIN * 60 });
  check(!act[n].bad, n + ' active: state finite and non-negative (' + act[n].bad + ')');
  if (MAIN.includes(n)) { cas[n] = play(n, CASUAL); check(!cas[n].bad, n + ' casual: finite (' + cas[n].bad + ')'); }
}
const HZ = [2, 5, 10, 20, 30, 60, 90, 120, 180];
console.log('earned in active play (swiping 2 coins/s, buying every second) and in 72 h casual (4 x 5 min a day)');
console.log('strategy  ' + HZ.map(m => (m + 'm').padStart(9)).join('') + '   72h casual  quests  active done');
for (const n of Object.keys(STRATS)) {
  const r = act[n], c = cas[n];
  console.log('  ' + n.padEnd(8) + HZ.map(m => fmt(r.marks[m]).padStart(9)).join('') +
    (c ? fmt(c.earned).padStart(13) + String(c.q).padStart(5) + '/10' : ''.padStart(21)) + (r.done ? '  ' + r.at.toFixed(2) + 'h' : '  ' + r.q + '/10'));
}
const g = act.greedy;
console.log('greedy income/s: ' + HZ.map(m => m + 'm ' + fmt(g.inc[m])).join(', '));
console.log('greedy first buys its own pick of: hounds ' + fm(g.first[1]) + ', giants ' + fm(g.first[2]) + ', wyrms ' + fm(g.first[3]));
// the best marginal buy moves up the tiers: mean tier of greedy's own picks per window
{
  const t0 = Date.UTC(2026, 10, 3, 8, 0, 0);
  const wins = [[0, 2], [2, 10], [10, 30], [30, 60], [60, 120], [120, 180]];
  const mean = wins.map(([a, b]) => {
    const p = g.picks.filter(([t]) => (t - t0) / 60e3 > a && (t - t0) / 60e3 <= b);
    return p.length ? p.reduce((x, y) => x + y[1], 0) / p.length : -1;
  });
  console.log('greedy: mean tier bought per window (' + wins.map(w => w.join('-') + 'm').join(', ') + '): ' + mean.map(m => m.toFixed(2)).join(' '));
  check(mean[0] < 1, 'first 2 minutes: mostly imps (mean tier ' + mean[0].toFixed(2) + ')');
  check(mean[1] > mean[0] && mean[2] > mean[1] && mean[3] > mean[2], 'the best marginal buy moves up the tiers over the first hour');
  check(mean[4] >= 1.8 && mean[5] >= 1.8, 'after the first hour giants and wyrms are the main buys (mean ' + mean[4].toFixed(2) + ', ' + mean[5].toFixed(2) + ')');
}
// climbing beats more of the tier below, early
const ratio = (a, b, m) => act[a].marks[m] / act[b].marks[m];
console.log('climb: hounds vs imps-only x' + ratio('cap1', 'cap0', 5).toFixed(1) + ' at 5m; +giants vs hounds x' + ratio('cap2', 'cap1', 20).toFixed(1) +
  ' at 20m; +wyrms vs giants x' + ratio('cap3', 'cap2', 60).toFixed(2) + ' at 60m, x' + ratio('cap3', 'cap2', 90).toFixed(2) + ' at 90m, x' + ratio('cap3', 'cap2', 120).toFixed(2) + ' at 120m');
check(ratio('cap1', 'cap0', 5) >= 2, 'hounds clearly beat more imps within 5 min (x' + ratio('cap1', 'cap0', 5).toFixed(1) + ')');
check(ratio('cap2', 'cap1', 20) >= 2, 'giants clearly beat more hounds within 20 min (x' + ratio('cap2', 'cap1', 20).toFixed(1) + ')');
check(ratio('cap3', 'cap2', 90) >= 1.5 && ratio('cap3', 'cap2', 120) >= 2, 'wyrms clearly beat more giants within 1.5-2 h');
check(g.first[1] <= 5 && g.first[2] <= 20 && g.first[3] <= 120, 'greedy picks hounds by 5 min, giants by 20 min, wyrms by 2 h (' + g.first.slice(1).map(fm).join(', ') + ')');
const climbers = ['topFirst', 'greedy'];
for (const m of [10, 20, 30, 60, 90, 120, 180]) {
  const best = Math.max(...climbers.map(n => act[n].marks[m]));
  check(best >= 5 * act.impOnly.marks[m], m + ' min active: climbing earns >= 5x the imps-only play (x' + (best / act.impOnly.marks[m]).toFixed(0) + ')');
}
check(Math.max(...climbers.map(n => cas[n].earned)) >= 10 * cas.impOnly.earned, '72 h casual: climbing earns >= 10x imps-only');
check(climbers.includes(MAIN.reduce((a, n) => (act[n].marks[60] > act[a].marks[60] ? n : a), MAIN[0])), 'best strategy at 60 min climbs the chain');
check(act.impOnly.marks[60] > act.swipe.marks[60] && act.swipe.marks[60] > act.never.marks[60], 'buying beats swipe-only beats never buying');
check(act.impOnly.bought[1] <= 1 && act.impOnly.bought[2] <= 1 && act.impOnly.bought[3] <= 1, 'imps-only buys at most one of each higher tier');
check(cas.greedy.bought.every(b => b >= 10), 'greedy buys plenty of every tier over the event (' + cas.greedy.bought.map(Math.round).join('/') + ')');

// ---------------------------------------------------------------- (b) number go up: income accelerates
{
  const I = g.inc;
  check(I[10] >= 10 * I[2], 'income at 10 min >= 10x income at 2 min (x' + (I[10] / I[2]).toFixed(0) + ')');
  check(I[30] >= 10 * I[10], 'income at 30 min >= 10x income at 10 min (x' + (I[30] / I[10]).toFixed(0) + ')');
  let flat = '';
  for (let m = 20; m <= 150; m += 10) if (!(I[m] >= 1.3 * I[m - 10])) flat += ' ' + m + 'm';
  check(!flat, 'never flat: income grows >= 1.3x every 10 min through 2.5 h' + (flat ? ' (flat at' + flat + ')' : ''));
  check(I[60] >= 10 * I[30] && I[120] >= 10 * I[60], 'still >= 10x per half hour, then per hour (x' + (I[60] / I[30]).toFixed(0) + ', x' + (I[120] / I[60]).toFixed(0) + ')');
  check(act.topFirst.inc[30] >= 10 * act.topFirst.inc[10], 'the simple top-tier-first player sees the same acceleration');
}

// ---------------------------------------------------------------- (c) quest pacing
{
  const runs = {
    'active non-stop (3h)': { cont: 3 * 3600 },
    '4x5min (08,12:30,18,22:30)': CASUAL,
    '3x5min (08,14,21)': { hours: [8, 14, 21], mins: 5 },
    '2x10min (08,20)': { hours: [8, 20], mins: 10 },
    '5x5min': { hours: [8, 11, 14, 18, 22], mins: 5 },
    'active 1h, then 4x5min': { contFirst: 3600, hours: [8, 12.5, 18, 22.5], mins: 5 }
  };
  const out = {};
  for (const n of Object.keys(runs)) {
    for (const strat of ['greedy', 'topFirst']) {
      const r = n === 'active non-stop (3h)' ? act[strat] : n === '4x5min (08,12:30,18,22:30)' ? cas[strat] : play(strat, runs[n]);
      (out[n] = out[n] || {})[strat] = r;
      check(!r.bad, n + ' (' + strat + '): finite (' + r.bad + ')');
      console.log('pace ' + strat.padEnd(8) + ' ' + n.padEnd(28) + ' quests ' + String(r.q).padStart(2) + '/10' + (r.done ? ' done at ' + r.at.toFixed(2) + 'h' : '') +
        '  claims(h): ' + r.claims.map(x => x.toFixed(x < 3 ? 2 : 1)).join(' '));
    }
  }
  for (const strat of ['greedy', 'topFirst']) {
    const A = out['active non-stop (3h)'][strat];
    check(A.done && A.at >= 1.5 && A.at <= 3, strat + ': swiping + buying non-stop finishes in 1.5-3 h (' + (A.done ? A.at.toFixed(2) + 'h' : A.q + '/10') + ')');
    const c4 = out['4x5min (08,12:30,18,22:30)'][strat];
    check(c4.done && c4.at <= 55, strat + ': 4 x 5 min a day finishes in <= ~55 h (' + (c4.done ? c4.at.toFixed(1) + 'h' : c4.q + '/10') + ')');
    check(c4.at >= 30, strat + ': 4 x 5 min a day still takes days, not hours (' + c4.at.toFixed(1) + 'h)');
    check(out['3x5min (08,14,21)'][strat].done, strat + ': 3 x 5 min a day finishes (' + out['3x5min (08,14,21)'][strat].at.toFixed(1) + 'h)');
    check(out['2x10min (08,20)'][strat].q >= 8, strat + ': 2 x 10 min a day gets 8-10 steps (' + out['2x10min (08,20)'][strat].q + ')');
  }
  // offline production counts: the casual player ends far beyond what the sessions alone would make
  // (the casual player has 60 min of sessions over the 3 days, the same as one hour of active play)
  check(cas.greedy.earned > 100 * act.greedy.marks[60], 'casual 72 h earns far more than one hour of active play');
}

// ---------------------------------------------------------------- (d) price maths + absurd saves
{
  T = Date.UTC(2026, 10, 3, 8, 0, 0);
  const s = E.newState(); s.rank = 3; E.tick(s, 0.01);
  const e = s.events;
  for (let k = 0; k < 4; k++) {
    for (const b of [0, 7, 100, 5000, 1e6, 1e15, 1e300]) {
      e.bought[k] = b;
      for (const cur of [0, 5, 1e6, 1e40, 1e300]) {
        e.cur = cur;
        const p = X.unitPrice(s, k), m = X.unitMax(s, k), c1 = X.unitCost(s, k, 1), c10 = X.unitCost(s, k, 10), cm = X.unitCost(s, k, 'max');
        const vals = [p, m, c1, c10, cm];
        check(vals.every(v => typeof v === 'number' && isFinite(v) && v >= 0), 'tier ' + k + ' bought ' + b + ' cur ' + cur + ': finite (' + vals.join(',') + ')');
        check(m === Math.floor(m) && m <= 1e5, 'unitMax integer and capped');
        const next = X.unitCost(s, k, m + 1);
        if (m > 0) check(cm <= cur * (1 + 1e-12) + 1e-9 && (next > cur || next >= 1e300), 'unitMax is the largest affordable n (tier ' + k + ', bought ' + b + ', cur ' + cur + ')');
      }
    }
  }
  e.bought = [5000, 5000, 5000, 5000]; e.cur = 1e300; e.units = [1e300, 1e300, 1e300, 1e300];
  for (let k = 0; k < 4; k++) X.buyUnit(s, k, 'max');
  E.coinCollected(s, 5, 1); // swipe rush on top of absurd units: saturates, never overflows to NaN/Infinity/0
  T += 1000; E.tick(s, 1);
  check(!badNum(s, 'state') && s.events.units.every(u => u > 0) && s.events.cur > 0, 'absurd save under the swipe rush: finite, nothing wiped to 0');
  T += 3600e3; E.offline(s, 3600);
  check(!badNum(s, 'state'), 'absurd save (bought 5000, cur/units 1e300): state finite after buys, ticks and offline (' + badNum(s, 'state') + ')');
  const r = E.deserialize(JSON.stringify(Object.assign(JSON.parse(E.serialize(s)), { events: Object.assign({}, s.events, { bought: [1e400, -4, 'x', null] }) })));
  check(r.events.bought.every(b => isFinite(b) && b >= 0) && [0, 1, 2, 3].every(k => isFinite(X.unitPrice(r, k))), 'garbage bought[] sanitized; prices finite');
}

console.log(fails ? 'TEST-LAIR-STRATEGY FAIL: ' + fails + ' failed, ' + passes + ' passed' : 'TEST-LAIR-STRATEGY OK: ' + passes + ' checks passed');
process.exit(fails ? 1 : 0);
