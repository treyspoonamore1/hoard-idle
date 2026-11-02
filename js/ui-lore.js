/* Hoard — js/ui-lore.js — Legend tab: Legend header, Lore tree, Myth (Ascend), Relics, automation toggles,
 * the "Auto" chip, Restless Wings (auto gust) and the one-time "Spend your Legend" callout. SPEC-V2 section 1.
 * UI feature module, loaded after ui.js. Codes against EXTENSIONS.md. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui, E = HOARD.engine, L = HOARD.lore;
  if (!ui || !E || !L || typeof ui.addSection !== 'function') return;
  var fmt = HOARD.fmt, el = ui.el, add = ui.add, setText = ui.setText, setCls = ui.setCls, setHidden = ui.setHidden;

  function num(x, d) { x = +x; return isFinite(x) ? x : (d || 0); }
  function legendWord(n) { return Math.floor(num(n)) === 1 ? 'Legend' : 'Legend'; }
  var ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
  function roman(n) { return ROMAN[n] || String(n); }

  ui.css([
    '.lore-head { background: linear-gradient(160deg, #2f2346 0%, var(--rock) 60%, #1d1927 100%); border-color: rgba(194,124,255,0.35); }',
    '.lore-head .lore-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }',
    '.lore-head .lore-pts { font-family: var(--font-d); font-size: 44px; line-height: 0.95; color: var(--r-epic); font-variant-numeric: tabular-nums; }',
    '.lore-head .lore-pts-l { color: var(--ink-dim); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }',
    '.lore-head .lore-mult { text-align: right; color: var(--ink-dim); font-size: 14px; line-height: 1.35; font-variant-numeric: tabular-nums; }',
    '.lore-head .lore-mult b { color: var(--ink); }',
    '.lore-head .lore-go { margin-top: 10px; }',
    '.lore-head .toggle-row { min-height: 48px; border-bottom: 0; border-top: 1px solid var(--line); margin-top: 10px; }',
    '.lore-branch { margin: 18px 0 8px; }',
    '.lore-branch .sec-head { margin: 0 0 2px; }',
    '.lore-branch .hint { margin: 0 0 8px; font-size: 13px; }',
    '.lore-node { padding: 10px 12px; }',
    '.lore-node .name { font-size: 16px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }',
    '.lore-node .lore-lv { font-size: 12px; font-weight: 700; color: var(--r-epic); letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }',
    '.lore-node .lore-eff { color: var(--ink-dim); font-size: 14px; margin-top: 2px; line-height: 1.3; }',
    '.lore-node .lore-eff b { color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; }',
    '.lore-node .lore-eff .lore-arrow { color: var(--gold); padding: 0 3px; }',
    '.lore-node .lore-req { color: var(--ink-faint); font-size: 13px; margin-top: 3px; }',
    '.lore-node .btn { min-width: 92px; }',
    '.lore-node .btn.buy.can { background: linear-gradient(180deg, #e7c8ff, var(--r-epic) 60%, #9b58d6); color: #1e0b2e; border-color: #f0dcff; box-shadow: 0 2px 10px rgba(194,124,255,0.25); }',
    '.lore-node.locked-n { opacity: 0.62; border-style: dashed; background: transparent; }',
    '.lore-node.maxed { border-color: rgba(194,124,255,0.35); }',
    '.lore-node .lore-own { min-width: 92px; text-align: center; font-size: 13px; font-weight: 700; color: var(--moss); text-transform: uppercase; letter-spacing: 0.08em; }',
    '.lore-node .toggle-row { min-height: 44px; border-bottom: 0; border-top: 1px solid var(--line); margin-top: 8px; font-size: 14px; color: var(--ink-dim); }',
    '.lore-node .lore-slider { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 14px; color: var(--ink-dim); }',
    '.lore-node .lore-slider input { flex: 1 1 auto; accent-color: var(--r-epic); height: 32px; touch-action: pan-y; }',
    '.lore-node .lore-slider b { color: var(--ink); min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; }',
    '.lore-myth { background: linear-gradient(160deg, #3a2a18 0%, var(--rock) 60%, #1d1927 100%); border-color: rgba(255,224,138,0.3); }',
    '.lore-myth .big-num { color: var(--gold-hi); }',
    '.lore-myth p { margin: 0 0 8px; }',
    '.chip.lore-auto { color: var(--moss); border-color: rgba(127,194,155,0.5); }',
    '.chip.lore-auto.off { color: var(--ink-faint); border-color: var(--line-2); }',
    '.lore-call h3 { color: var(--r-epic); }',
    '.lore-call ul { margin: 6px 0 10px; padding-left: 18px; color: var(--ink-dim); }',
    '.lore-call li { margin: 3px 0; }',
    '.lore-call li b { color: var(--ink); }'
  ].join('\n'), 'ui-lore');

  // ================================================================ helpers
  function S() { return ui.state(); }
  function branchNodes(b) { return L.nodes.filter(function (n) { return n.branch === b; }); }
  function scrollToSec(id) {
    try {
      var n = document.querySelector('[data-sec="legend.' + id + '"]');
      if (n && n.scrollIntoView) n.scrollIntoView({ block: 'start', behavior: ui.reducedMotion() ? 'auto' : 'smooth' });
    } catch (e) { /* ignore */ }
  }
  function goLore() {
    ui.setTab('legend');
    setTimeout(function () { scrollToSec(firstLoreSec()); }, 60);
  }
  function firstLoreSec() { return 'lore-' + L.branches[0].id; }
  // throttled purchase toast (hold-to-buy repeats would flood the queue)
  var lastToast = { id: '', t: 0 };
  function boughtToast(name, level, max, isRelic) {
    var t = Date.now();
    if (lastToast.id === name && t - lastToast.t < 1500) { lastToast.t = t; return; }
    lastToast = { id: name, t: t };
    ui.toast(isRelic ? 'Relic claimed' : 'Lore learned', name + (max > 1 ? ' ' + roman(level) : ''), 'gold');
  }

  // effect line: "Coin and stroke worth ×1.25 → ×1.5" (or the plain description)
  function effectNodes() {
    var box = el('div', 'lore-eff');
    var what = el('span'), now = el('b'), arrow = el('span', 'lore-arrow', '→'), next = el('b'), plain = el('span');
    add(box, what, now, arrow, next, plain);
    box.patch = function (s, id, isRelic) {
      var e = L.effect(s, id), lvl = isRelic ? L.relicLevel(s, id) : L.level(s, id);
      var d = isRelic ? L.relic(id) : L.node(id);
      if (e) {
        setText(what, e.what + ' ');
        setText(now, e.now);
        setHidden(arrow, e.next === null); setHidden(next, e.next === null);
        if (e.next !== null) setText(next, e.next);
        setHidden(plain, true);
        setHidden(what, false); setHidden(now, false);
      } else {
        setHidden(what, true); setHidden(now, true); setHidden(arrow, true); setHidden(next, true);
        setHidden(plain, false);
        var txt = L.describe(id, Math.max(1, lvl));
        if (d && d.max > 1 && lvl > 0 && lvl < d.max) txt = 'Now: ' + L.describe(id, lvl) + ' Next: ' + L.describe(id, lvl + 1);
        setText(plain, txt);
      }
    };
    return box;
  }

  // ================================================================ one Lore node card
  function nodeCard(n, parts) {
    var c = el('div', 'card lore-node');
    var row = el('div', 'row');
    var g = el('div', 'grow');
    var name = el('div', 'name');
    var nm = el('span', null, n.name), lvl = el('span', 'lore-lv');
    add(name, nm, lvl);
    var eff = effectNodes();
    var req = el('div', 'lore-req');
    add(g, name, eff, req);
    var btn = ui.buyButton();
    btn.classList.add('small');
    var own = el('div', 'lore-own', 'Owned');
    ui.bindHold(btn, function () {
      var s = S();
      if (!s || !L.buy(s, n.id)) return false;
      boughtToast(n.name, L.level(s, n.id), n.max, false);
      return true;
    });
    add(row, g, btn, own);
    c.appendChild(row);
    var tg = null;
    if (n.toggle) {
      tg = ui.toggle('Working', function (s) { return L.keyOn(s, 'n:' + n.id); }, function (s, v) { L.setAuto(s, 'n:' + n.id, v); });
      c.appendChild(tg.row);
    }
    // Dream Keeper: on/off + threshold slider
    var dk = null;
    if (n.id === 'auto_sleep') {
      dk = { t: ui.toggle('Sleep by itself', function (s) { return !!(s.auto && s.auto.sleep === true); }, function (s, v) { L.setAuto(s, 'sleep', !!v); }) };
      var sl = el('label', 'lore-slider');
      var inp = el('input');
      inp.type = 'range'; inp.min = '25'; inp.max = '300'; inp.step = '25';
      inp.setAttribute('aria-label', 'Sleep when the Legend gain reaches this share of your Legend');
      var val = el('b');
      add(sl, el('span', null, 'when gain ≥'), inp, val);
      inp.addEventListener('input', function () {
        var s = S(); if (!s) return;
        L.setAuto(s, 'sleepPct', Math.max(25, Math.min(300, Math.round(num(inp.value, 100)))));
        setText(val, L.autoSleepPct(s) + '%');
      });
      dk.sl = sl; dk.inp = inp; dk.val = val;
      add(c, dk.t.row, sl);
    }
    parts.push(function (s) {
      var l = L.level(s, n.id), cost = L.cost(s, n.id), met = L.reqMet(s, n.id);
      var maxed = cost === null;
      setText(lvl, n.max > 1 ? 'Lv ' + l + '/' + n.max : '');
      setCls(c, 'maxed', maxed);
      setCls(c, 'locked-n', !met);
      eff.patch(s, n.id, false);
      var reqN = n.req ? L.node(n.req) : null;
      setHidden(req, met || !reqN);
      if (!met && reqN) setText(req, 'Needs ' + reqN.name);
      setHidden(btn, maxed);
      setHidden(own, !maxed);
      if (!maxed) {
        var can = met && num(s.legendPts) + 1e-9 >= cost;
        setCls(btn, 'can', can);
        setText(btn.l, l > 0 ? 'Level up' : 'Learn');
        setText(btn.s, fmt(cost) + ' ' + legendWord(cost));
      }
      setText(own, n.max > 1 ? 'Mastered' : 'Owned');
      if (tg) { setHidden(tg.row, l < 1); tg.patch(s); }
      if (dk) {
        setHidden(dk.t.row, l < 1); dk.t.patch(s);
        var on = l >= 1 && !!(s.auto && s.auto.sleep === true);
        setHidden(dk.sl, !on);
        if (on) {
          var p = L.autoSleepPct(s);
          if (document.activeElement !== dk.inp && String(dk.inp.value) !== String(p)) dk.inp.value = String(p);
          setText(dk.val, p + '%');
        }
      }
    });
    return c;
  }

  // ================================================================ sections
  // header (order 5): Legend to spend, earned, bonus, Myth bonus, master automation switch
  ui.removeSection('legend', 'legendinfo');
  ui.addSection('legend', {
    id: 'lorehead', order: 5,
    key: function (s) { return L.anyAutoOwned(s) ? 'A' : 'a'; },
    badge: function (s) { return L.anyAffordable(s) ? true : 0; },
    build: function (host, s) {
      var c = el('div', 'card lore-head');
      var top = el('div', 'lore-top');
      var left = el('div');
      var pts = el('div', 'lore-pts');
      add(left, el('div', 'lore-pts-l', 'Legend to spend'), pts);
      var right = el('div', 'lore-mult');
      var r1 = el('div'), r2 = el('div'), r3 = el('div');
      add(right, r1, r2, r3);
      add(top, left, right);
      c.appendChild(top);
      var go = ui.button('wide lore-go', 'Spend it on Lore', function () { scrollToSec(firstLoreSec()); });
      c.appendChild(go);
      var master = null;
      if (L.anyAutoOwned(s)) {
        master = ui.toggle('Automation', function (st) { return L.masterOn(st); }, function (st, v) { L.setAuto(st, 'master', !!v); }, 'Every automation Lore at once');
        c.appendChild(master.row);
      }
      host.appendChild(c);
      return function (st, stats) {
        setText(pts, fmt(st.legendPts));
        var r1h = 'Earned this Myth <b>' + fmt(st.legend) + '</b>';
        if (r1._h !== r1h) { r1._h = r1h; r1.innerHTML = r1h; }
        setText(r2, 'Passive ×' + ui.multStr(stats.legendMult) + ' to everything');
        setHidden(r3, !(num(st.myth) > 0));
        if (num(st.myth) > 0) setText(r3, 'Myth ' + fmt(st.myth) + ': gold ×' + ui.multStr(L.mythMult(st)));
        var n = L.affordableCount(st);
        setHidden(go, n < 1);
        setCls(go, 'can', n > 0);
        if (n > 0) setText(go, n === 1 ? '1 Lore you can learn now' : n + ' Lore you can learn now');
        if (master) master.patch(st);
      };
    }
  });

  // Lore branches (orders 20, 22, 24, 26)
  L.branches.forEach(function (b, bi) {
    var nodes = branchNodes(b.id);
    ui.addSection('legend', {
      id: 'lore-' + b.id, order: 20 + 2 * bi,
      // rebuild only when a node's prerequisite or max state changes; numbers are patched
      key: function (s) {
        var k = '';
        for (var i = 0; i < nodes.length; i++) k += (L.reqMet(s, nodes[i].id) ? '1' : '0') + (L.cost(s, nodes[i].id) === null ? 'm' : '');
        return k;
      },
      build: function (host) {
        var parts = [];
        var wrap = el('div', 'lore-branch');
        var head = ui.secHead(bi === 0 ? 'Lore · ' + b.name : b.name, '');
        add(wrap, head, el('p', 'hint', b.text));
        host.appendChild(wrap);
        nodes.forEach(function (n) { host.appendChild(nodeCard(n, parts)); });
        return function (s, st) {
          var own = 0;
          for (var i = 0; i < nodes.length; i++) if (L.level(s, nodes[i].id) > 0) own++;
          setText(head.aside, own + ' of ' + nodes.length + ' learned');
          for (var j = 0; j < parts.length; j++) parts[j](s, st);
        };
      }
    });
  });

  // Myth (order 40): visible once The First Myth is learned (or after any Ascend)
  ui.addSection('legend', {
    id: 'myth', order: 40,
    visible: function (s) { return L.mythGated(s) || num(s.myths) > 0; },
    badge: function (s) { return L.canAscend(s) ? true : 0; },
    build: function (host) {
      host.appendChild(ui.secHead('Myth', ''));
      var c = el('div', 'card lore-myth');
      var intro = el('p', 'sub', 'Ascend to become a Myth. Legend, Head start and Power Lore start over; Automation, Unlocks, cards, chests, Ember and Relics stay. Each Myth makes all gold ×1.5 for good.');
      var b = ui.bar();
      var bl = el('div', 'bar-label'), blL = el('span'), blR = el('span');
      add(bl, blL, blR);
      var row = el('div', 'row');
      row.style.marginTop = '12px';
      var g = el('div', 'grow'), big = el('div', 'big-num');
      add(g, el('div', 'sub', 'Myth if you Ascend now'), big);
      var btn = ui.button('', 'Ascend', function () { ascendAsk(); });
      add(row, g, btn);
      var k1 = el('span'), k2 = el('span');
      add(c, intro, b, bl, row, ui.kv('Myth earned', k1), ui.kv('Ascends taken', k2));
      host.appendChild(c);
      return function (s) {
        var need = L.mythNeed(s);
        ui.setW(b.fill, num(s.legend) / need);
        setText(blL, 'Legend this Myth: ' + fmt(s.legend));
        setText(blR, 'needs ' + fmt(need));
        var can = L.canAscend(s);
        setText(big, can ? '+' + fmt(L.mythOnAscend(s)) : '0');
        setCls(btn, 'can', can);
        ui.setDis(btn, !can);
        setText(k1, fmt(s.myth) + '  (gold ×' + ui.multStr(L.mythMult(s)) + ')');
        setText(k2, fmt(s.myths));
      };
    }
  });
  function ascendAsk() {
    var s = S();
    if (!s || !L.canAscend(s)) return;
    var g = L.mythOnAscend(s);
    ui.ask('Ascend into Myth?', 'You gain +' + fmt(g) + ' Myth (all gold ×' + ui.multStr(Math.pow(L.MYTH.prodPer, num(s.myth) + g)) +
      ' for good) and Myth to spend on Relics. Legend, Head start and Power Lore, gold, brood, buildings and rank start over.',
    'Ascend', 'Not yet', { danger: true }).then(function (yes) {
      if (!yes) return;
      var st = S();
      if (!st || !L.canAscend(st)) return;
      var got = L.ascend(st);
      if (got > 0) {
        ui.toast('You are a Myth.', '+' + fmt(got) + ' Myth. Spend it on Relics.', 'gold');
        ui.refresh();
        setTimeout(function () { scrollToSec('relics'); }, 80);
      }
    });
  }

  // Relics (order 50)
  ui.addSection('legend', {
    id: 'relics', order: 50,
    visible: function (s) { return num(s.myths) > 0 || num(s.mythPts) > 0 || num(s.myth) > 0; },
    badge: function (s) { for (var i = 0; i < L.relics.length; i++) if (L.canBuyRelic(s, L.relics[i].id)) return true; return 0; },
    key: function (s) { var k = ''; L.relics.forEach(function (r) { k += L.relicCost(s, r.id) === null ? 'm' : '.'; }); return k; },
    build: function (host) {
      var parts = [];
      var head = ui.secHead('Relics', '');
      host.appendChild(head);
      L.relics.forEach(function (r) {
        var c = el('div', 'card lore-node');
        var row = el('div', 'row'), g = el('div', 'grow');
        var name = el('div', 'name'), lvl = el('span', 'lore-lv');
        add(name, el('span', null, r.name), lvl);
        var eff = effectNodes();
        add(g, name, eff);
        var btn = ui.buyButton();
        btn.classList.add('small');
        var own = el('div', 'lore-own', 'Owned');
        ui.bindHold(btn, function () {
          var s = S();
          if (!s || !L.buyRelic(s, r.id)) return false;
          boughtToast(r.name, L.relicLevel(s, r.id), r.max, true);
          return true;
        });
        add(row, g, btn, own);
        c.appendChild(row);
        host.appendChild(c);
        parts.push(function (s) {
          var l = L.relicLevel(s, r.id), cost = L.relicCost(s, r.id);
          setText(lvl, r.max > 1 ? 'Lv ' + l + '/' + r.max : '');
          eff.patch(s, r.id, true);
          setHidden(btn, cost === null); setHidden(own, cost !== null);
          setCls(c, 'maxed', cost === null);
          if (cost !== null) {
            setCls(btn, 'can', num(s.mythPts) + 1e-9 >= cost);
            setText(btn.l, l > 0 ? 'Level up' : 'Claim');
            setText(btn.s, fmt(cost) + ' Myth');
          }
        });
      });
      return function (s, st) {
        setText(head.aside, fmt(s.mythPts) + ' Myth to spend');
        for (var i = 0; i < parts.length; i++) parts[i](s, st);
      };
    }
  });

  // ================================================================ Lair / Brood row toggles
  if (typeof ui.addRowExtra === 'function') {
    ui.addRowExtra('building', function (slot, id) {
      var t = ui.toggle('Auto', function (s) { return L.keyOn(s, 'b:' + id); }, function (s, v) { L.setAuto(s, 'b:' + id, !!v); });
      t.row.classList.add('mini');
      slot.appendChild(t.row);
      return function (s) {
        var show = L.level(s, 'auto_build') > 0 || (id === 'digger' && L.level(s, 'auto_dig') > 0);
        setHidden(t.row, !show);
        if (show) t.patch(s);
      };
    });
    ui.addRowExtra('tier', function (slot, i) {
      var t = ui.toggle('Auto', function (s) { return L.keyOn(s, 't:' + i); }, function (s, v) { L.setAuto(s, 't:' + i, !!v); });
      t.row.classList.add('mini');
      slot.appendChild(t.row);
      return function (s) {
        var show = L.level(s, 'auto_brood') > 0;
        setHidden(t.row, !show);
        if (show) t.patch(s);
      };
    });
  }

  // ================================================================ top-bar chip
  ui.addChip({
    id: 'lore-auto', order: 50, cls: 'lore-auto',
    visible: function (s) { return L.anyAutoOwned(s); },
    text: function (s) { return L.masterOn(s) ? 'Auto' : 'Auto off'; },
    onPress: function () {
      ui.setTab('legend');
      setTimeout(function () { scrollToSec('lorehead'); }, 60);
    }
  });

  // ================================================================ runtime: notes, auto gust, callout
  var est = { coins: 0, ready: 0, last: 0 };
  E.on('coin', function (n) { est.coins = Math.max(0, est.coins - num(n)); });
  E.on('gust', function () { est.coins = 0; est.ready = 0; });
  E.on('sleep', function () {
    est.coins = 0;
    var s = S();
    if (s && !E.flag(s, 'loreCallout')) callout.pending = Date.now() + 1400;
  });
  E.on('lore', function (x) {
    if (!x || x.relic) return;
    if (x.id === 'start_rank' || x.id === 'start_gold' || x.id === 'start_brood') ui.markDirty();
  });
  E.on('myth', function () { est.coins = 0; });

  var callout = { pending: 0, checkedBoot: false };
  function showCallout() {
    var s = S();
    if (!s || E.flag(s, 'loreCallout')) return;
    E.setFlag(s, 'loreCallout', 1);
    var box = el('div', 'lore-call');
    var cheap = L.nodes.filter(function (n) { var c = L.cost(s, n.id); return c !== null && c <= Math.max(2, num(s.legendPts)) && L.reqMet(s, n.id); })
      .sort(function (a, b) { return L.cost(s, a.id) - L.cost(s, b.id); }).slice(0, 4);
    add(box,
      el('h3', null, 'Spend your Legend'),
      el('p', null, 'Legend is now something you spend. Your ' + fmt(s.legendPts) + ' Legend can buy Lore: helpers that buy and claim for you, head starts for every run, and raw power.'),
      el('p', 'muted', 'Spending never lowers your +10% per Legend bonus.'));
    if (cheap.length) {
      var ul = el('ul');
      cheap.forEach(function (n) {
        var li = el('li');
        add(li, el('b', null, n.name), document.createTextNode(' (' + fmt(L.cost(s, n.id)) + '): ' + L.describe(n.id, 1)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    var br = el('div', 'btn-row');
    add(br,
      ui.button('ghost', 'Later', function () { ui.closeSheet(); }),
      ui.button('can', 'Show me the Lore', function () { ui.closeSheet(); goLore(); }));
    box.appendChild(br);
    ui.sheet(box, { center: true });
  }

  function notesToToasts() {
    var notes = L.drainNotes();
    var chests = 0, cards = 0, best = '', rank = 0, slept = 0, sg = 0;
    var order = { common: 0, rare: 1, epic: 2, legendary: 3 };
    notes.forEach(function (nt) {
      if (nt.kind === 'chest') {
        chests += nt.data.chests; cards += nt.data.cards.length;
        nt.data.cards.forEach(function (id) {
          var info = E.cardInfo(S(), id);
          if (info && (!best || (order[info.rarity] || 0) > (order[best] || 0))) best = info.rarity;
        });
      } else if (nt.kind === 'rank') rank = Math.max(rank, nt.data.rank);
      else if (nt.kind === 'sleep') { slept++; sg += num(nt.data.gained); }
    });
    if (chests) ui.toast('Chest Kobold', 'Opened ' + chests + (chests === 1 ? ' chest: ' : ' chests: ') + cards + ' cards' + (best && best !== 'common' ? ', best ' + best : '') + '.', '');
    if (rank) ui.toast('Old Renown', 'You start this run at Dragon Rank ' + rank + '.', 'gold');
    if (slept) ui.toast('Dream Keeper', 'Took the Long Sleep' + (slept > 1 ? ' ' + slept + ' times' : '') + ': +' + fmt(sg) + ' Legend.', 'gold');
  }

  function autoGust(s, dt) {
    if (!L.nodeOn(s, 'auto_gust') || !HOARD.cave || typeof HOARD.cave.gust !== 'function') { est.ready = 0; return; }
    var st = E.stats(s);
    // coins on screen: the cave does not expose a count, so estimate spill in minus coins swiped/swept/gusted
    est.coins = Math.min(70, Math.max(0, est.coins + (num(st.spillRate) - num(st.sweepRate)) * dt));
    var m = HOARD.cave.metrics && HOARD.cave.metrics();
    var coins = (m && typeof m.coins === 'number') ? m.coins : est.coins;
    if (!E.gustReady(s)) { est.ready = 0; return; }
    est.ready += dt;
    if (coins >= 8 || est.ready >= 10) {
      var okk = false;
      try { okk = HOARD.cave.gust() !== false; } catch (e) { okk = false; }
      if (okk) { est.coins = 0; est.ready = 0; }
    }
  }

  function loop() {
    var now = Date.now();
    var dt = est.last ? Math.min(1, (now - est.last) / 1000) : 0;
    est.last = now;
    var s = S();
    if (!s) return;
    try {
      if (typeof document.hidden === 'boolean' && document.hidden) return;
      notesToToasts();
      autoGust(s, dt);
      if (!callout.checkedBoot) {
        callout.checkedBoot = true;
        // a v1 player who already slept: Legend waiting, nothing learned yet
        var learned = Object.keys(s.lore || {}).some(function (k) { return num(s.lore[k]) > 0; });
        if (!E.flag(s, 'loreCallout') && num(s.legendPts) >= 1 && !learned) callout.pending = now + 2500;
      }
      if (callout.pending && now >= callout.pending && !ui.sheetOpen()) { callout.pending = 0; showCallout(); }
    } catch (e) { /* keep the loop alive */ }
  }
  function start() {
    if (HOARD.log && typeof HOARD.log.addAffordable === 'function') {
      HOARD.log.addAffordable('lore', function (s) { return L.anyAffordable(s); });
    }
    setInterval(loop, 250);
  }
  if (typeof HOARD.whenReady === 'function') HOARD.whenReady(function () { start(); });
  else setTimeout(start, 0);

  HOARD.uiLore = { showCallout: showCallout, goLore: goLore, estimate: est };
})();
