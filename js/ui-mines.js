/* Hoard — js/ui-mines.js — the Mines tab (SPEC-MINES B8) and the cave layer (Ember, curled in the left nook, wakes
 * when the Mines open and tends the Forge fire). Tab, top to bottom: the Ore header (glow, Hearth, nuggets, the next
 * Deep Chest), the Shaft (Depth, "Dig deeper"), the four miner rows (Brood-style rows, hold to hire), the "When you
 * Sleep" strip (the tithe: each Long Sleep recruits up to 3 of every open miner), the Forge (the 3 cheapest levels,
 * Done chips; Stoke the Forge never caps) and Sky Lanterns (js/ui-sky.js adds them).
 * Also: the tithe line in the Legend tab's Sleep panel, toasts, the away line, and the Mines' play-log entries.
 * Loaded after ui.js, before main.js. Rules live in js/mines.js. */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;
  var ui = HOARD.ui, E = HOARD.engine, X = HOARD.mines;
  if (!ui || !ui.addTab || !E || !X) return;
  var fmt = function (n) { return HOARD.fmt(n); };
  var fmtR = function (n) { return HOARD.fmtR ? HOARD.fmtR(n) : fmt(n); };
  var el = ui.el, add = ui.add, setText = ui.setText, setCls = ui.setCls, setHidden = ui.setHidden;
  function S() { try { return ui.state ? ui.state() : null; } catch (e) { return null; } }
  function snd(name, d) { try { if (HOARD.sound && HOARD.sound.play) HOARD.sound.play(name, d); } catch (e) { /* ignore */ } }
  function log(k, d) { try { if (HOARD.log && typeof HOARD.log.event === 'function') HOARD.log.event(k, d); } catch (e) { /* ignore */ } }
  function plural(n, one, many) { return Math.floor(+n || 0) === 1 ? one : many; }
  function tname(k, n) { var t = X.TIERS[k]; return t ? plural(n, t.one, t.name) : ''; }

  // ================================================================ CSS (v1 tokens; classes prefixed .mn-)
  ui.css([
    '.mn-head { background: radial-gradient(120% 140% at 0% 0%, rgba(143,179,201,0.22), rgba(143,179,201,0) 60%), linear-gradient(160deg, #222a36 0%, var(--rock) 60%, #1d1927 100%); border-color: rgba(143,179,201,0.4); }',
    '.mn-lab { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); }',
    '.mn-top { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px; }',
    '.mn-ore { font-family: var(--font-d); font-size: 34px; line-height: 1.05; color: #cfe3ef; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }',
    '.mn-rate { font-size: 15px; font-weight: 700; color: #9fc3d9; font-variant-numeric: tabular-nums; }',
    '.mn-line { font-size: 14px; color: var(--ink-dim); margin-top: 6px; line-height: 1.3; }',
    '.mn-line b { color: var(--ink); font-weight: 700; }',
    '.mn-hearth b { color: #ffb27a; }',
    '.mn-nug { color: #9fc3d9; }',
    '.mn-nug i { display: inline-block; width: 10px; height: 9px; margin-right: 6px; border-radius: 3px 5px 2px 4px; background: linear-gradient(135deg, #b6d8f2, #6fa3cf 55%, #2f5f86); vertical-align: -1px; box-shadow: 0 0 0 1px #2f4656; }',
    '.mn .bar > i { background: linear-gradient(90deg, #4f6f84, #9fc3d9); }',
    '.mn-shaft .name small { font-weight: 500; color: var(--ink-dim); font-size: 14px; }',
    '.mn-strip { background: transparent; border-style: dashed; border-color: rgba(143,179,201,0.35); }',
    '.mn-strip .name { font-size: 15px; color: #cfe3ef; }',
    '.mn-strip .sub { margin-top: 3px; line-height: 1.3; }',
    '.mn-strip .sub b { color: var(--ink); }',
    '.mn .owned { color: #cfe3ef; }',
    '.mn-forge .name small { font-weight: 500; color: var(--ink-dim); font-size: 13px; margin-left: 4px; }',
    '.mn-forge .sub b { color: #cfe3ef; font-weight: 700; }',
    '.mn-more { color: var(--ink-faint); font-size: 13px; text-align: center; margin: -2px 0 8px; }',
    '.mn-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }',
    '.mn-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(143,179,201,0.4); color: #d6e6f0; font-size: 13px; font-weight: 700; background: rgba(143,179,201,0.08); max-width: 100%; }',
    '.mn-tag svg { width: 13px; height: 13px; color: var(--moss); flex: none; }',
    '.mn .cost .c-ore { color: #cfe3ef; font-weight: 700; }',
    '.mn .cost .c-egg { color: var(--ink); font-weight: 700; }',
    '.mn .cost .short { color: var(--ember); }',
    '.mn .btn.can, .mn-tithe .btn.can { background: linear-gradient(180deg, #d9ecf7, #9fc3d9 55%, #6f97b0); color: #0d1a24; border-color: #e6f3fb; box-shadow: 0 2px 10px rgba(143,179,201,0.3); }',
    '.mn .btn.buy small { white-space: nowrap; }',
    '.mn-tithe { margin-top: -2px; border-color: rgba(143,179,201,0.35); }',
    '.mn-tithe .sub b { color: #cfe3ef; }',
    '.toast.mines { border-color: rgba(143,179,201,0.65); }'
  ].join('\n'), 'mines');

  function xStr(w) { return '×' + (w >= 100 ? fmt(w) : (Math.round(w * 100) / 100).toFixed(2)); }
  function xShort(w) { return '×' + (w >= 100 ? fmt(w) : String(Math.round(w * 100) / 100)); }
  // "+2 Ore Carts, +11 Pick Crews" (deepest first, like the tithe), '' for nothing
  function hireList(n, short) {
    var out = [];
    for (var k = 3; k >= 0; k--) {
      var v = Math.floor(+n[k] || 0);
      if (v < 1) continue;
      var nm = tname(k, v);
      if (short) nm = nm.replace(/^Pick |^Ore |^Tunnel |^Deep /, '');
      out.push('+' + fmt(v) + ' ' + nm);
    }
    return out.join(', ');
  }

  // ---------------------------------------------------------------- 1. header: Ore, glow, Hearth, nuggets, Deep Chest
  function buildHeader(host) {
    var c = ui.el('div', 'card mn-head');
    var top = el('div', 'mn-top');
    var ore = el('div', 'mn-ore', '0'), rate = el('div', 'mn-rate', '');
    add(top, ore, rate);
    var glow = el('div', 'mn-line');
    var hearth = el('div', 'mn-line mn-hearth');
    var nug = el('div', 'mn-line mn-nug');
    var pb = ui.bar(), pl = el('div', 'bar-label'), plL = el('span'), plR = el('span');
    add(pl, plL, plR);
    add(c, el('div', 'mn-lab', 'Ore'), top, glow, hearth, nug, pb, pl);
    host.appendChild(c);
    // the glow and Hearth lines are built once; a patch only changes their numbers (code review #10)
    var glowB = el('b');
    add(glow, document.createTextNode('Forge glow '), glowB, document.createTextNode(' · gold/s and coins'));
    var hearthB = el('b');
    add(hearth, document.createTextNode("Ember's Hearth "), hearthB, document.createTextNode(' · gold/s and coins'));
    return function (s) {
      setText(ore, fmt(Math.floor(X.ore(s))));
      var r = X.oreRate(s);
      setText(rate, r > 0 ? '+' + fmtR(r) + '/s' : '');
      setText(glowB, xStr(X.glow(s)));
      var h = X.hearth(s);
      setHidden(hearth, !(h > 1));
      if (h > 1) setText(hearthB, xStr(h));
      var nv = X.nugValue(s);
      if (nug._v !== nv) { nug._v = nv; nug.textContent = ''; add(nug, el('i'), document.createTextNode('Swipe the blue nuggets: +' + fmt(Math.floor(nv)) + ' Ore each')); }
      var at = X.nextChestAt(s), peak = s.mines ? Math.max(+s.mines.peak || 0, +s.mines.all || 0) : 0;
      var lo = at / 10 >= 1000 ? at / 10 : 0;
      var fr = lo > 0 ? (Math.log(Math.max(peak, lo)) - Math.log(lo)) / (Math.log(at) - Math.log(lo)) : peak / at;
      ui.setW(pb.fill, Math.max(0, Math.min(1, fr)));
      setText(plL, 'Next Deep Chest at ' + fmt(at) + ' Ore dug');
      setText(plR, fmt(Math.floor(peak)) + ' dug');
    };
  }

  // ---------------------------------------------------------------- 2. the Shaft: Depth, Dig deeper
  function buildShaft(host, s0) {
    var c = el('div', 'card mn-shaft');
    var r = el('div', 'row'), g = el('div', 'grow');
    var nm = el('div', 'name'), sub = el('div', 'sub'), cost = el('div', 'cost'), cv = el('span', 'c-ore');
    cost.appendChild(cv);
    add(g, nm, sub, cost);
    var btn = ui.buyButton();
    setText(btn.l, 'Dig');
    setText(btn.s, 'deeper');
    // one level per deliberate press: Depth never caps, so holding would empty the Ore in one go
    btn.addEventListener('click', function () {
      var s = S();
      if (s && X.dig(s)) { snd('buy', { kind: 'lantern' }); ui.buzz(12); ui.markDirty(); }
    });
    add(r, g, btn);
    c.appendChild(r);
    host.appendChild(c);
    return function (s) {
      var d = X.depth(s);
      nm.textContent = '';
      add(nm, document.createTextNode('Shaft Depth ' + d + ' '), el('small', null, '· miners ' + xShort(X.depthMult(d)) + ' → ' + xShort(X.depthMult(d + 1))));
      var nextT = null;
      for (var k = 0; k < 4; k++) if (X.TIERS[k].depth > d) { nextT = k; break; }
      setText(sub, nextT !== null ? 'Depth ' + X.TIERS[nextT].depth + ' breaks into ' + X.TIERS[nextT].name + '.' : 'Every level makes all miners ×' + X.C.depthMul + ' faster.');
      var dc = X.depthCost(s), okk = dc > 0 && X.ore(s) >= dc;
      setText(cv, fmt(dc) + ' Ore');
      setCls(cv, 'short', !okk);
      setCls(btn, 'can', okk);
    };
  }

  // ---------------------------------------------------------------- 3. miners: Brood-style rows, hold to hire
  function chainLink(text) {
    var d = el('div', 'chain-link');
    d.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
    d.appendChild(el('span', null, text));
    return d;
  }
  function buildMiners(host, s0) {
    var parts = [];
    var head = ui.secHead('Miners');
    var tog = ui.amtToggle();
    head.appendChild(tog);
    host.appendChild(head);
    parts.push(function (s) { tog.patch(s); });
    // hiring by hand spends this run's Eggs, and Eggs count toward the Nest bonus (playtest review N2)
    host.appendChild(el('p', 'hint', 'Each kind of miner brings the kind below it. Hiring spends Eggs from your nest, so the Nest bonus drops a little this run. Hold Hire to hire many.'));
    var shownLocked = false;
    X.TIERS.forEach(function (t, k) {
      var prevName = k > 0 ? X.TIERS[k - 1].name : 'Ore';
      if (!X.tierOpen(s0, k)) {
        if (!shownLocked) {
          shownLocked = true;
          host.appendChild(chainLink(t.name + ' would bring ' + prevName));
          host.appendChild(el('div', 'card locked', 'Reach Shaft Depth ' + t.depth + ' to break into ' + t.name + '.'));
        }
        return;
      }
      if (k > 0) host.appendChild(chainLink(t.name + ' bring ' + prevName));
      var row = {};
      var c = el('div', 'card');
      var r1 = el('div', 'row'), g1 = el('div', 'grow');
      row.prod = el('div', 'sub num');
      row.net = el('div', 'sub num');
      add(g1, el('div', 'name', t.name), row.prod, row.net);
      row.owned = el('div', 'owned');
      add(r1, g1, row.owned);
      var r2 = el('div', 'row'), g2 = el('div', 'grow');
      row.cost = el('div', 'cost');
      row.cv = el('span', 'c-egg');
      row.cost.appendChild(row.cv);
      g2.appendChild(row.cost);
      row.btn = ui.buyButton();
      setText(row.btn.l, 'Hire');
      // the play log gets one 'hire' per press or hold, not one per miner
      var pend = { n: 0, at: 0 };
      function flush() {
        if (pend.n > 0) { log('mines', { type: 'hire', k: k, n: pend.n }); pend.n = 0; }
      }
      ui.bindHold(row.btn, function () {
        var s = S();
        if (!s) return false;
        var before = X.hired(s, k);
        var okk = X.hire(s, k, ui.buyAmt(s));
        if (okk) { pend.n += X.hired(s, k) - before; pend.at = Date.now(); }
        return okk;
      });
      ['pointerup', 'pointercancel', 'pointerleave', 'click'].forEach(function (ev) { row.btn.addEventListener(ev, function () { setTimeout(flush, 0); }); });
      add(r2, g2, row.btn);
      add(c, r1, r2);
      host.appendChild(c);
      parts.push(function (s) {
        if (pend.n > 0 && Date.now() - pend.at > 1500 && !row.btn.classList.contains('held')) flush();
        var cnt = Math.floor(X.units(s, k));
        setText(row.owned, fmt(cnt));
        var each = X.unitEach(s, k), all = X.unitTotal(s, k);
        if (k === 0) setText(row.prod, 'Each digs ' + fmtR(each) + ' Ore/s · all ' + fmtR(all) + '/s');
        else setText(row.prod, 'Each brings ' + fmtR(each) + ' ' + X.TIERS[k - 1].name + '/s');
        var above = X.TIERS[k + 1];
        var gain = above && X.tierOpen(s, k + 1) ? X.unitTotal(s, k + 1) : 0;
        setText(row.net, gain > 0 ? 'Gaining +' + fmtR(gain) + '/s from ' + above.name
          : (above ? (X.tierOpen(s, k + 1) ? 'Hire ' + above.name + ' to bring more of these' : above.name + ' will bring more (Shaft Depth ' + above.depth + ')')
            : 'Long Sleeps recruit more of these'));
        var amt = ui.buyAmt(s);
        var mx = X.hireMax(s, k);
        var n = amt === 'max' ? Math.max(1, mx) : amt;
        var cost = X.hireCost(s, k, n), eggs = s.tiers ? +s.tiers[0] || 0 : 0;
        setText(row.cv, fmt(cost) + ' ' + (cost === 1 ? 'Egg' : 'Eggs'));
        setCls(row.cv, 'short', eggs + 1e-9 < cost);
        setCls(row.btn, 'can', mx >= (amt === 'max' ? 1 : amt));
        setText(row.btn.s, '×' + fmt(n));
      });
    });
    return function (s, st) { for (var i = 0; i < parts.length; i++) parts[i](s, st); };
  }

  // ---------------------------------------------------------------- 4. "When you Sleep": the tithe
  function buildStrip(host) {
    var c = el('div', 'card mn-strip');
    var a = el('div', 'sub'), b = el('div', 'sub');
    add(c, el('div', 'name', 'When you Sleep'), a, b);
    host.appendChild(c);
    var aB = el('b'), aT = document.createTextNode(''), key = '';
    add(a, document.createTextNode('Each Long Sleep, leftover Eggs recruit up to ' + X.C.titheCap + ' of every miner you have opened. Now: '), aB, aT);
    return function (s) {
      var now = hireList(X.tithePreview(s)), last = hireList(X.lastTithe(s));
      var nx = X.titheNext(s), more = nx ? ' One more ' + X.TIERS[nx.k].one + ' at ' + fmt(nx.eggs) + ' Eggs.' : '';
      var k2 = now + '|' + more + '|' + last;
      if (k2 === key) return;
      key = k2;
      setText(aB, now || 'nothing yet');
      setText(aT, '.' + more);
      setText(b, last ? 'Last Sleep: ' + last + '. Recruits never raise the hire price.' : 'Recruits never raise the hire price.');
    };
  }

  // ---------------------------------------------------------------- 5. the Forge
  function buildForge(host, s0) {
    var list = X.forgeList(s0);
    var open = list.filter(function (f) { return !f.done; }).sort(function (p, q) { return p.cost - q.cost; });
    var done = list.filter(function (f) { return f.done; });
    var capped = list.filter(function (f) { return !f.endless; }).length;
    host.appendChild(ui.secHead('Forge', done.length + ' of ' + capped + ' done'));
    var parts = [];
    open.slice(0, 3).forEach(function (f0) {
      var c = el('div', 'card mn-forge');
      var r = el('div', 'row'), g = el('div', 'grow');
      var nm = el('div', 'name');
      add(nm, document.createTextNode(f0.name), el('small', null, f0.endless ? 'Lv ' + f0.lv + ' · never caps' : (f0.max > 1 ? 'Lv ' + f0.lv + '/' + f0.max : '')));
      var sub = el('div', 'sub');
      add(sub, document.createTextNode(f0.lv > 0 || f0.max > 1 ? f0.now + ' → ' : ''), el('b', null, f0.max > 1 ? f0.next : f0.text));
      var cost = el('div', 'cost'), cv = el('span', 'c-ore');
      cost.appendChild(cv);
      add(g, nm, sub, cost);
      var btn = ui.buyButton();
      setText(btn.l, 'Forge');
      setText(btn.s, 'Lv ' + (f0.lv + 1));
      btn.addEventListener('click', function () { var s = S(); if (s && X.forge(s, f0.id)) { snd('buy', { kind: 'upgrade' }); ui.buzz(12); ui.markDirty(); } });
      add(r, g, btn);
      c.appendChild(r);
      host.appendChild(c);
      parts.push(function (s) {
        var have = X.ore(s), okk = have + 1e-9 >= f0.cost;
        setText(cv, fmt(f0.cost) + ' Ore');
        setCls(cv, 'short', !okk);
        setCls(btn, 'can', okk);
      });
    });
    if (open.length > 3) host.appendChild(el('div', 'mn-more', '+' + (open.length - 3) + ' more as you forge these'));
    if (done.length) {
      var w = el('div', 'mn-chips');
      done.forEach(function (f) {
        var t = el('span', 'mn-tag');
        t.innerHTML = ui.icons.check || '';
        t.appendChild(document.createTextNode(f.name + (f.max > 1 ? ' ' + f.max + '/' + f.max : '')));
        t.title = f.text;
        w.appendChild(t);
      });
      host.appendChild(w);
    }
    return function (s) { for (var i = 0; i < parts.length; i++) parts[i](s); };
  }

  // ================================================================ the tab
  function forgeSum(s) { var t = 0; for (var i = 0; i < X.FORGE.length; i++) t += X.forgeLevel(s, X.FORGE[i].id); return t; }
  ui.addTab({
    id: 'mines', label: 'Mines', icon: ui.icons.pick || ui.icons.flame, order: 70,
    visible: function (s) { return X.visible(s); },
    key: function (s) {
      var tiers = 0;
      for (var k = 0; k < 4; k++) if (X.tierOpen(s, k)) tiers++;
      return 'M' + (X.isOpen(s) ? 1 : 0) + ':' + tiers + ':' + X.depth(s) + ':' + forgeSum(s) + ':' + (s.sky ? Math.floor(+s.sky.lant || 0) : 0);
    },
    badge: function (s) { return X.affordable(s) ? true : 0; },
    build: function (host, s) {
      host.classList.add('mn');
      if (!X.isOpen(s)) {
        host.appendChild(el('div', 'card locked', 'The Deep is answering your call…'));
        return null;
      }
      var ps = [buildHeader(host), buildShaft(host, s), buildMiners(host, s), buildStrip(host), buildForge(host, s)];
      return function (s2, st) { for (var i = 0; i < ps.length; i++) ps[i](s2, st); };
    }
  });

  // Legend tab, right under the Long Sleep panel: what the leftover Eggs will hire
  ui.addSection('legend', {
    id: 'tithe', order: 11,
    visible: function (s) { return X.isOpen(s) && E.canSleep(s); },
    key: function () { return 'T'; },
    build: function (host) {
      var c = el('div', 'card mn-tithe');
      var a = el('div', 'sub');
      c.appendChild(a);
      host.appendChild(c);
      return function (s) {
        var now = hireList(X.tithePreview(s));
        a.textContent = '';
        if (now) add(a, document.createTextNode('Mines: this Sleep recruits '), el('b', null, now), document.createTextNode('.'));
        else add(a, document.createTextNode('Mines: a Sleep recruits miners once the nest holds ' + fmt(X.TIERS[0].eggs) + ' Eggs.'));
      };
    }
  });

  // ================================================================ toasts, sounds, play log
  E.on('mines', function (x, s) {
    if (!x || typeof x !== 'object') return;
    if (x.type === 'open') {
      ui.toast('The Mines open', 'Ember wakes in her nook to tend the Forge. Pick Crews dig Ore: find them in the new Mines tab.', 'mines');
      ui.refresh();
    } else if (x.type === 'chest') {
      var ci = s ? E.cardInfo(s, x.card) : null;
      ui.toast('Deep Chest: ' + (ci ? ci.name : 'a Deep card'), ci && ci.text ? ci.text : 'A card for your Hoard.', 'gold');
      snd('questDone');
    } else if (x.type === 'depth') {
      if (x.opens !== null && x.opens !== undefined && X.TIERS[x.opens]) ui.toast('Shaft Depth ' + x.d, 'You broke into ' + X.TIERS[x.opens].name + '. Hire them in the Mines.', 'mines');
    } else if (x.type === 'tithe') {
      var txt = hireList(x.n || []);
      // Dream Keeper's Sleeps stay quiet; the "When you Sleep" strip still shows what they hired
      if (txt && !(E.inAuto && E.inAuto())) setTimeout(function () { ui.toast('Leftover Eggs recruited miners', txt + '.', 'mines'); }, 0);
    }
  });
  // the welcome-back sheet: what the Mines dug while you were away (a shorter absence gets a toast instead)
  if (typeof ui.addWelcomeLine === 'function') ui.addWelcomeLine(function (s) {
    // the Mines can open during an offline Dream Keeper run, when the 'open' toast is quiet (code review #12)
    var opened = !!(s && s._minesOpenedAway);
    if (s) delete s._minesOpenedAway;
    var o = X.takeOffline(s);
    if (!o || !(o.ore >= 1)) return opened ? { cls: 'mines', text: 'The Mines opened while you were away: see the new Mines tab.' } : null;
    log('mines', { type: 'away', ore: Math.round(o.ore), sec: Math.round(o.sec) });
    return { cls: 'mines', text: (opened ? 'The Mines opened while you were away and dug ' : 'The Mines dug ') + fmt(o.ore) + ' Ore while you were away.' };
  });
  ui.css('.welcome-line.mines { color: #cfe3ef; }', 'mines-welcome');
  if (HOARD.whenReady) HOARD.whenReady(function (getState) {
    // one-time notes after an old save was converted on load (Ember's kilns -> the Mines, event lairs closed). The
    // conversions emit nothing during deserialize (boot parses a cloud save twice); this logs and toasts each once,
    // and keeps checking, so a cloud copy adopted later still shows its note (code review #7)
    var told = { conv: false, ev: false };
    function check() {
      if (document.hidden) return;
      var s = null;
      try { s = getState(); } catch (e) { s = null; }
      if (!s || (!s._minesConv && !s._eventsClosed)) return;
      var cv = X.takeConversion(s);
      if (cv && !told.conv) {
        told.conv = true;
        log('mines', cv);
        ui.toast('Ember moved to the Mines', 'Her embers became ' + fmt(cv.ore) + ' Ore and her warmth is now Ember’s Hearth ' + xStr(cv.hearth) + '. Her Breaths are Forge levels.', 'mines');
      }
      var ev = X.takeEventsClosed(s);
      if (ev && !told.ev) {
        told.ev = true;
        log('mines', { type: 'eventsConv', q: ev.q, ore: ev.ore, cards: ev.cards });
        ui.toast('Event lairs have closed.', 'Their cards are now found in Deep Chests in the Mines.' + (ev.ore > 0 ? ' Your lair quests left +' + fmt(ev.ore) + ' Ore.' : ''), 'gold');
      }
    }
    setTimeout(check, 300);
    setInterval(check, 1500);
    // a short absence (no welcome-back sheet): toast what the Mines dug
    setInterval(function () {
      if (document.hidden || (ui.sheetOpen && ui.sheetOpen())) return;
      var s = null;
      try { s = getState(); } catch (e) { s = null; }
      if (!s || !(s._minesOffline >= 1)) return;
      var o = X.takeOffline(s);
      if (o && o.sec >= 10 && o.ore >= 1) ui.toast('The Mines dug ' + fmt(o.ore) + ' Ore while you were away.', '', 'mines');
    }, 1000);
  });

  // ================================================================ cave: Ember in the left nook (she wakes when the Mines open)
  var cave = HOARD.cave;
  if (!cave || !cave.addLayer) return;

  // palettes: index 0 = asleep (smouldering, dim) .. STEPS = awake; precomputed so drawing never allocates
  var STEPS = 12;
  var PAL_SLEEP = { body: [92, 38, 34], mid: [70, 28, 26], belly: [120, 66, 48], spike: [44, 18, 18], horn: [130, 112, 96], wing: [64, 26, 24], vein: [40, 16, 16] };
  var PAL_AWAKE = { body: [200, 66, 44], mid: [156, 46, 32], belly: [242, 166, 96], spike: [96, 28, 20], horn: [236, 214, 178], wing: [132, 36, 26], vein: [86, 22, 16] };
  var PAL = [];
  (function () {
    for (var i = 0; i <= STEPS; i++) {
      var f = i / STEPS, p = {};
      for (var key in PAL_AWAKE) {
        var a = PAL_SLEEP[key], b = PAL_AWAKE[key];
        p[key] = 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
      }
      PAL.push(p);
    }
  })();

  var glowGrad = null, glowCtx = null;
  var nook = { x: 0, y: 0, w: -1, h: -1 };
  var lastWoke = -1, wakeBurst = false, blinkT = 2.5, blinkA = 0;

  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function ease(p) { return p * p * (3 - 2 * p); }
  function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function scale(m) { return (m && m.dk ? m.dk : 1) * 0.86; }
  function headPos(lift) {
    return { x: 17 + 7 * lift, y: -5 - 22 * lift };
  }

  cave.addLayer({
    id: 'ember', z: -1,
    draw: function (g, w, h, t, dt, s) {
      var m = cave.metrics();
      if (!m || !m.inited) return;
      if (nook.w !== w || nook.h !== h) {
        var a = cave.anchor('nookL');
        nook.x = a.x; nook.y = a.y; nook.w = w; nook.h = h;
      }
      if (glowCtx !== g) {
        glowCtx = g;
        glowGrad = g.createRadialGradient(4, -14, 2, 4, -14, 52);
        glowGrad.addColorStop(0, 'rgba(255,120,60,0.55)');
        glowGrad.addColorStop(0.5, 'rgba(232,99,58,0.18)');
        glowGrad.addColorStop(1, 'rgba(232,99,58,0)');
      }
      var rm = !!m.reducedMotion;
      // "awake" = the Mines are open: Ember tends the Forge fire
      var awake = !!(s && X.isOpen(s));
      var p = 0;
      if (awake) {
        var wk = s.mines ? +s.mines.openAt || 0 : 0;
        p = clamp01(((+s.time || 0) - wk) / 3.2);
        if (wk !== lastWoke) { lastWoke = wk; wakeBurst = p < 1; }
      }
      var k = scale(m);
      var x = nook.x, y = nook.y;
      var lift = ease(clamp01(p * 1.4));
      var pal = PAL[Math.round(clamp01(p * 1.6) * STEPS)];
      var br = Math.sin(t * (awake ? 1.6 : 0.9)) * 0.5 + 0.5; // breathing
      var heat = awake ? Math.min(1, 0.45 + 0.1 * Math.log(X.hearth(s) * X.glow(s)) / Math.LN10 * 2) : 0.12;

      if (wakeBurst && p > 0.3) {
        wakeBurst = false;
        var hp0 = headPos(1);
        if (cave.burst) cave.burst(x + hp0.x * k, y + hp0.y * k, rm ? 8 : 26, 'spark');
      }
      // blink
      if (awake && !rm) {
        blinkT -= dt;
        if (blinkT <= 0) { blinkA = 0.16; blinkT = 2.5 + Math.random() * 4; }
      }
      if (blinkA > 0) blinkA = Math.max(0, blinkA - dt);

      g.save();
      g.translate(x, y);
      g.scale(k, k);
      // warm glow from her belly-fire
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (0.35 + 0.65 * heat) * (0.75 + 0.25 * br) * (awake ? 1 : 0.5);
      g.fillStyle = glowGrad;
      g.fillRect(-56, -70, 112, 112);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // shadow
      g.fillStyle = 'rgba(10,6,12,0.45)'; ell(g, 0, 1, 30, 4.5); g.fill();
      // tail curling round the front, spade tip
      var sway = awake && !rm ? Math.sin(t * 1.3) * 2.2 : 0;
      g.fillStyle = pal.mid;
      g.beginPath();
      g.moveTo(-17, -9);
      g.bezierCurveTo(-34, -2, -26, 6, -6, 5);
      g.bezierCurveTo(6, 4.5, 16, 3, 24 + sway, -1);
      g.bezierCurveTo(15, 0.5, 6, 0.5, -6, 0.8);
      g.bezierCurveTo(-20, 0.5, -24, -3, -13, -12);
      g.closePath(); g.fill();
      g.fillStyle = pal.spike;
      g.beginPath(); g.moveTo(23 + sway, -1); g.lineTo(29 + sway, -6); g.lineTo(31 + sway, 0); g.lineTo(26 + sway, 3); g.closePath(); g.fill();
      // back spikes
      var by = 11 * (1 + br * 0.05);
      g.fillStyle = pal.spike;
      for (var i = 0; i < 4; i++) {
        var an = Math.PI * (1.15 + i * 0.2), cx = -3 + Math.cos(an) * 20, cy = -11 + Math.sin(an) * by;
        var nx = Math.cos(an), ny = Math.sin(an), sz = 4.2 - Math.abs(i - 1.5) * 0.6;
        g.beginPath();
        g.moveTo(cx + ny * 2.6, cy - nx * 2.6);
        g.lineTo(cx + nx * sz, cy + ny * sz);
        g.lineTo(cx - ny * 2.6, cy + nx * 2.6);
        g.closePath(); g.fill();
      }
      // body + belly
      g.fillStyle = pal.body; ell(g, -3, -11, 21, by); g.fill();
      g.fillStyle = pal.belly; ell(g, 3, -5.5, 13, 5); g.fill();
      // wing (folded asleep, stretches while waking, half-raised awake)
      var wa = p > 0 && p < 1 ? Math.sin(p * Math.PI) * 0.9 : 0;
      var wingRot = -0.1 - (awake ? 0.22 : 0) - wa - (awake && !rm ? Math.sin(t * 0.8) * 0.04 : 0);
      g.save();
      g.translate(-8, -19);
      g.rotate(wingRot);
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(-3, -12, -2, -22);
      g.quadraticCurveTo(-8, -17, -13, -17);
      g.quadraticCurveTo(-16, -11, -22, -10);
      g.quadraticCurveTo(-18, -3, -22, 2);
      g.quadraticCurveTo(-11, 2.5, 0, 5);
      g.closePath();
      g.fillStyle = pal.wing; g.fill();
      g.strokeStyle = pal.vein; g.lineWidth = 1.1; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(-2, -22);
      g.moveTo(-1, -8); g.lineTo(-13, -17);
      g.moveTo(-2, -4); g.lineTo(-22, -10);
      g.stroke();
      g.restore();
      // neck + head
      var hp = headPos(lift);
      g.strokeStyle = pal.body; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(8, -13); g.quadraticCurveTo(14, -14 - 8 * lift, hp.x - 2, hp.y + 1); g.stroke();
      g.save();
      g.translate(hp.x, hp.y);
      var tilt = 0.28 * (1 - lift) - 0.08 * lift + (awake && !rm ? Math.sin(t * 0.7) * 0.05 : 0);
      g.rotate(tilt);
      // horns
      g.fillStyle = pal.horn;
      g.beginPath(); g.moveTo(-4, -4); g.quadraticCurveTo(-9, -8, -14, -13); g.quadraticCurveTo(-8, -9, -1, -6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-1, -5.5); g.quadraticCurveTo(-3, -10, -5, -15); g.quadraticCurveTo(0, -10, 2.5, -6); g.closePath(); g.fill();
      g.fillStyle = pal.body; ell(g, 0, 0, 8, 6.6); g.fill(); ell(g, 7, 1.8, 6, 4); g.fill();
      g.fillStyle = pal.spike; ell(g, 11.6, 0.6, 0.9, 0.7); g.fill(); // nostril
      g.strokeStyle = pal.spike; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(5, 4.6); g.quadraticCurveTo(8.5, 6, 12, 4); g.stroke();
      var ex = 1.5, ey = -1.5;
      var open = awake ? clamp01((p - 0.35) / 0.4) : 0;
      if (blinkA > 0) open *= Math.abs(blinkA / 0.08 - 1);
      if (open > 0.1) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,150,70,0.35)'; ell(g, ex, ey, 6, 6); g.fill();
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#2a0e08'; ell(g, ex, ey, 3.2, 3.5); g.fill();
        g.fillStyle = '#ffb347'; ell(g, ex, ey, 2.6, 3 * open); g.fill();
        g.fillStyle = '#3a1004'; ell(g, ex + 0.5, ey, 0.7, 2.2 * open); g.fill();
        g.fillStyle = '#fff4dc'; ell(g, ex - 0.8, ey - 1.2 * open, 0.6, 0.6); g.fill();
      } else {
        g.strokeStyle = pal.spike; g.lineWidth = 1;
        g.beginPath(); g.moveTo(ex - 2.8, ey); g.quadraticCurveTo(ex, ey + 1.6, ex + 2.8, ey); g.stroke();
      }
      g.restore();

      // breath: smoke curls asleep; tiny spark puffs awake (stateless, phase-driven)
      var nx0 = hp.x + 12, ny0 = hp.y + 1;
      if (!awake) {
        for (var j = 0; j < 3; j++) {
          var ph = (t * 0.3 + j / 3) % 1;
          g.fillStyle = 'rgba(170,150,160,' + ((1 - ph) * 0.18).toFixed(3) + ')';
          ell(g, nx0 + ph * 8 + Math.sin(ph * 6 + j) * 2, ny0 - ph * 18, 1.4 + ph * 3, 1.4 + ph * 3); g.fill();
        }
      } else if (!rm) {
        var cyc = (t + 1.7) % 5.5;
        if (cyc < 1.1) {
          var q = cyc / 1.1;
          g.globalCompositeOperation = 'lighter';
          for (var si = 0; si < 9; si++) {
            var hs = hash(si + Math.floor((t + 1.7) / 5.5) * 13);
            var dq = clamp01(q * (1.1 + hs * 0.5) - hs * 0.2);
            if (dq <= 0 || dq >= 1) continue;
            var sx = nx0 + dq * (16 + hs * 12), sy = ny0 - dq * (4 + hs * 10) + dq * dq * 6;
            var rr = (1 - dq) * (1.4 + hs * 1.2);
            g.fillStyle = dq < 0.4 ? 'rgba(255,214,140,0.9)' : 'rgba(255,110,50,' + (0.9 * (1 - dq)).toFixed(3) + ')';
            ell(g, sx, sy, rr, rr); g.fill();
          }
          g.globalCompositeOperation = 'source-over';
        } else {
          // a faint ember glow at the nostril between puffs
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,120,60,' + (0.12 + 0.1 * br).toFixed(3) + ')';
          ell(g, nx0, ny0, 2.5, 2.5); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      }
      g.restore();
    }
  });
})();
