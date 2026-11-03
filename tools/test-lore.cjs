// Lore / Myth / Relics / automation tests (SPEC-V2 section 1). Loads data.js + engine.js + lore.js in a vm sandbox.
// Usage: node tools/test-lore.cjs        (exit code 1 on any failure)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function finiteDeep(o, p) {
  if (typeof o === 'number') return isFinite(o) ? null : p;
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { const r = finiteDeep(o[k], p + '.' + k); if (r) return r; }
  return null;
}
function load(extra) {
  let seed = 4242;
  const sb = { console, Date, JSON, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['js/data.js', 'js/engine.js', 'js/lore.js'].concat(extra || [])) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  }
  return sb.HOARD;
}
const H = load(), E = H.engine, D = H.data, L = H.lore;
const events = [];
['lore', 'myth', 'sleep'].forEach(n => E.on(n, p => events.push([n, p])));
const lastEv = n => { for (let i = events.length - 1; i >= 0; i--) if (events[i][0] === n) return events[i][1]; return undefined; };
function fresh() { const s = E.newState(); return s; }
function noBad(s, label) {
  const b = finiteDeep(s, 'state') || finiteDeep(E.stats(s), 'stats');
  check(!b, label + ': no NaN/Infinity (' + b + ')');
  const back = JSON.parse(E.serialize(s));
  check(back.legend === s.legend && back.legendPts === s.legendPts && back.myth === s.myth, label + ': save keeps legend/myth numbers');
}

// ---------------------------------------------------------------- content
check(!!L && typeof L.buy === 'function', 'HOARD.lore exists');
const specIds = ['auto_dig', 'auto_build', 'auto_brood', 'auto_quest', 'auto_chest', 'auto_gust', 'auto_upg', 'auto_sleep',
  'start_gold', 'keep_claws', 'keep_broom', 'start_rank', 'start_brood',
  'greed', 'halls', 'clutches', 'talons', 'magpie', 'dreams', 'watch', 'bargain', 'wake_ember', 'myth_gate'];
specIds.forEach(id => check(!!L.node(id), 'node ' + id + ' exists'));
['r_legend', 'r_start', 'r_keep', 'r_cards', 'r_ember', 'r_time'].forEach(id => check(!!L.relic(id), 'relic ' + id + ' exists'));
check(L.nodes.filter(n => !n.req && L.costAt(n, 0) <= 2).length >= 3, 'at least 3 first nodes cost 1-2 Legend');
check(L.nodes.every(n => typeof n.desc === 'function' && L.describe(n.id, 1).length > 5), 'every node describes itself');
check(L.nodes.every(n => !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(n.name + L.describe(n.id, 1))), 'no emoji in node text');
const reqs = { auto_build: 'auto_dig', auto_chest: 'auto_quest', auto_upg: 'auto_build', auto_sleep: 'auto_upg' };
Object.keys(reqs).forEach(id => check(L.node(id).req === reqs[id], id + ' requires ' + reqs[id]));
check(L.node('greed').max === 15 && L.node('talons').max === 3 && L.node('start_gold').max === 4 && L.node('start_rank').max === 2, 'max levels per spec');

// ---------------------------------------------------------------- buying
{
  const s = fresh();
  check(!L.canBuy(s, 'auto_dig') && !L.buy(s, 'auto_dig'), 'cannot buy with 0 Legend');
  s.legend = 10; s.legendPts = 10;
  const gps0 = E.stats(s).gps;
  check(L.buy(s, 'auto_dig'), 'buy auto_dig');
  check(L.level(s, 'auto_dig') === 1 && s.legendPts === 8 && s.legend === 10, 'auto_dig: level 1, 2 points spent, legend unchanged');
  check(lastEv('lore') && lastEv('lore').id === 'auto_dig' && lastEv('lore').level === 1, "'lore' event emitted");
  check(!L.buy(s, 'auto_dig'), 'one-level node cannot be bought twice');
  check(!L.canBuy(s, 'auto_upg'), 'auto_upg locked without auto_build');
  check(L.buy(s, 'auto_build') && L.level(s, 'auto_build') === 1 && s.legendPts === 2, 'auto_build after auto_dig (6)');
  check(Math.abs(E.stats(s).gps - gps0) < 1e-9, 'Legend passive bonus unchanged by spending');
  s.legendPts = 1e9;
  for (let i = 0; i < 40; i++) L.buy(s, 'greed');
  check(L.level(s, 'greed') === 15 && L.cost(s, 'greed') === null, 'greed caps at 15');
  check(L.buy(s, 'wake_ember') && s.lore.wake_ember === 1, 'wake_ember sets state.lore.wake_ember = 1');
  // garbage levels
  const g = fresh(); g.lore = { greed: 'x', halls: -3, clutches: NaN, dreams: 2.7, talons: Infinity };
  check(L.level(g, 'greed') === 0 && L.level(g, 'halls') === 0 && L.level(g, 'clutches') === 0 && L.level(g, 'dreams') === 2, 'garbage levels read as 0 / floored');
  let threw = false; try { E.stats(g); L.cost(g, 'talons'); L.anyAffordable(g); E.tick(g, 1); } catch (e) { threw = e; }
  check(!threw, 'garbage lore does not throw (' + threw + ')');
  check(!L.buy(null, 'greed') && !L.buy(s, 'nope') && L.cost(s, 'nope') === null, 'unknown ids / null state are safe');
}

// ---------------------------------------------------------------- modifiers
{
  const s = fresh();
  s.rank = 6; s.buildings.digger = 50; s.buildings.raid = 20; s.tiers = [1000, 50, 10, 0, 0];
  s.earnedRun = 4e8; E.dirty();
  const a = E.stats(s), cw = a.coinWorth, gps = a.gps, cost = E.buildingCost(s, 'digger', 1).gold, leg = E.legendOnSleep(s);
  const cap = a.offlineCapHours, tr = a.M.treasureFreq, egg = a.tierRates[0];
  s.lore = { greed: 2, halls: 2, clutches: 2, bargain: 2, dreams: 2, watch: 2, talons: 1, magpie: 2 };
  E.dirty();
  const b = E.stats(s);
  check(b.coinWorth > cw * 1.4, 'greed raises coin worth (' + (b.coinWorth / cw).toFixed(2) + 'x)');
  check(Math.abs(b.gps / gps - 1.5) < 1e-6, 'halls 2 = building gold/s x1.5 (' + (b.gps / gps) + ')');
  check(b.tierRates[0] > egg * 1.4, 'clutches raise minion output');
  check(Math.abs(E.buildingCost(s, 'digger', 1).gold / cost - 0.81) < 1e-6, 'bargain 2 = cost x0.81');
  check(E.legendOnSleep(s) > leg, 'dreams raise Legend gain (' + leg + ' -> ' + E.legendOnSleep(s) + ')');
  check(b.offlineCapHours === cap + 8 && Math.abs(b.offlineMult - 1.15 * 1.15) < 1e-9, 'watch 2: +8h cap, x1.3225 offline');
  check(b.M.streakHigh === true && b.streakRamp === 1.5, 'talons 1: x8 cap and 1.5x ramp');
  check(Math.abs(b.M.treasureFreq / tr - 1.5) < 1e-9 && b.M.frenzyDurAdd >= 16, 'magpie 2: treasures +50%, Frenzy +16s');
  const e = L.effect(s, 'halls');
  check(e && e.now === '×1.5' && e.next === '×1.75', 'effect() now/next strings (' + JSON.stringify(e) + ')');
  // Myth multiplier + relics
  s.myth = 2; s.relics = { r_legend: 1, r_cards: 1, r_time: 1 }; E.dirty();
  const c = E.stats(s);
  check(Math.abs(c.gps / b.gps - 2.25) < 1e-6, 'Myth 2 = gold/s x2.25');
  check(c.M.chestCardsAdd === 1 && c.offlineCapHours === b.offlineCapHours + 12 && Math.abs(c.offlineMult / b.offlineMult - 2) < 1e-9, 'Gilded Chests / Timeless Sleep');
  check(E.legendOnSleep(s) >= 2 * E.legendOnSleep(Object.assign(E.deserialize(E.serialize(s)), { relics: {} })) - 1, 'Saga Stone doubles Legend gain');
  noBad(s, 'modifiers');
}

// ---------------------------------------------------------------- Long Sleep with head starts
{
  const s = fresh();
  s.legend = 50; s.legendPts = 200;
  ['start_gold', 'start_gold', 'keep_claws', 'keep_broom', 'start_rank', 'start_brood'].forEach(id => check(L.buy(s, id), 'buy ' + id));
  s.upgrades.claws1 = true; s.upgrades.scales1 = true; s.upgrades.broom1 = true; s.upgrades.wings1 = true;
  s.earnedRun = 7e7; s.gold = 1e6; s.buildings.digger = 30; s.rank = 6; s.chests = 2; s.cards = { [D.cards[0].id]: 3 };
  s.run.playActive = 5000;
  const g = E.sleep(s);
  check(g === 6 && lastEv('sleep') === 6, 'sleep gains floor(3.2 * cbrt(7)) = 6 Legend');
  check(s.legend === 56 && s.legendPts === 200 - 1 - 4 - 3 - 3 - 5 - 4 + 6, 'Sleep adds gain to legend and legendPts (' + s.legend + '/' + s.legendPts + ')');
  check(s.gold === 5e4, 'Buried Cache II: run starts with 50K gold (' + s.gold + ')');
  check(s.rank === 3, 'Old Renown I: run starts at rank 3');
  check(s.upgrades.claws1 && s.upgrades.scales1 && s.upgrades.broom1 && !s.upgrades.wings1, 'claws/scales/broom kept, wings reset');
  check(s.tiers[0] === 300 && s.tiers[1] === 25 && s.buildings.digger === 0, 'Nest Egg: 300 Eggs + 25 Wyrmlings');
  check(s.chests === 3 && s.cards[D.cards[0].id] === 3, 'cards and chests kept (+1 chest)');
  check(L.level(s, 'start_gold') === 2 && L.level(s, 'keep_claws') === 1, 'lore kept through Sleep');
  check(s.missions.length === 3, 'missions regenerated');
  noBad(s, 'sleep');
  // head start bought early in a run applies at once
  const t = fresh(); t.legendPts = 10;
  L.buy(t, 'start_gold');
  check(t.gold === 500, 'Buried Cache bought on a fresh run gives 500 gold now');
  L.buy(t, 'start_rank');
  check(t.rank === 3, 'Old Renown bought on a fresh run raises rank now');
  const u = fresh(); u.legendPts = 10; u.run.playActive = 4000; u.earnedRun = 1e6; u.gold = 7;
  L.buy(u, 'start_gold');
  check(u.gold === 7, 'Buried Cache bought mid-run waits for the next run');
}

// ---------------------------------------------------------------- automation (live ticks)
function tickN(s, n, dt) { for (let i = 0; i < n; i++) E.tick(s, dt || 0.5); }
{
  const s = fresh(); s.gold = 1e4;
  tickN(s, 4);
  check(s.buildings.digger === 0, 'no automation without lore');
  s.lore.auto_dig = 1; E.dirty();
  tickN(s, 4);
  const d1 = s.buildings.digger;
  check(d1 > 5, 'Kobold Foremen buys diggers (' + d1 + ')');
  check(s.gold > 0, 'Foremen keep some gold');
  s.auto.master = false; s.gold = 1e5; tickN(s, 4);
  check(s.buildings.digger === d1, 'master switch off stops automation');
  s.auto.master = true; s.auto['b:digger'] = false; tickN(s, 4);
  check(s.buildings.digger === d1, 'per-building toggle off stops it');
  s.auto['b:digger'] = true; s.auto['n:auto_dig'] = false; tickN(s, 4);
  check(s.buildings.digger === d1, 'per-node toggle off stops it');
  delete s.auto['n:auto_dig'];
  // Master Builders: all unlocked buildings
  s.lore.auto_build = 1; s.rank = 3; s.gold = 1e7; s.tiers = [5000, 500, 0, 0, 0]; E.dirty();
  tickN(s, 20);
  check(s.buildings.raid > 0 && s.buildings.mine > 0, 'Master Builders buys raids and mines (' + s.buildings.raid + '/' + s.buildings.mine + ')');
  check(s.buildings.tower === 0, 'locked buildings not bought');
  // Brood Matron: minions, at most 50% of gold/s on average
  const b = fresh(); b.rank = 3; b.buildings.digger = 100; b.buildings.raid = 20; b.gold = 0; b.lore.auto_brood = 1; b.tiers = [50, 0, 0, 0, 0];
  const st = E.stats(b), T = 60;
  tickN(b, T * 2, 0.5);
  const spent = st.baseGps * T - b.gold;     // income minus what is left (minions are the only spending)
  check(b.tiers[1] > 0 || b.tiers[0] > 50, 'Brood Matron buys minions (' + b.tiers.map(Math.round).join('/') + ')');
  check(spent <= 0.5 * st.baseGps * T * 1.05 + 1e-6, 'Brood Matron spends <= 50% of gold/s (' + Math.round(spent) + ' of ' + Math.round(st.baseGps * T) + ')');
  b.auto['t:0'] = false; b.auto['t:1'] = false; const before = b.tiers.slice(); b.gold = 1e9; tickN(b, 10);
  check(b.tiers[1] <= before[1] + 1e-6, 'per-tier toggle off stops that tier');
  // Quest Scribe + Chest Kobold
  const q = fresh(); q.lore.auto_quest = 1; q.lore.auto_chest = 1;
  q.missions[0] = { uid: 999, tpl: 'building', key: 'digger', target: 1, base: 0, done: false };
  q.buildings.digger = 3;
  const c0 = q.chests, rp = q.rankProgress, cards0 = Object.keys(q.cards).length;
  tickN(q, 4);
  check(q.rankProgress === rp + 1 || q.rank > 1, 'Quest Scribe claims a finished quest');
  check(q.chests === 0 && Object.keys(q.cards).length > cards0, 'Chest Kobold opens chests (' + c0 + ' -> ' + q.chests + ')');
  const notes = L.drainNotes();
  check(notes.some(n => n.kind === 'chest' && n.data.cards.length >= 2), 'chest summary note for the UI toast');
  // Lair Steward
  const u = fresh(); u.lore.auto_upg = 1; u.gold = 1e6; u.buildings.digger = 12; E.dirty();
  tickN(u, 4);
  check(Object.keys(u.upgrades).length >= 3, 'Lair Steward buys upgrades (' + Object.keys(u.upgrades).join(',') + ')');
  // Dream Keeper
  const k = fresh(); k.lore.auto_sleep = 1; k.legend = 10; k.legendPts = 0; k.earnedRun = 3.1e8; // gain floor(3.2 * cbrt(31)) = 10 = 100%
  tickN(k, 4);
  check(k.sleeps === 0, 'Dream Keeper is off until its toggle is on');
  k.auto.sleep = true; k.auto.sleepPct = 150; tickN(k, 4);
  check(k.sleeps === 0, 'Dream Keeper waits for gain >= 150%');
  k.auto.sleepPct = 100; tickN(k, 4);
  check(k.sleeps === 1 && k.legend === 20 && k.legendPts === 10, 'Dream Keeper sleeps at gain >= 100%');
  check(L.autoSleepPct({ auto: { sleepPct: 9999 } }) === 300 && L.autoSleepPct({ auto: { sleepPct: 1 } }) === 50 && L.autoSleepPct({ auto: {} }) === 100, 'sleep slider clamps 50-300%');
  noBad(s, 'automation'); noBad(b, 'brood'); noBad(k, 'dream keeper');
}

// ---------------------------------------------------------------- offline()
{
  const mk = () => { const s = fresh(); s.rank = 4; s.buildings.digger = 40; s.buildings.raid = 15; s.buildings.mine = 5; s.tiers = [2000, 60, 5, 0, 0]; s.gold = 1000; return s; };
  const a = mk(), b = mk();
  b.lore = { auto_dig: 1, auto_build: 1, auto_brood: 1, auto_upg: 1, auto_quest: 1, auto_chest: 1 };
  const ra = E.offline(a, 4 * 3600), rb = E.offline(b, 4 * 3600);
  const cnt = s => D.buildings.reduce((n, x) => n + s.buildings[x.id], 0);
  check(cnt(a) === 60 && Object.keys(a.upgrades).length === 0, 'offline without automation buys nothing');
  check(cnt(b) > cnt(a) + 20, 'offline automation buys buildings (' + cnt(a) + ' -> ' + cnt(b) + ')');
  check(Object.keys(b.upgrades).length > 0, 'offline automation buys upgrades');
  check(E.stats(b).baseGps > E.stats(a).baseGps * 2, 'offline automation compounds income (' + Math.round(E.stats(a).baseGps) + ' vs ' + Math.round(E.stats(b).baseGps) + ')');
  check(ra.seconds === 4 * 3600 && rb.seconds === 4 * 3600 && isFinite(rb.gold), 'offline report sane');
  // Long Watch extends the cap
  const w = mk(); w.lore.watch = 2;
  check(E.offline(w, 20 * 3600).seconds === 16 * 3600, 'Long Watch 2: offline cap 16h');
  // Dream Keeper offline
  const k = mk(); k.lore = { auto_sleep: 1, auto_dig: 1, auto_build: 1 }; k.auto.sleep = true; k.auto.sleepPct = 25; k.legend = 2; k.earnedRun = 9.9e6;
  E.offline(k, 3600);
  check(k.sleeps >= 1, 'Dream Keeper sleeps offline');
  noBad(a, 'offline a'); noBad(b, 'offline b'); noBad(k, 'offline k');
}

// ---------------------------------------------------------------- Myth / Ascend / Relics
{
  const s = fresh();
  const need = L.mythNeed(s);
  check(need === L.MYTH.minLegend, 'first Myth needs minLegend (' + need + ')');
  s.legend = need; s.legendPts = 1e9;
  check(!L.canAscend(s) && L.ascend(s) === 0, 'no Ascend without The First Myth');
  ['auto_dig', 'auto_build', 'auto_quest', 'wake_ember', 'myth_gate'].forEach(id => L.buy(s, id));
  for (let i = 0; i < 8; i++) L.buy(s, 'greed');
  L.buy(s, 'start_gold'); L.buy(s, 'keep_claws');
  check(L.canAscend(s) && L.mythOnAscend(s) === 1, 'Ascend at the need gives 1 Myth');
  s.legend = need * 3; check(L.mythOnAscend(s) === 2, 'x3 beyond the need gives 2');
  s.legend = need * 9; check(L.mythOnAscend(s) === 3 && L.mythNextAt(s) === need * 27, 'x9 gives 3, next at x27');
  s.legend = need * 2.9; check(L.mythOnAscend(s) === 1, 'just under x3 still 1');
  s.cards = { [D.cards[1].id]: 6 }; s.chests = 4; s.buildings.digger = 99; s.gold = 1e12; s.sleeps = 9;
  s.stat.coins = 1234;
  const g = L.ascend(s);
  check(g === 1 && lastEv('myth') === 1, "Ascend returns gained Myth and emits 'myth'");
  check(s.legend === 0 && s.legendPts === 0 && s.myth === 1 && s.mythPts === 1 && s.myths === 1, 'Ascend: Legend reset, Myth +1');
  check(L.level(s, 'auto_dig') && L.level(s, 'auto_build') && L.level(s, 'auto_quest'), 'automation kept');
  check(s.lore.wake_ember === 1 && L.level(s, 'myth_gate') === 1, 'unlocks kept (Ember stays awake)');
  check(!L.level(s, 'greed') && !L.level(s, 'start_gold') && !L.level(s, 'keep_claws'), 'power and head start reset');
  check(s.cards[D.cards[1].id] === 6 && s.chests >= 4 && s.sleeps === 9 && s.stat.coins === 1234, 'cards, chests, sleeps, stats kept');
  check(s.buildings.digger === 0 && s.gold < 1e6 && s.rank === 1, 'run reset');
  check(L.mythNeed(s) === need * L.MYTH.grow, 'next Myth needs x' + L.MYTH.grow);
  check(Math.abs(L.mythMult(s) - 1.5) < 1e-12, 'Myth 1 = x1.5');
  // relics
  s.mythPts = 20;
  check(L.buyRelic(s, 'r_legend') && L.relicLevel(s, 'r_legend') === 1 && s.mythPts === 19, 'Saga Stone I for 1 Myth');
  check(L.buyRelic(s, 'r_start') && L.buyRelic(s, 'r_keep'), 'Ancestral Lair + Unfading Lore');
  check(!L.buyRelic(s, 'r_start'), 'one-level relic cannot be bought twice');
  check(s.rank === 5 && s.buildings.digger === 10, 'Ancestral Lair on a fresh run: rank 5 and 10 of every unlocked building now');
  s.earnedRun = 1e7; E.sleep(s);
  check(s.rank === 5 && s.buildings.well === 10 && s.buildings.moon === 0, 'Ancestral Lair after Sleep: rank 5, 10 of each unlocked');
  // r_keep keeps 25% of power through Ascend
  s.legendPts = 1e9; s.legend = L.mythNeed(s); for (let i = 0; i < 9; i++) L.buy(s, 'halls'); L.buy(s, 'talons'); L.buy(s, 'start_gold');
  L.ascend(s);
  check(L.level(s, 'halls') === 2 && !L.level(s, 'talons') && !L.level(s, 'start_gold'), 'Unfading Lore keeps floor(25%) of Power');
  check(s.myths === 2 && L.mythNeed(s) === need * L.MYTH.grow * L.MYTH.grow, 'need grows per Ascend');
  noBad(s, 'myth');
}

// ---------------------------------------------------------------- serialize round-trip
{
  const s = fresh();
  s.legend = 120; s.legendPts = 40; s.myth = 3; s.mythPts = 2; s.myths = 2;
  s.lore = { auto_dig: 1, greed: 4, start_gold: 2, wake_ember: 1 }; s.relics = { r_legend: 2, r_cards: 1 };
  s.auto = { master: false, 'b:raid': false, 't:2': false, sleep: true, sleepPct: 175 };
  s.buildings.digger = 12; s.rank = 3; E.dirty();
  const j = E.serialize(s), t = E.deserialize(j);
  check(JSON.stringify(t.lore) === JSON.stringify(s.lore) && JSON.stringify(t.relics) === JSON.stringify(s.relics), 'lore/relics round-trip');
  check(JSON.stringify(t.auto) === JSON.stringify(s.auto), 'auto toggles round-trip');
  check(t.legend === 120 && t.legendPts === 40 && t.myth === 3 && t.mythPts === 2 && t.myths === 2, 'legend/myth fields round-trip');
  check(Math.abs(E.stats(t).gps - E.stats(s).gps) < 1e-9 && Math.abs(E.stats(t).coinWorth - E.stats(s).coinWorth) < 1e-9, 'stats identical after reload');
  check(!L.masterOn(t) && !L.keyOn(t, 'b:raid') && L.keyOn(t, 'b:digger') && L.autoSleepPct(t) === 175, 'toggles readable after reload');
  { const j2 = E.serialize(t); let d = ''; const A = JSON.parse(j), B = JSON.parse(j2); for (const k of Object.keys(A)) if (k !== 'savedAt' && JSON.stringify(A[k]) !== JSON.stringify(B[k])) d += k + ' '; check(!d, 'serialize is stable (' + d + ')'); }
}

// ---------------------------------------------------------------- v1 fixtures
{
  const FIX = path.join(__dirname, 'fixtures');
  const files = fs.readdirSync(FIX).filter(f => /^v1-.*\.json$/.test(f)).sort();
  check(files.length >= 4, 'v1 fixtures present');
  for (const f of files) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8'), o = JSON.parse(raw);
    const s = E.deserialize(raw);
    check(s.v === 2 && s.legend === (o.legend || 0) && s.legendPts === s.legend, f + ': migrated, legendPts === legend (' + s.legendPts + ')');
    check(JSON.stringify(s.lore) === '{}' && JSON.stringify(s.relics) === '{}' && s.myth === 0, f + ': empty lore/relics/myth');
    check(Math.abs(s.gold - o.gold) < 1e-6 && s.rank === o.rank, f + ': gold and rank kept');
    // the player at their first Sleep can spend immediately
    const n0 = L.affordableCount(s);
    if (s.legend >= 3) check(n0 >= 3, f + ': ' + n0 + ' lore nodes affordable right away');
    let bought = 0;
    for (let g = 0; g < 10; g++) { const n = L.nodes.find(x => L.canBuy(s, x.id)); if (!n || !L.buy(s, n.id)) break; bought++; }
    if (s.legend >= 1) check(bought >= 1, f + ': bought ' + bought + ' lore');
    E.offline(s, 2 * 3600);
    tickN(s, 120, 0.5);
    if (E.canSleep(s)) E.sleep(s);
    tickN(s, 60, 0.5);
    noBad(s, f);
    const back = E.deserialize(E.serialize(s));
    check(JSON.stringify(back.lore) === JSON.stringify(s.lore), f + ': lore survives save/load');
  }
}

// ---------------------------------------------------------------- with the other engine-side modules loaded
{
  let H2 = null, err = null;
  try { H2 = load(['js/events.js', 'js/ember.js']); } catch (e) { err = e; }
  check(!err && H2 && H2.lore, 'lore loads alongside events.js and ember.js (' + err + ')');
  if (H2) {
    const E2 = H2.engine, L2 = H2.lore, s = E2.newState();
    s.legendPts = 50; s.legend = 50;
    check(L2.buy(s, 'wake_ember') && s.lore.wake_ember === 1, 'wake_ember with ember.js loaded');
    s.lore.auto_dig = 1; s.gold = 1e5;
    for (let i = 0; i < 200; i++) E2.tick(s, 0.5);
    E2.offline(s, 3600);
    s.earnedRun = 1e8; E2.sleep(s);
    s.legend = L2.mythNeed(s); s.legendPts = 100; L2.buy(s, 'myth_gate');
    check(L2.ascend(s) >= 1 && s.lore.wake_ember === 1, 'Ascend with Ember awake keeps wake_ember');
    const b = finiteDeep(s, 'state') || finiteDeep(E2.stats(s), 'stats');
    check(!b, 'all modules: no NaN/Infinity (' + b + ')');
  }
}

// ---------------------------------------------------------------- engine hooks used by automation (integration)
{
  const H3 = load(), E3 = H3.engine, L3 = H3.lore;
  const seen = [];
  E3.on('buy', (d, st) => seen.push({ auto: !!(d && d.auto), st }));
  const s = E3.newState(); s.gold = 1e6; s.legendPts = 10; L3.buy(s, 'auto_dig');
  E3.automated(() => E3.buyBuilding(s, 'digger', 1));
  check(seen.length === 1 && seen[0].auto === true && seen[0].st === s, "'buy' inside E.automated carries auto:true and the state");
  E3.buyBuilding(s, 'digger', 1);
  check(seen[1] && seen[1].auto === false && !E3.inAuto(), "a player buy carries auto:false");
  const d0 = s.buildings.digger;
  for (let i = 0; i < 4; i++) E3.tick(s, 0.25);     // 1 s after the manual buy: Foremen wait
  check(s.buildings.digger === d0, 'auto-buyers pause for 1.5 s after a player buy (on that state)');
  for (let i = 0; i < 8; i++) E3.tick(s, 0.25);
  check(s.buildings.digger > d0, 'auto-buyers resume after the pause (' + d0 + ' -> ' + s.buildings.digger + ')');
  check(seen.slice(2).every(x => x.auto), 'Kobold Foremen buys are tagged auto');
  const other = E3.newState(); other.gold = 1e6; other.legendPts = 10; L3.buy(other, 'auto_dig');
  const o0 = other.buildings.digger;
  E3.buyBuilding(s, 'digger', 1);                    // a manual buy on another state must not pause this one
  for (let i = 0; i < 4; i++) E3.tick(other, 0.25);
  check(other.buildings.digger > o0, 'a manual buy on one state does not pause automation on another');
}


// ---------------------------------------------------------------- v2 final fixes
{
  const H4 = load(['js/events.js']), E4 = H4.engine, L4 = H4.lore, X4 = H4.events;
  // milestones: announced once per run, with the threshold passed
  const ms = []; E4.on('milestone', m => ms.push(m));
  const s = E4.newState(); s.rank = 3; s.gold = 1e9; s.tiers = [1e6, 0, 0, 0, 0]; E4.dirty();
  E4.buyTier(s, 1, 30);
  check(ms.length === 1 && ms[0].count === 25 && ms[0].owned === 30, 'milestone names the threshold passed (25), not the count (' + JSON.stringify(ms) + ')');
  s.tiers[1] = 5; E4.dirty();          // Wyrmlings spent on Drakes / Mines ...
  E4.buyTier(s, 1, 25);                // ... and bought back over 25
  check(ms.length === 1, 'a milestone passed again in the same run is not announced again');
  s.earnedRun = 2e7; E4.sleep(s); s.rank = 3; s.gold = 1e9; s.tiers = [1e6, 0, 0, 0, 0]; E4.dirty();
  E4.buyTier(s, 1, 12);
  check(ms.length === 2 && ms[1].count === 10, 'milestone marks reset with the Long Sleep');
  const back = E4.deserialize(E4.serialize(s));
  check(back.run.mst_1 === 1, 'milestone marks survive a save (' + back.run.mst_1 + ')');
  // Legend gain: 3 at the Sleep minimum, cube root above it
  const g = E4.newState(); g.earnedRun = 1e7;
  check(E4.legendOnSleep(g) === 3, 'first Sleep at 1e7 still gives 3 Legend');
  g.earnedRun = 8e7; check(E4.legendOnSleep(g) === 6, 'Legend gain 3.2 * cbrt(earnedRun / 1e7) (8e7 -> 6)');
  // first automation is affordable from the first Sleeps
  check(L4.cost(g, 'auto_quest') === 2 && L4.cost(g, 'auto_chest') === 2 && L4.cost(g, 'auto_gust') === 3 && L4.cost(g, 'auto_brood') === 4 && L4.cost(g, 'auto_build') === 6, 'automation costs 2/2/3/4/6');
  // Ascend: the sleep-hook snapshot still has the Myth-ending Legend and lore
  const a = E4.newState(); a.lore = { myth_gate: 1, greed: 3, auto_dig: 1 }; a.legend = L4.MYTH.minLegend * 3; a.legendPts = 50;
  let snapLegend = -1, snapGreed = -1;
  E4.addSleepHook('t-asc', (st, prev, why) => { if (why === 'ascend') { snapLegend = prev.legend; snapGreed = prev.lore.greed; } });
  const got = L4.ascend(a);
  check(got >= 1 && snapLegend === L4.MYTH.minLegend * 3 && snapGreed === 3, 'Ascend snapshot keeps Legend and lore (' + snapLegend + ', ' + snapGreed + ')');
  check(a.legend === 0 && a.legendPts === 0 && !a.lore.greed && a.lore.auto_dig === 1 && a.myths === 1, 'Ascend still resets Legend and Power lore, keeps automation');
}

// ---------------------------------------------------------------- Master Builders: gain net of the Nest bonus
// late in a run a building's Egg cost shrinks the nest; buildGain must see that (review: auto-buys that lowered gold/s)
{
  const trial = (b, tiers) => {
    let s = E.newState(); s.rank = 6; s.gold = 1e30; Object.assign(s.buildings, b); s.tiers = tiers.slice(); s = E.deserialize(E.serialize(s));
    const pred = L.buildGain(s, 'raid'), g0 = E.stats(s).baseGps;
    const ok = E.buyBuilding(s, 'raid', 1), g1 = E.stats(s).baseGps;
    return { ok, pred, real: g1 - g0, g0 };
  };
  const cases = [
    [{ digger: 10, raid: 10, mine: 5 }, [5e4, 100, 0, 0, 0]],
    [{ digger: 120, raid: 120, mine: 80, tower: 50, well: 25, moon: 10 }, [3e8, 1e5, 2e3, 0, 0]],
    [{ digger: 150, raid: 150, mine: 100, tower: 60, well: 30, moon: 12 }, [1e9, 1e6, 1e4, 0, 0]]
  ];
  cases.forEach(([b, t], k) => {
    const r = trial(b, t);
    check(r.ok && Math.abs(r.pred - r.real) <= 1e-6 * r.g0 + 1e-9, 'buildGain case ' + k + ': predicted ' + r.pred.toFixed(3) + ' = real ' + r.real.toFixed(3) + ' gold/s');
  });
  const late = trial(cases[2][0], cases[2][1]);
  check(late.real < 0 && late.pred < 0, 'a Raiding Party that costs more Nest than it adds is valued below 0 (' + late.pred.toFixed(1) + '/s), so Master Builders skips it');
}

console.log((fails ? 'FAILED ' + fails + ' of ' : 'ALL ') + (passes + fails) + ' lore checks' + (fails ? '' : ' passed'));
process.exit(fails ? 1 : 0);
