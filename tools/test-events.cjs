// Event lairs test (SPEC-V2 section 3): loads data.js + engine.js + events.js in a Node vm and exercises the
// UTC schedule (edges via HOARD.events._now), unlock + immediate first start, the 4-tier chains, quests, event
// chests and the 9 exclusive cards, offline production inside the window only, the swipe bonus and swipe rush,
// Long Sleep and Ascend, save round-trips, the v1 fixtures, and the check-in pacing (4 x 5 min a day finishes in
// <= ~55 h, 2 x 10 min gets 8+ steps, and a player who swipes and buys non-stop finishes in 1.5-3 h).
// Usage: node tools/test-events.cjs        (PACE=1 prints every check-in of the pacing runs)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, rel) { return Math.abs(a - b) <= (rel || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b)); }
function badNum(o, p) {
  if (typeof o === 'number') return isFinite(o) ? (o < 0 && !/(until|minionTier|prevTier|firstSlot)$/.test(p) ? p + '<0' : null) : p;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = badNum(o[k], p + '.' + k); if (r) return r; }
  return null;
}
function load(files, seed) {
  seed = seed || 777;
  const sb = { console, Date, JSON, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  return sb.HOARD;
}
const FILES = ['js/data.js', 'js/engine.js', 'js/events.js'];
const H = load(FILES);
const E = H.engine, X = H.events, D = H.data;
check(!!X && typeof X.sync === 'function', 'HOARD.events exists');
try { load(FILES.concat(['js/ui.js', 'js/ui-events.js'])); passes++; } catch (e) { fails++; console.log('FAIL: ui-events.js throws in Node', e); }
const plain = load(['js/data.js', 'js/engine.js']);
const evts = [];
E.on('event', p => evts.push(p));
const clone = o => JSON.parse(JSON.stringify(o));
const HR = 3600e3, DAY = 24 * HR;
let T = Date.UTC(2026, 10, 2, 15, 0, 0);
X._now = () => T;
const A = X.C.anchor;
// live play: advance the wall clock with the game clock
function live(s, sec, dt) { dt = dt || 1; for (let t = 0; t < sec; t += dt) { T += dt * 1000; E.tick(s, dt); } }

// ---------------------------------------------------------------- cards
{
  check(X.CARDS.length === 9, '9 event cards');
  check(D.cards.length >= 29, 'registered into HOARD.data.cards (now ' + D.cards.length + ')');
  const ids = new Set(D.cards.map(c => c.id));
  check(ids.size === D.cards.length, 'card ids unique');
  X.LAIRS.forEach(l => {
    const p = X.cards(l.id);
    check(p.length === 3, l.id + ' has 3 cards');
    const defs = p.map(id => D.cards.find(c => c.id === id));
    check(defs.every(c => c.chest === false && typeof c.mod === 'function' && /epic|legendary/.test(c.rarity)), l.id + ' cards: chest:false, mod(), epic/legendary');
    check(defs.filter(c => c.rarity === 'legendary').length === 1, l.id + ' has one legendary');
  });
  let leaked = 0;
  for (let i = 0; i < 3000; i++) { const id = E.rollCard(); if (/^ev_/.test(id)) leaked++; }
  check(leaked === 0, 'event cards never roll from normal chests');
  const s = E.newState(); s.chests = 40;
  for (let i = 0; i < 40; i++) E.openChest(s);
  check(!Object.keys(s.cards).some(k => /^ev_/.test(k)), 'openChest never gives event cards');
  // every card mod changes stats (and nothing else) once owned
  const base = E.newState(); base.buildings.digger = 20; base.buildings.raid = 5; base.rank = 3; base.tiers = [100, 10, 3, 1, 0];
  E.dirty();
  const s0 = E.stats(base);
  const M0 = JSON.stringify(s0.M);
  X.CARDS.forEach(c => {
    const t = clone(base); t.cards[c.id] = 3;
    const st = E.stats(E.deserialize(t));
    check(JSON.stringify(st.M) !== M0, c.id + ' (Lv2) changes the modifier pipeline');
    check(!badNum(st, 'stats'), c.id + ' stats finite');
    const txt = E.cardInfo(t, c.id).text;
    check(typeof txt === 'string' && txt.length > 5 && !/NaN|undefined/.test(txt), c.id + ' text: ' + txt);
  });
  const t = clone(base); t.cards.ev_obsidianheart = 1;
  check(near(E.stats(E.deserialize(t)).gps, s0.gps * 1.2, 1e-9), 'Obsidian Heart Lv1 = all gold x1.2');
  // without event cards owned, stats are identical to the engine without the module
  const p = plain.engine.deserialize(E.serialize(base));
  check(near(E.stats(base).gps, plain.engine.stats(p).gps) && near(E.stats(base).coinWorth, plain.engine.stats(p).coinWorth), 'no event cards: stats identical to the engine without events.js');
}

// ---------------------------------------------------------------- schedule (pure)
{
  const g = X.globalSlot;
  check(g(A).slot === 0 && g(A).lair.id === 'volcano' && g(A).active, 'anchor: slot 0 Volcano active');
  check(g(A + 72 * HR - 1).active && g(A + 72 * HR - 1).lair.id === 'volcano', '72h - 1ms: still Volcano');
  check(!g(A + 72 * HR).active, '72h: break');
  check(!g(A + 96 * HR - 1).active && g(A + 96 * HR - 1).slot === 0, '96h - 1ms: still the break of slot 0');
  check(g(A + 96 * HR).slot === 1 && g(A + 96 * HR).lair.id === 'frost' && g(A + 96 * HR).active, '96h: Frozen Peak');
  check(g(A + 192 * HR).lair.id === 'sea', '192h: Sunken Ship');
  check(g(A + 288 * HR).lair.id === 'volcano', '288h: Volcano again (12-day rotation)');
  check(g(A - 1).slot === -1 && g(A - 1).lair.id === 'sea' && !g(A - 1).active, 'before the anchor: slot -1 (Sunken Ship), in its break');
  check(g(A - 96 * HR).lair.id === 'sea' && g(A - 96 * HR).active, 'slot -1 starts 96h before the anchor');
  check(g(Date.UTC(2030, 5, 1)).start % DAY === 0, 'slots start at UTC midnight');
  // locked
  check(X.schedule(E.newState(), T).status === 'locked', 'fresh state: locked');
  // first start inside a window: personal 72h from the unlock moment
  for (const off of [0, 1, 30, 71.9]) {
    const s = E.newState(); s.rank = 3;
    const t0 = A + 75 * 96 * HR + off * HR;           // slot 75 is Volcano
    X.sync(s, t0);
    const e = s.events;
    check(e.firstStart === t0 && e.firstSlot === 75 && e.lair === 'volcano' && e.start === t0 && e.end === t0 + 72 * HR, 'unlock at +' + off + 'h of a Volcano window: personal Volcano 72h from now');
    const sch = X.schedule(s, t0 + 72 * HR - 1);
    check(sch.status === 'active' && sch.first, 'first event still active at 72h - 1ms (+' + off + 'h)');
  }
  // first start during a break: the upcoming lair starts early, its global slot is skipped afterwards
  {
    const s = E.newState(); s.rank = 3;
    const t0 = A + 75 * 96 * HR + 80 * HR;          // break after Volcano 75 -> Frozen Peak (76) early
    X.sync(s, t0);
    check(s.events.lair === 'frost' && s.events.firstSlot === 76 && s.events.end === t0 + 72 * HR, 'unlock in a break: upcoming Frozen Peak starts now');
    const after = X.schedule(s, t0 + 72 * HR + 1);
    check(after.status === 'break' && after.next.slot === 77 && after.next.lair.id === 'sea', 'after it: no second Frozen Peak; wait for the Sunken Ship');
    check((after.next.start - (t0 + 72 * HR)) / HR <= 48 + 1e-9, 'wait after an early first lair <= 48h');
  }
  // sweep unlock times over two rotations: first lair always 72h, wait after it <= 48h, ids never repeat,
  // the following lair is the next one in the rotation, and deterministic
  let maxWait = 0, minLeft = 1e9, lateJoins = 0;
  for (let h = 0; h < 24 * 24; h += 1) {
    const s = E.newState(); s.sleeps = 1;
    const t0 = A + 100 * 96 * HR + h * HR + 17 * 60e3;
    X.sync(s, t0);
    const e0 = clone(s.events);
    check(e0.end - e0.start === 72 * HR, 'first lair lasts 72h (unlock +' + h + 'h)');
    const sch = X.schedule(s, e0.end);
    let wait = 0, next;
    if (sch.status === 'active') { next = sch; lateJoins++; minLeft = Math.min(minLeft, (sch.end - e0.end) / HR); }
    else { wait = (sch.next.start - e0.end) / HR; next = X.schedule(s, sch.next.start); }
    maxWait = Math.max(maxWait, wait);
    check(next.status === 'active' && next.slot > e0.firstSlot, 'next lair is a later slot (unlock +' + h + 'h)');
    check(next.lair.id !== e0.lair, 'next lair differs from the first (unlock +' + h + 'h)');
    const again = E.newState(); again.sleeps = 1; X.sync(again, t0);
    check(JSON.stringify(again.events) === JSON.stringify(s.events), 'deterministic schedule');
    if (fails > 20) break;
  }
  check(maxWait <= 48 + 1e-9, 'max wait after the first lair = ' + maxWait.toFixed(1) + 'h (<= 48h)');
  console.log('schedule: max wait after the first lair ' + maxWait.toFixed(1) + 'h; ' + lateJoins + '/576 unlock hours join the next lair late, with >= ' + minLeft.toFixed(1) + 'h left');
}

// ---------------------------------------------------------------- unlock rules + lifecycle
{
  T = A + 75 * 96 * HR + 5 * HR;
  const s = E.newState();
  live(s, 3);
  check(!X.unlocked(s) && s.events.id === '', 'rank 1: locked');
  s.rank = 2; live(s, 3);
  check(!X.unlocked(s), 'rank 2: locked');
  evts.length = 0;
  s.rank = 3; live(s, 1);
  check(X.unlocked(s) && s.events.lair === 'volcano' && X.active(s), 'rank 3: unlocked, Volcano running');
  check(evts.some(p => p.type === 'unlock') && evts.some(p => p.type === 'start' && p.lair === 'volcano'), "'event' unlock + start emitted");
  check(s.events.cur === X.C.startCur, 'starts with ' + X.C.startCur + ' currency');
  s.earnedRun = 2e7;
  check(E.sleep(s) > 0, 'Long Sleep taken');
  check(s.rank === 1 && X.unlocked(s) && X.active(s), 'Long Sleep: rank 1 but the lairs stay unlocked and running');
  const s2 = E.newState(); s2.sleeps = 1; live(s2, 1);
  check(X.unlocked(s2), 'sleeps >= 1: unlocked at rank 1');
}

// ---------------------------------------------------------------- chain: buying + exact production
{
  T = A + 75 * 96 * HR + 2 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  const e = s.events;
  e.cur = 0;
  check(X.buyUnit(s, 0, 1) === false, 'cannot buy when short');
  e.cur = 1e6;
  const C0 = X.CHAIN[0], g0 = C0.grow;
  check(near(X.unitPrice(s, 0), C0.cost) && X.unitCost(s, 0, 1) === X.unitPrice(s, 0), 'first unit costs the base price');
  check(X.buyUnit(s, 0, 1) && e.units[0] === 1 && e.bought[0] === 1 && near(e.cur, 1e6 - C0.cost), 'buy 1 tier-1 at the base price');
  check(near(X.unitPrice(s, 0), C0.cost * g0), 'next price rises by the growth factor (x' + g0 + ')');
  const c10 = X.unitCost(s, 0, 10);
  let sum = 0; for (let i = 1; i <= 10; i++) sum += C0.cost * Math.pow(g0, i);
  check(near(c10, sum, 1e-9), 'x10 price = sum of the geometric series (' + c10.toFixed(2) + ' vs ' + sum.toFixed(2) + ')');
  check(X.buyUnit(s, 0, 10) && e.units[0] === 11 && e.bought[0] === 11 && near(e.cur, 1e6 - C0.cost - sum, 1e-9), 'buy 10 charges the series');
  // one-by-one == at once
  { const a = clone(s), b = clone(s); for (let i = 0; i < 7; i++) X.buyUnit(a, 2, 1); X.buyUnit(b, 2, 7); check(near(a.events.cur, b.events.cur, 1e-9) && a.events.bought[2] === 7 && b.events.bought[2] === 7, '7 single buys cost the same as one x7 buy'); }
  { const z = clone(s); z.events.cur = 1e9; const m3 = X.unitMax(z, 3); check(m3 >= 1 && X.unitCost(z, 3, m3) <= z.events.cur && X.unitCost(z, 3, m3 + 1) > z.events.cur, 'unitMax = largest affordable n (' + m3 + ' wyrms)'); }
  check(X.unitMax(s, 3) === 0 || X.unitCost(s, 3, X.unitMax(s, 3)) <= e.cur, 'unitMax never over-spends');
  check(X.unitCost(s, 1, 'max') === X.unitCost(s, 1, X.unitMax(s, 1)), "unitCost(..., 'max') = cost of unitMax");
  // produced units are free and never raise prices
  { const p1 = X.unitPrice(s, 0), b0 = e.bought[0]; e.units[0] += 500; check(X.unitPrice(s, 0) === p1 && e.bought[0] === b0, 'units produced by the tier above do not raise the price'); e.units[0] -= 500; }
  check(X.buyUnit(s, 'imp', 2) && e.units[0] === 13, 'buy by unit id');
  check(X.buyUnit(s, 7, 1) === false && X.buyUnit(s, -1, 1) === false && X.buyUnit(s, 'nope', 1) === false && X.buyUnit(s, 0, NaN) === false && X.buyUnit(s, 0, 0) === false, 'bad ids/amounts refused');
  check(X.unitPrice(s, 9) === 0 && X.unitCost(s, -1, 3) === 0 && X.unitMax(s, 1.5) === 0, 'bad tiers: zero price/max');
  const before = e.cur; const m = X.unitMax(s, 1), cm = X.unitCost(s, 1, m);
  check(X.buyUnit(s, 1, 'max') && e.units[1] === m && e.cur < X.unitPrice(s, 1) && near(before - e.cur, cm, 1e-9), 'buy Max');
  // absurd purchase counts (a save from the flat-price days): huge but finite prices, nothing affordable
  { const z = clone(s); z.events.bought = [5000, 1e9, 1e300, 0]; z.events.cur = 1e300;
    const ps = [0, 1, 2, 3].map(k => X.unitPrice(z, k));
    check(ps.every(p => isFinite(p) && p > 0) && X.unitMax(z, 1) === 0 && X.unitMax(z, 2) === 0 && X.buyUnit(z, 2, 1) === false, 'bought 5000 / 1e9 / 1e300: finite prices, unbuyable when clamped (' + ps.map(p => p.toExponential(1)).join(' ') + ')');
    check(X.buyUnit(z, 3, 'max') && !badNum(z, 'z'), 'other tiers still buyable; state finite'); }
  check(X.buyUnit(s, 1, 'max') === false, 'Max when broke refused');
  // exact closed form: one 2h step == 7200 one-second steps (the polynomial flow composes exactly)
  const a = clone(e), b = clone(e);
  a.units = [5, 3, 2, 1]; b.units = [5, 3, 2, 1]; a.cur = b.cur = 0; a.earned = b.earned = 0;
  const sa = { events: a }, sb2 = { events: b };
  X.produce(sa, 7200);
  for (let i = 0; i < 7200; i++) X.produce(sb2, 1);
  check(near(a.cur, b.cur, 1e-9) && a.units.every((u, i) => near(u, b.units[i], 1e-9)), 'closed form composes exactly (' + a.cur.toFixed(3) + ' vs ' + b.cur.toFixed(3) + ')');
  // tiny-step Euler agrees to <0.1%
  const c = clone(e); c.units = [5, 3, 2, 1]; c.cur = 0;
  let u = c.units.slice(), cur = 0; const R = X.CHAIN.map(x => x.rate), dt = 0.05;
  for (let t = 0; t < 7200; t += dt) { cur += R[0] * u[0] * dt; u[0] += R[1] * u[1] * dt; u[1] += R[2] * u[2] * dt; u[2] += R[3] * u[3] * dt; }
  check(Math.abs(cur - a.cur) / a.cur < 1e-3, 'matches numeric integration (' + cur.toFixed(1) + ' vs ' + a.cur.toFixed(1) + ')');
  // live production follows the wall clock
  e.units = [100, 0, 0, 0]; e.cur = 0;
  live(s, 60);
  check(near(e.cur, 100 * X.CHAIN[0].rate * 60, 1e-6), '60s live: 100 tier-1 make ' + (100 * X.CHAIN[0].rate * 60) + ' (got ' + e.cur.toFixed(3) + ')');
  const c0 = e.cur; E.tick(s, 1); // game ticks while the wall clock stands still produce nothing extra
  check(near(e.cur, c0), 'no production without wall time passing');
}

// ---------------------------------------------------------------- swipe bonus
{
  T = A + 75 * 96 * HR + 3 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  const e = s.events; e.units = [50, 0, 0, 0];
  const per = X.perCoin(s);
  check(near(per, X.C.coinBase + X.C.coinRate * 50 * X.CHAIN[0].rate), 'perCoin = base + coinRate x currency/s');
  const c0 = e.cur, k0 = e.coins;
  check(!X.rushing(s) && X.speed(s) === 1, 'no swipe rush before the first coin');
  E.coinCollected(s, 40, 3);
  check(X.rushing(s) && e.rush === X.C.rushSec && X.speed(s) === X.C.rushMult, 'a swiped coin starts the swipe rush (x' + X.C.rushMult + ' for ' + X.C.rushSec + 's)');
  T += 1000; E.tick(s, 1);
  const prod = 50 * X.CHAIN[0].rate;
  check(near(e.cur - c0, 40 * per + prod * X.C.rushMult, 1e-9), '40 swiped coins add ' + (40 * per).toFixed(2) + ' + 1s production at rush speed');
  check(e.coins - k0 === 40 && e.fromCoins > 0, 'coins counted for quests');
  // the rush runs the whole chain faster (a time warp): 10 rushed seconds == 10 x rushMult normal seconds
  { const a = clone(s), ref = { events: clone(e) };
    a.events.units = [5, 3, 2, 1]; ref.events.units = [5, 3, 2, 1]; a.events.cur = ref.events.cur = 0;
    E.coinCollected(a, 1, 1); a.events.cur = 0; ref.events.cur = 0;
    for (let i = 0; i < 10; i++) { T += 1000; E.tick(a, 1); }
    X.produce(ref, 10 * X.C.rushMult);
    check(near(a.events.cur, ref.events.cur, 1e-9) && a.events.units.every((u, i) => near(u, ref.events.units[i], 1e-9)), 'rushed live play = time warp of the whole chain (' + a.events.cur.toFixed(2) + ' vs ' + ref.events.cur.toFixed(2) + ')');
    // it runs out rushSec after the last coin, then production is back to normal speed
    for (let i = 0; i < X.C.rushSec; i++) { T += 1000; E.tick(a, 1); }
    check(!X.rushing(a) && a.events.rush === 0, 'rush ends ' + X.C.rushSec + 's after the last coin');
    const b = clone(a); b.events.units = [100, 0, 0, 0]; b.events.cur = 0;
    for (let i = 0; i < 5; i++) { T += 1000; E.tick(b, 1); }
    check(near(b.events.cur, 100 * X.CHAIN[0].rate * 5, 1e-9), 'after the rush: normal speed');
    // offline never rushes, and a saved rush is clamped
    E.coinCollected(b, 1, 1); b.events.cur = 0; b.savedAt = T;
    const r = E.deserialize(E.serialize(b)); T += 3600e3; E.offline(r, 3600);
    check(near(r.events.cur, 100 * X.CHAIN[0].rate * 3600, 1e-6) && r.events.rush === 0, 'offline production runs at normal speed and clears the rush');
    const bad = E.deserialize(JSON.stringify(Object.assign(JSON.parse(E.serialize(b)), { events: Object.assign({}, b.events, { rush: 1e9 }) })));
    const bad2 = E.deserialize(JSON.stringify(Object.assign(JSON.parse(E.serialize(b)), { events: Object.assign({}, b.events, { rush: 'x' }) })));
    check(bad.events.rush === X.C.rushSec && bad2.events.rush === 0, 'saved rush sanitized (' + bad.events.rush + ', ' + bad2.events.rush + ')'); }
  // only the player's own swipes rouse the brood: coins an automation pays (Restless Wings' auto-gust runs inside
  // E.automated) add currency but never start or refresh the rush (review: an AFK tab kept x25 on and won x500-x5000)
  { const c = clone(s); c.events.rush = 0; c.events.units = [50, 10, 2, 0];
    const k1 = c.events.cur;
    E.automated(() => E.coinCollected(c, 6, 1, 3));
    check(c.events.rush === 0 && !X.rushing(c) && c.events.cur > k1, 'automated coins add currency but no rush');
    const idle = clone(c), afk = clone(c); let on = 0;
    for (let i = 1; i <= 3600; i++) {
      T += 1000; E.tick(idle, 1); E.tick(afk, 1);
      if (i % 20 === 0) E.automated(() => E.coinCollected(afk, 6, 1, 3));  // Bigger Wings II + Restless Wings, nobody swiping
      if (X.rushing(afk)) on++;
    }
    const extra = afk.events.fromCoins - idle.events.fromCoins;
    check(on === 0 && near(afk.events.earned - extra, idle.events.earned, 1e-9), 'AFK auto-gusts for 1 h: rush on ' + on + ' s, brood output identical to no gusts (' + (afk.events.earned / idle.events.earned).toFixed(3) + 'x incl. coin currency)'); }
  // the lair sheet covers the cave: the rush runs down rushSheetDrain as fast while it is open (bounded, never frozen)
  { const c = clone(s); E.coinCollected(c, 1, 1);
    const dr = X.C.rushSheetDrain, keep = X.C.rushSec / dr;
    check(dr > 0 && dr < 1, 'sheet drain ' + dr + ' (a ' + X.C.rushSec + ' s rush lasts ' + keep + ' s of shopping)');
    X.setSheetOpen(true);
    for (let i = 0; i < keep - 1; i++) { T += 1000; E.tick(c, 1); }
    const mid = X.rushing(c);
    for (let i = 0; i < 2; i++) { T += 1000; E.tick(c, 1); }
    check(mid && !X.rushing(c) && c.events.rush === 0, 'sheet open: rush lasts ' + keep + ' s, then ends');
    X.setSheetOpen(false);
    E.coinCollected(c, 1, 1);
    for (let i = 0; i < X.C.rushSec; i++) { T += 1000; E.tick(c, 1); }
    check(!X.rushing(c), 'sheet closed: back to ' + X.C.rushSec + ' s'); }
  const o = E.newState(); E.coinCollected(o, 50, 1); T += 1000; E.tick(o, 1);
  check(o.events.coins === 0 && o.events.cur === 0, 'no event: coins give no currency');
}

// ---------------------------------------------------------------- offline: only inside the window
{
  T = A + 75 * 96 * HR + 10 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  const e = s.events;
  e.units = [200, 20, 3, 1]; e.cur = 0; e.earned = 0;
  const ref = { events: clone(e) };
  s.savedAt = T;
  const saved = E.serialize(s);
  T += 6 * HR;                                        // away 6h, well inside the window
  const r = E.deserialize(saved);
  const res = E.offline(r, 6 * 3600);              // serialize() stamps savedAt with the real clock
  X.produce(ref, 6 * 3600);
  check(res.seconds === 6 * 3600, 'offline simulated 6h');
  check(near(r.events.cur, ref.events.cur, 1e-6), 'offline 6h == closed form 6h (' + r.events.cur.toExponential(4) + ')');
  check(near(r.events.offGain, ref.events.cur, 1e-6), 'offGain records what the lair made away');
  check(near(X.takeOfflineGain(r), ref.events.cur, 1e-6) && r.events.offGain === 0, 'takeOfflineGain reads and clears');
  // window ends while away: production stops at the end
  const s2 = E.deserialize(saved);
  const end = s2.events.end;
  s2.events.at = end - 2 * HR; s2.savedAt = end - 2 * HR;
  T = end + 6 * HR;
  const ref2 = { events: clone(s2.events) };
  E.offline(s2, 8 * 3600);
  X.produce(ref2, 2 * 3600);
  check(near(s2.events.cur, ref2.events.cur, 1e-6), 'window closes 2h into an 8h absence: exactly 2h produced');
  T += 1000; E.tick(s2, 1);
  check(s2.events.over === true || s2.events.id !== ref2.events.id, 'next live tick closes the event');
  // no event: offline does nothing to the subtree
  const s3 = E.newState(); s3.savedAt = T - 3 * HR; const j = JSON.stringify(s3.events);
  E.offline(s3, 3 * 3600);
  check(JSON.stringify(s3.events) === j, 'locked: offline leaves events untouched');
  check(!badNum(r, 'state') && !badNum(s2, 'state'), 'offline states finite');
}

// ---------------------------------------------------------------- quests, chests, cards, finish, next lair
{
  T = A + 75 * 96 * HR + 1 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  const e = s.events;
  check(X.questInfo(s).title === 'Own 10 Magma Imps' && !X.questInfo(s).done, 'quest 1: Own 10 Magma Imps');
  check(X.claimQuest(s) === false, 'cannot claim an unfinished quest');
  const titles = X.QUESTS.map((q, i) => X.questInfo(s, i).title);
  check(titles.every(t => t && !/NaN|undefined|\.0[A-Z]/.test(t)), 'quest titles: ' + titles.join(' | '));
  const order = [];
  evts.length = 0;
  for (let i = 0; i < X.QUESTS.length; i++) {
    const q = X.QUESTS[i];
    if (q.kind === 'own') e.units[q.k] = Math.max(e.units[q.k], q.n);
    if (q.kind === 'earn') e.earned = Math.max(e.earned, q.n);
    if (q.kind === 'coins') e.coins = Math.max(e.coins, q.n);
    check(X.questInfo(s).done, 'quest ' + (i + 1) + ' done when met');
    check(X.claimQuest(s) && e.q === i + 1 && e.chests === i + 1, 'claim quest ' + (i + 1) + ' -> chest');
    order.push(i);
  }
  check(X.claimQuest(s) === false && X.questInfo(s).title === '', 'line complete: nothing more to claim');
  check(evts.filter(p => p.type === 'quest').length === 10 && evts.some(p => p.type === 'complete'), "'event' quest x10 + complete emitted");
  const pool = X.cards('volcano');
  const got = [];
  while (e.chests > 0) got.push(X.openChest(s));
  check(got.length === 10, '10 chests opened');
  check(got[2].length === 1 && got[2][0] === pool[1], 'quest 3 chest = guaranteed ' + pool[1]);
  check(got[4].length === 1 && got[4][0] === pool[2], 'quest 5 chest = guaranteed ' + pool[2]);
  check(got[9].length === 3 && new Set(got[9]).size === 3 && got[9].every(id => pool.includes(id)), 'last chest = all three lair cards');
  check(got.flat().every(id => pool.includes(id)), 'every chest card is from this lair');
  const total = got.flat().length;
  check(total === 12 && e.got === 12, '12 event cards per full quest line');
  check(pool.every(id => s.cards[id] >= 1), 'all 3 Volcano cards owned');
  // unopened chests open by themselves when the lair closes
  const s2 = E.newState(); s2.rank = 3; live(s2, 1);
  s2.events.units[0] = 10; X.claimQuest(s2); s2.events.coins = 500; X.claimQuest(s2);
  check(s2.events.chests === 2, '2 unopened chests');
  evts.length = 0;
  T = s2.events.end + 1000; E.tick(s2, 1);
  check(s2.events.over === true && s2.events.chests === 0, 'lair closed: chests opened automatically');
  check(Object.keys(s2.cards).filter(k => /^ev_/.test(k)).reduce((a, k) => a + s2.cards[k], 0) === 2, 'auto-opened chests gave 2 cards');
  check(evts.some(p => p.type === 'finish' && p.quests === 2 && p.cards.length === 2), "'event' finish emitted with cards");
  check(X.claimQuest(s2) === false && X.buyUnit(s2, 0, 1) === false, 'closed lair: no claims, no buying');
  check(s2.events.last.lair === 'volcano' && s2.events.last.q === 2, 'last summary kept');
  // next lair (joined late or after a break) resets the event state; cards stay
  const cardsBefore = clone(s2.cards);
  const sch = X.schedule(s2, T);
  T = sch.status === 'active' ? T + 1000 : sch.next.start + 1000;
  E.tick(s2, 1);
  check(X.active(s2) && s2.events.lair !== 'volcano' && s2.events.q === 0 && s2.events.units.every(u => u === 0) && s2.events.cur === X.C.startCur, 'next lair: fresh state (' + s2.events.lair + ')');
  check(JSON.stringify(s2.cards) === JSON.stringify(cardsBefore), 'cards kept across lairs');
  check(X.questInfo(s2).title.indexOf(s2.events.lair === 'frost' ? 'Snow Kobolds' : 'Crab Divers') >= 0, 'next lair quest uses its own units');
  check(s2.events.joined === 2, 'joined counter 2');
}

// ---------------------------------------------------------------- automation (LORE Quest Scribe / Chest Kobold)
{
  T = A + 76 * 96 * HR + 1 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  s.events.units[0] = 10;
  live(s, 2);
  check(s.events.q === 0, 'no auto-claim without lore');
  s.lore = { auto_quest: 1, auto_chest: 1 };
  live(s, 2);
  check(s.events.q >= 1 && s.events.chests === 0 && s.events.got >= 1, 'Quest Scribe + Chest Kobold claim and open event quests');
  s.auto = { master: false }; s.events.coins = 1000;
  live(s, 2);
  check(s.events.q === 1, 'automation master switch off: no auto-claim');
}

// ---------------------------------------------------------------- Long Sleep / Ascend / save round-trip / garbage
{
  T = A + 77 * 96 * HR + 5 * HR;
  const s = E.newState(); s.rank = 3; live(s, 1);
  s.events.units = [123, 4, 2, 1]; s.events.cur = 4567; s.events.q = 3; s.events.coins = 99;
  s.earnedRun = 2e7;
  const before = clone(s.events);
  E.sleep(s);
  check(JSON.stringify(s.events) === JSON.stringify(before), 'Long Sleep leaves the event untouched');
  E.resetRun(s, 'ascend');
  check(JSON.stringify(s.events) === JSON.stringify(before), 'Ascend (resetRun) leaves the event untouched');
  s.savedAt = T;
  const j = E.serialize(s);
  const r = E.deserialize(j);
  check(JSON.stringify(r.events) === JSON.stringify(s.events), 'serialize/deserialize round-trip');
  const noAt = x => x.replace(/"savedAt":[0-9.]+/, '');
  check(noAt(E.serialize(r)) === noAt(j), 'second round-trip byte-identical (savedAt aside)');
  const g = JSON.parse(j);
  g.events = { firstStart: 'x', units: [NaN, -5, 'a', 1e400], cur: -3, q: 99, chests: 1e9, lair: 'mars', id: 7, chestCards: [0, 'z'], at: null, junk: { keep: 1 } };
  const rg = E.deserialize(JSON.stringify(g));
  check(rg.events.firstStart === 0 && rg.events.units.every(u => u >= 0 && isFinite(u)) && rg.events.cur === 0 && rg.events.q === 10 && rg.events.chests === 50 && rg.events.lair === '' && rg.events.id === '', 'garbage subtree sanitized');
  check(rg.events.junk && rg.events.junk.keep === 1, 'unknown keys kept (forward compatible)');
  check(!badNum(rg, 'state'), 'sanitized state finite');
  live(rg, 2);
  check(X.unlocked(rg) && X.active(rg), 'sanitized locked state unlocks again at rank 3');
  const rn = E.deserialize(JSON.stringify(Object.assign(JSON.parse(j), { events: null })));
  check(rn.events && rn.events.firstStart === 0, 'null subtree -> defaults');
  // a save without the module keeps the subtree untouched (foundation guarantee)
  const p = plain.engine.deserialize(j);
  check(JSON.stringify(p.events) === JSON.stringify(s.events), 'engine without events.js keeps the subtree');
}

// ---------------------------------------------------------------- v1 fixtures
{
  const fx = fs.readdirSync(path.join(root, 'tools/fixtures')).filter(f => /^v1-.*\.json$/.test(f));
  check(fx.length >= 4, 'found ' + fx.length + ' v1 fixtures');
  T = A + 78 * 96 * HR + 3 * HR;
  for (const f of fx) {
    const raw = fs.readFileSync(path.join(root, 'tools/fixtures', f), 'utf8');
    const v1 = JSON.parse(raw);
    const s = E.deserialize(raw);
    check(s.v === 2 && s.events && s.events.firstStart === 0 && s.events.id === '', f + ': loads with default (locked) events');
    check(s.gold === v1.gold && s.legend === v1.legend && s.rank === v1.rank && JSON.stringify(s.cards) === JSON.stringify(v1.cards), f + ': v1 data intact');
    s.savedAt = T - 2 * HR;
    const off = E.offline(s, 2 * 3600);
    check(off.seconds === 7200 && s.events.cur === 0, f + ': offline with locked events is harmless');
    live(s, 1);
    const shouldUnlock = v1.rank >= 3 || (v1.sleeps || 0) >= 1;
    check(X.unlocked(s) === shouldUnlock, f + ': unlock (rank ' + v1.rank + ', sleeps ' + (v1.sleeps || 0) + ') = ' + shouldUnlock);
    if (shouldUnlock) check(X.active(s) && s.events.firstStart === T, f + ': first lair starts immediately');
    const r = E.deserialize(E.serialize(s));
    check(JSON.stringify(r.events) === JSON.stringify(s.events), f + ': round-trip');
    check(!badNum(s, 'state'), f + ': finite');
  }
}

// ---------------------------------------------------------------- pacing
// profile: check-ins at fixed UTC hours, each `mins` long, swiping `coins` coins/s; between them offline()
// (capped like the game, 8h). The player claims, opens chests, then buys: units for an "own" quest first,
// otherwise top tier down. 'cont' plays non-stop for `hours`. Swiping keeps the swipe rush on during sessions.
function pace(prof) {
  const P = load(FILES, 99);
  const E2 = P.engine, X2 = P.events;
  // the lair opens at the first check-in (first unlock), or for a global lair at 00:00 UTC (lateStart)
  let t = Date.UTC(2026, 10, 3, prof.lateStart ? 0 : 8, 0, 0);
  X2._now = () => t;
  const s = E2.newState(); s.rank = 3;
  const t0 = t; const claims = []; const ci = [];
  function act() {
    while (X2.questInfo(s).done) { X2.claimQuest(s); claims.push((t - t0) / HR); }
    while (s.events.chests > 0) X2.openChest(s);
    const q = X2.QUESTS[s.events.q];
    if (q && q.kind === 'own' && s.events.units[q.k] < q.n) X2.buyUnit(s, q.k, Math.min(q.n - Math.floor(s.events.units[q.k]), X2.unitMax(s, q.k)));
    for (let k = 3; k >= 0; k--) { if (q && q.kind === 'own' && k < q.k && s.events.units[q.k] < q.n) continue; X2.buyUnit(s, k, 'max'); }
  }
  function session(sec) {
    for (let i = 0; i < sec; i++) {
      t += 1000;
      if (prof.coins) E2.coinCollected(s, prof.coins, 1);
      E2.tick(s, 1);
      if (i % 5 === 0) act();
    }
    act();
    s.savedAt = t;
  }
  E2.tick(s, 0.01);
  if (prof.cont) session(prof.cont * 3600);
  else {
    for (let day = 0; t - t0 < 72 * HR; day++) {
      for (const h of prof.hours) {
        const at = Date.UTC(2026, 10, 3 + day, 0, 0, 0) + h * HR;
        if (at < t) continue;
        if (at - t0 >= 72 * HR) { t = t0 + 72 * HR; break; } // the first lair has closed
        const gap = (at - t) / 1000;
        t = at;
        if (gap > 0) E2.offline(s, Math.min(gap, E2.stats(s).offlineCapHours * 3600));
        session(prof.mins * 60);
        ci.push(((t - t0) / HR).toFixed(1) + 'h: q' + s.events.q + ' earned ' + P.fmt(s.events.earned) + ' units ' + s.events.units.map(u => P.fmt(u)).join('/'));
      }
    }
  }
  const bad = badNum(s, 'state');
  return { q: s.events.q, claims, ci, done: s.events.q >= X2.QUESTS.length, at: claims.length ? claims[claims.length - 1] : 0, s, bad, P };
}
{
  const runs = {
    '4x5min (08,12:30,18,22:30)': { hours: [8, 12.5, 18, 22.5], mins: 5, coins: 2 },
    '3x5min (08,14,21)': { hours: [8, 14, 21], mins: 5, coins: 2 },
    '5x5min': { hours: [8, 11, 14, 18, 22], mins: 5, coins: 2 },
    '4x5min, lazy swiper (1 coin/s)': { hours: [8, 12.5, 18, 22.5], mins: 5, coins: 1 },
    '2x10min (08,20)': { hours: [8, 20], mins: 10, coins: 2 },
    '4x5min, lair opened 8h before': { hours: [8, 12.5, 18, 22.5], mins: 5, coins: 2, lateStart: true },
    '3x5min, lair opened 8h before': { hours: [8, 14, 21], mins: 5, coins: 2, lateStart: true },
    'non-stop 6h': { cont: 6, coins: 2 }
  };
  const out = {};
  for (const name of Object.keys(runs)) {
    const r = pace(runs[name]);
    out[name] = r;
    check(!r.bad, name + ': state finite (' + r.bad + ')');
    console.log('pace ' + name.padEnd(32) + ' quests ' + String(r.q).padStart(2) + '/10' + (r.done ? ' done at ' + r.at.toFixed(1) + 'h' : '') +
      '  claims(h): ' + r.claims.map(x => x.toFixed(1)).join(' '));
    if (process.env.PACE) r.ci.forEach(x => console.log('     ' + x));
  }
  const a = out['4x5min (08,12:30,18,22:30)'];
  check(a.done && a.at <= 72, '4x5min/day finishes the whole line within 72h (at ' + a.at.toFixed(1) + 'h)');
  check(a.at >= 40, '4x5min/day: not finished early (' + a.at.toFixed(1) + 'h >= 40h)');
  const firstDay = a.claims.filter(x => x < 24).length;
  check(firstDay >= 4 && firstDay <= 8, '4x5min/day: ' + firstDay + ' quests on day 1 (spread over 3 days)');
  check(out['3x5min (08,14,21)'].done, '3 check-ins a day also finish (at ' + out['3x5min (08,14,21)'].at.toFixed(1) + 'h)');
  check(out['5x5min'].done && out['5x5min'].at >= 36, '5 check-ins a day finish, still not early (' + out['5x5min'].at.toFixed(1) + 'h)');
  check(out['4x5min, lair opened 8h before'].done, 'a global lair first seen 8h late still finishes with 4 check-ins (at ' + out['4x5min, lair opened 8h before'].at.toFixed(1) + 'h)');
  // active play may finish fast (player feedback): swiping + buying non-stop clears the line in ~1.5-3 h
  check(out['non-stop 6h'].done && out['non-stop 6h'].at >= 1.5 && out['non-stop 6h'].at <= 3, 'non-stop play finishes in 1.5-3h (' + (out['non-stop 6h'].done ? out['non-stop 6h'].at.toFixed(2) + 'h' : out['non-stop 6h'].q + '/10') + ')');
  check(a.at <= 55, '4x5min/day finishes within ~55h (' + a.at.toFixed(1) + 'h)');
  check(out['2x10min (08,20)'].q >= 8, '2x10min/day: 8-10 steps (' + out['2x10min (08,20)'].q + ')');
  const cards = Object.keys(a.s.cards).filter(k => /^ev_/.test(k)).map(k => k + ':' + a.s.cards[k]);
  console.log('4x5min cards won: ' + cards.join(' '));
}

console.log(fails ? 'TEST-EVENTS FAIL: ' + fails + ' failed, ' + passes + ' passed' : 'TEST-EVENTS OK: ' + passes + ' checks passed');
process.exit(fails ? 1 : 0);
