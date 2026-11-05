/* Hoard — js/ui-stats.js — Stats sheet (owner: POLISH agent, SPEC-V2.md section 4).
 * Two parts:
 *   HOARD.statsView  (pure, Node-safe): lifetime(state) -> rows, multipliers(state) -> per-source breakdown.
 *                    tools/test-polish.cjs runs it in a vm against the real engine.
 *   UI (browser only): a "Stats" settings row that opens a sheet with lifetime numbers and every multiplier. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});

  // ================================================================ pure part
  function fin(x, d) { x = +x; return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function pos(x) { x = fin(x, 0); return x > 0 ? x : 0; }
  function fmt(x) { return HOARD.fmt ? HOARD.fmt(pos(x)) : String(Math.floor(pos(x))); }
  function fmtTime(x) { return HOARD.fmtTime ? HOARD.fmtTime(pos(x)) : Math.floor(pos(x)) + 's'; }
  // multiplier text: 1.25, 3.4, 12, 340, 1.2K ...
  function mult(m) {
    m = fin(m, 1);
    if (m < 0) m = 0;
    if (m >= 1000) return fmt(m);
    if (m >= 100) return String(Math.round(m));
    if (m >= 10) return String(Math.round(m * 10) / 10);
    return String(Math.round(m * 100) / 100);
  }
  function px2m(px) { return pos(px) / 96 * 0.0254; }
  function distance(px) {
    var m = px2m(px);
    if (m >= 1000) return (m >= 1e5 ? fmt(m / 1000) : (Math.round(m / 10) / 100).toFixed(2)) + ' km';
    if (m >= 10) return Math.round(m) + ' m';
    return (Math.round(m * 10) / 10).toFixed(1) + ' m';
  }
  function cardsOwned(s) {
    var D = HOARD.data, n = 0, tot = 0;
    var cs = (D && D.cards) || [];
    for (var i = 0; i < cs.length; i++) { tot++; if (s && s.cards && pos(s.cards[cs[i].id]) >= 1) n++; }
    return { n: n, total: tot };
  }

  function lifetime(s) {
    s = s || {};
    var st = s.stat || {};
    var c = cardsOwned(s);
    var fast = pos(st.fastestSleep);
    var rows = [
      { id: 'earned', label: 'Total gold earned', value: fmt(s.earnedAll) },
      { id: 'coins', label: 'Coins swiped', value: fmt(st.coins) },
      { id: 'distance', label: 'Distance swiped', value: distance(st.swipePx) },
      { id: 'treasures', label: 'Treasures grabbed', value: fmt(st.treasures) },
      { id: 'gusts', label: 'Wing Gusts', value: fmt(st.gusts) },
      { id: 'streak', label: 'Best streak', value: '×' + mult(Math.max(1, fin(st.bestStreak, 1))) },
      { id: 'sleeps', label: 'Long Sleeps', value: fmt(s.sleeps) },
      { id: 'myths', label: 'Myths', value: fmt(s.myths) },
      { id: 'fastest', label: 'Fastest Sleep (active)', value: fast > 0 ? fmtTime(fast) : 'Not yet' },
      { id: 'play', label: 'Play time (active)', value: fmtTime(st.playActive) },
      { id: 'cards', label: 'Cards collected', value: c.n + '/' + c.total }
    ];
    return rows;
  }
  function thisRun(s) {
    s = s || {};
    var r = s.run || {};
    return [
      { id: 'runEarned', label: 'Gold earned', value: fmt(s.earnedRun) },
      { id: 'runPlay', label: 'Time awake (active)', value: fmtTime(r.playActive) },
      { id: 'runCoins', label: 'Coins swiped', value: fmt(r.coins) },
      { id: 'runRank', label: 'Dragon Rank', value: String(Math.max(1, Math.floor(fin(s.rank, 1)))) }
    ];
  }

  var LABELS = {
    legend: 'Legend', rank: 'Dragon Rank', upgrades: 'Lair upgrades', cards: 'Treasure cards',
    eventcards: 'Deep cards', lore: 'Lore', myth: 'Myth', mines: 'Mines (Forge glow and Hearth)', relics: 'Relics'
  };
  var ORDER = ['legend', 'myth', 'mines', 'lore', 'relics', 'cards', 'eventcards', 'upgrades', 'rank'];
  function labelOf(name) {
    if (LABELS[name]) return LABELS[name];
    var t = String(name || 'Other').replace(/[_-]+/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // weights for averaging per-building / per-tier multipliers: what actually produces right now
  function weights(s, st) {
    var D = HOARD.data || {}, bw = {}, tw = [0, 0, 0, 0, 0], bt = 0, tt = 0;
    (D.buildings || []).forEach(function (b) {
      var w = pos(st && st.buildingGps ? st.buildingGps[b.id] : 0);
      bw[b.id] = w; bt += w;
    });
    if (!(bt > 0)) (D.buildings || []).forEach(function (b) { bw[b.id] = 1; bt += 1; });
    for (var i = 1; i < 5; i++) { tw[i] = pos(s.tiers && s.tiers[i]) > 0 ? 1 : 0; tt += tw[i]; }
    if (!(tt > 0)) { tw = [0, 1, 1, 1, 1]; tt = 4; }
    return { b: bw, bt: bt, t: tw, tt: tt };
  }
  function summarize(name, M, W) {
    var bm = 0;
    for (var id in W.b) if (Object.prototype.hasOwnProperty.call(W.b, id)) {
      var x = M.buildingMult && M.buildingMult[id] !== undefined ? fin(M.buildingMult[id], 1) : 1;
      bm += x * W.b[id];
    }
    bm = W.bt > 0 ? bm / W.bt : 1;
    var tm = 0;
    for (var i = 1; i < 5; i++) tm += fin(M.tierMult && M.tierMult[i], 1) * W.t[i];
    tm = W.tt > 0 ? tm / W.tt : 1;
    var all = fin(M.allMult, 1);
    var gold = all * fin(M.gpsMult, 1) * bm;
    var coin = all * fin(M.coinMult, 1) * fin(M.coinFlat, 1);
    var minion = all * tm;
    var ex = [];
    var d = function (v, def) { return Math.abs(fin(v, def) - def) > 1e-9; };
    if (d(M.strokeMult, 1)) ex.push('Strokes ×' + mult(M.strokeMult));
    if (d(M.coinGpsPct, 0)) ex.push('Coins +' + (Math.round(fin(M.coinGpsPct, 0) * 1000) / 10) + '% of gold/s (the Nest bonus counts half)');
    if (d(M.legendGainMult, 1)) ex.push('Legend gain ×' + mult(M.legendGainMult));
    if (d(M.costMultBuilding, 1)) ex.push('Building cost ×' + mult(M.costMultBuilding));
    if (d(M.costMultTier, 1)) ex.push('Minion cost ×' + mult(M.costMultTier));
    if (Array.isArray(M.tierCostMult) && d(M.tierCostMult[0], 1)) ex.push('Egg cost ×' + mult(M.tierCostMult[0]));
    if (d(M.offlineCapAddH, 0)) ex.push('Offline cap +' + mult(M.offlineCapAddH) + 'h');
    if (d(M.offlineMult, 1)) ex.push('Offline gold ×' + mult(M.offlineMult));
    if (M.streakHigh) ex.push('×8 streak cap');
    if (d(M.streakRamp, 1)) ex.push('Streak builds ×' + mult(M.streakRamp) + ' faster');
    if (d(M.streakBonus, 1)) ex.push('Streak ×' + mult(M.streakBonus));
    if (d(M.treasureFreq, 1)) ex.push('Treasures ×' + mult(M.treasureFreq) + ' as often');
    if (d(M.frenzyDurAdd, 0)) ex.push('Frenzy +' + mult(M.frenzyDurAdd) + 's');
    if (d(M.frenzyMult, 1)) ex.push('Frenzy ×' + mult(M.frenzyMult));
    if (d(M.gustMult, 1)) ex.push('Gust gold ×' + mult(M.gustMult));
    if (d(M.gustCdMult, 1)) ex.push('Gust recharge ×' + mult(M.gustCdMult));
    if (d(M.gustCd, 45) && fin(M.gustCd, 45) < 45) ex.push('Gust recharge ' + mult(M.gustCd) + 's');
    if (d(M.chestCardsAdd, 0)) ex.push('+' + Math.floor(fin(M.chestCardsAdd, 0)) + ' card per chest');
    if (d(M.sweepRate, 0)) ex.push('Broom ' + mult(fin(M.sweepRate, 0) * fin(M.sweepMult, 1)) + ' coins/s');
    else if (d(M.sweepMult, 1)) ex.push('Broom ×' + mult(M.sweepMult));
    if (d(M.spillMult, 1)) ex.push('Coin spill ×' + mult(M.spillMult));
    var neutral = !d(gold, 1) && !d(coin, 1) && !d(minion, 1) && !ex.length;
    return { id: name, label: labelOf(name), gold: gold, coin: coin, minion: minion, all: all,
      goldText: '×' + mult(gold), coinText: '×' + mult(coin), minionText: '×' + mult(minion), extra: ex, neutral: neutral };
  }

  // per-source breakdown from E.modBreakdown, with the cards source split into treasure vs Deep cards
  function multipliers(s) {
    var E = HOARD.engine, D = HOARD.data || {};
    var res = { rows: [], total: null, effects: [] };
    if (!E || !s || typeof E.stats !== 'function') return res;
    var st = E.stats(s);
    var W = weights(s, st);
    var parts = typeof E.modBreakdown === 'function' ? E.modBreakdown(s) : [];
    var rows = [];
    parts.forEach(function (p) {
      if (!p || !p.M) return;
      if (p.name === 'cards' && typeof E.freshMods === 'function' && typeof E.levelFor === 'function') {
        var Mv1 = E.freshMods(), Mev = E.freshMods(), anyEv = false;
        (D.cards || []).forEach(function (c) {
          if (typeof c.mod !== 'function') return;
          var lv = E.levelFor(pos(s.cards && s.cards[c.id]));
          if (!(lv > 0)) return;
          var M = c.chest === false ? Mev : Mv1;
          if (c.chest === false) anyEv = true;
          try { c.mod(s, M, lv); } catch (e) { /* neutral */ }
        });
        rows.push(summarize('cards', Mv1, W));
        if (anyEv) rows.push(summarize('eventcards', Mev, W));
        return;
      }
      rows.push(summarize(p.name, p.M, W));
    });
    rows.sort(function (a, b) {
      var ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // Nest bonus (feel pass): the brood multiplies building gold/s; not a mod source, so it gets its own row.
    // Coins get C.broodCoin of it on their gold/s part only (shown as a note, the coin column stays x1)
    var nest = fin(st.broodMult, 1), bc = Math.max(0, Math.min(1, fin(D.C && D.C.broodCoin, 0)));
    var nx = nest > 1 + 1e-9 ? ['Nest of ' + (HOARD.fmt ? HOARD.fmt(fin(st.nestSize, 0)) : fin(st.nestSize, 0)) + ' Eggs'] : [];
    if (nx.length && bc > 0) nx.push('Coins: ×' + mult(Math.pow(nest, bc)) + ' on their gold/s part');
    rows.push({ id: 'nest', label: 'Nest bonus', gold: nest, coin: 1, minion: 1, all: 1, goldText: '×' + mult(nest), coinText: '×1', minionText: '×1',
      extra: nx, neutral: !(nest > 1 + 1e-9) });
    res.rows = rows;
    res.total = summarize('total', st.M, W);
    res.total.gold *= nest; res.total.goldText = '×' + mult(res.total.gold);
    res.total.label = 'Total';
    if (st.frenzyActive) res.effects.push({ id: 'frenzy', label: 'Gold Frenzy', text: 'gold/s ×' + mult(fin(D.C && D.C.frenzyMult, 7) * fin(st.M.frenzyMult, 1)) + ', ' + fmtTime(st.frenzyLeft) + ' left' });
    if (st.emberActive) res.effects.push({ id: 'ember', label: 'Ember Touch', text: 'coins and strokes ×' + mult(fin(D.C && D.C.emberMult, 10)) + ', ' + fmtTime(st.emberLeft) + ' left' });
    return res;
  }

  HOARD.statsView = { lifetime: lifetime, thisRun: thisRun, multipliers: multipliers, mult: mult, distance: distance, px2m: px2m, cardsOwned: cardsOwned };

  // ================================================================ UI part (browser only)
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui;
  if (!ui || typeof ui.addSetting !== 'function' || typeof ui.el !== 'function') return;
  var el = ui.el;

  function kvList(rows) {
    var box = el('div', 'st-list');
    var cells = {};
    rows.forEach(function (r) {
      var line = el('div', 'kv');
      var v = el('span', null, r.value);
      line.appendChild(el('span', null, r.label));
      line.appendChild(v);
      box.appendChild(line);
      cells[r.id] = v;
    });
    return { root: box, patch: function (rows2) { rows2.forEach(function (r) { if (cells[r.id]) ui.setText(cells[r.id], r.value); }); } };
  }

  // one source as a table row: name | gold/s | coins | brood, with its other effects underneath
  function multCard(r, isTotal) {
    var card = el('div', 'st-r' + (isTotal ? ' total' : ''));
    var g = el('b', null, r.goldText), c = el('b', null, r.coinText), m = el('b', null, r.minionText);
    card.appendChild(el('span', 'st-name', r.label));
    card.appendChild(g); card.appendChild(c); card.appendChild(m);
    var ex = el('div', 'st-ex');
    card.appendChild(ex);
    return {
      root: card,
      patch: function (r2) {
        ui.setText(g, r2.goldText); ui.setText(c, r2.coinText); ui.setText(m, r2.minionText);
        ui.setCls(g, 'up', r2.gold > 1.0001); ui.setCls(c, 'up', r2.coin > 1.0001); ui.setCls(m, 'up', r2.minion > 1.0001);
        ui.setCls(g, 'down', r2.gold < 0.9999); ui.setCls(c, 'down', r2.coin < 0.9999); ui.setCls(m, 'down', r2.minion < 0.9999);
        ui.setText(ex, r2.extra.join(' \u00b7 '));
        ui.setHidden(ex, !r2.extra.length);
      }
    };
  }
  function multHead() {
    var h = el('div', 'st-r st-h');
    ['Source', 'Gold/s', 'Coins', 'Brood'].forEach(function (t) { h.appendChild(el('span', null, t)); });
    return h;
  }

  function openStats() {
    var s0 = ui.state();
    if (!s0) return;
    var box = el('div', 'st-sheet');
    var head = el('div', 'sheet-head');
    head.appendChild(el('h3', null, 'Stats'));
    var back = ui.button('ghost small', 'Back', function () { if (ui.openSettings) ui.openSettings(); else ui.closeSheet(); });
    head.appendChild(back);
    box.appendChild(head);

    box.appendChild(ui.secHead('Lifetime'));
    var life = kvList(lifetime(s0));
    box.appendChild(life.root);

    box.appendChild(ui.secHead('This run'));
    var run = kvList(thisRun(s0));
    box.appendChild(run.root);

    box.appendChild(ui.secHead('Multipliers'));
    box.appendChild(el('p', 'hint st-hint', 'What each source multiplies right now. Gold/s is building gold, Brood is minion output. Sources multiply together.'));
    var mhost = el('div', 'st-mults');
    box.appendChild(mhost);
    var effHost = el('div', 'st-eff');
    box.appendChild(effHost);
    var mcards = {}, totalCard = null, key = '', empty = el('p', 'hint', 'No bonuses yet. Legend, cards and Lore show up here.');

    function rebuild(res) {
      mhost.innerHTML = '';
      mcards = {};
      var shown = res.rows.filter(function (r) { return !r.neutral; });
      if (!shown.length) { mhost.appendChild(empty); totalCard = null; return; }
      mhost.appendChild(multHead());
      shown.forEach(function (r) { var c = multCard(r, false); mcards[r.id] = c; mhost.appendChild(c.root); c.patch(r); });
      if (res.total && shown.length) { totalCard = multCard(res.total, true); mhost.appendChild(totalCard.root); totalCard.patch(res.total); }
      else totalCard = null;
    }
    function patch(s) {
      if (!s) return;
      life.patch(lifetime(s));
      run.patch(thisRun(s));
      var res = multipliers(s);
      var k = res.rows.filter(function (r) { return !r.neutral; }).map(function (r) { return r.id; }).join(',');
      if (k !== key) { key = k; rebuild(res); }
      else {
        res.rows.forEach(function (r) { if (mcards[r.id]) mcards[r.id].patch(r); });
        if (totalCard && res.total) totalCard.patch(res.total);
      }
      var et = res.effects.map(function (e) { return e.label + ': ' + e.text; }).join('\n');
      ui.setText(effHost, et);
      ui.setHidden(effHost, !et);
    }
    patch(s0);
    ui.sheet(box, { full: true, cls: 'st-stats', patch: function (s) { patch(s); } });
  }

  ui.addSetting({ id: 'stats', order: 40, build: function (host) {
    var r = el('div', 'toggle-row st-row');
    var lab = el('span', 'tl');
    lab.appendChild(el('span', null, 'Stats'));
    var sub = el('small', 'sub', 'Lifetime numbers and every multiplier');
    lab.appendChild(sub);
    var b = ui.button('small', 'Open', function () { openStats(); });
    b.setAttribute('aria-label', 'Open stats');
    r.appendChild(lab); r.appendChild(b);
    host.appendChild(r);
  } });

  ui.css(
    '.st-sheet .sec-head{margin-top:16px}' +
    '.st-sheet .st-hint{margin:2px 0 8px;font-size:13px}' +
    '.st-list .kv span:first-child{color:var(--ink-dim)}' +
    '.st-list .kv span:last-child{color:var(--ink)}' +
    '.st-mults{border-radius:var(--radius);border:1px solid var(--line-2);background:linear-gradient(170deg,var(--rock-2),var(--rock));overflow:hidden}' +
    '.st-mults>.hint{margin:0;padding:12px}' +
    '.st-r{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(0,1fr));column-gap:8px;align-items:baseline;padding:9px 12px;border-top:1px solid var(--line)}' +
    '.st-r:first-child{border-top:0}' +
    '.st-h{padding:7px 12px;background:rgba(0,0,0,.18)}' +
    '.st-h span{font-size:12px;color:var(--ink-faint);letter-spacing:.04em;text-transform:uppercase}' +
    '.st-h span:not(:first-child),.st-r b{text-align:right}' +
    '.st-name{font-weight:700;font-size:15px;line-height:1.25;color:var(--ink);min-width:0;overflow-wrap:anywhere}' +
    '.st-r b{font-variant-numeric:tabular-nums;font-size:15px;color:var(--ink-faint);font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.st-r b.up{color:var(--gold);font-weight:700}' +
    '.st-r b.down{color:var(--moss)}' +
    '.st-ex{grid-column:1/-1;margin-top:3px;font-size:13px;line-height:1.35;color:var(--ink-dim)}' +
    '.st-r.total{border-top:1px solid var(--gold-lo);background:linear-gradient(170deg,rgba(242,184,75,.13),rgba(242,184,75,.03));padding-top:11px;padding-bottom:11px}' +
    '.st-r.total .st-name{font-family:var(--font-d);font-size:21px;font-weight:600;color:var(--gold-hi)}' +
    '.st-r.total b{font-size:17px}' +
    '.st-r.total b.up{color:var(--gold-hi)}' +
    '.st-eff{margin-top:10px;padding:8px 12px;border-radius:var(--radius);border:1px solid rgba(232,99,58,.4);color:var(--ember);font-size:14px;white-space:pre-line}',
    'stats');
})();
