// Quest (mission) balance tracker shared by tools/sim.cjs and tools/sim-lore.cjs (rank-gate review 2026-11).
// Times every quest in PLAY seconds (app open) from the moment it appears to its claim and checks that
//   (a) the 3 slots never hold two activity quests (coins / gusts / treasures / streak) at once, and
//   (b) coins, gusts and 'Dig N Ore' quests take at most about what a gold quest (building / tier / earn / gps / Mines
//       'hire') takes at the
//       same rank: median <= max(FLOOR, 2 x gold median) per run bucket, and <= max(FLOOR, 2.5 x) per rank, and
//   (c) after the first run the slow tail stays short too: 90th percentile <= max(TAIL, 2.5 x the gold 90th
//       percentile) (code review 2026-11: one slow gold quest used to bring back 5-9 min coins quests).
'use strict';
const FLOOR = 90; // seconds: an activity quest may always ask for about a minute and a half of play
const TAIL = 180; // seconds: the 90th percentile of an activity quest after run 1
const GOLD = { building: 1, tier: 1, earn: 1, gps: 1, hire: 1 };
module.exports = function (E, D) {
  const ACT = {};
  D.missionTemplates.forEach(t => { if (t.act) ACT[t.tpl] = 1; });
  const st = R => (R.qb = R.qb || { play: 0, live: {}, done: [], pairs: 0, checks: 0 });
  function track(R, s, playDt) {
    const q = st(R);
    q.play += playDt || 0;
    for (const m of s.missions || []) if (m && !q.live[m.uid]) q.live[m.uid] = { tpl: m.tpl, rank: s.rank, run: (s.sleeps || 0) + 1, p0: q.play };
  }
  function claim(R, s, i) {
    const q = st(R), m = s.missions[i];
    const r = E.claimMission(s, i);
    if (r && r.ok && m) {
      const L = q.live[m.uid];
      if (L) { L.life = q.play - L.p0; q.done.push(L); delete q.live[m.uid]; }
      q.checks++;
      if (s.missions.filter(x => x && ACT[x.tpl]).length > 1) q.pairs++;
      track(R, s, 0);
    }
    return r;
  }
  const qt = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
  const med = a => qt(a, 0.5);
  const mn = x => x == null ? '   -' : (x / 60).toFixed(1).padStart(4);
  function report(R, buckets) {
    const q = st(R), fails = [];
    if (q.pairs) fails.push(q.pairs + ' of ' + q.checks + ' claims left two activity quests in the slots');
    console.log('quest balance (median PLAY min of claimed quests; coins / gusts / gold = building+tier+earn+gps):');
    for (const [name, lo, hi] of buckets) {
      const d = q.done.filter(x => x.run >= lo && x.run <= hi);
      if (!d.length) continue;
      const of = f => d.filter(f).map(x => x.life);
      const c = of(x => x.tpl === 'coins'), g = of(x => x.tpl === 'gusts'), o = of(x => GOLD[x.tpl]), ore = of(x => x.tpl === 'ore');
      const byRank = [];
      for (let rk = 1; rk <= 9; rk++) {
        const cr = of(x => x.rank === rk && x.tpl === 'coins'), gr = of(x => x.rank === rk && x.tpl === 'gusts'), orr = of(x => x.rank === rk && GOLD[x.tpl]);
        const ore = of(x => x.rank === rk && x.tpl === 'ore');
        if (!cr.length && !gr.length && !orr.length) continue;
        byRank.push('r' + rk + ' ' + mn(med(cr)).trim() + '/' + mn(med(gr)).trim() + '/' + mn(med(orr)).trim());
        if (orr.length >= 5) for (const [t, a] of [['coins', cr], ['gusts', gr], ['ore', ore]]) {
          if (a.length >= 5 && med(a) > Math.max(FLOOR, 2.5 * med(orr))) fails.push(name + ' rank ' + rk + ': ' + t + ' ' + mn(med(a)).trim() + ' min vs gold ' + mn(med(orr)).trim() + ' min');
        }
      }
      const gp = of(x => x.tpl === 'gps');
      console.log('  ' + name.padEnd(9) + ' coins ' + mn(med(c)) + ' p90 ' + mn(qt(c, 0.9)).trim() + ' (n ' + c.length + ')  gusts ' + mn(med(g)) + ' p90 ' + mn(qt(g, 0.9)).trim() + ' (n ' + g.length + ')  ore ' + mn(med(ore)) + ' (n ' + ore.length + ')  gold ' + mn(med(o)) + ' p90 ' + mn(qt(o, 0.9)).trim() + ' (n ' + o.length + ', gold/s ' + mn(med(gp)).trim() + ' p90 ' + mn(qt(gp, 0.9)).trim() + ')  | by rank c/g/gold: ' + byRank.join('  '));
      if (lo >= 2 && o.length >= 8) for (const [t, a] of [['coins', c], ['gusts', g], ['ore', ore]]) {
        if (a.length >= 10 && qt(a, 0.9) > Math.max(TAIL, 2.5 * qt(o, 0.9))) fails.push(name + ': ' + t + ' 90th percentile ' + mn(qt(a, 0.9)).trim() + ' min vs gold ' + mn(qt(o, 0.9)).trim() + ' min');
      }
      if (o.length >= 8) for (const [t, a] of [['coins', c], ['gusts', g], ['ore', ore]]) {
        if (a.length >= 8 && med(a) > Math.max(FLOOR, 2 * med(o))) fails.push(name + ': ' + t + ' ' + mn(med(a)).trim() + ' min vs gold ' + mn(med(o)).trim() + ' min');
      }
    }
    console.log('  activity-quest pairs after ' + q.checks + ' claims: ' + q.pairs + ' | ' + (fails.length ? 'QUEST BALANCE FAIL: ' + fails.join('; ') : 'QUEST BALANCE OK'));
    return fails;
  }
  return { track, claim, report };
};
