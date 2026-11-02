// Playwright smoke test for Hoard. Run: NODE_PATH=/opt/node-tools/node_modules node tools/smoke.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/c9a30f79-ea9d-54ff-8834-d7ef030963e4/scratchpad';
const URL = 'file://' + path.join(__dirname, '..', 'dev.html');
const SWIPE_MS = +(process.env.SWIPE_MS || 20000);

const fails = [];
const errors = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('requestfailed: ' + r.url()); });

  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0.2);

  const textOk = async (label) => {
    const t = await page.evaluate(() => document.body.innerText);
    const bad = t.match(/.{0,30}\b(NaN|undefined|Infinity|null)\b.{0,30}/);
    check(!bad, 'no NaN/undefined/Infinity text [' + label + ']' + (bad ? ' -> "' + bad[0] + '"' : ''));
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth }));
    check(ov.sw <= ov.iw && ov.bw <= ov.iw, 'no horizontal overflow [' + label + '] ' + JSON.stringify(ov));
  };

  // --- swipe on cave
  const box = await page.locator('#cave').boundingBox();
  check(box && box.width > 300 && box.height > 250, 'cave canvas sized ' + JSON.stringify(box));
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;
  const r = Math.min(box.width, box.height) * 0.3;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  const t0 = Date.now(); let a = 0;
  while (Date.now() - t0 < SWIPE_MS) {
    a += 0.18;
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a * 1.3) * r * 0.8);
    await page.waitForTimeout(16);
    if (Date.now() - t0 > SWIPE_MS / 2 && Date.now() - t0 < SWIPE_MS / 2 + 40) { await page.mouse.up(); await page.waitForTimeout(300); await page.mouse.down(); }
  }
  await page.mouse.up();
  const midStreak = await page.evaluate(() => HOARD.state.stat.bestStreak);
  // fast flick
  const g0 = await page.evaluate(() => HOARD.state.stat.gusts);
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + 40, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 40 + i * 45, cy - i * 4); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ gold: HOARD.state.gold, coins: HOARD.state.stat.coins, px: HOARD.state.stat.swipePx, gusts: HOARD.state.stat.gusts, earned: HOARD.state.earnedAll }));
  console.log('after swipe:', JSON.stringify(after), 'bestStreak', midStreak);
  check(after.earned > 0 && after.gold > 0, 'gold > 0 after swiping');
  check(after.px > 1000, 'swipe path recorded');
  check(after.gusts > g0, 'flick triggered a gust');
  check(midStreak >= 2, 'streak reached x2+');
  await page.screenshot({ path: SHOTS + '/smoke-cave.png' });

  // --- give gold
  await page.evaluate(() => { const s = HOARD.state; s.gold += 5e5; s.earnedRun += 5e5; s.earnedAll += 5e5; });
  await page.waitForTimeout(300);

  const tab = async (name) => { await page.locator('#tabs [data-tab="' + name + '"]').click(); await page.waitForTimeout(350); };

  // Lair: hold buy on first building
  await tab('lair');
  const d0 = await page.evaluate(() => HOARD.state.buildings.digger);
  const lairBuy = page.locator('#panel .card:not(.locked) button').filter({ hasText: 'Buy' }).first();
  await lairBuy.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  const bb = await lairBuy.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up();
  await page.waitForTimeout(200);
  const d1 = await page.evaluate(() => HOARD.state.buildings.digger);
  check(d1 - d0 >= 8, 'hold-to-buy diggers ' + d0 + ' -> ' + d1);
  // buy an upgrade if one is shown
  const u0 = await page.evaluate(() => Object.keys(HOARD.state.upgrades).length);
  const upBtn = page.locator('#panel .upg-tile.can').first();
  if (await upBtn.count()) { await upBtn.click(); await page.waitForTimeout(300); }
  const u1 = await page.evaluate(() => Object.keys(HOARD.state.upgrades).length);
  check(u1 > u0, 'bought an upgrade ' + u0 + ' -> ' + u1);
  await textOk('lair');
  await page.screenshot({ path: SHOTS + '/smoke-lair.png' });

  // Brood: buy eggs (hold), then rank up to unlock wyrmlings
  await tab('brood');
  const e0 = await page.evaluate(() => HOARD.state.tiers[0]);
  const broodBuy = page.locator('#panel .card:not(.locked) button').filter({ hasText: 'Buy' }).last();
  await broodBuy.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  const eb = await broodBuy.boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
  await page.waitForTimeout(200);
  const e1 = await page.evaluate(() => HOARD.state.tiers[0]);
  check(e1 > e0, 'bought eggs ' + e0 + ' -> ' + e1);
  await textOk('brood');
  await page.screenshot({ path: SHOTS + '/smoke-brood.png' });

  // Quests: complete a mission artificially if needed, claim it
  await tab('quests');
  await page.waitForTimeout(400);
  let claim = page.locator('#panel button:visible').filter({ hasText: 'Claim' });
  let claimable = 0;
  for (let i = 0; i < claimable || i < 3; i++) {
    if (!(await claim.count())) break;
    await claim.first().scrollIntoViewIfNeeded().catch(() => {});
    const vis = await claim.first().isVisible().catch(() => false);
    const en = vis && await claim.first().isEnabled();
    if (!en) break;
    await claim.first().click(); claimable++; await page.waitForTimeout(400);
  }
  const q = await page.evaluate(() => ({ chests: HOARD.state.chests, rp: HOARD.state.rankProgress, rank: HOARD.state.rank, missions: HOARD.state.missions.map((m, i) => HOARD.engine.missionInfo(HOARD.state, i)) }));
  console.log('quests:', JSON.stringify(q));
  check(claimable > 0 || q.missions.every(m => !m.done), 'claimed done missions (' + claimable + ')');
  await textOk('quests');
  await page.screenshot({ path: SHOTS + '/smoke-quests.png' });
  // chest
  await page.evaluate(() => { HOARD.state.chests = Math.max(HOARD.state.chests, 2); });
  await page.waitForTimeout(400);
  const c0 = await page.evaluate(() => Object.values(HOARD.state.cards).reduce((a, b) => a + b, 0));
  const oc = page.locator('#panel button').filter({ hasText: /Open (chest|all)/ }).first();
  await oc.scrollIntoViewIfNeeded(); await oc.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOTS + '/smoke-chest.png' });
  const c1 = await page.evaluate(() => Object.values(HOARD.state.cards).reduce((a, b) => a + b, 0));
  check(c1 > c0, 'opened chest, cards ' + c0 + ' -> ' + c1);
  await textOk('chest');
  // close the sheet
  for (let i = 0; i < 3 && await page.evaluate(() => document.getElementById('overlay').classList.contains('open')); i++) {
    const btns = page.locator('#overlay button');
    const n = await btns.count();
    if (n) await btns.last().click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  check(!(await page.evaluate(() => document.getElementById('overlay').classList.contains('open'))), 'chest sheet closed');

  // Hoard
  await tab('hoard');
  await textOk('hoard');
  await page.screenshot({ path: SHOTS + '/smoke-hoard.png' });
  const ownedCard = page.locator('#panel .tcard:not(.unowned)').first();
  if (await ownedCard.count()) {
    await ownedCard.click(); await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + '/smoke-carddetail.png' });
    await textOk('card detail');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }

  // Legend (v1 Sleep tab, renamed in v2)
  const tabIds = await page.evaluate(() => Array.from(document.querySelectorAll('#tabs [data-tab]')).map(b => b.getAttribute('data-tab')));
  check(JSON.stringify(tabIds.slice(0, 5)) === JSON.stringify(['lair', 'brood', 'quests', 'hoard', 'legend']), 'tab bar order ' + tabIds.join(','));
  await tab('legend');
  await textOk('legend');
  const legendTxt = await page.evaluate(() => document.getElementById('panel').innerText);
  check(/Long Sleep/.test(legendTxt) && /Legend to spend/.test(legendTxt), 'legend tab shows Long Sleep + Legend sections');
  check(!/Start over|Copy save/.test(legendTxt), 'settings moved out of the Legend tab');
  await page.screenshot({ path: SHOTS + '/smoke-legend.png', fullPage: false });

  // settings sheet from the gear
  await page.locator('#btn-settings').click();
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.getElementById('overlay').classList.contains('open') && !!document.querySelector('#overlay .settings-sheet')), 'gear opens the Settings sheet');
  const setTxt = await page.evaluate(() => document.querySelector('#overlay').innerText);
  check(/Vibration/.test(setTxt) && /Reduce motion/.test(setTxt) && /Copy save/.test(setTxt) && /Start over/.test(setTxt) && /Play log/.test(setTxt), 'settings sheet rows (vibration, motion, play log, save, start over)');
  await textOk('settings');
  await page.screenshot({ path: SHOTS + '/smoke-settings.png' });
  // toggle vibration off and on through the sheet
  const hp0 = await page.evaluate(() => HOARD.state.settings.haptics);
  await page.locator('#overlay [data-setting="haptics"] .switch').click(); await page.waitForTimeout(250);
  const hp1 = await page.evaluate(() => HOARD.state.settings.haptics);
  check(hp1 === !hp0, 'vibration toggle works in the sheet');
  await page.locator('#overlay [data-setting="haptics"] .switch').click(); await page.waitForTimeout(250);
  // play log has entries (session start at least) and copies
  const logN = await page.evaluate(() => HOARD.log.count());
  check(logN >= 1, 'play log has entries (' + logN + ')');
  await page.evaluate(() => { const p = document.querySelector('#overlay .loglist'); if (p) p.scrollIntoView(); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + '/smoke-settings-log.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(!(await page.evaluate(() => document.getElementById('overlay').classList.contains('open'))), 'settings sheet closes on Escape');

  // mid-game state screenshot: rank 6 with lots of everything
  await page.evaluate(() => { const s = HOARD.state; s.rank = 6; s.gold = 3e9; s.tiers = [5000, 400, 80, 20, 3]; s.legend = 4; HOARD.ui.refresh(); });
  await tab('lair'); await page.waitForTimeout(500);
  await textOk('lair late');
  await page.screenshot({ path: SHOTS + '/smoke-lair-late.png' });
  await tab('brood'); await page.waitForTimeout(500);
  await textOk('brood late');
  await page.screenshot({ path: SHOTS + '/smoke-brood-late.png' });

  // save + reload
  const before = await page.evaluate(() => ({ gold: HOARD.state.gold, digger: HOARD.state.buildings.digger, cards: Object.keys(HOARD.state.cards).length }));
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
  await page.reload();
  await page.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0);
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => ({ gold: HOARD.state.gold, digger: HOARD.state.buildings.digger, cards: Object.keys(HOARD.state.cards).length }));
  console.log('before reload', JSON.stringify(before), 'after', JSON.stringify(restored));
  check(restored.digger === before.digger && restored.gold >= before.gold * 0.99 && restored.cards === before.cards, 'save restored after reload');
  await textOk('after reload');

  // v2 extension API smoke: a 6th tab, a section, a chip, a setting, a row extra, a cave layer, ask()
  await page.evaluate(() => {
    const ui = HOARD.ui;
    window.__x = { layer: 0, sfx: [] };
    ui.addTab({ id: 'xtest', label: 'Ember', icon: ui.icons.ember, order: 50, visible: () => true,
      build: (host) => { host.appendChild(ui.secHead('Test tab')); const p = ui.el('p', 'hint', 'n=0'); host.appendChild(p); return (s) => ui.setText(p, 'gold ' + HOARD.fmt(s.gold)); },
      badge: () => 2 });
    ui.addSection('legend', { id: 'xsec', order: 5, build: (host) => { host.appendChild(ui.el('div', 'card', 'Section from a module')); } });
    ui.addChip({ id: 'xchip', order: 1, visible: () => true, text: () => 'Auto', onPress: () => { window.__x.chip = 1; } });
    ui.addRowExtra('building', (slot, id) => { if (id === 'digger') slot.appendChild(ui.el('small', 'sub', 'extra:' + id)); });
    HOARD.cave.addLayer({ id: 'xlayer', z: -1, draw: (ctx, w, h) => { window.__x.layer++; ctx.fillStyle = 'rgba(232,99,58,0.25)'; ctx.fillRect(4, h - 30, 24, 24); } });
    HOARD.cave.addSfxHook((name) => window.__x.sfx.push(name));
  });
  await page.setViewportSize({ width: 360, height: 760 });
  await page.waitForTimeout(600);
  const tb = await page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('#tabs [data-tab]'));
    return { n: bs.length, ids: bs.map(b => b.getAttribute('data-tab')), clipped: bs.filter(b => { const l = b.querySelector('.t-label'); return l && l.scrollWidth > l.clientWidth + 1; }).length,
      minW: Math.min(...bs.map(b => b.getBoundingClientRect().width)), sw: document.documentElement.scrollWidth };
  });
  check(tb.n === 6 && tb.ids[4] === 'xtest' && tb.clipped === 0 && tb.minW >= 48 && tb.sw <= 360, '6 tabs fit at 360px ' + JSON.stringify(tb));
  await tab('xtest');
  check(/Test tab/.test(await page.evaluate(() => document.getElementById('panel').innerText)), 'registered tab renders');
  check(await page.evaluate(() => !document.querySelector('[data-chip="xchip"]').hidden), 'registered chip visible');
  await page.locator('[data-chip="xchip"]').click(); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__x.chip === 1), 'chip onPress fires');
  await page.screenshot({ path: SHOTS + '/smoke-6tabs-360.png' });
  await tab('legend');
  check(/Section from a module/.test(await page.evaluate(() => document.getElementById('panel').innerText)), 'registered legend section renders');
  await tab('lair');
  check(/extra:digger/.test(await page.evaluate(() => document.getElementById('panel').innerText)), 'row extra renders in Lair');
  check(await page.evaluate(() => window.__x.layer > 5), 'cave layer draws');
  const askP = page.evaluate(() => HOARD.ui.ask('Test?', 'Pick one', 'Yes', 'No'));
  await page.waitForTimeout(300);
  await page.locator('#overlay button').filter({ hasText: 'Yes' }).click();
  check((await askP) === true, 'ui.ask resolves true on Yes');
  await page.setViewportSize({ width: 412, height: 915 });

  // let it run a bit to catch tick-time errors
  await page.waitForTimeout(1500);
  check(errors.length === 0, 'no console/page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
  await browser.close();
  console.log(fails.length ? '\nSMOKE FAILED (' + fails.length + ')' : '\nSMOKE OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH', e); process.exit(2); });
