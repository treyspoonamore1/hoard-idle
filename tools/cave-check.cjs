// Self-check for js/cave.js: loads cave.js with a tiny fake HOARD.engine, swipes in
// circles for 3 s, flicks once (gust), and screenshots. Usage: node tools/cave-check.cjs [outDir]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || '/tmp/claude-0/-home-user/c9a30f79-ea9d-54ff-8834-d7ef030963e4/scratchpad';
const CAVE = path.resolve(__dirname, '..', 'js', 'cave.js');
const GOLD = Number(process.env.GOLD || 2.5e6);

const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--cave:#16131f;--rock:#221d2e;--rock-2:#2d2640;--gold:#f2b84b;--gold-hi:#ffe08a;--ember:#e8633a;--moss:#7fc29b;--ink:#efe6d6;--ink-dim:#a59cb3;color-scheme:dark}
html,body{margin:0;height:100%;background:#16131f}
#band{position:relative}
#cave{display:block;width:100%;height:390px;touch-action:none}
#gust{position:absolute;right:12px;bottom:12px;width:64px;height:64px;border-radius:50%;border:0;background:rgba(22,19,31,0.78)}
</style></head><body>
<div id="band"><canvas id="cave"></canvas><button id="gust" type="button">Gust</button></div>
<script>
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
HOARD.fmt = function (n) { if (n < 1000) return String(Math.floor(n)); var u=['K','M','B','T'],i=-1; while(n>=1000&&i<3){n/=1000;i++;} return n.toFixed(n<10?2:n<100?1:0)+u[i]; };
var state = { gold: ${GOLD}, gust: 1, time: 0, settings: { haptics: false, reducedMotion: false }, stat: { coins: 0 }, calls: {} };
function bump(k){ state.calls[k] = (state.calls[k]||0) + 1; }
HOARD.engine = {
  stats: function (s) { bump('stats'); return { gps: 40, coinWorth: 12, strokeWorth: 3, spillRate: 14, sweepRate: 1.5, sweepGps: 18,
    gustCooldown: 45, gustWorthMult: 3, treasureInterval: [1.5, 2], maxStreak: 5, emberActive: false, frenzyActive: false }; },
  coinCollected: function (s, n, m, v) { bump('coin'); var g = n * 12 * m * (v || 1); s.gold += g; s.stat.coins += n; return g; },
  strokeCollected: function (s, px, m) { bump('stroke'); var g = px / 120 * 3 * m; s.gold += g; return g; },
  sweepCollect: function (s, v) { bump('sweep'); var g = 12 * (v || 1); s.gold += g; return g; },
  noteStreak: function (s, m) { bump('noteStreak'); s.best = Math.max(s.best || 1, m); },
  gustReady: function (s) { return s.gust >= 1; },
  useGust: function (s) { if (s.gust < 1) return false; s.gust = 0; bump('gust'); return true; },
  grabTreasure: function (s) { bump('treasure'); return { kind: 'frenzy', title: 'Frenzy!', text: 'Gold/s x7 for 30s!' }; },
  _auto: false,
  inAuto: function () { return HOARD.engine._auto; }   // Restless Wings' auto-gust runs inside E.automated
};
// the Mines are open: 1 coin in 8 is an Ore nugget (SPEC-MINES B6); each one swiped digs 5 Ore here
HOARD.mines = { isOpen: function () { return true; }, nuggets: function (s, k) { bump('nug'); s.nug = (s.nug || 0) + k; s.ore = (s.ore || 0) + 5 * k; return 5 * k; } };
</script>
<script src="file://${CAVE}"></script>
<script>
HOARD.cave.init(document.getElementById('cave'), function () { return state; });
var last = performance.now();
(function loop(t) { var dt = Math.min(0.1, (t - last) / 1000); last = t; state.time += dt; HOARD.cave.frame(dt); requestAnimationFrame(loop); })(last);
</script></body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const page_ = path.join(OUT, 'cave-check.html');
  fs.writeFileSync(page_, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 600 }, deviceScaleFactor: 2 });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto('file://' + page_);
  await page.waitForTimeout(2600); // let coins spill and a treasure appear
  // nuggets: spilled among the coins (at most 6 on screen), never merged, left by the broom kobold
  await page.waitForFunction(() => HOARD.cave.nugCount() >= 2, null, { timeout: 8000 }).catch(() => {});
  const nug0 = await page.evaluate(() => ({ n: HOARD.cave.nugCount(), coins: HOARD.cave.coinCount(), at: HOARD.cave.nuggets() }));
  await page.screenshot({ path: path.join(OUT, 'cave-check-nuggets.png') });
  const cx = 206, cy = 200, R = 110;
  await page.mouse.move(cx + R, cy);
  await page.mouse.down();
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const a = (Date.now() - t0) / 1000 * Math.PI * 2 * 0.9;
    await page.mouse.move(cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.75, { steps: 2 });
    await page.waitForTimeout(12);
  }
  const streakMid = await page.evaluate(() => HOARD.cave.streak());
  await page.screenshot({ path: path.join(OUT, 'cave-check.png') });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  // fast flick -> gust
  await page.mouse.move(60, 300); await page.mouse.down();
  await page.mouse.move(360, 260, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(140);
  await page.screenshot({ path: path.join(OUT, 'cave-check-gust.png') });
  const info = await page.evaluate(() => ({ gold: state.gold, calls: state.calls, best: state.best, active: state._caveActive, nug: state.nug, ore: state.ore, nugMax: HOARD.cave.nugCount(), errors: window.__errors }));
  // keep spilling for a while without swiping: nuggets pile up to the cap of 6 and never merge
  await page.waitForTimeout(6000);
  const pile = await page.evaluate(() => {
    const m = HOARD.cave.metrics(), cr = document.getElementById('cave').getBoundingClientRect(), b = document.getElementById('gust').getBoundingClientRect();
    return { n: HOARD.cave.nugCount(), coins: HOARD.cave.coinCount(), at: HOARD.cave.nuggets(), w: m.w, r: m.coinR, gl: b.left - cr.left, gr: b.right - cr.left };
  });
  // an automated gust (Restless Wings) takes the coins and leaves every nugget for the player's swipe (review M1)
  const autoG = await page.evaluate(() => {
    const n0 = HOARD.cave.nugCount(), ore0 = state.ore || 0;
    state.gust = 1; HOARD.engine._auto = true;
    const ok = HOARD.cave.gust();
    HOARD.engine._auto = false;
    return { ok, n0, n1: HOARD.cave.nugCount(), coins: HOARD.cave.coinCount(), ore0 };
  });
  await page.waitForTimeout(300);
  autoG.ore1 = await page.evaluate(() => state.ore || 0);
  // the player's own gust takes the nuggets too, and the "+Ore" float stays on screen
  const ownG = await page.evaluate(() => { state.gust = 1; const ok = HOARD.cave.gust(); return { ok, n: HOARD.cave.nugCount() }; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'cave-check-own-gust.png') });
  console.log(JSON.stringify({ streakMid, nuggetsBefore: nug0, pile, autoG, ownG, ...info, logs }, null, 1));
  const bad = [];
  if (!(nug0.n >= 1)) bad.push('no nuggets spilled');
  if (!(info.calls.nug >= 1 && info.nug >= 1 && info.ore >= 5)) bad.push('swiping collected no nuggets');
  if (!(pile.n <= 6)) bad.push('more than 6 nuggets on screen: ' + pile.n);
  const edge = 1.3 * pile.r - 0.5;
  if (pile.at.some(([x]) => x < edge || x > pile.w - edge)) bad.push('a nugget hangs off the edge: ' + JSON.stringify(pile.at));
  if (pile.at.some(([x, y]) => y > 390 - 90 && x > pile.gl - edge && x < pile.gr + edge)) bad.push('a resting nugget sits under the Gust button: ' + JSON.stringify(pile));
  if (!(autoG.ok && autoG.n0 >= 1 && autoG.n1 === autoG.n0 && autoG.coins === autoG.n0 && autoG.ore1 === autoG.ore0)) bad.push('an automated gust took nuggets: ' + JSON.stringify(autoG));
  if (!(ownG.ok && ownG.n === 0)) bad.push("the player's gust left nuggets: " + JSON.stringify(ownG));
  if (info.errors.length || logs.some(l => /error/.test(l))) bad.push('errors');
  console.log(bad.length ? 'CAVE CHECK FAIL: ' + bad.join('; ') : 'CAVE CHECK OK');
  if (bad.length) process.exitCode = 1;
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
