const BASE_RESOURCE_TILES = [
  'brick', 'brick', 'brick',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'ore', 'ore', 'ore',
  'desert',
];

const EXTENDED_RESOURCE_TILES = [
  ...BASE_RESOURCE_TILES,
  'brick', 'brick',
  'lumber', 'lumber',
  'wool', 'wool',
  'grain', 'grain',
  'ore', 'ore',
  'desert',
];

const BASE_NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const EXTENDED_NUMBER_TOKENS = [
  ...BASE_NUMBER_TOKENS,
  2, 3, 4, 5, 6, 8, 9, 10, 11, 12,
];

const BASE_PORTS = ['brick', 'lumber', 'wool', 'grain', 'ore', 'any', 'any', 'any', 'any'];
const EXTENDED_PORTS = [...BASE_PORTS, 'any', 'any'];

const DEFAULT_PIECE_LIMITS = {
  roads: 15,
  settlements: 5,
  cities: 4,
};

const MAP_PROFILES = {
  classic: {
    id: 'classic',
    name: 'Classic Island',
    description: 'The standard 19-hex island used by the 3-4 player base game.',
    radius: 2,
    resources: BASE_RESOURCE_TILES,
    numbers: BASE_NUMBER_TOKENS,
    ports: BASE_PORTS,
    bankSize: 19,
    pieceLimits: DEFAULT_PIECE_LIMITS,
  },
  extended: {
    id: 'extended',
    name: '5-6 Player Island',
    description: 'A 30-hex enlarged island using the 5-6 player resource mix.',
    rows: [3, 4, 5, 6, 5, 4, 3],
    resources: EXTENDED_RESOURCE_TILES,
    numbers: EXTENDED_NUMBER_TOKENS,
    ports: EXTENDED_PORTS,
    bankSize: 24,
    pieceLimits: DEFAULT_PIECE_LIMITS,
  },
};

const RULESET_GROUPS = [
  'Core Game',
  'Seafarers',
  'Cities & Knights',
  'Traders & Barbarians',
  'Explorers & Pirates',
];

const CATAN_RULESETS = [
  {
    id: 'base-classic',
    group: 'Core Game',
    name: 'Base Game',
    edition: '3-4 players',
    playerCounts: [3, 4],
    defaultPlayerCount: 4,
    mapProfileId: 'classic',
    victoryPoints: 10,
    pairedPlayers: false,
    engineLevel: 'Playable',
    modules: [
      'Robber on 7',
      'Development cards',
      'Longest road',
      'Largest army',
      'Bank and harbor trades',
    ],
    scenarios: [
      { id: 'random-island', name: 'Random Island', target: 10 },
      { id: 'balanced-island', name: 'Balanced Random Island', target: 10 },
    ],
  },
  {
    id: 'base-5-6',
    group: 'Core Game',
    name: 'Base Game Extension',
    edition: '5-6 players',
    playerCounts: [5, 6],
    defaultPlayerCount: 6,
    mapProfileId: 'extended',
    victoryPoints: 10,
    pairedPlayers: true,
    engineLevel: 'Playable',
    modules: [
      '30-hex extension island',
      'Expanded resource bank',
      'Special building phase',
      'Robber on 7',
      'Development cards',
    ],
    scenarios: [
      { id: 'extended-random', name: 'Extended Random Island', target: 10 },
      { id: 'six-player-coast', name: 'Six-Player Coast', target: 10 },
    ],
  },
  {
    id: 'seafarers',
    group: 'Seafarers',
    name: 'Seafarers',
    edition: 'Scenarios and voyages',
    playerCounts: [3, 4, 5, 6],
    defaultPlayerCount: 4,
    mapProfileId: 'classic',
    victoryPoints: 12,
    pairedPlayers: false,
    engineLevel: 'Scenario catalog',
    modules: [
      'Ships and shipping lanes',
      'Gold fields',
      'Pirate ship',
      'Fog exploration',
      'Scenario-specific victory targets',
    ],
    scenarios: [
      { id: 'new-shores', name: 'Heading for New Shores', target: 13 },
      { id: 'four-islands', name: 'The Four Islands', target: 12 },
      { id: 'fog-islands', name: 'The Fog Islands', target: 12 },
      { id: 'through-the-desert', name: 'Through the Desert', target: 12 },
      { id: 'forgotten-tribe', name: 'The Forgotten Tribe', target: 13 },
      { id: 'cloth-for-catan', name: 'Cloth for Catan', target: 14 },
      { id: 'pirate-islands', name: 'The Pirate Islands', target: 13 },
      { id: 'wonders', name: 'The Wonders of Catan', target: 10 },
      { id: 'new-world', name: 'New World', target: 12 },
    ],
  },
  {
    id: 'cities-knights',
    group: 'Cities & Knights',
    name: 'Cities & Knights',
    edition: 'Advanced development',
    playerCounts: [3, 4, 5, 6],
    defaultPlayerCount: 4,
    mapProfileId: 'classic',
    victoryPoints: 13,
    pairedPlayers: false,
    engineLevel: 'Rule catalog',
    modules: [
      'Commodities',
      'City improvements',
      'Progress cards',
      'Active knights',
      'Barbarian attacks',
      'Metropolises',
    ],
    scenarios: [
      { id: 'ck-classic', name: 'Cities & Knights', target: 13 },
      { id: 'ck-seafarers', name: 'Cities & Knights with Seafarers', target: 13 },
    ],
  },
  {
    id: 'traders-barbarians',
    group: 'Traders & Barbarians',
    name: 'Traders & Barbarians',
    edition: 'Variants and linked scenarios',
    playerCounts: [2, 3, 4, 5, 6],
    defaultPlayerCount: 4,
    mapProfileId: 'classic',
    victoryPoints: 13,
    pairedPlayers: false,
    engineLevel: 'Rule catalog',
    modules: [
      'Event cards',
      'Fishermen of Catan',
      'Rivers of Catan',
      'Caravans',
      'Barbarian Attack',
      'Traders & Barbarians wagons',
      'Harbormaster',
      'Friendly robber',
    ],
    scenarios: [
      { id: 'fishermen', name: 'The Fishermen of Catan', target: 10 },
      { id: 'rivers', name: 'The Rivers of Catan', target: 10 },
      { id: 'caravans', name: 'The Caravans', target: 12 },
      { id: 'barbarian-attack', name: 'Barbarian Attack', target: 12 },
      { id: 'traders', name: 'Traders & Barbarians', target: 13 },
      { id: 'event-cards', name: 'Event Cards Variant', target: 10 },
      { id: 'catan-for-two', name: 'Catan for Two', target: 10 },
    ],
  },
  {
    id: 'explorers-pirates',
    group: 'Explorers & Pirates',
    name: 'Explorers & Pirates',
    edition: 'Mission campaign',
    playerCounts: [2, 3, 4],
    defaultPlayerCount: 4,
    mapProfileId: 'classic',
    victoryPoints: 17,
    pairedPlayers: false,
    engineLevel: 'Rule catalog',
    modules: [
      'Hidden hex exploration',
      'Ships and settlers',
      'Crew movement',
      'Pirate lairs',
      'Fish missions',
      'Spice missions',
    ],
    scenarios: [
      { id: 'land-ho', name: 'Land Ho', target: 8 },
      { id: 'pirate-lairs', name: 'Pirate Lairs', target: 12 },
      { id: 'fish-for-catan', name: 'Fish for Catan', target: 15 },
      { id: 'spices-for-catan', name: 'Spices for Catan', target: 15 },
      { id: 'full-campaign', name: 'Explorers & Pirates', target: 17 },
    ],
  },
];

function getRuleset(rulesetId = 'base-classic') {
  return CATAN_RULESETS.find(ruleset => ruleset.id === rulesetId) || CATAN_RULESETS[0];
}

function getMapProfile(mapProfileId = 'classic') {
  return MAP_PROFILES[mapProfileId] || MAP_PROFILES.classic;
}

function getDefaultScenario(ruleset) {
  return ruleset.scenarios?.[0] || null;
}

function normalizePlayerCount(ruleset, playerCount) {
  const requested = Number(playerCount) || ruleset.defaultPlayerCount;
  if (ruleset.playerCounts.includes(requested)) return requested;
  return ruleset.defaultPlayerCount;
}

// The base engine has no expansion VP sources (gold fields, metropolises,
// mission VP), so a catalog scenario's headline target can exceed what's
// reachable with base mechanics — settlement-spot contention caps the leader,
// and more players means a lower ceiling. This is the playable victory target;
// it's the single source of truth shared by the engine and the setup UI.
function reachableTarget(playerCount) {
  const pc = Number(playerCount) || 4;
  return pc >= 6 ? 12
    : pc >= 4 ? 13   // 4-5 players (spot contention caps the leader ~13)
    : pc === 3 ? 14
    : 15;            // 2 players
}

function effectiveTarget(scenarioTarget, playerCount) {
  return Math.min(scenarioTarget, reachableTarget(playerCount));
}

export {
  CATAN_RULESETS,
  RULESET_GROUPS,
  MAP_PROFILES,
  getRuleset,
  getMapProfile,
  getDefaultScenario,
  normalizePlayerCount,
  reachableTarget,
  effectiveTarget,
};
