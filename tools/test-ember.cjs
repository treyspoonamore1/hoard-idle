// Ember module test (SPEC-V2 section 2): loads data.js + engine.js + ember.js in a Node vm and exercises the
// rules, offline(), Long Sleep, Ascend, save round-trips, the v1 fixtures and the warmth pacing.
// Usage: node tools/test-ember.cjs        (PACE=1 prints the full pacing tables)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, rel) { return Math.abs(a - b) <= (rel || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b)); }
function badNum(o, p) {
  if (typeof o === 'number') return isFinite(o) ? (o < 0 && !/(until|minionTier|prevTier)$/.test(p) ? p + '<0' : null) : p;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = badNum(o[k], p + '.' + k); if (r) return r; }
  return null;
}
function load(files) {
  let seed = 4242;
  const sb = { console, Date, JSON, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  return sb.HOARD;
}
const H = load(['js/data.js', 'js/engine.js', 'js/ember.js']);
const E = H.engine, X = H.ember;
check(!!X, 'HOARD.ember exists');
// the UI module must load harmlessly in Node too
try { load(['js/data.js', 'js/engine.js', 'js/ember.js', 'js/ui.js', 'js/ui-ember.js']); passes++; } catch (e) { fails++; console.log('FAIL: ui-ember.js throws in Node', e); }
const plain = load(['js/data.js', 'js/engine.js']); // reference engine without Ember
const events = [];
E.on('ember', x => events.push(x));
const clone = o => JSON.parse(JSON.stringify(o));
const tickN = (s, sec, dt) => { dt = dt || 0.5; for (let t = 0; t < sec; t += dt) E.tick(s, dt); };

// ---------------------------------------------------------------- defaults, asleep
{
  const s = E.newState();
  check(s.ember && s.ember.awake === false && s.ember.embers === 0 && Array.isArray(s.ember.kilns) && s.ember.kilns.length === 4, 'newState has ember defaults');
  check(X.warmth(s) === 1 && X.rate(s) === 0 && X.coinYield(s) === 0, 'asleep: warmth 1, no production');
  check(X.buyKiln(s, 0, 1) === false && X.buyBreath(s, 'kindle') === false, 'asleep: cannot buy');
  check(!X.visible(s), 'asleep without lore: tab hidden');
  s.buildings.digger = 30; s.buildings.raid = 10; s.rank = 3; s.upgrades.claws1 = true;
  const p = plain.engine.deserialize(E.serialize(s));
  E.dirty(); plain.engine.dirty();
  check(near(E.stats(s).gps, plain.engine.stats(p).gps) && near(E.stats(s).coinWorth, plain.engine.stats(p).coinWorth), 'asleep: stats identical to the engine without Ember');
  tickN(s, 5);
  check(!s.ember.awake && s.ember.embers === 0, 'no wake without lore');
}

// ---------------------------------------------------------------- wake, kilns, coins
const s = E.newState();
s.lore = { wake_ember: 1 };
check(X.visible(s), 'lore wake_ember: tab visible');
E.tick(s, 0.1);
check(s.ember.awake === true, 'tick wakes Ember when lore.wake_ember is owned');
check(s.ember.embers === X.C.wakeGift && s.ember.earned === X.C.wakeGift, 'wake gift ' + X.C.wakeGift + ' embers');
check(near(s.ember.wokeAt, s.time, 1e-6) || s.ember.wokeAt <= s.time, 'wokeAt recorded');
check(events.some(e => e.type === 'wake'), "'ember' {type:'wake'} emitted");
check(X.wake(s) === false, 'wake twice is a no-op');
{
  const c1 = X.kilnCost(s, 0, 1).embers;
  check(c1 === 10, 'Coal Kiln costs 10 (got ' + c1 + ')');
  const before = s.ember.embers;
  check(X.buyKiln(s, 'coal', 1) === true, 'buy a Coal Kiln');
  check(near(s.ember.embers, before - 10) && s.ember.kilns[0] === 1, 'paid 10, own 1');
  check(near(X.kilnCost(s, 0, 1).embers, 10 * 1.18), 'next costs x1.18');
  check(near(X.rate(s), X.KILNS[0].rate), 'rate = coal base rate');
  check(X.buyKiln(s, 0, 1) === false, 'cannot buy when short');
  check(X.buyKiln(s, 9, 1) === false && X.buyKiln(s, 'nope', 1) === false && X.buyKiln(s, 0, NaN) === false, 'bad ids are refused');
  // kilnMax vs brute force
  s.ember.embers = 12345.678;
  for (let k = 0; k < 4; k++) {
    let n = 0, sum = 0; const own = s.ember.kilns[k];
    while (true) { const c = X.KILNS[k].cost * Math.pow(1.18, own + n); if (sum + c > s.ember.embers) break; sum += c; n++; }
    check(X.kilnMax(s, k) === n, 'kilnMax(' + k + ') = ' + n + ' (got ' + X.kilnMax(s, k) + ')');
    check(n === 0 || near(X.kilnCost(s, k, 'max').embers, sum, 1e-9), 'kilnCost max = sum');
  }
  const m = X.kilnMax(s, 1);
  check(X.buyKiln(s, 1, 'max') && s.ember.kilns[1] === m, 'buy Max Bellows');
  check(X.buyKiln(s, 1, 'max') === false || s.ember.embers >= 0, 'max buy when broke is refused or harmless');
  // milestone at 25
  const em0 = clone(s.ember);
  s.ember.kilns[0] = 24; s.ember.embers = 1e9;
  const r24 = X.kilnEach(s, 0);
  X.buyKiln(s, 0, 1);
  check(near(X.kilnEach(s, 0), r24 * 2), 'kiln milestone at 25 doubles output');
  check(events.some(e => e.type === 'milestone' && e.id === 'coal'), 'milestone event');
  s.ember = em0;
}
{
  // coins feed Ember at once (engine 'coin' event carries the state)
  s.ember.kilns = [20, 5, 0, 0]; s.ember.embers = 0; E.dirty();
  E.tick(s, 0.01);
  const e0 = s.ember.embers, r = X.rate(s);
  E.coinCollected(s, 50, 1);
  check(near(s.ember.embers - e0, 50 * 0.02 * Math.max(1, r), 1e-6), 'coin event credits the state it came from');
  const other = E.newState(); E.coinCollected(other, 50, 1);
  check(!(other.ember && other.ember.embers > 0), 'coins in a sleeping-Ember state give no embers');
  E.tick(s, 0.5);
  const want = r * 0.5 + 50 * 0.02 * Math.max(1, r);
  check(near(s.ember.embers - e0, want, 1e-6), 'swiped coins add 0.02 x kilnPower each (+' + (s.ember.embers - e0).toFixed(3) + ' vs ' + want.toFixed(3) + ')');
  check(s.ember.fromCoins > 0 && X.takeCoinGain() > 0 && X.takeCoinGain() === 0, 'coin gain tracked for the cave float');
  check(near(X.coinYield(s), 0.02 * Math.max(1, X.rate(s))), 'coinYield');
}

// ---------------------------------------------------------------- warmth mod source
{
  const a = E.newState();
  a.buildings.digger = 40; a.buildings.raid = 12; a.rank = 3;
  const b = clone(a);
  b.lore = { wake_ember: 1 };
  b.ember = { awake: true, wokeAt: 0, embers: 0, earned: 1e6, kilns: [0, 0, 0, 0], breaths: {} };
  E.dirty();
  const w = X.warmth(b), sa = E.stats(a), sb = E.stats(b);
  check(near(w, 1 + 0.15 * Math.pow(Math.log10(1 + 1e6), 1.6), 1e-9), 'warmth formula at 1e6 = ' + w.toFixed(3));
  check(near(sb.gps / sa.gps, w, 1e-9), 'gold/s x warmth (' + (sb.gps / sa.gps).toFixed(4) + ')');
  check(near(sb.coinWorth / sa.coinWorth, w, 1e-9), 'coin worth x warmth (' + (sb.coinWorth / sa.coinWorth).toFixed(4) + ')');
  check(near(sb.tierRates[0], sa.tierRates[0]) || sa.tierRates[0] === 0, 'minion production untouched');
  b.ember.earned = 1e300; E.dirty();
  check(isFinite(X.warmth(b)) && isFinite(E.stats(b).gps), 'warmth finite at 1e300');
  b.ember.earned = 0; E.dirty();
  check(X.warmth(b) === 1, 'warmth 1 at 0 embers');
  check(E.modBreakdown(b).some(x => x.name === 'ember'), "mod source 'ember' registered");
  // breaths that touch the main game
  b.ember.earned = 1e6; b.ember.embers = 1e9; E.dirty();
  const g0 = E.stats(b).gustWorthMult, st0 = E.stats(b).M.strokeMult, f0 = E.stats(b).M.frenzyMult;
  check(X.buyBreath(b, 'searing') && near(E.stats(b).gustWorthMult, g0 * 2), 'Searing Gust: gust gold x2');
  check(X.buyBreath(b, 'molten') && near(E.stats(b).M.strokeMult, st0 * 2), 'Molten Coins: stroke x2');
  check(X.buyBreath(b, 'ffrenzy') && near(E.stats(b).M.frenzyMult, f0 * 1.5), 'Fire Frenzy: frenzy x1.5');
  check(X.buyBreath(b, 'molten') === false, 'a breath is bought once');
  const w1 = X.warmth(b);
  check(X.buyBreath(b, 'heart') && near(X.warmth(b) - 1, (w1 - 1) * 1.25), 'Heart of the Kiln: warmth +25%');
  b.ember.kilns = [10, 0, 0, 0]; E.dirty();
  const r1 = X.rate(b);
  check(X.buyBreath(b, 'kindle') && near(X.rate(b), r1 * 2), 'Kindle: kilns x2');
  check(X.buyBreath(b, 'wildfire') && near(X.rate(b), r1 * 6), 'Wildfire: kilns x3 more');
  const y0 = X.coinYield(b);
  check(X.buyBreath(b, 'fanned') && near(X.coinYield(b), y0 * 3), 'Fanned Flames: coin feed x3');
  b.relics = { r_ember: 1 }; E.dirty();
  check(near(X.rate(b), r1 * 18), "relic r_ember (Ember's Brood): x3");
  check(X.breathList(b).length >= 8, '~8 Fire Breaths (' + X.breathList(b).length + ')');
  // Ember Treasures
  X.buyBreath(b, 'etreas');
  E.tick(b, 0.01);
  const t0 = b.ember.embers, rr = X.rate(b);
  E.grabTreasure(b);
  check(near(b.ember.embers - t0, rr * 60, 1e-6), 'Ember Treasures: a treasure gives 60s of production');
  check(!badNum(b, 's'), 'no NaN/negative after breaths: ' + badNum(b, 's'));
}

// ---------------------------------------------------------------- offline
{
  const o = E.newState();
  o.lore = { wake_ember: 1 };
  E.tick(o, 0.1);
  o.ember.kilns = [30, 10, 3, 1]; E.dirty();
  const r = X.rate(o), e0 = o.ember.embers;
  const res = E.offline(o, 3600);
  check(res.seconds === 3600, 'offline ran 1h');
  check(near(o.ember.embers - e0, r * 3600, 1e-6), 'kilns produce offline (+' + H.fmt(o.ember.embers - e0) + ', want ' + H.fmt(r * 3600) + ')');
  check(near(X.takeOffline(o), r * 3600, 1e-6) && X.takeOffline(o) === 0, 'offline embers reported once (takeOffline)');
  o.ember.breaths.smoulder = true;
  const e1 = o.ember.embers;
  E.offline(o, 1800);
  check(near(o.ember.embers - e1, r * 1800 * 2, 1e-6), 'Smoulder: offline embers x2');
  const capS = E.stats(o).offlineCapHours * 3600;
  const e2 = o.ember.embers;
  E.offline(o, 1e9);
  check(near(o.ember.embers - e2, r * capS * 2, 1e-6), 'offline embers respect the offline cap');
  check(!('_emberOffline' in JSON.parse(E.serialize(o))), '_emberOffline is not saved');
  const z = E.newState(); const e3 = z.ember.embers; E.offline(z, 3600);
  check(z.ember.embers === e3 && !z.ember.awake, 'offline does nothing while asleep');
  check(!badNum(o, 's'), 'no NaN after offline: ' + badNum(o, 's'));
}

// ---------------------------------------------------------------- Long Sleep + Ascend
{
  const q = E.newState();
  q.lore = { wake_ember: 1 };
  E.tick(q, 0.1);
  q.ember.kilns = [40, 20, 9, 4]; q.ember.embers = 5e5; q.ember.earned = 7.7e7; q.ember.breaths = { kindle: true, molten: true };
  q.earnedRun = 4e7; q.gold = 4e7;
  const before = clone(q.ember), w = X.warmth(q);
  const gained = E.sleep(q);
  check(gained > 0, 'Long Sleep taken (+' + gained + ' Legend)');
  check(JSON.stringify(q.ember) === JSON.stringify(before), 'Long Sleep keeps Ember untouched');
  check(near(X.warmth(q), w), 'warmth survives Long Sleep');
  // Ascend (LORE resets the Wake Ember node; Ember stays awake at 25%)
  delete q.lore.wake_ember;
  E.resetRun(q, 'ascend');
  check(q.ember.awake === true, 'Ascend keeps Ember awake');
  check(q.ember.embers === Math.floor(5e5 * 0.25) && q.ember.earned === Math.floor(7.7e7 * 0.25), 'Ascend leaves 25% of embers / lifetime embers');
  check(JSON.stringify(q.ember.kilns) === JSON.stringify([10, 5, 2, 1]), 'Ascend leaves 25% of kilns (' + q.ember.kilns + ')');
  check(q.ember.breaths.kindle === true, 'Fire Breaths survive Ascend');
  const e0 = q.ember.embers, rq = X.rate(q);
  E.tick(q, 0.5);
  check(rq > 0 && near(q.ember.embers - e0, rq * 0.5, 1e-9), 'no second wake gift after Ascend; kilns keep burning');
  check(X.visible(q), 'tab stays visible after Ascend without the lore node');
}

// ---------------------------------------------------------------- save round-trip + hostile saves
{
  const r = E.newState();
  r.lore = { wake_ember: 1 };
  tickN(r, 30);
  r.ember.kilns = [12, 3, 1, 0]; r.ember.breaths = { kindle: true }; r.ember.embers = 1234.5;
  const json = E.serialize(r);
  const r2 = E.deserialize(json);
  check(JSON.stringify(r2.ember) === JSON.stringify(r.ember), 'serialize/deserialize round-trip keeps state.ember');
  const noT = j => { const o = JSON.parse(j); delete o.savedAt; return JSON.stringify(o); };
  check(noT(E.serialize(r2)) === noT(json), 'second serialize is identical (savedAt aside)');
  check(near(X.warmth(r2), X.warmth(r)) && near(X.rate(r2), X.rate(r)), 'warmth and rate survive the round-trip');
  const raw = JSON.parse(json);
  raw.ember = { awake: 'yes', embers: -5, earned: 'NaN', kilns: ['x', -3, 1e99, 2.7, 9], breaths: { kindle: 1, molten: true, bogus: true }, futureKey: { a: 1 } };
  const r3 = E.deserialize(JSON.stringify(raw));
  check(r3.ember.awake === false && r3.ember.embers === 0 && r3.ember.earned === 0, 'garbage numbers/flags sanitized');
  check(JSON.stringify(r3.ember.kilns) === JSON.stringify([0, 0, 1e6, 2]), 'garbage kilns sanitized (' + r3.ember.kilns + ')');
  check(r3.ember.breaths.molten === true && !r3.ember.breaths.kindle && !r3.ember.breaths.bogus, 'only known breaths set to true are kept');
  check(r3.ember.futureKey && r3.ember.futureKey.a === 1, 'unknown ember keys kept (forward compatible)');
  raw.ember = 'garbage';
  const r4 = E.deserialize(JSON.stringify(raw));
  check(r4.ember && r4.ember.awake === false && r4.ember.kilns.length === 4, 'non-object ember subtree -> defaults');
  const hand = E.newState(); delete hand.ember; hand.lore = { wake_ember: 1 };
  E.tick(hand, 0.2);
  check(hand.ember && hand.ember.awake, 'hand-made state without subtree repaired on tick');
  hand.ember.kilns = 'bad'; E.tick(hand, 0.2);
  check(Array.isArray(hand.ember.kilns) && hand.ember.kilns.length === 4, 'broken kilns repaired live');
  for (const g of [null, '', 'xyz', '{"v":99,"gold":5}']) {
    const gs = E.deserialize(g);
    check(gs && gs.ember && gs.ember.awake === false && !badNum(gs, 's'), 'deserialize(' + JSON.stringify(g) + ') has a clean ember subtree');
  }
}

// ---------------------------------------------------------------- v1 fixtures
{
  const FIX = path.join(root, 'tools', 'fixtures');
  const files = fs.existsSync(FIX) ? fs.readdirSync(FIX).filter(f => /^v1-.*\.json$/.test(f)).sort() : [];
  check(files.length >= 4, 'v1 fixtures found (' + files.join(', ') + ')');
  for (const f of files) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8');
    const o = JSON.parse(raw);
    const v = E.deserialize(raw);
    check(v.v === 2 && v.ember && v.ember.awake === false && v.ember.embers === 0, f + ': migrates with an asleep Ember');
    check(v.gold === o.gold && v.legend === o.legend && v.legendPts === o.legend && JSON.stringify(v.buildings) === JSON.stringify(o.buildings), f + ': v1 data preserved');
    const p = plain.engine.deserialize(raw);
    check(near(E.stats(v).gps, plain.engine.stats(p).gps), f + ': gold/s unchanged while Ember sleeps');
    E.offline(v, 7200);
    tickN(v, 20);
    check(!v.ember.awake && !badNum(v, 's'), f + ': offline + ticks clean, still asleep (' + badNum(v, 's') + ')');
    // wake her on the migrated save and play a little
    v.lore.wake_ember = 1;
    tickN(v, 60);
    X.buyKiln(v, 0, 'max');
    E.coinCollected(v, 30, 2);
    tickN(v, 60);
    E.offline(v, 3600);
    if (E.canSleep(v)) E.sleep(v);
    check(v.ember.awake && X.warmth(v) > 1 && !badNum(v, 's'), f + ': woken Ember works (warmth x' + X.warmth(v).toFixed(2) + ')');
    const back = E.deserialize(E.serialize(v));
    check(JSON.stringify(back.ember) === JSON.stringify(v.ember) && back.gold === v.gold, f + ': round-trip after waking');
  }
}

// ---------------------------------------------------------------- pacing: warmth after waking, by play style
// coins/s collected (swiping share x rate), how often the player visits the Ember tab, treasure grabs per 100s.
// Strategy: buy any affordable Fire Breath, save for the next one when it costs < 5 min of kilns, else the best
// ember/s per ember kiln. Marks: 10 min, 1 h, 3 h after waking (SPEC-V2: ~x1.5 at 10 min, x5-x20 in a few hours).
function pace(prof, marksAt) {
  const s = E.newState();
  s.lore = { wake_ember: 1 };
  const dt = 0.5; let t = 0, nextBuy = 0, acc = 0, accT = 0;
  const marks = {};
  const end = Math.max.apply(null, marksAt);
  while (t <= end) {
    E.tick(s, dt); t += dt;
    acc += prof.cps * dt; if (acc >= 1) { const n = Math.floor(acc); acc -= n; E.coinCollected(s, n, 1); }
    accT += dt * prof.tre / 100; if (accT >= 1) { accT -= 1; E.grabTreasure(s); }
    if (t >= nextBuy) {
      nextBuy = t + prof.every;
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
    for (const m of marksAt) if (!marks[m] && t >= m) marks[m] = { warmth: +X.warmth(s).toFixed(2), earned: H.fmt(X.earned(s)), perSec: H.fmt(X.rate(s)), kilns: s.ember.kilns.join('/'), breaths: X.breathsOwned(s), fromCoins: H.fmt(s.ember.fromCoins) };
  }
  check(!badNum(s, 's'), 'pacing ' + prof.name + ': no NaN/negative (' + badNum(s, 's') + ')');
  return marks;
}
{
  const marksAt = [600, 1800, 3600, 7200, 10800];
  const profiles = [
    { name: 'active', cps: 2.5, every: 15, tre: 0.8 },
    { name: 'moderate', cps: 1.2, every: 60, tre: 0.5 },
    { name: 'idle-ish', cps: 0.3, every: 300, tre: 0.2 }
  ];
  const rows = {};
  for (const p of profiles) {
    const m = pace(p, marksAt);
    rows[p.name] = m;
    if (process.env.PACE) { console.log(p.name); console.table(m); }
  }
  const mod = rows.moderate;
  console.log('warmth after waking (moderate play): 10 min x' + mod[600].warmth + ', 1 h x' + mod[3600].warmth + ', 3 h x' + mod[10800].warmth +
    '   | active: x' + rows.active[600].warmth + ' / x' + rows.active[3600].warmth + ' / x' + rows.active[10800].warmth +
    '   | idle-ish: x' + rows['idle-ish'][600].warmth + ' / x' + rows['idle-ish'][3600].warmth + ' / x' + rows['idle-ish'][10800].warmth);
  check(mod[600].warmth >= 1.3 && mod[600].warmth <= 2.2, 'moderate: ~x1.5 at 10 min (x' + mod[600].warmth + ')');
  check(mod[3600].warmth >= 2.5 && mod[3600].warmth <= 4.5, 'moderate: x2.5-x4.5 at 1 h (x' + mod[3600].warmth + ')');
  check(mod[10800].warmth >= 5 && mod[10800].warmth <= 20, 'moderate: x5-x20 at 3 h (x' + mod[10800].warmth + ')');
  check(rows.active[3600].warmth >= rows['idle-ish'][3600].warmth, 'active play is not behind idle play');
}

console.log((fails ? 'FAILED ' + fails + ', ' : '') + passes + ' checks passed');
process.exit(fails ? 1 : 0);
