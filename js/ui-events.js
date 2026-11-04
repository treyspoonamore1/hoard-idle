/* Hoard — js/ui-events.js — event lair UI (SPEC-V2 section 3). Loaded after ui.js, before main.js.
 * Top-bar chip ("Volcano Lair · 2d 14h" / "Next lair in 6h") -> full-height lair sheet tinted with the lair's
 * colour (chain with hold-to-buy, 10-step quest line, event chests, the lair's 3 treasure cards); a banner at the
 * top of the Quests tab; toasts for start / finish / auto-claims / what the lair made while you were away.
 * Uses only HOARD.ui / HOARD.engine / HOARD.events APIs (EXTENSIONS.md). */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui, E = HOARD.engine, X = HOARD.events;
  if (!ui || !E || !X || typeof ui.addChip !== 'function') return;
  var D = HOARD.data;
  var el = ui.el, add = ui.add, setText = ui.setText, setCls = ui.setCls, setHidden = ui.setHidden, setW = ui.setW, setDis = ui.setDis;
  function fmt(n) { return HOARD.fmt(n); }
  function num(x, d) { x = +x; return isFinite(x) ? x : (d || 0); }
  function plural(n, a, b) { return ui.plural ? ui.plural(n, a, b) : (n === 1 ? a : b); }
  function S() { return ui.state(); }

  // "2d 14h" / "6h 12m" / "12m" / "40s"
  function span(sec) {
    sec = Math.max(0, Math.floor(num(sec)));
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    if (m > 0) return m + 'm';
    return sec + 's';
  }
  // rates below 1/s read better per hour ("1.8 Lava Hounds/h"); `unit` forces 's' or 'h' so one row never mixes them
  function unitFor(perSec) { return num(perSec) >= 1 ? 's' : 'h'; }
  function rateStr(perSec, unit) {
    perSec = num(perSec);
    unit = unit || unitFor(perSec);
    if (unit === 's') return (perSec <= 0 ? '0' : HOARD.fmtR(perSec)) + '/s';
    if (perSec <= 0) return '0/h';
    var ph = perSec * 3600;
    return (ph < 10 ? (Math.round(ph * 10) / 10) : fmt(ph)) + '/h';
  }
  // "360 Obsidian/h", "1.8 Lava Hounds/h", "5 Magma Imps/s"
  function rateIn(perSec, what, unit) {
    var r = rateStr(perSec, unit), i = r.lastIndexOf('/');
    return r.slice(0, i) + ' ' + what + r.slice(i);
  }
  // prices are not round any more: never show less than the real price (12.3 -> 13)
  function priceStr(p) { p = num(p); return fmt(p < 1000 ? Math.ceil(p - 1e-9) : p); }
  function rushX() { return fmt(num(X.C.rushMult, 1)); }
  function cardDef(id) { for (var i = 0; i < D.cards.length; i++) if (D.cards[i].id === id) return D.cards[i]; return null; }
  function rarName(r) { return (D.rarities[r] && D.rarities[r].name) || r; }
  function icon(name) { var i = el('span', 'ev-ico'); i.innerHTML = (ui.icons && ui.icons[name]) || ''; return i; }

  ui.css([
    '.ev-volcano { --ev: var(--ember); --ev-hi: color-mix(in srgb, var(--ember) 55%, var(--gold-hi)); }',
    '.ev-frost { --ev: color-mix(in srgb, var(--r-rare) 50%, #ffffff); --ev-hi: color-mix(in srgb, var(--r-rare) 25%, #ffffff); }',
    '.ev-sea { --ev: color-mix(in srgb, var(--moss) 50%, var(--r-rare)); --ev-hi: color-mix(in srgb, var(--moss) 40%, #d8fff4); }',
    '.ev-none { --ev: var(--ink-dim); --ev-hi: var(--ink); }',
    '.chip.ev-chip { color: var(--ev-hi); border-color: color-mix(in srgb, var(--ev) 55%, transparent); background: color-mix(in srgb, var(--ev) 14%, rgba(0,0,0,.25)); }',
    '.chip.ev-chip.ev-claim { box-shadow: 0 0 0 1px var(--ev), 0 0 12px color-mix(in srgb, var(--ev) 45%, transparent); }',
    '.ev-ico { display: inline-flex; width: 22px; height: 22px; flex: none; color: var(--ev-hi); }',
    '.ev-ico svg { width: 100%; height: 100%; }',
    // lair sheet
    '.sheet.ev-sheet { padding-top: 0; border-color: color-mix(in srgb, var(--ev) 40%, transparent);',
    '  background: radial-gradient(120% 50% at 50% 0%, color-mix(in srgb, var(--ev) 22%, transparent), transparent 70%),',
    '  linear-gradient(175deg, color-mix(in srgb, var(--ev) 12%, var(--rock-2)), var(--rock) 35%, var(--cave)); }',
    '.ev-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; margin: 0 calc(-1 * var(--gut-r)) 0 calc(-1 * var(--gut-l));',
    '  padding: 12px var(--gut-r) 10px var(--gut-l); background: color-mix(in srgb, var(--ev) 10%, rgba(22,19,31,.94)); border-bottom: 1px solid color-mix(in srgb, var(--ev) 30%, transparent); backdrop-filter: blur(6px); }',
    '.ev-head .ev-ico { width: 30px; height: 30px; }',
    '.ev-head h3 { margin: 0; font-size: 28px; color: var(--ev-hi); }',
    '.ev-head .sub { font-variant-numeric: tabular-nums; }',
    '.ev-head .btn { min-width: 0; }',
    '.ev-hero { text-align: center; padding: 14px 0 6px; }',
    '.ev-cur { font-family: var(--font-d); font-size: 46px; line-height: 1; color: var(--ev-hi); font-variant-numeric: tabular-nums; text-shadow: 0 0 24px color-mix(in srgb, var(--ev) 40%, transparent); }',
    '.ev-curname { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--ev); font-weight: 700; margin-top: 4px; }',
    '.ev-rates { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; color: var(--ink-dim); font-size: 14px; margin-top: 6px; font-variant-numeric: tabular-nums; }',
    '.ev-rates b { color: var(--ink); }',
    '.ev-rush { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; font-size: 13px; color: var(--ink-dim);',
    '  border: 1px dashed color-mix(in srgb, var(--ev) 45%, transparent); font-variant-numeric: tabular-nums; }',
    '.ev-rush.on { color: var(--ev-hi); font-weight: 700; border-style: solid; border-color: var(--ev); background: color-mix(in srgb, var(--ev) 18%, transparent);',
    '  box-shadow: 0 0 14px color-mix(in srgb, var(--ev) 35%, transparent); }',
    '.ev-blurb { font-style: italic; color: var(--ink-dim); font-size: 14px; text-align: center; margin: 8px 6px 2px; }',
    '.ev-sheet .sec-head h2 { color: var(--ev-hi); }',
    '.ev-sheet .card { border-color: color-mix(in srgb, var(--ev) 18%, var(--line)); }',
    '.ev-sheet .bar > i { background: linear-gradient(90deg, color-mix(in srgb, var(--ev) 60%, #000), var(--ev)); }',
    '.ev-sheet .bar.moss > i { background: linear-gradient(90deg, #3f7a59, var(--moss)); }',
    '.ev-unit .owned { color: var(--ev-hi); }',
    '.ev-unit .cost .c-gold { color: var(--ev-hi); }',
    '.ev-unit .cost .c-gold.short { color: var(--ink-dim); }',
    '.ev-tot { color: var(--ev-hi); opacity: .85; }',
    '.ev-unit .ev-next { color: var(--ink-faint); font-weight: 400; }',
    '.ev-q.now { color: var(--ink); }',
    '.ev-q.now .n { border-color: var(--ev); color: var(--ev-hi); }',
    '.ev-q.now .rw { color: var(--ev-hi); font-weight: 700; }',
    '.ev-q { display: flex; align-items: center; gap: 10px; padding: 7px 2px; border-bottom: 1px solid var(--line); font-size: 15px; color: var(--ink-faint); }',
    '.ev-q .n { width: 22px; height: 22px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;',
    '  border: 1px solid var(--line-2); font-variant-numeric: tabular-nums; }',
    '.ev-q.claimed { color: var(--ink-dim); }',
    '.ev-q.claimed .n { background: color-mix(in srgb, var(--ev) 30%, transparent); border-color: var(--ev); color: var(--ev-hi); }',
    '.ev-q.claimed .n svg { width: 14px; height: 14px; }',
    '.ev-q.claimed .t { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--ink-dim) 50%, transparent); }',
    '.ev-q .rw { margin-left: auto; font-size: 12px; white-space: nowrap; }',
    '.ev-qcur { border-color: color-mix(in srgb, var(--ev) 55%, transparent) !important; box-shadow: 0 0 18px color-mix(in srgb, var(--ev) 16%, transparent); }',
    '.ev-qcur .step { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: var(--ev); font-weight: 700; }',
    '.ev-chest { display: flex; align-items: center; gap: 12px; }',
    '.ev-chest .chest-svg { width: 44px; height: 44px; color: var(--ev-hi); flex: none; }',
    '.ev-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }',
    '.ev-tc { border-radius: var(--radius); border: 1px solid var(--rc, var(--line-2)); padding: 9px 7px; text-align: center; min-height: 128px;',
    '  background: linear-gradient(170deg, var(--rock-2), var(--rock)); display: flex; flex-direction: column; gap: 4px; align-items: center; }',
    '.ev-tc.unowned { border-style: dashed; border-color: var(--line-2); background: rgba(0,0,0,.18); color: var(--ink-faint); }',
    '.ev-tc .t-rar { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--rc); }',
    '.ev-tc .t-name { font-weight: 700; font-size: 14px; line-height: 1.15; }',
    '.ev-tc .t-lvl { font-family: var(--font-d); font-size: 20px; color: var(--gold-hi); line-height: 1; }',
    '.ev-tc .t-text { font-size: 12px; line-height: 1.2; color: var(--ink-dim); }',
    '.ev-sheet .reveal { margin-top: 10px; }',
    '.ev-group { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; color: var(--ev); margin: 12px 0 6px; display: flex; align-items: center; gap: 6px; }',
    '.ev-group .ev-ico { width: 18px; height: 18px; }',
    '.ev-quiet { text-align: center; padding: 18px 4px 6px; }',
    '.ev-quiet .ev-cur { font-size: 40px; }',
    // Quests tab banner
    '.ev-banner { display: flex; align-items: center; gap: 12px; cursor: pointer; border-color: color-mix(in srgb, var(--ev) 45%, transparent) !important;',
    '  background: radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, var(--ev) 22%, transparent), transparent 70%), linear-gradient(160deg, var(--rock-2), var(--rock)) !important; }',
    '.ev-banner .ev-ico { width: 34px; height: 34px; }',
    '.ev-banner .name { color: var(--ev-hi); font-family: var(--font-d); font-weight: 600; font-size: 22px; }',
    '.ev-banner .bar { margin-top: 6px; }'
  ].join('\n'), 'ui-events');

  var CHECK = (ui.icons && ui.icons.check) || '';
  var CHEST_SVG = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 20c0-7 5-11 18-11s18 4 18 11v20H6z"/><path d="M6 22h36M20 22v6h8v-6"/><path d="M14 10v30M34 10v30" opacity=".45"/></svg>';

  function themeOf(info) { return info && info.lair ? 'ev-' + info.lair.id : (info && info.next ? 'ev-' + info.next.lair.id : 'ev-none'); }
  function rewardText(q) { return q.all ? 'All 3 treasures' : (q.cards > 1 ? q.cards + ' treasures' : 'Event chest'); }

  // ---------------------------------------------------------------- lair sheet
  var reveal = null; // { id, cards: [ids], before: {id: copies} } shown in the chest section until closed/next open
  function buildChain(host, s, lair) {
    var parts = [];
    var head = ui.secHead('Lair brood');
    var amt = ui.amtToggle();
    head.appendChild(amt);
    host.appendChild(head);
    parts.push(function (st) { amt.patch(st); });
    host.appendChild(el('p', 'hint', 'Prices rise with each one you buy. Higher tiers make the tier below for free. While you swipe coins in the cave, the whole brood works \u00d7' + rushX() + ' as fast. Hold Buy to keep buying.'));
    for (var k = 3; k >= 0; k--) {
      (function (k) {
        var u = lair.units[k];
        var c = el('div', 'card ev-unit');
        var r = el('div', 'row');
        var g = el('div', 'grow');
        var nm = el('div', 'name', u.name);
        var sub = el('div', 'sub num');
        var tot = el('div', 'sub num ev-tot');
        var cost = el('div', 'cost');
        var cg = el('span', 'c-gold');
        var nx = el('span', 'ev-next');
        add(cost, cg, nx);
        add(g, nm, sub, tot, cost);
        var own = el('div', 'owned');
        var b = ui.buyButton();
        ui.bindHold(b, function () { var st = S(); return !!st && X.buyUnit(st, k, ui.buyAmt(st)); });
        add(r, g, own, b);
        c.appendChild(r);
        host.appendChild(c);
        parts.push(function (st) {
          var e = st.events;
          var n = Math.floor(num(e.units[k]));
          setText(own, fmt(n));
          var each = X.CHAIN[k].rate;
          var target = k === 0 ? lair.cur : lair.units[k - 1].name;
          // one time unit per row (the per-unit rate's: these are always per hour), and the rush says so on the total
          var unit = unitFor(each), rush = X.rushing(st);
          setText(sub, 'Each ' + u.one + ' ' + u.verb + ' ' + rateIn(each, target, unit));
          setHidden(tot, !(n > 0));
          if (n > 0) setText(tot, 'All ' + fmt(n) + ': ' + rateIn(X.unitRate(st, k) * X.speed(st), target, unit) + (rush ? ' (rush \u00d7' + rushX() + ')' : ''));
          // price of the selected amount (the button shows the count) + the next single unit's price
          var a = ui.buyAmt(st), cnt = a === 'max' ? Math.max(1, X.unitMax(st, k)) : a;
          var price = X.unitCost(st, k, cnt), next = X.unitPrice(st, k);
          var okk = X.active(st) && price < 1e300 && num(e.cur) + 1e-9 >= price;
          setText(cg, (cnt === 1 ? 'Next ' : '') + priceStr(price) + ' ' + lair.cur);
          setText(nx, cnt === 1 ? '' : ' · next ' + priceStr(next));
          setCls(cg, 'short', !okk);
          setCls(b, 'can', okk);
          setText(b.s, '×' + fmt(cnt));
        });
      })(k);
    }
    return function (st) { for (var i = 0; i < parts.length; i++) parts[i](st); };
  }

  // the current step, big, near the top of the sheet
  function buildCurrent(host, s, lair) {
    var e = s.events, total = X.QUESTS.length;
    var i = e.q, q = X.QUESTS[i];
    if (!q) {
      var done = el('div', 'card ev-qcur');
      add(done, el('div', 'step', 'Quest line complete'), el('div', 'name', 'Every treasure of the ' + lair.name + ' is yours'),
        el('div', 'sub', 'The brood keeps working until the lair closes. Copies from the next ' + lair.name + ' level your cards up.'));
      host.appendChild(done);
      return null;
    }
    var c = el('div', 'card ev-qcur');
    var r = el('div', 'row');
    var g = el('div', 'grow');
    add(g, el('div', 'step', 'Quest ' + (i + 1) + ' of ' + total + ' \u00b7 ' + rewardText(q)), el('div', 'name', X.questInfo(s, i).title));
    var bt = ui.button('small', 'Claim', function () {
      var st = S();
      if (st && X.claimQuest(st)) { ui.buzz(12); patchSheetSoon(); }
    });
    add(r, g, bt);
    var bb = ui.bar();
    var lab = el('div', 'bar-label');
    var l1 = el('span'), l2 = el('span');
    add(lab, l1, l2);
    add(c, r, bb, lab);
    host.appendChild(c);
    return function (st) {
      var x = X.questInfo(st, i);
      setW(bb.fill, x.frac);
      setCls(bb, 'moss', x.done);
      setText(l1, fmt(Math.min(x.cur, x.target)) + ' / ' + X.fmtR(x.target));
      setText(l2, x.done ? 'Ready to claim' : Math.floor(x.frac * 100) + '%');
      setCls(bt, 'moss', x.done);
      setDis(bt, !x.done);
    };
  }
  // the whole line, compact
  function buildLine(host, s) {
    var e = s.events, total = X.QUESTS.length;
    host.appendChild(ui.secHead('Quest line', Math.min(e.q, total) + ' of ' + total + ' done'));
    X.QUESTS.forEach(function (q, i) {
      var qi = X.questInfo(s, i);
      var row = el('div', 'ev-q' + (qi.claimed ? ' claimed' : '') + (i === e.q ? ' now' : ''));
      var n = el('span', 'n');
      if (qi.claimed) n.innerHTML = CHECK; else n.textContent = String(i + 1);
      add(row, n, el('span', 't', qi.title), el('span', 'rw', qi.claimed ? '' : (i === e.q ? 'Now' : rewardText(q))));
      host.appendChild(row);
    });
    return null;
  }

  function revealGrid(ids, before) {
    var grid = el('div', 'reveal');
    var seen = {};
    ids.forEach(function (id) {
      var d = cardDef(id);
      var info = E.cardInfo(S(), id);
      var prev = (before[id] || 0) + (seen[id] || 0);
      seen[id] = (seen[id] || 0) + 1;
      var lb = E.levelFor(prev), la = E.levelFor(prev + 1);
      var note = prev === 0 ? 'New!' : (la > lb ? 'Lv ' + lb + ' → ' + la : '+1 copy');
      var cell = el('div', 'rcard shown r-' + info.rarity);
      add(cell, el('div', 'rc-rar', rarName(info.rarity)), el('div', 'rc-name', (d && d.name) || info.name),
        el('div', 'rc-text', info.text || ''), el('div', 'rc-note' + (la > lb && prev > 0 ? ' up' : ''), note));
      grid.appendChild(cell);
    });
    return grid;
  }

  function buildChest(host, s, lair) {
    var e = s.events;
    var showReveal = reveal && reveal.id === e.id && reveal.cards.length;
    if (!(e.chests > 0) && !showReveal) return null;
    var c = el('div', 'card');
    if (e.chests > 0) {
      var r = el('div', 'ev-chest');
      var ic = el('div', 'chest-svg');
      ic.innerHTML = CHEST_SVG;
      var g = el('div', 'grow');
      add(g, el('div', 'name', e.chests + ' event ' + plural(e.chests, 'chest', 'chests')), el('div', 'sub', 'Holds ' + lair.name + ' treasures.'));
      var b = ui.button('can small', e.chests > 1 ? 'Open all' : 'Open', function () {
        var st = S();
        if (!st) return;
        var before = {};
        X.cards(st.events.lair).forEach(function (id) { before[id] = Math.floor(num(st.cards[id])); });
        var got = [];
        for (var i = 0; i < 20 && st.events.chests > 0; i++) got = got.concat(X.openChest(st));
        if (got.length) { reveal = { id: st.events.id, cards: got, before: before }; ui.buzz(15); }
        patchSheetSoon();
      });
      add(r, ic, g, b);
      c.appendChild(r);
    } else {
      c.appendChild(el('div', 'name', 'From the chest'));
    }
    if (showReveal) c.appendChild(revealGrid(reveal.cards, reveal.before));
    host.appendChild(c);
    return null;
  }

  function cardTile(s, id) {
    var cd = cardDef(id);
    if (!cd) return el('div');
    var info = E.cardInfo(s, id);
    var has = info.copies > 0;
    var t = el('div', 'ev-tc r-' + cd.rarity + (has ? '' : ' unowned'));
    add(t, el('div', 't-rar', rarName(cd.rarity)), el('div', 't-name', has ? cd.name : '???'));
    if (has) {
      add(t, el('div', 't-lvl num', 'Lv ' + info.level), el('div', 't-text', info.text));
      var lab = el('div', 'bar-label');
      lab.appendChild(el('span', null, info.nextAt ? info.copies + '/' + info.nextAt + ' copies' : 'Max level'));
      t.appendChild(lab);
    } else t.appendChild(el('div', 't-text', 'Found in this lair’s quest chests.'));
    return t;
  }
  function buildCards(host, s, lair, title) {
    var ids = X.cards(lair.id);
    var found = ids.filter(function (id) { return num(s.cards[id]) > 0; }).length;
    host.appendChild(ui.secHead(title || 'Lair treasures', found + ' of ' + ids.length + ' found'));
    host.appendChild(el('p', 'hint', 'Never in normal chests. They stay yours forever, and copies level them up.'));
    var g = el('div', 'ev-cards');
    ids.forEach(function (id) { g.appendChild(cardTile(s, id)); });
    host.appendChild(g);
  }

  // whole-sheet builder; returns { node, patch }
  function buildLairView(s) {
    var info = X.info(s);
    var root = el('div');
    var head = el('div', 'ev-head');
    var hg = el('div', 'grow');
    var title = el('h3');
    var hsub = el('div', 'sub');
    add(hg, title, hsub);
    add(head, icon(info.lair ? info.lair.icon : (info.next ? info.next.lair.icon : 'clock')), hg, ui.button('ghost small', 'Close', function () { ui.closeSheet(); }));
    root.appendChild(head);
    var patches = [];
    var e = s.events;

    if (info.status === 'active' && info.synced) {
      var lair = info.lair;
      setText(title, lair.name);
      var hero = el('div', 'ev-hero');
      var cur = el('div', 'ev-cur');
      var rates = el('div', 'ev-rates');
      var rProd = el('span'), rCoin = el('span'), rRush = el('div', 'ev-rush');
      add(rates, rProd, rCoin);
      add(hero, cur, el('div', 'ev-curname', lair.cur), rates, rRush);
      root.appendChild(hero);
      root.appendChild(el('p', 'ev-blurb', lair.blurb));
      patches.push(function (st) {
        var inf = X.info(st);
        setText(hsub, inf.left > 0 ? 'Closes in ' + span(inf.left) : 'Closing');
        setText(cur, fmt(st.events.cur));
        rProd.innerHTML = '';
        add(rProd, el('b', null, '+' + rateStr(X.rate(st) * X.speed(st), 's')), document.createTextNode(' from the brood'));
        rCoin.innerHTML = '';
        add(rCoin, el('b', null, '+' + fmt(X.perCoin(st))), document.createTextNode(' per swiped coin'));
        // swipe rush: on for C.rushSec after the last coin; the sheet covers the cave, so it runs down while open
        var on = X.rushing(st);
        setCls(rRush, 'on', on);
        setText(rRush, on ? 'Swipe rush \u00d7' + rushX() + ' \u00b7 ' + Math.ceil(num(st.events.rush)) + 's'
          : 'Swipe coins in the cave: the brood works \u00d7' + rushX() + ' as fast');
      });
      // sections, each rebuilt on its own key
      var secs = [
        { key: function (st) { return 'Q' + st.events.id + ':' + st.events.q; }, build: function (h, st) { return buildCurrent(h, st, lair); } },
        { key: function (st) { return 'C' + st.events.id + ':' + st.events.chests + ':' + (reveal ? reveal.cards.length + reveal.id : ''); }, build: function (h, st) { return buildChest(h, st, lair); } },
        { key: function (st) { return 'U' + st.events.id; }, build: function (h, st) { return buildChain(h, st, lair); } },
        { key: function (st) { return 'L' + st.events.id + ':' + st.events.q; }, build: function (h, st) { return buildLine(h, st); } },
        { key: function (st) { var k = 'K'; X.cards(lair.id).forEach(function (id) { k += ':' + Math.floor(num(st.cards[id])); }); return k; }, build: function (h, st) { return buildCards(h, st, lair); } }
      ];
      secs.forEach(function (sec) {
        var h = el('div', 'ev-sec');
        root.appendChild(h);
        sec.host = h;
        sec.k = null;
        patches.push(function (st) {
          var k = sec.key(st);
          if (k !== sec.k) {
            var sc = ui.sheetEl(), top = sc ? sc.scrollTop : 0;
            sec.k = k; h.innerHTML = '';
            sec.patch = sec.build(h, st);
            if (sc) sc.scrollTop = top;
          }
          if (typeof sec.patch === 'function') sec.patch(st);
        });
      });
    } else {
      // between lairs (or the event just closed and the next one has not opened)
      var nx = info.next;
      setText(title, 'The lairs are quiet');
      var q = el('div', 'ev-quiet');
      var cnt = el('div', 'ev-cur');
      add(q, el('div', 'ev-curname', nx ? nx.lair.name + ' opens in' : 'Next lair'), cnt);
      if (nx) q.appendChild(el('p', 'ev-blurb', nx.lair.blurb));
      root.appendChild(q);
      patches.push(function (st) {
        var inf = X.info(st);
        setText(hsub, inf.next ? 'Next: ' + inf.next.lair.name : '');
        setText(cnt, span(inf.untilNext));
      });
      var last = e.last && e.last.lair ? X.lairById(e.last.lair) : null;
      if (last) {
        var lc = el('div', 'card');
        add(lc, el('div', 'name', 'Last lair: ' + last.name),
          el('div', 'sub', num(e.last.q) + ' of ' + X.QUESTS.length + ' quests done · ' + fmt(num(e.last.got)) + ' ' + plural(num(e.last.got), 'treasure', 'treasures') + ' won'));
        root.appendChild(lc);
      }
      var all = el('div');
      all.appendChild(ui.secHead('Event treasures', X.CARDS.filter(function (c) { return num(s.cards[c.id]) > 0; }).length + ' of ' + X.CARDS.length + ' found'));
      X.LAIRS.forEach(function (l) {
        var gh = el('div', 'ev-group ev-' + l.id);
        add(gh, icon(l.icon), document.createTextNode(l.name));
        all.appendChild(gh);
        var g = el('div', 'ev-cards');
        X.cards(l.id).forEach(function (id) { g.appendChild(cardTile(s, id)); });
        all.appendChild(g);
      });
      root.appendChild(all);
    }
    return { node: root, key: viewKey(s), patch: function (st) { for (var i = 0; i < patches.length; i++) patches[i](st); } };
  }
  function viewKey(s) { var inf = X.info(s); return inf.status + ':' + (inf.synced ? s.events.id : '') + ':' + (s.events.over ? 1 : 0); }

  var sheetView = null, sheetTheme = '';
  // the sheet covers the cave: tell the engine side so the swipe rush runs down slower while the player shops
  function sheetFlag(on) { try { if (typeof X.setSheetOpen === 'function') X.setSheetOpen(on); } catch (e) { /* ignore */ } }
  function openLair() {
    var s = S();
    if (!s || !X.unlocked(s)) return;
    try { X.sync(s); } catch (e) { /* ignore */ }
    if (reveal && reveal.id !== s.events.id) reveal = null;
    var host = el('div');
    sheetView = buildLairView(s);
    sheetFlag(true);
    host.appendChild(sheetView.node);
    sheetTheme = themeOf(X.info(s));
    var sheetNode = ui.sheet(host, {
      full: true, cls: 'ev-sheet ' + sheetTheme,
      onClose: function () { sheetView = null; reveal = null; sheetFlag(false); },
      onAbort: function () { sheetView = null; sheetFlag(false); },
      patch: function (st) {
        sheetFlag(!!sheetView);
        if (!sheetView) return;
        if (viewKey(st) !== sheetView.key) {          // event opened/closed under us: rebuild the whole view
          sheetView = buildLairView(st);
          host.innerHTML = '';
          host.appendChild(sheetView.node);
          var t = themeOf(X.info(st));
          if (sheetNode && t !== sheetTheme) { sheetNode.classList.remove(sheetTheme); sheetNode.classList.add(t); sheetTheme = t; }
        }
        sheetView.patch(st);
      }
    });
  }
  function patchSheetSoon() { if (ui.markDirty) ui.markDirty(); }

  // ---------------------------------------------------------------- top-bar chip
  ui.addChip({
    id: 'events', order: 50, cls: 'ev-chip',
    visible: function (s) { return X.unlocked(s); },
    classes: function (s) { return themeOf(X.info(s)) + (X.anyClaim(s) ? ' ev-claim' : ''); },
    text: function (s) {
      var inf = X.info(s);
      noteOffline(s);
      if (inf.status === 'active') return (X.rushing(s) ? inf.lair.short + ' \u00d7' + rushX() : inf.lair.name) + ' · ' + span(inf.left);
      return 'Next lair in ' + span(inf.untilNext);
    },
    front: function (s) { return X.rushing(s); },
    onPress: function () { openLair(); }
  });

  // ---------------------------------------------------------------- swipe rush countdown in the cave
  // a small pill under the streak ring while the rush is on: always visible, however many chips the top bar holds
  var RUSH_COL = { volcano: ['#ff9a5c', 'rgba(70,24,10,0.78)'], frost: ['#cfe9ff', 'rgba(16,34,58,0.78)'], sea: ['#9ff2d6', 'rgba(8,44,40,0.78)'] };
  if (HOARD.cave && typeof HOARD.cave.addLayer === 'function') HOARD.cave.addLayer({
    id: 'evRush', z: 6,
    draw: function (g, w, h, t, dt, s) {
      if (!s || !s.events || !X.rushing(s)) return;
      var lair = X.lairById(s.events.lair);
      if (!lair) return;
      var col = RUSH_COL[lair.id] || RUSH_COL.volcano;
      var txt = lair.short + ' rush \u00d7' + rushX() + ' \u00b7 ' + Math.ceil(num(s.events.rush)) + 's';
      g.save();
      if (typeof HOARD.cave.hudDim === 'function') g.globalAlpha = HOARD.cave.hudDim();   // a Starfall dims it
      g.font = '700 13px system-ui, -apple-system, "Segoe UI", sans-serif';
      var tw = g.measureText(txt).width, x = 8, y = 58, ph = 22, pw = tw + 18;
      if (x + pw > w - 8) pw = Math.max(40, w - 16);
      g.fillStyle = col[1];
      g.strokeStyle = col[0]; g.lineWidth = 1.5;
      g.beginPath();
      if (typeof g.roundRect === 'function') g.roundRect(x, y, pw, ph, ph / 2); else g.rect(x, y, pw, ph);
      g.fill(); g.stroke();
      g.fillStyle = col[0]; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(txt, x + 9, y + ph / 2 + 1, pw - 18);
      g.restore();
    }
  });

  // ---------------------------------------------------------------- Quests tab banner
  ui.addSection('quests', {
    id: 'eventBanner', order: -10,
    visible: function (s) { return X.unlocked(s); },
    key: function (s) { return viewKey(s); },
    badge: function (s) { return X.anyClaim(s) ? true : 0; },
    build: function (host, s) {
      var c = el('div', 'card ev-banner');
      c.setAttribute('role', 'button');
      c.tabIndex = 0;
      var g = el('div', 'grow');
      var nm = el('div', 'name'), sub = el('div', 'sub num');
      var bb = ui.bar();
      add(g, nm, sub, bb);
      var b = ui.button('small', 'Enter', function (ev) {
        ev.stopPropagation();
        var st = S();
        if (st && X.questInfo(st).done && X.claimQuest(st)) ui.buzz(12); // claim right here; the sheet shows the chest
        openLair();
      });
      var ic = el('span', 'ev-ico');
      add(c, ic, g, b);
      c.addEventListener('click', function () { openLair(); });
      host.appendChild(c);
      var theme = '', iconName = '';
      return function (st) {
        var inf = X.info(st);
        var t = themeOf(inf);
        if (t !== theme) { if (theme) c.classList.remove(theme); c.classList.add(t); theme = t; }
        var iname = inf.lair ? inf.lair.icon : (inf.next ? inf.next.lair.icon : 'clock');
        if (iname !== iconName) { iconName = iname; ic.innerHTML = (ui.icons && ui.icons[iname]) || ''; }
        if (inf.status === 'active' && inf.synced) {
          var e = st.events, total = X.QUESTS.length;
          var qi = X.questInfo(st);
          setText(nm, inf.lair.name);
          setText(sub, span(inf.left) + ' left · ' + (e.q >= total ? 'all quests done' : 'quest ' + (e.q + 1) + ' of ' + total + ': ' + qi.title));
          setHidden(bb, e.q >= total);
          setW(bb.fill, qi.frac);
          setCls(bb, 'moss', qi.done);
          var claim = X.anyClaim(st);
          setText(b, claim ? (e.chests > 0 && !qi.done ? 'Open' : 'Claim') : 'Enter');
          setCls(b, 'can', claim);
        } else {
          setText(nm, inf.next ? inf.next.lair.name : 'Event lairs');
          setText(sub, 'Opens in ' + span(inf.untilNext) + ' · 72 hours of new treasures');
          setHidden(bb, true);
          setText(b, 'Look');
          setCls(b, 'can', false);
        }
      };
    }
  });

  // ---------------------------------------------------------------- toasts
  var lastOffNote = 0;
  function noteOffline(s) {
    var e = s.events;
    if (!e || !(num(e.offGain) > 0)) return;
    var g = X.takeOfflineGain(s);
    var lair = X.lair(s);
    var t = Date.now();
    if (lair && g >= 1 && t - lastOffNote > 5000) {
      lastOffNote = t;
      ui.toast(lair.name, 'Your brood gathered +' + fmt(g) + ' ' + lair.cur + ' while you were away.', 'gold');
    }
  }
  E.on('event', function (p) {
    if (!p || typeof p !== 'object') return;
    var lair = p.lair ? X.lairById(p.lair) : null;
    try {
      if (p.type === 'start' && lair) ui.toast(lair.name + ' is open!', 'Build its brood and swipe coins to win its treasures: while you swipe, the brood works \u00d7' + rushX() + ' as fast. ' + span((num(p.end) - X.now()) / 1000) + ' left. Open it from the chip up top.', 'gold');
      else if (p.type === 'finish' && lair) ui.toast(lair.name + ' has closed.', p.quests + ' of ' + X.QUESTS.length + ' quests done.' + (p.cards && p.cards.length ? ' Unopened chests gave ' + p.cards.length + ' ' + plural(p.cards.length, 'treasure', 'treasures') + '.' : ''), '');
      else if (p.type === 'quest' && p.auto && lair) ui.toast('Quest Scribe', lair.name + ' quest ' + p.step + ' claimed.', 'moss');
      else if (p.type === 'chest' && p.auto && lair && p.cards && p.cards.length) ui.toast('Chest Kobold', 'Opened a ' + lair.name + ' chest: ' + p.cards.map(function (id) { var d = cardDef(id); return d ? d.name : id; }).join(', ') + '.', 'moss');
    } catch (e) { /* ignore */ }
  });

  X.openLair = openLair;
})();
