/* Hoard — ui.js
 * HOARD.ui: top bar, tabs (Lair, Brood, Quests, Hoard, Sleep + settings), lists,
 * hold-to-buy, modals/sheets, toasts. Reads state; mutates it only through
 * HOARD.engine.* (plus state.settings, which is a UI preference).
 */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var ui = (HOARD.ui = HOARD.ui || {});
  if (typeof document === 'undefined') {
    ui.init = ui.frame = ui.welcome = ui.toast = ui.refresh = function () {};
    return;
  }

  var E = null, D = null, fmt = null, fmtRate = null, fmtTime = null;
  var opts = {};
  var inited = false;
  var $ = {};                 // fixed DOM refs
  var tab = 'lair';
  var view = null;            // { key, root, patch }
  var lastState = null;
  var listTimer = 0, dirty = true;
  var hold = null;            // active press-and-hold
  var toastQ = [], toastLive = [];
  var MAX_TOASTS = 2, TOAST_MS = 2600;
  var sheetTimers = [];
  var sheetOpen = false, sheetOnClose = null;
  var GUST_C = 175.93;

  function S() { try { return opts.getState ? opts.getState() : null; } catch (e) { return null; } }
  function num(x, d) { x = +x; return isFinite(x) ? x : (d || 0); }
  function clamp01(x) { x = num(x); return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function clock(sec) { sec = Math.max(0, Math.ceil(num(sec))); return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
  function multStr(m) { m = num(m, 1); return (Math.round(m * 100) / 100).toString(); }
  function pos0(x) { return num(x) > 0; }
  function plural(n, one, many) { return Math.floor(num(n)) === 1 ? one : many; }

  // ---------------------------------------------------------------- DOM helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function setText(n, s) {
    if (!n) return;
    s = String(s);
    if (n._t !== s) { n._t = s; n.textContent = s; }
  }
  function setCls(n, c, on) {
    if (!n) return;
    on = !!on;
    var k = '_c_' + c;
    if (n[k] !== on) { n[k] = on; n.classList.toggle(c, on); }
  }
  function setHidden(n, h) {
    if (!n) return;
    h = !!h;
    if (n._h !== h) { n._h = h; n.hidden = h; }
  }
  function setW(n, frac) {
    if (!n) return;
    var s = (clamp01(frac) * 100).toFixed(1) + '%';
    if (n._w !== s) { n._w = s; n.style.width = s; }
  }
  function setDis(n, d) {
    if (!n) return;
    d = !!d;
    if (n._d !== d) { n._d = d; n.disabled = d; }
  }
  function bar(cls) {
    var b = el('div', 'bar' + (cls ? ' ' + cls : ''));
    var i = el('i');
    b.appendChild(i);
    b.fill = i;
    return b;
  }
  function button(cls, label, onClick) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    if (label !== undefined) b.textContent = label;
    if (onClick) b.addEventListener('click', function (e) { onClick(e); });
    return b;
  }
  function secHead(title, aside) {
    var h = el('div', 'sec-head');
    add(h, el('h2', null, title));
    if (aside !== undefined) { h.aside = el('span', 'aside', aside); h.appendChild(h.aside); }
    return h;
  }

  // ---------------------------------------------------------------- data lookups
  function tierName(i, n) {
    var t = D.tiers[i];
    if (!t) return '';
    return Math.floor(num(n)) === 1 ? (t.one || t.name) : t.name;
  }
  function buyAmt(state) {
    var a = state && state.settings ? state.settings.buyAmt : 1;
    return (a === 10 || a === 'max') ? a : 1;
  }
  function cardDef(id) {
    for (var i = 0; i < D.cards.length; i++) if (D.cards[i].id === id) return D.cards[i];
    return null;
  }
  function levelFor(copies) {
    var l = 0, t = D.cardThresholds;
    for (var i = 0; i < t.length; i++) if (copies >= t[i]) l++;
    return l;
  }
  function rarityName(r) { return (D.rarities[r] && D.rarities[r].name) || r; }

  // ---------------------------------------------------------------- haptics
  function buzz(ms) {
    var s = S();
    if (!s || !s.settings || !s.settings.haptics) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- press-and-hold
  // Short press: one buy on release. Hold: first repeat after 400 ms, then every
  // 90 ms easing down to 40 ms. Scrolling the panel cancels (pointercancel).
  function bindHold(btn, fn) {
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      if (e.cancelable) e.preventDefault();
      startHold(btn, fn, e.pointerId);
    });
    btn.addEventListener('pointerup', function (e) {
      if (!hold || hold.btn !== btn || hold.pid !== e.pointerId) return;
      var fired = hold.count > 0;
      var f = hold.fn;
      stopHold();
      if (!fired) fireOnce(f);
    });
    btn.addEventListener('pointercancel', function () { if (hold && hold.btn === btn) stopHold(); });
    btn.addEventListener('pointerleave', function () { if (hold && hold.btn === btn) stopHold(); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // keyboard activation (Enter/Space) arrives as a click with detail 0
    btn.addEventListener('click', function (e) { if (e.detail === 0) fireOnce(fn); });
  }
  function fireOnce(fn) {
    var okk = false;
    try { okk = !!fn(); } catch (e) { okk = false; }
    if (okk) { dirty = true; patchNow(); }
    return okk;
  }
  function startHold(btn, fn, pid) {
    stopHold();
    hold = { btn: btn, fn: fn, pid: pid, delay: 90, count: 0, timer: 0 };
    setCls(btn, 'held', true);
    hold.timer = setTimeout(repeat, 400);
  }
  var lastHoldPatch = 0;
  function repeat() {
    if (!hold) return;
    hold.count++;
    var okk = false;
    try { okk = !!hold.fn(); } catch (e) { okk = false; }
    if (okk) {
      dirty = true;
      var t = Date.now();
      if (t - lastHoldPatch > 100) { lastHoldPatch = t; patchNow(); }
    }
    if (!hold) return;
    hold.delay = Math.max(40, hold.delay * 0.92);
    hold.timer = setTimeout(repeat, hold.delay);
  }
  function stopHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    setCls(hold.btn, 'held', false);
    hold = null;
  }

  // ---------------------------------------------------------------- toasts
  function toast(title, text, kind) {
    toastQ.push({ title: title || '', text: text || '', kind: kind || '' });
    if (toastQ.length > 8) toastQ.shift();
    pumpToasts();
  }
  function pumpToasts() {
    if (!$.toasts) return;
    while (toastLive.length < MAX_TOASTS && toastQ.length) {
      var t = toastQ.shift();
      var n = el('div', 'toast' + (t.kind ? ' ' + t.kind : ''));
      if (t.title) { n.appendChild(el('b', null, t.title)); if (t.text) n.appendChild(document.createTextNode(' ')); }
      if (t.text) n.appendChild(document.createTextNode(t.text));
      $.toasts.appendChild(n);
      toastLive.push(n);
      scheduleToastEnd(n);
    }
  }
  function scheduleToastEnd(n) {
    setTimeout(function () {
      n.classList.add('out');
      setTimeout(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        var i = toastLive.indexOf(n);
        if (i >= 0) toastLive.splice(i, 1);
        pumpToasts();
      }, 260);
    }, TOAST_MS);
  }

  // ---------------------------------------------------------------- sheets / modals
  function openSheet(node, o) {
    o = o || {};
    closeSheet(true);
    var ov = $.overlay;
    ov.innerHTML = '';
    var sh = el('div', 'sheet');
    sh.appendChild(node);
    ov.appendChild(sh);
    setCls(ov, 'center', !!o.center);
    ov.classList.add('open');
    ov._dismiss = o.dismissable !== false;
    sheetOpen = true;
    sheetOnClose = o.onClose || null;
    try { var f = sh.querySelector('button'); if (f) f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSheet(silent) {
    for (var i = 0; i < sheetTimers.length; i++) clearTimeout(sheetTimers[i]);
    sheetTimers = [];
    if (!sheetOpen) return;
    sheetOpen = false;
    $.overlay.classList.remove('open');
    $.overlay.innerHTML = '';
    var cb = sheetOnClose;
    sheetOnClose = null;
    if (cb && !silent) { try { cb(); } catch (e) { /* ignore */ } }
    dirty = true;
  }

  // ---------------------------------------------------------------- top bar
  function frameTop(state, st) {
    setText($.gold, fmt(state.gold));
    setText($.gps, '+' + fmtRate(st.gps));
    var sm = 1;
    try { sm = HOARD.cave && HOARD.cave.streak ? num(HOARD.cave.streak(), 1) : 1; } catch (e) { sm = 1; }
    setHidden($.chipStreak, !(sm > 1));
    if (sm > 1) setText($.chipStreak, '×' + multStr(sm) + ' streak');
    setHidden($.chipFrenzy, !st.frenzyActive);
    if (st.frenzyActive) setText($.chipFrenzy, 'Frenzy ' + clock(st.frenzyLeft));
    setHidden($.chipEmber, !st.emberActive);
    if (st.emberActive) setText($.chipEmber, 'Ember ' + clock(st.emberLeft));
    var lg = num(state.legend);
    setHidden($.chipLegend, !(lg > 0));
    if (lg > 0) setText($.chipLegend, 'Legend ×' + multStr(st.legendMult));
    // gust ring
    var g = clamp01(state.gust);
    var off = (GUST_C * (1 - g)).toFixed(1);
    if ($.gustRing._o !== off) { $.gustRing._o = off; $.gustRing.setAttribute('stroke-dashoffset', off); }
    var ready = g >= 1;
    setCls($.gust, 'ready', ready);
    var cd = num(st.gustCooldown, 45) || 45;
    setText($.gustSub, ready ? 'Ready' : Math.ceil((1 - g) * cd) + 's');
  }

  // ---------------------------------------------------------------- badges
  function patchBadges(state) {
    var claim = 0;
    for (var i = 0; i < 3; i++) { var mi = E.missionInfo(state, i); if (mi && mi.done && mi.title) claim++; }
    setHidden($.badge.quests, claim < 1);
    setText($.badge.quests, claim);
    var ch = Math.floor(num(state.chests));
    setHidden($.badge.hoard, ch < 1);
    setText($.badge.hoard, ch > 99 ? '99+' : ch);
    var up = E.upgradeList(state), any = false;
    for (var j = 0; j < up.length; j++) if (up[j].visible && !up[j].bought && up[j].affordable) { any = true; break; }
    setHidden($.badge.lair, !any);
    setHidden($.badge.sleep, !E.canSleep(state));
    setHidden($.badge.brood, true);
  }

  // ---------------------------------------------------------------- buy-amount toggle
  function amtToggle() {
    var wrap = el('div', 'seg');
    var vals = [1, 10, 'max'], labels = ['×1', '×10', 'Max'], btns = [];
    vals.forEach(function (v, i) {
      var b = el('button', null, labels[i]);
      b.type = 'button';
      b.addEventListener('click', function () {
        var s = S();
        if (!s) return;
        if (!s.settings) s.settings = {};
        s.settings.buyAmt = v;
        dirty = true; patchNow();
      });
      btns.push(b);
      wrap.appendChild(b);
    });
    wrap.patch = function (state) {
      var a = buyAmt(state);
      for (var i = 0; i < vals.length; i++) setCls(btns[i], 'on', vals[i] === a);
    };
    return wrap;
  }

  // cost line: gold part + optional minion part, unaffordable bits marked
  function costLine() {
    var c = el('div', 'cost');
    c.g = el('span', 'c-gold');
    c.m = el('span', 'c-min');
    c.sep = document.createTextNode('');
    add(c, c.g, c.sep, c.m);
    c.patch = function (gold, haveGold, minTier, minions, haveMin) {
      setText(c.g, fmt(gold) + ' gold');
      setCls(c.g, 'short', haveGold < gold);
      if (minTier >= 0 && minions > 0) {
        if (c.sep.data !== ' + ') c.sep.data = ' + ';
        setText(c.m, fmt(minions) + ' ' + tierName(minTier, minions));
        setCls(c.m, 'short', haveMin + 1e-9 < minions);
      } else {
        if (c.sep.data !== '') c.sep.data = '';
        setText(c.m, '');
      }
    };
    return c;
  }

  function buyButton() {
    var b = button('buy', '');
    b.l = el('span', null, 'Buy');
    b.s = el('small', null, '×1');
    add(b, b.l, b.s);
    return b;
  }

  function milestonePatch(row, kind, owned) {
    var next = E.nextMilestone(kind, owned);
    if (next === null || next === undefined) {
      setW(row.mbar.fill, 1);
      setText(row.mL, 'All milestones reached');
      setText(row.mR, '');
      return;
    }
    setW(row.mbar.fill, owned / next);
    setText(row.mL, fmt(owned) + '/' + fmt(next));
    setText(row.mR, '→ ×2 output');
  }
  function milestoneBits(row, host) {
    row.mbar = bar();
    row.mlab = el('div', 'bar-label');
    row.mL = el('span');
    row.mR = el('span');
    add(row.mlab, row.mL, row.mR);
    add(host, row.mbar, row.mlab);
  }

  // ================================================================ LAIR
  function buildLair(state) {
    var root = el('div');
    var parts = [];
    var head = secHead('Lair');
    var tog = amtToggle();
    head.appendChild(tog);
    root.appendChild(head);
    parts.push(function (s) { tog.patch(s); });

    // upgrades: one compact horizontal strip (fixed height), so the Buildings list below never jumps
    var ups = E.upgradeList(state).filter(function (u) { return u.visible && !u.bought; });
    if (ups.length) {
      var uh = el('div', 'upg-head');
      add(uh, el('span', null, 'Upgrades'), el('span', 'aside', ups.length + ' available · one-time'));
      root.appendChild(uh);
      var strip = el('div', 'upg-strip');
      ups.forEach(function (u) {
        var b = el('button', 'upg-tile buy');
        b.type = 'button';
        var cg = el('div', 'u-cost num', fmt(u.cost) + ' gold');
        add(b, el('div', 'u-name', u.name), el('div', 'u-text', u.text), cg);
        b.addEventListener('click', function () {
          var s = S();
          if (s && E.buyUpgrade(s, u.id)) { buzz(10); toast(u.name, '', 'gold'); dirty = true; patchNow(); }
        });
        strip.appendChild(b);
        parts.push(function (s) {
          var have = num(s.gold);
          setCls(b, 'can', have >= u.cost);
          setCls(cg, 'short', have < u.cost);
        });
      });
      root.appendChild(strip);
    }

    root.appendChild(secHead('Buildings'));
    var lockedShown = false;
    D.buildings.forEach(function (bd) {
      if (!E.isUnlocked(state, 'building', bd.id)) {
        if (!lockedShown) {
          lockedShown = true;
          root.appendChild(el('div', 'card locked', 'Reach Dragon Rank ' + bd.rank + ' to unlock ' + bd.name + '.'));
        }
        return;
      }
      var row = {};
      var c = el('div', 'card');
      var r1 = el('div', 'row');
      var g1 = el('div', 'grow');
      row.rate = el('div', 'sub num');
      add(g1, el('div', 'name', bd.name), row.rate);
      row.owned = el('div', 'owned');
      add(r1, g1, row.owned);
      var r2 = el('div', 'row');
      var g2 = el('div', 'grow');
      row.cost = costLine();
      g2.appendChild(row.cost);
      milestoneBits(row, g2);
      row.btn = buyButton();
      bindHold(row.btn, function () {
        var s = S();
        return !!(s && E.buyBuilding(s, bd.id, buyAmt(s)));
      });
      add(r2, g2, row.btn);
      add(c, r1, r2);
      root.appendChild(c);
      parts.push(function (s, st) {
        var owned = Math.floor(num(s.buildings[bd.id]));
        setText(row.owned, fmt(owned));
        var total = num(st.buildingGps && st.buildingGps[bd.id]);
        var each = st.buildingEach && st.buildingEach[bd.id] !== undefined ? num(st.buildingEach[bd.id]) : (owned > 0 ? total / owned : 0);
        setText(row.rate, owned > 0 ? fmtRate(each) + ' each · ' + fmtRate(total) + ' total' : fmtRate(each) + ' each');
        var amt = buyAmt(s);
        var cost = E.buildingCost(s, bd.id, amt);
        var n = Math.max(1, Math.floor(num(cost.n, amt === 'max' ? 1 : amt)));
        var mt = cost.minionTier;
        row.cost.patch(num(cost.gold), num(s.gold), mt, num(cost.minions), mt >= 0 ? num(s.tiers[mt]) : 0);
        var max = E.buildingMax(s, bd.id);
        setCls(row.btn, 'can', max >= (amt === 'max' ? 1 : amt));
        setText(row.btn.s, '×' + fmt(n));
        milestonePatch(row, 'building', owned);
      });
    });

    return { root: root, patch: function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); } };
  }
  function keyLair(state) {
    var ups = E.upgradeList(state), k = 'L' + state.rank + ':';
    for (var i = 0; i < ups.length; i++) if (ups[i].visible && !ups[i].bought) k += ups[i].id + ',';
    return k;
  }

  // ================================================================ BROOD
  function chainLink(text) {
    var d = el('div', 'chain-link');
    d.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
    d.appendChild(el('span', null, text));
    return d;
  }
  function buildBrood(state) {
    var root = el('div');
    var parts = [];
    var head = secHead('Brood');
    var tog = amtToggle();
    head.appendChild(tog);
    root.appendChild(head);
    parts.push(function (s) { tog.patch(s); });
    root.appendChild(el('p', 'hint', 'Each kind of dragon raises the kind below it. Hold Buy to hatch many.'));

    var shownLocked = false;
    D.tiers.forEach(function (td, i) {
      if (!E.isUnlocked(state, 'tier', i)) {
        if (!shownLocked) {
          shownLocked = true;
          root.appendChild(chainLink(td.name + ' would ' + (td.verb ? td.verb.replace(/s$/, '') : 'raise') + ' ' + D.tiers[i - 1].name));
          root.appendChild(el('div', 'card locked', 'Reach Dragon Rank ' + (i + 1) + ' to unlock ' + td.name + '.'));
        }
        return;
      }
      if (i > 0) root.appendChild(chainLink(td.name + ' ' + (td.verb ? td.verb.replace(/s$/, '') : 'raise') + ' ' + D.tiers[i - 1].name));
      var row = {};
      var c = el('div', 'card');
      var r1 = el('div', 'row');
      var g1 = el('div', 'grow');
      row.prod = el('div', 'sub num');
      row.net = el('div', 'sub num');
      add(g1, el('div', 'name', td.name), row.prod, row.net);
      row.owned = el('div', 'owned');
      add(r1, g1, row.owned);
      var r2 = el('div', 'row');
      var g2 = el('div', 'grow');
      row.cost = costLine();
      g2.appendChild(row.cost);
      milestoneBits(row, g2);
      row.btn = buyButton();
      bindHold(row.btn, function () {
        var s = S();
        return !!(s && E.buyTier(s, i, buyAmt(s)));
      });
      add(r2, g2, row.btn);
      add(c, r1, r2);
      root.appendChild(c);
      parts.push(function (s, st) {
        var cnt = Math.floor(num(s.tiers[i]));
        setText(row.owned, fmt(cnt));
        if (i === 0) {
          setText(row.prod, td.text || 'Spent on buildings and Wyrmlings.');
        } else {
          var unit = st.tierUnitRate ? num(st.tierUnitRate[i]) : td.prod;
          setText(row.prod, 'Each ' + td.verb + ' ' + fmt(unit) + ' ' + tierName(i - 1, 2) + '/s');
        }
        var net = st.tierRates ? num(st.tierRates[i]) : 0;
        var nextOn = !!D.tiers[i + 1] && E.isUnlocked(s, 'tier', i + 1);
        var idle = !D.tiers[i + 1] ? 'Hatched only by your own hand' :
          (!nextOn ? (i === 0 ? 'Bought with gold for now' : 'Bought by hand for now') :
            (pos0(s.tiers[i + 1]) ? D.tiers[i + 1].name + ' raise more of these' : 'Hatch ' + D.tiers[i + 1].name + ' to raise more of these'));
        setText(row.net, net > 0 ? 'Gaining +' + fmtRate(net) : idle);
        var amt = buyAmt(s);
        var cost = E.tierCost(s, i, amt);
        var n = Math.max(1, Math.floor(num(cost.n, amt === 'max' ? 1 : amt)));
        var pt = cost.prevTier;
        row.cost.patch(num(cost.gold), num(s.gold), pt, num(cost.prev), pt >= 0 ? num(s.tiers[pt]) : 0);
        var max = E.tierMax(s, i);
        setCls(row.btn, 'can', max >= (amt === 'max' ? 1 : amt));
        setText(row.btn.s, '×' + fmt(n));
        milestonePatch(row, 'tier', cnt);
      });
    });
    return { root: root, patch: function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); } };
  }
  function keyBrood(state) { return 'B' + state.rank; }

  // ================================================================ QUESTS
  function nextRankPerk(rank) {
    var nr = rank + 1, out = [];
    D.buildings.forEach(function (b) { if (b.rank === nr) out.push(b.name); });
    D.tiers.forEach(function (t, i) { if (i + 1 === nr) out.push(t.name); });
    if (out.length) return 'Next rank unlocks ' + out.join(' and ') + ', plus a bonus chest.';
    if (nr > D.C.rankGpsAfter) return 'Next rank: +5% gold/s and a bonus chest.';
    return 'Next rank: a bonus chest.';
  }
  function buildQuests(state) {
    var root = el('div');
    var parts = [];
    var rank = Math.floor(num(state.rank, 1));
    var maxRank = D.C.maxRank || 12;

    var rb = el('div', 'card rank-box');
    var rt = el('div', 'rank-title', 'Dragon Rank ' + rank);
    rb.appendChild(rt);
    var need = E.rankNeed(state);
    var pips = el('div', 'pips'), pipEls = [];
    if (rank < maxRank) {
      for (var p = 0; p < need; p++) { var pe = el('span', 'pip'); pipEls.push(pe); pips.appendChild(pe); }
      rb.appendChild(pips);
      var rsub = el('div', 'sub num');
      rb.appendChild(rsub);
      rb.appendChild(el('div', 'sub', nextRankPerk(rank)));
      parts.push(function (s) {
        var prog = Math.floor(num(s.rankProgress));
        for (var k = 0; k < pipEls.length; k++) setCls(pipEls[k], 'on', k < prog);
        setText(rsub, prog + ' of ' + need + ' quests claimed toward Rank ' + (rank + 1));
      });
    } else {
      rb.appendChild(el('div', 'sub', 'The highest rank a young dragon can reach. Quests still give chests.'));
    }
    root.appendChild(rb);

    var qh = secHead('Quests', 'Each claim gives a chest');
    var claimAll = button('moss small', 'Claim all', function () {
      var s = S();
      if (!s) return;
      var n = 0, ch = 0, ranks = 0;
      for (var guard = 0; guard < 12; guard++) {
        var hit = -1;
        for (var q = 0; q < 3; q++) { var mi = E.missionInfo(s, q); if (mi.done) { hit = q; break; } }
        if (hit < 0) break;
        var res = E.claimMission(s, hit);
        if (!res || !res.ok) break;
        n++; ch += num(res.chests); if (res.rankUp) ranks++;
      }
      if (n) {
        buzz(14);
        toast(n + ' ' + plural(n, 'quest', 'quests') + ' claimed.', '+' + ch + ' ' + plural(ch, 'chest', 'chests'), 'moss');
        dirty = true; patchNow();
      }
    });
    qh.appendChild(claimAll);
    root.appendChild(qh);
    parts.push(function (s) {
      var d = 0;
      for (var q = 0; q < 3; q++) if (E.missionInfo(s, q).done) d++;
      setHidden(claimAll, d < 2);
      setHidden(qh.aside, d >= 2);
      if (d >= 2) setText(claimAll, 'Claim all (' + d + ')');
    });
    for (var i = 0; i < 3; i++) (function (idx) {
      var row = {};
      var c = el('div', 'card mission');
      var r = el('div', 'row');
      var g = el('div', 'grow');
      row.title = el('div', 'name');
      row.bar = bar('moss');
      row.lab = el('div', 'bar-label');
      row.cur = el('span');
      row.pct = el('span');
      add(row.lab, row.cur, row.pct);
      add(g, row.title, row.bar, row.lab);
      row.btn = button('moss', 'Claim', function () {
        var s = S();
        if (!s) return;
        var res = E.claimMission(s, idx);
        if (res && res.ok) {
          buzz(12);
          toast('Quest claimed.', '+' + res.chests + ' ' + plural(res.chests, 'chest', 'chests'), 'moss');
          dirty = true; patchNow();
        }
      });
      add(r, g, row.btn);
      c.appendChild(r);
      root.appendChild(c);
      parts.push(function (s) {
        var mi = E.missionInfo(s, idx);
        setText(row.title, mi.title || 'A new quest is coming');
        setW(row.bar.fill, mi.frac);
        setText(row.cur, fmt(Math.min(num(mi.cur), num(mi.target))) + ' / ' + fmt(mi.target));
        setText(row.pct, mi.done ? 'Done' : Math.floor(clamp01(mi.frac) * 100) + '%');
        setHidden(row.btn, !mi.done);
        setCls(c, 'done', !!mi.done);
      });
    })(i);

    root.appendChild(secHead('Treasure chests'));
    root.appendChild(chestBox(parts));
    return { root: root, patch: function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); } };
  }
  function keyQuests(state) {
    var k = 'Q' + state.rank + ':';
    var m = state.missions || [];
    for (var i = 0; i < m.length; i++) k += (m[i] && m[i].uid) + ',';
    return k;
  }
  var CHEST_SVG = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 20c0-7 5-11 18-11s18 4 18 11v20H6z"/><path d="M6 22h36M20 22v6h8v-6"/><path d="M14 10v30M34 10v30" opacity=".45"/></svg>';
  function chestBox(parts) {
    var c = el('div', 'card');
    var r = el('div', 'chest-box');
    var ico = el('div', 'chest-ico');
    ico.innerHTML = CHEST_SVG;
    var g = el('div', 'grow');
    var cnt = el('div', 'name num');
    var sub = el('div', 'sub');
    add(g, cnt, sub);
    var b = button('', 'Open chest', function () { openChestModal(Math.floor(num((S() || {}).chests)) > 1); });
    add(r, ico, g, b);
    c.appendChild(r);
    parts.push(function (s) {
      var n = Math.floor(num(s.chests));
      setText(cnt, n + ' unopened ' + plural(n, 'chest', 'chests'));
      var per = num(s.rank, 1) >= (D.C.chestCardsRank || 6) ? (D.C.chestCardsHigh || 3) : (D.C.chestCardsLow || 2);
      setText(sub, n > 0 ? 'Each holds ' + per + ' treasure cards.' : 'Claim quests to earn chests.');
      setCls(b, 'can', n > 0);
      setDis(b, n < 1);
      setText(b, n > 1 ? 'Open all (' + n + ')' : 'Open chest');
    });
    return c;
  }

  // chest modal: cards revealed one by one; "all" opens every chest at once and groups duplicates
  function openChestModal(all) {
    var s = S();
    if (!s || Math.floor(num(s.chests)) < 1) return;
    var before = {};
    var k;
    for (k in s.cards) if (Object.prototype.hasOwnProperty.call(s.cards, k)) before[k] = Math.floor(num(s.cards[k]));
    var opened = 0, ids = [];
    do {
      var got = E.openChest(s);
      if (!got || !got.length) break;
      ids = ids.concat(got); opened++;
    } while (all && opened < 500 && Math.floor(num(s.chests)) >= 1);
    if (!ids.length) return;
    buzz(10);
    dirty = true;
    var mult = {};
    if (all) { // group duplicates: one cell per card, with a count
      var uniq = [];
      ids.forEach(function (id) { if (!mult[id]) { mult[id] = 0; uniq.push(id); } mult[id]++; });
      ids = uniq;
    }
    var box = el('div');
    add(box, el('h3', null, opened > 1 ? opened + ' treasure chests' : 'A treasure chest'), el('p', 'muted', 'The lid creaks open...'));
    var grid = el('div', 'reveal' + (all ? ' many' : ''));
    var cells = ids.map(function () {
      var cell = el('div', 'rcard');
      cell.appendChild(el('div', 'rc-q', '?'));
      grid.appendChild(cell);
      return cell;
    });
    box.appendChild(grid);
    var btns = el('div', 'btn-row');
    var left = Math.floor(num(s.chests));
    var again = button('', 'Open another (' + left + ')', function () { openChestModal(false); });
    var allB = button('can', 'Open all (' + left + ')', function () { openChestModal(true); });
    var done = button(left > 1 ? '' : 'can', 'Done', function () { closeSheet(); });
    if (left > 1) add(btns, done, again, allB);
    else add(btns, again, done);
    box.appendChild(btns);
    setHidden(again, left < 1);
    var counts = {};
    function reveal(i) {
      var id = ids[i];
      var d = cardDef(id);
      var m = mult[id] || 1;
      var prev = (before[id] || 0) + (counts[id] || 0);
      counts[id] = (counts[id] || 0) + m;
      var now = prev + m;
      var info = E.cardInfo(s, id);
      var lb = levelFor(prev), la = levelFor(now);
      var note = prev === 0 ? 'New!' : (la > lb ? 'Lv ' + lb + ' \u2192 ' + la : '+' + m + ' ' + plural(m, 'copy', 'copies'));
      var cell = cells[i];
      cell.innerHTML = '';
      cell.className = 'rcard shown r-' + (info.rarity || 'common');
      var nameT = ((d && d.name) || info.name) + (m > 1 ? ' \u00d7' + m : '');
      add(cell, el('div', 'rc-rar', rarityName(info.rarity)), el('div', 'rc-name', nameT),
        el('div', 'rc-text', info.text || ''), el('div', 'rc-note' + (la > lb && prev > 0 ? ' up' : ''), note));
      if (info.rarity === 'legendary' || info.rarity === 'epic') buzz(15);
    }
    var rm = reducedMotion() || all;
    openSheet(box, { center: true });
    for (var i = 0; i < ids.length; i++) {
      (function (j) {
        if (rm) reveal(j);
        else sheetTimers.push(setTimeout(function () { reveal(j); }, 380 + j * 520));
      })(i);
    }
  }

  // ================================================================ HOARD (collection)
  function buildHoard(state) {
    var root = el('div');
    var parts = [];
    var owned = 0;
    D.cards.forEach(function (c) { if (num(state.cards[c.id]) > 0) owned++; });
    root.appendChild(secHead('Treasure cards', owned + ' of ' + D.cards.length + ' found'));
    root.appendChild(el('p', 'hint', 'Duplicates level a card up. Tap a card to see what it does.'));
    var grid = el('div', 'grid');
    var sorted = D.cards.filter(function (c) { return num(state.cards[c.id]) > 0; })
      .concat(D.cards.filter(function (c) { return !(num(state.cards[c.id]) > 0); }));
    sorted.forEach(function (cd) {
      var has = num(state.cards[cd.id]) > 0;
      var b = el('button', 'tcard r-' + cd.rarity + (has ? '' : ' unowned'));
      b.type = 'button';
      b.addEventListener('click', function () { cardSheet(cd.id); });
      if (!has) {
        add(b, el('div', 't-rar', rarityName(cd.rarity)), el('div', 't-name', '???'));
      } else {
        var lvl = el('div', 't-lvl num');
        var bb = bar();
        var cp = el('div', 'bar-label');
        var cpl = el('span');
        cp.appendChild(cpl);
        add(b, el('div', 't-rar', rarityName(cd.rarity)), el('div', 't-name', cd.name), lvl, bb, cp);
        parts.push(function (s) {
          var info = E.cardInfo(s, cd.id);
          setText(lvl, 'Lv ' + info.level);
          if (info.nextAt) {
            setW(bb.fill, info.copies / info.nextAt);
            setText(cpl, info.copies + '/' + info.nextAt + ' copies');
          } else {
            setW(bb.fill, 1);
            setText(cpl, 'Max level');
          }
        });
      }
      grid.appendChild(b);
    });
    root.appendChild(grid);
    root.appendChild(secHead('Chests'));
    root.appendChild(chestBox(parts));
    return { root: root, patch: function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); } };
  }
  function keyHoard(state) {
    var k = 'H';
    for (var i = 0; i < D.cards.length; i++) k += num(state.cards[D.cards[i].id]) > 0 ? '1' : '0';
    return k;
  }
  function cardSheet(id) {
    var s = S();
    if (!s) return;
    var info = E.cardInfo(s, id);
    var d = cardDef(id);
    var box = el('div', 'r-' + (info.rarity || 'common'));
    var rar = el('div', 'rc-rar', rarityName(info.rarity));
    rar.style.color = 'var(--rc)';
    rar.style.fontWeight = '700';
    rar.style.textTransform = 'uppercase';
    rar.style.letterSpacing = '0.08em';
    rar.style.fontSize = '13px';
    box.appendChild(rar);
    if (info.copies < 1) {
      add(box, el('h3', null, 'Undiscovered'),
        el('p', 'muted', 'This treasure has not turned up yet. Claim quests for chests and keep looking.'));
    } else {
      add(box, el('h3', null, info.name));
      if (d && d.flavor) box.appendChild(el('p', 'flavor', d.flavor));
      var kv = el('div');
      function line(a, b) { var r = el('div', 'kv'); add(r, el('span', null, a), el('span', null, b)); kv.appendChild(r); }
      line('Level', String(info.level));
      line('Copies', info.nextAt ? info.copies + ' / ' + info.nextAt + ' for next level' : info.copies + ' (max level)');
      box.appendChild(kv);
      box.appendChild(el('p', null, 'Now: ' + info.text));
      if (info.nextAt && d && typeof d.describe === 'function') {
        var nt = '';
        try { nt = d.describe(info.level + 1); } catch (e) { nt = ''; }
        if (nt) box.appendChild(el('p', 'muted', 'Next level: ' + nt));
      }
    }
    var br = el('div', 'btn-row');
    br.appendChild(button('', 'Close', function () { closeSheet(); }));
    box.appendChild(br);
    openSheet(box);
  }

  // ================================================================ SLEEP + settings
  function buildSleep(state) {
    var root = el('div');
    var parts = [];
    var req = D.C.sleepReq || 1e7;
    root.appendChild(secHead('Long Sleep'));
    var c = el('div', 'card');
    add(c,
      el('p', null, 'Curl up on your hoard and sleep for an age. You wake small again, but the tale of your hoard spreads. Every point of Legend adds +10% to gold/s, coin worth and brood output, for good.'),
      el('p', 'sub', 'You keep treasure cards and chests, and get one bonus chest. Gold, brood, buildings, upgrades and Dragon Rank start over.'));
    var pb = bar();
    var pl = el('div', 'bar-label');
    var plL = el('span'), plR = el('span');
    add(pl, plL, plR);
    add(c, pb, pl);
    var gainRow = el('div', 'row');
    gainRow.style.marginTop = '12px';
    var gg = el('div', 'grow');
    var gainNum = el('div', 'big-num');
    add(gg, el('div', 'sub', 'Legend if you sleep now'), gainNum);
    var sbtn = button('', 'Sleep', function () { sleepSheet(); });
    add(gainRow, gg, sbtn);
    c.appendChild(gainRow);
    root.appendChild(c);
    parts.push(function (s) {
      var er = num(s.earnedRun);
      setW(pb.fill, er / req);
      setText(plL, 'Earned this Sleep: ' + fmt(er));
      setText(plR, 'needs ' + fmt(req));
      var can = E.canSleep(s);
      setText(gainNum, can ? '+' + fmt(E.legendOnSleep(s)) : '0');
      setCls(sbtn, 'can', can);
      setDis(sbtn, !can);
    });

    var lc = el('div', 'card');
    var lgv = el('span'), lbv = el('span'), slv = el('span');
    function kv(a, v) { var r = el('div', 'kv'); add(r, el('span', null, a), v); return r; }
    add(lc, kv('Legend', lgv), kv('Legend bonus', lbv), kv('Long Sleeps taken', slv));
    root.appendChild(lc);
    parts.push(function (s, st) {
      setText(lgv, fmt(s.legend));
      setText(lbv, '×' + multStr(st.legendMult));
      setText(slv, fmt(s.sleeps));
    });

    root.appendChild(secHead('Your hoard so far'));
    var sc = el('div', 'card');
    var a1 = el('span'), a2 = el('span'), a3 = el('span'), a4 = el('span'), a5 = el('span');
    add(sc, kv('Gold earned, all time', a1), kv('Coins gathered', a2), kv('Treasures grabbed', a3), kv('Wing Gusts', a4), kv('Best streak', a5));
    root.appendChild(sc);
    parts.push(function (s) {
      var t = s.stat || {};
      setText(a1, fmt(s.earnedAll));
      setText(a2, fmt(t.coins));
      setText(a3, fmt(t.treasures));
      setText(a4, fmt(t.gusts));
      setText(a5, '×' + multStr(t.bestStreak || 1));
    });

    // settings
    var sh = secHead('Settings');
    sh.id = 'settings';
    root.appendChild(sh);
    var set = el('div', 'card');
    function toggleRow(label, key, onChange) {
      var r = el('div', 'toggle-row');
      var sw = el('button', 'switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', label);
      sw.addEventListener('click', function () {
        var s = S();
        if (!s) return;
        if (!s.settings) s.settings = {};
        s.settings[key] = !s.settings[key];
        if (onChange) onChange(s.settings[key]);
        dirty = true; patchNow();
      });
      add(r, el('span', null, label), sw);
      parts.push(function (s) {
        var v = !!(s.settings && s.settings[key]);
        if (sw._v !== v) { sw._v = v; sw.setAttribute('aria-checked', v ? 'true' : 'false'); }
      });
      return r;
    }
    set.appendChild(toggleRow('Vibration', 'haptics', function (v) { if (v) buzz(10); }));
    set.appendChild(toggleRow('Reduce motion', 'reducedMotion', applyMotionClass));

    var saveP = el('p', 'sub', 'Your hoard saves on this device by itself. Copy the save to keep a backup, or paste one below to load it.');
    saveP.style.marginTop = '12px';
    set.appendChild(saveP);
    var ta = el('textarea', 'savebox');
    ta.setAttribute('aria-label', 'Save text');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('autocomplete', 'off');
    ta.placeholder = 'Paste a save here, then press Load save.';
    set.appendChild(ta);
    var r1 = el('div', 'btn-row');
    var copyB = button('', 'Copy save', function () {
      var s = S();
      if (!s) return;
      var txt = E.serialize(s);
      ta.value = txt;
      var fallback = function () {
        try { ta.focus(); ta.select(); ta.setSelectionRange(0, txt.length); } catch (e) { /* ignore */ }
        try { if (document.execCommand && document.execCommand('copy')) { toast('Save copied.', '', 'moss'); return; } } catch (e) { /* ignore */ }
        toast('Save shown below.', 'Select it and copy.', '');
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () { toast('Save copied.', 'Keep it somewhere safe.', 'moss'); }, fallback);
        } else fallback();
      } catch (e) { fallback(); }
    });
    var loadB = button('', 'Load save', function () {
      var txt = String(ta.value || '').trim();
      if (!txt) { toast('Paste a save first.', '', 'ember'); return; }
      var parsed = null;
      try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
      if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.tiers) && typeof parsed.json !== 'string')) {
        toast('That is not a Hoard save.', '', 'ember');
        return;
      }
      confirmSheet('Load this save?', 'Your current hoard is replaced by the pasted one. Copy your current save first if you want to keep it.',
        'Load save', 'Keep current', false, function () {
          var ns = E.deserialize(parsed);
          if (opts.replaceState) opts.replaceState(ns);
          ta.value = '';
          toast('Save loaded.', '', 'moss');
        });
    });
    add(r1, copyB, loadB);
    set.appendChild(r1);
    var r2 = el('div', 'btn-row');
    r2.style.marginTop = '18px';
    r2.appendChild(button('danger', 'Start over', function () {
      confirmSheet('Start over from nothing?', 'This erases all gold, brood, cards, chests and Legend on this device and in your cloud save. It cannot be undone.',
        'Erase everything', 'Keep my hoard', true, function () {
          if (opts.resetAll) opts.resetAll();
          toast('A new egg, a new hoard.', '', '');
          setTab('lair');
        });
    }));
    set.appendChild(r2);
    root.appendChild(set);
    root.appendChild(el('p', 'hint', 'Hoard v1. Swipe the cave to gather gold. A quick flick sends a Wing Gust.'));

    return { root: root, patch: function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); } };
  }
  function keySleep() { return 'S'; }

  function confirmSheet(title, text, yes, no, danger, onYes) {
    var box = el('div');
    add(box, el('h3', null, title), el('p', 'muted', text));
    var br = el('div', 'btn-row');
    var y = button(danger ? 'danger' : 'can', yes, function () { closeSheet(true); onYes(); dirty = true; });
    var n = button('ghost', no, function () { closeSheet(); });
    add(br, n, y);
    box.appendChild(br);
    openSheet(box, { center: true });
  }
  function sleepSheet() {
    var s = S();
    if (!s || !E.canSleep(s)) return;
    var g = E.legendOnSleep(s);
    var box = el('div');
    add(box,
      el('h3', null, 'Begin the Long Sleep?'),
      el('p', null, 'You wake with +' + fmt(g) + ' Legend, for ×' + multStr(1 + 0.1 * (num(s.legend) + g)) + ' gold, coins and brood.'),
      el('p', 'muted', 'Gold, brood, buildings, upgrades and Dragon Rank reset. Cards and chests stay, and you get a bonus chest.'));
    var br = el('div', 'btn-row');
    add(br,
      button('ghost', 'Stay awake', function () { closeSheet(); }),
      button('can', 'Sleep now', function () {
        closeSheet(true);
        var st = S();
        if (!st) return;
        E.sleep(st);
        if (opts.saveNow) opts.saveNow(true);
        dirty = true;
        setTab('lair');
      }));
    box.appendChild(br);
    openSheet(box, { center: true });
  }

  // ---------------------------------------------------------------- tabs
  var TABS = {
    lair: { build: buildLair, key: keyLair },
    brood: { build: buildBrood, key: keyBrood },
    quests: { build: buildQuests, key: keyQuests },
    hoard: { build: buildHoard, key: keyHoard },
    sleep: { build: buildSleep, key: keySleep }
  };
  function setTab(name) {
    if (!TABS[name]) return;
    stopHold();
    if (tab !== name) {
      tab = name;
      view = null;
      if ($.panel) $.panel.scrollTop = 0;
    }
    for (var i = 0; i < $.tabBtns.length; i++) {
      var b = $.tabBtns[i];
      var on = b.getAttribute('data-tab') === name;
      setCls(b, 'on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
    dirty = true;
    patchNow();
  }
  function refreshPanel(state, st) {
    var t = TABS[tab];
    var key = '';
    try { key = t.key(state); } catch (e) { key = '?'; }
    var stale = !view || view.key !== key || state !== lastState;
    if (stale && !(hold && view && state === lastState)) {
      stopHold(); // the held button is about to be detached; never let its repeat outlive it
      var top = $.panel.scrollTop;
      var keepScroll = !!view && state === lastState;
      var v = t.build(state);
      v.key = key;
      $.panel.innerHTML = '';
      $.panel.appendChild(v.root);
      view = v;
      if (keepScroll) $.panel.scrollTop = top;
    }
    lastState = state;
    if (view) view.patch(state, st);
    patchBadges(state);
  }
  function patchNow() {
    var s = S();
    if (!s || !inited) return;
    try {
      var st = E.stats(s);
      refreshPanel(s, st);
      frameTop(s, st);
      listTimer = 0;
      dirty = false;
    } catch (e) {
      try { console.error('[HOARD] ui', e); } catch (e2) { /* ignore */ }
    }
  }

  function reducedMotion() {
    var s = S();
    if (s && s.settings && s.settings.reducedMotion) return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function applyMotionClass(v) {
    try { document.documentElement.classList.toggle('rm', !!v); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- engine events
  function bindEvents() {
    E.on('rank', function (r) {
      buzz(15);
      toast('Dragon Rank ' + r + '!', 'A bonus chest is yours.', 'gold');
    });
    E.on('mission', function (idx) {
      var s = S();
      var mi = s ? E.missionInfo(s, idx) : null;
      toast('Quest done:', (mi && mi.title ? mi.title : 'claim it in Quests'), 'moss');
    });
    E.on('treasure', function (res) {
      if (!res || !res.title) return;
      toast(res.title, res.text || '', res.kind === 'frenzy' || res.kind === 'ember' ? 'ember' : 'gold');
    });
    E.on('sleep', function (g) {
      toast('You wake, small and hungry.', '+' + fmt(g) + ' Legend.', 'gold');
    });
    E.on('unlock', function (u) {
      if (!u || !u.name) return;
      toast('Unlocked:', u.name + (u.kind === 'tier' ? ' in Brood.' : ' in Lair.'), 'gold');
    });
    E.on('milestone', function (m) {
      if (!m) return;
      var name = '';
      if (m.kind === 'building') { for (var i = 0; i < D.buildings.length; i++) if (D.buildings[i].id === m.id) name = D.buildings[i].name; }
      else if (m.kind === 'tier' && D.tiers[m.id]) name = D.tiers[m.id].name;
      if (!name) return;
      toast(name + ' ×2', 'for owning ' + fmt(m.count) + '.', 'gold');
    });
  }

  // ---------------------------------------------------------------- welcome back
  ui.welcome = function (res) {
    if (!inited || !res) return;
    var sec = num(res.seconds);
    if (sec < 60) return;
    var box = el('div');
    add(box, el('h3', null, 'While you slept…'),
      el('p', 'muted', 'You were away for ' + fmtTime(sec) + '. The kobolds kept digging.'),
      el('div', 'welcome-gold', '+' + fmt(res.gold)),
      el('p', 'sub', 'gold added to your hoard'));
    var m = res.minions || [];
    var any = false;
    var list = el('div');
    for (var i = 0; i < 5; i++) {
      var g = num(m[i]);
      if (g >= 1) {
        any = true;
        var r = el('div', 'kv');
        add(r, el('span', null, D.tiers[i] ? D.tiers[i].name : ''), el('span', null, '+' + fmt(Math.floor(g))));
        list.appendChild(r);
      }
    }
    if (any) box.appendChild(list);
    var s = S();
    var capH = 8;
    try { capH = num(E.stats(s).offlineCapHours, 8); } catch (e) { capH = 8; }
    if (sec >= capH * 3600 - 1) box.appendChild(el('p', 'muted', 'Your hoard can only grow for ' + capH + 'h while you are away.'));
    var br = el('div', 'btn-row');
    br.appendChild(button('can', 'Back to the hoard', function () { closeSheet(); }));
    box.appendChild(br);
    openSheet(box, { center: true });
  };

  ui.toast = toast;
  ui.refresh = function () { stopHold(); dirty = true; view = null; patchNow(); };
  // two-choice sheet; onNo also runs when the sheet is dismissed
  ui.ask = function (title, text, yes, no, onYes, onNo) {
    var box = el('div');
    add(box, el('h3', null, title), el('p', 'muted', text));
    var br = el('div', 'btn-row');
    add(br, button('ghost', no, function () { closeSheet(); }),
      button('can', yes, function () { closeSheet(true); try { onYes(); } catch (e) { /* ignore */ } dirty = true; }));
    box.appendChild(br);
    openSheet(box, { center: true, dismissable: false, onClose: onNo });
  };
  ui.setTab = setTab;
  ui.closeSheet = function () { closeSheet(); };

  // ---------------------------------------------------------------- init + frame
  ui.init = function (o) {
    opts = o || {};
    E = HOARD.engine; D = HOARD.data;
    fmt = HOARD.fmt; fmtRate = HOARD.fmtRate; fmtTime = HOARD.fmtTime;
    if (inited) { view = null; dirty = true; patchNow(); return; }
    $.gold = document.getElementById('gold');
    $.gps = document.getElementById('gps');
    $.chipStreak = document.getElementById('chip-streak');
    $.chipFrenzy = document.getElementById('chip-frenzy');
    $.chipEmber = document.getElementById('chip-ember');
    $.chipLegend = document.getElementById('chip-legend');
    $.gust = document.getElementById('gust');
    $.gustRing = document.getElementById('gust-ring');
    $.gustSub = document.getElementById('gust-sub');
    $.toasts = document.getElementById('toasts');
    $.panel = document.getElementById('panel');
    $.overlay = document.getElementById('overlay');
    $.tabBtns = Array.prototype.slice.call(document.querySelectorAll('#tabs button[data-tab]'));
    $.badge = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-badge]'), function (b) { $.badge[b.getAttribute('data-badge')] = b; });
    if (!$.gold || !$.panel || !$.overlay) return;
    inited = true;

    $.tabBtns.forEach(function (b) {
      b.addEventListener('click', function () { closeSheet(true); setTab(b.getAttribute('data-tab')); });
    });
    $.gust.addEventListener('click', function () {
      try { if (HOARD.cave && HOARD.cave.gust) HOARD.cave.gust(); } catch (e) { /* ignore */ }
    });
    var setBtn = document.getElementById('btn-settings');
    if (setBtn) setBtn.addEventListener('click', function () {
      setTab('sleep');
      try { var t = document.getElementById('settings'); if (t) t.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ }
    });
    $.overlay.addEventListener('click', function (e) {
      if (e.target === $.overlay && $.overlay._dismiss) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetOpen && $.overlay._dismiss) closeSheet();
    });
    window.addEventListener('blur', stopHold);
    // safety net: a release anywhere ends the hold, even if the held button was rebuilt
    document.addEventListener('pointerup', function (e) { if (hold && hold.pid === e.pointerId && hold.btn !== e.target && !(hold.btn.contains && hold.btn.contains(e.target))) stopHold(); }, true);
    document.addEventListener('pointercancel', function (e) { if (hold && hold.pid === e.pointerId) stopHold(); }, true);

    var s = S();
    applyMotionClass(!!(s && s.settings && s.settings.reducedMotion));
    bindEvents();
    setTab('lair');
  };

  ui.frame = function (dt) {
    if (!inited) return;
    var s = S();
    if (!s) return;
    try {
      if (s !== lastState) dirty = true;
      listTimer += num(dt);
      var st = E.stats(s);
      if (dirty || listTimer >= 0.2) {
        listTimer = 0;
        dirty = false;
        refreshPanel(s, st);
      }
      frameTop(s, st);
    } catch (e) {
      try { console.error('[HOARD] ui.frame', e); } catch (e2) { /* ignore */ }
    }
  };
})();
