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
  var LOCAL_MS = 10000, CLOUD_MS = 20000;  // cloud is the only save that survives where the browser drops localStorage
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
  var cloudDb = null, cloudUid = '';
  var cloudLastOkAt = 0;    // wall ms of the last successful cloud write or read
  var cloudErr = '';        // last cloud problem, for the Settings status line
  var cloudBackupDone = false;
  var localWasEmpty = false; // booted with no save on this device (no localStorage copy)
  function showCloudAsk() {
    var a = cloudAsk;
    if (!a || !HOARD.ui || !HOARD.ui.ask) return;
    a.reshow = false;
    HOARD.ui.ask(a.cloudAhead ? 'Your cloud save is further along' : 'A different save is in the cloud',
      'Cloud (saved ' + new Date(a.at).toLocaleString() + '): ' + a.cloudText + '. This device: ' + a.hereText + '.' +
        (a.cloudAhead ? ' If you keep this device\'s copy, the cloud save is backed up first and can be restored from Settings.' : ''),
      a.cloudAhead ? 'Load cloud save' : 'Load cloud save', 'Keep this device\'s',
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
  // how far along a save is: compared by Myths, then Long Sleeps, then active play time, then lifetime gold
  function progressOf(st) {
    if (!st || typeof st !== 'object') return [0, 0, 0, 0];
    var sp = st.stat && typeof st.stat === 'object' ? num(st.stat.playActive) : 0;
    return [num(st.myths), num(st.sleeps), Math.floor(sp / 30), num(st.earnedAll) || num(st.earnedRun)];
  }
  function cmpProgress(a, b) {
    for (var i = 0; i < 4; i++) { if (a[i] > b[i]) return 1; if (a[i] < b[i]) return -1; }
    return 0;
  }
  function parseSave(raw) { try { return E.deserialize(raw); } catch (e) { return null; } }
  // a real Hoard save (string or object, or a {json} wrapper) — anything else is ignored at boot
  function rawObj(raw) {
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && typeof o === 'object' && typeof o.json === 'string' && !Array.isArray(o.tiers)) o = JSON.parse(o.json);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (e) { return null; }
  }
  function isSave(raw) { var o = rawObj(raw); return !!(o && Array.isArray(o.tiers) && o.buildings && typeof o.buildings === 'object'); }
  function describeRaw(raw) {
    if (raw === null || raw === undefined) return 'none';
    if (raw === '') return 'empty string';
    if (isSave(raw)) { var o = rawObj(raw); return 'save v' + (o.v || 1) + ' sleeps ' + num(o.sleeps); }
    var t = typeof raw;
    if (t === 'object') { try { return 'object keys: ' + Object.keys(raw).slice(0, 6).join(',').slice(0, 80); } catch (e) { return 'object'; } }
    return t + ' ' + String(raw).slice(0, 40);
  }
  // nothing worth keeping: no Sleep or Myth yet and under 5 minutes of play
  function isFresh(st) { return !!st && num(st.sleeps) < 1 && num(st.myths) < 1 && num(st.stat && st.stat.playActive) < 300; }
  function describe(st) {
    if (!st) return 'nothing';
    var f = HOARD.fmt || function (n) { return String(Math.floor(n)); };
    var parts = ['rank ' + Math.max(1, Math.floor(num(st.rank)))];
    if (num(st.legend) > 0) parts.push(f(num(st.legend)) + ' Legend');
    if (num(st.sleeps) > 0) parts.push(num(st.sleeps) + (num(st.sleeps) === 1 ? ' Sleep' : ' Sleeps'));
    var mins = Math.round(num(st.stat && st.stat.playActive) / 60);
    parts.push(mins >= 90 ? (Math.round(mins / 6) / 10) + ' h played' : mins + ' min played');
    return parts.join(' · ');
  }

  function saveLocal() {
    if (!state) return '';
    var json = '';
    try { json = E.serialize(state); } catch (e) { log(e); return ''; }
    lsSet(json);
    E.emit('save', { where: 'local' });
    return json;
  }

  // ---------------------------------------------------------------- cloud save
  function saveCloud(force, json, cb) {
    if (!cloudDoc || !state) { if (cb) cb(false); return; } // writes stay off until the cloud copy has been read successfully
    if (cloudBusy) { cloudPending = true; if (cb) cloudWaiters.push(cb); return; }
    if (!json) { try { json = E.serialize(state); } catch (e) { log(e); if (cb) cb(false); return; } }
    var body = stripSavedAt(json);
    if (!force && body === cloudLastBody) { if (cb) cb(true); return; }
    cloudBusy = true;
    cloudPending = false;
    var savedAt = num(state.savedAt) || Date.now();
    var p;
    try { p = cloudDoc.set({ json: json, savedAt: savedAt }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      cloudLastBody = body;
      cloudLastOkAt = Date.now();
      cloudErr = '';
      E.emit('save', { where: 'cloud' });
      if (cb) cb(true);
    }, function (e) {
      log(e);
      cloudErr = 'The last cloud save failed. It will try again.';
      if (cb) cb(false);
    }).then(function () {
      cloudBusy = false;
      var w = cloudWaiters; cloudWaiters = [];
      if (cloudPending || w.length) { cloudPending = false; saveCloud(false, null, w.length ? function (ok) { w.forEach(function (f) { try { f(ok); } catch (e) { /* ignore */ } }); } : null); }
    });
  }
  var cloudWaiters = [];
  // copy the cloud save to data/users/<id>/save_backup before something less far along overwrites it
  function backupCloudDoc(data, why) {
    if (!cloudDb || !cloudUid || !data || typeof data.json !== 'string') return Promise.resolve(false);
    try {
      var bdoc = cloudDb.collection('data/users/' + cloudUid).doc('save_backup');
      return Promise.resolve(bdoc.set({ json: data.json, savedAt: num(data.savedAt) || savedAtOf(data.json), backedUpAt: Date.now(), why: String(why || '') }))
        .then(function () { cloudBackupDone = true; logCall('event', 'cloud', { what: 'backup', why: why }); return true; }, function (e) { log(e); return false; });
    } catch (e) { log(e); return Promise.resolve(false); }
  }

  function saveAll(forceCloud, cb) {
    // serialize once so local and cloud carry the identical savedAt
    var json = saveLocal();
    saveCloud(!!forceCloud, json, cb);
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
        cloudDb = db; cloudUid = id;
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
          cloudErr = 'Could not reach the cloud save yet. Retrying.';
          logCall('event', 'cloud', { what: 'readFail', tries: cloudTries + 1 });
          if (++cloudTries < CLOUD_TRIES) setTimeout(connectCloud, CLOUD_RETRY_MS);
          else cloudErr = 'Could not reach the cloud save. Progress is only kept on this device.';
          return;
        }
        cloudLastOkAt = Date.now(); cloudErr = '';
        var data = snap.exists ? snap.data() : null;
        if (!data || typeof data.json !== 'string') { cloudDoc = doc; logCall('event', 'cloud', { what: 'empty' }); saveCloud(true); return; } // nothing there yet
        var cloudAt = num(data.savedAt) || savedAtOf(data.json);
        var cloudState = parseSave(data.json);
        var cmp = cmpProgress(progressOf(cloudState), progressOf(state)); // >0: the cloud is further along
        var take = function (why) {
          stateSwapCount++;
          backupOnce(data.json);
          backupCloudOnce(data.json);
          adopt(E.deserialize(data.json), true);
          logCall('stateReplaced', 'cloud');
          logCall('event', 'cloud', { what: 'loaded', why: why });
          saveLocal();
          cloudLastBody = stripSavedAt(data.json);
          cloudDoc = doc;
          try { if (why !== 'quiet' && HOARD.ui && HOARD.ui.toast) HOARD.ui.toast('Hoard loaded from the cloud.', describe(state), 'moss'); } catch (e) { log(e); }
        };
        // keep this device's copy: if the cloud one is at least as far along, back it up in the cloud first
        var keep = function () {
          var go = function () { cloudDoc = doc; saveCloud(true); };
          if (cmp >= 0) backupCloudDoc(data, 'kept device copy').then(go, go); else go();
          logCall('event', 'cloud', { what: 'keptDevice', cloudAhead: cmp > 0 });
        };
        var untouched = swapAtStart === stateSwapCount;
        if (cmp > 0) {
          // the cloud save is further along. A device with no real save of its own, or one with nothing worth
          // keeping, loads it without asking; otherwise the player chooses (and the cloud copy is backed up first
          // if they keep this device's)
          if (untouched && (localWasEmpty || isFresh(state))) { take(actedSinceBoot || !localWasEmpty ? 'device fresh' : 'quiet'); return; }
        } else {
          var cloudNewer = cloudAt > localLoadedAt + ADOPT_MARGIN_MS;
          if (cmp === 0 && cloudNewer && untouched && !actedSinceBoot && !bootedFromHot) { take('quiet'); return; }
          // this device's save is at least as far along: keep it (cloud backups are only for further-along saves)
          cloudLastBody = stripSavedAt(data.json);
          cloudDoc = doc;
          logCall('event', 'cloud', { what: 'keptDevice', cloudAhead: false });
          return;
        }
        // the two copies disagree and the player may have played here: ask, showing both, and keep cloud writes off
        // until they choose
        cloudAsk = { take: function () { take('chosen'); }, keep: keep, at: cloudAt, reshow: false,
          cloudText: describe(cloudState), hereText: describe(state), cloudAhead: cmp > 0 };
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
    var hotDesc = describeRaw(data);
    var fromHot = isSave(data);       // the viewer's hot-reload hook can hand over things that are not a save
    var local = lsGet();
    var localDesc = describeRaw(local);
    if (!isSave(local)) local = null;
    bootedFromHot = fromHot;
    backupOnce(fromHot ? data : local); // before anything can overwrite an older-version save
    try { state = E.deserialize(fromHot ? data : local); } catch (e) { log(e); state = E.newState(); }
    if (!state) state = E.newState();
    localLoadedAt = fromHot ? num(state.savedAt) : (local ? savedAtOf(local) : 0);
    localWasEmpty = !fromHot && !local;
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
        saveNow: function (forceCloud, cb) { saveAll(!!forceCloud, cb); },
        cloudStatus: function () {
          return { connected: !!cloudDoc, lastOkAt: cloudLastOkAt, error: cloudErr, available: !!(window.claude && typeof window.claude.use === 'function'),
            pendingAsk: !!cloudAsk };
        },
        loadCloudBackup: function (cb) {
          if (!cloudDb || !cloudUid) { cb(null); return; }
          var bdoc = cloudDb.collection('data/users/' + cloudUid).doc('save_backup');
          Promise.resolve(bdoc.get()).then(function (snap) {
            var d = snap && snap.exists ? snap.data() : null;
            if (!d || typeof d.json !== 'string') { cb(null); return; }
            var st = parseSave(d.json);
            cb(st ? { json: d.json, savedAt: num(d.savedAt), text: describe(st), state: st } : null);
          }, function (e) { log(e); cb(null); });
        },
        restoreCloudBackup: function (b) {
          if (!b || !b.state) return;
          // the copy being replaced becomes the new backup, so a restore can be undone
          var cur = { json: E.serialize(state), savedAt: Date.now() };
          var go = function () {
            stateSwapCount++;
            adopt(E.deserialize(b.json), false);
            logCall('stateReplaced', 'backup');
            saveAll(true);
          };
          backupCloudDoc(cur, 'replaced by restore').then(go, go);
        }
      });
    } catch (e) { log(e); }

    try { if (HOARD.log && HOARD.log.init) HOARD.log.init(getState); } catch (e) { log(e); }
    logCall('event', 'boot', { from: fromHot ? 'hot' : (local ? 'device' : 'none'), hot: hotDesc, device: localDesc });
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
