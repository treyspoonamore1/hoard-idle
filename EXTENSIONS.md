# Hoard v2 — extension API (foundation)

This is the contract the four feature agents (LORE, EMBER, EVENTS, POLISH) code against.
Read `SPEC.md` (v1 rules) and `SPEC-V2.md` (what to build) first. Everything here exists and is tested
(`tools/smoke.cjs` exercises tabs, sections, chips, row extras, cave layers, sfx hooks and `ask()`;
`tools/save-compat.cjs` covers saves and state defaults).

Hard rules that still apply: swipe, never tap-spam; press-and-hold for repeated buys (`HOARD.ui.bindHold`);
no emoji; no alert/confirm/prompt (use `HOARD.ui.ask`); never NaN/Infinity in state; classic scripts on
`window.HOARD`, `'use strict'` IIFE per file; engine-side files never touch the DOM.

---

## 1. Files, load order, ownership

```
js/data.js  js/engine.js                         foundation (engine core + extension points)
js/lore.js  js/events.js  js/ember.js            engine-side feature modules — Node-safe, no DOM, no window
js/log.js   js/sound.js                          browser modules (guard DOM/Audio), loaded BEFORE cave/ui
js/cave.js  js/ui.js                             foundation (canvas scene / UI core)
js/ui-lore.js  js/ui-events.js  js/ui-ember.js  js/ui-stats.js     UI feature modules (loaded AFTER ui.js)
js/main.js                                       foundation (boot, loop, saves, log wiring)
```

| file | owner |
|---|---|
| lore.js, ui-lore.js | LORE |
| ember.js, ui-ember.js | EMBER |
| events.js, ui-events.js | EVENTS |
| sound.js, ui-stats.js | POLISH |
| everything else | FOUNDATION (do not edit; ask for an API instead) |

Every file starts as a no-op stub, so the page loads at every stage. Keep your module's own globals on one
namespace object, e.g. `HOARD.lore = { ... }`, `HOARD.ember`, `HOARD.events`, `HOARD.sound`.

**When your code runs**

- Engine-side modules run at script load: register mod sources, hooks, state defaults and cards
  immediately (before `main.js` deserializes the save, so your subtree and cards are known on the first load).
- UI modules (`ui-*.js`) run after `ui.js`: call `HOARD.ui.addTab/addSection/addSetting/addChip/addRowExtra/css`
  at load. The UI builds later, in `ui.init()`.
- `sound.js` loads before `ui.js`, so `HOARD.ui` and `HOARD.cave` do not exist yet. Register UI and hooks
  inside `HOARD.whenReady(function (getState) { ... })`. `main.js` runs that queue once, right after
  `ui.init()` (cave and UI are ready then). If you register after boot, the callback runs at once.
- The live state is `HOARD.state` (a getter, browser only) or `HOARD.ui.state()`. Never cache the state object:
  it is replaced by "Load save", "Start over" and cloud adoption.

---

## 2. Engine (`HOARD.engine`, alias `E` below)

The whole v1 API is unchanged (see SPEC.md). v1 balance is unchanged: `tools/sim.cjs` output is
byte-identical before and after the v2 refactor.

### 2.1 State fields added in v2 (core, always present)

```js
state.v          // 2
state.legend     // Legend earned in this Myth. Drives the passive +10% each (source 'legend'). Spending never lowers it.
state.legendPts  // spendable Legend. sleep() adds the gained Legend to BOTH legend and legendPts.
state.myth       // Myth earned in total (LORE drives it; e.g. 1.5^myth production)
state.mythPts    // spendable Myth
state.myths      // number of Ascends taken
state.lore       // {} free-form map, e.g. { auto_dig: 1, greed: 3 }    (LORE owns the content)
state.relics     // {} free-form map, e.g. { r_legend: 2 }              (LORE)
state.auto       // {} free-form map of automation toggles, e.g. { master: true, 'b:digger': false }   (LORE)
state.flags      // {} tiny shared flags; use E.flag / E.setFlag
state.stat.playActive    // seconds of tick() time (page visible), lifetime
state.stat.fastestSleep  // shortest run.playActive at a Long Sleep (0 = none yet)
state.run.playActive     // seconds of tick() time in this run (reset by Long Sleep)
```

Save migration (v1 to v2) sets `legendPts = legend` and creates the maps above. The free-form maps keep any
JSON-safe values (numbers, booleans, strings, nested objects), so you do not need defaults for them.
Store levels as numbers: `state.lore.greed = 3`.

### 2.2 Modifier pipeline — `E.addModSource(name, fn(state, M))`

Every bonus feeds `stats()` through one accumulator `M`. On each recompute the engine creates a fresh `M`,
calls every source in registration order, clamps the result, and applies it. Built-in sources, in this
order: `'legend'`, `'rank'`, `'upgrades'`, `'cards'` (v1 cards plus registered cards with `mod`). Yours
come after them (engine-side modules load after engine.js).

```js
// lore.js
HOARD.engine.addModSource('lore', function (s, M) {
  var lv = (s.lore && +s.lore.greed) || 0;
  if (lv > 0) { M.coinMult *= 1 + 0.5 * lv; M.strokeMult *= 1 + 0.5 * lv; }
  var bar = (s.lore && +s.lore.bargain) || 0;
  if (bar > 0) { M.costMultBuilding *= Math.pow(0.9, bar); M.costMultTier *= Math.pow(0.9, bar); }
  if ((+s.lore.talons || 0) >= 1) M.streakHigh = true;
});
```

**M fields and exactly how the engine applies them**

| field | default | applied as |
|---|---|---|
| `allMult` | 1 | **gold/s AND coin worth AND minion production, applied once.** This is how Legend works (×(1+0.1·legend)). Use it for "all production ×X" (Myth 1.5^myth, Ember's warmth, "all gold" event cards). |
| `gpsMult` | 1 | building gold/s only (rank bonus and Crown card live here). The coin gps-part follows gps, so coins also rise a little. |
| `buildingMult[id]` | (absent = 1) | one building's gold/s. Write `M.buildingMult.mine = (M.buildingMult.mine \|\| 1) * x`. |
| `tierMult[i]` | 1 ×5 | production of tier i (index = the producing tier: 1 Wyrmlings … 4 Elders; [0] is unused). |
| `coinMult` | 1 | coin worth (flat part and gps part). |
| `strokeMult` | 1 | stroke (swipe path) gold. |
| `costMultBuilding` | 1 | gold cost of buildings (clamped at least 0.05). Minion costs of buildings are not affected. |
| `costMultTier` | 1 | gold cost of minions, all tiers (clamped at least 0.05). |
| `legendGainMult` | 1 | `legendOnSleep = floor(sqrt(earnedRun/1e6) × legendGainMult)`. |
| `offlineCapAddH` | 0 | `stats.offlineCapHours = 8 + offlineCapAddH`. |
| `offlineMult` | 1 | gold earned in `offline()` sub-steps (not minions, not tick hooks). |
| `streakHigh` | false | unlocks the ×8 streak cap (v1: rank 4+ or Comet Shard). |
| `streakRamp` | 1 | >1 = streak levels come faster. The cave multiplies swipe time by it. |
| `treasureFreq` | 1 | treasure interval divided by it (>1 = more often). |
| `frenzyDurAdd` | 0 | seconds added to Gold Frenzy. |
| `gustCdMult` | 1 | `gustCooldown = gustCd × gustCdMult` (<1 = faster). |
| `gustMult` | 1 | `gustWorthMult = 3 × gustMult` (gust coin value). |
| `chestCardsAdd` | 0 | extra cards per chest (integer). |
| `sweepMult` | 1 | Broom Crew coins/s. |
| **foundation extras** | | |
| `coinFlat` | 1 | flat coin value (Sharper Claws ×2 each). |
| `coinGpsPct` | 0 | extra share of gold/s per coin, added to the base 0.5% (Golden Scales). |
| `spillMult` | 1 | coin spill rate. |
| `sweepRate` | 0 | base broom coins/s (upgrades set the max). |
| `gustCd` | 45 | base gust cooldown seconds (upgrades set the min). |
| `streakBonus` | 1 | value of the streak multiplier (Comet Shard +5%/lv). |
| `tierCostMult[i]` | 1 ×5 | per-tier minion gold cost (Ember Egg card on tier 0). |
| `frenzyMult` | 1 | Gold Frenzy strength (×7 × frenzyMult), e.g. EMBER "Fire Frenzy ×1.5". |

The resulting formulas (`bg` = building gold/s before Frenzy):

```
bg        = Σ_b  b.gps × 2^milestones × buildingMult[b] × owned   × allMult × gpsMult
gps       = bg × frenzy
coinWorth = (coinFlat + (0.005 + coinGpsPct) × bg / allMult) × coinMult × ember × allMult
stroke    = 0.25 × coinWorth × strokeMult
tier rate = prod × 2^milestones × allMult × tierMult[i]
```

**Rules for mod sources (read these):**
- Pure and fast: read `state` and multiply into `M`. Never mutate `state`, never `emit`.
- **Never call `E.stats`, `E.mods`, `E.buildingCost`, `E.tierCost`, `E.legendOnSleep`, `E.streak…` or
  anything that reads stats inside a mod source.** Those call the pipeline again and recurse forever.
- Be defensive: your subtree can be missing on a hand-made state (`(s.ember && s.ember.x) || 0`).
- A source that throws is skipped (logged) for that recompute. After 5 throws it is switched off.
- Mods apply only while their condition holds. To keep something through Sleep, keep the state that drives it.

**Stats cache, `E.dirty()`**: `stats(state)` is cached per (state object, `state.time`, global dirty epoch).
Every engine mutator (buy*, claimMission, openChest, sleep, addEffect, grantCard, setFlag, spend, tick,
offline) marks it dirty. **If your code changes anything a mod source reads (lore levels, ember totals,
event-card copies, relics) outside a tick, call `HOARD.engine.dirty()` afterwards.** Otherwise the UI shows
stale numbers until the next frame's tick. `tick()` always starts by marking dirty. Treat the object from
`stats()` as read-only (it is shared).

`stats(state)` also returns, besides the v1 fields: `M` (the clamped accumulator), `streakRamp`,
`streakBonus`, `offlineMult`. `E.mods(state)` is `stats(state).M`.

`E.modBreakdown(state)` returns `[{ name, M }]`: each source run alone on a fresh M. Good for a stats page,
e.g. `x.M.allMult * x.M.gpsMult` per source.

`E.freshMods()` returns a default M (for previews such as "next level gives ×…").

### 2.3 Costs with modifiers

`buildingCost`, `buildingMax`, `buyBuilding`, `tierCost`, `tierMax`, `buyTier` and mission generation apply
`M.costMultBuilding`, `M.costMultTier` and `M.tierCostMult`. Auto-buyers should just call
`E.buyBuilding(s, id, n|'max')` / `E.buyTier(s, i, n|'max')` / `E.buyUpgrade(s, id)`.

### 2.4 Tick hooks — `E.addTickHook(name, fn(state, dt, isOffline))`

Runs inside `tick()` after production and the time advance (and after Frenzy/Ember expiry), before the
mission done-flags update. Also runs once per `offline()` sub-step with `isOffline = true`.

- Live: `dt` ≤ 1 s, about 60 calls/s. Offline: up to 200 sub-steps, so `dt` can be as large as
  8h/200 = 144 s (more with a bigger offline cap). Integrate with `dt`; do not assume small steps.
- Engine events are **suppressed while offline** (`E.isQuiet()` is true), so nothing you emit there shows up.
- Throttle heavy work, e.g. accumulate `dt` and run auto-buy every 0.5 s live.
- `state.time` advances only in `tick()`, not offline. For wall-clock schedules (EVENTS) use `Date.now()`
  (and `state.savedAt` when you need the save's wall time). Never `Math.random` for schedules.
- 5 throws switch the hook off (logged).

```js
// ember.js: kilns produce embers live and offline
var acc = 0;
E.addTickHook('ember', function (s, dt, isOffline) {
  if (!s.lore || !s.lore.wake_ember) return;
  var rate = HOARD.ember.rate(s);                      // your own pure function
  s.ember.embers += rate * dt * (isOffline ? smoulderMult(s) : 1);
  s.ember.earned += rate * dt;
  acc += dt; if (acc > 0.5) { acc = 0; E.dirty(); }    // the warmth mod reads ember.earned
});
```

### 2.5 Sleep hooks — `E.addSleepHook(name, fn(state, prevSnapshot, reason))`

Called by `E.resetRun()`, which runs in every Long Sleep (`reason 'sleep'`) and in your own Ascend
(`reason` is what you pass, e.g. `'ascend'`). Order inside `sleep(state)`:

1. `gained = legendOnSleep(state)`, `stat.sleepsGold`, `stat.fastestSleep` updated
2. snapshot `prevSnapshot = JSON copy of the state` (no `_` keys)
3. reset: gold, earnedRun, tiers, buildings, upgrades, rank=1, rankProgress, effects, run, gust=1, missions
4. `legend += gained`, `legendPts += gained`, `sleeps += 1`, `chests += 1`
5. **your sleep hooks**, in registration order (they see the new legend)
6. missions regenerated (so a hook that sets `rank = 3` gets rank-3 missions), then `emit('sleep', gained)`

Restore or seed what your module keeps, for example:

```js
E.addSleepHook('lore', function (s, prev, reason) {
  var L = s.lore || {};
  if (L.keep_claws) ['claws1','claws2','claws3','claws4','scales1','scales2','scales3']
    .forEach(function (id) { if (prev.upgrades[id]) s.upgrades[id] = true; });
  var sg = [0, 500, 5e4, 5e6, 5e8][Math.min(4, L.start_gold || 0)];
  if (sg) E.earn(s, sg, 'lore');          // or s.gold = sg (earn also counts it toward Legend)
  if (L.start_rank) s.rank = Math.max(s.rank, L.start_rank >= 2 ? 5 : 3);
});
```

Untouched by a Sleep: cards, chests, legend/legendPts (added), lore, relics, myth*, flags, auto, settings,
stat, and every module subtree. Modules reset their own subtrees themselves (Ember keeps its state through
a Sleep; EVENTS has nothing to do).

**Ascend (LORE)**: do your own bookkeeping, then call `E.resetRun(state, 'ascend', between?)`:

```js
function ascend(s) {
  var gained = mythOnAscend(s);
  // reset what Ascend resets beyond a Sleep BEFORE resetRun, so hooks see the post-Ascend state
  s.legend = 0; s.legendPts = 0; resetNonAutomationLore(s);
  s.myth += gained; s.mythPts += gained; s.myths += 1;
  E.resetRun(s, 'ascend');          // run reset + all sleep hooks (reason 'ascend') + missions + dirty
  E.emit('myth', gained);
}
```

`resetRun(state, reason, between)` returns the snapshot. `between(state, snapshot)` (optional) runs after
the reset and before the hooks.

### 2.6 State subtrees — `E.addStateDefaults(name, fn() -> object, sanitize?)`

Registers `state[name]`. `newState()` includes `fn()`. `deserialize()` fills it from the save. `serialize()`
writes it (keys starting with `_` are never saved). Call it at load time, before `main.js` runs.

Default fill rules (no `sanitize`): for each key of the defaults, keep the saved value when its type matches
(finite number / boolean / string / array / object, recursively). Otherwise use the default. An empty-object
default `{}` is a free-form map (all JSON-safe saved entries kept). Saved keys you did not declare are kept
too (forward compatible). Non-finite numbers become defaults.

```js
E.addStateDefaults('ember', function () {
  return { awake: false, embers: 0, earned: 0, kilns: [0, 0, 0, 0], breaths: {}, seen: false };
});
// stricter: E.addStateDefaults('events', defaultsFn, function (saved, defaults) { ...return clean object; });
```

- `name` must not be a core key (`gold`, `tiers`, …). The core maps `lore`, `relics`, `flags` and `auto` may
  be registered too (your defaults are merged into them).
- A subtree whose module did not load (or unknown top-level keys from a newer version) **survives**
  load and save untouched, so a broken module never wipes player data.
- `tick()` and `stats()` also add a missing subtree to a live state (hot reload, old state objects).
- Prefer numbers and booleans. Keep it small (the whole save is written every 10 s).

### 2.7 Cards — `E.registerCards(list)`

```js
E.registerCards([{
  id: 'obsidianheart', name: 'Obsidian Heart', rarity: 'legendary',   // common|rare|epic|legendary
  group: 'volcano',               // free text; UI may group/filter by it (cardInfo returns it)
  chest: false,                   // REQUIRED for event cards: never drops from normal chests
  flavor: 'Still warm after a thousand years.',
  describe: function (lv) { return 'All gold x' + (1 + 0.3 * Math.max(1, lv)).toFixed(1) + '.'; },
  mod: function (s, M, lv) { M.allMult *= 1 + 0.3 * lv; }      // called only when level >= 1
}]);
```

- Appended to `HOARD.data.cards`. The Hoard tab grid, `cardInfo`, save sanitizing and the `cards` mod source
  pick it up automatically (20 v1 + 9 event cards = 29). Re-registering the same id replaces it.
- Levels use the v1 thresholds `[1,3,6,10,15,25,40,60,90,140]` (`E.levelFor(copies)`).
- `mod(s, M, level)` follows the mod-source rules (pure, no stats calls).
- `E.grantCard(state, id, n=1)` adds copies, marks dirty and emits `'card' {id, n}`. Returns false for
  unknown ids.
- `E.rollCard(filter?)` returns a weighted-by-rarity card id. Without a filter it excludes `chest:false`
  cards. With `filter(cardDef) -> bool` you choose the pool, e.g. `c => c.group === 'volcano'`.
- `E.openChest(state)` (normal chests) gives `2/3 + M.chestCardsAdd` cards.

### 2.8 Small helpers

```js
E.version                       // 2
E.flag(state, key)              // state.flags[key] (undefined if unset)
E.setFlag(state, key, value)    // JSON-safe value; null/undefined deletes; marks dirty
E.spend(state, field, amount)   // e.g. E.spend(s, 'legendPts', 4): false if short, else subtracts + dirty
E.earn(state, amount, source)   // adds gold to gold/earnedRun/earnedAll (v1). Use for gold rewards.
E.addEffect(state, kind, mult, durSeconds)   // timed effect in state.effects (any kind string; frenzy/ember are v1)
E.effectLeft(state, kind)       // seconds left
E.dirty()                       // invalidate the stats cache (see 2.2)
E.off(name, fn)                 // remove an event listener
E.isQuiet()                     // true during offline() simulation (events suppressed)
E.saveVersion(raw)              // version of a raw save string/object (0 = not a save)
E.util                          // { fin, cl, pos, clamp, isObj, hash32, clone, jsonSafe, pow2, MAXN }
```

`E.util.cl(x)` clamps to ±1e300 and NaN→0. `pos(x)` is ≥0. `fin(x, d)` returns d for non-finite. Run every
number you store through `pos`/`cl`.

### 2.9 Engine events (`E.on(name, fn)`, `E.emit(name, payload)`)

| event | payload | who emits |
|---|---|---|
| `'rank'` | rank (number) | engine (v1) |
| `'mission'` | idx | engine (v1) |
| `'chest'` | [cardId] | engine `openChest` (v1) |
| `'treasure'` | `{kind,title,text,...}` | engine `grabTreasure` (v1) |
| `'sleep'` | gained Legend | engine `sleep` (v1) |
| `'unlock'` | `{kind,id,name}` | engine (v1) |
| `'milestone'` | `{kind,id,count}` | engine (v1) |
| `'buy'` | `{kind:'building'\|'tier'\|'upgrade', id, n}` | engine buy functions (each successful buy, also hold-repeats) |
| `'gust'` | — | engine `useGust` |
| `'coin'` | n coins (number) | engine `coinCollected` (cave batches per frame; gusts too; not the broom) |
| `'card'` | `{id, n}` | engine `grantCard` |
| `'save'` | `{where:'local'\|'cloud'}` | main.js after a successful save |
| `'lore'` | `{id, level}` | **LORE emits** after a node purchase |
| `'myth'` | gained Myth | **LORE emits** after Ascend |
| `'event'` | `{type:'start'\|'finish'\|'quest'\|'chest'..., lair, ...}` | **EVENTS emits** |

The playtest log listens to rank, sleep, myth, lore, unlock, milestone, buy (first of each building/tier per
run, plus upgrades), event, chest. Emit your events with those exact names and the log records them.
Listeners run inside try/catch. Events emitted while offline are dropped.

### 2.10 Saves (what foundation guarantees)

- localStorage key `hoard.save.v1` and cloud doc `data/users/<id>/save` never change.
- `deserialize` never throws and never mutates its input. It migrates (`E.migrations[1]`: v1→v2), sanitizes,
  and marks the result with `_migratedFrom` (older) or `_futureVersion` (newer). Those `_` keys are not saved.
- The first time an older-version save is loaded, main.js copies the raw save to `hoard.save.backup.v1`
  (only once; never overwritten).
- Feature modules need no migrations: `addStateDefaults` fills new fields. If you ever must transform data,
  ask foundation to add `MIGRATIONS[2]`.

---

## 3. UI (`HOARD.ui`)

All registration functions can be called at load time (before `ui.init`) or later. Calling one again with the
same `id` replaces the definition. Every callback runs in try/catch: a throwing callback logs once and the
rest of the UI keeps working.

Typical callback args: `state` = live state, `stats` = `E.stats(state)` (read-only).

### 3.1 Tabs — `ui.addTab(def)`

```js
HOARD.ui.addTab({
  id: 'ember', label: 'Ember', icon: HOARD.ui.icons.ember, order: 70,
  visible: function (s) { return !!(s.lore && s.lore.wake_ember); },  // tab bar updates <= 5x/s
  key: function (s) { return 'E' + kilnCount(s); },     // panel part rebuilt when this string changes
  build: function (host, s) {                           // append DOM into host; return a patch fn (optional)
    var ui = HOARD.ui, head = ui.el('div', 'big-num');
    host.appendChild(ui.secHead("Ember's warmth")); host.appendChild(head);
    return function (s, st) { ui.setText(head, '×' + ui.multStr(warmth(s))); };
  },
  patch: function (s, st, host) { /* optional static patch, also <= 5x/s */ },
  badge: function (s) { return 0; }   // number > 0 = count badge, true = dot, 0/false = none
});
```

- Existing tabs and orders: `lair` 10, `brood` 20, `quests` 30, `hoard` 40, `legend` 60 (moon icon; v1 Sleep).
  The Ember tab should use **order 70** (6th, last). The bar fits 6 tabs at 360 px (labels ≤ 7 characters).
- `build(host, state)` may return: a function (patch), `{ patch }`, or v1 style `{ root, patch }` (root is
  appended for you).
- Patches run at most 5×/s, plus immediately after a buy or claim. Keep them cheap. Use the `setText/setCls/...`
  helpers, which skip unchanged DOM.
- The panel is rebuilt when `key(state)` changes, when the tab's visible sections change, or when the state
  object is replaced. It is **not** rebuilt while a hold-to-buy is in progress on the same state.
- If your tab is visible but the player is on a tab that becomes hidden, the UI falls back to the first
  visible tab. `ui.setTab(id)` switches tabs (`'sleep'` is accepted as an alias of `'legend'`).

### 3.2 Sections — `ui.addSection(tabId, def)` / `ui.removeSection(tabId, id)`

Same fields as a tab minus label/icon: `{ id, order, visible, build(host, state), key, patch, badge }`.
Sections and the tab's own `build` (which sits at `buildOrder`, default 0) are stacked by `order`. Each
section has its own host `<div class="sec" data-sec="tab.id">` and is rebuilt on its own when its `key` changes.

Existing sections:

| tab | id | order | content |
|---|---|---|---|
| legend | `sleep` | 10 | Long Sleep panel (progress, Legend if you sleep now, Sleep button + confirm) |
| legend | `legendinfo` | 12 | Legend earned / Legend to spend / Legend bonus / Long Sleeps taken |
| legend | `sofar` | 90 | v1 "Your hoard so far" lifetime numbers |

LORE: put the Legend header before `sleep` (e.g. order 5), Lore at 20+, Myth at 40, Relics at 50. If your
header replaces `legendinfo`, call `HOARD.ui.removeSection('legend', 'legendinfo')`. Section badges are added
to the tab's badge (numbers summed, `true` = dot).

```js
HOARD.ui.addSection('quests', { id: 'eventBanner', order: -10,           // above the Quests content (tab build = 0)
  visible: function (s) { return HOARD.events.active(s); },
  build: function (host, s) { /* banner card; button opens the lair sheet */ } });
```

### 3.3 Settings rows — `ui.addSetting({ id, order, build(host, state) })`

The gear in the top bar opens the **Settings sheet**, which shows every setting row by `order`. `build` may
return a patch fn that runs ≤5×/s while the sheet is open. Existing rows: `haptics` 10, `motion` 20,
`playlog` 70, `save` 80 (copy/load save), `reset` 90 (start over). Suggested: sound 30–35, stats 40.

```js
HOARD.ui.addSetting({ id: 'sound', order: 30, build: function (host) {
  var t = HOARD.ui.toggle('Sound', function (s) { return s.settings.sound !== false; },
                                   function (s, v) { s.settings.sound = v; });
  host.appendChild(t.row);
  return t.patch;
} });
HOARD.ui.addSetting({ id: 'stats', order: 40, build: function (host) {
  host.appendChild(HOARD.ui.button('wide', 'Stats', function () { openStatsSheet(); }));
} });
```

`state.settings` may hold your own keys (e.g. `sound`, `volume`). They are saved and kept on load.
`ui.openSettings()` reopens the sheet (e.g. a "Back" button in the Stats sheet).

### 3.4 Top-bar chips — `ui.addChip({ id, order, visible(state, stats), text(state, stats), onPress?, cls? })`

Appended after the v1 chips (gold/s, streak, Frenzy, Ember, Legend). Visibility and text update ≤5×/s. With
`onPress` the chip is a button (single press, large hit area). `cls` adds classes (existing looks: `legend`
purple, `frenzy`, `ember`, `streak`). Keep text short ("Volcano Lair · 2d 14h", "Auto").

### 3.5 Lair/Brood row hooks — `ui.addRowExtra(kind, fn(slotEl, id, state, cardEl))`

`kind` is `'building'` (id = building id) or `'tier'` (id = tier index 0..4). Called when the row is built.
`slotEl` is a flex row at the bottom of the card (hidden while empty). Return an optional
`patch(state, stats)`. Rows are rebuilt when the Lair key (rank, visible upgrades) changes, so **build always
and show/hide in the patch** (or call `ui.refresh()` after a purchase that should add controls).

```js
HOARD.ui.addRowExtra('building', function (slot, id) {
  var ui = HOARD.ui;
  var t = ui.toggle('Auto', function (s) { return s.auto['b:' + id] !== false; },
                            function (s, v) { s.auto['b:' + id] = v; });
  t.row.classList.add('mini'); slot.appendChild(t.row);
  return function (s) { ui.setHidden(t.row, !(s.lore && s.lore.auto_build)); t.patch(s); };
});
```

### 3.6 Sheets, questions, toasts

```js
ui.sheet(node, { center, dismissable /*default true*/, full /*92% height*/, cls /*extra class on .sheet*/,
                 onClose /*dismissed or closed normally*/, onAbort /*replaced by another sheet*/,
                 patch /*(state, stats) <= 5x/s while open*/ })
ui.closeSheet(); ui.sheetOpen() -> bool
ui.ask(title, text, yesLabel, noLabel[, { danger, dismissable }]) -> Promise<boolean>  // false on No/dismiss/replaced
ui.confirm(title, text, yes, no, danger) -> Promise<boolean>
ui.toast(title, text, kind)       // kind: '' | 'gold' | 'moss' (success) | 'ember' (warning). Max 2 visible, queued.
```

Only one sheet at a time: opening a sheet replaces the current one. Lair sheet (EVENTS):
`ui.sheet(node, { full: true, cls: 'lair-volcano', patch: patchFn })`, tinted with your CSS.

### 3.7 CSS, icons, helpers

`ui.css(cssText, id)` injects a `<style>` once per id. Use the v1 tokens: `--cave --rock --rock-2 --rock-3
--line --line-2 --gold --gold-hi --gold-lo --ember --moss --ink --ink-dim --ink-faint --r-common --r-rare
--r-epic --r-legendary --radius --font-d --font-b --gut-l --gut-r --safe-b`. One dark theme only. Prefix your
classes (`.lore-…`, `.emb-…`, `.ev-…`, `.st-…`).

Reusable classes: `.card`, `.card.locked`, `.row`, `.grow`, `.name`, `.sub`, `.hint`, `.owned` (big number),
`.big-num`, `.kv` (label/value line), `.sec-head`, `.btn` (`.can` gold = affordable, `.buy` dashed when not,
`.moss`, `.danger`, `.ghost`, `.small`, `.wide`), `.btn-row`, `.bar` (+`.moss`), `.bar-label`, `.seg`,
`.toggle-row`, `.switch`, `.chip`, `.r-common…r-legendary` (sets `--rc`), `.tcard`, `.grid`, `.cost`
(`.c-gold`, `.c-min`, `.short`).

`ui.icons`: `lair brood quests hoard legend moon ember flame gear chest lock check star scroll chart sound
mute clock auto volcano snow wave plus back` (24×24 stroke SVG strings, currentColor; set the size with CSS).

Helpers (same as the v1 panels):

```js
ui.el(tag, cls, text)                 ui.add(parent, ...children)
ui.button(cls, label, onClick)        // single action (click)
ui.bindHold(btn, fn)                  // press-and-hold repeat buy; fn() returns true if it bought. USE FOR ALL REPEATED BUYS.
ui.buyButton()                        // .btn.buy with b.l ('Buy') and b.s ('×1') spans; use with bindHold
ui.amtToggle()                        // ×1/×10/Max segmented control bound to state.settings.buyAmt; .patch(state)
ui.buyAmt(state)                      // 1 | 10 | 'max'
ui.costLine()                         // .patch(gold, haveGold, minTier, minions, haveMinions)
ui.bar(cls)                           // bar with .fill;  ui.setW(bar.fill, frac)
ui.secHead(title, aside?)             ui.kv(label, valueEl)
ui.toggle(label, get(s), set(s, v), sub?) -> { row, sw, patch(s) }
ui.milestoneBits(row, host) / ui.milestonePatch(row, kind, owned)
ui.setText(n, s) ui.setCls(n, cls, on) ui.setHidden(n, h) ui.setDis(n, d)   // cached: no DOM write if unchanged
ui.buzz(ms)                           // haptics, respects the setting
ui.multStr(m) ui.clock(sec) ui.plural(n, one, many) ui.num(x) ui.reducedMotion()
ui.copyText(text, textareaFallback?, okToastTitle?)   // clipboard in the click, textarea fallback
ui.state()  ui.currentTab()  ui.setTab(id)  ui.refresh() /*rebuild everything*/  ui.markDirty() /*patch next frame*/
```

Hold-to-buy example (kilns):

```js
var b = ui.buyButton();
ui.bindHold(b, function () { var s = ui.state(); return HOARD.ember.buyKiln(s, k, ui.buyAmt(s)); });
```

---

## 4. Cave (`HOARD.cave`)

```js
HOARD.cave.addLayer({ id, z, draw(ctx, w, h, t, dt, state) })   // re-adding an id replaces it
HOARD.cave.removeLayer(id)
HOARD.cave.addSfxHook(fn(name, data))
HOARD.cave.anchor(name) -> { x, y, cx, cy }
HOARD.cave.metrics() -> { w, h, dpr, unit, dk, baseY, peakY, pileW, pileH, coinR, reducedMotion, inited }
HOARD.cave.float(x, y, text, big?, color?)    // floating label like the "+1.2K" numbers
HOARD.cave.burst(x, y, n, 'star'|'spark')     // particle burst (pooled, capped)
```

- **Layers**: `ctx` is already scaled to CSS px (0..w, 0..h) and includes screen shake. `t` = cave clock
  (s), `dt` = frame dt (≤ 0.1). `state` may be null. `z < 0`: drawn after the hoard pile, **behind** the
  dragon, kobold and coins (Ember in its side nook: `z: -1`, use `anchor('nookL')`). `z >= 0`: drawn in front
  of dragon, coins and particles, below the swipe trail, numbers and banners. Each draw is wrapped in
  save/restore and try/catch (switched off after 5 throws). Budget: under 0.5 ms per frame. No per-frame
  allocation in loops; cache gradients/paths; respect `metrics().reducedMotion`. The canvas is redrawn every
  frame (no persistence between frames).
- **Sfx hook names**: `'coin' {n, streak}` (coins collected by swiping this frame), `'streakUp' {mult}`,
  `'gust' {n}` (coins swept by the gust), `'treasure' {kind}`. Plus engine events for everything else
  (`buy`, `rank`, `sleep`, `chest`, `lore`, `myth`, `card`, …). Throttle the coin sound yourself
  (≤ 12/s, as SPEC-V2 4 says).
- **Anchors**: `'hoard'` (top of the pile), `'dragon'` (dragon's eye), `'floor'`, `'nookL'` / `'nookR'`
  (left/right floor nooks clear of the pile), `'streak'` (streak meter), `'finger'` (current touch, else
  center), `'gustBtn'` (Gust button center). `x,y` are canvas-local CSS px. `cx,cy` are viewport coordinates.
- The cave stays v1 for swiping: never add tap targets to the canvas.

---

## 5. Playtest log (`HOARD.log`, js/log.js — foundation)

```js
HOARD.log.event(type, data)                // append { t: epochMs, k: type, g: gameTime, d: data }; data JSON-safe, ≤600 chars
HOARD.log.addAffordable(name, fn(state) -> bool)   // tells the "stuck" detector something of yours is affordable
HOARD.log.entries() / .count() / .text(n) / .totals()
```

- LORE should register `addAffordable('lore', s => anyLoreNodeAffordable(s))`: "stuck" means active, and
  nothing affordable among buildings, minion tiers 1–4 (Eggs never count), upgrades and registered checks
  for more than 90 s. It is logged once, with its duration, when it ends.
- Logged automatically: session start/end/resume (a new session after 5 min hidden), migrate, offline
  returns, snapshots every 5 min of active play (gold, gps, rank, earnedRun, legend, legendPts, sleeps),
  first purchase of each building/tier per run, upgrades, rank, unlock, milestone, chest, sleep, lore, myth,
  event, and a **run summary** at each Sleep/Ascend (`'run'`: active vs wall seconds, Legend gained, rank,
  earned, building counts, lore bought this run).
- Active seconds = page visible and input in the last 60 s. Swipe seconds = finger down and moving on the cave.
- Storage: localStorage `hoard.log.v1` (last 600). Cloud: `playtest/s<startEpochMs>` docs
  `{ startedAt, updatedAt, version, part, entries ≤250, totals }`, then `…-2` and on. One write at a time,
  at most every 120 s if changed, plus on hide. Writes only after main.js hands over the resolved db; never
  on load; nothing without `window.claude`.
- Settings row "Play log" (order 70): count, the last 50 lines, and "Copy log".
- Publish capabilities: `{ db: { rules: [ { path: "playtest", read: "owner", write: "owner" } ] }, user: {} }`.

---

## 6. Gotchas checklist

- Engine-side modules must load in Node: no `window`, `document`, `localStorage` or `Audio`. Use `globalThis`.
  `tools/save-compat.cjs` loads lore/events/ember in Node and replays the v1 fixtures through them.
- Never call stats-reading engine functions inside a mod source or card `mod` (infinite recursion).
- After changing something a mod source reads outside a tick, call `E.dirty()`.
- Never `Math.random` for schedules (events) or mission-like generation. Use `E.util.hash32(a, b)` or dates.
- Do not keep references to `state` across frames. Use `ui.state()` / `HOARD.state` / the `state` argument.
- Every stored number goes through `E.util.pos`/`cl`. `JSON.stringify` turns Infinity into null, and the
  sanitizer then zeroes it.
- Gold rewards go through `E.earn` (counts toward Legend). Spending `legendPts`/`mythPts` goes through
  `E.spend(s, 'legendPts', cost)`, then emit your event.
- Auto-buyers: in tick hooks, throttle live (≈2×/s) and never fight the player's hold-to-buy (skip a step if
  the player bought in the last second if you need to).
- Keep UI patches cheap. `upgradeList` and `buildingMax` are fine at 5×/s; avoid per-frame DOM work.
- Text: no emoji; use "×" for multipliers like the v1 UI; numbers through `HOARD.fmt` / `fmtRate` / `fmtTime`.

## 7. Tests and tools

```
node --check js/*.js
node tools/engine-selftest.cjs           # engine unit checks + pacing (SLEEP=1 for sleeps)
node tools/sim.cjs [hours] [profiles]    # v1 balance sim (unchanged numbers in v2 foundation)
node tools/save-compat.cjs               # v1 fixtures -> v2 (+ all engine-side modules), garbage/future saves
node tools/gen-v1-fixtures.cjs           # regenerate tools/fixtures/v1-*.json from git main's v1 engine
node tools/build-dev.cjs && NODE_PATH=/opt/node-tools/node_modules node tools/smoke.cjs   # phone smoke test (writes screenshots)
```
