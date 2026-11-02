/* Hoard — js/log.js — private playtest log (FOUNDATION, SPEC-V2 0.5).
 * Records what happens in the player's real sessions so balance can be tuned from data:
 * engine events, active/swipe/idle time, "stuck" stretches, periodic snapshots, session and run summaries.
 * Storage: localStorage ring buffer 'hoard.log.v1' (last 600 entries) + one cloud db doc per session
 * 'playtest/s<startEpochMs>' (…-2, -3 when a doc reaches 250 entries). Cloud writes: one at a time, at most
 * every 120 s when something changed, plus on page hide; only after main.js hands over a resolved db
 * (HOARD.log.attachDb); never on load; nothing at all without window.claude.
 * Browser module (guards DOM); harmless in Node. See EXTENSIONS.md "Playtest log". */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  var LOG = (HOARD.log = HOARD.log || {});
  var hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

  var LS_KEY = 'hoard.log.v1';
  var RING = 600, DOC_MAX = 250, CLOUD_MS = 120000, ACTIVE_WINDOW = 60000, STUCK_SEC = 90, SNAP_SEC = 300;
  var NEW_SESSION_AFTER_MS = 5 * 60000;

  var ring = [];            // { t, k, d } newest last
  var meta = { runStartAt: 0, runStartLore: null, runBuys: {}, sessions: 0 };
  var getState = null, E = null, inited = false;
  var lsDirty = false, lsTimer = 0;
  var affordChecks = [];    // { name, fn(state) -> bool }

  // session
  var sess = null;
  function newSession(now) {
    meta.sessions = (meta.sessions || 0) + 1;
    return {
      startedAt: now, lastSample: now, lastInput: now, hiddenAt: 0,
      active: 0, swipe: 0, idle: 0, wall: 0,
      coins0: 0, earned0: 0, rankMax: 1, sleeps: 0,
      stuck: 0, stuckLogged: 0, snapAcc: 0,
      parts: [{ id: 's' + now, entries: [], dirty: false }]
    };
  }
  // cloud
  var db = null, busy = false, pending = false, lastWrite = 0, lastBodyKey = '';
  // swipe detection (pointer down on the cave and moving)
  var caveDown = false, lastCaveMove = 0;

  function num(x) { x = +x; return isFinite(x) ? x : 0; }
  function S() { try { return getState ? getState() : null; } catch (e) { return null; } }
  function safeData(d) {
    if (d === undefined) return null;
    var j = null;
    try { j = E && E.util ? E.util.jsonSafe(d) : JSON.parse(JSON.stringify(d)); } catch (e) { j = null; }
    try { var s = JSON.stringify(j); if (s && s.length > 600) j = { text: s.slice(0, 600) }; } catch (e) { j = null; }
    return j === undefined ? null : j;
  }
  function r1(x) { return Math.round(num(x) * 10) / 10; }

  // ---------------------------------------------------------------- core
  function event(type, data) {
    if (typeof type !== 'string' || !type) return null;
    var en = { t: Date.now(), k: type.slice(0, 40), d: safeData(data) };
    var s = S();
    if (s) en.g = Math.round(num(s.time));
    ring.push(en);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    if (sess) {
      var p = sess.parts[sess.parts.length - 1];
      if (p.entries.length >= DOC_MAX) {
        p = { id: sess.parts[0].id + '-' + (sess.parts.length + 1), entries: [], dirty: false };
        sess.parts.push(p);
      }
      p.entries.push(en);
      p.dirty = true;
    }
    lsDirty = true;
    scheduleLs();
    return en;
  }
  LOG.event = event;
  LOG.entries = function () { return ring.slice(); };
  LOG.count = function () { return ring.length; };
  LOG.addAffordable = function (name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return false;
    for (var i = 0; i < affordChecks.length; i++) if (affordChecks[i].name === name) { affordChecks[i].fn = fn; return true; }
    affordChecks.push({ name: name, fn: fn });
    return true;
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function line(en) {
    var d = '';
    if (en.d !== null && en.d !== undefined) { try { d = typeof en.d === 'object' ? JSON.stringify(en.d) : String(en.d); } catch (e) { d = ''; } }
    return stamp(en.t) + '  ' + en.k + (d ? '  ' + d : '');
  }
  LOG.line = line;
  LOG.text = function (n) {
    var list = n ? ring.slice(-n) : ring;
    return list.map(line).join('\n');
  };
  LOG.totals = function () { return sess ? totals() : null; };

  // ---------------------------------------------------------------- local storage
  function lsLoad() {
    if (!hasDom) return;
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && Array.isArray(o.entries)) ring = o.entries.filter(function (e) { return e && typeof e.k === 'string' && num(e.t) > 0; }).slice(-RING);
      if (o && o.meta && typeof o.meta === 'object') {
        meta.runStartAt = num(o.meta.runStartAt);
        meta.runStartLore = o.meta.runStartLore && typeof o.meta.runStartLore === 'object' ? o.meta.runStartLore : null;
        meta.runBuys = o.meta.runBuys && typeof o.meta.runBuys === 'object' ? o.meta.runBuys : {};
        meta.sessions = num(o.meta.sessions);
      }
    } catch (e) { /* ignore */ }
  }
  function lsSave() {
    lsDirty = false;
    if (!hasDom) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, entries: ring, meta: meta })); } catch (e) { /* ignore */ }
  }
  function scheduleLs() {
    if (!hasDom || lsTimer) return;
    lsTimer = setTimeout(function () { lsTimer = 0; if (lsDirty) lsSave(); }, 5000);
  }

  // ---------------------------------------------------------------- cloud
  function totals() {
    var s = S() || {};
    var st = s.stat || {};
    return {
      wall: Math.round((Date.now() - sess.startedAt) / 1000), active: Math.round(sess.active), swipe: Math.round(sess.swipe), idle: Math.round(sess.idle),
      coins: Math.round(num(st.coins) - sess.coins0), earned: Math.max(0, num(s.earnedAll) - sess.earned0),
      rank: num(s.rank), rankMax: sess.rankMax, sleeps: sess.sleeps, legend: num(s.legend), legendPts: num(s.legendPts), myth: num(s.myth),
      totalSleeps: num(s.sleeps), playActive: Math.round(num(st.playActive))
    };
  }
  function writeCloud() {
    if (!db || !sess) return;
    if (busy) { pending = true; return; }
    var part = null;
    for (var i = 0; i < sess.parts.length; i++) if (sess.parts[i].dirty) { part = sess.parts[i]; break; } // oldest unsynced first
    if (!part) part = sess.parts[sess.parts.length - 1];
    var tot = totals();
    var key = part.id + ':' + part.entries.length + ':' + JSON.stringify(tot);
    if (!part.dirty && key === lastBodyKey) return; // nothing changed
    var body = { startedAt: sess.startedAt, updatedAt: Date.now(), version: (E && E.version) || 2, part: sess.parts.indexOf(part) + 1, entries: part.entries.slice(), totals: tot };
    busy = true; pending = false;
    part.dirty = false;
    var p;
    try { p = db.collection('playtest').doc(part.id).set(body); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      lastBodyKey = key; lastWrite = Date.now();
    }, function () {
      part.dirty = true; // retry on the next window
      lastWrite = Date.now();
    }).then(function () {
      busy = false;
      var more = false;
      for (var j = 0; j < sess.parts.length; j++) if (sess.parts[j].dirty && sess.parts[j] !== part) more = true;
      if (pending || more) { pending = false; writeCloud(); }
    });
  }
  // main.js calls this once the db capability resolved (never before; never at load)
  LOG.attachDb = function (d) {
    if (!d || typeof d.collection !== 'function') return;
    db = d;
    lastWrite = Date.now(); // first periodic write no sooner than CLOUD_MS from now
  };
  LOG.flush = function () { writeCloud(); };

  // ---------------------------------------------------------------- sampling
  function anyAffordable(s) {
    try {
      var D = HOARD.data;
      for (var i = 0; i < D.buildings.length; i++) {
        var b = D.buildings[i];
        if (E.isUnlocked(s, 'building', b.id) && E.buildingMax(s, b.id) >= 1) return true;
      }
      for (var t = 1; t < D.tiers.length; t++) if (E.isUnlocked(s, 'tier', t) && E.tierMax(s, t) >= 1) return true; // Eggs never count
      var ups = E.upgradeList(s);
      for (var u = 0; u < ups.length; u++) if (ups[u].visible && ups[u].affordable) return true;
      for (var k = 0; k < affordChecks.length; k++) { try { if (affordChecks[k].fn(s)) return true; } catch (e) { /* ignore */ } }
    } catch (e) { return true; }
    return false;
  }
  function endStuck(s) {
    if (sess.stuck >= STUCK_SEC) {
      event('stuck', { sec: Math.round(sess.stuck), rank: num(s && s.rank), gold: Math.round(num(s && s.gold)), gps: r1(s ? E.stats(s).gps : 0) });
    }
    sess.stuck = 0;
  }
  function sample() {
    if (!sess || !hasDom) return;
    var now = Date.now();
    var dt = Math.min(5, Math.max(0, (now - sess.lastSample) / 1000));
    sess.lastSample = now;
    if (document.hidden) return;
    var s = S();
    if (!s) return;
    sess.wall += dt;
    var active = now - sess.lastInput < ACTIVE_WINDOW;
    if (active) sess.active += dt; else sess.idle += dt;
    if (caveDown && now - lastCaveMove < 700) sess.swipe += dt;
    if (num(s.rank) > sess.rankMax) sess.rankMax = num(s.rank);
    // stuck: active, and nothing worth buying for a while
    if (active) {
      if (anyAffordable(s)) endStuck(s); else sess.stuck += dt;
    }
    // snapshot every 5 min of active play
    if (active) {
      sess.snapAcc += dt;
      if (sess.snapAcc >= SNAP_SEC) {
        sess.snapAcc = 0;
        var st = E.stats(s);
        event('snap', { gold: Math.round(num(s.gold)), gps: r1(st.gps), rank: num(s.rank), earnedRun: Math.round(num(s.earnedRun)), legend: num(s.legend), legendPts: num(s.legendPts), sleeps: num(s.sleeps), active: Math.round(sess.active) });
      }
    }
    if (db && !busy && now - lastWrite >= CLOUD_MS) writeCloud();
  }

  function onHidden() {
    if (!sess) return;
    var s = S();
    if (sess.stuck >= STUCK_SEC) endStuck(s);
    if (!sess.hiddenAt) {
      sess.hiddenAt = Date.now();
      event('session_end', totals());
    }
    lsSave();
    writeCloud();
  }
  function onVisible() {
    if (!sess) return;
    var now = Date.now();
    if (sess.hiddenAt && now - sess.hiddenAt >= NEW_SESSION_AFTER_MS) {
      startSession(now, 'return');
    } else if (sess.hiddenAt) {
      sess.hiddenAt = 0;
      event('resume', null);
    }
    sess.lastSample = now;
    sess.lastInput = now;
  }
  function startSession(now, why) {
    var s = S() || {};
    sess = newSession(now);
    sess.coins0 = num(s.stat && s.stat.coins);
    sess.earned0 = num(s.earnedAll);
    sess.rankMax = num(s.rank) || 1;
    event('session', { why: why, v: (E && E.version) || 2, rank: num(s.rank), legend: num(s.legend), legendPts: num(s.legendPts), sleeps: num(s.sleeps), gold: Math.round(num(s.gold)) });
  }

  // ---------------------------------------------------------------- engine subscriptions
  function subscribe() {
    E.on('rank', function (r) { event('rank', { rank: r }); });
    E.on('unlock', function (u) { event('unlock', u ? { kind: u.kind, id: u.id } : null); });
    E.on('milestone', function (m) { event('milestone', m); });
    E.on('chest', function (cards) { event('chest', { cards: cards }); });
    E.on('lore', function (x) { event('lore', x); });
    E.on('myth', function (g) { event('myth', { gained: g }); });
    E.on('event', function (x) { event('event', x); });
    E.on('buy', function (b) {
      if (!b) return;
      if (b.kind === 'upgrade') { event('upgrade', { id: b.id }); return; }
      if (b.kind !== 'building' && b.kind !== 'tier') return;
      var k = b.kind.charAt(0) + ':' + b.id;
      if (meta.runBuys[k]) return; // first purchase of each building/tier per run only
      meta.runBuys[k] = 1;
      event('first_buy', { kind: b.kind, id: b.id });
    });
    E.on('sleep', function (g) {
      event('sleep', { gained: g });
      if (sess) sess.sleeps++;
    });
    // run summary: the snapshot taken before the reset still has the finished run
    E.addSleepHook('log', function (state, prev, reason) {
      if (!prev) return;
      var now = Date.now();
      var newLore = [];
      var lore0 = meta.runStartLore || {}, lore1 = prev.lore || {};
      for (var id in lore1) if (Object.prototype.hasOwnProperty.call(lore1, id) && num(lore1[id]) > num(lore0[id])) newLore.push(id + ':' + lore1[id]);
      event('run', {
        reason: reason, active: Math.round(num(prev.run && prev.run.playActive)), wall: meta.runStartAt ? Math.round((now - meta.runStartAt) / 1000) : null,
        legendGained: num(state.legend) - num(prev.legend), rank: num(prev.rank), earned: Math.round(num(prev.earnedRun)),
        buildings: prev.buildings, lore: newLore, sleeps: num(state.sleeps)
      });
      meta.runStartAt = now;
      meta.runStartLore = E.util.clone(state.lore || {});
      meta.runBuys = {};
      lsDirty = true; scheduleLs();
    });
  }

  // ---------------------------------------------------------------- settings row
  function settingRow() {
    var ui = HOARD.ui;
    if (!ui || !ui.addSetting || !ui.el) return;
    ui.addSetting({ id: 'playlog', order: 70, build: function (host) {
      var el = ui.el;
      var wrap = el('div', 'playlog');
      var head = el('div', 'toggle-row');
      var lab = el('span', 'tl');
      var cnt = el('small', 'sub');
      lab.appendChild(el('span', null, 'Play log'));
      lab.appendChild(cnt);
      var copyB = ui.button('small', 'Copy log', function () {
        var tot = sess ? totals() : {};
        var txt = 'Hoard play log (' + ring.length + ' entries)\nsession: ' + JSON.stringify(tot) + '\n' + LOG.text();
        ui.copyText(txt, ta, 'Log copied.');
      });
      head.appendChild(lab); head.appendChild(copyB);
      var list = el('pre', 'loglist');
      var ta = el('textarea', 'savebox');
      ta.setAttribute('aria-label', 'Play log text');
      ta.readOnly = true;
      ta.hidden = true;
      wrap.appendChild(head); wrap.appendChild(list); wrap.appendChild(ta);
      host.appendChild(wrap);
      var shown = -1;
      return function () {
        var n = ring.length;
        ui.setText(cnt, n + ' ' + (n === 1 ? 'entry' : 'entries') + ' on this device. Private: helps tune the game.');
        var lastT = n ? ring[n - 1].t : 0;
        if (lastT !== shown) {
          shown = lastT;
          list.textContent = n ? ring.slice(-50).reverse().map(line).join('\n') : 'Nothing logged yet.';
        }
        if (ta.value) ta.hidden = false;
      };
    } });
    ui.css('.playlog .loglist{margin:6px 0 0;max-height:180px;overflow:auto;padding:8px;border-radius:var(--radius);border:1px solid var(--line-2);background:#110f18;color:var(--ink-dim);font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text}', 'log');
  }

  // ---------------------------------------------------------------- init (main.js calls once after the state exists)
  LOG.init = function (gs) {
    if (inited) return;
    inited = true;
    getState = typeof gs === 'function' ? gs : function () { return null; };
    E = HOARD.engine;
    if (!E) return;
    lsLoad();
    subscribe();
    if (!hasDom) return;
    var now = Date.now();
    startSession(now, 'boot');
    var s = S();
    if (s && s._migratedFrom) event('migrate', { from: s._migratedFrom, to: E.version, legend: num(s.legend), legendPts: num(s.legendPts) });
    if (!meta.runStartAt) { meta.runStartAt = now; meta.runStartLore = E.util.clone((s && s.lore) || {}); }
    var mark = function () { if (sess) sess.lastInput = Date.now(); };
    document.addEventListener('pointerdown', function (e) {
      mark();
      if (e.target && e.target.id === 'cave') { caveDown = true; lastCaveMove = Date.now(); }
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (caveDown || e.pointerType === 'mouse') mark();
      if (caveDown) lastCaveMove = Date.now();
    }, { capture: true, passive: true });
    var up = function () { caveDown = false; };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('wheel', mark, { capture: true, passive: true });
    document.addEventListener('visibilitychange', function () { if (document.hidden) onHidden(); else onVisible(); });
    window.addEventListener('pagehide', onHidden);
    setInterval(sample, 1000);
    settingRow();
  };
  // re-baseline after the state object is replaced (load save / start over)
  LOG.stateReplaced = function (why) {
    var s = S();
    if (!sess || !s) return;
    sess.coins0 = num(s.stat && s.stat.coins);
    sess.earned0 = num(s.earnedAll);
    meta.runStartAt = Date.now();
    meta.runStartLore = E && E.util ? E.util.clone(s.lore || {}) : {};
    meta.runBuys = {};
    event('state_replaced', { why: why || '', rank: num(s.rank), legend: num(s.legend), sleeps: num(s.sleeps) });
  };
})();
