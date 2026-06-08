// DiplomacyBoard.js
// Pure rules/state engine for a browser-playable classic Diplomacy implementation.

const POWERS = ['austria', 'england', 'france', 'germany', 'italy', 'russia', 'turkey'];

const POWER_NAMES = {
  austria: 'Austria-Hungary',
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  russia: 'Russia',
  turkey: 'Turkey',
};

const POWER_SHORT_NAMES = {
  austria: 'Austria',
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  russia: 'Russia',
  turkey: 'Turkey',
};

const POWER_COLORS = {
  austria: '#C2410C',
  england: '#7C3AED',
  france: '#2563EB',
  germany: '#475569',
  italy: '#16A34A',
  russia: '#DC2626',
  turkey: '#D97706',
};

const POWER_ACCENTS = {
  austria: '#FED7AA',
  england: '#DDD6FE',
  france: '#BFDBFE',
  germany: '#CBD5E1',
  italy: '#BBF7D0',
  russia: '#FECACA',
  turkey: '#FDE68A',
};

const HOME_CENTERS = {
  austria: ['BUD', 'TRI', 'VIE'],
  england: ['EDI', 'LON', 'LVP'],
  france: ['BRE', 'MAR', 'PAR'],
  germany: ['BER', 'KIE', 'MUN'],
  italy: ['NAP', 'ROM', 'VEN'],
  russia: ['MOS', 'SEV', 'STP', 'WAR'],
  turkey: ['ANK', 'CON', 'SMY'],
};

const INITIAL_UNITS = {
  austria: [
    ['army', 'BUD'],
    ['fleet', 'TRI'],
    ['army', 'VIE'],
  ],
  england: [
    ['fleet', 'EDI'],
    ['fleet', 'LON'],
    ['army', 'LVP'],
  ],
  france: [
    ['fleet', 'BRE'],
    ['army', 'MAR'],
    ['army', 'PAR'],
  ],
  germany: [
    ['army', 'BER'],
    ['fleet', 'KIE'],
    ['army', 'MUN'],
  ],
  italy: [
    ['fleet', 'NAP'],
    ['army', 'ROM'],
    ['army', 'VEN'],
  ],
  russia: [
    ['army', 'MOS'],
    ['fleet', 'SEV'],
    ['fleet', 'STP/sc'],
    ['army', 'WAR'],
  ],
  turkey: [
    ['fleet', 'ANK'],
    ['army', 'CON'],
    ['army', 'SMY'],
  ],
};

const SEA_PROVINCES = [
  'ADR', 'AEG', 'BAL', 'BAR', 'BLA', 'BOT', 'EAS', 'ENG', 'GOL',
  'HEL', 'ION', 'IRI', 'MAO', 'NAO', 'NTH', 'NWG', 'SKA', 'TYS', 'WES',
];

const PROVINCES = {
  ADR: { name: 'Adriatic Sea', type: 'sea', x: 627, y: 646 },
  AEG: { name: 'Aegean Sea', type: 'sea', x: 790, y: 720 },
  ALB: { name: 'Albania', type: 'coast', x: 670, y: 660 },
  ANK: { name: 'Ankara', type: 'coast', supply: true, home: 'turkey', x: 928, y: 622 },
  APU: { name: 'Apulia', type: 'coast', x: 590, y: 693 },
  ARM: { name: 'Armenia', type: 'coast', x: 980, y: 558 },
  BAL: { name: 'Baltic Sea', type: 'sea', x: 590, y: 352 },
  BAR: { name: 'Barents Sea', type: 'sea', x: 548, y: 70 },
  BEL: { name: 'Belgium', type: 'coast', supply: true, x: 392, y: 470 },
  BER: { name: 'Berlin', type: 'coast', supply: true, home: 'germany', x: 575, y: 423 },
  BLA: { name: 'Black Sea', type: 'sea', x: 875, y: 608 },
  BOH: { name: 'Bohemia', type: 'land', x: 595, y: 548 },
  BOT: { name: 'Gulf of Bothnia', type: 'sea', x: 640, y: 248 },
  BRE: { name: 'Brest', type: 'coast', supply: true, home: 'france', x: 255, y: 522 },
  BUD: { name: 'Budapest', type: 'land', supply: true, home: 'austria', x: 685, y: 565 },
  BUL: { name: 'Bulgaria', type: 'coast', supply: true, x: 800, y: 638 },
  BUR: { name: 'Burgundy', type: 'land', x: 430, y: 552 },
  CLY: { name: 'Clyde', type: 'coast', x: 212, y: 222 },
  CON: { name: 'Constantinople', type: 'coast', supply: true, home: 'turkey', x: 862, y: 668 },
  DEN: { name: 'Denmark', type: 'coast', supply: true, x: 505, y: 336 },
  EAS: { name: 'Eastern Mediterranean', type: 'sea', x: 890, y: 765 },
  EDI: { name: 'Edinburgh', type: 'coast', supply: true, home: 'england', x: 255, y: 255 },
  ENG: { name: 'English Channel', type: 'sea', x: 265, y: 432 },
  FIN: { name: 'Finland', type: 'coast', x: 690, y: 205 },
  GAL: { name: 'Galicia', type: 'land', x: 720, y: 505 },
  GAS: { name: 'Gascony', type: 'coast', x: 315, y: 606 },
  GOL: { name: 'Gulf of Lyon', type: 'sea', x: 407, y: 718 },
  GRE: { name: 'Greece', type: 'coast', supply: true, x: 722, y: 707 },
  HEL: { name: 'Helgoland Bight', type: 'sea', x: 430, y: 385 },
  HOL: { name: 'Holland', type: 'coast', supply: true, x: 438, y: 435 },
  ION: { name: 'Ionian Sea', type: 'sea', x: 650, y: 760 },
  IRI: { name: 'Irish Sea', type: 'sea', x: 160, y: 392 },
  KIE: { name: 'Kiel', type: 'coast', supply: true, home: 'germany', x: 506, y: 415 },
  LON: { name: 'London', type: 'coast', supply: true, home: 'england', x: 302, y: 382 },
  LVN: { name: 'Livonia', type: 'coast', x: 735, y: 363 },
  LVP: { name: 'Liverpool', type: 'coast', supply: true, home: 'england', x: 220, y: 310 },
  MAO: { name: 'Mid-Atlantic Ocean', type: 'sea', x: 138, y: 610 },
  MAR: { name: 'Marseilles', type: 'coast', supply: true, home: 'france', x: 380, y: 658 },
  MOS: { name: 'Moscow', type: 'land', supply: true, home: 'russia', x: 855, y: 392 },
  MUN: { name: 'Munich', type: 'land', supply: true, home: 'germany', x: 528, y: 550 },
  NAF: { name: 'North Africa', type: 'coast', x: 350, y: 806 },
  NAO: { name: 'North Atlantic Ocean', type: 'sea', x: 80, y: 168 },
  NAP: { name: 'Naples', type: 'coast', supply: true, home: 'italy', x: 542, y: 734 },
  NWG: { name: 'Norwegian Sea', type: 'sea', x: 230, y: 122 },
  NTH: { name: 'North Sea', type: 'sea', x: 358, y: 320 },
  NWY: { name: 'Norway', type: 'coast', supply: true, x: 410, y: 190 },
  PAR: { name: 'Paris', type: 'land', supply: true, home: 'france', x: 345, y: 555 },
  PIC: { name: 'Picardy', type: 'coast', x: 340, y: 500 },
  PIE: { name: 'Piedmont', type: 'coast', x: 438, y: 640 },
  POR: { name: 'Portugal', type: 'coast', supply: true, x: 162, y: 688 },
  PRU: { name: 'Prussia', type: 'coast', x: 660, y: 396 },
  ROM: { name: 'Rome', type: 'coast', supply: true, home: 'italy', x: 478, y: 718 },
  RUH: { name: 'Ruhr', type: 'land', x: 472, y: 496 },
  RUM: { name: 'Rumania', type: 'coast', supply: true, x: 782, y: 592 },
  SER: { name: 'Serbia', type: 'land', supply: true, x: 708, y: 622 },
  SEV: { name: 'Sevastopol', type: 'coast', supply: true, home: 'russia', x: 912, y: 526 },
  SIL: { name: 'Silesia', type: 'land', x: 632, y: 496 },
  SKA: { name: 'Skagerrak', type: 'sea', x: 468, y: 270 },
  SMY: { name: 'Smyrna', type: 'coast', supply: true, home: 'turkey', x: 908, y: 720 },
  SPA: { name: 'Spain', type: 'coast', supply: true, x: 270, y: 700 },
  STP: { name: 'St. Petersburg', type: 'coast', supply: true, home: 'russia', x: 765, y: 155 },
  SWE: { name: 'Sweden', type: 'coast', supply: true, x: 542, y: 260 },
  SYR: { name: 'Syria', type: 'coast', x: 980, y: 782 },
  TRI: { name: 'Trieste', type: 'coast', supply: true, home: 'austria', x: 620, y: 628 },
  TUN: { name: 'Tunis', type: 'coast', supply: true, x: 505, y: 808 },
  TUS: { name: 'Tuscany', type: 'coast', x: 462, y: 682 },
  TYS: { name: 'Tyrrhenian Sea', type: 'sea', x: 520, y: 780 },
  TYR: { name: 'Tyrolia', type: 'land', x: 552, y: 625 },
  UKR: { name: 'Ukraine', type: 'land', x: 812, y: 510 },
  VEN: { name: 'Venice', type: 'coast', supply: true, home: 'italy', x: 520, y: 670 },
  VIE: { name: 'Vienna', type: 'land', supply: true, home: 'austria', x: 625, y: 560 },
  WAL: { name: 'Wales', type: 'coast', x: 238, y: 370 },
  WAR: { name: 'Warsaw', type: 'land', supply: true, home: 'russia', x: 745, y: 455 },
  WES: { name: 'Western Mediterranean', type: 'sea', x: 305, y: 770 },
  YOR: { name: 'Yorkshire', type: 'coast', x: 286, y: 318 },
};

const ARMY_ADJACENCY = {
  ALB: ['TRI', 'SER', 'GRE'],
  ANK: ['ARM', 'CON', 'SMY'],
  APU: ['VEN', 'ROM', 'NAP'],
  ARM: ['ANK', 'SMY', 'SYR', 'SEV'],
  BEL: ['HOL', 'RUH', 'BUR', 'PIC'],
  BER: ['KIE', 'MUN', 'SIL', 'PRU'],
  BOH: ['MUN', 'SIL', 'GAL', 'VIE', 'TYR'],
  BRE: ['PIC', 'PAR', 'GAS'],
  BUD: ['VIE', 'GAL', 'RUM', 'SER', 'TRI'],
  BUL: ['SER', 'RUM', 'CON', 'GRE'],
  BUR: ['PAR', 'PIC', 'BEL', 'RUH', 'MUN', 'MAR', 'GAS'],
  CLY: ['EDI', 'LVP'],
  CON: ['BUL', 'ANK', 'SMY'],
  DEN: ['KIE', 'SWE'],
  EDI: ['CLY', 'LVP', 'YOR'],
  FIN: ['STP', 'NWY', 'SWE'],
  GAL: ['WAR', 'UKR', 'RUM', 'BUD', 'VIE', 'BOH', 'SIL'],
  GAS: ['BRE', 'PAR', 'BUR', 'MAR', 'SPA'],
  GRE: ['ALB', 'SER', 'BUL'],
  HOL: ['BEL', 'RUH', 'KIE'],
  KIE: ['HOL', 'RUH', 'MUN', 'BER', 'DEN'],
  LON: ['WAL', 'YOR'],
  LVN: ['STP', 'MOS', 'WAR', 'PRU'],
  LVP: ['CLY', 'EDI', 'YOR', 'WAL'],
  MAR: ['SPA', 'GAS', 'BUR', 'PIE'],
  MOS: ['STP', 'LVN', 'WAR', 'UKR', 'SEV'],
  MUN: ['RUH', 'KIE', 'BER', 'SIL', 'BOH', 'TYR', 'BUR'],
  NAF: ['TUN'],
  NAP: ['ROM', 'APU'],
  NWY: ['STP', 'FIN', 'SWE'],
  PAR: ['BRE', 'PIC', 'BUR', 'GAS'],
  PIC: ['BRE', 'PAR', 'BUR', 'BEL'],
  PIE: ['MAR', 'TYR', 'TUS', 'VEN'],
  POR: ['SPA'],
  PRU: ['BER', 'SIL', 'WAR', 'LVN'],
  ROM: ['TUS', 'VEN', 'APU', 'NAP'],
  RUH: ['HOL', 'KIE', 'MUN', 'BUR', 'BEL'],
  RUM: ['UKR', 'GAL', 'BUD', 'SER', 'BUL', 'SEV'],
  SER: ['TRI', 'BUD', 'RUM', 'BUL', 'GRE', 'ALB'],
  SEV: ['MOS', 'UKR', 'RUM', 'ARM'],
  SIL: ['BER', 'PRU', 'WAR', 'GAL', 'BOH', 'MUN'],
  SMY: ['CON', 'ANK', 'ARM', 'SYR'],
  SPA: ['POR', 'GAS', 'MAR'],
  STP: ['NWY', 'FIN', 'LVN', 'MOS'],
  SWE: ['NWY', 'FIN', 'DEN'],
  SYR: ['SMY', 'ARM'],
  TRI: ['VEN', 'TYR', 'VIE', 'BUD', 'SER', 'ALB'],
  TUN: ['NAF'],
  TUS: ['PIE', 'VEN', 'ROM'],
  TYR: ['MUN', 'BOH', 'VIE', 'TRI', 'VEN', 'PIE'],
  UKR: ['WAR', 'MOS', 'SEV', 'RUM', 'GAL'],
  VEN: ['PIE', 'TYR', 'TRI', 'TUS', 'ROM', 'APU'],
  VIE: ['TYR', 'BOH', 'GAL', 'BUD', 'TRI'],
  WAL: ['LVP', 'YOR', 'LON'],
  WAR: ['LVN', 'MOS', 'UKR', 'GAL', 'SIL', 'PRU'],
  YOR: ['EDI', 'LVP', 'WAL', 'LON'],
};

const FLEET_ADJACENCY = {
  ADR: ['VEN', 'TRI', 'ALB', 'ION', 'APU'],
  AEG: ['GRE', 'BUL', 'CON', 'SMY', 'EAS', 'ION'],
  ALB: ['TRI', 'ADR', 'ION', 'GRE'],
  ANK: ['BLA', 'ARM', 'CON'],
  APU: ['VEN', 'ADR', 'ION', 'NAP'],
  ARM: ['BLA', 'ANK', 'SEV'],
  BAL: ['SWE', 'DEN', 'KIE', 'BER', 'PRU', 'LVN', 'BOT'],
  BAR: ['NWG', 'NWY', 'STP'],
  BEL: ['ENG', 'NTH', 'HOL', 'PIC'],
  BER: ['KIE', 'BAL', 'PRU'],
  BLA: ['BUL', 'RUM', 'SEV', 'ARM', 'ANK', 'CON'],
  BOT: ['SWE', 'FIN', 'STP', 'LVN', 'BAL'],
  BRE: ['ENG', 'MAO', 'PIC', 'GAS'],
  BUL: ['BLA', 'RUM', 'CON', 'AEG', 'GRE'], // union of BUL/ec + BUL/sc
  CLY: ['NAO', 'NWG', 'EDI', 'LVP'],
  CON: ['BLA', 'ANK', 'SMY', 'AEG', 'BUL'],
  DEN: ['NTH', 'SKA', 'SWE', 'BAL', 'KIE', 'HEL'],
  EAS: ['AEG', 'ION', 'SMY', 'SYR'],
  EDI: ['NWG', 'NTH', 'YOR', 'CLY', 'LVP'],
  ENG: ['LON', 'WAL', 'BRE', 'PIC', 'BEL', 'NTH', 'IRI', 'MAO'],
  FIN: ['BOT', 'STP', 'SWE'],
  GAS: ['MAO', 'BRE', 'SPA'],
  GOL: ['SPA', 'MAR', 'PIE', 'TUS', 'TYS', 'WES'],
  GRE: ['ION', 'AEG', 'ALB', 'BUL'],
  HEL: ['HOL', 'KIE', 'DEN', 'NTH', 'SKA'],
  HOL: ['NTH', 'HEL', 'KIE', 'BEL'],
  ION: ['TYS', 'TUN', 'NAP', 'APU', 'ADR', 'ALB', 'GRE', 'AEG', 'EAS'],
  IRI: ['NAO', 'MAO', 'ENG', 'WAL', 'LVP'],
  KIE: ['HEL', 'BAL', 'DEN', 'HOL', 'BER'],
  LON: ['NTH', 'ENG', 'WAL', 'YOR'],
  LVN: ['BAL', 'BOT', 'PRU', 'STP'],
  LVP: ['NAO', 'IRI', 'WAL', 'CLY', 'EDI'],
  MAO: ['NAO', 'IRI', 'ENG', 'BRE', 'GAS', 'SPA', 'POR', 'WES', 'NAF'],
  MAR: ['SPA', 'GOL', 'PIE'],
  NAF: ['MAO', 'WES', 'TUN'],
  NAO: ['NWG', 'CLY', 'LVP', 'IRI', 'MAO'],
  NAP: ['TYS', 'ION', 'APU', 'ROM'],
  NWG: ['NAO', 'CLY', 'EDI', 'NTH', 'NWY', 'BAR'],
  NTH: ['NWG', 'NWY', 'SKA', 'DEN', 'HEL', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI'],
  NWY: ['NWG', 'NTH', 'SKA', 'SWE', 'BAR', 'STP'],
  PIC: ['ENG', 'BEL', 'BRE'],
  PIE: ['MAR', 'GOL', 'TUS'],
  POR: ['MAO', 'SPA'],
  PRU: ['BER', 'BAL', 'LVN'],
  ROM: ['TUS', 'TYS', 'NAP'],
  RUM: ['BLA', 'BUL', 'SEV'],
  SEV: ['BLA', 'RUM', 'ARM'],
  SKA: ['NWY', 'SWE', 'DEN', 'NTH', 'HEL'],
  SMY: ['CON', 'AEG', 'EAS', 'SYR'],
  SPA: ['MAO', 'GAS', 'POR', 'WES', 'GOL', 'MAR'], // union of SPA/nc + SPA/sc
  STP: ['BAR', 'NWY', 'BOT', 'FIN', 'LVN'], // union of STP/nc + STP/sc
  SWE: ['NWY', 'SKA', 'DEN', 'BAL', 'BOT', 'FIN'],
  SYR: ['EAS', 'SMY'],
  TRI: ['VEN', 'ADR', 'ALB'],
  TUN: ['NAF', 'WES', 'TYS', 'ION'],
  TUS: ['PIE', 'GOL', 'TYS', 'ROM', 'VEN'],
  TYS: ['WES', 'GOL', 'TUS', 'ROM', 'NAP', 'TUN', 'ION'],
  VEN: ['TRI', 'ADR', 'APU', 'TUS'],
  WAL: ['LVP', 'IRI', 'ENG', 'LON'],
  WES: ['MAO', 'SPA', 'GOL', 'TYS', 'TUN', 'NAF'],
  YOR: ['EDI', 'NTH', 'LON'],
};

// Split-coast provinces. Each has two separate, non-connected coasts; a fleet
// must commit to one. Armies, ownership, and the map node always use the bare
// base id -- the coast suffix is a fleet-location refinement only.
const COAST_PROVINCES = { STP: ['nc', 'sc'], SPA: ['nc', 'sc'], BUL: ['ec', 'sc'] };

// Per-coast fleet adjacency for the split-coast provinces (canonical 1901 map).
// Keyed by coast loc; the base FLEET_ADJACENCY entries hold the union of these
// for army-independent reverse lookups and convoy BFS over base ids.
const FLEET_COAST_ADJACENCY = {
  'STP/nc': ['BAR', 'NWY'],
  'STP/sc': ['BOT', 'FIN', 'LVN'],
  'SPA/nc': ['MAO', 'GAS', 'POR'],
  'SPA/sc': ['MAO', 'POR', 'WES', 'GOL', 'MAR'],
  'BUL/ec': ['BLA', 'RUM', 'CON'],
  'BUL/sc': ['AEG', 'CON', 'GRE'],
};

// When a legacy serialized state lacks a coast suffix on a split-coast fleet,
// normalize to the canonical default coast for that province.
const DEFAULT_COAST = { STP: 'sc', SPA: 'sc', BUL: 'sc' };

function baseProvince(loc) {
  if (typeof loc !== 'string') return loc;
  const slash = loc.indexOf('/');
  return slash === -1 ? loc : loc.slice(0, slash);
}

function coastOf(loc) {
  if (typeof loc !== 'string') return null;
  const slash = loc.indexOf('/');
  return slash === -1 ? null : loc.slice(slash + 1);
}

function isSplitCoast(base) {
  return Object.prototype.hasOwnProperty.call(COAST_PROVINCES, base);
}

const ALL_PROVINCES = Object.keys(PROVINCES).sort();
const SUPPLY_CENTERS = ALL_PROVINCES.filter(id => PROVINCES[id].supply);
const SEA_SET = new Set(SEA_PROVINCES);

function uniq(values) {
  return [...new Set(values)];
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function cloneOrder(order) {
  return order ? { ...order } : null;
}

function orderKey(order) {
  if (!order) return 'null';
  switch (order.type) {
    case 'hold':
      return `H:${order.unitLoc}`;
    case 'move':
      return `M:${order.unitLoc}>${order.to}${order.viaConvoy ? ':C' : ''}`;
    case 'support-hold':
      return `SH:${order.unitLoc}:${order.target}`;
    case 'support-move':
      return `SM:${order.unitLoc}:${order.from}>${order.to}`;
    case 'convoy':
      return `C:${order.unitLoc}:${order.from}>${order.to}`;
    case 'retreat':
      return `R:${order.unitLoc}>${order.to || 'DISBAND'}`;
    case 'build':
      return `B:${order.power}:${order.unitType}:${order.loc}`;
    case 'disband':
      return `D:${order.unitLoc}`;
    default:
      return JSON.stringify(order);
  }
}

function formatUnitType(type) {
  return type === 'fleet' ? 'F' : 'A';
}

function isSea(loc) {
  return SEA_SET.has(baseProvince(loc));
}

function isLandOrCoast(loc) {
  const base = baseProvince(loc);
  return !!PROVINCES[base] && !isSea(base);
}

function unitCanOccupy(unitType, loc) {
  const base = baseProvince(loc);
  if (!PROVINCES[base]) return false;
  // A coast suffix only ever applies to a fleet on a split-coast province.
  if (coastOf(loc) && !(unitType === 'fleet' && isSplitCoast(base))) return false;
  if (unitType === 'army') return isLandOrCoast(base);
  return PROVINCES[base].type === 'sea' || PROVINCES[base].type === 'coast';
}

function adjacencyFor(unitType, loc) {
  if (unitType === 'fleet') {
    if (FLEET_COAST_ADJACENCY[loc]) return FLEET_COAST_ADJACENCY[loc];
    return FLEET_ADJACENCY[baseProvince(loc)] || [];
  }
  return ARMY_ADJACENCY[baseProvince(loc)] || [];
}

function emptyCenterOwners() {
  const owners = {};
  for (const center of SUPPLY_CENTERS) {
    owners[center] = PROVINCES[center].home || null;
  }
  return owners;
}

function initialUnits() {
  const units = {};
  for (const power of POWERS) {
    for (const [type, loc] of INITIAL_UNITS[power]) {
      units[loc] = { power, type };
    }
  }
  return units;
}

function phaseAfterMovement(season) {
  return season === 'spring' ? 'fall-orders' : 'winter-build';
}

export default class DiplomacyBoard {
  static POWERS = POWERS;
  static POWER_NAMES = POWER_NAMES;
  static POWER_SHORT_NAMES = POWER_SHORT_NAMES;
  static POWER_COLORS = POWER_COLORS;
  static POWER_ACCENTS = POWER_ACCENTS;
  static PROVINCES = PROVINCES;
  static SUPPLY_CENTERS = SUPPLY_CENTERS;
  static HOME_CENTERS = HOME_CENTERS;

  constructor({ skipInitialHistory = false, maxYears = 1912 } = {}) {
    this.powers = [...POWERS];
    this.units = initialUnits();
    this.supplyCenters = emptyCenterOwners();
    this.phase = 'spring-orders';
    this.season = 'spring';
    this.year = 1901;
    this.turnNumber = 1;
    this.maxYears = maxYears;
    this.winner = null;
    this.winningCenters = 0;
    this.lastAction = 'Spring 1901 orders are open.';
    this.orderHistory = [];
    this.pendingRetreats = [];
    this.contestedProvinces = [];
    this.adjustments = this.getAdjustments();
    this.stateHistory = [];
    this.historyIndex = -1;
    this.maxHistoryLength = 80;

    if (!skipInitialHistory) this._captureState();
  }

  clone() {
    return DiplomacyBoard.fromSerializedState(this.serializeState());
  }

  startNewGame() {
    const next = new DiplomacyBoard();
    Object.assign(this, next);
    this._captureState();
  }

  getPowerIds() {
    return this.powers.filter(power => this.getUnitLocations(power).length > 0 || this.getSupplyCount(power) > 0);
  }

  getProvince(id) {
    return PROVINCES[baseProvince(id)] || null;
  }

  // Occupancy lookup by base province id. A fleet on a split coast is keyed by
  // its coast loc (e.g. 'STP/sc'); this resolves it from the bare base id.
  unitAt(base) {
    if (this.units[base]) return this.units[base];
    if (isSplitCoast(base)) {
      for (const coast of COAST_PROVINCES[base]) {
        const loc = `${base}/${coast}`;
        if (this.units[loc]) return this.units[loc];
      }
    }
    return undefined;
  }

  // The stored unit key (possibly coast-suffixed) occupying a base province.
  unitLocAt(base) {
    if (this.units[base]) return base;
    if (isSplitCoast(base)) {
      for (const coast of COAST_PROVINCES[base]) {
        const loc = `${base}/${coast}`;
        if (this.units[loc]) return loc;
      }
    }
    return null;
  }

  getUnitLocations(power = null) {
    return sorted(Object.entries(this.units)
      .filter(([, unit]) => !power || unit.power === power)
      .map(([loc]) => loc));
  }

  getUnits(power = null) {
    return this.getUnitLocations(power).map(loc => ({ loc, ...this.units[loc] }));
  }

  getSupplyCenters(power = null) {
    return sorted(Object.entries(this.supplyCenters)
      .filter(([, owner]) => !power || owner === power)
      .map(([loc]) => loc));
  }

  getSupplyCount(power) {
    return this.getSupplyCenters(power).length;
  }

  getScore(power) {
    return this.getSupplyCount(power);
  }

  getUnitCount(power) {
    return this.getUnitLocations(power).length;
  }

  getLeader() {
    return this.powers
      .map(power => ({ power, centers: this.getSupplyCount(power), units: this.getUnitCount(power) }))
      .sort((a, b) => b.centers - a.centers || b.units - a.units || a.power.localeCompare(b.power))[0];
  }

  isOrdersPhase() {
    return this.phase === 'spring-orders' || this.phase === 'fall-orders';
  }

  isRetreatPhase() {
    return this.phase === 'spring-retreats' || this.phase === 'fall-retreats';
  }

  isWinterPhase() {
    return this.phase === 'winter-build';
  }

  getPhaseLabel() {
    if (this.phase === 'game-over') return 'Game over';
    if (this.isWinterPhase()) return `Winter ${this.year}`;
    const season = this.season === 'spring' ? 'Spring' : 'Fall';
    if (this.isRetreatPhase()) return `${season} ${this.year} retreats`;
    return `${season} ${this.year} orders`;
  }

  canUnitMove(unitType, from, to, { viaConvoy = false, convoyOrders = null } = {}) {
    const toBase = baseProvince(to);
    if (!this.units[from] || !PROVINCES[toBase] || !unitCanOccupy(unitType, to)) return false;
    if (this._fleetOrArmyAdjacent(unitType, from, to)) return true;
    if (unitType === 'army' && viaConvoy) return this.hasConvoyPath(baseProvince(from), toBase, convoyOrders);
    return false;
  }

  // Adjacency test that understands coast-keyed locs in either position. For a
  // fleet, a coast-keyed `to` is reachable only if `from` is in that coast's
  // precise list; a bare split-coast `to` is reachable if `from` borders any
  // coast (the caller is expected to resolve to a concrete coast separately).
  _fleetOrArmyAdjacent(unitType, from, to) {
    const fromAdj = adjacencyFor(unitType, from);
    if (unitType !== 'fleet') return fromAdj.includes(baseProvince(to));
    const toCoast = coastOf(to);
    if (toCoast) {
      // `to` is a concrete coast: `from` must border exactly that coast.
      return (FLEET_COAST_ADJACENCY[to] || []).includes(baseProvince(from));
    }
    return fromAdj.includes(baseProvince(to));
  }

  canSupport(unitType, supportLoc, targetLoc) {
    if (!unitCanOccupy(unitType, targetLoc)) return false;
    return this._fleetOrArmyAdjacent(unitType, supportLoc, targetLoc);
  }

  getMoveTargets(loc, { includeConvoys = true } = {}) {
    const unit = this.units[loc];
    if (!unit) return [];
    // For fleets, expand any split-coast base destination into the concrete
    // coast variant(s) actually reachable from this loc; for the source side,
    // adjacencyFor already returns the precise per-coast list when `loc` carries
    // a coast suffix. Armies always use bare base ids.
    const direct = [];
    for (const to of adjacencyFor(unit.type, loc)) {
      if (!unitCanOccupy(unit.type, to)) continue;
      if (unit.type === 'fleet' && isSplitCoast(to)) {
        for (const coast of COAST_PROVINCES[to]) {
          const coastLoc = `${to}/${coast}`;
          if ((FLEET_COAST_ADJACENCY[coastLoc] || []).includes(baseProvince(loc))) direct.push(coastLoc);
        }
      } else {
        direct.push(to);
      }
    }
    if (unit.type !== 'army' || !includeConvoys) return sorted(direct);

    const convoyTargets = this.getConvoyTargets(loc);
    return sorted(uniq([...direct, ...convoyTargets]));
  }

  getConvoyTargets(armyLoc) {
    const unit = this.units[armyLoc];
    if (!unit || unit.type !== 'army' || !PROVINCES[armyLoc] || PROVINCES[armyLoc].type !== 'coast') return [];
    const fleetSeas = Object.entries(this.units)
      .filter(([, candidate]) => candidate.type === 'fleet')
      .map(([loc]) => loc)
      .filter(isSea);
    if (fleetSeas.length === 0) return [];

    const coastStarts = fleetSeas.filter(sea => FLEET_ADJACENCY[sea]?.includes(armyLoc));
    if (coastStarts.length === 0) return [];

    const fleetSet = new Set(fleetSeas);
    const seen = new Set(coastStarts);
    const queue = [...coastStarts];
    const reachableSeas = [];
    while (queue.length) {
      const sea = queue.shift();
      reachableSeas.push(sea);
      for (const next of FLEET_ADJACENCY[sea] || []) {
        if (!fleetSet.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    const targets = [];
    for (const sea of reachableSeas) {
      for (const loc of FLEET_ADJACENCY[sea] || []) {
        if (loc !== armyLoc && isLandOrCoast(loc) && unitCanOccupy('army', loc)) targets.push(loc);
      }
    }
    return sorted(uniq(targets));
  }

  hasConvoyPath(from, to, ordersByLoc = null) {
    if (!PROVINCES[from] || !PROVINCES[to] || PROVINCES[from].type !== 'coast' || PROVINCES[to].type !== 'coast') return false;
    const convoyFleets = Object.entries(this.units)
      .filter(([loc, unit]) => unit.type === 'fleet' && isSea(loc))
      .filter(([loc]) => {
        if (!ordersByLoc) return true;
        const order = ordersByLoc[loc];
        return order?.type === 'convoy' && order.from === from && order.to === to;
      })
      .map(([loc]) => loc);
    const fleetSet = new Set(convoyFleets);
    const starts = convoyFleets.filter(sea => FLEET_ADJACENCY[sea]?.includes(from));
    if (starts.length === 0) return false;
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const sea = queue.shift();
      if (FLEET_ADJACENCY[sea]?.includes(to)) return true;
      for (const next of FLEET_ADJACENCY[sea] || []) {
        if (!fleetSet.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  getLegalOrdersForUnit(loc, { includeSupport = true, includeConvoys = true } = {}) {
    const unit = this.units[loc];
    if (!unit) return [];
    const orders = [{ type: 'hold', unitLoc: loc }];
    for (const to of this.getMoveTargets(loc, { includeConvoys })) {
      orders.push({
        type: 'move',
        unitLoc: loc,
        to,
        viaConvoy: unit.type === 'army' && !adjacencyFor('army', loc).includes(to),
      });
    }
    if (!includeSupport) return orders;

    const adjacentOccupied = sorted(Object.keys(this.units).filter(target => target !== loc && this.canSupport(unit.type, loc, target)));
    for (const target of adjacentOccupied) {
      orders.push({ type: 'support-hold', unitLoc: loc, target });
    }

    // A unit may support ANY unit's move (own or another power's) into a
    // province it can reach — supporting an ally's (or a rival's) attack is core
    // Diplomacy. Emit every legal support-move; the count is naturally bounded by
    // geography, so it is NOT truncated (a prior cap silently dropped legal
    // supports — often the opponent ones — in dense mid-game positions).
    //
    // Support is always INTO THE BASE PROVINCE: a fleet's move to a split-coast
    // destination (e.g. RUM -> BUL/ec) is supported by any unit adjacent to the
    // base (BUL) — so we test canSupport against, and store, the base province
    // (deduping the two coasts of a split-coast destination).
    const seenSupport = new Set();
    for (const [from, movingUnit] of Object.entries(this.units)) {
      if (from === loc) continue;
      for (const to of this.getMoveTargets(from, { includeConvoys: false })) {
        const toBase = baseProvince(to);
        if (toBase === baseProvince(from) || !this.canSupport(unit.type, loc, toBase)) continue;
        if (!this.canUnitMove(movingUnit.type, from, to)) continue;
        const key = `${from}|${toBase}`;
        if (seenSupport.has(key)) continue;
        seenSupport.add(key);
        orders.push({ type: 'support-move', unitLoc: loc, from, to: toBase });
      }
    }

    if (unit.type === 'fleet' && isSea(loc) && includeConvoys) {
      for (const [from, movingUnit] of Object.entries(this.units)) {
        if (movingUnit.type !== 'army' || !FLEET_ADJACENCY[loc]?.includes(from)) continue;
        for (const to of ALL_PROVINCES) {
          if (to === from || !isLandOrCoast(to) || !FLEET_ADJACENCY[loc]?.includes(to)) continue;
          orders.push({ type: 'convoy', unitLoc: loc, from, to });
        }
      }
    }

    return orders;
  }

  getLegalOrders(power) {
    return Object.fromEntries(this.getUnitLocations(power).map(loc => [loc, this.getLegalOrdersForUnit(loc)]));
  }

  getRetreatOptions(unitLoc) {
    const retreat = this.pendingRetreats.find(entry => entry.unitLoc === unitLoc);
    return retreat ? [...retreat.options] : [];
  }

  getAdjustments() {
    const adjustments = {};
    for (const power of POWERS) {
      const centers = this.getSupplyCount(power);
      const units = this.getUnitCount(power);
      const delta = centers - units;
      const openHomes = HOME_CENTERS[power].filter(loc => this.supplyCenters[loc] === power && !this.unitAt(loc));
      adjustments[power] = {
        delta,
        openHomes,
        buildCount: Math.max(0, Math.min(delta, openHomes.length)),
        disbandCount: Math.max(0, -delta),
      };
    }
    return adjustments;
  }

  getLegalAdjustmentOrders(power) {
    const adjustment = this.getAdjustments()[power];
    if (!adjustment) return [];
    if (adjustment.delta > 0) {
      const orders = [];
      for (const loc of adjustment.openHomes) {
        orders.push({ type: 'build', power, unitType: 'army', loc });
        if (PROVINCES[loc].type !== 'coast') continue;
        // A fleet build in a split-coast home must commit to a coast: emit one
        // build option per coast. Non-split coastal homes emit exactly one.
        if (isSplitCoast(loc)) {
          for (const coast of COAST_PROVINCES[loc]) {
            orders.push({ type: 'build', power, unitType: 'fleet', loc: `${loc}/${coast}` });
          }
        } else {
          orders.push({ type: 'build', power, unitType: 'fleet', loc });
        }
      }
      return orders;
    }
    if (adjustment.delta < 0) {
      return this.getUnitLocations(power).map(unitLoc => ({ type: 'disband', unitLoc }));
    }
    return [];
  }

  getLegalMoves(power, options = {}) {
    if (this.isOrdersPhase()) return this.generateCandidatePlans(power, options);
    if (this.isRetreatPhase()) return this.generateRetreatPlans(power);
    if (this.isWinterPhase()) return this.generateAdjustmentPlans(power);
    return [];
  }

  generateCandidatePlans(power, { maxPlans = 48, includeSupport = true } = {}) {
    const locs = this.getUnitLocations(power);
    if (locs.length === 0) return [{ type: 'orders-plan', power, orders: [] }];
    let beam = [{ orders: [], score: 0 }];
    for (const loc of locs) {
      const scored = this.getLegalOrdersForUnit(loc, { includeSupport, includeConvoys: true })
        .map(order => ({ order, score: this.scoreOrder(order, power) }))
        .sort((a, b) => b.score - a.score);
      // Keep a DIVERSE shortlist so a flood of (often cross-power) support
      // options can't crowd moves out of the search: the best moves AND the best
      // supports both always make the cut. Without this a unit that can't reach
      // a centre in one step would only ever consider supporting — and freeze.
      const pick = (pred, n) => scored.filter(c => pred(c.order.type)).slice(0, n);
      const candidates = [
        ...pick(t => t === 'move', 6),
        ...pick(t => t === 'support-move' || t === 'support-hold', 4),
        ...pick(t => t === 'convoy', 1),
        ...pick(t => t === 'hold', 1),
      ].sort((a, b) => b.score - a.score);
      const nextBeam = [];
      for (const entry of beam) {
        for (const candidate of candidates) {
          const orders = [...entry.orders, candidate.order];
          nextBeam.push({ orders, score: entry.score + candidate.score + this._planSynergy(orders, power) });
        }
      }
      beam = nextBeam
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(maxPlans * 2, 16));
    }

    const seen = new Set();
    const plans = [];
    for (const entry of beam.sort((a, b) => b.score - a.score)) {
      const key = entry.orders.map(orderKey).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      plans.push({ type: 'orders-plan', power, orders: entry.orders, score: entry.score });
      if (plans.length >= maxPlans) break;
    }
    return plans.length ? plans : [{ type: 'orders-plan', power, orders: locs.map(unitLoc => ({ type: 'hold', unitLoc })) }];
  }

  generateRetreatPlans(power) {
    const retreats = this.pendingRetreats.filter(entry => entry.unit.power === power);
    if (retreats.length === 0) return [{ type: 'retreats-plan', power, retreats: [] }];
    let plans = [{ retreats: [], score: 0 }];
    for (const retreat of retreats) {
      const candidates = [
        ...retreat.options.map(to => ({ type: 'retreat', unitLoc: retreat.unitLoc, to })),
        { type: 'retreat', unitLoc: retreat.unitLoc, to: null },
      ].map(order => ({ order, score: order.to ? this.provinceValue(power, order.to) : -220 }));
      const next = [];
      for (const plan of plans) {
        for (const candidate of candidates) {
          next.push({ retreats: [...plan.retreats, candidate.order], score: plan.score + candidate.score });
        }
      }
      plans = next.sort((a, b) => b.score - a.score).slice(0, 16);
    }
    return plans.map(plan => ({ type: 'retreats-plan', power, retreats: plan.retreats, score: plan.score }));
  }

  generateAdjustmentPlans(power) {
    const adjustment = this.getAdjustments()[power];
    if (!adjustment || adjustment.delta === 0) return [{ type: 'adjustments-plan', power, adjustments: [] }];
    const legal = this.getLegalAdjustmentOrders(power);
    if (adjustment.delta > 0) {
      const byLoc = legal
        .map(order => ({ order, score: this.provinceValue(power, order.loc) + (order.unitType === 'fleet' ? 18 : 0) }))
        .sort((a, b) => b.score - a.score);
      const selected = [];
      const used = new Set();
      for (const entry of byLoc) {
        // Dedupe by base province so a split-coast home yields at most one build.
        const base = baseProvince(entry.order.loc);
        if (used.has(base)) continue;
        selected.push(entry.order);
        used.add(base);
        if (selected.length >= adjustment.buildCount) break;
      }
      return [{ type: 'adjustments-plan', power, adjustments: selected }];
    }
    return [{
      type: 'adjustments-plan',
      power,
      adjustments: legal
        .map(order => ({ order, score: this.provinceValue(power, order.unitLoc) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, adjustment.disbandCount)
        .map(entry => entry.order),
    }];
  }

  provinceValue(power, loc) {
    const base = baseProvince(loc);
    const province = PROVINCES[base];
    if (!province) return 0;
    let score = province.supply ? 260 : 28;
    const owner = this.supplyCenters[base];
    const occupant = this.unitAt(base);
    if (province.supply && owner === power) score += 120;
    if (province.supply && owner && owner !== power) score += 360 + Math.max(0, this.getSupplyCount(owner) - this.getSupplyCount(power)) * 22;
    if (province.supply && !owner) score += 300;
    if (province.home === power) score += 95;
    if (occupant?.power === power) score += 35;
    if (occupant && occupant.power !== power) score += 80;
    const adjacentEnemyCenters = adjacencyFor(province.type === 'sea' ? 'fleet' : 'army', loc)
      .filter(adj => PROVINCES[adj]?.supply && this.supplyCenters[adj] && this.supplyCenters[adj] !== power).length;
    score += adjacentEnemyCenters * 35;
    if (province.type === 'sea') score += (FLEET_ADJACENCY[base]?.filter(adj => PROVINCES[adj]?.supply).length || 0) * 20;
    return score;
  }

  scoreOrder(order, power) {
    const unit = this.units[order.unitLoc];
    if (!unit) return -1000;
    switch (order.type) {
      case 'hold': {
        const holdBase = baseProvince(order.unitLoc);
        const locValue = this.provinceValue(power, order.unitLoc);
        const ownsCenter = PROVINCES[holdBase]?.supply && this.supplyCenters[holdBase] === power;
        return (ownsCenter ? 155 : 18) + locValue * 0.12;
      }
      case 'move': {
        const toBase = baseProvince(order.to);
        let score = this.provinceValue(power, order.to);
        if (this.unitAt(toBase)?.power === power) score -= 180;
        if (this.supplyCenters[toBase] === power && !this.unitAt(toBase)) score += this.season === 'fall' ? 80 : 20;
        if (PROVINCES[toBase]?.supply && this.supplyCenters[toBase] !== power) score += this.season === 'fall' ? 260 : 140;
        if (order.viaConvoy) score += 35;
        return score;
      }
      case 'support-hold': {
        const target = this.units[order.target];
        if (!target) return -100;
        // Base kept modest so it doesn't crowd out advancing moves; a support
        // that actually matters (a threatened unit / a real attack) is rewarded
        // by _planSynergy and the forward-model evaluation, not the base score.
        return target.power === power
          ? 60 + this.provinceValue(power, order.target) * 0.3
          : 28 + this.provinceValue(target.power, order.target) * 0.08;
      }
      case 'support-move': {
        const mover = this.units[order.from];
        if (!mover) return -100;
        const friendly = mover.power === power;
        const targetOwner = this.supplyCenters[baseProvince(order.to)];
        return (friendly ? 85 : 38) + this.provinceValue(power, order.to) * (friendly ? 0.55 : 0.18) + (targetOwner && targetOwner !== power ? 90 : 0);
      }
      case 'convoy':
        return 125 + this.provinceValue(power, order.to) * 0.3;
      default:
        return 0;
    }
  }

  _planSynergy(orders, power) {
    let score = 0;
    const moves = orders.filter(order => order.type === 'move');
    const supports = orders.filter(order => order.type === 'support-move' || order.type === 'support-hold');
    const targets = new Map();
    for (const move of moves) {
      const toBase = baseProvince(move.to);
      targets.set(toBase, (targets.get(toBase) || 0) + 1);
      if (PROVINCES[toBase]?.supply && this.supplyCenters[toBase] !== power) score += 45;
    }
    for (const count of targets.values()) {
      if (count > 1) score -= (count - 1) * 180;
    }
    for (const support of supports) {
      // A support-move that actually backs one of THIS plan's moves is the heart
      // of a coordinated attack — reward it strongly.
      if (support.type === 'support-move' && moves.some(move => move.unitLoc === support.from && baseProvince(move.to) === baseProvince(support.to))) score += 140;
      // Defending a held friendly unit is only mildly useful and shouldn't make
      // an all-support, no-move plan win (that froze passive powers).
      if (support.type === 'support-hold' && this.units[support.target]?.power === power) score += 25;
    }
    return score;
  }

  applyMove(move) {
    if (!move || this.phase === 'game-over') return false;
    if (move.type === 'orders') return this.processOrders(move.ordersByPower || {});
    if (move.type === 'retreats') return this.processRetreats(move.retreatsByPower || {});
    if (move.type === 'adjustments') return this.processAdjustments(move.adjustmentsByPower || {});
    return false;
  }

  processOrders(ordersByPower) {
    if (!this.isOrdersPhase()) return false;
    const ordersByLoc = this._normalizeOrders(ordersByPower);
    // Capture the acting power per order location BEFORE units move, so the
    // order history can attribute each order to a power (used by the agents'
    // board context, since orders are public knowledge once resolved).
    const ownerByLoc = {};
    for (const loc of Object.keys(ordersByLoc)) {
      if (this.units[loc]) ownerByLoc[loc] = this.units[loc].power;
    }
    const adjudication = this._adjudicate(ordersByLoc);
    this.units = adjudication.units;
    this.pendingRetreats = adjudication.pendingRetreats;
    this.contestedProvinces = [...adjudication.contestedProvinces];
    this.orderHistory.unshift({
      phase: this.getPhaseLabel(),
      orders: Object.fromEntries(Object.entries(ordersByLoc).map(([loc, order]) => [loc, { ...cloneOrder(order), power: ownerByLoc[loc] || null }])),
      resolved: adjudication.resolved,
      retreats: this.pendingRetreats.map(entry => ({ ...entry, unit: { ...entry.unit }, options: [...entry.options] })),
    });
    this.orderHistory = this.orderHistory.slice(0, 12);

    if (this.pendingRetreats.length > 0) {
      this.phase = `${this.season}-retreats`;
      this.lastAction = `${this.pendingRetreats.length} unit${this.pendingRetreats.length === 1 ? '' : 's'} dislodged.`;
    } else {
      this._advanceAfterMovement();
    }

    this._captureState();
    return true;
  }

  processRetreats(retreatsByPower) {
    if (!this.isRetreatPhase()) return false;
    const byUnit = {};
    for (const [power, retreats] of Object.entries(retreatsByPower || {})) {
      for (const retreat of retreats || []) {
        const pending = this.pendingRetreats.find(entry => entry.unitLoc === retreat.unitLoc && entry.unit.power === power);
        if (!pending) continue;
        byUnit[retreat.unitLoc] = { type: 'retreat', unitLoc: retreat.unitLoc, to: retreat.to || null };
      }
    }

    // Two fleets retreating to different coasts of the same province still
    // collide on the base node, so count contention by base province.
    const destinationCounts = {};
    for (const pending of this.pendingRetreats) {
      const retreat = byUnit[pending.unitLoc] || { type: 'retreat', unitLoc: pending.unitLoc, to: null };
      if (retreat.to && pending.options.includes(retreat.to)) {
        const base = baseProvince(retreat.to);
        destinationCounts[base] = (destinationCounts[base] || 0) + 1;
      }
    }

    const logs = [];
    for (const pending of this.pendingRetreats) {
      const retreat = byUnit[pending.unitLoc] || { type: 'retreat', unitLoc: pending.unitLoc, to: null };
      if (retreat.to && pending.options.includes(retreat.to) && destinationCounts[baseProvince(retreat.to)] === 1 && !this.unitAt(baseProvince(retreat.to))) {
        this.units[retreat.to] = { ...pending.unit };
        logs.push(`${formatUnitType(pending.unit.type)} ${pending.unitLoc} retreats to ${retreat.to}`);
      } else {
        logs.push(`${formatUnitType(pending.unit.type)} ${pending.unitLoc} disbands`);
      }
    }

    if (this.orderHistory[0]) this.orderHistory[0].retreatResolution = logs;
    this.pendingRetreats = [];
    this.contestedProvinces = [];
    this._advanceAfterMovement();
    this._captureState();
    return true;
  }

  processAdjustments(adjustmentsByPower) {
    if (!this.isWinterPhase()) return false;
    const legalByPower = this.getAdjustments();
    const logs = [];

    for (const power of POWERS) {
      const adjustment = legalByPower[power];
      const requested = adjustmentsByPower[power] || [];
      if (adjustment.delta > 0) {
        const usedHomes = new Set();
        const builds = [];
        for (const order of requested) {
          // A fleet build may carry a coast-suffixed loc (e.g. 'STP/sc'); the
          // home/occupancy checks key off the bare base province.
          const base = baseProvince(order.loc);
          if (order.type !== 'build' || order.power !== power || usedHomes.has(base)) continue;
          if (!adjustment.openHomes.includes(base) || this.unitAt(base)) continue;
          if (!unitCanOccupy(order.unitType, order.loc)) continue;
          builds.push(order);
          usedHomes.add(base);
          if (builds.length >= adjustment.buildCount) break;
        }
        for (const order of builds) {
          this.units[order.loc] = { power, type: order.unitType };
          logs.push(`${POWER_SHORT_NAMES[power]} builds ${formatUnitType(order.unitType)} ${order.loc}`);
        }
      } else if (adjustment.delta < 0) {
        const needed = adjustment.disbandCount;
        const disbands = requested
          .filter(order => order.type === 'disband' && this.units[order.unitLoc]?.power === power)
          .map(order => order.unitLoc);
        const fallback = this.getUnitLocations(power)
          .sort((a, b) => this.provinceValue(power, a) - this.provinceValue(power, b));
        const selected = [];
        for (const loc of [...disbands, ...fallback]) {
          if (selected.includes(loc) || !this.units[loc] || this.units[loc].power !== power) continue;
          selected.push(loc);
          if (selected.length >= needed) break;
        }
        for (const loc of selected) {
          delete this.units[loc];
          logs.push(`${POWER_SHORT_NAMES[power]} disbands ${loc}`);
        }
      }
    }

    this.orderHistory.unshift({ phase: this.getPhaseLabel(), adjustments: logs });
    this.orderHistory = this.orderHistory.slice(0, 12);
    this._advanceToNextSpring();
    this._captureState();
    return true;
  }

  _normalizeOrders(ordersByPower) {
    const byLoc = {};
    for (const [loc] of Object.entries(this.units)) {
      byLoc[loc] = { type: 'hold', unitLoc: loc };
    }

    for (const [power, orders] of Object.entries(ordersByPower || {})) {
      for (const raw of orders || []) {
        const loc = raw.unitLoc;
        const unit = this.units[loc];
        if (!unit || unit.power !== power) continue;
        const order = this._sanitizeOrder(raw);
        byLoc[loc] = order || { type: 'hold', unitLoc: loc };
      }
    }
    return byLoc;
  }

  // Normalize a move's destination to a concrete fleet coast key when the
  // target is a split-coast province. Returns the (possibly coast-suffixed)
  // loc, or null if the move is coast-illegal / ambiguously specified.
  _resolveFleetMoveCoast(unitType, from, to) {
    const toBase = baseProvince(to);
    if (unitType !== 'fleet' || !isSplitCoast(toBase)) return toBase;
    const requested = coastOf(to);
    const reachable = COAST_PROVINCES[toBase]
      .map(coast => `${toBase}/${coast}`)
      .filter(coastLoc => (FLEET_COAST_ADJACENCY[coastLoc] || []).includes(baseProvince(from)));
    if (requested) {
      const coastLoc = `${toBase}/${requested}`;
      return reachable.includes(coastLoc) ? coastLoc : null;
    }
    // No coast specified: accept only when exactly one coast is reachable.
    return reachable.length === 1 ? reachable[0] : null;
  }

  _sanitizeOrder(order) {
    const unit = this.units[order.unitLoc];
    if (!unit) return null;
    switch (order.type) {
      case 'hold':
        return { type: 'hold', unitLoc: order.unitLoc };
      case 'move': {
        // Resolve a fleet move into a split-coast province to a concrete coast
        // key (rejecting coast-violating orders), so adjudication and the unit
        // map carry the committed coast. Armies always use the bare base id.
        const to = this._resolveFleetMoveCoast(unit.type, order.unitLoc, order.to);
        if (to === null) return null;
        const viaConvoy = !!order.viaConvoy || (unit.type === 'army' && !adjacencyFor('army', order.unitLoc).includes(baseProvince(to)));
        if (!this.canUnitMove(unit.type, order.unitLoc, to, { viaConvoy })) return null;
        return { type: 'move', unitLoc: order.unitLoc, to, viaConvoy };
      }
      case 'support-hold':
        if (!this.units[order.target] || !this.canSupport(unit.type, order.unitLoc, order.target)) return null;
        return { type: 'support-hold', unitLoc: order.unitLoc, target: order.target };
      case 'support-move': {
        const mover = this.units[order.from];
        if (!mover || !this.canSupport(unit.type, order.unitLoc, order.to)) return null;
        if (!this.canUnitMove(mover.type, order.from, order.to, { viaConvoy: mover.type === 'army' })) return null;
        return { type: 'support-move', unitLoc: order.unitLoc, from: order.from, to: order.to };
      }
      case 'convoy':
        if (unit.type !== 'fleet' || !isSea(order.unitLoc) || !this.units[order.from] || this.units[order.from].type !== 'army') return null;
        if (!FLEET_ADJACENCY[order.unitLoc]?.includes(order.from) || !isLandOrCoast(order.to)) return null;
        return { type: 'convoy', unitLoc: order.unitLoc, from: order.from, to: order.to };
      default:
        return null;
    }
  }

  // BFS a convoy route from `from` to `to` using only fleets that ordered this
  // exact convoy and survived adjudication (not in `dislodgedLocs`). Used to
  // fail a convoyed move whose convoying fleet(s) were dislodged.
  _convoyPathSurvives(from, to, validOrders, dislodgedLocs) {
    const convoyFleets = Object.entries(this.units)
      .filter(([loc, unit]) => unit.type === 'fleet' && isSea(loc) && !dislodgedLocs.has(loc))
      .filter(([loc]) => {
        const order = validOrders[loc];
        return order?.type === 'convoy' && order.from === from && order.to === to;
      })
      .map(([loc]) => loc);
    const fleetSet = new Set(convoyFleets);
    const starts = convoyFleets.filter(sea => FLEET_ADJACENCY[sea]?.includes(from));
    if (starts.length === 0) return false;
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const sea = queue.shift();
      if (FLEET_ADJACENCY[sea]?.includes(to)) return true;
      for (const next of FLEET_ADJACENCY[sea] || []) {
        if (!fleetSet.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  // Coast-aware adjacency expansion for retreat option generation. Mirrors the
  // fleet branch of getMoveTargets: from a coast-committed fleet, expand any
  // split-coast neighbor into the concrete coast(s) reachable from this loc.
  _retreatTargets(unitType, fromLoc) {
    const targets = [];
    for (const to of adjacencyFor(unitType, fromLoc)) {
      if (!unitCanOccupy(unitType, to)) continue;
      if (unitType === 'fleet' && isSplitCoast(to)) {
        for (const coast of COAST_PROVINCES[to]) {
          const coastLoc = `${to}/${coast}`;
          if ((FLEET_COAST_ADJACENCY[coastLoc] || []).includes(baseProvince(fromLoc))) targets.push(coastLoc);
        }
      } else {
        targets.push(to);
      }
    }
    return targets;
  }

  _adjudicate(ordersByLoc) {
    const validOrders = { ...ordersByLoc };
    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type === 'move' && order.viaConvoy && !this.hasConvoyPath(order.unitLoc, order.to, validOrders)) {
        validOrders[loc] = { type: 'hold', unitLoc: loc, failedConvoy: true };
      }
    }

    // Conflicts resolve per base province: two fleets aiming at different coasts
    // of the same split province still contest the one node. Targets are grouped
    // by base id; occupant lookups go through unitAt/unitLocAt.
    const attacksByTarget = {};
    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type !== 'move') continue;
      const targetBase = baseProvince(order.to);
      if (!attacksByTarget[targetBase]) attacksByTarget[targetBase] = [];
      attacksByTarget[targetBase].push(loc);
    }

    const cutSupports = new Set();
    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type !== 'support-hold' && order.type !== 'support-move') continue;
      const attacks = attacksByTarget[baseProvince(loc)] || [];
      for (const attackerLoc of attacks) {
        const attack = validOrders[attackerLoc];
        if (!attack) continue;
        if (order.type === 'support-move' && baseProvince(attackerLoc) === baseProvince(order.to)) continue;
        cutSupports.add(loc);
      }
    }

    const moveStrength = {};
    const defenseStrength = {};
    for (const [loc, unit] of Object.entries(this.units)) {
      defenseStrength[loc] = 1;
      if (validOrders[loc]?.type === 'move') moveStrength[loc] = 1;
    }

    for (const [loc, order] of Object.entries(validOrders)) {
      if (cutSupports.has(loc)) continue;
      if (order.type === 'support-hold' && this.units[order.target]) {
        defenseStrength[order.target] = (defenseStrength[order.target] || 1) + 1;
      }
      if (order.type === 'support-move' && this.units[order.from] && validOrders[order.from]?.type === 'move'
        && baseProvince(validOrders[order.from].to) === baseProvince(order.to)) {
        moveStrength[order.from] = (moveStrength[order.from] || 1) + 1;
      }
    }

    const moveSuccess = {};
    const handledHeadToHead = new Set();
    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type !== 'move') continue;
      moveSuccess[loc] = false;
    }

    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type !== 'move' || handledHeadToHead.has(loc)) continue;
      const oppLoc = this.unitLocAt(baseProvince(order.to));
      const opposing = oppLoc ? validOrders[oppLoc] : null;
      if (opposing?.type === 'move' && baseProvince(opposing.to) === baseProvince(loc) && !order.viaConvoy && !opposing.viaConvoy) {
        handledHeadToHead.add(loc);
        handledHeadToHead.add(oppLoc);
        const aUnit = this.units[loc];
        const bUnit = this.units[oppLoc];
        const a = moveStrength[loc] || 1;
        const b = moveStrength[oppLoc] || 1;
        if (a > b && aUnit.power !== bUnit.power) moveSuccess[loc] = true;
        if (b > a && bUnit.power !== aUnit.power) moveSuccess[oppLoc] = true;
      }
    }

    let changed = true;
    let guard = 0;
    while (changed && guard < 12) {
      changed = false;
      guard++;
      for (const [target, attackers] of Object.entries(attacksByTarget)) {
        const active = attackers.filter(loc => !handledHeadToHead.has(loc));
        if (active.length === 0) continue;
        const ranked = active
          .map(loc => ({ loc, strength: moveStrength[loc] || 1 }))
          .sort((a, b) => b.strength - a.strength);
        const best = ranked[0];
        if (!best || (ranked[1] && ranked[1].strength === best.strength)) {
          for (const attacker of active) {
            if (moveSuccess[attacker] !== false) {
              moveSuccess[attacker] = false;
              changed = true;
            }
          }
          continue;
        }

        const occupantLoc = this.unitLocAt(target);
        const occupant = occupantLoc ? this.units[occupantLoc] : undefined;
        let succeeds = false;
        if (!occupant) {
          succeeds = true;
        } else {
          const occupantOrder = validOrders[occupantLoc];
          const occupantLeaves = occupantOrder?.type === 'move' && moveSuccess[occupantLoc] === true;
          const attackerPower = this.units[best.loc].power;
          if (occupant.power === attackerPower) {
            succeeds = occupantLeaves;
          } else if (occupantLeaves) {
            succeeds = true;
          } else {
            succeeds = best.strength > (defenseStrength[occupantLoc] || 1);
          }
        }

        for (const attacker of active) {
          const next = attacker === best.loc ? succeeds : false;
          if (moveSuccess[attacker] !== next) {
            moveSuccess[attacker] = next;
            changed = true;
          }
        }
      }
    }

    // Convoy disruption: a convoyed move only succeeds if a convoy path survives
    // through fleets that ordered the convoy AND are not themselves dislodged.
    // _adjudicate's up-front hasConvoyPath check (above) uses all ordered fleets,
    // so re-check here against the fleets that survive adjudication and fail any
    // convoyed move whose route is now broken. The army falls back to a hold.
    const dislodgedLocs = new Set();
    for (const [loc, unit] of Object.entries(this.units)) {
      const order = validOrders[loc];
      if (order?.type === 'move' && moveSuccess[loc]) continue;
      const attacked = Object.entries(validOrders)
        .some(([from, attack]) => attack.type === 'move' && baseProvince(attack.to) === baseProvince(loc) && moveSuccess[from] && this.units[from].power !== unit.power);
      if (attacked) dislodgedLocs.add(loc);
    }
    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type !== 'move' || !order.viaConvoy || !moveSuccess[loc]) continue;
      if (!this._convoyPathSurvives(order.unitLoc, order.to, validOrders, dislodgedLocs)) {
        moveSuccess[loc] = false;
      }
    }

    const dislodged = [];
    const newUnits = {};
    for (const [loc, unit] of Object.entries(this.units)) {
      const order = validOrders[loc];
      if (order?.type === 'move' && moveSuccess[loc]) continue;
      const attackLoc = Object.entries(validOrders)
        .find(([from, attack]) => attack.type === 'move' && baseProvince(attack.to) === baseProvince(loc) && moveSuccess[from] && this.units[from].power !== unit.power)?.[0];
      if (attackLoc) {
        dislodged.push({ unitLoc: loc, unit: { ...unit }, attackerFrom: attackLoc });
      } else {
        newUnits[loc] = { ...unit };
      }
    }

    for (const [loc, order] of Object.entries(validOrders)) {
      if (order.type === 'move' && moveSuccess[loc]) {
        newUnits[order.to] = { ...this.units[loc] };
      }
    }

    // Contested provinces (a standoff bounces retreats) are tracked by base id.
    const contestedProvinces = sorted(uniq(Object.values(validOrders)
      .filter(order => order.type === 'move')
      .map(order => baseProvince(order.to))));
    const occupiedBases = new Set(Object.keys(newUnits).map(baseProvince));

    const pendingRetreats = dislodged
      .map(entry => {
        // Retreat targets are coast-aware: a dislodged fleet on a split coast
        // may only retreat to neighbors of its committed coast, and a fleet
        // retreating into a split province must name a concrete coast.
        const candidates = this._retreatTargets(entry.unit.type, entry.unitLoc);
        const options = candidates
          .filter(to => !occupiedBases.has(baseProvince(to)))
          .filter(to => baseProvince(to) !== baseProvince(entry.attackerFrom))
          .filter(to => !contestedProvinces.includes(baseProvince(to)));
        return { ...entry, options: sorted(options) };
      })
      .filter(entry => entry.options.length > 0);

    return {
      units: newUnits,
      pendingRetreats,
      contestedProvinces,
      resolved: {
        moveSuccess: { ...moveSuccess },
        cutSupports: [...cutSupports],
        dislodged,
        strengths: { move: moveStrength, defense: defenseStrength },
      },
    };
  }

  _advanceAfterMovement() {
    if (this.season === 'fall') {
      this._updateSupplyOwnership();
      this._checkVictory();
      if (this.winner) return;
      this.adjustments = this.getAdjustments();
      const needsAdjustment = Object.values(this.adjustments).some(entry => entry.buildCount > 0 || entry.disbandCount > 0);
      if (needsAdjustment) {
        this.phase = 'winter-build';
        this.lastAction = `Fall ${this.year} resolved. Winter adjustments are open.`;
        return;
      }
      this._advanceToNextSpring();
      return;
    }

    this.season = 'fall';
    this.phase = phaseAfterMovement('spring');
    this.lastAction = `Spring ${this.year} resolved. Fall orders are open.`;
  }

  _advanceToNextSpring() {
    this.year += 1;
    this.turnNumber += 1;
    this.season = 'spring';
    this.phase = 'spring-orders';
    this.pendingRetreats = [];
    this.contestedProvinces = [];
    this.adjustments = this.getAdjustments();
    this.lastAction = `Spring ${this.year} orders are open.`;
    this._checkVictory();
  }

  _updateSupplyOwnership() {
    for (const center of SUPPLY_CENTERS) {
      const unit = this.unitAt(center);
      if (unit) this.supplyCenters[center] = unit.power;
    }
  }

  _checkVictory() {
    const leader = this.getLeader();
    if (leader?.centers >= 18) {
      this.phase = 'game-over';
      this.winner = leader.power;
      this.winningCenters = leader.centers;
      this.lastAction = `${POWER_SHORT_NAMES[leader.power]} controls ${leader.centers} centers.`;
      return;
    }
    if (this.year > this.maxYears) {
      this.phase = 'game-over';
      this.winner = leader?.power || null;
      this.winningCenters = leader?.centers || 0;
      this.lastAction = `${POWER_SHORT_NAMES[this.winner] || 'No power'} leads after ${this.maxYears - 1900} years.`;
    }
  }

  getStateHash() {
    const units = Object.entries(this.units)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([loc, unit]) => `${loc}:${unit.power[0]}${unit.type[0]}`)
      .join(',');
    const centers = Object.entries(this.supplyCenters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([loc, owner]) => `${loc}:${owner?.[0] || '-'}`)
      .join(',');
    return `${this.phase}|${this.year}|${this.season}|${units}|${centers}`;
  }

  serializeState() {
    return {
      powers: [...this.powers],
      units: Object.fromEntries(Object.entries(this.units).map(([loc, unit]) => [loc, { ...unit }])),
      supplyCenters: { ...this.supplyCenters },
      phase: this.phase,
      season: this.season,
      year: this.year,
      turnNumber: this.turnNumber,
      maxYears: this.maxYears,
      winner: this.winner,
      winningCenters: this.winningCenters,
      lastAction: this.lastAction,
      orderHistory: this.orderHistory.map(entry => JSON.parse(JSON.stringify(entry))),
      pendingRetreats: this.pendingRetreats.map(entry => ({
        ...entry,
        unit: { ...entry.unit },
        options: [...entry.options],
      })),
      contestedProvinces: [...this.contestedProvinces],
      adjustments: JSON.parse(JSON.stringify(this.adjustments)),
      stateHistory: this.stateHistory,
      historyIndex: this.historyIndex,
      maxHistoryLength: this.maxHistoryLength,
    };
  }

  static fromSerializedState(state) {
    const board = new DiplomacyBoard({ skipInitialHistory: true, maxYears: state.maxYears || 1912 });
    board.powers = state.powers ? [...state.powers] : [...POWERS];
    board.units = {};
    for (const [loc, unit] of Object.entries(state.units || {})) {
      // Backward-compat: a legacy state may key a split-coast fleet by the bare
      // base id (e.g. units['STP'] = {type:'fleet'}). Normalize it to that
      // province's canonical default coast (STP/sc, SPA/sc, BUL/sc) so the
      // engine never carries a coast-less split fleet. Armies stay bare.
      let key = loc;
      if (unit.type === 'fleet' && isSplitCoast(loc)) key = `${loc}/${DEFAULT_COAST[loc]}`;
      board.units[key] = { ...unit };
    }
    board.supplyCenters = { ...emptyCenterOwners(), ...(state.supplyCenters || {}) };
    board.phase = state.phase || 'spring-orders';
    board.season = state.season || (board.phase.startsWith('fall') ? 'fall' : 'spring');
    board.year = state.year || 1901;
    board.turnNumber = state.turnNumber || 1;
    board.maxYears = state.maxYears || 1912;
    board.winner = state.winner || null;
    board.winningCenters = state.winningCenters || 0;
    board.lastAction = state.lastAction || '';
    board.orderHistory = (state.orderHistory || []).map(entry => JSON.parse(JSON.stringify(entry)));
    board.pendingRetreats = (state.pendingRetreats || []).map(entry => ({
      ...entry,
      unit: { ...entry.unit },
      options: [...entry.options],
    }));
    board.contestedProvinces = [...(state.contestedProvinces || [])];
    board.adjustments = state.adjustments ? JSON.parse(JSON.stringify(state.adjustments)) : board.getAdjustments();
    board.stateHistory = state.stateHistory || [];
    board.historyIndex = state.historyIndex ?? -1;
    board.maxHistoryLength = state.maxHistoryLength || 80;
    return board;
  }

  _captureState() {
    if (this._skipHistory) return;
    const state = this.serializeState();
    state.stateHistory = [];
    state.historyIndex = -1;
    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }
    this.stateHistory.push(JSON.stringify(state));
    if (this.stateHistory.length > this.maxHistoryLength) this.stateHistory.shift();
    this.historyIndex = this.stateHistory.length - 1;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.stateHistory.length - 1;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.historyIndex--;
    this._restoreFromHistory();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.historyIndex++;
    this._restoreFromHistory();
    return true;
  }

  _restoreFromHistory() {
    const parsed = JSON.parse(this.stateHistory[this.historyIndex]);
    parsed.stateHistory = this.stateHistory;
    parsed.historyIndex = this.historyIndex;
    const restored = DiplomacyBoard.fromSerializedState(parsed);
    Object.assign(this, restored);
  }
}

export {
  POWERS,
  POWER_NAMES,
  POWER_SHORT_NAMES,
  POWER_COLORS,
  POWER_ACCENTS,
  PROVINCES,
  SUPPLY_CENTERS,
  HOME_CENTERS,
  ARMY_ADJACENCY,
  FLEET_ADJACENCY,
  FLEET_COAST_ADJACENCY,
  COAST_PROVINCES,
  SEA_PROVINCES,
  orderKey,
  formatUnitType,
  unitCanOccupy,
  adjacencyFor,
  baseProvince,
  coastOf,
  isSplitCoast,
};
