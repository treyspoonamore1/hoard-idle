# Hoard

An idle game for phones. You're a baby dragon growing a gold hoard: swipe the cave to sweep up coins, build a lair, raise a brood of minions, and take the Long Sleep to come back stronger.

Published as a private claude.ai artifact and played in Chrome on Android (Add to Home screen).

## Layout

- `index.html` — page content (the artifact publisher wraps it in a full HTML document)
- `js/data.js` — content tables and number formatting
- `js/engine.js` — game rules, save/load, offline progress (runs in Node too)
- `js/cave.js` — the swipe cave canvas
- `js/ui.js` — panels, tabs, sheets
- `js/main.js` — boot, game loop, saving
- `SPEC.md` — the design contract
- `tools/` — local checks

## Local checks

```bash
node tools/build-dev.cjs      # writes dev.html, a full page you can open in a browser
node tools/engine-selftest.cjs
node tools/sim.cjs            # balance simulation
node tools/smoke.cjs          # Playwright phone smoke test
```
