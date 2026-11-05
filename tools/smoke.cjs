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

  const textOk = async (label, pg) => {
    pg = pg || page;
    const t = await pg.evaluate(() => document.body.innerText);
    const bad = t.match(/.{0,30}\b(NaN|undefined|Infinity|null)\b.{0,30}/);
    check(!bad, 'no NaN/undefined/Infinity text [' + label + ']' + (bad ? ' -> "' + bad[0] + '"' : ''));
    const ov = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth }));
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
  // (a headless page under load can stretch the 6 moves past the 220 ms gust window, so a flick that came out too
  // slow is retried a couple of times while the gust is still ready; a gust that never fires still fails)
  const g0 = await page.evaluate(() => HOARD.state.stat.gusts);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(200);
    await page.mouse.move(box.x + 30, cy);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 30 + i * 50, cy - i * 4); await page.waitForTimeout(8); }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const fired = await page.evaluate((g) => HOARD.state.stat.gusts > g || !HOARD.engine.gustReady(HOARD.state), g0);
    if (fired) break;
    console.log('flick attempt ' + (attempt + 1) + ' too slow for a gust, retrying');
  }
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

  // ================================================================ v2 features
  const ovOpen = () => page.evaluate(() => document.getElementById('overlay').classList.contains('open'));
  const ovText = () => page.evaluate(() => document.getElementById('overlay').innerText);
  const panelText = () => page.evaluate(() => document.getElementById('panel').innerText);
  const hold = async (loc, ms) => {
    await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const closeOverlay = async () => {
    for (let i = 0; i < 4 && await ovOpen(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
  };
  const loreBtn = (name) => page.locator('#panel .lore-node').filter({ hasText: name }).first().locator('button.buy');

  // --- forced Long Sleep from the Legend tab, then the "Spend your Legend" callout
  await page.evaluate(() => { const s = HOARD.state; s.earnedRun = Math.max(s.earnedRun, 4.9e7); });
  await tab('legend');
  const pre = await page.evaluate(() => ({ sleeps: HOARD.state.sleeps, pts: HOARD.state.legendPts, legend: HOARD.state.legend }));
  await page.locator('#panel [data-sec="legend.sleep"] button').filter({ hasText: /^Sleep$/ }).click();
  await page.waitForTimeout(400);
  await page.locator('#overlay button').filter({ hasText: 'Sleep now' }).click();
  await page.waitForTimeout(400);
  const post = await page.evaluate(() => ({ sleeps: HOARD.state.sleeps, pts: HOARD.state.legendPts, legend: HOARD.state.legend, rank: HOARD.state.rank }));
  check(post.sleeps === pre.sleeps + 1 && post.pts > pre.pts && post.legend > pre.legend && post.rank === 1, 'forced Long Sleep ' + JSON.stringify(pre) + ' -> ' + JSON.stringify(post));
  await page.waitForTimeout(2200);
  check(await ovOpen() && /Spend your Legend/.test(await ovText()), '"Spend your Legend" callout after the first Sleep');
  await page.screenshot({ path: SHOTS + '/smoke-callout.png' });
  await page.locator('#overlay button').filter({ hasText: 'Show me the Lore' }).click();
  await page.waitForTimeout(700);
  check(!(await ovOpen()) && await page.evaluate(() => { const n = document.querySelector('[data-sec^="legend.lore-"]'); if (!n) return false; const r = n.getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return r.top < p.bottom && r.bottom > p.top; }), 'callout scrolls to the Lore list');
  // hold-to-buy a Lore node
  await page.evaluate(() => { HOARD.state.legendPts = Math.max(HOARD.state.legendPts, 40); });
  await page.waitForTimeout(300);
  const lp0 = await page.evaluate(() => HOARD.state.legendPts);
  await hold(loreBtn('Kobold Foremen'), 250);
  const lr1 = await page.evaluate(() => ({ dig: HOARD.state.lore.auto_dig || 0, pts: HOARD.state.legendPts }));
  check(lr1.dig === 1 && Math.abs(lp0 - lr1.pts - 2) < 1e-9, 'Lore purchase: Kobold Foremen (' + lp0 + ' -> ' + lr1.pts + ' Legend)');
  // owned automation shows as one compact card of toggle rows (SPEC-MINES A6)
  check(await page.evaluate(() => { const c = document.querySelector('#panel .lore-autolist'); return !!c && /Kobold Foremen/.test(c.innerText) && c.querySelectorAll('.lore-al-row .switch').length === 1 && !Array.from(document.querySelectorAll('#panel .lore-node')).some(n => /Kobold Foremen/.test(n.innerText)); }), 'owned Kobold Foremen moves into the compact Automation card');
  await hold(loreBtn("Dragon's Hunger"), 1200);
  check(await page.evaluate(() => (HOARD.state.lore.greed || 0) >= 2), "hold-to-buy repeats on a multi-level node (Dragon's Hunger lv " + await page.evaluate(() => HOARD.state.lore.greed || 0) + ')');
  await textOk('legend lore');
  await page.screenshot({ path: SHOTS + '/smoke-legend-lore.png' });

  // --- automation: Kobold Foremen buys diggers; the Lair row "Auto" switch turns it off and on
  check(await page.evaluate(() => { const c = document.querySelector('[data-chip="lore-auto"]'); return !!c && !c.hidden && /Auto/.test(c.textContent); }), 'Auto chip in the top bar');
  await tab('lair');
  await page.evaluate(() => { HOARD.state.gold = Math.max(HOARD.state.gold, 2e4); });
  await page.waitForTimeout(1600);
  const dA = await page.evaluate(() => HOARD.state.buildings.digger);
  check(dA >= 3, 'Kobold Foremen auto-bought diggers (' + dA + ')');
  const digSwitch = page.locator('#panel .card').filter({ hasText: 'Kobold Diggers' }).first().locator('.toggle-row .switch');
  check(await digSwitch.count() === 1 && await digSwitch.isVisible(), 'Auto switch on the Kobold Diggers row');
  await digSwitch.click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => HOARD.state.auto['b:digger'] === false && HOARD.lore.buildingAutoOn(HOARD.state, 'digger') === false), 'row Auto switch turns digger automation off');
  await page.evaluate(() => { HOARD.state.gold += 1e6; });
  const dB = await page.evaluate(() => HOARD.state.buildings.digger);
  await page.waitForTimeout(1600);
  check(await page.evaluate(() => HOARD.state.buildings.digger) === dB, 'no auto-buys while the switch is off');
  await page.screenshot({ path: SHOTS + '/smoke-lair-auto.png' });
  await digSwitch.click(); await page.waitForTimeout(1600);
  check(await page.evaluate(() => HOARD.state.buildings.digger) > dB, 'switch back on resumes auto-buys');
  // master switch in the Legend header
  await tab('legend');
  await page.locator('#panel [data-sec="legend.lorehead"] .switch').first().click(); await page.waitForTimeout(250);
  check(await page.evaluate(() => !HOARD.lore.masterOn(HOARD.state) && /Auto off/.test(document.querySelector('[data-chip="lore-auto"]').textContent)), 'master Automation switch off -> chip "Auto off"');
  await page.locator('#panel [data-sec="legend.lorehead"] .switch').first().click(); await page.waitForTimeout(250);
  check(await page.evaluate(() => HOARD.lore.masterOn(HOARD.state)), 'master Automation switch back on');

  // --- Call the Deep (Lore) -> the Mines open before rank 7 -> 6th tab
  check(!(await page.locator('#tabs [data-tab="mines"]').count()) && !(await page.locator('#tabs [data-tab="ember"]').count()), 'no Mines tab (and never an Ember tab) before Call the Deep');
  await page.evaluate(() => { HOARD.state.legendPts += 12; });
  await page.waitForTimeout(300);
  await hold(loreBtn('Call the Deep'), 250);
  await page.waitForTimeout(800);
  check(await page.evaluate(() => HOARD.state.lore.wake_ember === 1 && HOARD.mines.isOpen(HOARD.state) && HOARD.state.rank < 7), 'Call the Deep opens the Mines');
  check(await page.locator('#tabs [data-tab="mines"]').count() === 1, 'Mines tab appears');
  await page.waitForFunction(() => /The Mines open/.test(document.getElementById('toasts').innerText), null, { timeout: 6000 }).catch(() => {});
  check(/The Mines open/.test(await page.evaluate(() => document.getElementById('toasts').innerText)), '"The Mines open" toast');
  await tab('mines');
  check(/Ore/.test(await panelText()) && /Forge glow/.test(await panelText()), 'Mines tab shows Ore and the Forge glow');
  const fm = await panelText();
  check(/Shaft Depth 0/.test(fm) && /Pick Crews/.test(fm) && /Ore Carts/.test(fm) && /Reach Shaft Depth 3 to break into Tunnel Borers/.test(fm) && !/Deep Delvers/.test(fm) &&
    /When you Sleep/.test(fm) && /Gilded Pans/.test(fm) && /\+7 more/.test(fm) && /recruit up to 3/.test(fm), 'fresh Mines: Shaft, Crews and Carts, only the next locked tier, the tithe strip, the 3 cheapest Forge levels');
  await textOk('mines');
  await page.screenshot({ path: SHOTS + '/smoke-mines.png' });

  // --- event lairs are retired: no chip, no Quests banner
  check(await page.evaluate(() => !document.querySelector('[data-chip="events"]') && !document.querySelector('.ev-chip') && !document.querySelector('[data-sec="quests.eventBanner"]')), 'no event chip, no event banner');
  await tab('quests');
  check(await page.evaluate(() => !document.querySelector('[data-sec="quests.eventBanner"]') && !/lair is open|Next lair/i.test(document.getElementById('panel').innerText)), 'Quests tab has no event lair banner');

  // --- settings sheet: sound, volume, stats, play log
  await page.locator('#btn-settings').click(); await page.waitForTimeout(400);
  const st2 = await ovText();
  check(/Sound/.test(st2) && /Volume/.test(st2) && /Stats/.test(st2) && /Play log/.test(st2), 'settings: Sound, Volume, Stats, Play log rows');
  const snd0 = await page.evaluate(() => HOARD.sound.enabled(HOARD.state));
  await page.locator('#overlay [data-setting="sound"] .switch').first().click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => HOARD.sound.enabled(HOARD.state)) === !snd0, 'Sound switch toggles');
  await page.locator('#overlay [data-setting="sound"] .switch').first().click(); await page.waitForTimeout(200);
  await page.locator('#overlay input[type=range]').first().fill('70'); await page.waitForTimeout(200);
  check(await page.evaluate(() => Math.abs(HOARD.state.settings.volume - 0.7) < 1e-9), 'volume slider sets 70%');
  await page.screenshot({ path: SHOTS + '/smoke-settings-v2.png' });
  await page.locator('#overlay [data-setting="stats"] button').first().click(); await page.waitForTimeout(400);
  const stt = await ovText();
  check(await page.evaluate(() => !!document.querySelector('#overlay .st-stats')) && /Long Sleeps/.test(stt) && /Cards/i.test(stt), 'Stats sheet opens');
  await textOk('stats');
  await page.screenshot({ path: SHOTS + '/smoke-stats.png' });
  await page.locator('#overlay button').filter({ hasText: 'Back' }).first().click(); await page.waitForTimeout(400);
  check(await page.evaluate(() => !!document.querySelector('#overlay .settings-sheet')), 'Stats Back returns to Settings');
  check(await page.evaluate(() => HOARD.log.count()) >= 3, 'play log recorded the Sleep and Lore buys');
  await closeOverlay();

  // --- extension hooks still work for modules: section, chip, row extra, cave layer, sfx hook, ask()
  await page.evaluate(() => {
    const ui = HOARD.ui;
    window.__x = { layer: 0, sfx: [] };
    ui.addSection('legend', { id: 'xsec', order: 5, build: (host) => { host.appendChild(ui.el('div', 'card', 'Section from a module')); } });
    ui.addChip({ id: 'xchip', order: 1, visible: () => true, text: () => 'Test', classes: () => 'xcls', onPress: () => { window.__x.chip = 1; } });
    ui.addRowExtra('building', (slot, id) => { if (id === 'digger') slot.appendChild(ui.el('small', 'sub', 'extra:' + id)); });
    HOARD.cave.addLayer({ id: 'xlayer', z: -1, draw: (ctx, w, h) => { window.__x.layer++; } });
    HOARD.cave.addSfxHook((name) => window.__x.sfx.push(name));
    ui.refresh();
  });
  await page.waitForTimeout(400);
  check(await page.evaluate(() => { const c = document.querySelector('[data-chip="xchip"]'); return !!c && !c.hidden && c.classList.contains('xcls'); }), 'registered chip visible with its classes');
  await page.locator('[data-chip="xchip"]').click(); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__x.chip === 1), 'chip onPress fires');
  await tab('legend');
  check(/Section from a module/.test(await panelText()), 'registered legend section renders');
  await tab('lair');
  check(/extra:digger/.test(await panelText()), 'row extra renders in Lair');
  check(await page.evaluate(() => window.__x.layer > 5), 'cave layer draws');
  check(await page.evaluate(() => typeof HOARD.cave.coinCount() === 'number'), 'cave.coinCount() exposed');
  const askP = page.evaluate(() => HOARD.ui.ask('Test?', 'Pick one', 'Yes', 'No'));
  await page.waitForTimeout(300);
  await page.locator('#overlay button').filter({ hasText: 'Yes' }).click();
  check((await askP) === true, 'ui.ask resolves true on Yes');
  await page.evaluate(() => { HOARD.ui.removeSection('legend', 'xsec'); });

  // --- 6 real tabs at 360 px, every tab rendered there
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(600);
  const tb = await page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('#tabs [data-tab]')).filter(b => !b.hidden);
    return { n: bs.length, ids: bs.map(b => b.getAttribute('data-tab')), clipped: bs.filter(b => { const l = b.querySelector('.t-label'); return l && l.scrollWidth > l.clientWidth + 1; }).length,
      minW: Math.min(...bs.map(b => b.getBoundingClientRect().width)), sw: document.documentElement.scrollWidth };
  });
  check(tb.n === 6 && tb.ids.join() === 'lair,brood,quests,hoard,legend,mines' && tb.clipped === 0 && tb.minW >= 48 && tb.sw <= 360, '6 tabs fit at 360px ' + JSON.stringify(tb));
  for (const t of tb.ids) {
    await tab(t);
    await textOk(t + ' @360');
    await page.screenshot({ path: SHOTS + '/smoke360-' + t + '.png' });
  }
  await page.setViewportSize({ width: 412, height: 915 });

  // ================================================================ Starfall on the player's live save (412 and 360)
  for (const [SW, SH] of [[412, 915], [360, 780]]) {
    const tag = SW === 360 ? '-360' : '-412';
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'v2-player-post-ascend.json'), 'utf8');
    const sctx = await browser.newContext({ viewport: { width: SW, height: SH }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
    const sp = await sctx.newPage();
    const serr = [];
    sp.on('console', m => { if (m.type() === 'error') serr.push('console: ' + m.text()); });
    sp.on('pageerror', e => serr.push('pageerror: ' + (e.stack || e.message)));
    await sctx.addInitScript((r) => {
      try { if (!sessionStorage.getItem('__fx')) { localStorage.clear(); localStorage.setItem('hoard.save.v1', r); sessionStorage.setItem('__fx', '1'); } } catch (e) {}
    }, raw);
    await sp.goto(URL);
    await sp.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0.3);
    await sp.waitForTimeout(700);
    await sp.evaluate(() => { if (HOARD.ui.sheetOpen()) HOARD.ui.closeSheet(); });
    await sp.waitForTimeout(400);
    const l0 = await sp.evaluate(() => {
      const b = document.getElementById('skybtn'), g = document.getElementById('gust');
      const r = b && b.getBoundingClientRect(), q = g.getBoundingClientRect();
      return { vis: !!b && !b.hidden && r.width > 40, text: b ? b.innerText.replace(/\s+/g, ' ') : '', on: HOARD.state.sky.on, ch: HOARD.state.sky.ch, n: HOARD.state.sky.n,
        overlapGust: !!r && !(r.bottom <= q.top || r.top >= q.bottom || r.right <= q.left || r.left >= q.right), right: r && r.right, iw: innerWidth };
    });
    check(l0.on && l0.vis && /Stars 2\/4/.test(l0.text) && !l0.overlapGust && l0.right <= l0.iw, 'Starfall' + tag + ': launcher visible "' + l0.text + '", clear of Gust ' + JSON.stringify(l0));
    await textOk('sky launcher' + tag, sp);
    await sp.locator('#skybtn').click();
    await sp.waitForTimeout(200);
    check(await sp.evaluate(() => HOARD.skyUI.running() && HOARD.cave.hudDim() < 0.5 && HOARD.state.sky.ch >= 1.99), 'Starfall' + tag + ': running, HUD dimmed, no charge spent yet');
    // toasts other than the sky's wait for the end of the Starfall; the sky's own still show
    await sp.evaluate(() => {
      window.__tlog = [];
      new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__tlog.push({ run: HOARD.skyUI.running(), kind: n.className, txt: n.innerText }); })
        .observe(document.getElementById('toasts'), { childList: true });
      HOARD.ui.toast('Smoke held toast', 'waits for the Starfall', ''); HOARD.ui.toast('Smoke sky toast', 'shows now', 'sky');
    });
    await sp.waitForTimeout(150);
    const tz = await sp.evaluate(() => [document.getElementById('toasts').innerText, Array.from(document.querySelectorAll('#toasts .toast')).every(n => /sky|gold/.test(n.className) || n.classList.contains('out'))]);
    check(!/Smoke held toast/.test(tz[0]) && /Smoke sky toast/.test(tz[0]) && tz[1], 'Starfall' + tag + ': other toasts held (load toasts sent back to the queue), sky toasts shown (' + tz[0].replace(/\s+/g, ' ').slice(0, 120) + ')');
    const coins0 = await sp.evaluate(() => HOARD.state.stat.coins);
    // 25 s of touch swipes across the top half of the cave
    const cb = await sp.locator('#cave').boundingBox();
    const cdp = await sctx.newCDPSession(sp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const tS = Date.now(); let k = 0, shot = false;
    while (Date.now() - tS < 25000) {
      const y0 = cb.y + cb.height * (0.12 + 0.36 * ((k * 0.37) % 1)), dir = k % 2 ? -1 : 1;
      const xa = dir > 0 ? cb.x + 12 : cb.x + cb.width - 12;
      await touch('touchStart', xa, y0);
      for (let i = 1; i <= 12; i++) { await touch('touchMove', xa + dir * i * (cb.width - 24) / 12, y0 + Math.sin(i / 2) * 18); await sp.waitForTimeout(14); }
      await touch('touchEnd', 0, 0);
      k++;
      if (!shot && Date.now() - tS > 9000) { shot = true; await sp.screenshot({ path: SHOTS + '/sky-running' + tag + '.png' }); }
    }
    await sp.waitForFunction(() => !HOARD.skyUI.running() && document.getElementById('overlay').classList.contains('open'), null, { timeout: 15000 }).catch(() => {});
    await sp.waitForTimeout(1400);
    const r1 = await sp.evaluate(() => ({ n: HOARD.state.sky.n, ch: HOARD.state.sky.ch, xp: HOARD.state.sky.xp, caught: HOARD.state.sky.caught, dim: HOARD.cave.hudDim(),
      sheet: document.getElementById('overlay').innerText, toasts: document.getElementById('toasts').innerText, swiped: HOARD.state.stat.coins }));
    console.log('Starfall' + tag + ':', JSON.stringify(r1).slice(0, 300));
    check(r1.n === 1 && r1.ch >= 0.99 && r1.ch < 1.1 && r1.dim === 1 && /Starfall/.test(r1.sheet) && /Caught/.test(r1.sheet) && /Stardust/.test(r1.sheet) && !/Gold/.test(r1.sheet) && r1.caught > 0 && r1.xp > 0,
      'Starfall' + tag + ': score sheet (no gold row), n 1, one charge spent, HUD back (' + r1.caught + ' caught, +' + r1.xp + ' Stardust)');
    check(r1.swiped > coins0, 'Starfall' + tag + ': the spill kept running, the same swipes swept coins during the Starfall (' + coins0 + ' -> ' + r1.swiped + ')');
    await sp.waitForFunction(() => window.__tlog.some(t => !t.run && !/\bsky\b/.test(t.kind)), null, { timeout: 15000 }).catch(() => {});
    const tl = await sp.evaluate(() => window.__tlog);
    const during = tl.filter(t => t.run && !/\bsky\b/.test(t.kind) && !/^Your dragon grew/.test(t.txt));
    check(during.length === 0 && tl.some(t => !t.run && !/\bsky\b/.test(t.kind)), 'Starfall' + tag + ': no other toast showed while stars fell (' + during.map(t => t.txt).join(' | ').slice(0, 160) + '), held ones show after (' + tl.length + ' toasts logged)');
    await textOk('sky sheet' + tag, sp);
    await sp.screenshot({ path: SHOTS + '/sky-sheet' + tag + '.png' });
    await sp.evaluate(() => HOARD.ui.closeSheet());
    await sp.locator('#tabs [data-tab="hoard"]').click(); await sp.waitForTimeout(500);
    check(/Night Sky/.test(await sp.evaluate(() => document.getElementById('panel').innerText)), 'Starfall' + tag + ': Night Sky section in the Hoard tab');
    await textOk('hoard sky' + tag, sp);
    await sp.screenshot({ path: SHOTS + '/hoard-sky' + tag + '.png' });
    await sp.locator('#tabs [data-tab="mines"]').click(); await sp.waitForTimeout(500);
    await sp.evaluate(() => { const n = document.querySelector('[data-sec="mines.lanterns"]'); if (n) n.scrollIntoView({ block: 'center' }); });
    await sp.waitForTimeout(300);
    const e0 = await sp.evaluate(() => HOARD.state.mines.ore);
    await sp.locator('[data-sec="mines.lanterns"] button.buy').click();
    await sp.waitForTimeout(400);
    check(await sp.evaluate((e) => HOARD.state.sky.lant === 1 && HOARD.state.mines.ore < e, e0), 'Starfall' + tag + ': a Sky Lantern bought with Ore');
    // holding the button is still one press: one level, never the whole row of lanterns
    const lb = await sp.locator('[data-sec="mines.lanterns"] button.buy').boundingBox();
    await sp.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await sp.mouse.down(); await sp.waitForTimeout(1500); await sp.mouse.up();
    await sp.waitForTimeout(300);
    check(await sp.evaluate(() => HOARD.state.sky.lant === 2), 'Starfall' + tag + ': a 1.5 s hold on Light buys one level (Lv ' + (await sp.evaluate(() => HOARD.state.sky.lant)) + ')');
    await textOk('mines lanterns' + tag, sp);
    await sp.screenshot({ path: SHOTS + '/mines-lanterns' + tag + '.png' });
    check(serr.length === 0, 'Starfall' + tag + ': no console/page errors' + (serr.length ? ':\n  ' + serr.join('\n  ') : ''));
    await sctx.close();
  }

  // ================================================================ the live save (Myth 4, Ember converted) at 412 and 360
  // SPEC-MINES A6/A7: the Mines tab after the conversion, the compact owned-automation card (<= 450 px at 360 wide),
  // the top bar (Nest, Legend, Auto) inside the screen, no horizontal overflow
  for (const [SW, SH] of [[412, 915], [360, 780]]) {
    const tag = '-' + SW;
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'v2-player-myth4.json'), 'utf8');
    const mctx = await browser.newContext({ viewport: { width: SW, height: SH }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
    const mp = await mctx.newPage();
    const merr = [];
    mp.on('console', m => { if (m.type() === 'error') merr.push('console: ' + m.text()); });
    mp.on('pageerror', e => merr.push('pageerror: ' + (e.stack || e.message)));
    await mctx.addInitScript((r) => {
      try { if (!sessionStorage.getItem('__fx')) { localStorage.clear(); localStorage.setItem('hoard.save.v1', r); sessionStorage.setItem('__fx', '1'); } } catch (e) {}
      window.__tl = [];
      document.addEventListener('DOMContentLoaded', () => new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__tl.push(n.innerText); })
        .observe(document.getElementById('toasts'), { childList: true }));
    }, raw);
    await mp.goto(URL);
    await mp.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0.3);
    await mp.waitForFunction(() => window.__tl.some(t => /Event lairs have closed/.test(t)), null, { timeout: 10000 }).catch(() => {});
    const toastsSeen = await mp.evaluate(() => window.__tl.join(' | '));
    await mp.evaluate(() => { if (HOARD.ui.sheetOpen()) HOARD.ui.closeSheet(); });
    await mp.waitForTimeout(400);
    const m0 = await mp.evaluate(() => ({ open: HOARD.mines.isOpen(HOARD.state), ore: HOARD.state.mines.ore, crews: HOARD.state.mines.units[0], hearth: HOARD.state.mines.hearth, tabs: Array.from(document.querySelectorAll('#tabs [data-tab]')).filter(b => !b.hidden).map(b => b.getAttribute('data-tab')).join() }));
    check(m0.open && m0.ore >= 59353483 && m0.crews >= 1165 && Math.abs(m0.hearth - 6.9378) < 1e-4 && m0.tabs === 'lair,brood,quests,hoard,legend,mines', 'live save' + tag + ': converted on load (and the Mines dug while the save sat) ' + JSON.stringify(m0));
    check(/Ember moved to the Mines/.test(toastsSeen) && /Event lairs have closed/.test(toastsSeen), 'live save' + tag + ': the one-time conversion toasts (' + toastsSeen.replace(/\s+/g, ' ').slice(0, 220) + ')');
    // top bar: Nest, Legend, Auto inside the screen (last visible chip right <= width - 8), no event chip
    const top = await mp.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('#top .chips > *')).filter(n => !n.hidden && n.getBoundingClientRect().width > 0);
      const last = cs[cs.length - 1].getBoundingClientRect();
      return { ids: cs.map(n => n.id || n.getAttribute('data-chip') || n.className).join(','), right: last.right, iw: innerWidth, sw: document.documentElement.scrollWidth, ev: !!document.querySelector('[data-chip="events"]') };
    });
    check(top.right <= top.iw - 8 && top.sw <= top.iw && !top.ev, 'live save' + tag + ': top bar fits ' + JSON.stringify(top));
    await mp.screenshot({ path: SHOTS + '/live-top' + tag + '.png', clip: { x: 0, y: 0, width: SW, height: 140 } });
    // mid-swipe (playtest review M3): with the "x5 streak" chip showing, every visible chip still fits on screen
    await mp.evaluate(() => { window.__stk = HOARD.cave.streak; HOARD.cave.streak = () => 5; });
    await mp.waitForTimeout(700);
    const topS = await mp.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('#top .chips > *')).filter(n => !n.hidden && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0);
      const last = cs[cs.length - 1].getBoundingClientRect();
      return { ids: cs.map(n => n.id || n.getAttribute('data-chip') || n.className).join(','), right: Math.round(last.right), iw: innerWidth, streak: !document.getElementById('chip-streak').hidden };
    });
    check(topS.streak && topS.right <= topS.iw - 8, 'live save' + tag + ': top bar fits while a streak shows ' + JSON.stringify(topS));
    await mp.screenshot({ path: SHOTS + '/live-top-streak' + tag + '.png', clip: { x: 0, y: 0, width: SW, height: 140 } });
    await mp.evaluate(() => { HOARD.cave.streak = window.__stk; });
    await mp.waitForTimeout(400);
    await mp.locator('#tabs [data-tab="mines"]').click(); await mp.waitForTimeout(500);
    const mt = await mp.evaluate(() => document.getElementById('panel').innerText);
    check(/ORE\s*\n\s*[\d.]+[KMBT]/i.test(mt) && /Hearth/.test(mt) && /Gilded Pans/.test(mt) && /Sky Lanterns/.test(mt), 'live save' + tag + ': Mines tab shows Ore, the Hearth, the Forge and the lanterns');
    await textOk('live mines' + tag, mp);
    await mp.screenshot({ path: SHOTS + '/live-mines' + tag + '.png', fullPage: true });
    // SPEC-MINES B8/B11: Dig deeper (one press), a Forge press, hold-to-hire (one play-log entry per hold)
    const d0 = await mp.evaluate(() => ({ depth: HOARD.state.mines.depth, ore: HOARD.state.mines.ore, cost: HOARD.mines.depthCost(HOARD.state) }));
    await mp.locator('#panel .mn-shaft .btn').click(); await mp.waitForTimeout(250);
    const d1 = await mp.evaluate(() => HOARD.state.mines.depth);
    check(d0.ore >= d0.cost && d1 === d0.depth + 1, 'live save' + tag + ': Dig deeper goes one level deeper (' + d0.depth + ' -> ' + d1 + ')');
    const f0 = await mp.evaluate(() => HOARD.mines.forgeList(HOARD.state).filter(f => !f.done).sort((a, b) => a.cost - b.cost)[0]);
    await mp.locator('#panel .mn-forge .btn').first().click(); await mp.waitForTimeout(250);
    const f1 = await mp.evaluate((id) => HOARD.mines.forgeLevel(HOARD.state, id), f0.id);
    check(f1 === f0.lv + 1, 'live save' + tag + ': a Forge press buys one level of ' + f0.name + ' (' + f0.lv + ' -> ' + f1 + ')');
    await mp.evaluate(() => { HOARD.state.tiers[0] = 1e70; HOARD.state.settings.buyAmt = 1; HOARD.ui.markDirty(); });
    await mp.waitForTimeout(300);
    const h0 = await mp.evaluate(() => ({ h: HOARD.state.mines.hired[0], logs: HOARD.log.entries().filter(e => e.k === 'mines' && e.d && e.d.type === 'hire').length }));
    const hl = mp.locator('#panel .mn .card .btn.buy').filter({ hasText: 'Hire' }).first();
    await hl.scrollIntoViewIfNeeded(); await mp.waitForTimeout(200);
    const hb = await hl.boundingBox();
    await mp.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await mp.mouse.down(); await mp.waitForTimeout(1300); await mp.mouse.up();
    await mp.waitForTimeout(300);
    const h1 = await mp.evaluate(() => ({ h: HOARD.state.mines.hired[0], logs: HOARD.log.entries().filter(e => e.k === 'mines' && e.d && e.d.type === 'hire').map(e => e.d) }));
    check(h1.h - h0.h >= 3 && h1.logs.length === h0.logs + 1 && h1.logs[h1.logs.length - 1].n === h1.h - h0.h, 'live save' + tag + ': holding Hire hires ' + (h1.h - h0.h) + ' Pick Crews, logged once ' + JSON.stringify(h1.logs.slice(-1)));
    const tl = await mp.evaluate(() => HOARD.log.entries().filter(e => e.k === 'tab').map(e => e.d.id).join());
    check(/mines/.test(tl), 'live save' + tag + ': tab changes reach the play log (' + tl + ')');
    await textOk('live mines after presses' + tag, mp);
    await mp.locator('#tabs [data-tab="legend"]').click(); await mp.waitForTimeout(500);
    const al = await mp.evaluate(() => { const c = document.querySelector('#panel .lore-autolist'); const r = c && c.getBoundingClientRect(); return c ? { h: Math.round(r.height), rows: c.querySelectorAll('.lore-al-row').length, minRow: Math.min(...Array.from(c.querySelectorAll('.lore-al-row')).map(n => Math.round(n.getBoundingClientRect().height))), sw: document.documentElement.scrollWidth, iw: innerWidth } : null; });
    check(!!al && al.rows === 8 && al.minRow >= 44 && al.h <= 450 && al.sw <= al.iw, 'live save' + tag + ': owned automation is one compact card ' + JSON.stringify(al));
    await mp.evaluate(() => { const c = document.querySelector('#panel .lore-autolist'); if (c) c.scrollIntoView({ block: 'start' }); });
    await mp.waitForTimeout(200);
    await textOk('live legend' + tag, mp);
    const tt = await mp.evaluate(() => { const n = document.querySelector('[data-sec="legend.tithe"]'); return { can: HOARD.engine.canSleep(HOARD.state), t: n ? n.innerText : null }; });
    check(!tt.can || /^Mines: (this Sleep recruits|a Sleep recruits)/.test(tt.t || ''), 'live save' + tag + ': the Sleep panel says what the Sleep recruits (' + JSON.stringify(tt) + ')');
    await mp.screenshot({ path: SHOTS + '/live-legend' + tag + '.png' });
    await mp.locator('#tabs [data-tab="quests"]').click(); await mp.waitForTimeout(500);
    await textOk('live quests' + tag, mp);
    await mp.screenshot({ path: SHOTS + '/live-quests' + tag + '.png' });
    check(merr.length === 0, 'live save' + tag + ': no console/page errors' + (merr.length ? ':\n  ' + merr.join('\n  ') : ''));
    await mctx.close();
  }

  // ================================================================ v1 fixtures -> hoard.save.v1 -> load + reload
  const FIX = path.join(__dirname, 'fixtures');
  for (const f of fs.readdirSync(FIX).filter(n => /^v1-.*\.json$/.test(n)).sort()) {
    const raw = fs.readFileSync(path.join(FIX, f), 'utf8');
    const want = JSON.parse(raw);
    const fctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    const fp = await fctx.newPage();
    const ferr = [];
    fp.on('console', m => { if (m.type() === 'error') ferr.push('console: ' + m.text()); });
    fp.on('pageerror', e => ferr.push('pageerror: ' + (e.stack || e.message)));
    await fctx.addInitScript((r) => {
      try { if (!sessionStorage.getItem('__fx')) { localStorage.clear(); localStorage.setItem('hoard.save.v1', r); sessionStorage.setItem('__fx', '1'); } } catch (e) {}
    }, raw);
    const grab = () => fp.evaluate(() => { const s = HOARD.state; return { v: s.v, gold: s.gold, buildings: s.buildings, tiers: s.tiers, cards: s.cards, legend: s.legend, legendPts: s.legendPts, rank: s.rank, sleeps: s.sleeps,
      backup: (() => { try { return localStorage.getItem('hoard.save.backup.v1'); } catch (e) { return null; } })() }; });
    const same = (g, lbl) => {
      const bOk = Object.keys(want.buildings).every(k => g.buildings[k] === want.buildings[k]);
      const tOk = want.tiers.every((x, i) => g.tiers[i] >= x - 1e-6);
      const cOk = Object.keys(want.cards).every(k => g.cards[k] === want.cards[k]);
      check(g.v === 2 && g.gold >= want.gold - 1e-6 && bOk && tOk && cOk && g.legend === want.legend && g.legendPts === g.legend && g.rank === want.rank && g.sleeps === want.sleeps,
        f + ' ' + lbl + ': v' + g.v + ' rank ' + g.rank + ' legend ' + g.legend + ' pts ' + g.legendPts + ' buildings ' + (bOk ? 'ok' : JSON.stringify(g.buildings)) + ' tiers ' + (tOk ? 'ok' : 'BAD') + ' cards ' + (cOk ? 'ok' : 'BAD'));
    };
    await fp.goto(URL);
    await fp.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0.2);
    await fp.waitForTimeout(400);
    const g1 = await grab();
    same(g1, 'loaded');
    check(g1.backup === raw, f + ' raw v1 copy in hoard.save.backup.v1');
    await fp.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    await fp.reload();
    await fp.waitForFunction(() => window.HOARD && window.HOARD.state && window.HOARD.state.time > 0.2);
    await fp.waitForTimeout(400);
    same(await grab(), 'reloaded');
    const bad = (await fp.evaluate(() => document.body.innerText)).match(/.{0,30}\b(NaN|undefined|Infinity)\b.{0,30}/);
    check(!bad, f + ' no NaN/undefined text' + (bad ? ' -> "' + bad[0] + '"' : ''));
    check(ferr.length === 0, f + ' no console/page errors' + (ferr.length ? ':\n  ' + ferr.join('\n  ') : ''));
    if (f === 'v1-postsleep.json') {
      // the callout waits for open sheets: after a reload the "While you slept" welcome-back sheet can be up first
      // (about 3 runs in 10), so close it like a player would and wait for the callout instead of a fixed 2.6 s
      await fp.waitForFunction(() => {
        const t = document.getElementById('overlay').innerText;
        if (/Spend your Legend/.test(t)) return true;
        if (/While you slept/.test(t) && HOARD.ui && HOARD.ui.closeSheet) HOARD.ui.closeSheet();
        return false;
      }, null, { timeout: 10000, polling: 200 }).catch(() => {});
      check(/Spend your Legend/.test(await fp.evaluate(() => document.getElementById('overlay').innerText)), f + ' v1 player with unspent Legend gets the Lore callout');
    }
    await fctx.close();
  }

  // let it run a bit to catch tick-time errors
  await page.waitForTimeout(1500);
  check(errors.length === 0, 'no console/page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
  await browser.close();
  console.log(fails.length ? '\nSMOKE FAILED (' + fails.length + ')' : '\nSMOKE OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH', e); process.exit(2); });
