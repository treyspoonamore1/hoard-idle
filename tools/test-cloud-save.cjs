// Cloud-save safety test: a browser where localStorage does NOT survive between visits (as seen in the
// real playtest log), with a fake window.claude db kept in Node so it persists across page loads.
// Run: NODE_PATH=/opt/node-tools/node_modules node tools/test-cloud-save.cjs
const path = require('path');
const { chromium } = require('playwright');
const URL = 'file://' + path.join(__dirname, '..', 'dev.html');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL', m); } }

const db = {};            // docPath -> data
let getDelay = 1500, failGets = false, writes = [];

async function page(browser, { clearLocal = true, local = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await p.exposeFunction('__dbGet', async (k) => { await new Promise(r => setTimeout(r, getDelay)); if (failGets) throw new Error('offline'); return db[k] === undefined ? null : JSON.stringify(db[k]); });
  await p.exposeFunction('__dbSet', async (k, v) => { db[k] = JSON.parse(v); writes.push(k); return true; });
  await p.addInitScript(({ clearLocal, local }) => {
    if (clearLocal) { try { localStorage.clear(); } catch (e) {} }
    if (local) { try { localStorage.setItem('hoard.save.v1', local); } catch (e) {} }
    const doc = (k) => ({
      get: async () => { const v = await window.__dbGet(k); const d = v ? JSON.parse(v) : null; return { exists: !!d, data: () => d }; },
      set: async (d) => window.__dbSet(k, JSON.stringify(d)),
    });
    const dbApi = { collection: (c) => ({ doc: (id) => doc(c + '/' + id) }) };
    window.claude = { use: async (n) => n === 'db' ? dbApi : n === 'user' ? { id: async () => 'u_test' } : null };
  }, { clearLocal, local });
  await p.goto(URL);
  await p.waitForFunction(() => window.HOARD && window.HOARD.state);
  return { p, ctx, errors };
}
const st = (p) => p.evaluate(() => { const s = HOARD.state; return { sleeps: s.sleeps, legend: s.legend, rank: s.rank, play: s.stat.playActive, gold: s.gold }; });
const sheetText = (p) => p.evaluate(() => { const e = HOARD.ui.sheetEl && HOARD.ui.sheetEl(); return e ? e.textContent : ''; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();

  // 1. first visit: play to a Sleep, save now -> cloud has it
  let A = await page(browser);
  await wait(getDelay + 500);
  await A.p.evaluate(() => { const s = HOARD.state; s.sleeps = 1; s.legend = 3; s.legendPts = 1; s.stat.playActive = 2400; s.earnedAll = 1.4e7; s.gold = 5e5; });
  await A.p.evaluate(() => new Promise(r => HOARD.ui._test_saveNow ? r() : r()));
  // press Save now through Settings
  await A.p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /settings/i.test(x.getAttribute('aria-label') || '')); b && b.click(); });
  await wait(300);
  let btn = A.p.locator('button', { hasText: 'Save now' });
  ok(await btn.count() === 1, 'Save now button present');
  await btn.first().click();
  await wait(400);
  ok(/Cloud save: on/.test(await sheetText(A.p)), 'status line says cloud on: ' + (await sheetText(A.p)).match(/Cloud save:[^.]*\./));
  const saved = db['data/users/u_test/save'];
  ok(saved && JSON.parse(saved.json).sleeps === 1, 'cloud has the Sleep-1 save');
  ok(A.errors.length === 0, 'no errors visit 1: ' + A.errors.join(' | '));
  await A.ctx.close();

  // 2. second visit, localStorage wiped, player swipes before the cloud answers -> cloud save still loads
  let B = await page(browser);
  await B.p.mouse.move(100, 400); await B.p.mouse.down(); await B.p.mouse.move(300, 420, { steps: 5 }); await B.p.mouse.up();
  await wait(getDelay + 800);
  let s2 = await st(B.p);
  ok(s2.sleeps === 1 && s2.legend === 3, 'empty device adopts cloud save even after input: ' + JSON.stringify(s2));
  ok(!/further along|different save/i.test(await sheetText(B.p)), 'no question asked for an empty device');
  ok(B.errors.length === 0, 'no errors visit 2: ' + B.errors.join(' | '));
  const goodJson = await B.p.evaluate(() => HOARD.engine.serialize(HOARD.state));
  await B.ctx.close();

  // 3. a device with its own, newer but less-far-along save: ask, show both; Keep -> cloud backed up first
  const lesser = await (async () => { const C0 = await page(browser); await wait(getDelay + 300);
    const j = await C0.p.evaluate(() => { const s = HOARD.engine.newState(); s.stat.playActive = 300; s.savedAt = Date.now() + 60000; return HOARD.engine.serialize(s); });
    await C0.ctx.close(); return j; })();
  db['data/users/u_test/save'] = { json: goodJson, savedAt: JSON.parse(goodJson).savedAt };
  delete db['data/users/u_test/save_backup'];
  let C = await page(browser, { local: lesser });
  await C.p.mouse.click(200, 400);
  await wait(getDelay + 800);
  let txt = await sheetText(C.p);
  if (!/further along/.test(txt)) { // a welcome-back or other sheet may be first: close it and let the question reshow
    await C.p.keyboard.press('Escape'); await wait(500); txt = await sheetText(C.p);
  }
  ok(/further along/.test(txt) && /1 Sleep/.test(txt) && /This device/.test(txt), 'question shows both saves: ' + txt.slice(0, 200));
  await C.p.locator('button', { hasText: "Keep this device" }).first().click();
  await wait(800);
  const bk = db['data/users/u_test/save_backup'];
  ok(bk && JSON.parse(bk.json).sleeps === 1, 'further-along cloud save was backed up before overwrite');
  ok(JSON.parse(db['data/users/u_test/save'].json).sleeps === 0, 'cloud now holds the kept device save');
  // 4. restore the backup from Settings
  await C.p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /settings/i.test(x.getAttribute('aria-label') || '')); b && b.click(); });
  await wait(300);
  await C.p.locator('button', { hasText: 'Cloud backup' }).first().click();
  await wait(getDelay + 500);
  ok(/Restore the cloud backup/.test(await sheetText(C.p)), 'restore confirm shown');
  await C.p.locator('button', { hasText: 'Restore backup' }).first().click();
  await wait(1200);
  let s4 = await st(C.p);
  ok(s4.sleeps === 1 && s4.legend === 3, 'backup restored: ' + JSON.stringify(s4));
  ok(JSON.parse(db['data/users/u_test/save_backup'].json).sleeps === 0, 'replaced copy became the new backup');
  ok(JSON.parse(db['data/users/u_test/save'].json).sleeps === 1, 'restored save written to cloud');
  ok(C.errors.length === 0, 'no errors visit 3: ' + C.errors.join(' | '));
  await C.ctx.close();

  // 5. cloud unreachable: never writes, status explains
  failGets = true; getDelay = 50; writes = [];
  let D = await page(browser);
  await wait(800);
  await D.p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /settings/i.test(x.getAttribute('aria-label') || '')); b && b.click(); });
  await wait(300);
  ok(/Cloud save: Could not reach/.test(await sheetText(D.p)), 'status shows unreachable: ' + (await sheetText(D.p)).match(/Cloud save:[^.]*\./));
  await D.p.locator('button', { hasText: 'Save now' }).first().click();
  await wait(300);
  ok(!writes.includes('data/users/u_test/save'), 'no blind cloud write when the read failed');
  await D.ctx.close();

  await browser.close();
  console.log(fail ? `CLOUD-SAVE FAIL: ${fail} failed, ${pass} passed` : `CLOUD-SAVE OK: ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
