// Generates v1 save fixtures by running the *v1* engine from git `main` (not the working tree).
// Usage: node tools/gen-v1-fixtures.cjs [ref=main]
// Writes tools/fixtures/v1-fresh.json, v1-rank4.json, v1-sleepready.json, v1-postsleep.json
// (each file is exactly what v1 main.js wrote to localStorage 'hoard.save.v1': engine.serialize(state)).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const root = path.join(__dirname, '..');
const REF = process.argv[2] || 'main';
const outDir = path.join(__dirname, 'fixtures');

function gitShow(file) { return cp.execFileSync('git', ['show', REF + ':' + file], { cwd: root, encoding: 'utf8' }); }

// isolated context so the v1 HOARD never mixes with anything else
let seed = 4242;
const sandbox = { console, Date, JSON, Math: Object.create(Math) };
sandbox.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/data.js', 'js/engine.js']) vm.runInContext(gitShow(f), sandbox, { filename: REF + ':' + f });
const H = sandbox.HOARD, E = H.engine, D = H.data;
if (!E || E.version) { console.error('expected the v1 engine at ' + REF); process.exit(2); }

// a quick, crude active player (greedy cheapest-first) driven only through the v1 API
function playUntil(s, done, maxSec) {
  for (let t = 0; t < maxSec && !done(s); t++) {
    s._caveActive = true;
    E.tick(s, 1);
    const st = E.stats(s);
    E.coinCollected(s, Math.min(4, st.spillRate), 3);
    E.strokeCollected(s, 600, 3);
    E.noteStreak(s, st.maxStreak);
    if (E.gustReady(s) && E.useGust(s)) E.coinCollected(s, 8, 3, st.gustWorthMult);
    if (t % 90 === 45) { const r = E.grabTreasure(s); if (r.spawnCoins) E.coinCollected(s, r.spawnCoins, 2); }
    for (let i = 0; i < 3; i++) if (E.missionInfo(s, i).done) { E.claimMission(s, i); i = -1; }
    while (s.chests > 1) E.openChest(s); // keep one chest unopened (fixtures should carry chests)
    for (const u of E.upgradeList(s)) if (u.affordable && u.visible) E.buyUpgrade(s, u.id);
    for (let g = 0; g < 50; g++) {
      let best = null;
      for (const b of D.buildings) {
        if (!E.isUnlocked(s, 'building', b.id)) continue;
        const c = E.buildingCost(s, b.id, 1);
        if (c.minionTier >= 0 && s.tiers[c.minionTier] < c.minions) {
          const need = Math.ceil(c.minions - s.tiers[c.minionTier]);
          if (E.tierCost(s, c.minionTier, need).gold < s.gold * 0.3) E.buyTier(s, c.minionTier, need);
        }
        const v = st.buildingEach[b.id] / c.gold;
        if (c.gold <= s.gold && (c.minionTier < 0 || s.tiers[c.minionTier] >= c.minions) && (!best || v > best.v)) best = { id: b.id, v };
      }
      for (let i = 1; i < 5; i++) {
        if (!E.isUnlocked(s, 'tier', i)) continue;
        const c = E.tierCost(s, i, 1);
        if (c.gold < s.gold * 0.05 && s.tiers[i - 1] >= c.prev) E.buyTier(s, i, 1);
      }
      if (!best || !E.buyBuilding(s, best.id, 1)) break;
    }
  }
  return s;
}
function write(name, s) {
  const json = E.serialize(s);
  fs.writeFileSync(path.join(outDir, name), json + '\n');
  const o = JSON.parse(json);
  console.log(name.padEnd(20), 'v' + o.v, 'rank', o.rank, 'gold', H.fmt(o.gold), 'earnedRun', H.fmt(o.earnedRun), 'legend', o.legend,
    'sleeps', o.sleeps, 'chests', o.chests, 'cards', Object.keys(o.cards).length, 'buildings', JSON.stringify(o.buildings));
}

fs.mkdirSync(outDir, { recursive: true });
// (a) fresh
write('v1-fresh.json', E.newState());
// (b) mid-run, Dragon Rank 4
const s = E.newState();
playUntil(s, x => x.rank >= 4, 4 * 3600);
if (s.rank < 4) { console.error('could not reach rank 4'); process.exit(1); }
write('v1-rank4.json', s);
// (c) Sleep-ready (earnedRun >= 1e7)
playUntil(s, x => E.canSleep(x), 6 * 3600);
if (!E.canSleep(s)) { // top up like a lucky streak would, so the fixture is guaranteed Sleep-ready
  E.earn(s, D.C.sleepReq - s.earnedRun + 1, 'treasure');
}
write('v1-sleepready.json', s);
// (d) post-first-Sleep with legend >= 3
if (E.legendOnSleep(s) < 3) E.earn(s, 9.2e6 * 1.2, 'treasure');
const gained = E.sleep(s);
const t0 = s.time;
playUntil(s, x => x.rank >= 2 && x.time > t0 + 300, 1800);
if (s.legend < 3) { console.error('legend < 3 after sleep: ' + gained); process.exit(1); }
write('v1-postsleep.json', s);
