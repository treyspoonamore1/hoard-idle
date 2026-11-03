// Save compatibility test: v1 saves (fixtures made by the v1 engine from git main) must load in the v2 engine.
// Usage: node tools/save-compat.cjs        (regenerate fixtures with: node tools/gen-v1-fixtures.cjs)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const root = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
let fails = 0, passes = 0;
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
  const mods = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/events.js', 'js/ember.js'].filter(f => fs.existsSync(path.join(root, f)));
  const H = load(mods, disk);
  for (const f of fixtures) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8').trim();
    compareLoad(H, f, raw, '[all modules] ');
  }
}

// ---------------------------------------------------------------- the real player's case: a v2 save right after
// Sleep 1 with Lore greed:1 + halls:1 (written by the pre-feel-pass engine) loads, plays and keeps its Lore
{
  const mods = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/events.js', 'js/ember.js'].filter(f => fs.existsSync(path.join(root, f)));
  const H = load(mods, disk), E3 = H.engine;
  const raw = fs.readFileSync(path.join(FIX, 'v1-postsleep.json'), 'utf8');
  const o = JSON.parse(raw);
  Object.assign(o, { v: 2, legend: 3, legendPts: 0, lore: { greed: 1, halls: 1 }, relics: {}, flags: {}, auto: {}, myth: 0, mythPts: 0, myths: 0, sleeps: 1 });
  o.tiers = [1200, 30, 2, 0, 0]; o.buildings = Object.assign({}, o.buildings, { digger: 22, raid: 6 });
  const v2raw = JSON.stringify(o);
  const s = E3.deserialize(v2raw);
  check(s.v === 2 && !s._migratedFrom && s.lore.greed === 1 && s.lore.halls === 1 && s.legend === 3 && s.legendPts === 0 && s.sleeps === 1, 'player v2 save (Sleep 1, greed:1 halls:1) loads with its Lore');
  check(JSON.stringify(s.tiers) === JSON.stringify(o.tiers) && s.buildings.digger === 22 && s.gold === o.gold, 'player v2 save keeps gold, brood and buildings');
  const st = E3.stats(s);
  check(st.broodMult > 1 && st.gps > 0 && !finiteDeep(st, 'stats'), 'player v2 save: Nest warmth x' + st.broodMult.toFixed(3) + ', gold/s ' + st.gps.toFixed(1));
  for (let i = 0; i < 120; i++) E3.tick(s, 0.5);
  const r = E3.offline(s, 4 * 3600);
  check(r.gold > 0 && !finiteDeep(s, 'state') && !finiteDeep(E3.stats(s), 'stats'), 'player v2 save: ticks + 4 h offline finite (+' + H.fmt(r.gold) + ' gold)');
  const back = E3.deserialize(E3.serialize(s));
  check(back.lore.greed === 1 && back.lore.halls === 1 && back.gold === s.gold, 'player v2 save round trip');
}

// ---------------------------------------------------------------- the real player's save, rebuilt by the engine
// (tools/fixtures/v2-player-sleep1.json): Sleep 1, Lore greed:1 + halls:1, 3 Legend, 21 card types and a Volcano Lair
// running. It loads, keeps everything, the lair stays live, and a fresh run plays with the new economy.
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-sleep1.json'), 'utf8');
  const mods = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/events.js', 'js/ember.js'];
  const H = load(mods, disk), E4 = H.engine, X = H.events;
  const s = E4.deserialize(raw), o = JSON.parse(JSON.parse(raw).json);
  check(s.v === 2 && s.sleeps === 1 && s.legend === 3 && s.lore.greed === 1 && s.lore.halls === 1, 'player save: Sleep 1, 3 Legend, greed:1 halls:1');
  check(Object.keys(s.cards).length === 21 && JSON.stringify(s.cards) === JSON.stringify(o.cards), 'player save: 21 card types kept');
  check(s.events && s.events.lair === 'volcano' && s.events.q === 5, 'player save: Volcano Lair with 5 quest steps');
  X._now = s.events.start + 3600e3;
  X.sync(s);
  check(X.active(s) && s.events.lair === 'volcano' && s.events.q === 5, 'player save: Volcano Lair still running after sync');
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
  check(back.lore.greed === 1 && back.lore.halls === 1 && Object.keys(back.cards).length >= 21 && back.events.lair === 'volcano', 'player save: round trip after play');
}

// ---------------------------------------------------------------- the real player's save at Sleep 11, rank 5
// (tools/fixtures/v2-player-rank5-coins.json, the cloud doc's inner json): two "Collect coins" quests (940 from
// base 877, 1200 from base 553) sized by the old fixed-minutes rule sat in two of the three slots. On load they are
// re-sized for the quest pace (progress kept, so both are simply done), no second unfinished activity quest stays,
// and the quests drawn after claiming them are sane.
{
  const raw = fs.readFileSync(path.join(FIX, 'v2-player-rank5-coins.json'), 'utf8');
  const mods = ['js/data.js', 'js/engine.js', 'js/lore.js', 'js/events.js', 'js/ember.js'];
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

console.log((fails ? fails + ' FAILURES, ' : '') + passes + ' checks passed');
console.log(fails ? 'SAVE-COMPAT FAILED' : 'SAVE-COMPAT OK');
process.exitCode = fails ? 1 : 0;
