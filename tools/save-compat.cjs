// Save compatibility test: v1 saves (fixtures made by the v1 engine from git main) must load in the v2 engine.
// Usage: node tools/save-compat.cjs        (regenerate fixtures with: node tools/gen-v1-fixtures.cjs)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const root = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let fails = 0, passes = 0;
function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function finiteDeep(o, p) {
  if (typeof o === 'number') return isFinite(o) ? null : p;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = finiteDeep(o[k], p + '.' + k); if (r) return r; }
  return null;
}
function load(files, srcOf) {
  let seed = 99;
  const sb = { console, Date, JSON, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(srcOf(f), sb, { filename: f });
  return sb.HOARD;
}
const disk = f => fs.readFileSync(path.join(root, f), 'utf8');
// every engine-side feature module, in index.html order
const MODS = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/mines.js', 'js/sky.js'];
let gitOk = true;
const git = f => { try { return cp.execFileSync('git', ['show', 'main:' + f], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { gitOk = false; return ''; } };

const V2 = load(['js/data.js', 'js/engine.js'], disk);
const E = V2.engine;
check(E.version === 2, 'engine.version === 2');
const fixtures = fs.readdirSync(FIX).filter(f => /^v1-.*\.json$/.test(f)).sort();
check(fixtures.length >= 4, 'at least 4 v1 fixtures (' + fixtures.join(',') + ')');

// the v1 engine from git main, to compare derived numbers on the same save
const V1src = [git('js/data.js'), git('js/engine.js')];
const V1 = gitOk ? load(['js/data.js', 'js/engine.js'], f => (f === 'js/data.js' ? V1src[0] : V1src[1])) : null;
if (!V1) console.log('note: git main not available, skipping v1-vs-v2 stats comparison');

function compareLoad(H, name, raw, label) {
  const E2 = H.engine;
  const o = JSON.parse(raw);
  const rawCopy = JSON.stringify(o);
  const s = E2.deserialize(o);
  check(JSON.stringify(o) === rawCopy, label + name + ': deserialize must not mutate its input');
  check(s.v === 2, label + name + ': v === 2 (got ' + s.v + ')');
  check(s._migratedFrom === 1, label + name + ': _migratedFrom === 1');
  check(E2.saveVersion(raw) === 1, label + name + ': saveVersion(raw) === 1');
  check(s.gold === o.gold, label + name + ': gold preserved ' + o.gold + ' -> ' + s.gold);
  check(s.earnedRun === o.earnedRun && s.earnedAll === o.earnedAll, label + name + ': earned preserved');
  check(JSON.stringify(s.buildings) === JSON.stringify(o.buildings), label + name + ': buildings preserved');
  check(JSON.stringify(s.tiers) === JSON.stringify(o.tiers), label + name + ': tiers preserved');
  check(JSON.stringify(s.cards) === JSON.stringify(o.cards), label + name + ': cards preserved');
  check(JSON.stringify(s.upgrades) === JSON.stringify(o.upgrades), label + name + ': upgrades preserved');
  check(JSON.stringify(s.missions) === JSON.stringify(o.missions), label + name + ': missions preserved');
  check(s.legend === o.legend && s.rank === o.rank && s.rankProgress === o.rankProgress && s.chests === o.chests && s.sleeps === o.sleeps, label + name + ': legend/rank/chests/sleeps preserved');
  check(s.time === o.time && s.savedAt === o.savedAt && s.missionSeq === o.missionSeq, label + name + ': time/savedAt/missionSeq preserved');
  check(JSON.stringify(s.settings) === JSON.stringify(o.settings), label + name + ': settings preserved');
  check(s.legendPts === s.legend, label + name + ': legendPts === legend (' + s.legendPts + ' vs ' + s.legend + ')');
  check(s.myth === 0 && s.mythPts === 0 && s.myths === 0, label + name + ': myth fields 0');
  for (const k of ['lore', 'relics', 'flags', 'auto']) check(s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]), label + name + ': ' + k + ' is an object');
  // v1 had no active-time stat: game time is the estimate (the current run only when no Sleep was taken yet)
  check(s.stat.playActive === o.time && s.stat.fastestSleep === 0 && s.run.playActive === ((o.sleeps || 0) >= 1 ? 0 : o.time), label + name + ': new stat fields seeded from v1 time (' + s.stat.playActive + '/' + s.run.playActive + ')');
  const bad = finiteDeep(s, 'state');
  check(!bad, label + name + ': all numbers finite ' + (bad || ''));
  // wrapper form (cloud doc { json, savedAt })
  const w = E2.deserialize({ json: raw, savedAt: o.savedAt });
  check(w.gold === o.gold && w.legendPts === o.legend, label + name + ': cloud wrapper loads');
  // round trip
  const json = E2.serialize(s);
  check(!/_migratedFrom/.test(json), label + name + ': _migratedFrom not saved');
  const s2 = E2.deserialize(json);
  check(s2.v === 2 && s2._migratedFrom === undefined && s2.legendPts === s.legendPts && s2.gold === s.gold, label + name + ': v2 round trip');
  check(E2.saveVersion(json) === 2, label + name + ': saveVersion(v2 json) === 2');
  // play a little: tick, offline, sleep where possible, all finite
  for (let i = 0; i < 30; i++) E2.tick(s2, 0.5);
  E2.offline(s2, 3600);
  const st = E2.stats(s2);
  check(!finiteDeep(st, 'stats') && !finiteDeep(s2, 'state'), label + name + ': finite after tick+offline');
  if (E2.canSleep(s2)) {
    const before = s2.legend, pts = s2.legendPts;
    const g = E2.sleep(s2);
    check(g >= 3 && s2.legend === before + g && s2.legendPts === pts + g, label + name + ': sleep adds gained to legend AND legendPts');
  }
  return s;
}

for (const f of fixtures) {
  const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
  const s = compareLoad(V2, f, raw, '');
  // v1 vs v2 derived numbers on the same save (the modifier refactor must not change v1 balance)
  if (V1) {
    const a = V1.engine.deserialize(raw), b = V2.engine.deserialize(raw);
    const sa = V1.engine.stats(a), sb = V2.engine.stats(b);
    // Feel pass (intentional economy change): building gold/s now has Nest warmth (x warmth of the brood) and new
    // building gps/milestones, so gold/s, coin worth (its gps part), sweep gold/s and offline gold differ from git main.
    // Everything else is unchanged and still must match exactly.
    for (const k of ['spillRate', 'sweepRate', 'gustCooldown', 'gustWorthMult', 'maxStreak', 'offlineCapHours', 'legendMult'])
      check(sa[k] === sb[k], f + ': stats.' + k + ' v1=' + sa[k] + ' v2=' + sb[k]);
    check(JSON.stringify(sa.tierRates) === JSON.stringify(sb.tierRates) && JSON.stringify(sa.treasureInterval) === JSON.stringify(sb.treasureInterval), f + ': tierRates/treasureInterval identical');
    // the changed numbers: finite, building gold/s present exactly when buildings are, Nest warmth >= 1 and matching
    // the brood, and gold/s = (sum of building gold/s) (self-consistent)
    const nb = Object.values(b.buildings).reduce((x, y) => x + y, 0);
    check(isFinite(sb.gps) && isFinite(sb.coinWorth) && (nb > 0) === (sb.baseGps > 0) && (sa.baseGps > 0) === (sb.baseGps > 0), f + ': gold/s finite and present iff buildings (' + sa.baseGps + ' -> ' + sb.baseGps + ')');
    check(sb.broodMult >= 1 && Math.abs(sb.broodMult - V2.engine.warmthAt(V2.engine.nestSize(b))) < 1e-9 * sb.broodMult, f + ': Nest warmth x' + sb.broodMult.toFixed(3) + ' from the brood');
    const sumB = Object.values(sb.buildingGps).reduce((x, y) => x + y, 0);
    check(Math.abs(sumB - sb.gps) <= 1e-9 * Math.max(1, sb.gps), f + ': gold/s = sum of building gold/s');
    check(sb.coinWorth >= sa.coinWorth * 0.2 && sb.coinWorth <= sa.coinWorth * 5, f + ': coin worth in the same range (' + sa.coinWorth + ' -> ' + sb.coinWorth + ')');
    for (const id of Object.keys(a.buildings)) check(JSON.stringify(V1.engine.buildingCost(a, id, 10)) === JSON.stringify(V2.engine.buildingCost(b, id, 10)), f + ': buildingCost(' + id + ',10) identical');
    for (let i = 0; i < 5; i++) check(JSON.stringify(V1.engine.tierCost(a, i, 'max')) === JSON.stringify(V2.engine.tierCost(b, i, 'max')), f + ': tierCost(' + i + ',max) identical');
    // v2 Legend gain is 3.2 * cbrt(earnedRun / 1e7) (v1: sqrt(earnedRun / 1e6)); both give 3 at the 1e7 Sleep minimum,
    // so a v1 player who is Sleep-ready gets the same first Sleep
    if (V1.engine.canSleep(a)) check(V1.engine.legendOnSleep(a) === V2.engine.legendOnSleep(b), f + ': legendOnSleep identical at the Sleep minimum (' + V1.engine.legendOnSleep(a) + ' vs ' + V2.engine.legendOnSleep(b) + ')');
    check(V1.engine.canSleep(a) === V2.engine.canSleep(b), f + ': canSleep identical');
    const oa = V1.engine.offline(a, 7200), ob = V2.engine.offline(b, 7200);
    // minions are unchanged; offline gold changed with the economy (Nest warmth), it must stay finite and > 0 iff v1's is
    check(JSON.stringify(oa.minions) === JSON.stringify(ob.minions), f + ': offline(2h) minions identical');
    check(isFinite(ob.gold) && (oa.gold > 0) === (ob.gold > 0), f + ': offline(2h) gold ' + oa.gold + ' -> ' + ob.gold);
  }
  // Nest warmth only ever adds: the same save with warmth switched off (W0 -> infinity) has coin worth no higher, and
  // 2 h offline gives no more gold and exactly the same minions
  {
    const C2 = V2.data.C, w0 = C2.broodW0;
    const on = E.deserialize(raw), sOn = E.stats(on), coinOn = sOn.coinWorth, gpsOn = sOn.gps;
    const offOn = E.offline(E.deserialize(raw), 7200);
    C2.broodW0 = 1e300; E.dirty(); // ~infinity (a non-finite W0 falls back to the default)
    let coinOff, gpsOff, offOff;
    try {
      const off = E.deserialize(raw), sOff = E.stats(off);
      coinOff = sOff.coinWorth; gpsOff = sOff.gps; offOff = E.offline(E.deserialize(raw), 7200);
      check(sOff.broodMult === 1, f + ': warmth x1 with W0 = infinity');
    } finally { C2.broodW0 = w0; E.dirty(); }
    check(coinOn >= coinOff * (1 - 1e-12), f + ': Nest warmth never lowers coin worth (' + coinOff + ' -> ' + coinOn + ')');
    check(gpsOn >= gpsOff * (1 - 1e-12), f + ': Nest warmth never lowers gold/s (' + gpsOff + ' -> ' + gpsOn + ')');
    check(offOn.gold >= offOff.gold * (1 - 1e-12), f + ': offline(2h) gold with warmth >= without (' + offOff.gold + ' -> ' + offOn.gold + ')');
    check(JSON.stringify(offOn.minions) === JSON.stringify(offOff.minions), f + ': offline(2h) minions identical with and without warmth');
  }
  // the feel pass must not make an existing save poorer on load: gold/s >= 0.8x what the pre-feel-pass engine gave
  {
    const before = { 'v1-postsleep.json': 650, 'v1-rank4.json': 141.4, 'v1-sleepready.json': 2565 }[f];
    if (before) { const g = E.stats(E.deserialize(raw)).baseGps; check(g >= 0.8 * before, f + ': gold/s on load ' + g.toFixed(1) + ' >= 0.8 x ' + before); }
  }
  console.log('ok ' + f + ': rank ' + s.rank + ', gold ' + V2.fmt(s.gold) + ', legend ' + s.legend + ' -> legendPts ' + s.legendPts);
}

// ---------------------------------------------------------------- garbage / empty / future versions
for (const g of [null, undefined, '', '   ', '{bad', 'null', '42', 42, [], {}, { v: 1 }, { gold: 'x', tiers: 'no', missions: [{ tpl: 'zzz' }] },
  { v: 'two', gold: Infinity, tiers: [NaN, -5, 1e400], buildings: { digger: -3 }, legend: -4, legendPts: NaN },
  { json: '{broken', savedAt: 5 }, { json: 7 }]) {
  let s = null, threw = null;
  try { s = E.deserialize(g); } catch (e) { threw = e; }
  check(!threw && s && s.v === 2 && s.missions.length === 3, 'garbage load ' + JSON.stringify(g) + (threw ? ' threw ' + threw : ''));
  check(s && !finiteDeep(s, 's'), 'garbage load finite ' + JSON.stringify(g));
  check(s && s.legendPts >= 0 && s.gold >= 0, 'garbage load non-negative ' + JSON.stringify(g));
}
{
  const fut = { v: 9, gold: 1234, legend: 7, legendPts: 2, rank: 3, buildings: { digger: 5 }, cards: { rustpick: 2, futureCard: 3 }, cosmos: { stars: 4, deep: { a: [1, 2] } }, lore: { greed: 3 } };
  let s = null, threw = null;
  try { s = E.deserialize(JSON.stringify(fut)); } catch (e) { threw = e; }
  check(!threw && s, 'future version loads without throwing');
  check(s.gold === 1234 && s.legend === 7 && s.legendPts === 2 && s.rank === 3 && s.buildings.digger === 5, 'future version keeps known fields (legendPts not reset)');
  check(s._futureVersion === 9 && s.v === 2, 'future version flagged');
  check(s.cosmos && s.cosmos.stars === 4 && s.cosmos.deep.a[1] === 2, 'unknown subtree preserved');
  check(s.cards.futureCard === 3 && s.lore.greed === 3, 'unknown card ids and lore levels preserved');
  check(E.saveVersion(JSON.stringify(fut)) === 9 && E.saveVersion('junk') === 0 && E.saveVersion({ json: JSON.stringify({ v: 2 }), savedAt: 1 }) === 2, 'saveVersion');
}

// ---------------------------------------------------------------- module state defaults + migration (fresh context)
{
  const H = load(['js/data.js', 'js/engine.js'], disk);
  const E2 = H.engine;
  E2.addStateDefaults('testmod', () => ({ level: 1, on: true, map: {}, list: [1, 2], name: 'x' }));
  E2.addModSource('testmod', (s, M) => { M.gpsMult *= 1 + 0.1 * s.testmod.level; });
  const raw = fs.readFileSync(path.join(FIX, 'v1-rank4.json'), 'utf8');
  const s = E2.deserialize(raw);
  check(s.testmod && s.testmod.level === 1 && s.testmod.on === true && Array.isArray(s.testmod.list), 'module defaults filled on a v1 load');
  s.testmod.level = 4; s.testmod.map.k = 3; s.testmod.extra = 'kept';
  const s2 = E2.deserialize(E2.serialize(s));
  check(s2.testmod.level === 4 && s2.testmod.map.k === 3 && s2.testmod.extra === 'kept', 'module subtree round trip');
  const s3 = E2.deserialize(JSON.stringify(Object.assign(JSON.parse(E2.serialize(s)), { testmod: { level: 'bad', on: 5 } })));
  check(s3.testmod.level === 1 && s3.testmod.on === true, 'module subtree type-checked against defaults');
  E2.dirty();
  const base = V2.engine.stats(V2.engine.deserialize(raw)).baseGps, withMod = E2.stats(s2).baseGps;
  check(Math.abs(withMod / base - 1.4) < 1e-9, 'mod source applied (x' + (withMod / base) + ')');
}

// ---------------------------------------------------------------- with every engine-side feature module loaded
{
  const mods = MODS;
  const H = load(mods, disk);
  for (const f of fixtures) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
    compareLoad(H, f, raw, '[all modules] ');
  }
}

// ---------------------------------------------------------------- the real player's case: a v2 save right after
// Sleep 1 with Lore greed:1 + halls:1 (written by the pre-feel-pass engine) loads, plays and keeps its Lore (the Lore
// trim folds halls into Dragon's Hunger = greed at the higher of the two levels)
{
  const mods = MODS;
  const H = load(mods, disk), E3 = H.engine;
  const raw = fs.readFileSync(path.join(FIX, 'v1-postsleep.json'), 'utf8');
  const o = JSON.parse(raw);
  Object.assign(o, { v: 2, legend: 3, legendPts: 0, lore: { greed: 1, halls: 1 }, relics: {}, flags: {}, auto: {}, myth: 0, mythPts: 0, myths: 0, sleeps: 1 });
  o.tiers = [1200, 30, 2, 0, 0]; o.buildings = Object.assign({}, o.buildings, { digger: 22, raid: 6 });
  const v2raw = JSON.stringify(o);
  const s = E3.deserialize(v2raw);
  check(s.v === 2 && !s._migratedFrom && s.lore.greed === 1 && s.lore.halls === undefined && s.legend === 3 && s.legendPts === 0 && s.sleeps === 1, 'player v2 save (Sleep 1, greed:1 halls:1) loads as Hunger 1');
  check(JSON.stringify(s.tiers) === JSON.stringify(o.tiers) && s.buildings.digger === 22 && s.gold === o.gold, 'player v2 save keeps gold, brood and buildings');
  const st = E3.stats(s);
  check(st.broodMult > 1 && st.gps > 0 && !finiteDeep(st, 'stats'), 'player v2 save: Nest warmth x' + st.broodMult.toFixed(3) + ', gold/s ' + st.gps.toFixed(1));
  for (let i = 0; i < 120; i++) E3.tick(s, 0.5);
  const r = E3.offline(s, 4 * 3600);
  check(r.gold > 0 && !finiteDeep(s, 'state') && !finiteDeep(E3.stats(s), 'stats'), 'player v2 save: ticks + 4 h offline finite (+' + H.fmt(r.gold) + ' gold)');
  const back = E3.deserialize(E3.serialize(s));
  check(back.lore.greed === 1 && back.lore.halls === undefined && back.gold === s.gold, 'player v2 save round trip');
}

// ---------------------------------------------------------------- the real player's save, rebuilt by the engine
// (tools/fixtures/v2-player-sleep1.json): Sleep 1, Lore greed:1 + halls:1, 3 Legend, 21 card types and a Volcano Lair
// at quest step 5. It loads (Hunger 1, the retired lair banks 2,500 Ore), and a fresh run plays with the new economy.
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-sleep1.json'), 'utf8');
  const mods = MODS;
  const H = load(mods, disk), E4 = H.engine;
  const s = E4.deserialize(raw), o = JSON.parse(JSON.parse(raw).json);
  check(s.v === 2 && s.sleeps === 1 && s.legend === 3 && s.lore.greed === 1 && s.lore.halls === undefined, 'player save: Sleep 1, 3 Legend, Hunger 1 (from greed:1 halls:1)');
  check(Object.keys(s.cards).length === 21 && JSON.stringify(s.cards) === JSON.stringify(o.cards), 'player save: 21 card types kept');
  check(o.events.lair === 'volcano' && o.events.q === 5 && s.events.q === 5 && s.mines.open === false && s.mines.ore === 2500, 'player save: the Volcano Lair (5 steps) is archived and banks 2,500 Ore in the closed Mines');
  let bought = 0;
  for (let t = 0; t < 1200; t++) { // 10 min of play at 0.5 s: swipe coins, buy what the Lair and Brood offer
    E4.tick(s, 0.5);
    E4.coinCollected(s, 2, 3, 1);
    if (t % 4 === 0) {
      for (const b of H.data.buildings) if (E4.buildingMax(s, b.id) >= 1 && E4.buyBuilding(s, b.id, 1)) bought++;
      for (let i = 0; i < 2; i++) if (E4.tierMax(s, i) >= 1 && E4.buyTier(s, i, 1)) bought++;
    }
  }
  const st = E4.stats(s);
  console.log('player save: 10 min after load bought ' + bought + ', gold/s ' + st.gps.toFixed(1) + ', warmth x' + st.broodMult.toFixed(3));
  check(bought > 10 && st.gps > 0 && st.broodMult >= 1 && !finiteDeep(s, 'state') && !finiteDeep(st, 'stats'), 'player save: 10 min of play buys ' + bought + ', gold/s ' + st.gps.toFixed(1) + ', warmth x' + st.broodMult.toFixed(3));
  const back = E4.deserialize(E4.serialize(s));
  check(back.lore.greed === 1 && back.lore.halls === undefined && Object.keys(back.cards).length >= 21 && back.events.lair === 'volcano' && back.mines.ore === 2500, 'player save: round trip after play (archive kept, no second conversion)');
}

// ---------------------------------------------------------------- the real player's save at Sleep 11, rank 5
// (tools/fixtures/v2-player-rank5-coins.json, the cloud doc's inner json): two "Collect coins" quests (940 from
// base 877, 1200 from base 553) sized by the old fixed-minutes rule sat in two of the three slots. On load they are
// re-sized for the quest pace (progress kept, so both are simply done), no second unfinished activity quest stays,
// and the quests drawn after claiming them are sane.
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-rank5-coins.json'), 'utf8');
  const mods = MODS;
  const H = load(mods, disk), E5 = H.engine, D5 = H.data;
  const o = JSON.parse(raw);
  const s = E5.deserialize(raw);
  const ACT = t => !!(D5.missionTemplates.find(x => x.tpl === t) || {}).act;
  check(s.v === 2 && s.sleeps === 11 && s.rank === 5 && s.rankProgress === 1 && s.missionSeq === 258 && s.legend === o.legend, 'rank-5 save: Sleep 11, rank 5 (1/7), seq 258 kept');
  check(s.missions.length === 3 && s.missions[0].tpl === 'building' && s.missions[0].key === 'mine' && s.missions[0].target === 170, 'rank-5 save: the gold quest (Own 170 Gold Mines) is untouched');
  const coins = s.missions.filter(m => m.tpl === 'coins');
  check(coins.length === 2 && coins[0].base === 877 && coins[1].base === 553, 'rank-5 save: both coins quests kept with their bases (progress kept)');
  check(coins.every(m => m.target < 940 && m.target <= 600), 'rank-5 save: coins targets re-sized (' + coins.map(m => m.target).join(', ') + ' from 940, 1200)');
  const info = [0, 1, 2].map(i => E5.missionInfo(s, i));
  check(info[1].done && info[2].done && !info[0].done, 'rank-5 save: the two coins quests are now done (810 and 1134 coins collected)');
  const unfinishedAct = st => st.missions.filter((m, i) => ACT(m.tpl) && !E5.missionInfo(st, i).done).length;
  check(unfinishedAct(s) <= 1, 'rank-5 save: at most one unfinished activity quest after load');
  const s0 = E5.deserialize(raw);
  for (let i = 0; i < 4; i++) E5.tick(s, 0.5); // Quest Scribe (auto_quest) claims them
  check(s.rankProgress === 3 && s.rank === 5, 'rank-5 save: Quest Scribe claims both (rank progress 1 -> ' + s.rankProgress + ' of 7)');
  check(s.missions.filter(m => ACT(m.tpl)).length <= 1, 'rank-5 save: the new quests hold at most one activity quest (' + s.missions.map(m => m.tpl).join(', ') + ')');
  const st5 = E5.stats(s);
  for (const m of s.missions) {
    if (m.tpl === 'coins') check((m.target / st5.spillRate) <= 240, 'rank-5 save: a new coins quest needs at most 4 min of spill (' + m.target + ' coins at ' + st5.spillRate + '/s)');
    if (m.tpl === 'gusts') check((m.target - 1) * st5.gustCooldown <= 240, 'rank-5 save: a new gusts quest needs at most 4 min of cooldowns');
  }
  check(!finiteDeep(s, 'state'), 'rank-5 save: all numbers finite after load + ticks');
  const back = E5.deserialize(E5.serialize(s0));
  check(JSON.stringify(back.missions) === JSON.stringify(s0.missions), 'rank-5 save: re-sized quests round-trip unchanged (the fix is applied once)');
  // the re-size is applied once even when the pace (and so the cap) has changed by the next load (code review
  // 2026-11: a copy with no coin progress went 940 -> 410 and then -> 190 on a reload at pace 0.02)
  const o2 = JSON.parse(raw); o2.missions.forEach(m => { if (m.tpl === 'coins') m.base = o2.run.coins; });
  const r1 = E5.deserialize(JSON.stringify(o2)), t1 = r1.missions.filter(m => m.tpl === 'coins').map(m => m.target);
  r1.missionPace = 0.02;
  const r2 = E5.deserialize(E5.serialize(r1)), t2 = r2.missions.filter(m => m.tpl === 'coins').map(m => m.target);
  check(t1.length >= 1 && t1[0] < 940 && JSON.stringify(t1) === JSON.stringify(t2) && r2.missions.every(m => m.tpl !== 'coins' || m.T > 0), 'rank-5 save: an unfinished re-sized coins quest keeps its size on the next load (' + t1.join(',') + ' -> ' + t2.join(',') + ')');
}

// ---------------------------------------------------------------- the real player's save right after Ascend 1
// (tools/fixtures/v2-player-post-ascend.json, the cloud doc's inner json, 2026-11-04): Myth 2, Saga Stone I, Legend 10
// from a Dream Keeper Sleep in offline catch-up, a fresh empty run, Ember awake with every Breath, the Volcano Lair
// the Mines keep digging on every tick (pass B): Ore, lifetime Ore and the chain's units only grow; the rest stays
function minesKept(a, b) {
  const same = ['open', 'openAt', 'hired', 'forge', 'depth', 'hearth', 'chestN', 'lastTithe'].every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  return same && b.ore >= a.ore && b.all >= a.all && b.units.every((u, k) => u >= a.units[k]);
}
// done, Dream Keeper on at 50%. It loads with every module (Ember converted to the Mines), keeps everything else,
// and round-trips.
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-post-ascend.json'), 'utf8');
  const mods = MODS;
  const H = load(mods, disk), E6 = H.engine;
  const o = JSON.parse(raw), s = E6.deserialize(raw);
  check(s.v === 2 && s.legend === 10 && s.legendPts === 10 && s.sleeps === 19 && s.myth === 2 && s.mythPts === 1 && s.myths === 1, 'post-Ascend save: Legend 10, 19 Sleeps, Myth 2 (1 to spend), 1 Ascend');
  check(JSON.stringify(s.cards) === JSON.stringify(o.cards) && JSON.stringify(s.lore) === JSON.stringify(o.lore) && JSON.stringify(s.relics) === JSON.stringify(o.relics), 'post-Ascend save: cards, lore and relics kept exactly');
  check(s.auto.sleep === true && s.auto.sleepPct === 50 && H.lore.autoSleepOn(s), 'post-Ascend save: Dream Keeper on at 50%');
  check(s.mines.open === true && s.mines.units[0] === 1075 && s.mines.ore === 52937641 + 5000 && Math.abs(s.mines.hearth - 6.7529) < 1e-4, 'post-Ascend save: Ember became the Mines (1,075 Pick Crews, 52.9M Ore, Hearth x6.75)');
  check(JSON.stringify(s.ember) === JSON.stringify(o.ember) && JSON.stringify(s.events) === JSON.stringify(o.events), 'post-Ascend save: Ember and the Volcano Lair are archived untouched');
  check(s.stat.coins === o.stat.coins && s.stat.sleepsGold === o.stat.sleepsGold && s.earnedAll === o.earnedAll, 'post-Ascend save: lifetime stats kept');
  const back = E6.deserialize(E6.serialize(s));
  check(back.legend === 10 && back.myth === 2 && JSON.stringify(back.cards) === JSON.stringify(o.cards) && JSON.stringify(back.mines) === JSON.stringify(s.mines) && back.auto.sleepPct === 50, 'post-Ascend save: round trip');
  check(!finiteDeep(s, 'state') && !finiteDeep(E6.stats(s), 'stats'), 'post-Ascend save: all numbers finite');
  // Starfall (js/sky.js): the save has no sky subtree; it loads with the defaults and opens on the first tick with the
  // 2-charge gift, changing nothing else
  const SKY0 = { on: false, xp: 0, ch: 0, at: 0, n: 0, caught: 0, stars: 0, best: 0, bestPct: 0, capAt: 0, eCaught: 0, lant: 0, lit: 0, gift: false };
  check(o.sky === undefined && JSON.stringify(s.sky) === JSON.stringify(SKY0), 'post-Ascend save: sky defaults on load ' + JSON.stringify(s.sky));
  H.sky._now = o.savedAt + 60e3;
  const t0 = JSON.parse(E6.serialize(s));
  E6.tick(s, 0.1);
  check(s.sky.on === true && s.sky.ch === 2 && s.sky.gift === true && H.sky.charges(s) === 2, 'post-Ascend save: the night sky opens on the first tick with 2 Starfalls');
  check(s.legend === 10 && s.myth === 2 && s.mythPts === 1 && JSON.stringify(s.relics) === JSON.stringify(o.relics) && JSON.stringify(s.cards) === JSON.stringify(o.cards) &&
    JSON.stringify(s.lore) === JSON.stringify(o.lore) && minesKept(t0.mines, s.mines) && s.auto.sleepPct === 50, 'post-Ascend save: opening the sky changes nothing else (the Mines only dig)');
  const back2 = E6.deserialize(E6.serialize(s));
  check(back2.sky.on === true && back2.sky.ch === 2 && back2.sky.gift === true && back2.legend === 10, 'post-Ascend save: sky round trip');
  H.sky._now = null;
}

// ---------------------------------------------------------------- SPEC-MINES pass A (trim): one-time conversions
// Ember -> the Mines (load hook 'mines'), event lairs retired ('events-retire'), Lore trim ('lore-trim'). Every
// fixture loads; the numbers below are SPEC-MINES A1-A4; gold/s and coin worth stay >= 0.995 x the pre-trim baseline
// (tools/fixtures/baseline-stats.json, measured with ember.js + events.js still loaded); a second load converts nothing
// again and the raw ember / events subtrees survive as archives.
{
  const H = load(MODS, disk), E7 = H.engine;
  const BASE = JSON.parse(fs.readFileSync(path.join(FIX, 'baseline-stats.json'), 'utf8')).fixtures;
  const FORGE_ALL = { pans: 7, sieve: 4, rails: 3, anvil: 2, seam: 1, night: 1, frenzy: 2, heart: 1 };
  const FORGE_NOHEART = Object.assign({}, FORGE_ALL); delete FORGE_NOHEART.heart;
  const WANT = {
    'v2-player-myth4.json': { open: true, hearth: 6.9378, ore: 59348483 + 5000, crews: 1165, forge: FORGE_ALL, lp: 32, ev: [1, 7, 4] },
    'v2-player-post-ascend.json': { open: true, hearth: 6.7529, ore: 52937641 + 5000, crews: 1075, forge: FORGE_ALL, lp: 10 },
    'v2-player-rank5-coins.json': { open: true, hearth: 4.3127, ore: 877525 + 4500, crews: 1583, forge: FORGE_NOHEART, lp: 2728, greed: 6 },
    'v2-player-sleep1.json': { open: false, hearth: 1, ore: 2500, crews: 0, forge: {}, lp: 0, greed: 1 }
  };
  const sorted = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
  const all = fs.readdirSync(FIX).filter(f => /^v[12]-.*\.json$/.test(f)).sort();
  check(all.indexOf('v2-player-myth4.json') >= 0 && Object.keys(BASE).length === all.length, 'every fixture has a pre-trim baseline (' + all.length + ')');
  for (const f of all) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
    const o = E7.deserialize(raw) && JSON.parse(JSON.parse(raw).json || raw);
    let s = null, threw = null;
    try { s = E7.deserialize(raw); } catch (e) { threw = e; }
    check(!threw && s && s.v === 2 && s.missions.length === 3 && !finiteDeep(s, 'state'), f + ': loads with every module' + (threw ? ' (threw ' + threw + ')' : ''));
    if (!s) continue;
    const w = WANT[f] || { open: false, hearth: 1, ore: 0, crews: 0, forge: {}, lp: BASE[f].legendPts };
    const m = s.mines;
    check(s.flags.minesConv === 1 && s.flags.eventsConv === 1 && s.flags.loreTrim1 === 1, f + ': conversion flags set');
    check(m.open === w.open && Math.abs(m.hearth - w.hearth) < 1e-4 && m.ore === w.ore && m.units[0] === w.crews && m.units.slice(1).join() === '0,0,0' && m.hired.join() === '0,0,0,0',
      f + ': Mines ' + JSON.stringify({ open: m.open, hearth: +m.hearth.toFixed(4), ore: m.ore, crews: m.units[0] }) + ' want ' + JSON.stringify({ open: w.open, hearth: w.hearth, ore: w.ore, crews: w.crews }));
    check(sorted(m.forge) === sorted(w.forge), f + ': Forge levels ' + JSON.stringify(m.forge));
    check(m.all === 0 && m.peak === 0 && m.depth === 0, f + ': converted Ore is not lifetime Ore (glow x1.00)');
    check(s.legendPts === w.lp, f + ': legendPts ' + BASE[f].legendPts + ' -> ' + s.legendPts + ' (want ' + w.lp + ')');
    if (w.greed !== undefined) check(s.lore.greed === w.greed, f + ': Dragon\'s Hunger ' + s.lore.greed);
    for (const id of ['halls', 'clutches', 'bargain', 'keep_claws', 'keep_broom', 'start_brood']) check(s.lore[id] === undefined, f + ': cut Lore ' + id + ' removed');
    if (w.ev) check(['ev_obsidianheart', 'ev_magmatalon', 'ev_cindercrown'].map(k => s.cards[k] || 0).join() === w.ev.join(), f + ': event cards kept as Deep cards');
    if (isObj(o.cards)) check(Object.keys(o.cards).every(k => s.cards[k] >= o.cards[k]), f + ': no card copies lost');
    const st = E7.stats(s), b = BASE[f];
    check(st.gps >= 0.995 * b.gps - 1e-9 && st.coinWorth >= 0.995 * b.coinWorth - 1e-9, f + ': gold/s ' + st.gps.toPrecision(5) + ' (was ' + b.gps.toPrecision(5) + '), coin worth ' + st.coinWorth.toPrecision(5) + ' (was ' + b.coinWorth.toPrecision(5) + ')');
    if (f === 'v2-player-myth4.json') {
      check(Math.abs(st.gps / b.gps - 1) < 1e-9, 'live save: gold/s unchanged (Hearth = the old warmth)');
      check(Math.abs(st.coinWorth / 7.946e6 - 1) < 1e-3 && Math.abs(st.strokeWorth / 1.192e7 - 1) < 1e-3, 'live save: coin worth 7.946M (Gilded Pans 7) and stroke 11.92M (' + st.coinWorth.toPrecision(4) + ', ' + st.strokeWorth.toPrecision(4) + ')');
    }
    // a second load: the flags hold, nothing converts twice, the archives are untouched
    const json = E7.serialize(s), back = JSON.parse(json), s2 = E7.deserialize(json);
    check(JSON.stringify(s2.mines) === JSON.stringify(s.mines) && s2.legendPts === s.legendPts && JSON.stringify(s2.cards) === JSON.stringify(s.cards) && JSON.stringify(s2.lore) === JSON.stringify(s.lore), f + ': loading twice converts once');
    check(JSON.stringify(back.ember) === JSON.stringify(o.ember) && JSON.stringify(back.events) === JSON.stringify(o.events), f + ': raw ember / events archived as they were');
    // play: ticks + 8 h away stay finite
    for (let i = 0; i < 20; i++) E7.tick(s2, 0.5);
    E7.offline(s2, 8 * 3600);
    check(!finiteDeep(s2, 'state') && !finiteDeep(E7.stats(s2), 'stats'), f + ': finite after ticks + 8 h offline');
  }
  // synthetic Ember: kiln milestones, Deep Veins (r_ember) and one Kindle; an Ember that never woke converts nothing
  const fresh = JSON.parse(E7.serialize(E7.newState()));
  const a = Object.assign({}, fresh, { relics: { r_ember: 1 }, ember: { awake: true, embers: 12, earned: 1e6, kilns: [300, 0, 0, 0], breaths: { kindle: true } } });
  const sa = E7.deserialize(JSON.stringify(a));
  check(sa.mines.open && sa.mines.units[0] === 3840 && sa.mines.ore === 2 && sorted(sa.mines.forge) === '{"rails":1}' && Math.abs(sa.mines.hearth - (1 + 0.15 * Math.pow(Math.log10(1 + 1e6), 1.6))) < 1e-9, 'synthetic Ember: 300 Coal Kilns + Kindle + Deep Veins -> 3,840 Pick Crews, Rails 1 (' + JSON.stringify(sa.mines) + ')');
  check(Math.abs(sa.mines.units[0] * H.mines.unitEach(sa, 0) - 300 * 0.1 * 64 * 2 * 3 / 5) < 1, 'synthetic Ember: the crews dig what the kilns burned, at 5 embers per Ore');
  const sb = E7.deserialize(JSON.stringify(Object.assign({}, fresh, { ember: { awake: false, embers: 99, kilns: [3, 0, 0, 0] } })));
  check(!sb.mines.open && sb.mines.ore === 0 && sb.mines.units[0] === 0 && sb.flags.minesConv === 1, 'synthetic Ember asleep: nothing converted, flag set');
  // synthetic event lairs: unopened chests and a finished-but-unclaimed step pay out their cards
  const ev = { firstStart: 1, lair: 'frost', q: 10, chests: 2, chestCards: [1, 3], units: [0, 0, 0, 0], earned: 0, coins: 0 };
  const sc = E7.deserialize(JSON.stringify(Object.assign({}, fresh, { events: ev })));
  const frost = ['ev_glacierheart', 'ev_frostfang', 'ev_rimefeather'];
  const nFrost = frost.reduce((t, k) => t + (sc.cards[k] || 0), 0);
  check(nFrost === 4 && frost.every(k => sc.cards[k] >= 1) && sc.mines.ore === 5000, 'synthetic lair: 2 unopened chests (1 + all 3) give 4 Frozen Peak cards, +5,000 Ore (' + JSON.stringify(sc.cards) + ')');
  const sd = E7.deserialize(JSON.stringify(Object.assign({}, fresh, { events: { firstStart: 1, lair: 'sea', q: 2, chests: 0, units: [40, 1, 0, 0] } })));
  check(sd.cards.ev_krakenink === 1 && sd.mines.ore === 1000, 'synthetic lair: the finished step 3 (hire a Sea Serpent) gives its guaranteed Kraken Ink, +1,000 Ore');
  const se = E7.deserialize(E7.serialize(sd));
  check(se.cards.ev_krakenink === 1 && se.mines.ore === 1000, 'synthetic lair: reloading pays nothing twice');
  check(H.data.cards.length === 29 && H.mines.DEEP_CARDS.length === 9 && H.mines.DEEP_CARDS.every(c => c.chest === false && H.data.cards.indexOf(c) >= 0), '29 cards: the 9 Deep cards stay registered, never in normal chests');
}

console.log((fails ? fails + ' FAILURES, ' : '') + passes + ' checks passed');
console.log(fails ? 'SAVE-COMPAT FAILED' : 'SAVE-COMPAT OK');
process.exitCode = fails ? 1 : 0;
