// The sim player's Mines habits (SPEC-MINES B12), shared by tools/sim.cjs and tools/sim-lore.cjs.
//   swipe(s, coins): 1 coin in 8 is an Ore nugget, so each swiped batch of coins also collects coins/8 nuggets
//   act(s, T, R):    once per second while the app is open:
//     - finishes a 'hire' quest when the Eggs for it are there (a player would);
//     - once a minute, hires miners while the next hire costs <= 10% of the Eggs (deepest open tier first);
//     - digs deeper when Shaft Depth costs <= 50% of the Ore, then buys the cheapest affordable Forge level.
//   R.mines collects the pacing numbers for the report (times are sim seconds).
'use strict';
module.exports = function (E, X) {
  const on = s => !!(X && X.isOpen(s));
  function swipe(s, coins) {
    if (!on(s) || !(coins > 0)) return 0;
    return X.nuggets(s, coins / X.C.nugEvery);
  }
  function rec(R) {
    return R.mines = R.mines || { openAt: null, openSleep: null, crewAt: null, forgeAt: null, tierAt: [null, null, null, null], tierSleep: [null, null, null, null],
      heartAt: null, forge2h: null, glow4h: null, quests: 0, hires: 0, nuggets: 0 };
  }
  function note(s, T, R) {
    const M = rec(R);
    if (!on(s)) return M;
    if (M.openAt == null) { M.openAt = T; M.openSleep = s.sleeps; }
    for (let k = 0; k < 4; k++) if (M.tierAt[k] == null && X.hired(s, k) > 0) { M.tierAt[k] = T; M.tierSleep[k] = s.sleeps; }
    if (M.crewAt == null && X.hired(s, 0) > 0) M.crewAt = T;
    const lv = X.forgeList(s).reduce((a, f) => a + f.lv, 0);
    if (M.forgeAt == null && lv > 0) M.forgeAt = T;
    if (M.heartAt == null && X.forgeLevel(s, 'heart') > 0) M.heartAt = T;
    if (T >= 7200 && M.forge2h == null) M.forge2h = lv;
    if (T >= 14400 && M.glow4h == null) M.glow4h = X.glow(s);
    return M;
  }
  function act(s, T, R) {
    const M = note(s, T, R);
    if (!on(s)) return;
    for (const m of s.missions || []) {
      if (!m || m.done || m.tpl !== 'hire') continue;
      const k = m.key, need = Math.ceil(m.target - X.hired(s, k));
      if (need > 0 && X.tierOpen(s, k) && X.hireCost(s, k, need) <= s.tiers[0] && X.hire(s, k, need)) M.hires += need;
    }
    if (M.lastHire == null || T - M.lastHire >= 60) {
      M.lastHire = T;
      for (let k = 3; k >= 0; k--) {
        let g = 0;
        while (g++ < 50 && X.tierOpen(s, k) && X.hireCost(s, k, 1) <= 0.1 * s.tiers[0] && X.hire(s, k, 1)) M.hires++;
      }
    }
    let g = 0;
    while (g++ < 20 && X.depthCost(s) > 0 && X.depthCost(s) <= 0.5 * X.ore(s) && X.dig(s)) { /* deeper */ }
    for (g = 0; g < 40; g++) {
      const fl = X.forgeList(s).filter(f => f.can).sort((a, b) => a.cost - b.cost);
      if (!fl.length || !X.forge(s, fl[0].id)) break;
    }
    note(s, T, R);
  }
  function claimed(R, tpl) { if (tpl === 'ore' || tpl === 'hire') rec(R).quests++; }
  const h = t => (t == null ? '-' : (t / 3600).toFixed(2) + 'h'), m = t => (t == null ? '-' : (t / 60).toFixed(1) + 'm');
  function report(R, s) {
    const M = rec(R);
    if (!X) return '';
    const after = t => (t == null || M.openAt == null ? '-' : m(t - M.openAt));
    return 'Mines: open ' + h(M.openAt) + ' (run ' + (M.openSleep == null ? '-' : M.openSleep + 1) + ')' +
      ' | first Crew hire +' + after(M.crewAt) + ', first Forge +' + after(M.forgeAt) +
      ' | first Cart/Borer/Delver +' + M.tierAt.slice(1).map(after).join('/') + ' (Sleep ' + M.tierSleep.slice(1).map(x => (x == null ? '-' : x)).join('/') + ')' +
      ' | Forge levels at 2h ' + (M.forge2h == null ? '-' : M.forge2h) + ', Heart ' + h(M.heartAt) +
      ' | glow at 4h ' + (M.glow4h == null ? '-' : 'x' + M.glow4h.toFixed(2)) + ', now x' + X.glow(s).toFixed(2) + ', Hearth x' + X.hearth(s).toFixed(2) +
      ' | Ore ' + E.util.pos(X.ore(s)).toExponential(2) + ', lifetime ' + X.all(s).toExponential(2) + ', depth ' + X.depth(s) + ', units ' + [0, 1, 2, 3].map(k => Math.floor(X.units(s, k))).join('/') + ', hired ' + [0, 1, 2, 3].map(k => X.hired(s, k)).join('/') +
      ' | Mines quests claimed ' + M.quests + ', bot hires ' + M.hires;
  }
  return { swipe, act, note, claimed, report };
};
