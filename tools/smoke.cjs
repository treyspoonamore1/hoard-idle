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
  await hold(loreBtn("Dragon's Greed"), 1200);
  check(await page.evaluate(() => (HOARD.state.lore.greed || 0) >= 2), "hold-to-buy repeats on a multi-level node (Dragon's Greed lv " + await page.evaluate(() => HOARD.state.lore.greed || 0) + ')');
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

  // --- Ember: Wake Ember lore -> 6th tab, buy a kiln
  check(!(await page.locator('#tabs [data-tab="ember"]').count()), 'no Ember tab before Wake Ember');
  await page.evaluate(() => { HOARD.state.legendPts += 12; });
  await page.waitForTimeout(300);
  await hold(loreBtn('Wake Ember'), 250);
  await page.waitForTimeout(800);
  check(await page.evaluate(() => HOARD.state.lore.wake_ember === 1 && HOARD.ember.isAwake(HOARD.state)), 'Wake Ember wakes Ember');
  check(await page.locator('#tabs [data-tab="ember"]').count() === 1, 'Ember tab appears');
  await tab('ember');
  const ek0 = await page.evaluate(() => HOARD.state.ember.kilns[0]);
  await hold(page.locator('#panel .card button.buy').first(), 250);
  check(await page.evaluate(() => HOARD.state.ember.kilns[0]) > ek0, 'bought a Coal Kiln with embers');
  check(/warmth/i.test(await panelText()), 'Ember tab shows warmth');
  await textOk('ember');
  await page.screenshot({ path: SHOTS + '/smoke-ember.png' });

  // --- event lair: chip -> full-height sheet, buy a tier-1 unit
  const chipVis = await page.evaluate(() => { const c = document.querySelector('[data-chip="events"]'); return !!c && !c.hidden && c.textContent; });
  check(!!chipVis && /Lair|Peak|Ship|Next lair/.test(chipVis), 'event chip visible after a Sleep: "' + chipVis + '"');
  check(await page.evaluate(() => { const c = document.querySelector('[data-chip="events"]'); return /ev-(volcano|frost|sea|break)|ev-/.test(c.className); }), 'event chip carries its theme class (chip classes hook)');
  await page.locator('[data-chip="events"]').click(); await page.waitForTimeout(500);
  check(await page.evaluate(() => !!document.querySelector('#overlay .sheet.ev-sheet')), 'event chip opens the lair sheet');
  if (await page.evaluate(() => HOARD.events.active(HOARD.state))) {
    const u0 = await page.evaluate(() => HOARD.state.events.units[0]);
    await hold(page.locator('#overlay .card.ev-unit button.buy').last(), 250);
    check(await page.evaluate(() => HOARD.state.events.units[0]) > u0, 'bought a lair tier-1 unit');
  }
  await textOk('lair sheet');
  await page.screenshot({ path: SHOTS + '/smoke-event-sheet.png' });
  await page.locator('#overlay button').filter({ hasText: 'Close' }).first().click(); await page.waitForTimeout(300);
  check(!(await ovOpen()), 'lair sheet closes');
  await tab('quests');
  check(await page.evaluate(() => !!document.querySelector('[data-sec="quests.eventBanner"]') && document.querySelector('[data-sec="quests.eventBanner"]').innerText.length > 0), 'event banner on the Quests tab');

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
  check(tb.n === 6 && tb.ids.join() === 'lair,brood,quests,hoard,legend,ember' && tb.clipped === 0 && tb.minW >= 48 && tb.sw <= 360, '6 tabs fit at 360px ' + JSON.stringify(tb));
  for (const t of tb.ids) {
    await tab(t);
    await textOk(t + ' @360');
    await page.screenshot({ path: SHOTS + '/smoke360-' + t + '.png' });
  }
  await page.setViewportSize({ width: 412, height: 915 });

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
