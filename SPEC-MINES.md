# Hoard — the Mines pass (SPEC-MINES)

The player asked for "multiple layers to keep growing" (parallel producer chains, each new chain paid for with the
earlier chains' output, opened by Dragon Rank) and said: "Don't be afraid to remove things, there is a lot in the
game right now". This pass therefore has two parts:

- **SPEC A (trim): built.** Ember, the event lairs and a handful of Lore nodes are retired or merged. Every bit of
  progress the player put into them is converted, once, into something they keep.
- **SPEC B (the Mines): built.** The Mines chain (Pick Crews → Ore Carts → Tunnel Borers → Deep Delvers), hired
  with Eggs. It produces Ore, which buys Forge levels, Shaft Depth and Sky Lanterns. The numbers were tuned against
  the B12 gates; see "Pass B: what was built" at the end.

Later passes (do not build yet) add a Treasury/Gems chain at rank 9, priced in Ore, and a Sky chain at rank 11,
priced in Gems.

Hard rules: `VERSION` stays 2, the save key `hoard.save.v1`, the cloud path and `js/main.js` are untouched,
`sleepReq` and the Legend formula are unchanged. Swiping stays the core verb, so there is no tap-spam.

---

## SPEC A — Trim (status: done)

### A0. Shared mechanics

- **`E.addLoadHook(name, fn(raw, o))`** (`js/engine.js`, documented in EXTENSIONS.md 2.6b) uses the same upsert
  and guarded pattern as the other hooks. All hooks run at the end of `sanitize()`, after the module subtrees and
  the unknown top-level keys are copied and before the missions are rebuilt. `raw` is the migrated raw save and
  `o` is the sanitized state.
- **Every conversion runs once.** Each is guarded by a flag in `o.flags`, which is set even when there is nothing
  to convert, so loading twice converts once:

  | Flag | Hook | Covers |
  |---|---|---|
  | `minesConv` | `mines` | T1 |
  | `eventsConv` | `events-retire` | T2 |
  | `loreTrim1` | `lore-trim` | T3 and T4 |

- **Archives:** `raw.ember` and `raw.events` survive untouched as unknown top-level keys, so a rollback can still
  read them.
- **Baselines:** `tools/fixtures/baseline-stats.json` holds the pre-trim gold/s, coin worth, stroke worth and
  legendPts of every fixture. They were measured with ember.js and events.js still loaded.
- **New fixture:** `tools/fixtures/v2-player-myth4.json` is the inner `.json` string of the player's live cloud
  save (Myth 4, 43 Long Sleeps, Ember awake with all 9 Breaths, Volcano Lair complete), written verbatim.

### A1. Ember → Mines (T1)

**Removed:**
- `js/ember.js`: kilns, embers, Breaths, the 'ember' mod source and hooks.
- From the Ember UI, renamed to `js/ui-mines.js`:
  - the Ember tab, header, kilns and Breaths;
  - the wake, breath and milestone toasts;
  - the offline ember toast;
  - the swipe-feed motes and the "+embers" cave float.
- `D.kilnMilestones`, `milestoneCountKiln` and the `'kiln'` branch of `milestoneMult` / `nextMilestone`.
- `tools/test-ember.cjs`.

**Kept:** Ember's nook dragon layer, unchanged in look. She is "awake" while `HOARD.mines.isOpen(s)` and tends
the Forge. Ember still catches falling stars while the Starfalls sit at their cap.

**Retargeted (same ids and costs):**

| Kind | Id | New name | Cost | Effect |
|---|---|---|---|---|
| Lore | `wake_ember` | Call the Deep | 12 Legend | "Open the Mines now, without waiting for Dragon Rank 7." |
| Relic | `r_ember` | Deep Veins | 2 Myth | "Miners dig ×3." |

**Sky Lanterns:**
- They move to the Mines tab.
- They cost Ore: 1e5 / 1e6 / 1e7 / 1e8 / 1e9.
- They need the Mines open and spend through `HOARD.mines.spendOre`, which never lowers lifetime Ore.

**Stats rows:** "The Forge" (source `mines`) and "Deep cards" (was "Event cards").

**Sound:** `emberWake` is now `minesOpen`, played on `mines {type:'open'}`.

**Conversion** (load hook `mines`, when `raw.ember.awake === true`):

1. **Open:** `open = true`, `openAt = o.time`.
2. **Hearth:** `hearth = 1 + 0.15·(heart ? 1.25 : 1)·log10(1 + earned)^1.6`, clamped to [1, 1e12]. This is
   exactly the old warmth, frozen.
3. **Ore:** `ore += floor(embers / 5)`. This Ore does not count toward `all` or `peak`, so the Forge glow starts
   at ×1.00.
4. **Forge levels from Breaths:**

   | Breath | Forge level |
   |---|---|
   | `kindle` | `rails` +1 |
   | `wildfire` | `rails` +2 |
   | `molten` | `pans` 7 |
   | `fanned` | `sieve` 4 |
   | `searing` | `anvil` 2 |
   | `etreas` | `seam` 1 |
   | `smoulder` | `night` 1 |
   | `ffrenzy` | `frenzy` 2 |
   | `heart` | `heart` 1 |

5. **Pick Crews from kilns:**
   - `oldRate` = Σ `kiln[k]·base[k]·2^milestones` × (kindle 2) × (wildfire 3) × (`r_ember` 3).
     - `base` = [0.1, 0.8, 7, 65].
     - Milestones are counted at 25/50/100/150/200, then +1 per 100 above 300.
   - `units[0] += round(oldRate / 5 / crewEach)`, where `crewEach = 0.1·2^rails·(r_ember 3)`.
   - The converted crews dig exactly the old ember rate in Ore (5 embers = 1 Ore).
6. **Log:** emits `mines {type:'conv', ore, hearth, crews, forge}`, and the UI also writes it to the play log.

A save whose Ember was not awake gets the flag and nothing else.

### A2. Event lairs retired (T2)

**Removed:**
- `js/events.js` and `js/ui-events.js`.
- The `events` chip, the Quests-tab `eventBanner`, the cave rush pill and the `eventStart` sound.
- The event hooks inside Quest Scribe and Chest Kobold.
- `tools/test-events.cjs` and `tools/test-lair-strategy.cjs`. The price-wall strategy method moves to
  `test-mines.cjs` in pass B.

**Kept:** the 9 cards are registered verbatim by `js/mines.js` as `DEEP_CARDS`, with the same ids, rarity, `mod`
and `describe`, `chest:false` and `event:true`. There are still 29 cards in total. In pass B they drop from Deep
Chests.

**Conversion** (load hook `events-retire`, when `raw.events` is an object):

1. **Unopened chests:** each grants `chestCards[i] || 1` cards from that lair's pool. A chest follows its quest
   step's guaranteed card or "all 3"; any other card is a deterministic, rarity-weighted roll.
2. **A finished but unclaimed step** (q < 10 and its condition is met) grants that step's cards.
3. **Token:** `mines.ore += 500 × q`. It is banked even while the Mines are closed.
4. **What's new:** a one-time toast, "Event lairs have closed. Their cards are now found in Deep Chests in the
   Mines.", shown when the save had `firstStart > 0`.

### A3. Lore Power (T3)

- **`greed` becomes "Dragon's Hunger":** base 5, growth ×4, max 15, per level 0.25. Each level multiplies
  `coinMult`, `gpsMult` and `tierMult[1..4]` by (1 + 0.25·lv). Costs are 5, 20, 80, 320, and so on.
- **Deleted:** `halls`, `clutches` and `bargain`, with `bargain`'s cost multipliers.
- **Conversion:**
  - `greed = max(greed, halls, clutches)`, capped at 15, so no effect ever drops.
  - `legendPts += Σ_{i<bargain} ceil(4·4^i)`.

### A4. Head start (T4)

- **Deleted:** `keep_claws`, `keep_broom` and `start_brood`, plus `CLAW_IDS`, `BROOM_IDS`, `seedBrood`, the
  keep-on-sleep code, the `youngRun` exception and the `ui-lore` dirty-mark.
- **Refunds:** `keep_claws` 3, `keep_broom` 3, `start_brood` 4 (level 1) or 24 (level 2).

### A5. Rank bonus (T5)

- **Deleted:** the +5% gold/s per rank 7..12 (`rankMult`, `D.C.rankGpsAfter` and `rankGpsPer`). The 'rank'
  source keeps only the ×8 streaks.
- **Opening:** rank 7 opens the Mines for good, and Call the Deep opens them earlier. The Mines open with 3 Pick
  Crews.
- **Rank box text:** "Next rank opens the Mines, plus a bonus chest." First Light is unchanged.

### A6. Legend tab: compact automation (T6)

- Owned Automation nodes share one card titled "Automation". Each node is one 44 px row: name, a one-line effect,
  and its toggle.
- Dream Keeper's row toggles Sleep-by-itself, with the slider and a one-line "Now: …" below it.
- Unowned automation nodes keep their full cards.
- On the live save at 360 px the card is 443 px tall (8 rows). Before the trim the owned-automation cards took
  about 1,465 px.

### A7. Top bar (T7)

The chips are gold/s, Nest, Legend and Auto. On the live save the last chip ends at x = 344.6 at both 360 and
412 px wide, so it is at most 360 − 8. `smoke.cjs` asserts this.

### A8. Files and loaders

- **Script order:** data, engine, lore, **mines**, sky, log, sound, cave, ui, ui-lore, **ui-mines**, ui-stats,
  ui-sky, main.
- **Loaders updated:**
  - `save-compat`, `sim-lore` (mines.js by default, `NOMINES=1` control, `STARFALL=1` loads sky.js), `test-lore`,
    `test-polish`, `test-sky`, `smoke` and `sim` (mines.js, `NOMINES=1`).
  - `tools/build-dev.cjs` only wraps index.html.

### Pass A results

**Conversions on the fixtures** (asserted in `save-compat.cjs`):

| Save | Hearth | Ore | Pick Crews | Forge | legendPts |
|---|---|---|---|---|---|
| live / myth4 | ×6.9378 | 59,348,483 + 5,000 = 59,353,483 | 1,165 | pans 7, sieve 4, rails 3, anvil 2, seam, night, frenzy 2, heart | 32 → 32 |
| post-ascend | ×6.7529 | 52,937,641 + 5,000 | 1,075 | same | 10 → 10 |
| rank5-coins | ×4.3127 | 877,525 + 4,500 | 1,583 | same, without heart | 1,334 → 2,728 (Hunger 6; refund 1,364 + 30) |
| sleep1 | – (closed) | 2,500 banked | 0 | – | 0 (greed 1, halls 1 → Hunger 1) |
| v1 fixtures | – (closed) | 0 | 0 | – | unchanged |

**Live save after the conversion:**
- Gold/s is unchanged (2.4987e7): glow ×1.00 × Hearth ×6.9378 equals the old warmth.
- Coin worth is 7.946e6 (was 3.876e6) and strokes are 1.192e7 (were 1.163e7): Gilded Pans 7 gives ×2.05, against
  Molten Coins' ×2 on strokes only.
- Owned event-card copies are unchanged (Obsidian Heart 1, Magma Talon 7, Cinder Crown 4).
- The 59.4M Ore lights Sky Lantern 3 straight away.

**Sims** (same seeds, before → after):

`tools/sim.cjs`, first Long Sleep:

| Profile | Seed | Before (min) | After (min) |
|---|---|---|---|
| active | 777 | 26.9 | 26.9 |
| active | 1 | 24.3 | 24.5 |
| active | 2 | 30.4 | 32.7 |
| active | 3 | 24.8 | 24.9 |
| mixed | 777 | 43.4 | 45.0 |
| mixed | 1 | 40.5 | 44.2 |
| mixed | 2 | 43.0 | 41.7 |
| mixed | 3 | 41.5 | 40.9 |

- The mean moves by about +0.6 to +0.9 min, from the cut rank bonus at rank 7.
- With the bonus patched back in, the output is identical, so mines.js itself changes nothing in sim.cjs.

`tools/sim-lore.cjs 4 moderate`, first Ascend:

| Seed | Before (h) | After (h) |
|---|---|---|
| 777 | 2.08 | 2.42 |
| 11 | 2.42 | 2.44 |
| 22 | 2.17 | 2.29 |
| 33 | 2.19 | 2.34 |
| 44 | 2.29 | 2.46 |
| 55 | 2.46 | 2.32 |

- The 5-seed mean of the first Ascend goes from 2.31 to 2.37 h.
- Sleep 1 moves by at most 0.8 min.
- Early Lore is a little slower, because Hunger costs 5 where Greed cost 1. Both are inside the gates (first Ascend
  2.0–3.5 h, mean 2.0–3.0 h).

**Checks across all profiles:**
- No NaN, Infinity or negatives.
- QUEST BALANCE OK.
- Mines open times: moderate 0.54 h, active 0.41 h, casual 2.64 h, casual5 4.50 h.

**Not built in pass A:**
- `E.addMissionTemplate` and the `ore` / `hire` quests (B4, B7).
- Digging, hiring, nuggets, Deep Chests, the Forge shop, Shaft Depth and the tithe.
- The tab and sheet log events (B9).

The converted Forge levels already apply their gold-side effects: Pans, Chute, Anvil, Frenzy and Heart (on the glow).

---

## SPEC B — Mines (status: built; the tuned numbers and deviations are in "Pass B: what was built" below)

### B1. Summary

- **Opening:** the first time any run reaches Dragon Rank 7, or once Call the Deep is owned, the Mines open for
  good. This part is built.
- **The chain:** Pick Crews dig Ore, Ore Carts bring Crews, Tunnel Borers bring Carts, and Deep Delvers bring
  Borers.
- **Costs:** every hire costs Eggs only. A tier's price rises ×2.5 per hire; units the chain makes are free.
- **Persistence:** the Mines produce live and offline and survive Long Sleep. At each Sleep the run's leftover
  Eggs hire miners (the tithe). An Ascend keeps 25%.
- **Swiping:** 1 coin in 8 is a blue-grey Ore nugget that only swipes and gusts collect.
- **What Ore buys:** Forge levels (swipe and gold power), Shaft Depth (never caps, gates the deep tiers) and Sky
  Lanterns.
- **Glow:** lifetime Ore multiplies gold/s and the flat coin worth.

### B2. Tables (`js/mines.js`; `TIERS` and `FORGE` already in place)

**C (constants):**

| Key | Value | Notes |
|---|---|---|
| `openRank` | 7 | |
| `gift` | [3, 0, 0, 0] | |
| `hireGrowth` | 2.5 | |
| `maxBuy` | 10,000 | |
| `nugEvery` | 8 | |
| `nugMaxOnScreen` | 6 | |
| `nugSec` | 2 | |
| `nugMin` | 1 | |
| `glowK` | 0.008 | main tuning knob |
| `glowExp` | 2 | |
| `heartMult` | 1.25 | |
| `ascendKeep` | 0.25 | |
| `depthBase` | 1e4 | |
| `depthGrowth` | 10 | |
| `depthPer` | 0.5 | |
| `relicMult` | 3 | |
| `seamSec` | 60 | |
| `nightMult` | 2 | |
| `chestBase10` | 3 | first Deep Chest at 1K lifetime Ore |
| `emberOreDiv` | 5 | |
| `evOrePerStep` | 500 | |

**TIERS:**

| k | id | Name | First hire (Eggs) | Makes per unit/s | Needs Depth |
|---|---|---|---|---|---|
| 0 | `crew` | Pick Crews | 1.6e7 | 0.1 Ore | 0 |
| 1 | `cart` | Ore Carts | 1e12 | 0.005 Crews | 0 |
| 2 | `borer` | Tunnel Borers | 1e20 | 0.002 Carts | 2 |
| 3 | `delver` | Deep Delvers | 1e28 | 0.0005 Borers | 4 |

- **Hire price** of the next n units of tier k: `eggs_k · 2.5^hired[k] · (2.5^n − 1) / 1.5`.
- **Per-unit rate** = `prod × 2^rails × (1 + 0.5·depth) × (r_ember ? 3 : 1)`. Night Shift adds ×2 while away.

**FORGE** (each level is one deliberate press, no hold):

| id | Name | Per level | Cost (Ore) | Max |
|---|---|---|---|---|
| `pans` | Gilded Pans | `coinMult` ×(1 + 0.15·lv) | 60·4^lv | 10 |
| `sieve` | Nugget Sieve | nugget Ore ×(1 + 0.5·lv) | 150·4^lv | 5 |
| `chute` | Spill Chute | `spillMult` ×(1 + 0.1·lv) | 500·5^lv | 5 |
| `rails` | Iron Rails | miners ×2 | 5e3·20^lv | 3 |
| `anvil` | Searing Anvil | `gustMult` ×(1 + 0.5·lv) | 2e4·10^lv | 2 |
| `seam` | Lucky Seam | treasures give 60 s of Ore | 1e5 | 1 |
| `night` | Night Shift | Mines ×2 while away | 1e6 | 1 |
| `frenzy` | Fire Frenzy | `frenzyMult` ×(1 + 0.25·lv) | 1e6·10^lv | 2 |
| `heart` | Heart of the Forge | glowK ×1.25 | 1e10 | 1 |
| (sky) | Sky Lantern | +8% Stardust, stars fall 3% slower | 1e5 … 1e9 (built) | 5 |
| `depth` | Shaft Depth | miners ×(1 + 0.5·D); D ≥ 2 opens Borers, D ≥ 4 opens Delvers | 1e4·10^D | none |

**Glow:** `1 + 0.008·(heart ? 1.25 : 1)·log10(1 + all)^2`.
- The mod source applies `gpsMult` and `coinFlat` ×glow·hearth. This part is built.
- **Deep Chests:** when `peak` reaches 10^(3 + chestN), grant 1 card. Unowned cards come first, in the order
  frostfang, rimefeather, krakenink, drownedcompass, glacierheart, abyssalpearl, magmatalon, cindercrown,
  obsidianheart. After that, a deterministic roll picks 80% epic and 20% legendary.

### B3. State (built)

`{ open, openAt, ore, all, peak, units[4], hired[4], forge{}, depth, hearth, chestN, lastTithe[4], nug, offline }`

Sanitize rules:
- `pos`/`cl` on every number.
- Integer `hired`, `depth` and `chestN`; `depth` is at most 300.
- `hearth` is clamped to [1, 1e12].
- `forge` keeps only known ids, capped at their max.
- Arrays are length 4.
- Unknown keys are kept.
- `peak = max(peak, all)`.

### B4. Engine integration

- **Tick hook:**
  - When the Mines are closed, open them at rank 7 or with `wake_ember`. This part is built.
  - When open, integrate the chain exactly over dt. Locked tiers produce 0. Offline ×2 with Night Shift goes to
    `s._minesOffline`.
- **`addOre`** raises `ore`, `all` and `peak`, then checks Deep Chests.
- **`E.on('treasure')`:** with Lucky Seam, add 60 s of Ore.
- **`HOARD.mines.nuggets(s, k)`** (called by the cave):
  - Adds `k × max(1, 2 × oreRate) × (1 + 0.5·sieve)`.
  - Increments `run.nug` / `stat.nug`.
  - Returns the Ore so the cave can show a float.
- **Sleep hook:**
  - **Tithe:** Eggs = `prev.tiers[0]`. Hire deepest-first over the open tiers and fill `lastTithe`.
  - **Ascend** keeps 25% of `ore`, `all`, `units` and `hired`. This part is built.
- **`E.addMissionTemplate(def)`:**
  - `def = {tpl, minRank, weight, act, group, offer, make, cur, title}`.
  - At most one mission per group sits in the slots.
- **API to add:**
  - Hiring: `hireCost`, `hireMax`, `hire`, `tierOpen`, `tithePreview`.
  - Forge and Depth: `forgeList`, `forgeCost`, `forge`, `depthCost`, `dig`.
  - Cave: `nuggets`, `nugValue`, `takeOffline`, `nextChestAt`.

### B5. Automation

- No new Lore node: the tithe at Sleep is the automation.
- The Forge, Depth and Lanterns stay manual on purpose.

### B6. Cave nuggets

- **Spawning:** 1 coin in 8 is a nugget, with at most 6 on screen.
- **Merging and brooms:** nuggets never merge and brooms skip them.
- **Collecting:** swipes and gusts collect them. Each flush calls `nuggets()` and floats "+Ore" in `#9fc3d9`.
- **Drawing:** steel-blue `#8fb3c9` with a white glint, static under reduced motion.

### B7. Quests

| Quest | Type | minRank | weight | Target / progress |
|---|---|---|---|---|
| `ore` "Dig N Ore" | activity | 7 | 1 | Progress is `mines.all − base` |
| `hire` "Hire N Pick Crews / …" | gold | 7 | 2 | The deepest open tier with `hireMax(k, budget) ≥ 1`; N = min(5, that) |

`quest-balance.cjs` adds `hire` to `GOLD`.

### B8. UI (`js/ui-mines.js`)

Today the tab shows the header (Ore, Forge glow, Ember's Hearth, waiting crews), the owned Forge levels and Sky
Lanterns.

**Pass B adds, top to bottom (about 1,000 px):**
1. The Shaft card: Depth, multiplier, "Dig deeper".
2. Miners: four Brood-style rows with ×1/×10/Max and hold-to-hire. Only the next locked tier shows, as a locked
   card.
3. The "When you Sleep" strip.
4. The Forge: the 3 cheapest unbought items as two-line cards, then "+n more". Maxed items show as Done chips.
5. Sky Lanterns.

**Elsewhere:**
- The Legend tab's Sleep section previews the tithe.
- A toast "The Mines dug 3.2M Ore while you were away".
- The building shows as "Gold Veins".

### B9. Log events

- `mines`: `open`, `conv` and `eventsConv` are built. Pass B adds `tithe`, `forge`, `depth`, `chest` and `hire`.
- `snap` and `run` gain `ore`, `oreRate`, `units` and `depth`.
- New `tab {id}` and `sheet {id}` events.

### B10. Future chains

- Ranks 9 and 11 are reserved.
- **Treasury / Gems (rank 9):** the first tier is priced in Ore; Gems feed a second glow.
- **Sky (rank 11):** priced in Gems.
- In pass 2 the tab becomes "Deeps" with a segmented control [Mines · Treasury · Sky]. The `advance`, `hireCost`
  and `hireMax` math goes into a shared chain helper.

### B11. Tests

**New `tools/test-mines.cjs`:**
- Defaults and sanitize.
- Opening.
- Exact integration against Euler stepping.
- Prices.
- The tithe.
- Ascend.
- Offline.
- Nuggets and Seam.
- Depth gates.
- Glow and Hearth.
- Deep Chests.
- Missions.
- A strategy check (deepest-first beats all-Crews).
- `ui-mines.js` loads in Node.

**Other tests:** `save-compat.cjs` keeps the pass A conversion checks. `smoke.cjs` adds hold-to-hire, a Forge
press, Dig deeper and a Lantern.

### B12. Sim gates

| # | Gate | Range |
|---|---|---|
| G1 | `sim.cjs` active, first Long Sleep | 25–30 min |
| G2 | `sim.cjs` mixed, SEED 1/2/3 | 38–45 min each |
| G3 | `sim-lore 4 moderate` Sleep 1 | within ±1 min |
| | first Ascend | 2.0–3.5 h |
| | 5-seed mean of first Ascend | 2.0–3.0 h |
| G4 | Mines open (moderate, active) | by the end of run 1 |
| | first Crew hire after open | ≤ 2 min |
| | first Forge level after open | ≤ 3 min |
| G5 | Tier pacing | first Cart ≤ 45 min after open; first Borer 0.75–2.5 h; first Delver ≥ 2 Sleeps after the first Borer and ≤ 4 h after open |
| G6 | Forge | ≥ 15 levels by 2 h; Heart not before 3 h |
| G7 | Glow, moderate at 4 h | ×1.5–×3.0 |
| G8 | casual5 | Mines open by 6 h |
| G9 | All profiles | QUEST BALANCE OK, no NaN, ≥ 5 Mines quests per 4 h |
| G10 | Dream Keeper median run | ≥ 1.5 min |
| G11 | live save | offline 8 h stays finite; the 4.07e12-Egg tithe hires ≥ 1 Cart |

**Tuning order:** glowK, then `hireGrowth`, then `depthBase`, then the Forge base costs, then the Hunger base (4 to
6).

---

## Pass B: what was built

### Player-facing
- **Mines tab** (6th tab, pick icon, dot badge when a Forge level, Depth or a Lantern is affordable), top to bottom:
  - the Ore card: Ore and Ore/s, Forge glow, Ember's Hearth, the nugget value ("Swipe the blue-grey nuggets: +553K Ore
    each") and a bar to the next Deep Chest;
  - the Shaft card: "Shaft Depth D · miners ×a → ×b", what the next Depth breaks into, a one-press "Dig deeper";
  - "Miners" with the shared ×1/×10/Max toggle: Pick Crews, Ore Carts (and Borers, Delvers once the Shaft is deep
    enough) as Brood-style rows with hold-to-hire; only the next locked tier shows, as a dashed card;
  - "When you Sleep": what the leftover Eggs hire now and what the last Sleep hired;
  - the Forge: the 3 cheapest unfinished levels as two-line cards ("Gilded Pans Lv 7/10 · Coins ×2.05 → ×2.2"),
    "+n more", finished items as Done chips; then Sky Lanterns.
- **Cave**: 1 spilled coin in 8 is a blue-grey Ore nugget (at most 6 on screen) with a twinkling glint (static under
  reduced motion). It pays like a coin and also digs Ore; "+X Ore" floats in steel blue. Nuggets never merge and the
  broom kobold leaves them, so only swipes and gusts collect them.
- **Legend tab**: under the Long Sleep panel, "Mines: leftover Eggs will hire +2 Ore Carts, +11 Pick Crews."
- **Quests**: "Dig N Ore" (activity) and "Hire N Ore Carts" (gold), at most one at a time.
- **Toasts**: the Mines open, a Deep Chest card, a new tier broken into, the tithe after a Sleep you took yourself,
  and the Ore dug while away (a line in the welcome-back sheet, or a toast after a short absence).
- **Sounds**: hires play the buy sound with a pick clink; Forge and Dig deeper reuse the upgrade / lantern buys; a Deep
  Chest plays the quest chime. The Starfall start sound, lost with `eventStart` in pass A, is back as `skyStart`.
- The building "Gold Mines" is shown as "Gold Veins" (id `mine` unchanged).

### Deviations from B2 / B7 (all from the B12 tuning order, or judgement)
With the B2 numbers the first Ascend of `sim-lore 4 moderate` fell from 2.42 h (pass A) to 1.84 h (gate 2.0–3.5 h).
Ablations on 6 seeds put the cut on three equal parts: the glow (−0.16 h), the Forge (−0.22 h) and the Deep cards
(−0.21 h). Tuned, in the gate's order:

| What | Spec | Built |
|---|---|---|
| `glowK` | 0.008 | 0.003 |
| `depthBase` | 1e4 | 3e4 |
| Forge prices | pans 60·4^lv, sieve 150·4^lv, chute 500·5^lv, rails 5e3·20^lv, anvil 2e4·10^lv, seam 1e5, night 1e6, frenzy 1e6·10^lv, heart 1e10 | pans 60·5^lv, sieve 150·5^lv, chute 500·6^lv, rails 2e4·20^lv, anvil 1e5·10^lv, seam 3e5, night 3e6, frenzy 3e6·10^lv, heart 1e12 |
| Dragon's Hunger base | 5 | 6 (costs 6, 24, 96, …) |
| `chestBase10` (not in the tuning list) | 3 (first Deep Chest at 1K) | 5 (first at 100K) |
| Mines quests `minRank` (not in the list) | 7 | 5: late runs end at rank 5–7, and G9 asks ≥ 5 Mines quests per 4 h |
| 'ore' quest size | Ta × (Ore/s + nuggets) | 0.6 × that (`C.oreQuestShare`): the quest-balance tail rule failed in the Dream Keeper run |

Judgement calls: a nugget pays its coin's gold too (so the swipe gold does not drop by 1/8 when the Mines open); Night
Shift doubles the Ore dug while away (not every rate in the chain); the sim player also finishes 'hire' quests when it
has the Eggs, digs deeper before forging, and saves 12 Legend for Call the Deep after its 3rd Sleep; the away toast is a
welcome-back line when that sheet shows (as Starfall does). `E.addMissionTemplate` lives in the engine, and the play log
gets `tab` / `sheet` from `ui.js`.

### Gates (tools/sim.cjs, tools/sim-lore.cjs; scratch logs in mines/final3)

| # | Gate | Result |
|---|---|---|
| G1 | sim active first Sleep 25–30 min | 26.8 (777); seeds 1/2/3: 24.5 / 31.3 / 24.9 (pass A: 24.5 / 32.7 / 24.9) |
| G2 | sim mixed 38–45 min | mixed alone, SEED 1/2/3/777: 42.2 / 41.6 / 40.0 / 41.4, identical to `NOMINES=1` (42.2 / 41.9 / 40.0 / 41.4). In the all-profile run the mixed profile inherits the random stream of the three profiles before it, which the Mines change: 33.1 / 44.8 / 40.1 / 33.6 there |
| G3 | sim-lore moderate Sleep 1 ±1 min; first Ascend 2.0–3.5 h; 5-seed mean 2.0–3.0 h | 32.6 min (=); 2.04 h; seeds 11–55: 2.29 / 2.47 / 2.06 / 2.19 / 1.91, mean 2.18 h |
| G4 | open by end of run 1; first hire ≤ 2 min; first Forge ≤ 3 min | 0.54 h (moderate), 0.43 h (active), both run 1; +0.0 min (the Sleep 1 tithe); +0.7 min |
| G5 | Cart ≤ 45 min; Borer 0.75–2.5 h; Delver ≥ 2 Sleeps after, ≤ 4 h | +33 min; +1.83 h; +2.17 h, Sleep 36 vs 33 |
| G6 | ≥ 15 Forge levels by 2 h; Heart ≥ 3 h | 16; 3.95 h (active 3.28 h) |
| G7 | glow at 4 h ×1.5–3.0 | ×1.56 |
| G8 | casual5 open by 6 h | 4.00 h (Call the Deep) |
| G9 | QUEST BALANCE OK, no NaN, ≥ 5 Mines quests / 4 h | all profiles OK, none; 8 |
| G10 | Dream Keeper median run ≥ 1.5 min, not shorter than today | 2.1 min (pass A 2.1) |
| G11 | live save + 8 h: finite, Ore up; 4.07e12 Eggs tithe ≥ 1 Cart | test-mines.cjs: finite, Ore 59.4M → 1.55B (glow ×1.32, 61 Dream Keeper Sleeps tithing); the save's 4.06e12 Eggs would hire +2 Carts, +11 Crews; after the 90 s run (3.7e14 Eggs) the Sleep hires +6 Carts, +18 Crews |

## Fix pass after the playtest and code reviews (2026-11-05)

The playtest on the player's real save found that the Mines ran out of choices on day 1 and that, after one night of
long Dream Keeper runs, the player's short live runs stopped hiring (the Egg-budget tithe sat on a ×2.5 price ladder
that the 1e47-Egg offline runs had climbed). Changes:

| What | Before | Now |
|---|---|---|
| Tithe at each Long Sleep | spend the leftover Eggs on the ×2.5 ladder, deepest first (raised `hired`) | every open tier recruits 1 at its first-hire price, +1 per ×1000 above it, at most 3 (`C.titheCap`, `C.titheStep`); recruits never raise the hire price. Hiring by hand is unchanged |
| Shaft Depth | miners ×(1 + 0.5 D); Borers at Depth 2, Delvers at 4 | miners ×1.25^D (`C.depthMul`); Borers at Depth 3, Delvers at 5 |
| Forge | 9 capped items | + **Stoke the Forge**: 1e9 Ore ×10 a level, never caps, glow bonus +10% a level |
| Heart of the Forge | 1e12 Ore | 1e11 Ore |
| Glow | 1 + 0.003 · log10(1 + Ore dug)^2 | 1 + 0.002 · (Heart 1.25) · (1 + 0.1 Stoke) · log10(1 + Ore dug)^2.2 |
| Sky Lanterns | 1e5 … 1e9 Ore (×10) | 1e5, 1e7, 1e9, 1e11, 1e13 (×100) |
| Mines quests | from rank 5; 'hire' offered even when one press finishes it | from rank 3 (once open); 'hire' not offered while the nest already pays for it |
| Ascend | cut Ore to 25% even while the Mines were shut | the banked event-lair Ore is kept while shut |
| Cave | auto-gust took nuggets; nuggets rested under the Gust button and half off-screen; "+Ore" float could clip top-left | auto-gust (inside `E.automated`) leaves nuggets and does not count them; resting nuggets keep clear of `#gust` / `#skybtn` and 1.3 r from the edges; the gust's "+Ore" float rises above its gold number, clamped on screen; nuggets are bluer |
| Top bar | "×2 streak" pushed the Auto chip off a 360 px screen | while a streak / Frenzy / Ember chip shows and the row overflows, the Auto chip (then the gold/s trend) steps out |
| Conversions | emitted `mines conv` during deserialize (logged twice on boot) | no emit; ui-mines logs and toasts each once per page and keeps checking after a cloud state swap |

Live save projection (scratch `mines/fix/proj.cjs`: greedy spending, 6 short runs a day, 8 h nights): day 1 Depth 3–4
and Borers; day 2 Delvers (Depth 5), Stoke 3, Lantern 4; live Sleeps recruit +3 of each open miner every run, day 1
through day 4 (before: 0 after the first night). Glow ×1.19 on day 1 evening, ×1.6–1.8 day 2, ×2.4–2.8 day 3.

Sims (5 seeds, `sim-lore 4 moderate`): first Ascend 2.11 / 2.14 / 2.32 / 2.08 / 2.00 h (777 / 11 / 22 / 33 / 55),
mean 2.13 h; glow at 4 h ×1.62 (777); first Cart / Borer / Delver after open +38 min / +2.2 h / +2.8 h (777); Heart
3.97 h; QUEST BALANCE OK in all profiles and at 8 h on seed 777 (the review's M4 fail is gone).
