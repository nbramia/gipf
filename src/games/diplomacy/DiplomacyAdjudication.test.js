// Hand-written adjudication tests. Numbered cases follow the Diplomacy
// Adjudicator Test Cases (DATC v3.0) positions and outcomes; tests marked
// "adapted" use a reduced or modified position and say so. The full
// data-driven DATC suite lives in DiplomacyDatc.test.js.
//
// Engine options relevant to the DATC: an order that cannot possibly be legal
// (non-adjacent move, support of an impossible move, ...) is replaced by a hold
// when orders are normalized (DATC 4.E.1 option); a convoy whose route may
// exist is kept as a move and simply fails if the fleets do not convoy (so
// DATC 6.D.8 is a failed convoy, which is encoded in the data-driven suite).
// Convoy paradoxes use the Szykman rule.

import DiplomacyBoard from './DiplomacyBoard.js';

function boardWith(specs) {
  const board = new DiplomacyBoard({ skipInitialHistory: true });
  board.units = {};
  for (const spec of specs) {
    const [power, type, loc] = spec.split(' ');
    board.units[loc] = { power, type: type === 'F' ? 'fleet' : 'army' };
  }
  return board;
}

const mv = (unitLoc, to, viaConvoy = false) => ({ type: 'move', unitLoc, to, ...(viaConvoy ? { viaConvoy } : {}) });
const sm = (unitLoc, from, to) => ({ type: 'support-move', unitLoc, from, to });
const sh = (unitLoc, target) => ({ type: 'support-hold', unitLoc, target });
const cv = (unitLoc, from, to) => ({ type: 'convoy', unitLoc, from, to });

// Adjudicate one turn; returns the move outcomes, dislodged locs and the board.
function run(specs, orders) {
  const board = boardWith(specs);
  const normalized = board._normalizeOrders(orders);
  const out = board._adjudicate(normalized);
  return {
    board,
    moved: Object.keys(out.resolved.moveSuccess).filter(loc => out.resolved.moveSuccess[loc]).sort(),
    dislodged: out.resolved.dislodged.map(entry => entry.unitLoc).sort(),
    cut: out.resolved.cutSupports.sort(),
    units: out.units,
    resolved: out.resolved,
  };
}

describe('DATC 6.A basic checks', () => {
  test('6.A.1 moving to an area that is not a neighbour is not carried out', () => {
    const r = run(['england F NTH'], { england: [mv('NTH', 'PIC')] });
    expect(r.units.NTH).toBeDefined();
    expect(r.units.PIC).toBeUndefined();
  });

  test('6.A.2 an army cannot move to a sea', () => {
    const r = run(['england A LVP'], { england: [mv('LVP', 'IRI')] });
    expect(r.units.LVP).toBeDefined();
  });

  test('6.A.3 a fleet cannot move to a land province', () => {
    const r = run(['germany F KIE'], { germany: [mv('KIE', 'MUN')] });
    expect(r.units.KIE).toBeDefined();
  });

  test('6.A.11 a simple bounce leaves both units in place', () => {
    const r = run(['austria A VIE', 'italy A VEN'], { austria: [mv('VIE', 'TYR')], italy: [mv('VEN', 'TYR')] });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.A.12 a bounce of three units leaves all in place', () => {
    const r = run(['austria A VIE', 'germany A MUN', 'italy A VEN'], {
      austria: [mv('VIE', 'TYR')], germany: [mv('MUN', 'TYR')], italy: [mv('VEN', 'TYR')],
    });
    expect(r.moved).toEqual([]);
  });
});

describe('DATC 6.C circular movement', () => {
  const ring = ['turkey F ANK', 'turkey A CON', 'turkey A SMY'];
  const ringOrders = [mv('ANK', 'CON'), mv('CON', 'SMY'), mv('SMY', 'ANK')];

  test('6.C.1 three units can change place (circular movement)', () => {
    const r = run(ring, { turkey: ringOrders });
    expect(r.moved).toEqual(['ANK', 'CON', 'SMY']);
    expect(r.dislodged).toEqual([]);
  });

  test('6.C.2 three units can change place, with support', () => {
    const r = run([...ring, 'turkey A BUL'], { turkey: [...ringOrders, sm('BUL', 'ANK', 'CON')] });
    expect(r.moved).toEqual(['ANK', 'CON', 'SMY']);
  });

  test('6.C.3 a disrupted three-unit circular movement fails entirely', () => {
    const r = run([...ring, 'turkey A BUL'], { turkey: [...ringOrders, mv('BUL', 'CON')] });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('an unopposed rotation of units of two powers succeeds (HOL/BEL/NTH, rulebook diagram)', () => {
    const r = run(['england A HOL', 'england F BEL', 'france F NTH'], {
      england: [mv('HOL', 'BEL'), mv('BEL', 'NTH')], france: [mv('NTH', 'HOL')],
    });
    expect(r.moved).toEqual(['BEL', 'HOL', 'NTH']);
  });
});

describe('DATC 6.D supports and dislodges', () => {
  test('6.D.1 supported hold can prevent dislodgement', () => {
    const r = run(['austria F ADR', 'austria A TRI', 'italy A VEN', 'italy A TYR'], {
      austria: [sm('ADR', 'TRI', 'VEN'), mv('TRI', 'VEN')], italy: [sh('TYR', 'VEN')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.2 a move cuts support on hold', () => {
    const r = run(['austria F ADR', 'austria A TRI', 'austria A VIE', 'italy A VEN', 'italy A TYR'], {
      austria: [sm('ADR', 'TRI', 'VEN'), mv('TRI', 'VEN'), mv('VIE', 'TYR')], italy: [sh('TYR', 'VEN')],
    });
    expect(r.dislodged).toEqual(['VEN']);
    expect(r.moved).toEqual(['TRI']);
    expect(r.cut).toEqual(['TYR']);
  });

  test('6.D.3 a move cuts support on move', () => {
    const r = run(['austria F ADR', 'austria A TRI', 'italy A VEN', 'italy F ION'], {
      austria: [sm('ADR', 'TRI', 'VEN'), mv('TRI', 'VEN')], italy: [mv('ION', 'ADR')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.4 support to hold on a unit supporting a hold is allowed', () => {
    const r = run(['germany A BER', 'germany F KIE', 'russia F BAL', 'russia A PRU'], {
      germany: [sh('BER', 'KIE'), sh('KIE', 'BER')], russia: [sm('BAL', 'PRU', 'BER'), mv('PRU', 'BER')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.10 self dislodgement is prohibited', () => {
    const r = run(['germany A BER', 'germany F KIE', 'germany A MUN'], {
      germany: [mv('KIE', 'BER'), sm('MUN', 'KIE', 'BER')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.12 supporting a foreign unit to dislodge your own unit is prohibited', () => {
    const r = run(['austria F TRI', 'austria A VIE', 'italy A VEN'], {
      austria: [sm('VIE', 'VEN', 'TRI')], italy: [mv('VEN', 'TRI')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.13 supporting a foreign unit to dislodge a returning own unit is prohibited', () => {
    const r = run(['austria F TRI', 'austria A VIE', 'italy A VEN', 'italy F APU'], {
      austria: [mv('TRI', 'ADR'), sm('VIE', 'VEN', 'TRI')], italy: [mv('VEN', 'TRI'), mv('APU', 'ADR')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('6.D.15 (adapted: ANK is an army) a defender cannot cut support for an attack on itself', () => {
    const r = run(['russia F CON', 'russia F BLA', 'turkey A ANK'], {
      russia: [sm('CON', 'BLA', 'ANK'), mv('BLA', 'ANK')], turkey: [mv('ANK', 'CON')],
    });
    expect(r.moved).toEqual(['BLA']);
    expect(r.dislodged).toEqual(['ANK']);
  });

  test('6.D.17 dislodgement cuts supports', () => {
    const r = run(['russia F CON', 'russia F BLA', 'turkey F ANK', 'turkey A SMY', 'turkey A ARM'], {
      russia: [sm('CON', 'BLA', 'ANK'), mv('BLA', 'ANK')],
      turkey: [mv('ANK', 'CON'), sm('SMY', 'ANK', 'CON'), mv('ARM', 'ANK')],
    });
    // CON is dislodged, so its support is void: BLA and ARM tie over ANK.
    expect(r.moved).toEqual(['ANK']);
    expect(r.dislodged).toEqual(['CON']);
  });

  test('6.D.20 a unit cannot cut the support of its own country', () => {
    const r = run(['england F LON', 'england F NTH', 'england A YOR', 'france F ENG'], {
      england: [sm('LON', 'NTH', 'ENG'), mv('NTH', 'ENG'), mv('YOR', 'LON')],
    });
    expect(r.moved).toEqual(['NTH']);
    expect(r.dislodged).toEqual(['ENG']);
    expect(r.cut).toEqual([]);
  });

  test('support-hold does not protect a unit that is ordered to move (rulebook p. 10)', () => {
    const r = run(['france A BUR', 'france A TYR', 'germany A MUN', 'germany A KIE', 'russia A RUH'], {
      france: [mv('BUR', 'MUN'), sm('TYR', 'BUR', 'MUN')], germany: [mv('MUN', 'RUH'), sh('KIE', 'MUN')],
    });
    expect(r.moved).toEqual(['BUR']);
    expect(r.dislodged).toEqual(['MUN']);
  });

  test('a dislodged supporter gives no support', () => {
    const r = run(['germany A MUN', 'germany A RUH', 'france A BUR', 'france A TYR', 'france A PAR'], {
      germany: [sm('MUN', 'RUH', 'BUR'), mv('RUH', 'BUR')],
      france: [mv('BUR', 'MUN'), sm('TYR', 'BUR', 'MUN'), mv('PAR', 'BUR')],
    });
    expect(r.moved).toEqual(['BUR']);
    expect(r.dislodged).toEqual(['MUN']);
    expect(r.units.RUH).toBeDefined();
    expect(r.units.PAR).toBeDefined();
  });

  test('foreign support cannot dislodge the supporter\'s own unit', () => {
    const r = run(['france A BUR', 'germany A MUN', 'germany A RUH'], {
      france: [mv('BUR', 'MUN')], germany: [sm('RUH', 'BUR', 'MUN')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });
});

describe('DATC 6.E head-to-head battles', () => {
  test('6.E.1 a dislodged unit has no effect on the attacker\'s area', () => {
    const r = run(['germany A BER', 'germany F KIE', 'germany A SIL', 'russia A PRU'], {
      germany: [mv('BER', 'PRU'), mv('KIE', 'BER'), sm('SIL', 'BER', 'PRU')], russia: [mv('PRU', 'BER')],
    });
    expect(r.moved).toEqual(['BER', 'KIE']);
    expect(r.dislodged).toEqual(['PRU']);
  });

  test('6.E.2 no self dislodgement in a head-to-head battle', () => {
    const r = run(['germany A BER', 'germany F KIE', 'germany A MUN'], {
      germany: [mv('BER', 'KIE'), mv('KIE', 'BER'), sm('MUN', 'BER', 'KIE')],
    });
    expect(r.moved).toEqual([]);
    expect(r.dislodged).toEqual([]);
  });

  test('two equal units cannot swap places without a convoy', () => {
    const r = run(['germany A BER', 'germany F KIE'], { germany: [mv('BER', 'KIE'), mv('KIE', 'BER')] });
    expect(r.moved).toEqual([]);
  });
});

describe('DATC 6.F convoys', () => {
  test('a simple convoy carries the army', () => {
    const r = run(['england F NTH', 'england A YOR'], { england: [cv('NTH', 'YOR', 'NWY'), mv('YOR', 'NWY', true)] });
    expect(r.moved).toEqual(['YOR']);
  });

  test('6.F.3 (adapted: LON-BEL against a holding BEL) an army being convoyed can receive support', () => {
    const r = run(['england F NTH', 'england A LON', 'england F ENG', 'france A BEL'], {
      england: [cv('NTH', 'LON', 'BEL'), mv('LON', 'BEL', true), sm('ENG', 'LON', 'BEL')],
    });
    expect(r.moved).toEqual(['LON']);
    expect(r.dislodged).toEqual(['BEL']);
  });

  test('6.F.4 an attacked convoy is not disrupted', () => {
    const r = run(['england F NTH', 'england A LON', 'germany F SKA'], {
      england: [cv('NTH', 'LON', 'HOL'), mv('LON', 'HOL', true)], germany: [mv('SKA', 'NTH')],
    });
    expect(r.moved).toEqual(['LON']);
    expect(r.dislodged).toEqual([]);
  });

  test('6.F.5 a beleaguered convoy is not disrupted', () => {
    const r = run(['england F NTH', 'england A LON', 'france F ENG', 'france F BEL', 'germany F SKA', 'germany F HEL'], {
      england: [cv('NTH', 'LON', 'HOL'), mv('LON', 'HOL', true)],
      france: [mv('ENG', 'NTH'), sm('BEL', 'ENG', 'NTH')],
      germany: [mv('SKA', 'NTH'), sm('HEL', 'SKA', 'NTH')],
    });
    expect(r.moved).toEqual(['LON']);
    expect(r.dislodged).toEqual([]);
  });

  test('a dislodged convoying fleet disrupts the convoy', () => {
    const r = run(['england F NTH', 'england A LON', 'germany F HEL', 'germany F SKA'], {
      england: [cv('NTH', 'LON', 'HOL'), mv('LON', 'HOL', true)], germany: [mv('HEL', 'NTH'), sm('SKA', 'HEL', 'NTH')],
    });
    expect(r.moved).toEqual(['HEL']);
    expect(r.dislodged).toEqual(['NTH']);
    expect(r.units.LON).toBeDefined();
  });

  test('a convoy through two fleets carries the army', () => {
    const r = run(['england F NTH', 'england F ENG', 'england A YOR'], {
      england: [cv('NTH', 'YOR', 'BRE'), cv('ENG', 'YOR', 'BRE'), mv('YOR', 'BRE', true)],
    });
    expect(r.moved).toEqual(['YOR']);
  });

  test('a convoy through a foreign fleet that cooperates succeeds', () => {
    const r = run(['england A YOR', 'france F NTH'], { england: [mv('YOR', 'BEL', true)], france: [cv('NTH', 'YOR', 'BEL')] });
    expect(r.moved).toEqual(['YOR']);
  });

  test('a convoy through a foreign fleet that does not convoy fails', () => {
    const r = run(['england A YOR', 'france F NTH'], { england: [mv('YOR', 'BEL', true)] });
    expect(r.moved).toEqual([]);
  });

  test('6.F.14 a simple convoy paradox is resolved by the Szykman rule', () => {
    const r = run(['england F LON', 'england F WAL', 'france A BRE', 'france F ENG'], {
      england: [sm('LON', 'WAL', 'ENG'), mv('WAL', 'ENG')], france: [mv('BRE', 'LON', true), cv('ENG', 'BRE', 'LON')],
    });
    expect(r.moved).toEqual(['WAL']);
    expect(r.dislodged).toEqual(['ENG']);
    expect(r.units.BRE).toBeDefined();
  });
});

describe('DATC 6.G convoys to adjacent places', () => {
  test('6.G.1 (adapted: explicit convoy flag) two units can swap places by convoy', () => {
    const r = run(['england A NWY', 'england F SKA', 'russia A SWE'], {
      england: [mv('NWY', 'SWE', true), cv('SKA', 'NWY', 'SWE')], russia: [mv('SWE', 'NWY')],
    });
    expect(r.moved).toEqual(['NWY', 'SWE']);
  });
});

describe('legal order generation', () => {
  test('a multi-fleet convoy offers a convoy order to every fleet on the route', () => {
    const board = boardWith(['england A YOR', 'england F NTH', 'england F ENG']);
    for (const fleet of ['NTH', 'ENG']) {
      const orders = board.getLegalOrdersForUnit(fleet);
      expect(orders).toContainEqual({ type: 'convoy', unitLoc: fleet, from: 'YOR', to: 'BRE' });
    }
    expect(board.getLegalOrdersForUnit('YOR')).toContainEqual({ type: 'move', unitLoc: 'YOR', to: 'BRE', viaConvoy: true });
  });

  test('a convoy order is not offered to a connected fleet that is off every route (DATC 6.F.12, 6.G.19)', () => {
    const board = boardWith(['england A YOR', 'england F NTH', 'england F ENG', 'england F IRI']);
    expect(board.getLegalOrdersForUnit('IRI').filter(o => o.type === 'convoy' && o.to === 'BRE')).toEqual([]);
    expect(board.getLegalOrdersForUnit('NTH')).toContainEqual({ type: 'convoy', unitLoc: 'NTH', from: 'YOR', to: 'BRE' });
  });

  test('a fleet cannot support a convoyed move that needs that same fleet (DATC 6.D.31)', () => {
    const board = boardWith(['austria A RUM', 'turkey F BLA']);
    expect(board.getLegalOrdersForUnit('BLA').filter(o => o.type === 'support-move' && o.from === 'RUM' && o.to === 'ARM')).toEqual([]);
  });

  test('a foreign-fleet convoy route is offered to the army', () => {
    const board = boardWith(['england A YOR', 'france F NTH']);
    expect(board.getLegalOrdersForUnit('YOR')).toContainEqual({ type: 'move', unitLoc: 'YOR', to: 'BEL', viaConvoy: true });
    expect(board.getLegalOrdersForUnit('NTH')).toContainEqual({ type: 'convoy', unitLoc: 'NTH', from: 'YOR', to: 'BEL' });
  });

  test('a convoyed army can be supported into its destination', () => {
    const board = boardWith(['england A YOR', 'england F NTH', 'england F ENG']);
    expect(board.getLegalOrdersForUnit('ENG')).toContainEqual({ type: 'support-move', unitLoc: 'ENG', from: 'YOR', to: 'BEL' });
  });

  test('support-hold into a split-coast province does not depend on the occupied coast', () => {
    const board = boardWith(['turkey F AEG', 'russia F BUL/ec']);
    expect(board.getLegalOrdersForUnit('AEG')).toContainEqual({ type: 'support-hold', unitLoc: 'AEG', target: 'BUL/ec' });
    const r = run(['turkey F AEG', 'russia F BUL/ec', 'austria A SER'], { turkey: [sh('AEG', 'BUL/ec')], austria: [mv('SER', 'BUL')] });
    expect(r.resolved.strengths.defense['BUL/ec']).toBe(2);
  });
});

describe('year-limit victory', () => {
  test('tied center leaders share the victory', () => {
    const board = new DiplomacyBoard({ skipInitialHistory: true, maxYears: 1905 });
    board.units = { PAR: { power: 'france', type: 'army' }, BER: { power: 'france', type: 'army' }, VIE: { power: 'austria', type: 'army' } };
    board.supplyCenters = {
      ...board.supplyCenters,
      PAR: 'france', BRE: 'france', MAR: 'france', BEL: 'france',
      VIE: 'austria', BUD: 'austria', TRI: 'austria', SER: 'austria',
      BER: null, KIE: null, MUN: null, EDI: null, LON: null, LVP: null, NAP: null, ROM: null, VEN: null,
      MOS: null, SEV: null, STP: null, WAR: null, ANK: null, CON: null, SMY: null,
    };
    board.year = 1906;
    board._checkVictory();
    expect(board.phase).toBe('game-over');
    expect(board.getWinners().sort()).toEqual(['austria', 'france']);
    expect(board.winner).toBeNull();
    expect(board.winningCenters).toBe(4);
  });
});
