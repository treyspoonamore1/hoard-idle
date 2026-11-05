# Hoard v2 — spec

Read `SPEC.md` first (v1 contract, still valid unless overridden here). v2 answers the player's feedback:
> "Timing was fine. I stopped once I reached the first Sleep, since Legend only gives a percentage and no other upgrades."

So the headline of v2: **Legend becomes a currency you spend on a Lore tree** — automation, head starts, power, unlocks — with a second prestige layer (Myth) above it, a second dragon (Ember), limited-time event lairs, sound, a stats page, safe save migrations, and a private playtest log Claude can read to tune balance.

> **Mines pass A (trim), 2026-11** — see `SPEC-MINES.md` SPEC A. Ember (section 2) and the event lairs (section 3)
> are retired and merged into the Mines (`js/mines.js`, `js/ui-mines.js`); old saves are converted once on load.
> In the Lore tree, Glittering Halls and Fertile Clutches merged into Dragon's Hunger (id `greed`), Kobold Haggling,
> Remembered Claws, Loyal Brooms and Nest Egg are cut (Legend refunded), Wake Ember is now **Call the Deep** and
> Ember's Brood is **Deep Veins**. Ranks 7..12 no longer give +5% gold/s. Rows below that changed are marked.

Hard rules (unchanged from v1): swipe, never tap-spam; press-and-hold for repeated buys; no emoji; no alert/confirm/prompt; plain classic scripts on `window.HOARD`; engine-side code runs in Node (no DOM); never NaN/Infinity; single deliberate dark theme with the v1 tokens.

---------------------------------------------------------------------------

## 0. Architecture for v2 (FOUNDATION implements, everyone else uses)

New files, loaded in this order in `index.html` (classic `<script src>`):
```
js/data.js  js/engine.js                       (v1, extended by foundation)
js/lore.js  js/mines.js  js/sky.js            (engine-side feature modules; Node-safe)
js/log.js   js/sound.js                        (browser modules; guard DOM/Audio)
js/cave.js  js/ui.js                           (v1, extended by foundation)
js/ui-lore.js  js/ui-mines.js  js/ui-stats.js  js/ui-sky.js   (UI feature modules)
js/main.js
```
Feature agents own only their files. Foundation creates every file above as a stub (`'use strict'` IIFE, no-op) so the page loads at every stage.

### 0.1 Modifier pipeline (engine)
Every bonus source (cards, upgrades, legend, lore, myth, ember, event cards) feeds `stats()` through one pipeline:

```js
HOARD.engine.addModSource(name, fn)   // fn(state, M) mutates accumulator M; called on each stats() recompute
```
`M` starts as:
```js
{
  gpsMult: 1,              // all building gold/s
  buildingMult: {},        // id -> mult
  tierMult: [1,1,1,1,1],   // minion production per tier
  coinMult: 1,             // coin worth (flat part AND gps part)
  strokeMult: 1,
  costMultBuilding: 1,     // gold cost of buildings (≥0.05 clamp)
  costMultTier: 1,         // gold cost of minions
  legendGainMult: 1,
  offlineCapAddH: 0,
  offlineMult: 1,
  streakHigh: false,       // unlocks ×8 cap
  streakRamp: 1,           // >1 = reach streak levels faster (divides thresholds)
  treasureFreq: 1,         // >1 = more often
  frenzyDurAdd: 0,         // seconds
  gustCdMult: 1,           // <1 = faster recharge
  gustMult: 1,
  chestCardsAdd: 0,
  sweepMult: 1
}
```
The engine applies M everywhere the v1 code used card levels/upgrades/legend directly (refactor v1 card/upgrade/legend/rank bonuses into mod sources so behavior is unchanged for v1 content — verify with the v1 sim numbers before/after). Cache stats per `state.time` tick + dirty flag so the pipeline isn't run hundreds of times per frame.

Other engine extension hooks:
```js
HOARD.engine.addTickHook(name, fn(state, dt, isOffline))     // runs inside tick() and inside offline sub-steps (isOffline=true)
HOARD.engine.addSleepHook(name, fn(state, prevSnapshot))     // after Long Sleep reset; modules restore what they keep
HOARD.engine.addStateDefaults(name, fn() -> object)          // registers state[name] subtree default; sanitize/deserialize fill it; serialize includes it
HOARD.engine.registerCards(list)                              // append cards (events), rebuild indexes; cards may carry `mod(state, M, level)` to contribute
HOARD.engine.flag(state, key) / setFlag(state, key, v)        // tiny shared flags (state.flags)
HOARD.engine.version                                          // 2
```
Engine events (existing `on/emit`) gain: `'buy'({kind,id,n})`, `'lore'({id,level})`, `'myth'(gained)`, `'event'({type,...})`, `'gust'`, `'coin'(n)` (throttled by caller), `'save'`.

### 0.2 Save versioning (CRITICAL — the player has a live save)
- `state.v = 2`. `deserialize` runs a migration chain `MIGRATIONS[1](s) → v2`, etc. Unknown higher versions load best-effort without throwing.
- **v1 → v2 migration**: keep everything; add `legendPts = legend` (spendable points equal to Legend already earned — the player sitting at their first Sleep must be able to spend immediately); add `lore: {}`, `myth: 0`, `mythPts: 0`, `relics: {}`, `myths: 0`, `flags: {}`, `auto: {}` toggles, and module subtrees via `addStateDefaults`.
- **Never change** the localStorage key `hoard.save.v1` or the cloud doc path `data/users/<id>/save`. Before the first save after a migration, main.js copies the pre-migration JSON to localStorage `hoard.save.backup.v1` (once).
- Quests (rank-gate fix 2026-11, see SPEC.md "Missions & Dragon Rank"): `state.missionPace` (new core number, 0 = not measured) and optional mission fields `T`, `t0`, `t1` load when present; missions without them are legacy and an oversized legacy activity quest is re-sized on load (`tools/fixtures/v2-player-rank5-coins.json`: the player's Sleep-11 save with two coins quests in the slots).
- `tools/save-compat.cjs`: fixtures generated by running the **v1 engine from git `main`** (`git show main:js/data.js`, `git show main:js/engine.js`) to (a) fresh, (b) mid-run rank 4, (c) Sleep-ready (earnedRun ≥ 1e7), (d) post-first-Sleep (legend ≥ 3); save to `tools/fixtures/v1-*.json`; assert the v2 engine loads each with gold/buildings/tiers/cards/legend/rank preserved and `legendPts === legend`. Also a garbage/empty/future-version load test.

### 0.3 UI extension API (ui.js)
```js
HOARD.ui.addTab({ id, label, icon /*inline svg string, currentColor*/, order, visible(state)->bool,
                  build(panelEl, state), key(state)->string /*rebuild when changes*/, patch(state, stats) /*≤5×/s*/ })
HOARD.ui.addSection(tabId, { id, order, visible(state), build(hostEl, state), key(state), patch(state, stats) })
HOARD.ui.addSetting({ id, order, build(hostEl, state) })        // rows in the settings area
HOARD.ui.addChip({ id, order, visible(state), text(state, stats), onPress })   // top-bar chips (e.g., event timer)
HOARD.ui.sheet(node, opts) / closeSheet() / toast(title, text, kind) / ask(title, text, yesLabel, noLabel) -> Promise<bool>
HOARD.ui.button(cls, label, fn) / bindHold(btn, fn) / el(tag, cls, text) / bar(cls) / costLine()…  // export the v1 helpers
HOARD.ui.css(cssText)                                           // inject module CSS once (uses v1 tokens)
HOARD.ui.icons                                                  // small svg strings (existing tab icons + any new)
```
- Rename the v1 **Sleep** tab to **Legend** (id `legend`, moon icon stays). Its v1 content (Long Sleep panel) becomes section `sleep` (order 10). The v1 settings content moves to a **Settings sheet** opened from the top-bar gear (the gear exists already) — settings rows come from `addSetting` plus the v1 rows.
- Tab bar holds up to 6 tabs and must look good at 360px with 6 (icons + short labels).
- v1 tabs become registered tabs through the same API (so ordering is uniform).

### 0.4 Cave hook (cave.js)
```js
HOARD.cave.addLayer({ id, z /* <0 behind dragon, >0 in front */, draw(ctx, w, h, t, dt, state) })
HOARD.cave.addSfxHook(fn(name, data))   // cave calls with 'coin'{n,streak}, 'streakUp'{mult}, 'gust', 'treasure'{kind}
HOARD.cave.anchor(name) -> {x, y}       // 'hoard', 'dragon', 'gustBtn' positions in CSS px
```

### 0.5 Playtest log (js/log.js — FOUNDATION)
Purpose: let Claude tune balance from the player's real sessions.
- `HOARD.log.event(type, data)`; auto-subscribes to engine events: rank, sleep, myth, lore, unlock, milestone, buy (first purchase of each building/tier only), event start/finish, chest.
- Tracks per session: start time, active seconds (page visible AND input within last 60s), swipe seconds, idle seconds, **stuck intervals** (active, and nothing affordable among buildings/tiers/upgrades/lore for > 90s → log once with duration when it ends), gold/gps/rank snapshot every 5 min of active play, session end on `visibilitychange` hidden (with totals).
- Run summary on each Sleep: run duration (active vs wall), legend gained, rank reached, building counts, which lore bought.
- Storage: localStorage ring buffer `hoard.log.v1` (last 600 entries) + cloud db doc per session `playtest/s<startEpochMs>` with `{ startedAt, updatedAt, version, entries:[≤250], totals }` (new doc `…-2` when full). Cloud writes ≤ every 120s if changed and on hidden; one write at a time; only after the db resolves; never on load; works with no `window.claude`.
- DB rules (declared at publish; foundation documents them): `{ db: { rules: [ { path: "playtest", read: "owner", write: "owner" } ] }, user: {} }`.
- Settings row "Play log": count of entries, a scrollable list of the last 50 (plain text), "Copy log" button (clipboard in click, textarea fallback).

---------------------------------------------------------------------------

## 1. Lore tree & Myth (LORE agent: `js/lore.js`, `js/ui-lore.js`)

### Legend economy
- `state.legend` = Legend earned in the current Myth (drives the existing passive bonus: **+10% each**, unchanged — spending never lowers it).
- `state.legendPts` = spendable. Long Sleep adds gained to both.
- Legend gain formula unchanged (×`M.legendGainMult`). First Sleep ≈ 3–4 Legend: **the first lore nodes must cost 1–2** so the first Sleep immediately offers 2–3 real choices.

### Lore nodes (`state.lore[id] = level`)
Four branches; show as a vertical list grouped by branch with prerequisites (locked nodes show the requirement). Multi-level nodes: cost × growth per level.

**Automation** (kept forever, even through Myth):
| id | name | cost | effect |
|---|---|---|---|
| auto_dig | Kobold Foremen | 2 | Auto-buys Kobold Diggers when affordable. In offline catch-up, while the lair has no income at all (no buildings, no brooms: a fresh run without starting gold), they gather 25% of the spilled coins so automation can buy the first building |
| auto_build | Master Builders | 8 (req auto_dig) | Auto-buys every unlocked building (per-building on/off toggles in Lair rows) |
| auto_brood | Brood Matron | 5 | Auto-buys minions (per-tier toggles in Brood); never spends more than 50% of current gold per second on minions |
| auto_quest | Quest Scribe | 4 | Auto-claims finished quests |
| auto_chest | Chest Kobold | 3 (req auto_quest) | Auto-opens chests (quiet toast summary) |
| auto_gust | Restless Wings | 6 | Gust fires by itself when charged and ≥ 8 coins are on screen (or after 10s) |
| auto_upg | Lair Steward | 12 (req auto_build) | Auto-buys Lair upgrades |
| auto_sleep | Dream Keeper | 30 (req auto_upg) | Optional toggle: take the Long Sleep automatically when Legend gain ≥ X% of current Legend (slider 50–300%) AND the run has lasted at least twice its warm-up W and at least 90 s (W = run time, active + caught-up away time, at which the run first could Sleep; the 90 s floor covers an Ancestral Lair start, which is past the threshold at ~10 s and otherwise slept every 15-40 s). With little Legend (a fresh Myth) the gain rule is met at the threshold itself, so the warm-up rule decides; late in a Myth W is seconds and the gain rule decides. Offline, any automation asks the engine for 30 s sub-steps (`E.addOfflineStepHook`; 8 h = 960 steps instead of 200 of 144 s), and while away at rank 1 (Eggs only) Brood Matron also buys toward an open "Own N Eggs" quest (nobody else can; such a quest plus a swipe quest left a rank-1 run stuck all night). Legend after an 8 h night on the live save no longer swings 1.5K..9K with the hours away. The welcome-back sheet says how many Sleeps Dream Keeper took and for how much Legend |

Automation runs in `addTickHook` (also offline, so idle progress uses it), with a global "Automation on/off" master toggle at the top of the Legend tab and a small top-bar chip "Auto" when anything is active.

**Head start** (reset by Myth):
| id | name | cost / levels | effect |
|---|---|---|---|
| start_gold | Buried Cache | 1, 4, 15, 60 (4 lv) | Start each run with 500 / 50K / 5M / 500M gold |
| ~~keep_claws~~ | ~~Remembered Claws~~ | 3 | **cut in the Mines pass** (Lair Steward re-buys upgrades; 3 Legend refunded) |
| ~~keep_broom~~ | ~~Loyal Brooms~~ | 3 | **cut in the Mines pass** (3 Legend refunded) |
| start_rank | Old Renown | 5, 25 (2 lv) | Start each run at Dragon Rank 3 / 5 |
| ~~start_brood~~ | ~~Nest Egg~~ | 4, 20 (2 lv) | **cut in the Mines pass** (4 / 24 Legend refunded) |

**Power** (reset by Myth; multi-level, cost growth ×2.2):
| id | name | base cost, max lv | effect per level |
|---|---|---|---|
| greed | **Dragon's Hunger** (Mines pass) | 5, 15 (×4 per lv) | coin worth, building gold/s and minion output ×(1 + 0.25·lv); loads as max(greed, halls, clutches) |
| ~~halls~~ | ~~Glittering Halls~~ | | merged into Dragon's Hunger |
| ~~clutches~~ | ~~Fertile Clutches~~ | | merged into Dragon's Hunger |
| talons | Steady Talons | 3, 3 | streak ramps 1.5×/2×/2.5× faster; lv1 unlocks ×8 cap |
| magpie | Magpie Instinct | 3, 4 | treasures +25% more often per lv; Frenzy +8s per lv |
| dreams | Deep Dreams | 6, 6 | Legend gain +20% per lv |
| watch | Long Watch | 2, 4 | offline cap +4h per lv, offline gains ×1.15 per lv |
| ~~bargain~~ | ~~Kobold Haggling~~ | 4, 5 | **cut in the Mines pass** (all Legend refunded) |

**Unlocks**:
| id | name | cost | effect |
|---|---|---|---|
| wake_ember | **Call the Deep** (was Wake Ember) | 12 | Opens the Mines now, without waiting for Dragon Rank 7 |
| myth_gate | The First Myth | 40 | Unlocks the Myth layer (Ascend) |

### Myth (second prestige layer)
- Available when `myth_gate` owned and Legend this Myth ≥ 150. Myth gained = floor( sqrt(legend / 40) ) × relic bonus.
- **Ascend**: resets everything a Long Sleep resets, plus `legend`, `legendPts`, all non-automation lore. Keeps: automation lore, cards, chests, Ember (awake, but its hoard resets to 25%), myth, relics, events, stats.
- Each Myth: all production ×1.5 (multiplicative: `1.5^myth`, via mod source). `state.mythPts` spendable on **Relics** (`state.relics[id]=lv`):
| id | name | cost | effect |
|---|---|---|---|
| r_legend | Saga Stone | 1, 3, 9 (3 lv) | Legend gain ×2 per lv |
| r_start | Ancestral Lair | 2 | Each run starts with 10 of every unlocked building and rank 5 |
| r_keep | Unfading Lore | 3 | Keep 25% of Power-branch lore levels (rounded down) through Ascend |
| r_cards | Gilded Chests | 2 | Chests give +1 card |
| r_ember | **Deep Veins** (was Ember's Brood) | 2 | Miners dig ×3 |
| r_time | Timeless Sleep | 4 | Offline cap +12h, offline gains ×2 |
- Pacing targets (active-ish player with sensible lore buys): Sleep 2 ≈ 20–25 min after Sleep 1, sleeps 3–6 each 12–20 min, Myth 1 available ≈ 3–5 h total play; Myth 2 within ~1.5 h after Myth 1. Every Sleep must give at least one meaningful purchase.

### UI (ui-lore.js)
- Legend tab sections: header with Legend (spendable / earned / passive bonus), Long Sleep panel (v1 section), **Lore** list by branch (node card: name, effect now → next, cost, Buy button gold when affordable; prerequisites dimmed with "Needs Kobold Foremen"), Myth panel when gated/available, Relics list.
- Lair/Brood row toggles for auto-buy (small switch "Auto" per row, visible only when the node is owned) via `addSection` patches or row hooks — coordinate through `HOARD.ui` APIs; if a row hook is needed, foundation provides `HOARD.ui.addRowExtra(kind /*'building'|'tier'*/, fn(rowEl, id, state))`.
- A one-time callout after the first Sleep: sheet "Spend your Legend" pointing to Lore.

---------------------------------------------------------------------------

## 2. Ember, the second dragon — RETIRED (merged into the Mines, `SPEC-MINES.md` A1)

Kept for history. `js/ember.js` is gone; Ember stays in her nook (`js/ui-mines.js` layer) and wakes when the Mines
open. Saves convert once: embers / 5 → Ore, lifetime embers → Ember's Hearth (the old warmth, frozen), Breaths →
Forge levels, kilns → Pick Crews. `state.ember` stays in the save as an archive.

- Unlocked by lore `wake_ember`. State subtree `state.ember` via `addStateDefaults`.
- Ember is a small ember-red fire dragon who sleeps in a side nook of the cave (draw via `HOARD.cave.addLayer`, z<0, left side; breathes tiny sparks; wakes animation when unlocked).
- **Embers** (currency) are produced by **Ember's Kilns**: 4 kiln types bought with embers (cost growth 1.18): Coal Kiln, Bellows, Magma Vent, Sunfurnace (base ember/s 1, 8, 70, 650; costs 10, 150, 2.5K, 45K).
- Swiping feeds Ember too: every coin you collect also adds `0.02 × kilnPower` embers (shown subtly), so active play matters.
- **Ember's Hoard bonus** to the main game: `gpsMult × (1 + 0.15 · log10(1 + embersEarned)^1.6)` and coin worth × the same (mod source). Show "Ember's warmth: ×3.4 gold" in UI.
- **Fire Breaths** (one-time upgrades bought with embers, ~8): e.g. Kindle (kilns ×2), Searing Gust (gust gold ×2), Ember Treasures (treasures also give 60s of ember production), Molten Coins (stroke worth ×2), Smoulder (offline embers ×2), Fire Frenzy (Frenzy ×1.5).
- Ember persists through Long Sleep; Ascend (Myth) keeps it awake but resets embers/kilns to 25%.
- UI: a 6th tab **Ember** (flame icon, inline svg), visible only when awake: Ember's warmth header, kilns list (hold-to-buy, ×1/×10/Max reuse), Fire Breaths.
- Offline: kilns produce offline (tick hook).
- Pacing: Ember's bonus should feel worthwhile within 10 minutes of waking (≈×1.5) and grow to ×5–×20 over a few hours.

---------------------------------------------------------------------------

## 3. Event lairs — RETIRED (`SPEC-MINES.md` A2)

Kept for history. `js/events.js` / `js/ui-events.js` are gone; the 9 cards are registered by `js/mines.js` as Deep
cards (same ids and powers). Saves convert once: unopened chests and a finished-but-unclaimed step pay their cards,
each quest step claimed is worth 500 Ore. `state.events` stays in the save as an archive.

- Unlock at Dragon Rank 3 of any run (or if `state.sleeps ≥ 1`). Three lairs rotate on a wall-clock schedule anchored to UTC dates: each lair runs **72 hours**, then 24 h break, then the next lair (Volcano Lair → Frozen Peak → Sunken Ship). For the player's first unlock, start the current lair immediately (store `state.events.firstStart`) so they don't wait.
- Each lair has its own currency and a 4-tier AdCom chain (tier 1 makes currency; tier k makes tier k-1), bought with event currency only (each unit's price rises geometrically with the number of that tier bought; units made by the tier above are free and never raise prices), its own 10-step quest line (fixed sequence; claim → event chest), and **3 exclusive cards** per lair (9 total, registered with `registerCards`, rarity epic/legendary-ish, each with a `mod` contributing a permanent bonus, e.g. "Obsidian Heart: all gold ×(1+0.3·lv)").
  - Volcano Lair: currency Obsidian; Magma Imps → Lava Hounds → Fire Giants → Volcano Wyrm.
  - Frozen Peak: currency Frost Shards; Snow Kobolds → Ice Trolls → Frost Wyverns → Glacier Wyrm.
  - Sunken Ship: currency Pearls; Crab Divers → Sea Serpents → Kraken Mates → Abyssal Wyrm.
- Event production continues offline (tick hook, only within the event window). Event state resets when a new lair starts; cards stay.
- Swiping in the cave during an event adds a small amount of event currency per coin and starts a **swipe rush**: the whole lair brood works ×25 as fast until 20 s after the last swiped coin (live play only; offline production runs at normal speed). Only the player's own swipes start it (coins from Restless Wings' auto-gust do not), and while the lair sheet is open it runs down 4× slower, so a shopping trip keeps it. An active player finishes the quest line in a few hours; a casual 4 × 5 min/day player in about two days.
- Completing the whole quest line in 72h should be achievable with ~3–5 short check-ins per day.
- UI: top-bar chip "Volcano Lair · 2d 14h" (or "Next lair in 6h") → opens a full-height sheet with the lair view (chain, quests, cards). Also a banner at the top of the Quests tab. Lair sheet tinted with its theme color (volcano ember-orange, frost pale-blue, sea teal) derived from tokens.
- `state.events` subtree via `addStateDefaults`. Never use `Math.random` for schedule; use dates.

---------------------------------------------------------------------------

## 4. Sound & stats (POLISH agent: `js/sound.js`, `js/ui-stats.js`, and small sfx hook calls)

- WebAudio, synthesized (no files): soft coin clink (throttle ≤ 12/s, pitch rises with streak), streak level-up chime, gust whoosh (filtered noise), treasure sparkle arpeggio, buy thunk (quiet), rank-up fanfare (3 notes), Long Sleep low pad, chest open + rarity chime per card, lore purchase chime, Myth ascend swell.
- AudioContext created/resumed on first pointerdown (autoplay policy). Master volume default 40%, settings rows: Sound on/off, volume slider (`addSetting`). Respect page hidden (suspend context).
- Hooks: subscribe to engine events and `HOARD.cave.addSfxHook`.
- **Stats** (`ui-stats.js`): a settings row "Stats" opening a sheet with lifetime stats: total gold earned, coins swiped, distance swiped (CSS px → meters at 96 px/in), treasures, gusts, best streak, Long Sleeps, Myths, fastest Sleep (active time), total play time (active), cards collected X/29, current multipliers breakdown (from `stats()`/M: legend, myth, ember, cards, lore). Needs engine to track `stat.playActive`, `stat.fastestSleep` — foundation adds these fields.

---------------------------------------------------------------------------

## 4b. Starfall + Growth (slice 1: `js/sky.js`, `js/ui-sky.js`, small hooks in `js/cave.js`)

Every check-in gets a short swiping activity that automation cannot do. Starfalls charge over time; one deliberate
press on the cave's **Stars** button (or "Start Starfall" in the Hoard tab) starts 25 s of falling stars caught by
swiping. Stardust from them grows the dragon through 8 stages. **No gold, Legend or card power**: no mod source, no
cards, never `E.earn`, and **caught stars pay no gold**. The normal coin spill keeps running while stars fall (the
same swipes still sweep coins), so a Starfall is gold-neutral by design, not by tuning (review round 1: 2-3 coins per
star with the spill paused moved casual5's Ascend 1 by +11.6% and single moderate seeds by ±18%).

**State** `state.sky` (addStateDefaults, sanitized): `{ on, xp, ch, at, n, caught, stars, best, bestPct, capAt,
eCaught, lant, lit, gift }`. The stage is derived from `xp`. A running Starfall is `s._skyRun` (never saved).
Unlock: first Long Sleep, an Ascend or rank 4 (live save: opens on load with the 2-Starfall gift).

| # | Stage | Stardust | Starfall after reaching it (cumulative) | Look (dragon scale + decoration) |
|---|---|---|---|---|
| 1 | Hatchling | 0 | 25 s, cap 4, one per 30 min, 1.4 stars/s, twins 15%, no comet | ×1.00 |
| 2 | Fledgling | 100 | 1 comet | ×1.04 |
| 3 | Juvenile | 600 | cap 5 | ×1.08, longer horns |
| 4 | Young | 2,000 | 30 s | ×1.12, wing spines |
| 5 | Adult | 6,000 | 2 comets, twins 25% | ×1.16 |
| 6 | Great | 15,000 | one per 25 min | ×1.19, glowing belly scales |
| 7 | Elder | 35,000 | cap 6 | ×1.22, golden frill |
| 8 | Ancient | 75,000 | every 5th is a Grand Starfall: 45 s, 2.2 stars/s, Stardust ×1.5 | ×1.25, crown of stars |
| – | Star Scales | +25,000 each | cosmetic pips | – |

**Scoring** (per caught star, in the UI): combo +1; value `1 + min(4, floor(combo/6))`; a twin pair caught in one
stroke counts its two values again. A star that reaches the hoard halves the combo (a full reset made values above
1 rare for anyone not aiming perfectly). A comet followed for 160 px (swipe segments within 40 px of its body, head to
120 px down its tail, direction cos ≥ 0.6) is ridden (+15), so chasing it works as well as overtaking it; touched but
not ridden is a graze (+1). The first comets show "Swipe along the comet" until one is ridden (flag `skyRide`).
`finish` clamps everything (total ≤ maxStars, base ≤ 10·caught, rides ≤ comets ...), then
`dust = round((base + 15·rides + cuts) × (1 + 0.1·clamp(rank − 6, 0, 6)) × (1 + 0.08·lanterns) × (grand ? 1.5 : 1))`
and spends exactly one charge (start never spends; abort spends and gives nothing).

**Ember watches the sky**: while the Starfalls sit at the cap and the Mines are open (Ember is awake at the Forge), she catches a falling star (+10
Stardust) every charge period, at most 4 per at-cap stretch, live or away (capAt is worked out from the accrual, so
time away counts the same). **First Light**: the first time each Myth a run reaches ranks 7..12: +40·(rank − 6)
Stardust (840 per Myth); a Long Sleep keeps it, an Ascend resets it. The rank box says "First Light: +40 Stardust,
and brighter skies: +10% Stardust." when the next rank is 7+ and not yet lit this Myth (else just the brighter skies). **Sky Lanterns** (Mines tab since the Mines pass): 100K / 1M / 10M / 100M / 1B Ore (were 2M..1.25B embers); each +8% Stardust and
stars fall 3% slower (Starfall only; spends `mines.ore`, never lifetime Ore, so the Forge glow is unchanged). One level
per deliberate press (a hold does not repeat: five expensive one-off levels).

**UI**: launcher `#skybtn` (52 px, above Gust; "Stars 2/4", "in 14m", "18s ×12" while running, soft glow when full;
`pointer-events: none` while stars fall); cave layers `skynight` (z −2, night tint) and `sky` (z 1: stars, twin
threads, comets, progress line, combo above the finger, "Grand Starfall" banner, first-time hint); score sheet
(caught, best combo, comet Ridden / Grazed / Missed (no row without a comet), twin pairs, Stardust with the
multiplier reason, animated growth bar, stage-up line, Again / Close; its backdrop ignores presses for 0.7 s; if
another sheet is open at the end, a toast sums the Starfall up instead of replacing it); Hoard tab section "Night Sky"
(order −10, dot badge when full); Mines tab section "Sky Lanterns" (order 80). While stars fall, every toast except
the sky's own waits in the queue (`ui.holdToasts`) and the streak meter / rush pill dim to 30% (`cave.setHudDim`),
so the top of the cave where stars enter stays clear. The welcome-back sheet gets a "Night sky:" line (Starfalls
ready, Ember's catches, growth, First Light while away). Safety: the `sky` layer never throws (an error aborts the
Starfall, nothing spent) and a watchdog aborts a Starfall whose clock stopped for 2.5 s while visible. A swipe that
starts on the launcher and slides more than 8 px does not start a Starfall.
Growth: `cave.setDragonScale(stage scale)` and `cave.setDragonDecor(fn)` (decorations drawn in the dragon's own
transform so they follow its hop and head turn). Aborts (nothing spent): page hidden, state replaced, Ascend. A Long
Sleep mid-Starfall does not abort (the rank bonus uses the higher of the start and finish rank).

**Log**: `starfall_start {ch, stage}`, `starfall {caught, total, best, dust, rides, twins, sec, stage, rank, grand,
ch}`, `starfall_abort {why, sec}`, `sky {type: open|stage|light|lantern|ember, ...}`, `skyopen {ch, cap}` at session
start (and on return after 5+ min hidden).

### Pacing gate (tools/sim-lore.cjs, `EMBER=1`; moderate 8 h seeds 1-6, casual5 10 h seeds 1-3)

Round 1 paid 2-3 coins per caught star and paused the spill; that moved single seeds by up to ±18% (casual5 Ascend 1
+11.6%), so round 2 made the Starfall gold-neutral **by design**: stars pay no gold and the spill keeps running.
`STARFALL=1` = the sim player runs a Starfall whenever one is ready while swiping (80% caught, Stardust only).
`SFCOINS=n` / `SFSPILL=1` remain as what-ifs for the round-1 designs.

| run | Sleep 1 | Ascend 1 / 2 / 3 | Myth at the end | quests | Starfall stage at the end |
|---|---|---|---|---|---|
| moderate seeds 1-6, without vs with `STARFALL` | identical | identical | identical | OK | 4 Young on all 6 (2.3-2.9K Stardust, 17 Starfalls) |
| casual5 seeds 1-3, without vs with `STARFALL` | identical | identical (5.00/6.50, 5.50/7.50, 5.00/7.00 h) | identical | OK | 3 Juvenile (1.8-2.0K, 20 Starfalls) |

Every sim-lore output above, minus its one `Starfall:` summary line, is **byte-identical** to the tree before
Starfall (and to the same run without `STARFALL`); `tools/sim.cjs` is byte-identical too. No NaN in any run. The
moderate player never passes stage 5 by 8 h. Dream Keeper's 90 s floor only changes runs with Dream Keeper on
(`AUTOSLEEP=50`, seeds 1-2): Dream Keeper runs under 60 s 32 / 54 -> 0, first Sleep after an Ascend 0.0-0.5 min ->
1.5 min, Ascend 1 1.81 -> 1.75 h and 1.85 -> 1.87 h; quest balance OK.

## 5. Publishing

- Capabilities: `{ db: { rules: [ { path: "playtest", read: "owner", write: "owner" } ] }, user: {} }`.
- Same artifact URL; republish from `/home/user/hoard-idle/index.html` with `url`.
