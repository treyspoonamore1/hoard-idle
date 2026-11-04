// Starfall + Growth test (SPEC-V2 "Starfall"): loads data, engine, lore, events, ember and sky in a Node vm and
// exercises js/sky.js: the live save, charges, start/finish/abort, Sleep/Ascend, First Light, Ember's catches, Sky
// Lanterns, "no power" (stats identical with and without sky.js) and garbage saves. Also checks that ui.js +
// ui-sky.js load in Node without throwing.
// Usage: node tools/test-sky.cjs
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b)); }
function badNum(o, p) {
  if (typeof o === 'number') return isFinite(o) ? null : p;
  if (o === null && p !== '') return null;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = badNum(o[k], p + '.' + k); if (r) return r; }
  return null;
}
const BASE = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/events.js', 'js/ember.js'];
function load(files) {
  let seed = 4242;
  const sb = { console, Date, JSON, Promise, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  return sb.HOARD;
}
const H = load(BASE.concat(['js/sky.js']));
const E = H.engine, K = H.sky, X = H.ember, L = H.lore, EV = H.events;
const NOSKY = load(BASE);
check(!!K && typeof K.start === 'function', 'HOARD.sky exists');
try { load(BASE.concat(['js/sky.js', 'js/ui.js', 'js/ui-sky.js'])); passes++; } catch (e) { fails++; console.log('FAIL: ui.js + ui-sky.js throw in Node', e); }
try { load(BASE.concat(['js/ui.js', 'js/ui-sky.js'])); passes++; } catch (e) { fails++; console.log('FAIL: ui-sky.js without sky.js throws in Node', e); }

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);
let NOW = T0;
K._now = () => NOW;
EV._now = () => NOW;
const MIN = 60e3;
const fixtures = fs.readdirSync(FIX).filter(f => f.endsWith('.json')).sort();
const SKY0 = { on: false, xp: 0, ch: 0, at: 0, n: 0, caught: 0, stars: 0, best: 0, bestPct: 0, capAt: 0, eCaught: 0, lant: 0, lit: 0, gift: false };
const events = [];
E.on('sky', d => events.push(d));
function opened(extra) {
  const s = E.newState();
  s.sleeps = 1;
  Object.assign(s, extra || {});
  E.tick(s, 0.1);
  return s;
}

// ================================================================ 1. the live save and every fixture
{
  for (const f of fixtures) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
    const s = E.deserialize(raw), s0 = NOSKY.engine.deserialize(raw);
    const a = JSON.parse(E.serialize(s)), b = JSON.parse(NOSKY.engine.serialize(s0));
    delete a.savedAt; delete b.savedAt;
    check(JSON.stringify(a.sky) === JSON.stringify(SKY0) || (b.sky !== undefined && JSON.stringify(a.sky) === JSON.stringify(b.sky)), f + ': sky defaults on load');
    const keys = Object.keys(b).filter(k => k !== 'sky');
    const diff = keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    check(diff.length === 0, f + ': every other top-level key identical with and without sky.js (' + diff.join(',') + ')');
    const back = JSON.parse(E.serialize(E.deserialize(E.serialize(s)))); delete back.savedAt;
    check(JSON.stringify(back) === JSON.stringify(a), f + ': round trip identical');
  }
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-post-ascend.json'), 'utf8');
  const o = JSON.parse(raw);
  NOW = o.savedAt + 5 * MIN;
  const s = E.deserialize(raw);
  const j = JSON.parse(E.serialize(E.deserialize(E.serialize(s))));
  const diff = Object.keys(o).filter(k => k !== 'savedAt' && JSON.stringify(o[k]) !== JSON.stringify(j[k]));
  check(diff.length === 0, 'post-Ascend save: after serialize -> deserialize every pre-existing key deep-equals the input (' + diff.join(',') + ')');
  events.length = 0;
  E.offline(s, (NOW - o.savedAt) / 1000);     // what main.js does on load (quiet: no events)
  check(s.sky.on === true && s.sky.ch === 2 && s.sky.gift === true && K.charges(s) === 2 && events.length === 0, 'post-Ascend save: Starfall open with 2 charges after the load catch-up ' + JSON.stringify(s.sky));
  // the same catch-up without sky.js (fresh sandboxes: same random sequence) ends in the same state but for sky
  {
    const A1 = load(BASE.concat(['js/sky.js'])), B1 = load(BASE);
    A1.sky._now = A1.events._now = B1.events._now = () => NOW;
    const a1 = A1.engine.deserialize(raw), b1 = B1.engine.deserialize(raw);
    A1.engine.offline(a1, 300); B1.engine.offline(b1, 300);
    const ja = JSON.parse(A1.engine.serialize(a1)), jb = JSON.parse(B1.engine.serialize(b1));
    delete ja.savedAt; delete jb.savedAt;
    const d1 = Object.keys(jb).filter(k => JSON.stringify(ja[k]) !== JSON.stringify(jb[k]));
    check(d1.length === 0 && ja.sky.on === true, 'post-Ascend save: 5 min catch-up identical with and without sky.js except sky (' + d1.join(',') + ')');
  }
  const s2 = E.deserialize(raw);
  E.tick(s2, 0.1);
  check(s2.legend === 10 && s2.myth === 2 && s2.mythPts === 1 && JSON.stringify(s2.relics) === '{"r_legend":1}', 'post-Ascend save: Legend 10, Myth 2 (1 to spend), relic r_legend 1');
  check(JSON.stringify(s2.lore) === JSON.stringify(o.lore) && JSON.stringify(s2.cards) === JSON.stringify(o.cards) && s2.events.q === 10, 'post-Ascend save: lore, cards and the Volcano Lair (q 10) unchanged');
  check(s2.ember.embers >= o.ember.embers && s2.ember.earned >= o.ember.earned, 'post-Ascend save: embers kept (' + Math.round(s2.ember.embers) + ')');
  check(s2.sky.on && s2.sky.ch === 2 && events.some(d => d.type === 'open' && d.ch === 2), 'post-Ascend save: a live tick opens the sky and emits open {ch:2}');
  check(K.stage(s2) === 0 && K.stageName(s2) === 'Hatchling' && K.params(s2).cap === 4 && K.params(s2).comets === 0, 'post-Ascend save: Hatchling, cap 4, no comets yet');
  // a fresh player opens at rank 4 (or the first Sleep)
  const f1 = E.newState(); E.tick(f1, 0.5);
  check(!f1.sky.on, 'a fresh run (rank 1, no Sleep) has no Starfall yet');
  f1.rank = 4; E.tick(f1, 0.5);
  check(f1.sky.on && f1.sky.ch === 2, 'rank 4 opens the night sky with the 2-charge gift');
}

// ================================================================ 2. charges
{
  NOW = T0;
  const s = opened();
  check(s.sky.ch === 2 && s.sky.at === T0, 'gift: 2 charges, clock set');
  NOW += 30 * MIN; K.accrue(s);
  check(near(s.sky.ch, 3) && K.charges(s) === 3, '+1 charge after 30 min (' + s.sky.ch + ')');
  NOW += 10 * 60 * MIN; K.accrue(s);
  check(s.sky.ch === 4 && K.charges(s) === 4 && K.nextIn(s) === 0 && s.sky.capAt > 0, 'cap 4 holds after 10 h');
  NOW -= 60 * MIN; const ch0 = s.sky.ch; K.accrue(s);
  check(s.sky.ch === ch0 && s.sky.at === NOW, 'a clock 1 h backwards leaves ch unchanged and resets at');
  const s3 = opened(); s3.sky.ch = 1.5; s3.sky.at = NOW + 3600e3;
  const r3 = E.deserialize(E.serialize(s3));
  check(r3.sky.at <= NOW && r3.sky.at > 0, 'a future at (saved) becomes now on load');
  s3.sky.at = NOW + 3600e3; K.accrue(s3);
  check(s3.sky.at === NOW && near(s3.sky.ch, 1.5), 'a future at resets to now on accrue');
  NOW += 15 * MIN;
  const r4 = E.deserialize(E.serialize(s3));
  check(near(r4.sky.ch, 1.5) && near(K.chargesExact(r4), 2), 'fractional ch survives a round trip (1.5 -> 2.0 after 15 min)');
  check(Math.abs(K.nextIn(r3) - 15 * 60) < 1 || K.nextIn(r3) > 0, 'nextIn positive below the cap');
  const g = opened(); g.sky.xp = 15000;
  check(K.stage(g) === 5 && K.params(g).period === 25, 'Great stage: period 25 min');
  g.sky.ch = 0; g.sky.at = NOW; NOW += 25 * MIN; K.accrue(g);
  check(near(g.sky.ch, 1), 'Great: +1 charge after 25 min (' + g.sky.ch + ')');
  // live throttle: the tick hook accrues about once a second
  const lv = opened(); lv.sky.ch = 0; lv.sky.at = NOW;
  for (let i = 0; i < 1800; i++) { NOW += 1000; E.tick(lv, 1); }
  check(near(lv.sky.ch, 1, 1e-6), 'live ticks: +1 charge per 30 min (' + lv.sky.ch + ')');
  // sanitize clamps ch to the cap of the stage
  const big = opened(); big.sky.ch = 99;
  check(E.deserialize(E.serialize(big)).sky.ch === 4, 'ch clamped to the cap on load');
}

// ================================================================ 3. start / finish / abort
{
  NOW = T0 + 100 * MIN;
  const s = opened();
  check(K.finish(s, { total: 10, caught: 10 }) === null, 'finish without start returns null');
  s.sky.ch = 0.9; s.sky.at = NOW;
  check(K.start(s) === null && !s._skyRun, 'start at 0 charges is refused');
  s.sky.ch = 2;
  const p = K.start(s);
  check(p && p.dur === 25 && p.cap === 4 && s._skyRun && s.sky.ch === 2, 'start: params, no charge spent');
  check(K.start(s) === null, 'no second start while one runs');
  check(!/_skyRun/.test(E.serialize(s)), '_skyRun is never saved');
  check(K.abort(s) && !s._skyRun && s.sky.ch === 2 && s.sky.xp === 0 && s.sky.n === 0, 'abort spends nothing and gives no Stardust');
  K.start(s);
  const xp0 = s.sky.xp, g0 = s.gold;
  const r = K.finish(s, { total: 38, caught: 31, best: 19, base: 70, twins: 2, rides: 0, cuts: 0 });
  check(r && r.dust === 70 && near(r.mult, 1) && s.sky.ch === 1 && s.sky.n === 1 && s.sky.caught === 31 && s.sky.stars === 38 && s.sky.best === 19 && s.sky.bestPct === 82,
    'finish: 70 Stardust, spends exactly 1, counts ' + JSON.stringify(r));
  check(s.sky.xp === xp0 + 70 && s.gold === g0 && !s._skyRun, 'finish adds Stardust, never gold');
  // garbage input
  const bad = [{ total: 1e9, caught: 1e9, best: 1e9, base: 1e9, twins: 1e9, rides: 1e9, cuts: 1e9 }, { total: NaN, caught: 'x', base: -5 }, { caught: 50, total: 3, base: 1e9 },
    null, 'junk', { total: Infinity, caught: Infinity, base: Infinity }, { total: -1, caught: -1, base: -1e9, rides: -2 }];
  for (const b of bad) {
    s.sky.ch = 2; const x1 = s.sky.xp;
    const pp = K.start(s);
    const rr = K.finish(s, b);
    const bound = Math.round((10 * K.maxStars(pp) + 15 * pp.comets + pp.comets) * rr.mult);
    check(rr && isFinite(s.sky.xp) && rr.dust >= 0 && rr.dust <= bound && s.sky.xp - x1 === rr.dust && rr.caught <= rr.total, 'garbage finish ' + JSON.stringify(b) + ' -> dust ' + rr.dust + ' (bound ' + bound + ')');
  }
  check(!badNum(JSON.parse(E.serialize(s)), ''), 'no NaN after garbage finishes');
  // rank bonus: start at rank 9
  const s9 = opened(); s9.rank = 9; s9.sky.ch = 2; s9.sky.lit = 12;
  K.start(s9); const r9 = K.finish(s9, { total: 30, caught: 10, base: 10 });
  check(near(r9.mult, 1.3) && r9.dust === 13, 'rank 9: mult 1.3 (' + r9.mult + ')');
  // a Long Sleep mid-Starfall keeps the start rank
  s9.sky.ch = 2; K.start(s9); s9.earnedRun = 1e8; E.sleep(s9);
  const r9b = K.finish(s9, { total: 30, caught: 10, base: 10 });
  check(s9.rank === 1 && near(r9b.mult, 1.3), 'a Long Sleep mid-Starfall: rank bonus uses the start rank (' + r9b.mult + ')');
  // Grand Starfall: every 5th at Ancient
  const a = opened(); a.sky.xp = 75000; a.sky.ch = 6; a.sky.lit = 12;
  const grands = [];
  for (let i = 0; i < 10; i++) { a.sky.ch = 6; const pa = K.start(a); grands.push(pa.grand ? 1 : 0); if (i === 4) check(pa.dur === 45 && pa.rate === 2.2, 'Grand: 45 s at 2.2 stars/s'); K.finish(a, { total: 10, caught: 10, base: 10 }); }
  check(grands.join('') === '0000100001' && a.sky.n === 10, 'Grand Starfall on every 5th at stage 8 (' + grands.join('') + ')');
  const ag = opened(); ag.sky.xp = 75000; ag.sky.n = 4; ag.sky.ch = 3; K.start(ag);
  check(near(K.finish(ag, { total: 20, caught: 10, base: 10 }).mult, 1.5), 'Grand Starfall: Stardust x1.5');
  // stage-up event once
  const su = opened(); su.sky.xp = 95; su.sky.ch = 3;
  events.length = 0;
  K.start(su); const rs = K.finish(su, { total: 20, caught: 10, base: 10 });
  K.start(su); K.finish(su, { total: 20, caught: 10, base: 10 });
  const ups = events.filter(d => d.type === 'stage');
  check(rs.stageUp && ups.length === 1 && ups[0].stage === 1 && ups[0].name === 'Fledgling' && events.filter(d => d.type === 'fall').length === 2, 'stage-up event fires exactly once (' + JSON.stringify(ups) + ')');
  check(K.params(su).comets === 1, 'Fledgling brings a comet');
  // rides and cuts are capped by the comets
  const rc = opened(); rc.sky.xp = 6000; rc.sky.ch = 3; K.start(rc);
  const rr2 = K.finish(rc, { total: 40, caught: 30, base: 30, rides: 5, cuts: 5 });
  check(rr2.rides === 2 && rr2.cuts === 0 && rr2.dust === 60, 'rides capped at 2 comets (+30), no cuts left (' + rr2.dust + ')');
  check(K.maxStars(K.params(opened())) === Math.ceil(25 * 1.4 * 1.15 * 1.2) + 4, 'maxStars = ceil(dur·rate·(1+twin)·1.2) + 4 (spawn jitter headroom)');
}

// ================================================================ 4. Sleep and Ascend
{
  NOW = T0 + 300 * MIN;
  const s = opened(); s.sky.xp = 1234; s.sky.n = 7; s.sky.lit = 9; s.sky.lant = 2; s.sky.best = 12; s.sky.ch = 2.5; s.sky.at = NOW;
  const before = JSON.stringify(s.sky);
  s.earnedRun = 1e8; E.sleep(s);
  check(JSON.stringify(s.sky) === before, 'E.sleep leaves sky byte-identical');
  s.legend = L.mythNeed(s); s.legendPts = 200; L.buy(s, 'myth_gate');
  const g = L.ascend(s);
  const want = JSON.parse(before); want.lit = 0;
  check(g >= 1 && JSON.stringify(s.sky) === JSON.stringify(want), 'Ascend leaves sky identical except lit = 0');
}

// ================================================================ 5. First Light
{
  NOW = T0 + 400 * MIN;
  const s = opened();
  events.length = 0;
  s.rank = 9; E.tick(s, 0.1);
  check(s.sky.xp === 240 && s.sky.lit === 9 && events.filter(d => d.type === 'light').map(d => d.rank + ':' + d.dust).join() === '7:40,8:80,9:120', 'rank 9 in one tick gifts 40+80+120');
  E.tick(s, 0.1);
  check(s.sky.xp === 240, 'no repeat on the next tick');
  s.earnedRun = 1e8; E.sleep(s); s.rank = 9; E.tick(s, 0.1);
  check(s.sky.xp === 240 && s.sky.lit === 9, 'no repeat after a Long Sleep');
  s.rank = 12; E.tick(s, 0.1);
  check(s.sky.xp === 240 + 160 + 200 + 240 && s.sky.lit === 12, 'ranks 10..12 later: 840 in total per Myth');
  s.legend = L.mythNeed(s); s.legendPts = 200; L.buy(s, 'myth_gate'); L.ascend(s);
  check(s.sky.lit === 0, 'Ascend resets First Light');
  K.takeAway(s);
  s.rank = 7; E.offline(s, 60);
  check(s.sky.xp === 840 + 40 && s.sky.lit === 7, 'First Light again after an Ascend, through E.offline');
  const aw = K.takeAway(s);
  check(aw && aw.light === 7 && aw.lightDust === 40 && K.takeAway(s) === null && !('_skyAway' in JSON.parse(E.serialize(s))), 'offline First Light is kept for the welcome sheet once, never saved (' + JSON.stringify(aw) + ')');
  s.rank = 8; E.tick(s, 0.1);
  check(K.takeAway(s) === null, 'a live First Light is not an away note (it toasts at once)');
  const gs = opened(); gs.sky.xp = 99; K.takeAway(gs);
  E.offline(gs, 60); // nothing grows by itself: no away note
  check(K.takeAway(gs) === null, 'no away note without growth or First Light');
  const n = opened(); n.sky.on = false; n.sleeps = 0; n.myths = 0; n.rank = 3; n.sky.gift = true; E.tick(n, 0.1);
  check(n.sky.xp === 0, 'no First Light while the sky is closed');
}

// ================================================================ 6. Ember watches the sky
{
  NOW = T0 + 1000 * MIN;
  const s = opened();
  s.sky.ch = 4; s.sky.at = NOW;
  NOW += 10 * 3600e3; K.accrue(s);
  check(s.sky.xp === 0 && s.sky.eCaught === 0, 'no Ember catches while Ember sleeps');
  s.lore.wake_ember = 1; X.wake(s);
  check(X.isAwake(s), 'Ember awake');
  const s2 = opened(); s2.lore.wake_ember = 1; X.wake(s2); s2.sky.ch = 3; s2.sky.at = NOW;
  NOW += 20 * MIN; K.accrue(s2);
  check(s2.sky.ch < 4 && s2.sky.eCaught === 0 && s2.sky.capAt === 0, 'below the cap: no catches');
  NOW += 10 * MIN; K.accrue(s2);
  check(s2.sky.ch === 4 && s2.sky.capAt === NOW && s2.sky.eCaught === 0, 'cap reached: stretch starts');
  NOW += 30 * MIN; K.accrue(s2);
  check(s2.sky.eCaught === 1 && s2.sky.xp === 10 && K.takeEmber(s2) === 10 && K.takeEmber(s2) === 0, '30 min at the cap: Ember catches 1 (+10), toast value taken once');
  NOW += 10 * 3600e3; K.accrue(s2);
  check(s2.sky.eCaught === 4 && s2.sky.xp === 40, 'at most 4 per stretch, even after 10 h (' + s2.sky.xp + ')');
  K.start(s2); K.finish(s2, { total: 10, caught: 5, base: 5 });
  check(s2.sky.eCaught === 0 && s2.sky.capAt === 0 && s2.sky.ch === 3, 'a finish resets the stretch');
  NOW += 30 * MIN; K.accrue(s2); NOW += 30 * MIN; K.accrue(s2);
  check(s2.sky.eCaught === 1, 'a new stretch catches again');
  // away: 10 h offline from 2 charges reaches the cap 60 min in and catches 4 (works the same as live)
  const s3 = opened(); s3.lore.wake_ember = 1; X.wake(s3); s3.sky.ch = 2; s3.sky.at = NOW;
  NOW += 10 * 3600e3; E.offline(s3, 10 * 3600);
  check(s3.sky.ch === 4 && s3.sky.eCaught === 4 && s3.sky.xp === 40, 'offline 10 h: cap + 4 Ember catches (' + JSON.stringify({ ch: s3.sky.ch, e: s3.sky.eCaught, xp: s3.sky.xp }) + ')');
  const s4 = opened(); s4.lore.wake_ember = 1; X.wake(s4); s4.sky.ch = 2; s4.sky.at = NOW;
  NOW += 100 * MIN; E.offline(s4, 6000);
  check(s4.sky.eCaught === 1 && s4.sky.xp === 10, 'offline 100 min from 2: cap at 60 min, 1 catch at 90 min');
  // a stage-up while away (Ember's catch tips Hatchling 95 -> Fledgling) is kept for the welcome sheet
  const s5 = opened(); s5.lore.wake_ember = 1; X.wake(s5); s5.sky.ch = 4; s5.sky.xp = 95; s5.sky.at = NOW; s5.sky.capAt = NOW; K.takeAway(s5);
  NOW += 40 * MIN; E.offline(s5, 2400);
  const a5 = K.takeAway(s5);
  check(K.stage(s5) === 1 && a5 && a5.stage === 1, 'offline stage-up noted for the welcome sheet (' + JSON.stringify(a5) + ')');
}

// ================================================================ 7. Sky Lanterns
{
  NOW = T0 + 5000 * MIN;
  check(JSON.stringify(K.LANT_COST) === JSON.stringify([2e6, 1e7, 5e7, 2.5e8, 1.25e9]), 'lantern costs exact');
  const s = opened();
  s.ember.embers = 1e10; s.ember.earned = 1e10;
  check(!K.buyLantern(s), 'refused while Ember is asleep');
  s.lore.wake_ember = 1; X.wake(s);
  s.ember.embers = 1e10; s.ember.earned = 1e10;
  const w0 = X.warmth(s), st0 = JSON.stringify(E.stats(s).M);
  let spent = 0;
  for (let i = 0; i < 5; i++) { const c = K.lanternCost(s); const e0 = s.ember.embers; check(K.buyLantern(s) && near(e0 - s.ember.embers, c), 'lantern ' + (i + 1) + ' costs ' + c); spent += c; }
  check(!K.buyLantern(s) && s.sky.lant === 5 && K.lanternCost(s) === 0, 'level capped at 5');
  check(s.ember.earned === 1e10 && near(s.ember.embers, 1e10 - spent) && near(X.warmth(s), w0) && JSON.stringify(E.stats(s).M) === st0, 'embers drop, ember.earned and warmth unchanged, no M change');
  const p = K.params(s);
  check(near(p.slow, 0.85), 'lanterns: stars fall 15% slower at Lv 5');
  s.sky.ch = 2; K.start(s);
  check(near(K.finish(s, { total: 20, caught: 10, base: 10 }).mult, 1.4), 'lanterns: Stardust x1.40 at Lv 5');
  const poor = opened(); poor.lore.wake_ember = 1; X.wake(poor); poor.ember.embers = 1e6;
  check(!K.buyLantern(poor) && poor.ember.embers === 1e6, 'refused when embers are short');
  // the live save can buy 3 straight away
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-post-ascend.json'), 'utf8');
  const lv = E.deserialize(raw); E.tick(lv, 0.1);
  let n = 0; while (K.buyLantern(lv)) n++;
  check(n === 3, 'the live save buys 3 lanterns from its embers (' + n + ')');
}

// ================================================================ 8. no power: stats identical with and without sky.js
{
  NOW = T0 + 9000 * MIN;
  const keyStats = (Eng, s) => { const st = Eng.stats(s); return JSON.stringify(st.M) + '|' + st.gps + '|' + st.coinWorth + '|' + st.baseGps + '|' + st.strokeWorth; };
  for (const f of fixtures) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
    const a = E.deserialize(raw), b = NOSKY.engine.deserialize(raw);
    check(keyStats(E, a) === keyStats(NOSKY.engine, b), f + ': stats identical with and without sky.js');
    a.rank = Math.max(a.rank, 9); b.rank = a.rank; a.sleeps = Math.max(1, a.sleeps); b.sleeps = a.sleeps;
    E.tick(a, 0.1);   // unlock + First Light
    a.sky.ch = Math.max(1, a.sky.ch); K.start(a); K.finish(a, { total: 30, caught: 20, base: 40, rides: 1 });
    E.dirty();
    const twin = NOSKY.engine.deserialize(E.serialize(a));
    check(a.sky.on && a.sky.xp > 0 && keyStats(E, a) === keyStats(NOSKY.engine, twin), f + ': stats identical after unlock, First Light and a finish');
  }
}

// ================================================================ 9. robustness: garbage sky subtrees
{
  NOW = T0 + 10000 * MIN;
  const garbage = ['junk', null, -Infinity, '1e400', [1, 2, 3], 42, true,
    { on: 'yes', xp: '1e400', ch: -Infinity, at: '9e99', n: NaN, caught: 'x', stars: -3, best: 1.7e308 * 10, bestPct: 1e9, capAt: [1], eCaught: 99, lant: 7.9, lit: 5, gift: 'no', extra: { a: 1 } },
    { on: true, xp: -50, ch: 'abc', at: null, lant: -1, lit: 13, bestPct: -4 },
    { on: true, xp: 1e305, ch: 1e300, at: 1e300, capAt: -1, n: 1e300, lit: 8.6 }];
  for (const gb of garbage) {
    const s = opened();
    const o = JSON.parse(E.serialize(s)); o.sky = gb;
    const r = E.deserialize(JSON.stringify(o).replace('"1e400"', '1e400'.replace(/.*/, '"1e400"')));
    const k = r.sky;
    const ok = k && typeof k === 'object' && !Array.isArray(k) && typeof k.on === 'boolean' && typeof k.gift === 'boolean' &&
      ['xp', 'ch', 'at', 'n', 'caught', 'stars', 'best', 'bestPct', 'capAt', 'eCaught', 'lant', 'lit'].every(f => typeof k[f] === 'number' && isFinite(k[f]) && k[f] >= 0) &&
      k.ch <= K.cap(r) && k.lant <= 5 && Number.isInteger(k.lant) && (k.lit === 0 || (k.lit >= 7 && k.lit <= 12)) && k.bestPct <= 100 && k.eCaught <= 4 && k.at <= NOW && k.capAt <= NOW && Number.isInteger(k.n);
    check(ok, 'garbage sky ' + JSON.stringify(gb) + ' -> sane ' + JSON.stringify(k));
    for (let i = 0; i < 5; i++) E.tick(r, 0.5);
    E.offline(r, 3600);
    r.sky.ch = Math.max(1, r.sky.ch); K.start(r); K.finish(r, { total: 20, caught: 10, base: 10 });
    const ser = E.serialize(r);
    check(!/NaN|Infinity|null,"sky"/.test(ser) && !badNum(JSON.parse(ser).sky, 'sky') && !badNum(JSON.parse(ser), ''), 'garbage sky: no NaN anywhere in the serialized save');
  }
  // a saved sky subtree survives when sky.js is absent
  const s = opened(); s.sky.xp = 777; s.sky.lant = 2;
  const raw = E.serialize(s);
  const nos = NOSKY.engine.deserialize(raw);
  check(nos.sky && nos.sky.xp === 777 && nos.sky.lant === 2 && JSON.parse(NOSKY.engine.serialize(nos)).sky.xp === 777, 'without sky.js a saved sky subtree survives');
  // readers are null-safe
  check(K.on(null) === false && K.stage(null) === 0 && K.charges({}) === 0 && K.nextIn(null) === 0 && K.cap(null) === 4 && K.xpToNext(null) === 100 && K.scales(null) === 0 && K.lanternCost(null) === 2e6 &&
    K.start(null) === null && K.finish(null, {}) === null && K.abort(null) === false && K.buyLantern(null) === false, 'readers and mutators are null-safe');
  const sc = opened(); sc.sky.xp = 75000 + 3 * 25000 + 10;
  check(K.scales(sc) === 3 && K.progress(sc).max && K.xpToNext(sc) === 25000 - 10, 'Star Scales past Ancient (3)');
}

console.log((fails ? fails + ' FAILURES, ' : '') + passes + ' sky checks passed');
console.log(fails ? 'SKY FAILED' : 'SKY OK');
process.exitCode = fails ? 1 : 0;
