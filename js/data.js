/* Hoard — static content tables + number formatting.
 * Classic script. Runs in the browser and in Node (globalThis, no DOM). */
var HOARD = (globalThis.HOARD = globalThis.HOARD || {});
(function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var C = {
    // coins & swiping
    spillBase: 2,            // coins/s that spill into the cave
    maxCoins: 70,            // on-screen cap (above it, value merges)
    coinGpsPct: 0.005,       // each coin is also worth 0.5% of gold/s
    strokePx: 120,           // every 120px of swipe path ...
    strokeFrac: 0.25,        // ... earns 0.25 x coinWorth
    streakMinSpeed: 50,      // px/s to keep a streak alive
    streakDecay: 0.7,        // s still/lifted before losing one level (and per level)
    streakLevels: [          // seconds of continuous swiping -> multiplier
      { at: 0, mult: 1 },
      { at: 1.5, mult: 2 },
      { at: 4, mult: 3 },
      { at: 8, mult: 5 },
      { at: 15, mult: 8 }    // needs Comet card or Dragon Rank 4+
    ],
    streakCapLow: 5,
    streakCapHigh: 8,
    streakHighRank: 4,
    // wing gust
    gustCooldown: 45,
    gustMult: 3,
    gustFloorCoins: 6,       // a gust always pays at least this many coins
    gustFlickPx: 140,
    gustFlickMs: 220,
    gustFlickSpeed: 1400,
    // treasures
    treasureInterval: [70, 130],
    treasureLife: 13,
    treasureRadius: 36,
    coinRadius: 30,
    frenzyMult: 7,
    frenzyDur: 30,
    emberMult: 10,
    emberDur: 20,
    swarmCoins: 45,
    // growth
    buildingGrowth: 1.15,
    buildingMinionGrowth: 1.10,
    // rank
    maxRank: 12,
    rankGpsAfter: 6,         // ranks above this give +5% gold/s each
    rankGpsPer: 0.05,
    chestCardsLow: 2,
    chestCardsHigh: 3,
    chestCardsRank: 6,
    // missions (seconds of active play a generated mission aims for)
    missionTimeBase: 240,
    missionTimePerRank: 80,
    missionBuildShare: 0.5,   // share of income assumed spent on a building/tier mission
    missionBuildMaxStep: 12,  // max extra buildings a single mission asks for
    missionCoinShare: 0.6,    // share of spilled coins a player actually collects
    tutorialMissions: [
      { tpl: 'building', key: 'digger', target: 15 },
      { tpl: 'coins', target: 260 },
      { tpl: 'earn', target: 3500 }
    ],
    // prestige
    sleepReq: 1e7,
    legendDiv: 1e6,
    legendPer: 0.1,          // +10% per Legend
    // offline
    offlineCapHours: 8,
    offlineSteps: 200,
    offlineModalMin: 60,
    // safety
    maxNum: 1e300,
    buildingMaxBuy: 10000,
    tierMaxBuy: 1e15
  };

  // ---------------------------------------------------------------- minion chain
  // Each tier produces the tier below it. Flat price per unit.
  var tiers = [
    { id: 'egg', name: 'Eggs', one: 'Egg', gold: 4, prevCost: 0, prod: 0, verb: '',
      text: 'Warm dragon eggs. Spent on Raiding Parties and Wyrmlings.' },
    { id: 'wyrmling', name: 'Wyrmlings', one: 'Wyrmling', gold: 60, prevCost: 10, prod: 1, verb: 'forages',
      text: 'Each Wyrmling forages 1 Egg per second.' },
    { id: 'drake', name: 'Drakes', one: 'Drake', gold: 1500, prevCost: 8, prod: 0.2, verb: 'raises',
      text: 'Each Drake raises 0.2 Wyrmlings per second.' },
    { id: 'wyvern', name: 'Wyverns', one: 'Wyvern', gold: 60000, prevCost: 8, prod: 0.1, verb: 'trains',
      text: 'Each Wyvern trains 0.1 Drakes per second.' },
    { id: 'elder', name: 'Elder Dragons', one: 'Elder Dragon', gold: 600000, prevCost: 8, prod: 0.05, verb: 'leads',
      text: 'Each Elder Dragon leads 0.05 Wyverns per second.' }
  ];
  var tierMilestones = [10, 25, 50, 100, 250, 500, 1000];

  // ---------------------------------------------------------------- buildings
  var buildings = [
    { id: 'digger', name: 'Kobold Diggers', one: 'Kobold Digger', gold: 15, minionTier: -1, minions: 0, gps: 0.3, rank: 1,
      text: 'Small, tireless, and only slightly dishonest.' },
    { id: 'raid', name: 'Raiding Parties', one: 'Raiding Party', gold: 140, minionTier: 0, minions: 15, gps: 1, rank: 2,
      text: 'Kobolds borrow gold from the villages. Forever.' },
    { id: 'mine', name: 'Gold Mines', one: 'Gold Mine', gold: 1800, minionTier: 1, minions: 4, gps: 6, rank: 3,
      text: 'Wyrmlings breathe on the rock until it gives up its veins.' },
    { id: 'tower', name: 'Alchemy Towers', one: 'Alchemy Tower', gold: 26000, minionTier: 2, minions: 4, gps: 40, rank: 4,
      text: 'Drake-fire turns lead to gold, and smoke to more smoke.' },
    { id: 'well', name: 'Wishing Wells', one: 'Wishing Well', gold: 420000, minionTier: 3, minions: 3, gps: 320, rank: 5,
      text: 'Every wish tossed in lands in your hoard.' },
    { id: 'moon', name: 'Gold Moons', one: 'Gold Moon', gold: 3000000, minionTier: 4, minions: 2, gps: 3500, rank: 6,
      text: 'Elder Dragons hang a second moon, and it is made of gold.' }
  ];
  // 25 / 50 / 100 / 150 / 200 / 300 / 400 ... (every 100 after 200)
  var buildingMilestones = [25, 50, 100, 150, 200];

  // ---------------------------------------------------------------- lair upgrades
  // effect kinds: coinMult, scales (pct of gps per coin), sweep (coins/s), gustCd (seconds),
  //               gleam (treasure freq mult), spill (spill mult)
  var upgrades = [
    { id: 'claws1', name: 'Sharper Claws I', cost: 100, text: 'Coins are worth x2.', effect: { kind: 'coinMult', mult: 2 } },
    { id: 'spill1', name: 'Overflowing Hoard', cost: 300, text: 'Coins spill into the cave x1.5 as often.', effect: { kind: 'spill', mult: 1.5 } },
    { id: 'broom1', name: 'Kobold Broom Crew I', cost: 500, text: 'A kobold sweeps up 0.5 coins/s for you.', req: { building: 'digger', n: 10 }, effect: { kind: 'sweep', rate: 0.5 } },
    { id: 'scales1', name: 'Golden Scales I', cost: 1000, text: 'Each coin is also worth +1% of your gold/s.', effect: { kind: 'scales', pct: 0.01 } },
    { id: 'wings1', name: 'Bigger Wings I', cost: 2000, text: 'Wing Gust recharges in 30s (was 45s).', effect: { kind: 'gustCd', sec: 30 } },
    { id: 'claws2', name: 'Sharper Claws II', cost: 5000, text: 'Coins are worth x2 again.', req: { upgrade: 'claws1' }, effect: { kind: 'coinMult', mult: 2 } },
    { id: 'gleam1', name: 'Hoard Gleam', cost: 25000, text: 'Gleaming treasures appear 30% more often.', effect: { kind: 'gleam', mult: 1.3 } },
    { id: 'broom2', name: 'Kobold Broom Crew II', cost: 50000, text: 'The broom crew sweeps 1.5 coins/s.', req: { building: 'digger', n: 50, upgrade: 'broom1' }, effect: { kind: 'sweep', rate: 1.5 } },
    { id: 'scales2', name: 'Golden Scales II', cost: 200000, text: 'Each coin is also worth +2% more of your gold/s.', req: { upgrade: 'scales1' }, effect: { kind: 'scales', pct: 0.02 } },
    { id: 'claws3', name: 'Sharper Claws III', cost: 500000, text: 'Coins are worth x2 again.', req: { upgrade: 'claws2' }, effect: { kind: 'coinMult', mult: 2 } },
    { id: 'wings2', name: 'Bigger Wings II', cost: 1000000, text: 'Wing Gust recharges in 20s.', req: { upgrade: 'wings1' }, effect: { kind: 'gustCd', sec: 20 } },
    { id: 'broom3', name: 'Kobold Broom Crew III', cost: 5000000, text: 'The broom crew sweeps 4 coins/s.', req: { building: 'digger', n: 100, upgrade: 'broom2' }, effect: { kind: 'sweep', rate: 4 } },
    { id: 'scales3', name: 'Golden Scales III', cost: 40000000, text: 'Each coin is also worth +3% more of your gold/s.', req: { upgrade: 'scales2' }, effect: { kind: 'scales', pct: 0.03 } },
    { id: 'claws4', name: 'Sharper Claws IV', cost: 50000000, text: 'Coins are worth x2 again.', req: { upgrade: 'claws3' }, effect: { kind: 'coinMult', mult: 2 } }
  ];

  // ---------------------------------------------------------------- treasures
  var treasures = [
    { kind: 'frenzy', weight: 35, title: 'Gold Frenzy', text: 'Gold/s x7 for 30s!' },
    { kind: 'lucky', weight: 25, title: 'Lucky Find', text: 'A pile of gold!' },
    { kind: 'ember', weight: 20, title: 'Ember Touch', text: 'Coins and strokes x10 for 20s!' },
    { kind: 'swarm', weight: 12, title: 'Coin Swarm', text: 'Coins pour from the ceiling!' },
    { kind: 'clutch', weight: 8, title: 'Lost Clutch', text: 'Your brood grows by 10%!' }
  ];

  // ---------------------------------------------------------------- cards
  var rarities = {
    common: { name: 'Common', weight: 62, color: '#b8b0c4' },
    rare: { name: 'Rare', weight: 27, color: '#6fb0ff' },
    epic: { name: 'Epic', weight: 9, color: '#c27cff' },
    legendary: { name: 'Legendary', weight: 2, color: '#ffe08a' }
  };
  var rarityOrder = ['common', 'rare', 'epic', 'legendary'];
  var cardThresholds = [1, 3, 6, 10, 15, 25, 40, 60, 90, 140];

  function pct(x) { return Math.round(x * 100) + '%'; }
  function lv(l) { l = +l || 0; return l < 1 ? 1 : l; } // describe(0) previews level 1
  function bCard(bName) {
    return function (l) { return bName + ' produce x' + fmtMult(1 + 0.5 * lv(l)) + ' gold.'; };
  }
  function tCard(tName, noun) {
    return function (l) { return tName + ' ' + noun + ' x' + fmtMult(1 + 0.5 * lv(l)) + ' as fast.'; };
  }
  function fmtMult(m) { return (Math.round(m * 100) / 100).toString(); }

  // target keys: 'b:<buildingId>' | 't:<tierIndex>' | 'coin' | 'stroke' | 'gust' | 'treasure'
  //              | 'frenzy' | 'offline' | 'streak' | 'gps' | 'legend'
  var cards = [
    // common (8)
    { id: 'rustpick', name: 'Rusted Kobold Pick', rarity: 'common', target: 'b:digger', flavor: 'Still sharp enough for honest work.', describe: bCard('Kobold Diggers') },
    { id: 'warhorn', name: 'Warhorn of the Hill Raiders', rarity: 'common', target: 'b:raid', flavor: 'One blast and every village hides its silver.', describe: bCard('Raiding Parties') },
    { id: 'emberegg', name: 'Ember Egg', rarity: 'common', target: 't:0', flavor: 'Warm to the touch, never quite hatching.',
      describe: function (l) { return 'Eggs cost ' + pct(Math.min(0.4, 0.04 * lv(l))) + ' less gold.'; } },
    { id: 'milktooth', name: 'Milk Tooth of a Wyrmling', rarity: 'common', target: 't:1', flavor: 'Lost in a bite of a too-hard coin.', describe: tCard('Wyrmlings', 'forage Eggs') },
    { id: 'whisperscale', name: 'Whispering Scale', rarity: 'common', target: 'stroke', flavor: 'It hums when drawn across stone.',
      describe: function (l) { return 'Swipe strokes earn x' + fmtMult(1 + 0.5 * lv(l)) + ' gold.'; } },
    { id: 'gildedfang', name: 'Gilded Fang', rarity: 'common', target: 'coin', flavor: 'Some dragon bit a crown and kept the tooth.',
      describe: function (l) { return 'Coins are worth x' + fmtMult(1 + 0.25 * lv(l)) + '.'; } },
    { id: 'tidepearl', name: 'Tide Pearl', rarity: 'common', target: 'treasure', flavor: 'It pulls glittering things toward it.',
      describe: function (l) { return 'Gleaming treasures appear ' + pct(0.1 * lv(l)) + ' more often.'; } },
    { id: 'moonlitscale', name: 'Moonlit Scale', rarity: 'common', target: 'offline', flavor: 'Shed in a long and dreamless sleep.',
      describe: function (l) { return 'Gold keeps piling up +' + lv(l) + 'h longer while you are away.'; } },
    // rare (6)
    { id: 'deeplantern', name: 'Lantern of the Deep Seam', rarity: 'rare', target: 'b:mine', flavor: 'Its flame bends toward veins of gold.', describe: bCard('Gold Mines') },
    { id: 'alembic', name: 'Ashen Alembic', rarity: 'rare', target: 'b:tower', flavor: 'Whatever goes in, gold comes out. Eventually.', describe: bCard('Alchemy Towers') },
    { id: 'broodbrooch', name: 'Brood-Mother\'s Brooch', rarity: 'rare', target: 't:2', flavor: 'Pinned to the softest scale of a watchful mother.', describe: tCard('Drakes', 'raise Wyrmlings') },
    { id: 'galefeather', name: 'Gale Feather', rarity: 'rare', target: 'gust', flavor: 'Plucked from a storm that thought it was a bird.',
      describe: function (l) { return 'Wing Gust coins are worth x' + fmtMult(3 * (1 + 0.25 * lv(l))) + ' (was x3).'; } },
    { id: 'emberglass', name: 'Hourglass of Embers', rarity: 'rare', target: 'frenzy', flavor: 'The sand burns, and so it falls slowly.',
      describe: function (l) { return 'Gold Frenzy lasts +' + (3 * lv(l)) + 's longer.'; } },
    { id: 'cometshard', name: 'Comet Shard', rarity: 'rare', target: 'streak', flavor: 'Fell fast, burned bright, never stopped.',
      describe: function (l) { return 'Unlocks the x8 streak. Streaks are worth +' + pct(0.05 * lv(l)) + ' more.'; } },
    // epic (4)
    { id: 'wishbone', name: 'Wishbone of the Drowned Well', rarity: 'epic', target: 'b:well', flavor: 'Every wish it grants ends in coin.', describe: bCard('Wishing Wells') },
    { id: 'wyverntalon', name: 'Wyvern Talon Chalice', rarity: 'epic', target: 't:3', flavor: 'Drink, and feel the sky pull at you.', describe: tCard('Wyverns', 'train Drakes') },
    { id: 'eldereye', name: 'Eye of the Eldest', rarity: 'epic', target: 't:4', flavor: 'It has watched three ages of hoards.', describe: tCard('Elder Dragons', 'lead Wyverns') },
    { id: 'moonforged', name: 'Moon-Forged Coin', rarity: 'epic', target: 'b:moon', flavor: 'Struck on the far side of the sky.', describe: bCard('Gold Moons') },
    // legendary (2)
    { id: 'koboldcrown', name: 'Crown of the Kobold King', rarity: 'legendary', target: 'gps', flavor: 'Every kobold alive bows to whoever wears it.',
      describe: function (l) { return 'All gold/s x' + fmtMult(1 + 0.25 * lv(l)) + '.'; } },
    { id: 'firsthoard', name: 'Heart of the First Hoard', rarity: 'legendary', target: 'legend', flavor: 'The first coin any dragon ever kept.',
      describe: function (l) { return 'Long Sleep grants +' + pct(0.1 * lv(l)) + ' more Legend.'; } }
  ];

  // ---------------------------------------------------------------- missions
  // tpl ids used in state.missions[].tpl
  var missionTemplates = [
    { tpl: 'building', minRank: 1, weight: 3, text: 'Own {n} {name}' },
    { tpl: 'tier', minRank: 1, weight: 2, text: 'Own {n} {name}' },
    { tpl: 'earn', minRank: 1, weight: 2, text: 'Earn {n} gold this Sleep' },
    { tpl: 'coins', minRank: 1, weight: 2, text: 'Collect {n} coins' },
    { tpl: 'streak', minRank: 1, weight: 1, text: 'Reach a x{n} streak' },
    { tpl: 'treasures', minRank: 3, weight: 0.3, text: 'Grab {n} gleaming treasures' },
    { tpl: 'gusts', minRank: 2, weight: 1, text: 'Use {n} Wing Gusts' },
    { tpl: 'gps', minRank: 2, weight: 2, text: 'Reach {n} gold/s' }
  ];

  HOARD.data = {
    C: C,
    tiers: tiers,
    tierMilestones: tierMilestones,
    buildings: buildings,
    buildingMilestones: buildingMilestones,
    upgrades: upgrades,
    treasures: treasures,
    rarities: rarities,
    rarityOrder: rarityOrder,
    cardThresholds: cardThresholds,
    cards: cards,
    missionTemplates: missionTemplates
  };

  // ---------------------------------------------------------------- formatting
  var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  function floorTo(x, d) {
    var p = Math.pow(10, d);
    // tiny epsilon so 1.23 (stored as 1.2299999) shows as 1.23
    return Math.floor(x * p + 1e-9) / p;
  }

  function fmt(n) {
    n = +n;
    if (!isFinite(n)) return n > 0 ? '1e300' : (n < 0 ? '-1e300' : '0');
    if (n < 0) return '-' + fmt(-n);
    if (n < 1000) {
      if (n < 10 && n !== Math.floor(n)) {
        var t = floorTo(n, 1);
        return t === Math.floor(t) ? String(t) : t.toFixed(1);
      }
      return String(Math.floor(n));
    }
    if (n >= 1e36) {
      var e = Math.floor(Math.log10(n));
      var m = n / Math.pow(10, e);
      if (m >= 10) { m /= 10; e += 1; }
      return floorTo(m, 2).toFixed(2) + 'e' + e;
    }
    var g = Math.floor(Math.log10(n) / 3);
    if (g < 1) g = 1;
    if (g > SUFFIX.length - 1) g = SUFFIX.length - 1;
    var v = n / Math.pow(1000, g);
    if (v >= 1000 && g < SUFFIX.length - 1) { g += 1; v /= 1000; }
    if (v < 1) { g -= 1; v *= 1000; }
    var s;
    if (v < 10) s = floorTo(v, 2).toFixed(2);
    else if (v < 100) s = floorTo(v, 1).toFixed(1);
    else s = String(Math.floor(v + 1e-9));
    return s + SUFFIX[g];
  }

  function fmtRate(n) { return fmt(n) + '/s'; }

  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function fmtTime(sec) {
    sec = +sec;
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    if (sec >= 3600) {
      var h = Math.floor(sec / 3600);
      var mm = Math.floor((sec % 3600) / 60);
      return h + 'h ' + mm + 'm';
    }
    if (sec >= 60) {
      var m = Math.floor(sec / 60);
      return m + 'm ' + pad2(sec % 60) + 's';
    }
    return sec + 's';
  }

  HOARD.fmt = fmt;
  HOARD.fmtRate = fmtRate;
  HOARD.fmtTime = fmtTime;
})();
