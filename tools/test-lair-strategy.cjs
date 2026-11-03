// Event lair strategy test: is climbing the chain the right play? Loads data.js + engine.js + events.js in a Node
// vm (as tools/test-events.cjs does), fakes the wall clock with HOARD.events._now, and plays the real lair with the
// REAL buy functions (unitPrice / unitMax / buyUnit) under several simple strategies:
//   never      buys nothing, never swipes
//   swipe      swipes coins in the cave, buys nothing
//   impOnly    the degenerate play: all currency into tier 0, plus exactly the one higher unit a quest asks for
//   topFirst   highest affordable tier first (Max of the top tier, then the next one down, ...)
//   greedy     best payback: buys the unit whose own production pays its price back soonest (a tier-k unit
//              returns R_k t^(k+1)/(k+1)! currency after t seconds, R_k = product of the chain rates up to k)
// Every buying strategy first buys (or saves for) the unit an "own" quest asks for, and claims quests and chests.
// Profiles: continuous active play (swiping 2 coins/s, one decision per second) for 15 and 60 min, and the casual
// 72 h model (check-ins of a few minutes at fixed hours, offline production in between, capped like the game).
// Asserts: (a) the degenerate tier-0 play earns >= 3x less than the best climbing strategy by 60 min of active play,
// and less over the 72 h casual model; the best strategy climbs; the greedy buyer's choices move up the tiers over
// time. (b) quest pacing: 4 x 5 min a day finishes in 45-60 h, 3 x 5 min reaches >= 9 steps, 2 x 10 min a decent
// partial, a very active player cannot finish early. (c) no NaN / Infinity / negatives, including absurd saves.
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
// true while saving for the unit the current "own" quest asks for
function questHelp(s) {
  const q = X.QUESTS[s.events.q];
  if (!q || q.kind !== 'own' || s.events.units[q.k] >= q.n) return false;
  const m = X.unitMax(s, q.k);
  if (m > 0) X.buyUnit(s, q.k, Math.min(Math.ceil(q.n - s.events.units[q.k]), m));
  return s.events.units[q.k] < q.n;
}
const STRATS = {
  never: { swipe: false, buy: null },
  swipe: { swipe: true, buy: null },
  impOnly: { swipe: true, buy(s) { if (!questHelp(s)) X.buyUnit(s, 0, 'max'); } },
  topFirst: { swipe: true, buy(s) { if (questHelp(s)) return; for (let k = 3; k >= 0; k--) X.buyUnit(s, k, 'max'); } },
  greedy: { swipe: true, climbs: true, buy(s, picks) {
    if (questHelp(s)) return;
    for (let i = 0; i < 500; i++) {
      let bk = 0, bt = Infinity;
      for (let k = 0; k < 4; k++) { const t = payback(s, k); if (t < bt) { bt = t; bk = k; } }
      if (!X.buyUnit(s, bk, 1)) return; // save up for the best buy
      if (picks) picks.push([T, bk]);
    }
  } }
};
STRATS.topFirst.climbs = true;
const NAMES = Object.keys(STRATS);

// ---------------------------------------------------------------- one run
// prof: { cont: seconds } continuous from the moment the lair opens, or { hours: [UTC hours], mins, days }
// (check-ins; the lair opens at the first one, 08:00 UTC), optional { contFirst: seconds } played non-stop first.
const COINS = 2; // coins swiped per second while playing (a relaxed swipe)
function play(name, prof) {
  const st = STRATS[name];
  T = Date.UTC(2026, 10, 3, 8, 0, 0);
  const t0 = T, end = t0 + 72 * HR;
  const s = E.newState(); s.rank = 3;
  E.tick(s, 0.01); // unlocks the lairs: the first lair opens now for 72 h
  const claims = [], picks = [], marks = {};
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
    for (let i = 1; i <= prof.cont; i++) { second(); if (prof.marks && prof.marks.includes(i)) marks[i] = s.events.earned; }
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
  return { name, s, earned: s.events.earned, q: s.events.q, claims, done: s.events.q >= X.QUESTS.length,
    at: claims.length ? claims[claims.length - 1] : 0, picks, marks, bought: s.events.bought.slice(), bad: badNum(s, 'state') };
}

// ---------------------------------------------------------------- (a) strategy comparison
const CASUAL = { hours: [8, 12.5, 18, 22.5], mins: 5 };
const table = {};
for (const n of NAMES) {
  const c = play(n, { cont: 3600, marks: [900, 3600] });
  const k = play(n, CASUAL);
  table[n] = { m15: c.marks[900], m60: c.marks[3600], h72: k.earned, q: k.q, picks: c.picks, bought60: c.bought, boughtK: k.bought };
  check(!c.bad && !k.bad, n + ': state finite and non-negative (' + (c.bad || k.bad) + ')');
}
console.log('strategy     earned@15min  earned@60min  earned 72h casual (4x5min/day)   quests   bought@60min      bought 72h');
for (const n of NAMES) {
  const r = table[n];
  console.log('  ' + n.padEnd(10) + fmt(r.m15).padStart(12) + fmt(r.m60).padStart(14) + fmt(r.h72).padStart(20) + String(r.q).padStart(20) + '/10   ' +
    r.bought60.map(Math.round).join('/').padEnd(17) + ' ' + r.boughtK.map(Math.round).join('/'));
}
const climbers = NAMES.filter(n => STRATS[n].climbs);
const best = key => NAMES.reduce((a, n) => (table[n][key] > table[a][key] ? n : a), NAMES[0]);
const bestClimb60 = Math.max(...climbers.map(n => table[n].m60));
const bestClimb72 = Math.max(...climbers.map(n => table[n].h72));
check(bestClimb60 >= 3 * table.impOnly.m60, '60 min active: best climber earns >= 3x the tier-0-only play (' + (bestClimb60 / table.impOnly.m60).toFixed(1) + 'x)');
check(bestClimb72 > table.impOnly.h72, '72 h casual: climbing beats tier-0-only (' + (bestClimb72 / table.impOnly.h72).toFixed(0) + 'x)');
check(STRATS[best('m60')].climbs, 'best strategy at 60 min climbs the chain (' + best('m60') + ')');
check(STRATS[best('h72')].climbs, 'best strategy over 72 h casual climbs the chain (' + best('h72') + ')');
check(table.impOnly.m60 > table.swipe.m60 && table.swipe.m60 > table.never.m60, 'buying beats swipe-only beats never buying');
check(table.impOnly.bought60[1] <= 1 && table.impOnly.bought60[2] <= 1 && table.impOnly.bought60[3] <= 1, 'tier-0-only buys at most one of each higher tier');
check(table.greedy.boughtK.every(b => b >= 10), 'greedy buys plenty of every tier over the event (' + table.greedy.boughtK.join('/') + ')');
// the best marginal buy moves up the tiers: mean tier of greedy's buys per window rises
{
  const t0 = Date.UTC(2026, 10, 3, 8, 0, 0);
  const wins = [[0, 120], [120, 600], [600, 1800], [1800, 3600]];
  const mean = wins.map(([a, b]) => {
    const p = table.greedy.picks.filter(([t]) => (t - t0) / 1000 > a && (t - t0) / 1000 <= b);
    return p.length ? p.reduce((x, y) => x + y[1], 0) / p.length : -1;
  });
  console.log('greedy: mean tier bought per window (0-2m, 2-10m, 10-30m, 30-60m): ' + mean.map(m => m.toFixed(2)).join(' '));
  check(mean[0] === 0, 'first 2 minutes: the best buy is tier 0');
  check(mean.every((m, i) => i === 0 || m > mean[i - 1]), 'the best marginal buy moves up the tiers over the first hour');
  check(mean[3] >= 1, 'by the second half hour the average buy is tier 1 or higher (mean ' + mean[3].toFixed(2) + ')');
  const late = play('greedy', { cont: 6 * 3600 }).picks.filter(([t]) => (t - t0) / HR > 5);
  check(late.some(p => p[1] === 3) && late.filter(p => p[1] >= 2).length > late.length / 2, 'after 5 h of play wyrm-tier buys are in the mix');
}

// ---------------------------------------------------------------- (b) quest pacing (greedy climber)
{
  const runs = {
    '4x5min (08,12:30,18,22:30)': { hours: [8, 12.5, 18, 22.5], mins: 5 },
    '3x5min (08,14,21)': { hours: [8, 14, 21], mins: 5 },
    '2x10min (08,20)': { hours: [8, 20], mins: 10 },
    'very active (6h non-stop, then 8x10min)': { contFirst: 6 * 3600, hours: [8, 10, 12, 14, 16, 18, 20, 22], mins: 10 },
    'non-stop 12h': { cont: 12 * 3600 }
  };
  const out = {};
  for (const n of Object.keys(runs)) {
    for (const strat of runs[n].hours && !runs[n].contFirst ? ['greedy', 'topFirst'] : ['greedy']) {
      const r = play(strat, runs[n]);
      if (strat === 'greedy') out[n] = r;
      check(!r.bad, n + ' (' + strat + '): finite (' + r.bad + ')');
      console.log('pace ' + strat.padEnd(8) + ' ' + n.padEnd(40) + ' quests ' + String(r.q).padStart(2) + '/10' + (r.done ? ' done at ' + r.at.toFixed(1) + 'h' : '') +
        '  claims(h): ' + r.claims.map(x => x.toFixed(1)).join(' '));
    }
  }
  const a = out['4x5min (08,12:30,18,22:30)'];
  check(a.done && a.at >= 45 && a.at <= 60, '4 x 5 min a day finishes in 45-60 h (' + a.at.toFixed(1) + 'h)');
  check(out['3x5min (08,14,21)'].q >= 9, '3 x 5 min a day reaches >= 9 steps (' + out['3x5min (08,14,21)'].q + ')');
  check(out['2x10min (08,20)'].q >= 7, '2 x 10 min a day: decent partial, >= 7 steps (' + out['2x10min (08,20)'].q + ')');
  const va = out['very active (6h non-stop, then 8x10min)'];
  check(!va.done || va.at >= 30, 'very active player cannot finish before 30 h (' + (va.done ? va.at.toFixed(1) + 'h' : va.q + '/10') + ')');
  check(!out['non-stop 12h'].done && out['non-stop 12h'].q <= 8, 'non-stop 12 h cannot finish (' + out['non-stop 12h'].q + '/10)');
  // offline production counts: the casual player is far ahead of what the sessions alone would make
  check(a.earned > 100 * table.greedy.m60, 'casual 72 h earns far more than one hour of play');
}

// ---------------------------------------------------------------- (c) price maths + absurd saves
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
  T += 1000; E.tick(s, 1);
  T += 3600e3; E.offline(s, 3600);
  check(!badNum(s, 'state'), 'absurd save (bought 5000, cur/units 1e300): state finite after buys, ticks and offline (' + badNum(s, 'state') + ')');
  const r = E.deserialize(JSON.stringify(Object.assign(JSON.parse(E.serialize(s)), { events: Object.assign({}, s.events, { bought: [1e400, -4, 'x', null] }) })));
  check(r.events.bought.every(b => isFinite(b) && b >= 0) && [0, 1, 2, 3].every(k => isFinite(X.unitPrice(r, k))), 'garbage bought[] sanitized; prices finite');
}

console.log(fails ? 'TEST-LAIR-STRATEGY FAIL: ' + fails + ' failed, ' + passes + ' passed' : 'TEST-LAIR-STRATEGY OK: ' + passes + ' checks passed');
process.exit(fails ? 1 : 0);
