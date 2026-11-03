/* Hoard — main.js
 * Boot, game loop, autosave (localStorage every 10 s, cloud db every 60 s if
 * changed), offline welcome-back, visibility handling, hot-reload hook, playtest log wiring.
 * v2: saves stay under the same key/doc; a migrated (older-version) save is first copied to
 * localStorage 'hoard.save.backup.v1' (once). Works with no window.claude at all.
 */
(function () {
  'use strict';
  var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
  if (typeof document === 'undefined') return;

  var E = HOARD.engine;
  var LS_KEY = 'hoard.save.v1';            // never changes (v2 saves live here too)
  var BACKUP_KEY = 'hoard.save.backup.v1';  // pre-migration copy, written once
  var BACKUP_CLOUD_KEY = 'hoard.save.backup.v1.cloud'; // pre-migration copy of an adopted older-version cloud save, once
  var LOCAL_MS = 10000, CLOUD_MS = 60000;
  var OFFLINE_MODAL_MIN = 60;

  var state = null;
  var started = false;
  var bootAt = 0;
  var lastTs = 0;
  var hiddenAt = 0;

  // cloud
  var cloudDoc = null;
  var cloudBusy = false;
  var cloudLastBody = '';   // last json written/read (savedAt stripped)
  var cloudPending = false;
  var localLoadedAt = 0;    // savedAt of the save we booted from (0 = none)
  var stateSwapCount = 0;   // bumps whenever state is replaced (load / reset)
  var bootedFromHot = false;
  var actedSinceBoot = false; // any pointer/key input since boot: never silently replace the live state after that
  var cloudTries = 0, CLOUD_TRIES = 3, CLOUD_RETRY_MS = 30000, ADOPT_MARGIN_MS = 2000;
  // pending "newer cloud save" question: { take, keep, at, reshow }. It stays pending (cloud writes off) until the
  // player answers; if another sheet replaces it, it is asked again once no sheet is open.
  var cloudAsk = null;
  function showCloudAsk() {
    var a = cloudAsk;
    if (!a || !HOARD.ui || !HOARD.ui.ask) return;
    a.reshow = false;
    HOARD.ui.ask('A newer save is in the cloud',
      'Your cloud save is newer than this device (' + new Date(a.at).toLocaleString() + '). Load it, or keep playing this one and overwrite the cloud?',
      'Load cloud save', 'Keep this one',
      function () { if (cloudAsk !== a) return; cloudAsk = null; a.take(); },
      function () { if (cloudAsk !== a) return; cloudAsk = null; a.keep(); },
      function () { if (cloudAsk === a) a.reshow = true; });
  }

  function getState() { return state; }
  // debugging / test hook: live state (read-only accessor)
  try { Object.defineProperty(HOARD, 'state', { get: getState, configurable: true }); } catch (e) { /* ignore */ }
  function num(x) { x = +x; return isFinite(x) ? x : 0; }
  function log(e) { try { console.error('[HOARD]', e); } catch (e2) { /* ignore */ } }

  // ---------------------------------------------------------------- local save
  function lsGet() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function lsSet(s) { try { localStorage.setItem(LS_KEY, s); } catch (e) { /* ignore */ } }
  // keep the raw save from before a version migration, once (never overwritten)
  function backupOnce(raw) {
    if (!raw) return;
    try {
      var v = E.saveVersion ? E.saveVersion(raw) : 0;
      if (!(v > 0) || v >= (E.version || 1)) return;
      if (localStorage.getItem(BACKUP_KEY)) return;
      localStorage.setItem(BACKUP_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (e) { /* ignore */ }
  }
  // an older-version cloud save that gets adopted keeps its own backup (the local backup may hold an older save)
  function backupCloudOnce(raw) {
    if (!raw) return;
    try {
      var v = E.saveVersion ? E.saveVersion(raw) : 0;
      if (!(v > 0) || v >= (E.version || 1)) return;
      if (localStorage.getItem(BACKUP_CLOUD_KEY)) return;
      localStorage.setItem(BACKUP_CLOUD_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (e) { /* ignore */ }
  }
  function logCall(name, a, b) { try { if (HOARD.log && typeof HOARD.log[name] === 'function') HOARD.log[name](a, b); } catch (e) { log(e); } }
  function savedAtOf(raw) {
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && typeof o === 'object' && typeof o.json === 'string' && o.v === undefined) {
        var t = num(o.savedAt);
        if (t > 0) return t;
        o = JSON.parse(o.json);
      }
      return o && typeof o === 'object' ? num(o.savedAt) : 0;
    } catch (e) { return 0; }
  }
  function stripSavedAt(json) { return String(json).replace(/"savedAt":\d+(\.\d+)?/, ''); }

  function saveLocal() {
    if (!state) return '';
    var json = '';
    try { json = E.serialize(state); } catch (e) { log(e); return ''; }
    lsSet(json);
    E.emit('save', { where: 'local' });
    return json;
  }

  // ---------------------------------------------------------------- cloud save
  function saveCloud(force, json) {
    if (!cloudDoc || !state) return; // writes stay off until the cloud copy has been read successfully
    if (cloudBusy) { cloudPending = true; return; }
    if (!json) { try { json = E.serialize(state); } catch (e) { log(e); return; } }
    var body = stripSavedAt(json);
    if (!force && body === cloudLastBody) return;
    cloudBusy = true;
    cloudPending = false;
    var savedAt = num(state.savedAt) || Date.now();
    var p;
    try { p = cloudDoc.set({ json: json, savedAt: savedAt }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      cloudLastBody = body;
      E.emit('save', { where: 'cloud' });
    }, function (e) {
      log(e);
    }).then(function () {
      cloudBusy = false;
      if (cloudPending) { cloudPending = false; saveCloud(false); }
    });
  }

  function saveAll(forceCloud) {
    // serialize once so local and cloud carry the identical savedAt
    var json = saveLocal();
    saveCloud(!!forceCloud, json);
  }

  function connectCloud() {
    var c = window.claude;
    if (!c || typeof c.use !== 'function') return;
    var swapAtStart = stateSwapCount;
    (async function () {
      try {
        var db = await c.use('db');
        if (db) logCall('attachDb', db); // playtest log: writes only from now on, throttled
        var user = await c.use('user');
        if (!db || !user || typeof user.id !== 'function') return;
        var id = await user.id();
        if (!id) return;
        var doc = db.collection('data/users/' + id).doc('save');
        var snap = null, readOk = false;
        try {
          snap = await Promise.race([
            doc.get(),
            new Promise(function (res) { setTimeout(function () { res(null); }, 10000); })
          ]);
          readOk = !!snap; // null = timed out
        } catch (e) { snap = null; log(e); }
        if (!readOk) {
          // never write blind over a cloud save we could not read: keep writes off and retry later
          if (++cloudTries < CLOUD_TRIES) setTimeout(connectCloud, CLOUD_RETRY_MS);
          return;
        }
        var data = snap.exists ? snap.data() : null;
        if (!data || typeof data.json !== 'string') { cloudDoc = doc; return; } // nothing there yet
        var cloudAt = num(data.savedAt) || savedAtOf(data.json);
        if (!(cloudAt > localLoadedAt + ADOPT_MARGIN_MS) || bootedFromHot) {
          cloudLastBody = stripSavedAt(data.json);
          cloudDoc = doc; // ours is as new or newer
          return;
        }
        var take = function () {
          stateSwapCount++;
          backupOnce(data.json);
          backupCloudOnce(data.json);
          adopt(E.deserialize(data.json), true);
          logCall('stateReplaced', 'cloud');
          saveLocal();
          cloudLastBody = stripSavedAt(data.json);
          cloudDoc = doc;
        };
        if (!actedSinceBoot && swapAtStart === stateSwapCount) { take(); return; }
        // the player already played on this copy: ask, and keep cloud writes off until they choose
        var keep = function () { cloudDoc = doc; saveCloud(true); };
        cloudAsk = { take: take, keep: keep, at: cloudAt, reshow: false };
        // never shown over another sheet (welcome back, a chest, the Lore callout): it waits for them
        if (HOARD.ui && HOARD.ui.sheetOpen && HOARD.ui.sheetOpen()) cloudAsk.reshow = true; else showCloudAsk();
      } catch (e) {
        log(e);
        if (++cloudTries < CLOUD_TRIES) setTimeout(connectCloud, CLOUD_RETRY_MS);
      }
    })();
  }

  // ---------------------------------------------------------------- state swap + offline
  function runOffline(seconds) {
    var res = null;
    try { res = E.offline(state, seconds); } catch (e) { log(e); res = null; }
    return res;
  }
  function adopt(ns, withOffline) {
    state = ns;
    state._caveActive = false;
    var res = null;
    if (withOffline) {
      var sec = (Date.now() - num(state.savedAt)) / 1000;
      if (sec > 1) res = runOffline(sec);
    }
    try { if (HOARD.ui && HOARD.ui.refresh) HOARD.ui.refresh(); } catch (e) { log(e); }
    if (res && num(res.seconds) >= OFFLINE_MODAL_MIN) {
      try { HOARD.ui.welcome(res); } catch (e) { log(e); }
    }
    return res;
  }

  // ---------------------------------------------------------------- loop
  function loop(ts) {
    requestAnimationFrame(loop);
    if (document.hidden) { lastTs = 0; return; }
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 1) dt = 1;
    if (!state) return;
    if (dt > 0) { try { E.tick(state, dt); } catch (e) { log(e); } }
    if (cloudAsk && cloudAsk.reshow) { try { if (!HOARD.ui.sheetOpen()) showCloudAsk(); } catch (e) { log(e); } }
    try { if (HOARD.cave && HOARD.cave.frame) HOARD.cave.frame(dt); } catch (e) { log(e); }
    try { if (HOARD.ui && HOARD.ui.frame) HOARD.ui.frame(dt); } catch (e) { log(e); }
  }

  // ---------------------------------------------------------------- visibility
  function onHidden() {
    if (!state) return;
    state._caveActive = false;
    if (!hiddenAt) hiddenAt = Date.now();
    saveAll(false);
  }
  function onVisible() {
    lastTs = 0;
    if (!state) return;
    if (hiddenAt) {
      var away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      if (away >= 2) {
        var res = runOffline(away);
        if (res && num(res.seconds) >= 1) logCall('event', 'offline', { sec: Math.round(num(res.seconds)), gold: Math.round(num(res.gold)) });
        if (res && num(res.seconds) >= OFFLINE_MODAL_MIN) {
          try { HOARD.ui.welcome(res); } catch (e) { log(e); }
        }
      }
    }
  }

  // ---------------------------------------------------------------- boot
  function start(data) {
    if (started) return;
    started = true;
    bootAt = Date.now();
    var fromHot = data !== null && data !== undefined && data !== '';
    var local = lsGet();
    bootedFromHot = fromHot;
    backupOnce(fromHot ? data : local); // before anything can overwrite an older-version save
    try { state = E.deserialize(fromHot ? data : local); } catch (e) { log(e); state = E.newState(); }
    if (!state) state = E.newState();
    localLoadedAt = fromHot ? num(state.savedAt) : (local ? savedAtOf(local) : 0);
    state._caveActive = false;

    try {
      if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
        window.claude.hot.snapshot(function () { return E.serialize(state); });
      }
    } catch (e) { log(e); }

    var off = null;
    if (!fromHot && local) {
      var sec = (Date.now() - num(state.savedAt)) / 1000;
      if (sec > 1) off = runOffline(sec);
    }

    var canvas = document.getElementById('cave');
    try { if (HOARD.cave && HOARD.cave.init) HOARD.cave.init(canvas, getState); } catch (e) { log(e); }
    try {
      HOARD.ui.init({
        getState: getState,
        replaceState: function (ns) {
          stateSwapCount++;
          adopt(ns, false);
          saveAll(true);
          logCall('stateReplaced', 'load');
        },
        resetAll: function () {
          stateSwapCount++;
          adopt(E.newState(), false);
          saveAll(true);
          logCall('stateReplaced', 'reset');
        },
        saveNow: function (forceCloud) { saveAll(!!forceCloud); }
      });
    } catch (e) { log(e); }

    try { if (HOARD.log && HOARD.log.init) HOARD.log.init(getState); } catch (e) { log(e); }
    if (off && num(off.seconds) >= 1) logCall('event', 'offline', { sec: Math.round(num(off.seconds)), gold: Math.round(num(off.gold)) });
    try { if (HOARD._runReady) HOARD._runReady(getState); } catch (e) { log(e); }

    if (off && num(off.seconds) >= OFFLINE_MODAL_MIN) {
      try { HOARD.ui.welcome(off); } catch (e) { log(e); }
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHidden(); else onVisible();
    });
    window.addEventListener('pagehide', function () { onHidden(); });
    window.addEventListener('pageshow', function () { if (!document.hidden) onVisible(); });

    setInterval(function () { if (!document.hidden) saveLocal(); }, LOCAL_MS);
    setInterval(function () { if (!document.hidden) saveCloud(false); }, CLOUD_MS);

    var markActed = function () { actedSinceBoot = true; };
    document.addEventListener('pointerdown', markActed, true);
    document.addEventListener('keydown', markActed, true);

    requestAnimationFrame(loop);
    connectCloud();
  }

  function boot() {
    try {
      var hot = window.claude && window.claude.hot;
      if (hot && typeof hot.ready === 'function') hot.ready(start);
      else start(hot && hot.data !== undefined ? hot.data : null);
    } catch (e) {
      log(e);
      if (!started) start(null);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
