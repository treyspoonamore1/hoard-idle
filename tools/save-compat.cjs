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
  check(s.stat.playActive === 0 && s.stat.fastestSleep === 0 && s.run.playActive === 0, label + name + ': new stat fields default to 0');
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
    for (const k of ['gps', 'baseGps', 'coinWorth', 'strokeWorth', 'spillRate', 'sweepRate', 'sweepGps', 'gustCooldown', 'gustWorthMult', 'maxStreak', 'offlineCapHours', 'legendMult'])
      check(sa[k] === sb[k], f + ': stats.' + k + ' v1=' + sa[k] + ' v2=' + sb[k]);
    check(JSON.stringify(sa.tierRates) === JSON.stringify(sb.tierRates) && JSON.stringify(sa.treasureInterval) === JSON.stringify(sb.treasureInterval) && JSON.stringify(sa.buildingGps) === JSON.stringify(sb.buildingGps), f + ': tierRates/treasureInterval/buildingGps identical');
    for (const id of Object.keys(a.buildings)) check(JSON.stringify(V1.engine.buildingCost(a, id, 10)) === JSON.stringify(V2.engine.buildingCost(b, id, 10)), f + ': buildingCost(' + id + ',10) identical');
    for (let i = 0; i < 5; i++) check(JSON.stringify(V1.engine.tierCost(a, i, 'max')) === JSON.stringify(V2.engine.tierCost(b, i, 'max')), f + ': tierCost(' + i + ',max) identical');
    check(V1.engine.legendOnSleep(a) === V2.engine.legendOnSleep(b), f + ': legendOnSleep identical');
    const oa = V1.engine.offline(a, 7200), ob = V2.engine.offline(b, 7200);
    check(oa.gold === ob.gold && JSON.stringify(oa.minions) === JSON.stringify(ob.minions), f + ': offline(2h) identical ' + oa.gold + ' vs ' + ob.gold);
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

console.log((fails ? fails + ' FAILURES, ' : '') + passes + ' checks passed');
console.log(fails ? 'SAVE-COMPAT FAILED' : 'SAVE-COMPAT OK');
process.exitCode = fails ? 1 : 0;
