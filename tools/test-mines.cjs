// The Mines test (SPEC-MINES B11): loads data, engine, lore and mines (and sky for the lanterns) in a Node vm and
// exercises js/mines.js: defaults and sanitize, opening, the exact chain against Euler stepping, hire prices, the tithe,
// Ascend, offline and Night Shift, nuggets and Lucky Seam, Shaft Depth, the glow and the Hearth, Deep Veins, Deep
// Chests, the 'ore' and 'hire' quests (E.addMissionTemplate), a strategy check (hiring deepest-first by hand beats
// all-Crews), the player's live save (8 h away, then a Sleep that still recruits), and that ui.js + ui-mines.js load.
// Usage: node tools/test-mines.cjs
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b)); }
function badNum(o, p) {
  if (typeof o === 'number') return isFinite(o) && o >= -1e-9 ? null : p + '=' + o;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (/until$/.test(k)) continue; const r = badNum(o[k], p + '.' + k); if (r) return r; }
  return null;
}
const BASE = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/mines.js'];
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
const E = H.engine, X = H.mines, D = H.data, C = X.C;
const ev = [];
E.on('mines', d => ev.push(d));
const buys = [];
E.on('buy', d => buys.push(d));
function fresh(extra) { const s = E.newState(); Object.assign(s, extra || {}); return s; }
function opened(extra) { const s = fresh(extra); s.rank = 7; E.tick(s, 0.001); s.mines.ore = s.mines.all = s.mines.peak = 0; E.dirty(); return s; }
const clone = o => JSON.parse(JSON.stringify(o));

// ================================================================ 1. defaults and sanitize
{
  const s = fresh();
  const m = s.mines;
  check(m && m.open === false && m.ore === 0 && m.all === 0 && m.peak === 0 && m.depth === 0 && m.hearth === 1 && m.chestN === 0 &&
    JSON.stringify(m.units) === '[0,0,0,0]' && JSON.stringify(m.hired) === '[0,0,0,0]' && JSON.stringify(m.forge) === '{}', 'defaults');
  check(!X.isOpen(s) && X.oreRate(s) === 0 && X.glow(s) === 1 && X.hearth(s) === 1 && X.nugValue(s) === 0, 'closed Mines: no rate, glow x1');
  const raw = JSON.parse(E.serialize(fresh()));
  raw.mines = { open: true, ore: NaN, all: -5, peak: 3, units: [5e299, -2, 'x', 4.5, 99], hired: [2.7, -1, 1e400, null], forge: { pans: 99, sieve: 2.9, bogus: 3, rails: -1 },
    depth: 1e9, hearth: 0.2, chestN: -3, lastTithe: 'nope', mystery: { keep: 1 }, fn: 'kept' };
  const s2 = E.deserialize(JSON.stringify(raw)), m2 = s2.mines;
  check(m2.open === true && m2.ore === 0 && m2.all === 0 && m2.peak === 3, 'sanitize: NaN / negative numbers -> 0, peak kept');
  check(m2.units.length === 4 && m2.units[0] === 5e299 && m2.units[1] === 0 && m2.units[2] === 0 && m2.units[3] === 4.5, 'sanitize: units clamped, length 4 ' + JSON.stringify(m2.units));
  check(JSON.stringify(m2.hired) === '[2,0,1e+300,0]' || (m2.hired[0] === 2 && m2.hired[1] === 0 && m2.hired[3] === 0), 'sanitize: hired are integers ' + JSON.stringify(m2.hired));
  check(JSON.stringify(m2.forge) === '{"pans":10,"sieve":2}', 'sanitize: unknown Forge ids dropped, levels capped ' + JSON.stringify(m2.forge));
  check(m2.depth === 300 && m2.hearth === 1 && m2.chestN === 0 && JSON.stringify(m2.lastTithe) === '[0,0,0,0]', 'sanitize: depth <= 300, hearth >= 1, chestN >= 0');
  check(m2.mystery && m2.mystery.keep === 1 && m2.fn === 'kept', 'sanitize: unknown JSON-safe keys kept');
  const raw3 = JSON.parse(E.serialize(fresh())); raw3.mines = { all: 5e6, peak: 10 };
  check(E.deserialize(JSON.stringify(raw3)).mines.peak === 5e6, 'sanitize: peak = max(peak, all)');
  const s4 = fresh(); s4.mines = 'broken'; E.tick(s4, 0.1);
  check(s4.mines && Array.isArray(s4.mines.units) && !badNum(E.stats(s4), 'st'), 'a broken subtree is repaired on tick');
  const s5 = fresh(); s5.mines.units = [1]; s5.mines.forge = null; s5.rank = 7; E.tick(s5, 0.1);
  check(s5.mines.units.length === 4 && typeof s5.mines.forge === 'object', 'hand-made short arrays are repaired');
}

// ================================================================ 2. opening
{
  ev.length = 0;
  const s = fresh(); s.rank = 6; E.tick(s, 1);
  check(!X.isOpen(s), 'rank 6: still closed');
  s.rank = 7; E.tick(s, 0.5);
  check(X.isOpen(s) && s.mines.units[0] >= 3 && s.mines.units[0] < 3.2 && s.mines.ore > 0 && s.mines.openAt > 0, 'rank 7 opens with the 3-Crew gift (and they dig at once)');
  check(ev.some(e => e.type === 'open'), "emits mines {type:'open'}");
  s.rank = 1; E.tick(s, 1);
  check(X.isOpen(s), 'the Mines stay open at rank 1');
  const s2 = fresh(); s2.lore.wake_ember = 1; E.tick(s2, 0.01);
  check(X.isOpen(s2) && X.visible(s2), 'Call the Deep opens them before rank 7');
  const s3 = fresh(); s3.lore.wake_ember = 1;
  check(X.visible(s3) && !X.isOpen(s3), 'tab visible with Call the Deep even before the tick');
  const s4 = opened(); const u = s4.mines.units[0]; s4.rank = 8; E.tick(s4, 0.001);
  check(Math.abs(s4.mines.units[0] - u) < 1e-6, 'the gift is given once');
}

// ================================================================ 3. the chain: exact vs 1 ms Euler stepping
{
  const s = opened();
  s.mines.depth = 5; s.mines.forge = { rails: 2 };
  s.mines.units = [10, 5, 3, 2]; s.mines.ore = 0; s.mines.all = 0; s.mines.peak = 0;
  const a = clone(s), b = clone(s);
  X.advance(a, 60, false);
  const r = [0, 1, 2, 3].map(k => X.unitEach(b, k));
  const x = [b.mines.ore, b.mines.units[0], b.mines.units[1], b.mines.units[2], b.mines.units[3]];
  const h = 0.001;
  for (let i = 0; i < 60000; i++) {
    const d = [x[1] * r[0], x[2] * r[1], x[3] * r[2], x[4] * r[3]];
    for (let j = 0; j < 4; j++) x[j] += d[j] * h;
  }
  check(near(a.mines.ore, x[0], 1e-4) && near(a.mines.units[0], x[1], 1e-4) && near(a.mines.units[1], x[2], 1e-4) && near(a.mines.units[2], x[3], 1e-4),
    'exact chain = Euler (1 ms) within 1e-4: ' + [a.mines.ore, x[0]].map(v => v.toFixed(3)).join(' vs '));
  // the exact solution does not depend on how the time is split
  const c = clone(s);
  for (let i = 0; i < 60; i++) X.advance(c, 1, false);
  check(near(a.mines.ore, c.mines.ore, 1e-9) && near(a.mines.units[0], c.mines.units[0], 1e-9), 'exact in one step = 60 steps of 1 s (1e-9)');
  check(a.mines.all === a.mines.ore && a.mines.peak === a.mines.all, 'digging raises Ore, lifetime Ore and peak alike');
  // locked tiers make nothing
  const l = opened(); l.mines.units = [0, 0, 7, 7]; l.mines.depth = 0; X.advance(l, 100, false);
  check(l.mines.units[0] === 0 && l.mines.units[1] === 0 && l.mines.ore === 0, 'Borers / Delvers below their Depth make nothing');
  check(X.unitEach(l, 0) === 0.1 && near(X.unitEach(l, 1), 0.005) && !X.tierOpen(l, 2) && !X.tierOpen(l, 3) && X.tierOpen(l, 1), 'unit rates and tier gates at Depth 0');
  const t = opened(); t.mines.depth = 3; t.mines.forge = { rails: 3 }; t.relics.r_ember = 1;
  check(near(X.unitEach(t, 0), 0.1 * 8 * Math.pow(1.25, 3) * 3), 'per-unit rate = prod x 2^rails x 1.25^D x Deep Veins 3');
  check(near(X.depthMult(0), 1) && near(X.depthMult(4), Math.pow(1.25, 4)) && isFinite(X.depthMult(300)), 'Depth multiplies miners x1.25 a level');
}

// ================================================================ 4. hire prices
{
  const s = opened(); s.tiers[0] = 1e12;
  check(near(X.hireCost(s, 0, 1), 1.6e7) && near(X.hireCost(s, 0, 3), 1.6e7 * (1 + 2.5 + 6.25)) && near(X.hireCost(s, 1, 1), 1e12), 'first hires: 1.6e7 Eggs, x2.5 each');
  const e0 = s.tiers[0];
  check(X.hire(s, 0, 2) && near(e0 - s.tiers[0], 1.6e7 * 3.5) && s.mines.hired[0] === 2 && near(s.mines.units[0], 5), 'hire 2 Crews spends 5.6e7 Eggs');
  check(near(X.hireCost(s, 0, 1), 1.6e7 * 6.25), 'the next hire costs x2.5^hired');
  check(buys.some(b => b.kind === 'miner' && b.id === 0 && b.n === 2), "hire emits buy {kind:'miner'}");
  s.mines.units[0] += 1000; // chain-made units
  check(near(X.hireCost(s, 0, 1), 1.6e7 * 6.25), 'chain-made units do not raise the price');
  const s2 = opened(); s2.tiers[0] = 1.6e7 * 9.75 - 1;
  check(X.hireMax(s2, 0) === 2 && X.hireMax(s2, 0, 1.6e7 * 9.75) === 3 && X.hireMax(s2, 0, 1) === 0, 'hireMax: the most the Eggs pay for');
  check(!X.hire(s2, 0, 3) && X.hire(s2, 0, 'max') && s2.mines.hired[0] === 2, "hire refuses what the Eggs cannot pay; 'max' buys hireMax");
  check(!X.hire(s2, 2, 1) && X.hireMax(s2, 2, 1e40) === 0, 'Borers cannot be hired below Depth 3');
  const s3 = fresh(); s3.tiers[0] = 1e20;
  check(!X.hire(s3, 0, 1), 'no hiring while the Mines are closed');
  const s4 = opened(); s4.tiers[0] = 1e300; const n = X.hireMax(s4, 0);
  check(n === Math.min(C.maxBuy, n) && n > 0 && isFinite(X.hireCost(s4, 0, n)), 'huge Eggs: hireMax finite and capped (' + n + ')');
}

// ================================================================ 5. the tithe at a Long Sleep
{
  ev.length = 0;
  const s = opened(); s.earnedRun = 1e8; s.tiers[0] = 4.07e12;
  const prev = X.tithePreview(s);
  E.sleep(s);
  const m = s.mines;
  check(s.tiers[0] === 0, "the new run's Eggs stay 0");
  check(JSON.stringify(m.lastTithe) === JSON.stringify(prev) && JSON.stringify(prev) === '[2,1,0,0]', 'tithe = the preview: 4.07e12 Eggs recruit 2 Crews (x1000 their price) and 1 Cart ' + JSON.stringify(prev));
  check(JSON.stringify(m.hired) === '[0,0,0,0]' && near(m.units[0], 5) && near(m.units[1], 1), 'recruits arrive but never raise the hire price');
  check(ev.some(e => e.type === 'tithe' && e.n[1] === 1), "emits mines {type:'tithe'}");
  const s2 = fresh(); s2.earnedRun = 1e8; s2.tiers[0] = 1e15; E.sleep(s2);
  check(!X.isOpen(s2) && JSON.stringify(s2.mines.units) === '[0,0,0,0]', 'closed Mines: no tithe');
  const s3 = opened(); s3.mines.depth = 5; s3.earnedRun = 1e8; s3.tiers[0] = 1e300; E.sleep(s3);
  check(JSON.stringify(s3.mines.lastTithe) === '[3,3,3,3]', 'any nest recruits at most 3 of each open miner ' + JSON.stringify(s3.mines.lastTithe));
  const s4 = opened(); s4.mines.depth = 2;
  check(JSON.stringify(X.titheFor(s4, 1.6e7 - 1)) === '[0,0,0,0]' && JSON.stringify(X.titheFor(s4, 1.6e7)) === '[1,0,0,0]' &&
    JSON.stringify(X.titheFor(s4, 1.6e10)) === '[2,0,0,0]' && JSON.stringify(X.titheFor(s4, 1.6e13)) === '[3,1,0,0]' && JSON.stringify(X.titheFor(s4, 1e40)) === '[3,3,0,0]',
    'tithe steps: 1 at the first-hire price, +1 per x1000, Borers need Depth 3');
  const nx = X.titheNext(s4, 1.6e10);
  check(nx && nx.k === 1 && nx.n === 1 && near(nx.eggs, 1e12) && X.titheNext(s4, 1e40) === null, 'titheNext: the cheapest next recruit (' + JSON.stringify(nx) + ')');
  // the C1 regression: after many high-Egg Sleeps (and hires by hand), a short run's Sleep still recruits
  const s5 = opened(); s5.mines.depth = 5; s5.mines.hired = [120, 110, 90, 70]; s5.earnedRun = 1e8; s5.tiers[0] = 1e22; E.sleep(s5);
  check(JSON.stringify(s5.mines.lastTithe) === '[3,3,1,0]', 'a big hire count never stops a short run recruiting ' + JSON.stringify(s5.mines.lastTithe));
}

// ================================================================ 6. Ascend keeps 25%
{
  const L = H.lore;
  const s = opened();
  Object.assign(s.mines, { ore: 1000, all: 4000, peak: 4000, units: [100, 40, 8, 3], hired: [10, 6, 3, 1], forge: { pans: 3, rails: 2 }, depth: 3, hearth: 2.5, chestN: 4 });
  s.legend = 1e9; s.lore.myth_gate = 1;
  check(L.canAscend(s), 'set up an Ascend');
  L.ascend(s);
  const m = s.mines;
  check(m.ore === 250 && m.all === 1000 && JSON.stringify(m.units.map(Math.floor)) === '[25,10,2,0]' && JSON.stringify(m.hired) === '[2,1,0,0]', 'Ascend keeps 25% of Ore, lifetime Ore, units and hires');
  check(m.open && m.depth === 3 && m.hearth === 2.5 && m.peak === 4000 && m.chestN === 4 && m.forge.pans === 3 && m.forge.rails === 2, 'Forge, Depth, Hearth, peak, Deep Chests and the open shaft stay');
  // Ore banked while the Mines are still shut (the event-lair token) is not cut
  const c = fresh(); c.mines.ore = 2500; c.legend = 1e9; c.lore.myth_gate = 1;
  L.ascend(c);
  check(!X.isOpen(c) && c.mines.ore === 2500, 'closed Mines: an Ascend keeps the banked Ore (' + c.mines.ore + ')');
}

// ================================================================ 7. offline and Night Shift
{
  const s = opened(); s.mines.units = [100, 0, 0, 0]; s.mines.ore = 0; s.mines.all = 0;
  const a = clone(s), b = clone(s);
  b.mines.forge = { night: 1 };
  X.advance(a, 100, true); X.advance(b, 100, true);
  check(near(a.mines.ore, 1000) && near(b.mines.ore, 2000), 'offline: 100 Crews dig 1000 Ore in 100 s; x2 with Night Shift');
  const c = clone(s); c.mines.forge = { night: 1 }; X.advance(c, 100, false);
  check(near(c.mines.ore, 1000), 'Night Shift does nothing while you play');
  const s2 = opened(); s2.mines.units = [1e6, 1e5, 1e4, 1e3]; s2.mines.depth = 20; s2.mines.forge = { rails: 3, night: 1 };
  E.offline(s2, 8 * 3600);
  check(!badNum(s2.mines, 'mines') && !badNum(E.stats(s2), 'stats') && s2.mines.ore > 0, 'offline 8 h with a deep chain stays finite');
  const o = X.takeOffline(s2);
  check(o && o.ore > 0 && o.sec >= 8 * 3600 - 1 && X.takeOffline(s2) === null, 'takeOffline reports the Ore dug while away, once');
}

// ================================================================ 8. nuggets and Lucky Seam
{
  const s = opened(); s.mines.units = [50, 0, 0, 0];
  check(near(X.nugValue(s), 10), 'a nugget = 2 s of Ore (50 Crews: 5/s -> 10)');
  const t = opened(); t.mines.units[0] = 0;
  check(X.nugValue(t) === 1, 'a nugget is worth at least 1 Ore');
  s.mines.forge.sieve = 2;
  check(near(X.nugValue(s), 20), 'Nugget Sieve 2: x2');
  const before = s.mines.all, got = X.nuggets(s, 3);
  check(near(got, 60) && near(s.mines.all - before, 60) && s.run.nug === 3 && s.stat.nug === 3, 'nuggets(3): +60 Ore, run.nug / stat.nug count them');
  const back = E.deserialize(E.serialize(s));
  check(back.stat.nug === 3 && back.run.nug === 3, 'nugget counts survive a save');
  check(X.nuggets(fresh(), 5) === 0, 'no nuggets while closed');
  const u = opened(); u.mines.units = [100, 0, 0, 0];
  const a0 = u.mines.all; let res = E.grabTreasure(u);
  check(u.mines.all === a0 && res.ore === undefined, 'no Lucky Seam: a treasure gives no Ore');
  u.mines.forge.seam = 1; const a1 = u.mines.all; res = E.grabTreasure(u);
  check(near(u.mines.all - a1, 600) && near(res.ore, 600) && / Ore\.$/.test(res.text), 'Lucky Seam: a treasure gives 60 s of Ore (+600) and says so');
}

// ================================================================ 9. Forge, Depth, Lanterns
{
  ev.length = 0;
  const s = opened(); s.mines.ore = 100;
  check(X.forgeCost(s, 'pans') === 60 && X.forge(s, 'pans') && s.mines.forge.pans === 1 && near(s.mines.ore, 40), 'Gilded Pans 1 for 60 Ore');
  check(X.forgeCost(s, 'pans') === 300 && !X.forge(s, 'pans'), 'level 2 costs 300 (x5 per level); not affordable');
  check(ev.some(e => e.type === 'forge' && e.id === 'pans' && e.lv === 1), "emits mines {type:'forge'}");
  s.mines.ore = 1e30;
  for (let i = 0; i < 40; i++) X.forge(s, 'pans');
  check(s.mines.forge.pans === 10 && X.forgeCost(s, 'pans') === 0 && !X.forge(s, 'pans'), 'Pans cap at 10');
  check(!X.forge(s, 'nope'), 'unknown Forge id refused');
  const st0 = E.stats(opened()), st1 = E.stats(s);
  check(near(st1.M.coinMult / st0.M.coinMult, 2.5), 'Pans 10: coins x2.5');
  const fl = X.forgeList(s);
  check(fl.length === 10 && fl.find(f => f.id === 'pans').done && fl.every(f => typeof f.now === 'string'), 'forgeList: 10 items');
  // Stoke the Forge never caps (cost x10 a level) and raises the glow's bonus +10% a level
  const sk = opened(); sk.mines.ore = 1e30; sk.mines.all = 1e6;
  const gl0 = X.glow(sk);
  check(X.forgeCost(sk, 'stoke') === 1e9 && X.forge(sk, 'stoke') && X.forgeCost(sk, 'stoke') === 1e10 && X.forge(sk, 'stoke'), 'Stoke the Forge: 1e9, then x10');
  check(near(X.glow(sk) - 1, (gl0 - 1) * 1.2, 1e-9), 'Stoke 2: glow bonus x1.2');
  check(fl.find(f => f.id === 'stoke').endless && !fl.find(f => f.id === 'stoke').done, 'Stoke is endless and never done');
  // Shaft Depth
  const d = opened(); d.mines.ore = C.depthBase * 11;
  const all0 = d.mines.all;
  check(X.depthCost(d) === C.depthBase && X.dig(d) && d.mines.depth === 1 && X.depthCost(d) === C.depthBase * 10, 'Depth 0 -> 1 costs depthBase, then x10');
  d.mines.ore = C.depthBase * 200;
  check(X.dig(d) && d.mines.depth === 2 && !X.tierOpen(d, 2) && X.dig(d) && d.mines.depth === 3 && X.tierOpen(d, 2) && !X.tierOpen(d, 3), 'Depth 3 opens Tunnel Borers');
  check(ev.some(e => e.type === 'depth' && e.d === 3 && e.opens === 2), "emits mines {type:'depth', opens: 2}");
  check(d.mines.all === all0, 'spending Ore never lowers lifetime Ore');
  d.mines.ore = 1e300;
  for (let i = 0; i < 400; i++) X.dig(d);
  check(d.mines.depth <= 300 && !badNum(d.mines, 'm'), 'Depth stops at 300, finite');
  // Sky Lanterns (js/sky.js) spend Ore and never lower lifetime Ore
  const K = H.sky, k = opened(); K._now = () => Date.UTC(2026, 10, 5); E.tick(k, 0.01);
  k.mines.ore = 2e7; const all1 = k.mines.all;
  check(K.on(k) && K.buyLantern(k) && K.buyLantern(k) && k.sky.lant === 2 && near(k.mines.ore, 2e7 - 1.01e7) && k.mines.all === all1, 'two Sky Lanterns: 10.1M Ore, lifetime Ore untouched');
  check(!K.buyLantern(fresh()), 'no lanterns while the Mines are closed');
}

// ================================================================ 10. glow, Hearth, Deep Veins
{
  const s = opened();
  check(X.glow(s) === 1, 'glow x1.00 at 0 Ore dug');
  s.mines.all = 1e6;
  const L6 = Math.pow(Math.log10(1e6 + 1), C.glowExp);
  check(near(X.glow(s), 1 + C.glowK * L6, 1e-6), 'glow = 1 + glowK x log10(1 + all)^' + C.glowExp + ' (' + X.glow(s).toFixed(4) + ')');
  s.mines.forge.heart = 1;
  check(near(X.glow(s), 1 + C.glowK * 1.25 * L6, 1e-6), 'Heart of the Forge: glowK x1.25');
  const g0 = E.stats(opened()), g1 = E.stats(s);
  check(near(g1.M.gpsMult / g0.M.gpsMult, X.glow(s)) && near(g1.M.coinFlat / g0.M.coinFlat, X.glow(s)), 'the glow multiplies gold/s and the flat coin worth');
  const h = opened(); h.mines.hearth = 6.9378;
  check(near(E.stats(h).M.gpsMult / g0.M.gpsMult, 6.9378), "Ember's Hearth multiplies gold/s");
  const c = fresh(); c.mines.hearth = 3; c.mines.all = 1e9; E.dirty();
  check(X.glow(c) === 1 && near(E.stats(c).M.gpsMult, E.stats(fresh()).M.gpsMult * 3), 'closed Mines: glow 1, a converted Hearth still counts');
  const r = opened(); r.relics.r_ember = 1;
  check(near(X.unitEach(r, 0), 0.3) && near(X.unitEach(r, 3), 0.0015), 'Deep Veins: miners x3');
}

// ================================================================ 11. Deep Chests
{
  ev.length = 0;
  const s = opened(); s.cards = {};
  X.nuggets(s, 0); // nothing
  s.mines.units = [0, 0, 0, 0];
  const at0 = X.nextChestAt(s);
  check(at0 === Math.pow(10, C.chestBase10), 'first Deep Chest at 10^' + C.chestBase10);
  const ids = [];
  for (let i = 0; i < 9; i++) { s.mines.all = s.mines.peak = 0; X.nuggets(s, 0); s.mines.units = [0, 0, 0, 0]; }
  // dig through 9 powers of ten
  for (let i = 0; i < 9; i++) {
    const need = X.nextChestAt(s) - s.mines.all;
    s.mines.units = [0, 0, 0, 0];
    X.advance(s, 0, false);
    // add exactly to the threshold through nuggets (1 Ore each while no crews)
    const t = opened(); t.mines = s.mines; t.cards = s.cards;
    X.nuggets(t, need); // nugValue 1
    ids.push(Object.keys(t.cards).filter(k => !ids.includes(k))[0]);
  }
  check(JSON.stringify(ids) === JSON.stringify(X.CHEST_ORDER), 'the 9 Deep cards come in order, one per power of ten: ' + ids.join(','));
  check(s.mines.chestN === 9 && ev.filter(e => e.type === 'chest').length === 9, 'chestN 9, 9 chest events');
  const t = opened(); t.mines = clone(s.mines); t.cards = clone(s.cards);
  const before = Object.values(t.cards).reduce((a, b) => a + b, 0);
  X.nuggets(t, X.nextChestAt(t) - t.mines.all + 1);
  const after = Object.values(t.cards).reduce((a, b) => a + b, 0);
  check(after === before + 1 && t.mines.chestN === 10, 'after all 9: one more card per chest (a deterministic epic/legendary roll)');
  const rar = {};
  for (let n = 0; n < 280; n++) { const u = opened(); u.mines = clone(t.mines); u.mines.chestN = n; u.cards = clone(t.cards); u.mines.peak = u.mines.all = X.nextChestAt(u); X.nuggets(u, 1); for (const k of Object.keys(u.cards)) if (u.cards[k] > t.cards[k]) { const c = D.cards.find(c2 => c2.id === k); rar[c.rarity] = (rar[c.rarity] || 0) + 1; } }
  check(rar.epic > 190 && rar.legendary > 30 && rar.epic + rar.legendary === 280, 'the roll is about 80% epic / 20% legendary ' + JSON.stringify(rar));
  // no repeat after an Ascend: peak and chestN stay
  const a = opened(); a.mines.all = a.mines.peak = 1e6; a.mines.chestN = 3; a.cards = {};
  a.legend = 1e9; a.lore.myth_gate = 1; H.lore.ascend(a);
  X.nuggets(a, 10);
  check(a.mines.chestN === 3 && Object.keys(a.cards).filter(k => /^ev_/.test(k)).length === 0 && a.mines.all < 1e6, 'no Deep Chest repeats after an Ascend');
}

// ================================================================ 12. the 'ore' and 'hire' quests
{
  const tpls = D.missionTemplates.filter(t => t.group === 'mines').map(t => t.tpl).sort().join();
  check(tpls === 'hire,ore' && typeof E.addMissionTemplate === 'function', 'two Mines quests registered (group mines)');
  check(!E.addMissionTemplate({ tpl: 'coins', make() {}, cur() { return 0; } }) && !E.addMissionTemplate({ tpl: 'x' }), 'core tpl ids and incomplete defs are refused');
  // generate many quests on an open Mines state with Eggs and Ore/s: both kinds appear, never two in the slots
  const s = opened(); s.rank = 7; s.missionSeq = 10; s.mines.units[0] = 100; s.tiers[0] = 2e7; s.gold = 1e9; s.tiers[1] = 1e4;
  let seen = { ore: 0, hire: 0 }, two = 0;
  for (let i = 0; i < 300; i++) {
    s.missions = [];
    E.tick(s, 0.01);
    const ms = s.missions.filter(m => m.tpl === 'ore' || m.tpl === 'hire');
    if (ms.length > 1) two++;
    for (const m of ms) seen[m.tpl]++;
  }
  check(seen.ore > 5 && seen.hire > 5 && two === 0, 'ore and hire quests generate, never two Mines quests at once ' + JSON.stringify(seen) + ' two=' + two);
  // progress, serialize round trip
  let s2 = opened(); s2.rank = 7; s2.missionSeq = 10; s2.mines.units[0] = 100; s2.tiers[0] = 1e10;
  let q = null;
  for (let i = 0; i < 400 && !q; i++) { s2.missions = []; E.tick(s2, 0.01); q = s2.missions.find(m => m.tpl === 'ore'); }
  check(!!q && q.target >= 30 && q.base === s2.mines.all && q.T > 0, 'ore quest: target >= 30, base = lifetime Ore');
  const idx = s2.missions.indexOf(q);
  const back = E.deserialize(E.serialize(s2));
  check(back.missions[idx] && back.missions[idx].tpl === 'ore' && back.missions[idx].target === q.target, 'ore quest survives serialize / deserialize');
  check(/^Dig .+ Ore$/.test(E.missionInfo(back, idx).title), 'ore quest title: ' + E.missionInfo(back, idx).title);
  E.offline(back, 3600);
  const mi = E.missionInfo(back, idx);
  check(mi.done, 'offline digging counts toward the ore quest');
  let s3 = opened(); s3.rank = 7; s3.missionSeq = 10; s3.mines.units[0] = 100; s3.tiers[0] = 3e13; s3.tiers[1] = 1e9;
  let hq = null;
  for (let i = 0; i < 400 && !hq; i++) { s3.missions = []; E.tick(s3, 0.01); hq = s3.missions.find(m => m.tpl === 'hire'); }
  check(!!hq && hq.key === 1 && hq.target - hq.base >= 1 && hq.target - hq.base <= 5, 'hire quest: the deepest affordable tier (Carts), 1..5 hires');
  const hi = s3.missions.indexOf(hq);
  check(/^Hire \d+ Ore Carts?$/.test(E.missionInfo(s3, hi).title) && !E.missionInfo(s3, hi).done, 'hire quest title: ' + E.missionInfo(s3, hi).title);
  s3.tiers[0] = 1e16;   // the nest grew
  X.hire(s3, 1, hq.target - hq.base);
  check(E.missionInfo(s3, hi).done, 'hiring the Carts completes it');
  const b3 = E.deserialize(E.serialize(s3));
  check(b3.missions[hi].tpl === 'hire' && b3.missions[hi].key === 1, 'hire quest survives a save');
  // a fresh-opened shaft (3 Crews: 0.3 Ore/s) with no Eggs: neither quest is offered yet
  const s4 = opened(); s4.missionSeq = 10; s4.tiers[0] = 0; s4.gold = 0;
  let any = 0;
  for (let i = 0; i < 100; i++) { s4.missions = []; E.tick(s4, 0.001); if (s4.missions.some(m => m.tpl === 'ore' || m.tpl === 'hire')) any++; }
  check(any === 0, 'no Ore/s >= 1 and no Egg budget: no Mines quest offered (' + any + ')');
  const s5 = fresh(); s5.missionSeq = 10; s5.rank = 4;
  let low = 0;
  for (let i = 0; i < 100; i++) { s5.missions = []; E.tick(s5, 0.001); if (s5.missions.some(m => m.tpl === 'ore' || m.tpl === 'hire')) low++; }
  check(low === 0, 'no Mines quests while the Mines are closed');
  const s7 = opened(); s7.rank = 3; s7.missionSeq = 10; s7.mines.units[0] = 100;
  let r3 = 0;
  for (let i = 0; i < 200; i++) { s7.missions = []; E.tick(s7, 0.001); if (s7.missions.some(m => m.tpl === 'ore')) r3++; }
  check(r3 > 0, 'Mines quests from rank 3 once the Mines are open (' + r3 + ')');
  const s8 = opened(); s8.rank = 7; s8.missionSeq = 10; s8.mines.units[0] = 100; s8.tiers[0] = 1e40;
  let triv = 0;
  for (let i = 0; i < 200; i++) { s8.missions = []; E.tick(s8, 0.001); if (s8.missions.some(m => m.tpl === 'hire')) triv++; }
  check(triv === 0, 'no hire quest the Eggs in the nest already pay for (' + triv + ')');
  // isAct: ore is an activity quest, hire a gold quest
  const s6 = opened(); s6.rank = 7; s6.missionSeq = 10; s6.mines.units[0] = 100; s6.tiers[0] = 1e10;
  let pairs = 0;
  for (let i = 0; i < 200; i++) { s6.missions = []; E.tick(s6, 0.01); const act = s6.missions.filter(m => ['coins', 'streak', 'treasures', 'gusts', 'ore'].includes(m.tpl)); if (act.length > 1) pairs++; }
  check(pairs === 0, 'ore obeys one activity quest at a time');
}

// ================================================================ 13. strategy: hiring deepest-first by hand beats all-Crews over 20 Sleeps
{
  // the same Egg budget at each of 20 Sleeps (a growing nest), 10 min of digging between Sleeps
  function runStrat(deep) {
    const s = opened(); s.mines.units = [3, 0, 0, 0]; s.mines.depth = 5;
    for (let i = 0; i < 20; i++) {
      const eggs = 1e10 * Math.pow(10, i);
      if (deep) { s.tiers[0] = eggs; for (let k = 3; k >= 0; k--) { const n = X.hireMax(s, k); if (n > 0) X.hire(s, k, n); } }
      else { s.tiers[0] = eggs; const n = X.hireMax(s, 0); if (n > 0) X.hire(s, 0, n); }
      X.advance(s, 600, false);
    }
    return s.mines.all;
  }
  const deep = runStrat(true), crews = runStrat(false);
  check(deep > 10 * crews, 'deepest-first digs far more than all-Crews over 20 Sleeps (' + deep.toExponential(2) + ' vs ' + crews.toExponential(2) + ')');
}

// ================================================================ 14. the player's live save: 8 h away, a Sleep
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-myth4.json'), 'utf8');
  const s = E.deserialize(raw);
  check(X.isOpen(s) && s.mines.units[0] === 1165 && near(X.oreRate(s), 932), 'live save: 1,165 Pick Crews dig 932 Ore/s');
  const ore0 = s.mines.ore;
  E.offline(s, 8 * 3600);
  check(!badNum(s.mines, 'mines') && !badNum(E.stats(s), 'stats') && s.mines.ore > ore0, 'live save + 8 h away: finite, Ore up (' + ore0.toExponential(2) + ' -> ' + s.mines.ore.toExponential(2) + ')');
  // G11: a fresh copy, a 90 s live run, then a Sleep with the save's 4.07e12 Eggs: the tithe hires >= 1 Cart
  const t = E.deserialize(raw);
  t.auto.master = false;   // the player's own hands only: automation would spend the Eggs on Raiding Parties
  check(t.tiers[0] >= 4.06e12, 'live save: ' + t.tiers[0].toExponential(3) + ' Eggs in the nest');
  for (let i = 0; i < 90; i++) E.tick(t, 1);
  const eggs = t.tiers[0];
  const pv = X.tithePreview(t);
  if (E.canSleep(t)) E.sleep(t); else { t.earnedRun = 1e9; E.sleep(t); }
  check(eggs >= 4e12 && t.mines.lastTithe[1] >= 1 && JSON.stringify(t.mines.lastTithe) === JSON.stringify(pv), 'live save, 90 s then Sleep: ' + eggs.toExponential(2) + ' Eggs tithe ' + JSON.stringify(t.mines.lastTithe));
  // review C1: after the 8 h night (Dream Keeper's long runs) the player's short live runs still recruit
  s.mines.depth = Math.max(3, s.mines.depth);
  s.earnedRun = Math.max(1e9, s.earnedRun); s.tiers[0] = 1e22; s.auto.master = false;
  const u0 = s.mines.units.slice();
  E.sleep(s);
  check(JSON.stringify(s.mines.lastTithe) === '[3,3,1,0]' && s.mines.units[0] >= u0[0] + 3, 'live save after the night: a 1e22-Egg Sleep recruits ' + JSON.stringify(s.mines.lastTithe));
}

// ================================================================ 15. ui.js + ui-mines.js load in Node
try { load(BASE.concat(['js/sky.js', 'js/ui.js', 'js/ui-mines.js', 'js/ui-sky.js'])); passes++; } catch (e) { fails++; console.log('FAIL: ui-mines.js throws in Node', e); }
try { load(['js/data.js', 'js/engine.js', 'js/ui.js', 'js/ui-mines.js']); passes++; } catch (e) { fails++; console.log('FAIL: ui-mines.js without mines.js throws in Node', e); }
try { load(['js/data.js', 'js/engine.js', 'js/mines.js', 'js/log.js', 'js/cave.js']); passes++; } catch (e) { fails++; console.log('FAIL: log.js / cave.js with mines.js throw in Node', e); }

console.log(fails ? fails + ' FAILURES, ' + passes + ' mines checks passed' : passes + ' mines checks passed');
console.log(fails ? 'MINES FAILED' : 'MINES OK');
process.exitCode = fails ? 1 : 0;
