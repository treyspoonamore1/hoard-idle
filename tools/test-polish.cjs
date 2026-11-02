// POLISH module test (SPEC-V2 section 4): loads data.js + engine.js (+ lore/events/ember when present) + sound.js +
// ui-stats.js in a Node vm. Drives sound.js with a fake AudioContext (graph creation, every sound, throttling,
// settings, hidden, voice cleanup, engine wiring) and HOARD.statsView against real states: fresh, played,
// offline(), Long Sleep, serialize/deserialize round-trip and the v1 fixtures.
// Usage: node tools/test-polish.cjs        (VERBOSE=1 prints the stats rows)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
let fails = 0, passes = 0;
function check(cond, msg) { if (cond) passes++; else { fails++; console.log('FAIL:', msg); } }
function near(a, b, rel) { return Math.abs(a - b) <= (rel || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b)); }
const BAD = /\b(NaN|undefined|Infinity|null)\b/;

function load(files) {
  let seed = 777;
  const sb = { console, Date, JSON, Promise, Math: Object.create(Math) };
  sb.Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  return sb.HOARD;
}
const mods = ['js/lore.js', 'js/events.js', 'js/ember.js'].filter(f => fs.existsSync(path.join(root, f)));
const FILES = ['js/data.js', 'js/engine.js'].concat(mods, ['js/sound.js', 'js/ui-stats.js']);
let H;
try { H = load(FILES); passes++; } catch (e) { console.log('FAIL: modules throw in Node', e); process.exit(1); }
try { load(FILES.concat(['js/ui.js'])); passes++; } catch (e) { fails++; console.log('FAIL: with ui.js in Node', e); }
const E = H.engine, SND = H.sound, SV = H.statsView;
check(!!SND && typeof SND.play === 'function', 'HOARD.sound exists');
check(!!SV && typeof SV.lifetime === 'function' && typeof SV.multipliers === 'function', 'HOARD.statsView exists');

// ================================================================ fake WebAudio
function makeFakeAudio() {
  const log = { nodes: [], params: [], badParams: [], sources: [], resumed: 0, suspended: 0, created: 0 };
  function param(owner, name, v) {
    const p = {
      _v: v, events: [],
      get value() { return this._v; },
      set value(x) { if (!isFinite(x)) log.badParams.push(owner + '.' + name + '=' + x); this._v = x; },
    };
    ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime'].forEach(fn => {
      p[fn] = function (x, t, c) {
        if (!isFinite(x) || !isFinite(t) || (c !== undefined && !isFinite(c))) log.badParams.push(owner + '.' + name + '.' + fn + '(' + x + ',' + t + ')');
        if (fn === 'exponentialRampToValueAtTime' && !(x > 0)) log.badParams.push(owner + '.' + name + ' exp ramp to ' + x);
        if (t < 0) log.badParams.push(owner + '.' + name + ' negative time ' + t);
        p.events.push([fn, x, t]);
        if (fn === 'setValueAtTime' && p.events.length === 1) p._v = x;
        return p;
      };
    });
    log.params.push(p);
    return p;
  }
  function node(kind, extra) {
    const n = Object.assign({ kind, outs: [], connected: 0, disconnected: false,
      connect(d) { this.outs.push(d); this.connected++; if (d && d.ins !== undefined) d.ins++; return d; },
      disconnect() { this.disconnected = true; this.outs = []; },
      ins: 0 }, extra || {});
    log.nodes.push(n);
    return n;
  }
  function source(kind, ctx, extra) {
    const s = node(kind, Object.assign({
      started: null, stopped: null, onended: null,
      start(t) { if (!isFinite(t) || t < 0) log.badParams.push(kind + '.start ' + t); this.started = t; },
      stop(t) { if (!isFinite(t)) log.badParams.push(kind + '.stop ' + t); this.stopped = t; }
    }, extra));
    log.sources.push(s);
    return s;
  }
  class FakeCtx {
    constructor() {
      log.created++;
      this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 8000;
      this.destination = node('destination');
    }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    suspend() { log.suspended++; this.state = 'suspended'; return Promise.resolve(); }
    createGain() { const n = node('gain'); n.gain = param('gain', 'gain', 1); return n; }
    createOscillator() { const o = source('osc', this); o.type = 'sine'; o.frequency = param('osc', 'frequency', 440); o.detune = param('osc', 'detune', 0); return o; }
    createBufferSource() { const o = source('buf', this); o.buffer = null; o.loop = false; o.playbackRate = param('buf', 'rate', 1); return o; }
    createBiquadFilter() { const n = node('biquad'); n.type = 'lowpass'; n.frequency = param('biquad', 'frequency', 350); n.Q = param('biquad', 'Q', 1); return n; }
    createDynamicsCompressor() { const n = node('comp'); ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(k => { n[k] = param('comp', k, 0); }); return n; }
    createConvolver() { const n = node('conv'); n.buffer = null; return n; }
    createStereoPanner() { const n = node('pan'); n.pan = param('pan', 'pan', 0); return n; }
    createBuffer(ch, len, rate) {
      const data = []; for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: i => data[i] };
    }
  }
  return { FakeCtx, log };
}
// advance the fake clock, firing onended for finished sources
function advance(ctx, log, dt) {
  ctx.currentTime += dt;
  for (const s of log.sources) {
    if (s.stopped !== null && !s._ended && s.stopped <= ctx.currentTime) { s._ended = true; if (s.onended) s.onended(); }
  }
}
function flushAll(ctx, log) { advance(ctx, log, 30); }

// ================================================================ sound.js
{
  // no AudioContext in Node: silent, never throws
  let s = E.newState();
  SND._test.setState(() => s);
  check(SND.unlock() === false, 'no AudioContext -> unlock false');
  check(SND.play('coin', { n: 1, streak: 1 }) === false, 'no context -> play false');
  check(SND.info().state === 'none', 'info state none before unlock');

  // settings defaults and setters
  check(SND.enabled(s) === true && SND.volume(s) === 0.4, 'defaults: sound on, volume 40%');
  check(SND.enabled({}) === true && SND.volume({}) === 0.4 && SND.volume(null) === 0.4, 'missing settings guarded');
  check(SND.volume({ settings: { volume: 'x' } }) === 0.4 && SND.volume({ settings: { volume: 7 } }) === 1 && SND.volume({ settings: { volume: -1 } }) === 0, 'volume sanitized');
  check(SND.gainFor(0) === 0 && SND.gainFor(1) > SND.gainFor(0.4) && SND.gainFor(0.4) > 0.15 && SND.gainFor(0.4) < 0.35, 'gain curve 40% -> ' + SND.gainFor(0.4).toFixed(3));

  const { FakeCtx, log } = makeFakeAudio();
  SND._test.useFactory(() => new FakeCtx());
  SND._test.setState(() => s);
  check(SND.play('coin', { n: 1 }) === false, 'before unlock (no gesture) nothing plays');
  check(log.created === 0, 'context not created before the first gesture');
  check(SND.unlock() === true, 'unlock creates context');
  const ctx = SND.context();
  check(!!ctx && ctx.state === 'running' && log.resumed >= 1, 'context resumed after gesture');
  check(log.created === 1, 'exactly one context');
  SND.unlock();
  check(log.created === 1, 'second gesture reuses the context');
  check(ctx.destination.ins >= 1, 'master connected to destination');
  check(log.nodes.some(n => n.kind === 'conv' && n.buffer && n.buffer.length > 0), 'reverb impulse built');
  check(log.nodes.some(n => n.kind === 'comp' && n.connected), 'compressor in graph');
  const masterG = log.nodes.find(n => n.kind === 'gain' && n.outs.indexOf(ctx.destination) >= 0);
  check(!!masterG && near(masterG.gain.value, SND.gainFor(0.4), 1e-6), 'master gain = curve(40%) from the start (no fade-in)');

  // every sound plays with finite params and cleans up
  const names = SND.names;
  ['coin', 'streakUp', 'gust', 'treasure', 'buy', 'rank', 'sleep', 'chest', 'lore', 'myth', 'emberWake', 'eventStart', 'questDone', 'preview']
    .forEach(n => check(names.indexOf(n) >= 0, 'sound defined: ' + n));
  const perSound = {};
  for (const n of names) {
    advance(ctx, log, 5);
    const before = log.sources.length;
    const data = n === 'chest' ? { cards: ['crown', 'tidepearl', 'emberegg'] } : (n === 'coin' ? { n: 3, streak: 5 } : (n === 'buy' ? { kind: 'building' } : {}));
    const okp = SND.play(n, data);
    check(okp === true, 'plays: ' + n);
    perSound[n] = log.sources.length - before;
    check(perSound[n] > 0, n + ' creates sources (' + perSound[n] + ')');
    const srcs = log.sources.slice(before);
    check(srcs.every(x => x.started !== null && x.stopped !== null && x.stopped > x.started), n + ': every source started and stopped');
    const len = Math.max.apply(null, srcs.map(x => x.stopped - ctx.currentTime));
    perSound[n] = perSound[n] + ' src, ' + len.toFixed(2) + 's';
  }
  SND.play('lore', { relic: true });
  SND.play('buy', { kind: 'upgrade' });
  check(log.badParams.length === 0, 'no non-finite / bad automation values: ' + log.badParams.slice(0, 5).join('; '));
  check(SND.info().voices > 0, 'voices counted while playing');
  flushAll(ctx, log);
  check(SND.info().voices === 0, 'all voices released after they end');
  const voiceNodes = log.nodes.filter(n => n.kind === 'osc' || n.kind === 'buf');
  check(voiceNodes.every(n => n.disconnected), 'ended voices disconnected');
  console.log('sounds:', JSON.stringify(perSound));

  // coin throttle: a frantic 60 fps swipe with coins every frame for 10 s
  advance(ctx, log, 5);
  const p0 = SND.info().played.coin || 0;
  const freqs = [];
  let peak = 0;
  for (let f = 0; f < 600; f++) {
    const b = log.sources.length;
    if (SND.play('coin', { n: 2, streak: 1 })) { const o = log.sources[b]; if (o && o.frequency) freqs.push(o.frequency.events[0][1]); }
    peak = Math.max(peak, SND.info().voices);
    advance(ctx, log, 1 / 60);
  }
  const coinN = (SND.info().played.coin || 0) - p0;
  check(coinN <= 121 && coinN >= 100, 'coin throttle <= 12/s: ' + coinN + ' in 10 s');
  const uniq = new Set(freqs.map(x => Math.round(x))).size;
  check(uniq > 20, 'coin pitch randomized (' + uniq + ' distinct)');
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const minF = Math.min.apply(null, freqs), maxF = Math.max.apply(null, freqs);
  check(maxF / minF < 1.05, 'coin pitch jitter stays subtle (' + (1200 * Math.log2(maxF / minF)).toFixed(0) + ' cents span)');
  const f1 = mean(freqs);
  const freqs8 = [];
  for (let f = 0; f < 120; f++) { const b = log.sources.length; if (SND.play('coin', { n: 1, streak: 8 })) freqs8.push(log.sources[b].frequency.events[0][1]); advance(ctx, log, 1 / 60); }
  const f8 = mean(freqs8);
  check(f8 > f1 * 1.4, 'pitch rises with streak (x1 ' + f1.toFixed(0) + ' Hz, x8 ' + f8.toFixed(0) + ' Hz)');
  console.log('coin: ' + coinN + ' clinks in 10 s of 60 coin-batches/s, peak voices ' + peak + ', pitch x1 ' + f1.toFixed(0) + ' Hz -> x8 ' + f8.toFixed(0) + ' Hz');

  // buys while holding: <= ~12/s
  advance(ctx, log, 5);
  const b0 = SND.info().played.buy || 0;
  for (let f = 0; f < 120; f++) { SND.play('buy', { kind: 'tier' }); advance(ctx, log, 1 / 60); }
  const buyN = (SND.info().played.buy || 0) - b0;
  check(buyN <= 25 && buyN >= 15, 'buy thunks throttled: ' + buyN + ' in 2 s');

  // everything at once stays under the voice cap
  advance(ctx, log, 5);
  ['rank', 'chest', 'myth', 'sleep', 'treasure', 'gust', 'lore'].forEach(n => SND.play(n, n === 'chest' ? { cards: ['crown', 'crown', 'crown'] } : {}));
  const crowd = SND.info().voices;
  check(crowd <= 56, 'voice cap respected under load (' + crowd + ', dropped ' + SND.info().dropped + ')');
  const okCoin = SND.play('coin', { n: 1 });
  check(okCoin === false, 'low-priority coin skipped while the mix is crowded');
  flushAll(ctx, log);

  // settings: off, volume 0, hidden
  advance(ctx, log, 5);
  SND.setEnabled(s, false);
  check(s.settings.sound === false && ctx.state === 'suspended', 'sound off -> stored + context suspended');
  check(SND.play('rank') === false, 'sound off -> silent');
  SND.unlock();
  check(ctx.state === 'suspended', 'gesture does not resume while sound is off');
  SND.setEnabled(s, true);
  check(s.settings.sound === true && ctx.state === 'running', 'sound on -> resumed');
  SND.setVolume(s, 0);
  check(s.settings.volume === 0 && SND.play('rank') === false, 'volume 0 -> silent');
  SND.setVolume(s, 0.734);
  check(s.settings.volume === 0.73, 'volume stored rounded');
  const tgt = masterG.gain.events.filter(e => e[0] === 'setTargetAtTime').pop();
  check(near(tgt[1], SND.gainFor(0.73), 1e-6), 'volume change applied to master');
  SND.setVolume(s, 'garbage');
  check(s.settings.volume === 0.4, 'garbage volume -> default');
  SND._test.setHidden(true);
  check(ctx.state === 'suspended' && SND.play('rank') === false, 'hidden -> suspended, silent');
  SND._test.setHidden(false);
  SND.unlock();
  check(ctx.state === 'running' && SND.play('rank') === true, 'visible again -> plays');
  flushAll(ctx, log);

  // engine wiring (no HOARD.cave in Node -> engine-event fallback)
  SND.wire(() => s);
  advance(ctx, log, 5);
  const pc = () => Object.assign({}, SND.info().played);
  let before = pc();
  E.coinCollected(s, 3, 1);
  check((pc().coin || 0) === (before.coin || 0) + 1, 'engine coin -> clink (fallback wiring)');
  s.gold = 1e6;
  advance(ctx, log, 1);
  before = pc();
  SND._test.setPlayerBuying(false);
  E.buyBuilding(s, 'digger', 1);
  check((pc().buy || 0) === (before.buy || 0), 'auto-buys (no finger on the UI) stay silent');
  SND._test.setPlayerBuying(true);
  advance(ctx, log, 1);
  E.buyBuilding(s, 'digger', 1);
  check((pc().buy || 0) === (before.buy || 0) + 1, 'player buy -> thunk');
  SND._test.setPlayerBuying(false);
  advance(ctx, log, 5);
  before = pc();
  E.emit('rank', 2);
  check((pc().rank || 0) === (before.rank || 0) + 1, 'rank event -> fanfare');
  E.emit('lore', { id: 'greed', level: 1 });
  check((pc().lore || 0) === (before.lore || 0) + 1, 'lore event -> chime');
  advance(ctx, log, 5);
  before = pc();
  s.chests = 5;
  const srcBefore = log.sources.length;
  for (let i = 0; i < 5; i++) E.openChest(s);
  check((pc().chest || 0) === (before.chest || 0), 'chest sound waits for the batch');
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    check((pc().chest || 0) === (before.chest || 0) + 1, 'Open-all (5 chests) -> one batched chest sound');
    check(log.sources.length - srcBefore < 40, 'batched chest stays small (' + (log.sources.length - srcBefore) + ' sources)');
    // sleep event
    advance(ctx, log, 5);
    const b2 = pc();
    s.earnedRun = 4e7;
    E.sleep(s);
    check((pc().sleep || 0) === (b2.sleep || 0) + 1, 'Long Sleep -> pad');
    check(log.badParams.length === 0, 'still no bad automation values');
    flushAll(ctx, log);
    check(SND.info().voices === 0, 'voices back to 0');
    statsTests();
  });
}

// ================================================================ ui-stats.js (statsView)
function rowsOk(rows, label) {
  check(Array.isArray(rows) && rows.length > 0, label + ': rows');
  for (const r of rows) {
    check(typeof r.value === 'string' && r.value.length > 0 && !BAD.test(r.value), label + ': ' + r.id + ' = "' + r.value + '"');
    check(typeof r.label === 'string' && !BAD.test(r.label), label + ': label ' + r.id);
  }
}
function multOk(res, s, label) {
  check(res && Array.isArray(res.rows) && res.total, label + ': breakdown');
  const all = [res.total].concat(res.rows);
  for (const r of all) {
    for (const k of ['gold', 'coin', 'minion', 'all']) check(isFinite(r[k]) && r[k] >= 0, label + ': ' + r.id + '.' + k + ' finite ' + r[k]);
    for (const k of ['goldText', 'coinText', 'minionText']) check(!BAD.test(r[k]) && /^×/.test(r[k]), label + ': ' + r.id + '.' + k + ' "' + r[k] + '"');
    check(r.extra.every(x => !BAD.test(x)), label + ': ' + r.id + ' extras clean');
  }
  // allMult and coin are pure products -> the parts multiply to the total exactly
  const pa = res.rows.reduce((p, r) => p * r.all, 1), pc = res.rows.reduce((p, r) => p * r.coin, 1);
  check(near(pa, res.total.all, 1e-9), label + ': product of parts allMult = total (' + pa + ' vs ' + res.total.all + ')');
  check(near(pc, res.total.coin, 1e-9), label + ': product of parts coin = total (' + pc + ' vs ' + res.total.coin + ')');
  const st = E.stats(s);
  check(near(res.total.all, st.M.allMult, 1e-12), label + ': total allMult matches stats().M');
  const leg = res.rows.find(r => r.id === 'legend');
  check(!!leg && near(leg.all, 1 + 0.1 * (+s.legend || 0), 1e-12), label + ': Legend row = 1 + 0.1 x legend');
  if (process.env.VERBOSE) {
    console.log('  [' + label + ']');
    for (const r of all) if (!r.neutral || r === res.total) console.log('   ', r.label.padEnd(16), 'gold', r.goldText.padEnd(8), 'coin', r.coinText.padEnd(8), 'brood', r.minionText.padEnd(8), r.extra.join(' | '));
  }
}
function val(rows, id) { const r = rows.find(x => x.id === id); return r ? r.value : null; }

function statsTests() {
  // fresh
  const s = E.newState();
  let rows = SV.lifetime(s);
  rowsOk(rows, 'fresh');
  check(val(rows, 'fastest') === 'Not yet' && val(rows, 'sleeps') === '0' && val(rows, 'streak') === '×1', 'fresh values');
  check(val(rows, 'cards') === '0/' + H.data.cards.length, 'cards X/' + H.data.cards.length);
  if (mods.indexOf('js/events.js') >= 0) check(H.data.cards.length === 29, '29 cards with event cards registered');
  rowsOk(SV.thisRun(s), 'fresh run');
  multOk(SV.multipliers(s), s, 'fresh');
  check(SV.multipliers(s).rows.filter(r => !r.neutral).length === 0, 'fresh: every source neutral');
  check(SV.lifetime(null).length === rows.length && SV.multipliers(null).rows.length === 0, 'null state guarded');

  // distance math: 96 px per inch
  check(SV.distance(0) === '0.0 m' && SV.distance(96 / 0.0254) === '1.0 m', 'distance: 3780 px = 1 m');
  check(SV.distance(96 / 0.0254 * 1234) === '1.23 km', 'distance km: ' + SV.distance(96 / 0.0254 * 1234));
  check(SV.distance(NaN) === '0.0 m' && SV.distance(-5) === '0.0 m', 'distance guarded');
  check(SV.mult(1.234) === '1.23' && SV.mult(34.56) === '34.6' && SV.mult(456.7) === '457' && SV.mult(12345) === H.fmt(12345) && SV.mult(NaN) === '1', 'mult formatting');

  // played: swipe, buy, treasures, cards, rank
  s.gold = 5e4;
  for (let i = 0; i < 400; i++) { E.coinCollected(s, 2, 3); E.strokeCollected(s, 120, 3); E.noteStreak(s, 5); }
  E.buyBuilding(s, 'digger', 10);
  E.buyUpgrade(s, 'claws1'); E.buyUpgrade(s, 'spill1'); E.buyUpgrade(s, 'scales1');
  s.chests = 6; for (let i = 0; i < 6; i++) E.openChest(s);
  for (let i = 0; i < 600; i++) E.tick(s, 0.5);
  if (E.useGust(s)) E.coinCollected(s, 10, 1, 3);
  E.grabTreasure(s);
  rows = SV.lifetime(s);
  rowsOk(rows, 'played');
  check(val(rows, 'coins') === H.fmt(s.stat.coins) && val(rows, 'streak') === '×5', 'played: coins + best streak');
  check(val(rows, 'distance') === SV.distance(400 * 120), 'played: distance ' + val(rows, 'distance'));
  check(val(rows, 'play') === H.fmtTime(300), 'played: play time 5m ' + val(rows, 'play'));
  const owned = Object.keys(s.cards).filter(k => s.cards[k] >= 1).length;
  check(val(rows, 'cards') === owned + '/' + H.data.cards.length, 'played: cards ' + val(rows, 'cards'));
  let res = SV.multipliers(s);
  multOk(res, s, 'played');
  const up = res.rows.find(r => r.id === 'upgrades');
  check(up && !up.neutral && up.coin === 2 && up.extra.some(x => /of gold\/s/.test(x)) && up.extra.some(x => /spill/.test(x)), 'upgrades row: coins x2, scales, spill');

  // offline
  const off = E.offline(s, 3 * 3600);
  check(off && off.seconds > 0, 'offline ran');
  rowsOk(SV.lifetime(s), 'after offline');
  multOk(SV.multipliers(s), s, 'after offline');

  // Long Sleep
  s.earnedRun = Math.max(s.earnedRun, 9e7);
  s.earnedAll = Math.max(s.earnedAll, s.earnedRun);
  const g = E.sleep(s);
  check(g >= 9, 'slept for ' + g + ' Legend');
  rows = SV.lifetime(s);
  rowsOk(rows, 'after sleep');
  check(val(rows, 'sleeps') === '1' && val(rows, 'fastest') === H.fmtTime(s.stat.fastestSleep) && s.stat.fastestSleep > 0, 'fastest Sleep recorded: ' + val(rows, 'fastest'));
  check(SV.thisRun(s).find(r => r.id === 'runPlay').value === '0s', 'this run reset by sleep');
  res = SV.multipliers(s);
  multOk(res, s, 'after sleep');
  const leg = res.rows.find(r => r.id === 'legend');
  check(!leg.neutral && leg.goldText === '×' + SV.mult(1 + 0.1 * s.legend), 'Legend row shows ' + leg.goldText);
  check(res.rows[0].id === 'legend', 'Legend listed first');
  // lore / myth sources (if LORE loaded): give some levels and check they show up
  if (H.lore && E.modBreakdown(s).some(p => p.name === 'lore')) {
    s.lore.greed = 2; s.lore.halls = 1; s.lore.bargain = 1; s.myth = 2;
    E.dirty();
    res = SV.multipliers(s);
    multOk(res, s, 'with lore');
    const lr = res.rows.find(r => r.id === 'lore');
    check(lr && !lr.neutral, 'lore row visible with levels: ' + (lr && lr.goldText + ' ' + lr.coinText + ' ' + lr.extra.join(',')));
    const my = res.rows.find(r => r.id === 'myth');
    if (my) check(!my.neutral && my.gold > 1, 'myth row ' + my.goldText);
    s.lore = {}; s.myth = 0; E.dirty();
  }
  // event cards split from treasure cards
  const evCard = H.data.cards.find(c => c.chest === false && typeof c.mod === 'function');
  if (evCard) {
    E.grantCard(s, evCard.id, 3);
    res = SV.multipliers(s);
    multOk(res, s, 'with event card');
    const ec = res.rows.find(r => r.id === 'eventcards');
    check(ec && ec.label === 'Event cards' && !ec.neutral, 'event cards row: ' + (ec && ec.goldText + ' ' + ec.extra.join(',')));
  }
  // frenzy effect line
  E.addEffect(s, 'frenzy', 7, 30);
  res = SV.multipliers(s);
  check(res.effects.some(e => e.id === 'frenzy' && /×7/.test(e.text)), 'frenzy effect listed');

  // serialize / deserialize round-trip keeps sound settings and gives identical rows
  s.settings.sound = false; s.settings.volume = 0.25;
  const json = E.serialize(s);
  const s2 = E.deserialize(json);
  check(s2.settings.sound === false && s2.settings.volume === 0.25, 'sound settings survive save round-trip');
  check(SND.enabled(s2) === false && SND.volume(s2) === 0.25, 'sound reads restored settings');
  check(JSON.stringify(SV.lifetime(s2)) === JSON.stringify(SV.lifetime(s)), 'lifetime rows identical after round-trip');
  const m1 = SV.multipliers(s), m2 = SV.multipliers(s2);
  check(JSON.stringify(m1.rows.map(r => [r.id, r.goldText, r.coinText, r.minionText])) === JSON.stringify(m2.rows.map(r => [r.id, r.goldText, r.coinText, r.minionText])), 'multiplier rows identical after round-trip');
  check(!BAD.test(json) || !/"(gold|legend|volume)":null/.test(json), 'save clean');

  // v1 fixtures
  const fx = fs.readdirSync(path.join(root, 'tools/fixtures')).filter(f => /^v1-.*\.json$/.test(f));
  check(fx.length >= 4, 'v1 fixtures found: ' + fx.join(', '));
  for (const f of fx) {
    const raw = fs.readFileSync(path.join(root, 'tools/fixtures', f), 'utf8');
    const v = E.deserialize(raw);
    check(SND.enabled(v) === true && SND.volume(v) === 0.4, f + ': sound defaults on / 40%');
    const lr = SV.lifetime(v);
    rowsOk(lr, f);
    const src = JSON.parse(raw);
    const obj = src.json ? JSON.parse(src.json) : src;
    check(val(lr, 'earned') === H.fmt(obj.earnedAll || 0), f + ': gold earned ' + val(lr, 'earned'));
    check(val(lr, 'sleeps') === String(obj.sleeps || 0), f + ': sleeps ' + val(lr, 'sleeps'));
    check(val(lr, 'fastest') === 'Not yet', f + ': v1 had no fastest Sleep');
    multOk(SV.multipliers(v), v, f);
    for (let i = 0; i < 20; i++) E.tick(v, 0.5);
    E.offline(v, 7200);
    multOk(SV.multipliers(v), v, f + ' +offline');
    if (E.canSleep(v)) {
      E.sleep(v);
      rowsOk(SV.lifetime(v), f + ' slept');
      check(SV.lifetime(v).find(r => r.id === 'fastest').value !== 'Not yet', f + ': fastest set after sleep');
    }
    const v2 = E.deserialize(E.serialize(v));
    check(JSON.stringify(SV.lifetime(v2)) === JSON.stringify(SV.lifetime(v)), f + ': rows stable through round-trip');
  }

  if (process.env.VERBOSE) { console.log(SV.lifetime(s).map(r => '  ' + r.label + ': ' + r.value).join('\n')); }
  console.log((fails ? 'FAILED ' + fails : 'ALL CHECKS PASSED') + ' (' + passes + ' passed)');
  process.exit(fails ? 1 : 0);
}
