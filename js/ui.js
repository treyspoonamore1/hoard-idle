/* Hoard — ui.js
 * HOARD.ui: top bar, registered tabs/sections (Lair, Brood, Quests, Hoard, Legend + feature
 * modules), the Settings sheet, top-bar chips, lists, hold-to-buy, sheets, toasts.
 * Reads state; mutates it only through HOARD.engine.* (plus state.settings, a UI preference).
 * Extension API (addTab/addSection/addSetting/addChip/addRowExtra/sheet/ask/css/icons): EXTENSIONS.md.
 */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var ui = (HOARD.ui = HOARD.ui || {});
  if (typeof document === 'undefined') {
    // Node / headless: the whole API exists as harmless no-ops so feature modules can load anywhere
    var noop = function () { return false; };
    ['init', 'frame', 'welcome', 'toast', 'refresh', 'markDirty', 'addTab', 'addSection', 'removeSection', 'addSetting', 'addChip',
      'addRowExtra', 'sheet', 'closeSheet', 'css', 'setTab', 'openSettings', 'copyText'].forEach(function (k) { ui[k] = noop; });
    ui.ask = ui.confirm = function () { return Promise.resolve(false); };
    ui.icons = {};
    return;
  }

  var E = null, D = null, fmt = null, fmtRate = null, fmtTime = null;
  var opts = {};
  var inited = false;
  var $ = {};                 // fixed DOM refs
  var tab = 'lair';
  var view = null;            // { tabId, visKey, parts:[{ def, host, key, inst }] }
  var lastState = null;
  var listTimer = 0, dirty = true;
  var hold = null;            // active press-and-hold
  var toastQ = [], toastLive = [];
  var MAX_TOASTS = 2, TOAST_MS = 2600;
  var sheetTimers = [];
  var sheetOpen = false, sheetOnClose = null, sheetOnAbort = null, sheetPatch = null;
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


  // ================================================================ extension registries (SPEC-V2 0.3, see EXTENSIONS.md)
  var tabDefs = [], secDefs = {}, setDefs = [], chipDefs = [], rowExtras = { building: [], tier: [] };
  var errOnce = {}, seqN = 0;
  // calls fn(...args); a throwing extension logs once (per tag) and yields `fallback` instead of breaking the UI
  function safe(tag, fn, args, fallback) {
    try { return fn.apply(null, args || []); } catch (e) {
      if (!errOnce[tag]) { errOnce[tag] = 1; try { console.error('[HOARD] ui ' + tag, e); } catch (e2) { /* ignore */ } }
      return fallback;
    }
  }
  function byOrder(a, b) { return (num(a.order) - num(b.order)) || (num(a._seq) - num(b._seq)); }
  function upsertById(list, def) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === def.id) { def._seq = list[i]._seq; list[i] = def; list.sort(byOrder); return; }
    }
    def._seq = ++seqN;
    list.push(def);
    list.sort(byOrder);
  }
  function validDef(def) { return !!def && typeof def === 'object' && typeof def.id === 'string' && !!def.id; }
  ui.addTab = function (def) {
    if (!validDef(def)) return false;
    upsertById(tabDefs, def);
    tabBarKey = ''; view = null; dirty = true;
    return true;
  };
  ui.addSection = function (tabId, def) {
    if (typeof tabId !== 'string' || !validDef(def)) return false;
    if (tabId === 'sleep') tabId = 'legend';
    upsertById(secDefs[tabId] = secDefs[tabId] || [], def);
    if (tab === tabId) view = null;
    dirty = true;
    return true;
  };
  ui.removeSection = function (tabId, id) {
    var l = secDefs[tabId];
    if (!l) return false;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); if (tab === tabId) view = null; dirty = true; return true; }
    return false;
  };
  ui.addSetting = function (def) {
    if (!validDef(def)) return false;
    upsertById(setDefs, def);
    return true;
  };
  ui.addChip = function (def) {
    if (!validDef(def)) return false;
    upsertById(chipDefs, def);
    chipsBuilt = false; dirty = true;
    return true;
  };
  ui.addRowExtra = function (kind, fn) {
    if (!rowExtras[kind] || typeof fn !== 'function') return false;
    rowExtras[kind].push(fn);
    view = null; dirty = true;
    return true;
  };
  // runs every row extra for one Lair/Brood row; returns a patch(state, stats) or null
  function rowExtrasFor(kind, card, id, state) {
    var fns = rowExtras[kind];
    if (!fns || !fns.length) return null;
    var slot = el('div', 'row-extras');
    card.appendChild(slot);
    var ps = [];
    for (var i = 0; i < fns.length; i++) {
      var r = safe('rowExtra:' + kind, fns[i], [slot, id, state, card], null);
      if (typeof r === 'function') ps.push(r);
    }
    if (!ps.length) return null;
    return function (s, st) { for (var j = 0; j < ps.length; j++) safe('rowExtra.patch:' + kind, ps[j], [s, st]); };
  }
  var cssDone = {};
  ui.css = function (cssText, id) {
    if (typeof cssText !== 'string' || !cssText) return null;
    var k = id || ('h' + cssText.length + ':' + cssText.slice(0, 80));
    if (cssDone[k]) return cssDone[k];
    var st = document.createElement('style');
    st.setAttribute('data-hoard-css', id || '');
    st.textContent = cssText;
    (document.head || document.documentElement).appendChild(st);
    cssDone[k] = st;
    return st;
  };

  // ---------------------------------------------------------------- icons (inline svg, currentColor)
  function svg(body, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + body + '</svg>';
  }
  var ICONS = {
    lair: svg('<path d="M3 20V12a9 9 0 0 1 18 0v8z"/><path d="M8 20v-5a4 4 0 0 1 8 0v5"/>'),
    brood: svg('<path d="M12 3c3.6 0 6.5 5.2 6.5 9.6A6.5 6.5 0 0 1 5.5 12.6C5.5 8.2 8.4 3 12 3z"/><path d="M9 11l1.6 1.4L12 10.6l1.5 1.8L15 11"/>'),
    quests: svg('<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>'),
    hoard: svg('<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4L12 9l2.5-5M12 9v11"/>'),
    legend: svg('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>'),
    moon: svg('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>'),
    ember: svg('<path d="M12 21c-4 0-6.5-2.7-6.5-6.2 0-3.6 2.6-5.6 3.6-8.8 1.7 1.4 2.4 3 2.4 4.6 1-.7 1.7-2 1.8-3.6 2.6 2 4.2 4.7 4.2 7.8 0 3.5-2.6 6.2-5.5 6.2z"/><path d="M12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.4-2.6 2-4 1.6 1 3.3 2.3 3.3 4 0 1.5-1.1 2.6-2.6 2.6z"/>'),
    flame: svg('<path d="M12 21c-4 0-6.5-2.7-6.5-6.2 0-3.6 2.6-5.6 3.6-8.8 1.7 1.4 2.4 3 2.4 4.6 1-.7 1.7-2 1.8-3.6 2.6 2 4.2 4.7 4.2 7.8 0 3.5-2.6 6.2-5.5 6.2z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
    chest: svg('<path d="M3 10c0-3.5 2.5-5.5 9-5.5s9 2 9 5.5v10H3z"/><path d="M3 11h18M10 11v3h4v-3"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    scroll: svg('<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10"/><path d="M7 4a2 2 0 0 0-2 2v11M9 9h4M9 12.5h4"/>'),
    chart: svg('<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'),
    sound: svg('<path d="M4 10v4h3.5L12 18V6L7.5 10z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    mute: svg('<path d="M4 10v4h3.5L12 18V6L7.5 10z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    auto: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
    volcano: svg('<path d="M3 20l6-10h6l6 10z"/><path d="M9 10l1.5-3M15 10l-1.5-3M12 10V5"/>'),
    snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6.5l2.5-2M9.5 19.5L12 17.5l2.5 2"/>'),
    wave: svg('<path d="M3 15c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2"/><path d="M3 19.5c2 0 2-2 4.5-2s2.5 2 4.5 2 2-2 4.5-2 2.5 2 4.5 2"/><path d="M12 11V4l4 3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    back: svg('<path d="M15 5l-7 7 7 7"/>')
  };

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
  // o: { center, dismissable (default true), onClose (dismissed / closed normally), onAbort (replaced or closed silently),
  //      patch(state, stats) (called <= 5x/s while open), cls (extra class on .sheet), full (near full-height sheet) }
  function openSheet(node, o) {
    o = o || {};
    closeSheet(true);
    var ov = $.overlay;
    if (!ov) return;
    ov.innerHTML = '';
    var sh = el('div', 'sheet' + (o.full ? ' full' : '') + (o.cls ? ' ' + o.cls : ''));
    sh.appendChild(node);
    ov.appendChild(sh);
    setCls(ov, 'center', !!o.center);
    ov.classList.add('open');
    ov._dismiss = o.dismissable !== false;
    sheetOpen = true;
    sheetOnClose = typeof o.onClose === 'function' ? o.onClose : null;
    sheetOnAbort = typeof o.onAbort === 'function' ? o.onAbort : null;
    sheetPatch = typeof o.patch === 'function' ? o.patch : null;
    if (sheetPatch) { var s0 = S(); if (s0 && E) patchSheet(s0, E.stats(s0)); }
    try { var f = sh.querySelector('button'); if (f) f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSheet(silent) {
    for (var i = 0; i < sheetTimers.length; i++) clearTimeout(sheetTimers[i]);
    sheetTimers = [];
    if (!sheetOpen) return;
    sheetOpen = false;
    sheetPatch = null;
    $.overlay.classList.remove('open');
    $.overlay.innerHTML = '';
    var cb = sheetOnClose, ab = sheetOnAbort;
    sheetOnClose = null; sheetOnAbort = null;
    if (cb && !silent) { try { cb(); } catch (e) { /* ignore */ } }
    if (ab && silent) { try { ab(); } catch (e) { /* ignore */ } }
    dirty = true;
  }
  function patchSheet(state, st) {
    if (sheetOpen && sheetPatch) safe('sheet.patch', sheetPatch, [state, st]);
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
      var xp = rowExtrasFor('building', c, bd.id, state);
      if (xp) parts.push(xp);
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
      var xp = rowExtrasFor('tier', c, i, state);
      if (xp) parts.push(xp);
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

  // ================================================================ LEGEND tab (v1 Sleep content) + settings
  function kvRow(a, v) { var r = el('div', 'kv'); add(r, el('span', null, a), v); return r; }

  // section 'sleep' (order 10): the Long Sleep panel
  function buildSleepSection(host, state) {
    var parts = [];
    var req = D.C.sleepReq || 1e7;
    host.appendChild(secHead('Long Sleep'));
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
    host.appendChild(c);
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
    return function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); };
  }
  // section 'legendinfo' (order 12): Legend totals
  function buildLegendInfo(host) {
    var lc = el('div', 'card');
    var lgv = el('span'), lpv = el('span'), lbv = el('span'), slv = el('span');
    add(lc, kvRow('Legend earned', lgv), kvRow('Legend to spend', lpv), kvRow('Legend bonus', lbv), kvRow('Long Sleeps taken', slv));
    host.appendChild(lc);
    return function (s, st) {
      setText(lgv, fmt(s.legend));
      setText(lpv, fmt(s.legendPts));
      setText(lbv, '×' + multStr(st.legendMult));
      setText(slv, fmt(s.sleeps));
    };
  }
  // section 'sofar' (order 90): v1 lifetime numbers
  function buildSoFar(host) {
    host.appendChild(secHead('Your hoard so far'));
    var sc = el('div', 'card');
    var a1 = el('span'), a2 = el('span'), a3 = el('span'), a4 = el('span'), a5 = el('span');
    add(sc, kvRow('Gold earned, all time', a1), kvRow('Coins gathered', a2), kvRow('Treasures grabbed', a3), kvRow('Wing Gusts', a4), kvRow('Best streak', a5));
    host.appendChild(sc);
    return function (s) {
      var t = s.stat || {};
      setText(a1, fmt(s.earnedAll));
      setText(a2, fmt(t.coins));
      setText(a3, fmt(t.treasures));
      setText(a4, fmt(t.gusts));
      setText(a5, '×' + multStr(t.bestStreak || 1));
    };
  }

  // generic on/off row: get(state) -> bool, set(state, bool). Returns { row, patch }.
  function toggle(label, get, set, sub) {
    var r = el('div', 'toggle-row');
    var sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', label);
    sw.addEventListener('click', function () {
      var s = S();
      if (!s) return;
      var v = !safe('toggle:' + label, get, [s], false);
      safe('toggle:' + label, set, [s, v]);
      patch(s);
      dirty = true; patchNow();
    });
    var lab = el('span', 'tl');
    lab.appendChild(el('span', null, label));
    if (sub) lab.appendChild(el('small', 'sub', sub));
    add(r, lab, sw);
    function patch(s) {
      var v = !!safe('toggle:' + label, get, [s], false);
      if (sw._v !== v) { sw._v = v; sw.setAttribute('aria-checked', v ? 'true' : 'false'); }
    }
    return { row: r, sw: sw, patch: patch };
  }
  function settingToggle(label, key, onChange) {
    return toggle(label, function (s) { return !!(s.settings && s.settings[key]); }, function (s, v) {
      if (!s.settings) s.settings = {};
      s.settings[key] = v;
      if (onChange) onChange(v);
    });
  }
  function copyText(txt, ta, okTitle) {
    var fallback = function () {
      if (ta) {
        ta.value = txt;
        try { ta.focus(); ta.select(); ta.setSelectionRange(0, txt.length); } catch (e) { /* ignore */ }
        try { if (document.execCommand && document.execCommand('copy')) { toast(okTitle || 'Copied.', '', 'moss'); return; } } catch (e) { /* ignore */ }
      }
      toast('Shown below.', 'Select it and copy.', '');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast(okTitle || 'Copied.', '', 'moss'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  // v1 settings rows, registered like any module's rows
  var V1_SETTINGS = [
    { id: 'haptics', order: 10, build: function (host) {
      var t = settingToggle('Vibration', 'haptics', function (v) { if (v) buzz(10); });
      host.appendChild(t.row); return t.patch;
    } },
    { id: 'motion', order: 20, build: function (host) {
      var t = settingToggle('Reduce motion', 'reducedMotion', applyMotionClass);
      host.appendChild(t.row); return t.patch;
    } },
    { id: 'save', order: 80, build: function (host) {
      var saveP = el('p', 'sub', 'Your hoard saves on this device by itself. Copy the save to keep a backup, or paste one below to load it.');
      saveP.style.marginTop = '12px';
      host.appendChild(saveP);
      var ta = el('textarea', 'savebox');
      ta.setAttribute('aria-label', 'Save text');
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('autocomplete', 'off');
      ta.placeholder = 'Paste a save here, then press Load save.';
      host.appendChild(ta);
      var r1 = el('div', 'btn-row');
      var copyB = button('', 'Copy save', function () {
        var s = S();
        if (!s) return;
        var txt = E.serialize(s);
        ta.value = txt;
        copyText(txt, ta, 'Save copied.');
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
            toast('Save loaded.', '', 'moss');
          });
      });
      add(r1, copyB, loadB);
      host.appendChild(r1);
    } },
    { id: 'reset', order: 90, build: function (host) {
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
      host.appendChild(r2);
    } }
  ];

  function openSettings() {
    var box = el('div', 'settings-sheet');
    var head = el('div', 'sheet-head');
    add(head, el('h3', null, 'Settings'), button('ghost small', 'Close', function () { closeSheet(); }));
    box.appendChild(head);
    var patches = [];
    var s0 = S();
    setDefs.forEach(function (d) {
      var host = el('div', 'set-row');
      host.setAttribute('data-setting', d.id);
      box.appendChild(host);
      var r = typeof d.build === 'function' ? safe('setting:' + d.id, d.build, [host, s0], null) : null;
      if (typeof r === 'function') patches.push({ id: d.id, fn: r });
      else if (r && typeof r.patch === 'function') patches.push({ id: d.id, fn: r.patch });
    });
    box.appendChild(el('p', 'hint ver', 'Hoard v2. Swipe the cave to gather gold. A quick flick sends a Wing Gust.'));
    openSheet(box, {
      cls: 'settings',
      patch: function (s, st) { for (var i = 0; i < patches.length; i++) safe('setting.patch:' + patches[i].id, patches[i].fn, [s, st]); }
    });
  }

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

  // ---------------------------------------------------------------- tabs (registry driven)
  function tabById(id) { for (var i = 0; i < tabDefs.length; i++) if (tabDefs[i].id === id) return tabDefs[i]; return null; }
  function tabVisible(t, state) { return !t.visible || !!safe('tab.visible:' + t.id, t.visible, [state], false); }
  function visibleTabs(state) { return tabDefs.filter(function (t) { return tabVisible(t, state); }); }
  var tabBarKey = '';
  function buildTabBar(state) {
    if (!$.tabs) return;
    var vis = visibleTabs(state);
    var key = vis.map(function (t) { return t.id + '/' + (t.label || ''); }).join(',');
    if (key === tabBarKey) return;
    tabBarKey = key;
    $.tabs.innerHTML = '';
    $.tabBtns = [];
    $.badge = {};
    vis.forEach(function (t) {
      var b = el('button');
      b.type = 'button';
      b.setAttribute('data-tab', t.id);
      b.innerHTML = t.icon || ICONS.star;
      b.appendChild(el('span', 't-label', t.label || t.id));
      var bd = el('span', 'badge');
      bd.setAttribute('data-badge', t.id);
      bd.hidden = true; bd._h = true;
      b.appendChild(bd);
      $.badge[t.id] = bd;
      b.addEventListener('click', function () { closeSheet(true); setTab(t.id); });
      $.tabs.appendChild(b);
      $.tabBtns.push(b);
    });
    $.tabs.setAttribute('data-n', String(vis.length));
    if (!vis.some(function (t) { return t.id === tab; }) && vis.length) { tab = vis[0].id; view = null; }
    markTabs();
  }
  function markTabs() {
    for (var i = 0; i < ($.tabBtns || []).length; i++) {
      var b = $.tabBtns[i];
      var on = b.getAttribute('data-tab') === tab;
      setCls(b, 'on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }
  function setTab(name) {
    if (name === 'sleep') name = 'legend'; // v1 id
    var t = tabById(name);
    var s = S();
    if (!t || (s && !tabVisible(t, s))) return;
    stopHold();
    if (tab !== name) {
      tab = name;
      view = null;
      if ($.panel) $.panel.scrollTop = 0;
    }
    markTabs();
    dirty = true;
    patchNow();
  }
  function patchBadges(state) {
    for (var i = 0; i < tabDefs.length; i++) {
      var t = tabDefs[i], b = $.badge && $.badge[t.id];
      if (!b) continue;
      var n = 0, dot = false;
      var vals = [];
      if (typeof t.badge === 'function') vals.push(safe('badge:' + t.id, t.badge, [state], 0));
      var ss = secDefs[t.id] || [];
      for (var j = 0; j < ss.length; j++) if (typeof ss[j].badge === 'function') vals.push(safe('badge:' + t.id + '.' + ss[j].id, ss[j].badge, [state], 0));
      for (var k = 0; k < vals.length; k++) {
        var v = vals[k];
        if (typeof v === 'number') { if (v > 0 && isFinite(v)) n += Math.floor(v); } else if (v) dot = true;
      }
      setHidden(b, !(n > 0 || dot));
      setCls(b, 'dot', !(n > 0) && dot);
      setText(b, n > 0 ? (n > 99 ? '99+' : String(n)) : '');
    }
  }

  // the panel = the active tab's own build (pseudo-section '_tab') + its registered sections, by order
  function partsFor(t) {
    var list = [];
    if (typeof t.build === 'function' || typeof t.patch === 'function') {
      list.push({ id: '_tab', order: t.buildOrder !== undefined ? t.buildOrder : 0, build: t.build, key: t.key, patch: t.patch, _seq: 0 });
    }
    (secDefs[t.id] || []).forEach(function (sd) { list.push(sd); });
    list.sort(byOrder);
    return list;
  }
  function keyOf(d, state) { return typeof d.key === 'function' ? String(safe('key:' + d.id, d.key, [state], '?')) : ''; }
  function buildPart(p, state) {
    p.host.innerHTML = '';
    p.key = keyOf(p.def, state);
    p.inst = null;
    if (typeof p.def.build !== 'function') return;
    var r = safe('build:' + p.def.id, p.def.build, [p.host, state], null);
    if (typeof r === 'function') p.inst = r;
    else if (r && typeof r === 'object') {
      if (r.root && r.root.nodeType === 1 && r.root.parentNode !== p.host) p.host.appendChild(r.root);
      if (typeof r.patch === 'function') p.inst = r.patch;
    }
  }
  function patchPart(p, state, st) {
    if (p.inst) safe('patch:' + p.def.id, p.inst, [state, st]);
    if (typeof p.def.patch === 'function') safe('patch:' + p.def.id, p.def.patch, [state, st, p.host]);
  }
  function refreshPanel(state, st) {
    buildTabBar(state);
    var t = tabById(tab);
    if (!t || !tabVisible(t, state)) {
      var vis = visibleTabs(state);
      if (!vis.length) return;
      t = vis[0]; tab = t.id; view = null; markTabs();
    }
    var defs = partsFor(t).filter(function (d) { return !d.visible || !!safe('visible:' + d.id, d.visible, [state], false); });
    var visKey = t.id + ':' + defs.map(function (d) { return d.id; }).join(',');
    var sameState = state === lastState;
    var holdLock = !!(hold && view && sameState);
    if (!holdLock) {
      if (!view || view.visKey !== visKey || !sameState) {
        stopHold(); // the held button is about to be detached; never let its repeat outlive it
        var keepScroll = !!view && sameState && view.tabId === t.id;
        var top = $.panel.scrollTop;
        $.panel.innerHTML = '';
        view = { tabId: t.id, visKey: visKey, parts: [] };
        defs.forEach(function (d) {
          var host = el('div', 'sec');
          host.setAttribute('data-sec', t.id + '.' + d.id);
          $.panel.appendChild(host);
          var p = { def: d, host: host };
          buildPart(p, state);
          view.parts.push(p);
        });
        if (keepScroll) $.panel.scrollTop = top;
      } else {
        for (var i = 0; i < view.parts.length; i++) {
          var p = view.parts[i];
          if (keyOf(p.def, state) !== p.key) {
            stopHold();
            var top2 = $.panel.scrollTop;
            buildPart(p, state);
            $.panel.scrollTop = top2;
          }
        }
      }
    }
    lastState = state;
    for (var j = 0; j < view.parts.length; j++) patchPart(view.parts[j], state, st);
    patchBadges(state);
  }

  // ---------------------------------------------------------------- top-bar chips (addChip)
  var chipsBuilt = false;
  function patchChips(state, st) {
    if (!$.chips) return;
    if (!chipsBuilt) {
      chipsBuilt = true;
      Array.prototype.forEach.call($.chips.querySelectorAll('.xchip'), function (n) { n.parentNode.removeChild(n); });
      chipDefs.forEach(function (c) {
        var n;
        if (typeof c.onPress === 'function') {
          n = el('button', 'chip xchip press' + (c.cls ? ' ' + c.cls : ''));
          n.type = 'button';
          n.addEventListener('click', function () { safe('chip.press:' + c.id, c.onPress, [S()]); dirty = true; });
        } else n = el('span', 'chip xchip' + (c.cls ? ' ' + c.cls : ''));
        n.setAttribute('data-chip', c.id);
        n.hidden = true; n._h = true;
        $.chips.appendChild(n);
        c._el = n;
      });
    }
    for (var i = 0; i < chipDefs.length; i++) {
      var c = chipDefs[i];
      if (!c._el) continue;
      var vis = !c.visible || !!safe('chip.visible:' + c.id, c.visible, [state, st], false);
      setHidden(c._el, !vis);
      if (vis && typeof c.text === 'function') setText(c._el, safe('chip.text:' + c.id, c.text, [state, st], ''));
    }
  }

  function patchNow() {
    var s = S();
    if (!s || !inited) return;
    try {
      var st = E.stats(s);
      refreshPanel(s, st);
      patchChips(s, st);
      patchSheet(s, st);
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

  // ---------------------------------------------------------------- v1 content, registered through the v2 API
  ui.addTab({ id: 'lair', label: 'Lair', icon: ICONS.lair, order: 10,
    build: function (host, state) { return buildLair(state); }, key: keyLair,
    badge: function (s) {
      var up = E.upgradeList(s);
      for (var j = 0; j < up.length; j++) if (up[j].visible && !up[j].bought && up[j].affordable) return true;
      return 0;
    } });
  ui.addTab({ id: 'brood', label: 'Brood', icon: ICONS.brood, order: 20,
    build: function (host, state) { return buildBrood(state); }, key: keyBrood });
  ui.addTab({ id: 'quests', label: 'Quests', icon: ICONS.quests, order: 30,
    build: function (host, state) { return buildQuests(state); }, key: keyQuests,
    badge: function (s) {
      var claim = 0;
      for (var i = 0; i < 3; i++) { var mi = E.missionInfo(s, i); if (mi && mi.done && mi.title) claim++; }
      return claim;
    } });
  ui.addTab({ id: 'hoard', label: 'Hoard', icon: ICONS.hoard, order: 40,
    build: function (host, state) { return buildHoard(state); }, key: keyHoard,
    badge: function (s) { return Math.floor(num(s.chests)); } });
  ui.addTab({ id: 'legend', label: 'Legend', icon: ICONS.legend, order: 60,
    badge: function (s) { return E.canSleep(s) ? true : 0; } });
  ui.addSection('legend', { id: 'sleep', order: 10, build: buildSleepSection, key: function () { return 'S'; } });
  ui.addSection('legend', { id: 'legendinfo', order: 12, build: buildLegendInfo });
  ui.addSection('legend', { id: 'sofar', order: 90, build: buildSoFar });
  V1_SETTINGS.forEach(function (d) { ui.addSetting(d); });

  // ---------------------------------------------------------------- exports
  ui.toast = toast;
  ui.refresh = function () {
    stopHold();
    try { if (E && E.dirty) E.dirty(); } catch (e) { /* ignore */ }
    dirty = true; view = null; tabBarKey = ''; chipsBuilt = false;
    patchNow();
  };
  ui.markDirty = function () { dirty = true; };
  // ask(title, text, yesLabel, noLabel[, {danger}]) -> Promise<bool>; v1 form ask(..., onYes, onNo) still works
  ui.ask = function (title, text, yes, no, a5, a6) {
    var legacy = typeof a5 === 'function' || typeof a6 === 'function';
    var o = (!legacy && a5 && typeof a5 === 'object') ? a5 : {};
    return new Promise(function (resolve) {
      var done = false, chosen = false;
      function finish(v) {
        if (done) return;
        done = true;
        if (legacy) { var cb = v ? a5 : a6; if (typeof cb === 'function') { try { cb(); } catch (e) { /* ignore */ } } }
        resolve(!!v);
      }
      var box = el('div');
      add(box, el('h3', null, title || ''), el('p', 'muted', text || ''));
      var br = el('div', 'btn-row');
      add(br, button('ghost', no || 'No', function () { closeSheet(); }),
        button(o.danger ? 'danger' : 'can', yes || 'Yes', function () { chosen = true; closeSheet(true); finish(true); dirty = true; }));
      box.appendChild(br);
      openSheet(box, {
        center: true, dismissable: legacy ? false : o.dismissable !== false,
        onClose: function () { finish(false); },
        onAbort: legacy ? null : function () { if (!chosen) finish(false); }
      });
    });
  };
  ui.setTab = setTab;
  ui.currentTab = function () { return tab; };
  ui.sheet = function (node, o) { if (node) openSheet(node, o || {}); };
  ui.closeSheet = function () { closeSheet(); };
  ui.sheetOpen = function () { return sheetOpen; };
  ui.openSettings = openSettings;
  ui.icons = ICONS;
  ui.state = S;
  ui.copyText = function (txt, ta, okTitle) { copyText(String(txt), ta || null, okTitle); };
  // v1 helpers for feature modules (same look and behaviour as the core panels)
  ui.el = el; ui.add = add; ui.button = button; ui.bindHold = bindHold; ui.bar = bar; ui.costLine = costLine;
  ui.buyButton = buyButton; ui.secHead = secHead; ui.amtToggle = amtToggle; ui.kv = kvRow; ui.toggle = toggle;
  ui.setText = setText; ui.setCls = setCls; ui.setHidden = setHidden; ui.setW = setW; ui.setDis = setDis;
  ui.milestoneBits = milestoneBits; ui.milestonePatch = milestonePatch; ui.buyAmt = buyAmt;
  ui.buzz = buzz; ui.multStr = multStr; ui.clock = clock; ui.plural = plural; ui.num = num; ui.reducedMotion = reducedMotion;
  ui.confirm = function (title, text, yes, no, danger) { return ui.ask(title, text, yes, no, { danger: !!danger }); };

  // ---------------------------------------------------------------- init + frame
  ui.init = function (o) {
    opts = o || {};
    E = HOARD.engine; D = HOARD.data;
    fmt = HOARD.fmt; fmtRate = HOARD.fmtRate; fmtTime = HOARD.fmtTime;
    if (inited) { view = null; dirty = true; patchNow(); return; }
    $.gold = document.getElementById('gold');
    $.gps = document.getElementById('gps');
    $.chips = document.querySelector('#top .chips');
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
    $.tabs = document.getElementById('tabs');
    $.tabBtns = [];
    $.badge = {};
    if (!$.gold || !$.panel || !$.overlay || !$.tabs) return;
    inited = true;

    $.gust.addEventListener('click', function () {
      try { if (HOARD.cave && HOARD.cave.gust) HOARD.cave.gust(); } catch (e) { /* ignore */ }
    });
    var setBtn = document.getElementById('btn-settings');
    if (setBtn) setBtn.addEventListener('click', function () { openSettings(); });
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
    if (s) buildTabBar(s);
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
        patchChips(s, st);
        patchSheet(s, st);
      }
      frameTop(s, st);
    } catch (e) {
      try { console.error('[HOARD] ui.frame', e); } catch (e2) { /* ignore */ }
    }
  };
})();
