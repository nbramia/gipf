// CatanBoard.js
// Pure rules/state engine for Catan base play plus variant-aware maps.

import { getDefaultScenario, getMapProfile, getRuleset, normalizePlayerCount, reachableTarget } from './catanRulesets.js';

const SQRT3 = Math.sqrt(3);
const HEX_RADIUS = 2;
// Generous round cap; normal games end well before this. Only triggers on a
// board whose reachable VP ceiling sits below the (clamped) target.
const MAX_GAME_TURNS = 100;

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};

const DEV_DECK = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('victoryPoint'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly'),
];

const PLAYER_NAMES = {
  1: 'You',
  2: 'Ada',
  3: 'Linus',
  4: 'Grace',
  5: 'Marie',
  6: 'Nikola',
};

const PLAYER_COLORS = {
  1: '#DC2626',
  2: '#2563EB',
  3: '#16A34A',
  4: '#F59E0B',
  5: '#7C3AED',
  6: '#0891B2',
};

function emptyResources() {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

function emptyDevCards() {
  return {
    knight: 0,
    victoryPoint: 0,
    roadBuilding: 0,
    yearOfPlenty: 0,
    monopoly: 0,
  };
}

function cloneResources(resources) {
  return { ...emptyResources(), ...resources };
}

function cloneDevCards(cards) {
  return { ...emptyDevCards(), ...cards };
}

function resourceTotal(resources) {
  return RESOURCES.reduce((sum, resource) => sum + (resources[resource] || 0), 0);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function quantize(value) {
  return Math.round(value * 1000) / 1000;
}

function pointKey(x, y) {
  return `${quantize(x)},${quantize(y)}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function makeRowCoords(rows) {
  const coords = [];
  const maxLength = Math.max(...rows);
  const mid = Math.floor(rows.length / 2);

  rows.forEach((length, rowIndex) => {
    const r = rowIndex - mid;
    const qStart = -Math.floor(maxLength / 2) + Math.max(0, mid - rowIndex);
    for (let offset = 0; offset < length; offset++) {
      coords.push({ q: qStart + offset, r });
    }
  });

  return coords;
}

function makeTileCoords(mapProfile) {
  if (mapProfile?.rows) {
    return makeRowCoords(mapProfile.rows);
  }

  const radius = mapProfile?.radius ?? HEX_RADIUS;
  const coords = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) {
        coords.push({ q, r });
      }
    }
  }
  return coords.sort((a, b) => a.r - b.r || a.q - b.q);
}

function axialToPoint(q, r) {
  return {
    x: SQRT3 * (q + r / 2),
    y: 1.5 * r,
  };
}

function makeGeometry(seed = 1, mapProfile = getMapProfile('classic')) {
  const random = mulberry32(seed);
  const coords = makeTileCoords(mapProfile);
  const vertexByPoint = new Map();
  const vertices = {};
  const edges = {};
  let vertexIndex = 0;

  const resources = makeBalancedResources(seed, mapProfile);
  const numbers = makeBalancedNumbers(resources, coords, seed + 17, mapProfile);
  const tiles = coords.map((coord, tileIndex) => {
    const center = axialToPoint(coord.q, coord.r);
    const vertexIds = [];

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const x = center.x + Math.cos(angle);
      const y = center.y + Math.sin(angle);
      const key = pointKey(x, y);
      let vertexId = vertexByPoint.get(key);
      if (!vertexId) {
        vertexId = `v${vertexIndex++}`;
        vertexByPoint.set(key, vertexId);
        vertices[vertexId] = {
          id: vertexId,
          x: quantize(x),
          y: quantize(y),
          tileIds: [],
          edgeIds: [],
          adjacent: [],
          port: null,
          building: null,
        };
      }
      vertexIds.push(vertexId);
    }

    const tile = {
      id: `t${tileIndex}`,
      q: coord.q,
      r: coord.r,
      x: quantize(center.x),
      y: quantize(center.y),
      resource: resources[tileIndex],
      number: numbers[tileIndex],
      vertices: vertexIds,
      edges: [],
    };

    vertexIds.forEach((vertexId) => {
      vertices[vertexId].tileIds.push(tile.id);
    });

    for (let i = 0; i < 6; i++) {
      const a = vertexIds[i];
      const b = vertexIds[(i + 1) % 6];
      const id = edgeKey(a, b);
      if (!edges[id]) {
        edges[id] = {
          id,
          vertices: [a, b],
          tileIds: [],
          owner: null,
        };
      }
      edges[id].tileIds.push(tile.id);
      tile.edges.push(id);
      if (!vertices[a].edgeIds.includes(id)) vertices[a].edgeIds.push(id);
      if (!vertices[b].edgeIds.includes(id)) vertices[b].edgeIds.push(id);
      if (!vertices[a].adjacent.includes(b)) vertices[a].adjacent.push(b);
      if (!vertices[b].adjacent.includes(a)) vertices[b].adjacent.push(a);
    }

    return tile;
  });

  assignPorts(vertices, edges, random, mapProfile);
  const robberTileId = tiles.find(tile => tile.resource === 'desert')?.id || tiles[0].id;

  return { tiles, vertices, edges, robberTileId };
}

function makeBalancedResources(seed, mapProfile) {
  const random = mulberry32(seed);
  const coords = makeTileCoords(mapProfile);
  const resourceTiles = mapProfile.resources || getMapProfile('classic').resources;

  for (let attempt = 0; attempt < 80; attempt++) {
    const resources = shuffle(resourceTiles, random);
    const desertIndex = resources.indexOf('desert');
    const desert = coords[desertIndex];
    if (Math.max(Math.abs(desert.q), Math.abs(desert.r), Math.abs(desert.q + desert.r)) <= 1) {
      return resources;
    }
  }

  const resources = shuffle(resourceTiles, mulberry32(seed + 101));
  const centerIndex = Math.floor(resources.length / 2);
  resources[resources.indexOf('desert')] = resources[centerIndex];
  resources[centerIndex] = 'desert';
  return resources;
}

function makeBalancedNumbers(resources, coords, seed, mapProfile) {
  const random = mulberry32(seed);
  const adjacency = new Map();
  const numberTokens = mapProfile.numbers || getMapProfile('classic').numbers;
  coords.forEach((coord, i) => {
    adjacency.set(i, []);
    coords.forEach((other, j) => {
      if (i === j) return;
      const dq = coord.q - other.q;
      const dr = coord.r - other.r;
      if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) === 1) {
        adjacency.get(i).push(j);
      }
    });
  });

  for (let attempt = 0; attempt < 100; attempt++) {
    const tokens = shuffle(numberTokens, random);
    const numbers = resources.map(resource => resource === 'desert' ? null : tokens.shift());
    let redAdjacent = false;
    numbers.forEach((number, i) => {
      if (number !== 6 && number !== 8) return;
      for (const neighbor of adjacency.get(i)) {
        if (numbers[neighbor] === 6 || numbers[neighbor] === 8) {
          redAdjacent = true;
        }
      }
    });
    if (!redAdjacent) return numbers;
  }

  const tokens = [...numberTokens];
  return resources.map(resource => resource === 'desert' ? null : tokens.shift());
}

function assignPorts(vertices, edges, random, mapProfile) {
  const boundaryEdges = Object.values(edges)
    .filter(edge => edge.tileIds.length === 1)
    .map(edge => {
      const [a, b] = edge.vertices;
      const midX = (vertices[a].x + vertices[b].x) / 2;
      const midY = (vertices[a].y + vertices[b].y) / 2;
      return {
        edge,
        angle: Math.atan2(midY, midX),
      };
    })
    .sort((a, b) => a.angle - b.angle);

  const ports = shuffle(mapProfile.ports || getMapProfile('classic').ports, random);
  const step = boundaryEdges.length / ports.length;
  const used = new Set();

  ports.forEach((port, index) => {
    let cursor = Math.round(index * step) % boundaryEdges.length;
    while (used.has(cursor)) cursor = (cursor + 1) % boundaryEdges.length;
    used.add(cursor);
    const { edge } = boundaryEdges[cursor];
    edge.port = port;
    edge.vertices.forEach(vertexId => {
      vertices[vertexId].port = port;
    });
  });
}

export default class CatanBoard {
  static RESOURCES = RESOURCES;
  static COSTS = COSTS;
  static PLAYER_NAMES = PLAYER_NAMES;
  static PLAYER_COLORS = PLAYER_COLORS;

  constructor({
    seed = 1,
    playerCount = 4,
    rulesetId = 'base-classic',
    scenarioId = null,
    mapProfileId = null,
    skipInitialHistory = false,
  } = {}) {
    this.seed = seed;
    this.rngState = seed;
    const ruleset = getRuleset(rulesetId);
    const scenario = scenarioId
      ? ruleset.scenarios?.find(entry => entry.id === scenarioId)
      : getDefaultScenario(ruleset);
    this.rulesetId = ruleset.id;
    this.scenarioId = scenario?.id || null;
    this.playerCount = normalizePlayerCount(ruleset, playerCount);
    this.playerIds = Array.from({ length: this.playerCount }, (_, index) => index + 1);
    this.mapProfileId = mapProfileId || ruleset.mapProfileId || (this.playerCount >= 5 ? 'extended' : 'classic');
    if (this.playerCount >= 5 && this.mapProfileId === 'classic') {
      this.mapProfileId = 'extended';
    }
    this.mapProfile = getMapProfile(this.mapProfileId);
    this.mapName = this.mapProfile.name;
    // A catalog scenario's headline target can exceed what the base engine can
    // reach (no expansion VP sources), so clamp it to a reachable ceiling (see
    // reachableTarget). scenarioTarget is kept for reference; victoryTarget is
    // what's actually played, and the setup UI shows the same clamped value.
    this.scenarioTarget = scenario?.target || ruleset.victoryPoints || 10;
    this.victoryTarget = Math.min(this.scenarioTarget, reachableTarget(this.playerCount));
    this.pairedPlayers = !!ruleset.pairedPlayers || this.playerCount >= 5;
    this.pieceLimits = { ...this.mapProfile.pieceLimits };

    const geometry = makeGeometry(seed, this.mapProfile);
    this.tiles = geometry.tiles;
    this.vertices = geometry.vertices;
    this.edges = geometry.edges;
    this.robberTileId = geometry.robberTileId;

    this.players = {};
    for (const player of this.playerIds) {
      this.players[player] = {
        id: player,
        name: PLAYER_NAMES[player],
        color: PLAYER_COLORS[player],
        resources: emptyResources(),
        devCards: emptyDevCards(),
        newDevCards: emptyDevCards(),
        roads: [],
        settlements: [],
        cities: [],
        knightsPlayed: 0,
        playedDevThisTurn: false,
        longestRoad: false,
        largestArmy: false,
      };
    }

    const bankSize = this.mapProfile.bankSize || 19;
    this.bank = { brick: bankSize, lumber: bankSize, wool: bankSize, grain: bankSize, ore: bankSize };
    this.devDeck = shuffle(DEV_DECK, mulberry32(seed + 31));
    this.discardLog = [];
    // Randomize who goes first (seed-derived, so the human isn't always first).
    // The setup snake and the round order both start from this player.
    const firstIndex = Math.floor(mulberry32(seed + 53)() * this.playerCount);
    this.firstPlayer = this.playerIds[firstIndex];
    const order = [...this.playerIds.slice(firstIndex), ...this.playerIds.slice(0, firstIndex)];
    this.currentPlayer = this.firstPlayer;
    this.primaryTurnPlayer = this.firstPlayer;
    this.phase = 'setup-settlement';
    this.setupOrder = [...order, ...[...order].reverse()];
    this.setupIndex = 0;
    this.pendingSetupSettlement = null;
    this.turnNumber = 1;
    this.dice = null;
    this.lastRoll = null;
    this.lastAction = 'Place your first settlement.';
    this.pendingAfterRobberPhase = null;
    this.freeRoadsRemaining = 0;
    this.discardQueue = [];
    this.pendingTrade = null;
    this.tradeProposalsThisTurn = 0;
    this.maxTradeProposalsPerTurn = 4;
    this.longestRoadHolder = null;
    this.largestArmyHolder = null;
    this.winner = null;
    this.winningPoints = 0;

    this.stateHistory = [];
    this.historyIndex = -1;
    this.maxHistoryLength = 80;

    if (!skipInitialHistory) {
      this._captureState();
    }
  }

  _random() {
    const random = mulberry32(this.rngState + 1);
    const value = random();
    this.rngState = (this.rngState + 1) >>> 0;
    return value;
  }

  clone() {
    return CatanBoard.fromSerializedState(this.serializeState());
  }

  startNewGame(seed = Date.now()) {
    const next = new CatanBoard({
      seed,
      playerCount: this.playerCount,
      rulesetId: this.rulesetId,
      scenarioId: this.scenarioId,
      mapProfileId: this.mapProfileId,
    });
    Object.assign(this, next);
    this._captureState();
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayer];
  }

  getPlayerIds() {
    return this.playerIds || Object.keys(this.players).map(Number).sort((a, b) => a - b);
  }

  _nextPlayerId(playerId = this.currentPlayer) {
    const ids = this.getPlayerIds();
    const index = ids.indexOf(playerId);
    return ids[(index + 1) % ids.length] || ids[0];
  }

  _pairedPlayerFor(playerId = this.primaryTurnPlayer) {
    if (!this.pairedPlayers || this.playerCount < 5) return null;
    const ids = this.getPlayerIds();
    const index = ids.indexOf(playerId);
    if (index < 0) return null;
    return ids[(index + 3) % ids.length];
  }

  _isActionPhase() {
    return this.phase === 'action' || this.phase === 'paired-action';
  }

  getTile(tileId) {
    return this.tiles.find(tile => tile.id === tileId);
  }

  getAdjacentTilesForVertex(vertexId) {
    return this.vertices[vertexId].tileIds.map(tileId => this.getTile(tileId));
  }

  getPlayerResourceTotal(playerId) {
    return resourceTotal(this.players[playerId].resources);
  }

  canAfford(playerId, cost) {
    const resources = this.players[playerId].resources;
    return Object.entries(cost).every(([resource, amount]) => resources[resource] >= amount);
  }

  getVictoryPoints(playerId) {
    const player = this.players[playerId];
    return (
      player.settlements.length +
      player.cities.length * 2 +
      player.devCards.victoryPoint +
      player.newDevCards.victoryPoint +
      (player.longestRoad ? 2 : 0) +
      (player.largestArmy ? 2 : 0)
    );
  }

  getPublicScores() {
    const scores = {};
    for (const player of this.getPlayerIds()) {
      const p = this.players[player];
      scores[player] = (
        p.settlements.length +
        p.cities.length * 2 +
        (p.longestRoad ? 2 : 0) +
        (p.largestArmy ? 2 : 0)
      );
    }
    return scores;
  }

  getValidSettlementVertices(playerId = this.currentPlayer, setup = false) {
    const player = this.players[playerId];
    if (!setup && (player.settlements.length >= this.pieceLimits.settlements || !this.canAfford(playerId, COSTS.settlement))) {
      return [];
    }

    return Object.values(this.vertices)
      .filter(vertex => !vertex.building)
      .filter(vertex => vertex.adjacent.every(adjacentId => !this.vertices[adjacentId].building))
      .filter(vertex => setup || vertex.edgeIds.some(edgeId => this.edges[edgeId].owner === playerId))
      .map(vertex => vertex.id);
  }

  getValidCityVertices(playerId = this.currentPlayer) {
    const player = this.players[playerId];
    if (player.cities.length >= this.pieceLimits.cities || !this.canAfford(playerId, COSTS.city)) return [];
    return player.settlements.filter(vertexId => this.vertices[vertexId].building?.player === playerId);
  }

  getValidSetupRoadEdges(vertexId, playerId = this.currentPlayer) {
    if (!vertexId || !this.vertices[vertexId]) return [];
    return this.vertices[vertexId].edgeIds.filter(edgeId => !this.edges[edgeId].owner);
  }

  getValidRoadEdges(playerId = this.currentPlayer, free = false) {
    const player = this.players[playerId];
    if (player.roads.length >= this.pieceLimits.roads) return [];
    if (!free && !this.canAfford(playerId, COSTS.road)) return [];

    return Object.values(this.edges)
      .filter(edge => !edge.owner)
      .filter(edge => edge.vertices.some(vertexId => this._roadCanConnectAtVertex(playerId, vertexId)))
      .map(edge => edge.id);
  }

  _roadCanConnectAtVertex(playerId, vertexId) {
    const vertex = this.vertices[vertexId];
    if (vertex.building) return vertex.building.player === playerId;
    return vertex.edgeIds.some(edgeId => this.edges[edgeId].owner === playerId);
  }

  placeSetupSettlement(vertexId) {
    if (this.phase !== 'setup-settlement') return false;
    const playerId = this.setupOrder[this.setupIndex];
    if (playerId !== this.currentPlayer) return false;
    if (!this.getValidSettlementVertices(playerId, true).includes(vertexId)) return false;

    this.vertices[vertexId].building = { player: playerId, type: 'settlement' };
    this.players[playerId].settlements.push(vertexId);
    this.pendingSetupSettlement = vertexId;
    this.phase = 'setup-road';
    this.lastAction = `${this.players[playerId].name} placed a settlement.`;
    this._captureState();
    return true;
  }

  placeSetupRoad(edgeId) {
    if (this.phase !== 'setup-road') return false;
    const playerId = this.setupOrder[this.setupIndex];
    if (!this.getValidSetupRoadEdges(this.pendingSetupSettlement, playerId).includes(edgeId)) return false;

    this.edges[edgeId].owner = playerId;
    this.players[playerId].roads.push(edgeId);

    if (this.setupIndex >= this.playerCount) {
      this._grantInitialResources(playerId, this.pendingSetupSettlement);
    }

    this.pendingSetupSettlement = null;
    this.setupIndex++;
    this._updateLongestRoad();

    if (this.setupIndex >= this.setupOrder.length) {
      this.currentPlayer = this.firstPlayer;
      this.primaryTurnPlayer = this.firstPlayer;
      this.phase = 'roll';
      this.lastAction = `Setup complete. ${this.players[this.firstPlayer].name} rolls first.`;
    } else {
      this.currentPlayer = this.setupOrder[this.setupIndex];
      this.phase = 'setup-settlement';
      this.lastAction = `${this.players[this.currentPlayer].name} places a settlement.`;
    }

    this._captureState();
    return true;
  }

  _grantInitialResources(playerId, vertexId) {
    for (const tile of this.getAdjacentTilesForVertex(vertexId)) {
      if (!tile || tile.resource === 'desert') continue;
      this._gainResource(playerId, tile.resource, 1);
    }
  }

  rollDice(total = null) {
    if (this.phase !== 'roll') return false;
    this.primaryTurnPlayer = this.currentPlayer;
    const diceTotal = total || (1 + Math.floor(this._random() * 6)) + (1 + Math.floor(this._random() * 6));
    this.dice = diceTotal;
    this.lastRoll = diceTotal;

    if (diceTotal === 7) {
      this.pendingAfterRobberPhase = 'action';
      this.discardLog = [];
      this.discardQueue = this.getPlayerIds()
        .filter(player => this.getPlayerResourceTotal(player) > 7)
        .map(player => ({ player, remaining: Math.floor(this.getPlayerResourceTotal(player) / 2) }));

      if (this.discardQueue.length > 0) {
        this.phase = 'discard';
        this.currentPlayer = this.discardQueue[0].player;
        this.lastAction = `${this.players[this.currentPlayer].name} must discard ${this.discardQueue[0].remaining} cards.`;
      } else {
        this.phase = 'robber';
        this.lastAction = `${this.players[this.currentPlayer].name} rolled 7. Move the robber.`;
      }
      this._captureState();
      return true;
    }

    this._distributeResources(diceTotal);
    this.phase = 'action';
    this.lastAction = `${this.players[this.currentPlayer].name} rolled ${diceTotal}.`;
    this._captureState();
    return true;
  }

  _distributeResources(number) {
    const payouts = [];
    for (const tile of this.tiles) {
      if (tile.number !== number || tile.id === this.robberTileId || tile.resource === 'desert') continue;
      for (const vertexId of tile.vertices) {
        const building = this.vertices[vertexId].building;
        if (!building) continue;
        payouts.push({
          player: building.player,
          resource: tile.resource,
          amount: building.type === 'city' ? 2 : 1,
        });
      }
    }

    const needed = {};
    payouts.forEach(({ resource, amount }) => {
      needed[resource] = (needed[resource] || 0) + amount;
    });

    for (const [resource, amount] of Object.entries(needed)) {
      if (this.bank[resource] < amount) {
        payouts.forEach(payout => {
          if (payout.resource === resource) payout.skip = true;
        });
      }
    }

    payouts.forEach(({ player, resource, amount, skip }) => {
      if (!skip) this._gainResource(player, resource, amount);
    });
  }

  // Discard a single card for the player at the head of the discard queue.
  // Players over seven cards each drop one card at a time (a real decision)
  // before the roller moves the robber.
  discardCard(resource) {
    if (this.phase !== 'discard') return false;
    const head = this.discardQueue[0];
    if (!head || head.player !== this.currentPlayer) return false;
    const player = this.players[this.currentPlayer];
    if (!RESOURCES.includes(resource) || player.resources[resource] <= 0) return false;

    player.resources[resource]--;
    this.bank[resource]++;
    head.remaining--;

    let logEntry = this.discardLog.find(entry => entry.player === head.player);
    if (!logEntry) {
      logEntry = { player: head.player, resources: emptyResources() };
      this.discardLog.push(logEntry);
    }
    logEntry.resources[resource]++;

    if (head.remaining <= 0) {
      this.discardQueue.shift();
    }

    if (this.discardQueue.length > 0) {
      const next = this.discardQueue[0];
      this.currentPlayer = next.player;
      this.phase = 'discard';
      this.lastAction = `${this.players[next.player].name} must discard ${next.remaining} cards.`;
    } else {
      this.currentPlayer = this.primaryTurnPlayer;
      this.phase = 'robber';
      this.lastAction = `${this.players[this.currentPlayer].name} must move the robber.`;
    }

    this._captureState();
    return true;
  }

  moveRobber(tileId, stealPlayerId = null) {
    if (this.phase !== 'robber') return false;
    if (!this.tiles.some(tile => tile.id === tileId) || tileId === this.robberTileId) return false;

    this.robberTileId = tileId;
    const victims = this.getRobberVictims(tileId).filter(playerId => playerId !== this.currentPlayer);
    const victim = stealPlayerId && victims.includes(stealPlayerId)
      ? stealPlayerId
      : victims.sort((a, b) => this.getPlayerResourceTotal(b) - this.getPlayerResourceTotal(a))[0];

    let stolen = null;
    if (victim && this.getPlayerResourceTotal(victim) > 0) {
      stolen = this._stealResource(victim, this.currentPlayer);
    }

    this.phase = this.pendingAfterRobberPhase || 'action';
    this.pendingAfterRobberPhase = null;
    this.lastAction = stolen
      ? `${this.players[this.currentPlayer].name} moved the robber and stole from ${this.players[victim].name}.`
      : `${this.players[this.currentPlayer].name} moved the robber.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  getRobberVictims(tileId = this.robberTileId) {
    const tile = this.getTile(tileId);
    if (!tile) return [];
    const victims = new Set();
    tile.vertices.forEach(vertexId => {
      const building = this.vertices[vertexId].building;
      if (building && this.getPlayerResourceTotal(building.player) > 0) {
        victims.add(building.player);
      }
    });
    return [...victims];
  }

  buildRoad(edgeId, { free = false } = {}) {
    if (!this._isActionPhase()) return false;
    if (!this.edges[edgeId] || this.edges[edgeId].owner) return false;
    if (!this.getValidRoadEdges(this.currentPlayer, free || this.freeRoadsRemaining > 0).includes(edgeId)) return false;

    const player = this.getCurrentPlayer();
    if (this.freeRoadsRemaining > 0) {
      this.freeRoadsRemaining--;
    } else if (!free) {
      this._payCost(this.currentPlayer, COSTS.road);
    }

    this.edges[edgeId].owner = this.currentPlayer;
    player.roads.push(edgeId);
    this._updateLongestRoad();
    this.lastAction = `${player.name} built a road.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  buildSettlement(vertexId, { free = false } = {}) {
    if (!this._isActionPhase()) return false;
    if (!this.getValidSettlementVertices(this.currentPlayer, false).includes(vertexId)) return false;
    const player = this.getCurrentPlayer();
    if (player.settlements.length >= this.pieceLimits.settlements) return false;
    if (!free) this._payCost(this.currentPlayer, COSTS.settlement);

    this.vertices[vertexId].building = { player: this.currentPlayer, type: 'settlement' };
    player.settlements.push(vertexId);
    // A settlement can sever an opponent's road, so longest road must be
    // re-evaluated here, not just on road builds.
    this._updateLongestRoad();
    this.lastAction = `${player.name} built a settlement.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  buildCity(vertexId) {
    if (!this._isActionPhase()) return false;
    if (!this.getValidCityVertices(this.currentPlayer).includes(vertexId)) return false;

    const player = this.getCurrentPlayer();
    this._payCost(this.currentPlayer, COSTS.city);
    this.vertices[vertexId].building = { player: this.currentPlayer, type: 'city' };
    player.settlements = player.settlements.filter(id => id !== vertexId);
    player.cities.push(vertexId);
    this.lastAction = `${player.name} upgraded to a city.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  buyDevelopmentCard() {
    if (!this._isActionPhase()) return false;
    if (this.devDeck.length === 0 || !this.canAfford(this.currentPlayer, COSTS.dev)) return false;

    this._payCost(this.currentPlayer, COSTS.dev);
    const card = this.devDeck.pop();
    this.players[this.currentPlayer].newDevCards[card]++;
    this.lastAction = `${this.players[this.currentPlayer].name} bought a development card.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  playKnight() {
    if (!this._isActionPhase()) return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.knight <= 0) return false;
    player.devCards.knight--;
    player.knightsPlayed++;
    player.playedDevThisTurn = true;
    this._updateLargestArmy();
    const returnPhase = this.phase;
    this.phase = 'robber';
    this.pendingAfterRobberPhase = returnPhase;
    this.lastAction = `${player.name} played a knight.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  playYearOfPlenty(resourceA, resourceB) {
    if (!this._isActionPhase()) return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.yearOfPlenty <= 0) return false;
    if (!RESOURCES.includes(resourceA) || !RESOURCES.includes(resourceB)) return false;
    if (this.bank[resourceA] <= 0 || this.bank[resourceB] <= 0) return false;

    player.devCards.yearOfPlenty--;
    player.playedDevThisTurn = true;
    this._gainResource(this.currentPlayer, resourceA, 1);
    this._gainResource(this.currentPlayer, resourceB, 1);
    this.lastAction = `${player.name} played Year of Plenty.`;
    this._captureState();
    return true;
  }

  playMonopoly(resource) {
    if (!this._isActionPhase()) return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.monopoly <= 0) return false;
    if (!RESOURCES.includes(resource)) return false;

    player.devCards.monopoly--;
    player.playedDevThisTurn = true;
    let total = 0;
    for (const opponent of this.getPlayerIds()) {
      if (opponent === this.currentPlayer) continue;
      const amount = this.players[opponent].resources[resource];
      this.players[opponent].resources[resource] = 0;
      player.resources[resource] += amount;
      total += amount;
    }
    this.lastAction = `${player.name} monopolized ${resource} (${total}).`;
    this._captureState();
    return true;
  }

  playRoadBuilding() {
    if (!this._isActionPhase()) return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.roadBuilding <= 0) return false;
    player.devCards.roadBuilding--;
    player.playedDevThisTurn = true;
    this.freeRoadsRemaining = Math.min(2, this.pieceLimits.roads - player.roads.length);
    this.lastAction = `${player.name} played Road Building.`;
    this._captureState();
    return true;
  }

  tradeWithBank(give, receive, ratio = null) {
    if (!this._isActionPhase()) return false;
    if (!RESOURCES.includes(give) || !RESOURCES.includes(receive) || give === receive) return false;
    const actualRatio = this.getTradeRatio(this.currentPlayer, give);
    const tradeRatio = ratio || actualRatio;
    if (tradeRatio < actualRatio) return false;
    if (this.players[this.currentPlayer].resources[give] < tradeRatio || this.bank[receive] < 1) return false;

    this.players[this.currentPlayer].resources[give] -= tradeRatio;
    this.bank[give] += tradeRatio;
    this._gainResource(this.currentPlayer, receive, 1);
    this.lastAction = `${this.players[this.currentPlayer].name} traded ${tradeRatio} ${give} for ${receive}.`;
    this._captureState();
    return true;
  }

  _bundleTotal(bundle) {
    return Object.values(bundle || {}).reduce((sum, amount) => sum + (amount || 0), 0);
  }

  _hasBundle(playerId, bundle) {
    return Object.entries(bundle || {}).every(([resource, amount]) =>
      RESOURCES.includes(resource) && this.players[playerId].resources[resource] >= amount);
  }

  _transferBundle(fromPlayerId, toPlayerId, bundle) {
    for (const [resource, amount] of Object.entries(bundle)) {
      this.players[fromPlayerId].resources[resource] -= amount;
      this.players[toPlayerId].resources[resource] += amount;
    }
  }

  // Offer give-bundle for receive-bundle to one or more opponents. Bundles may
  // contain multiple resource types. Targeted opponents respond in order; the
  // first to accept completes the trade. Arbitrary bundles/targets are accepted
  // so the human UI has full freedom; the AI enumerates a curated subset.
  proposeTrade(give, receive, targets) {
    if (!this._isActionPhase()) return false;
    const proposer = this.currentPlayer;
    let targetList = (Array.isArray(targets) ? targets : [targets])
      .filter(id => id !== proposer && this.players[id]);
    if (targetList.length === 0) return false;
    if (this._bundleTotal(give) === 0 || this._bundleTotal(receive) === 0) return false;
    if (!this._validBundle(give) || !this._validBundle(receive)) return false;
    if (!this._hasBundle(proposer, give)) return false;
    if (this.tradeProposalsThisTurn >= this.maxTradeProposalsPerTurn) return false;

    this.tradeProposalsThisTurn++;
    this.pendingTrade = {
      proposer,
      give: { ...give },
      receive: { ...receive },
      targets: [...targetList],
      index: 0,
      returnPhase: this.phase,
    };
    this.phase = 'trade-response';
    this.lastAction = `${this.players[proposer].name} proposed a trade.`;
    // A target who can't afford the requested bundle is auto-skipped (never asked,
    // so a human isn't forced to decline a trade they can't do). The proposal
    // itself always stands as a valid action — important so an AI proposing on a
    // determinized (imperfect-info) belief never makes an illegal move.
    if (!this._advanceToAffordableResponder()) {
      this.lastAction = `${this.players[proposer].name}'s trade found no taker.`;
      this._finishTrade();
      return true;
    }
    this._captureState();
    return true;
  }

  // Advance the pending trade to the next target who can afford the requested
  // bundle, auto-skipping those who can't. Returns true if an able responder is
  // now current, false if the targets are exhausted.
  _advanceToAffordableResponder() {
    const trade = this.pendingTrade;
    while (trade.index < trade.targets.length) {
      const candidate = trade.targets[trade.index];
      if (this._hasBundle(candidate, trade.receive)) {
        this.currentPlayer = candidate;
        return true;
      }
      trade.index++;
    }
    return false;
  }

  _validBundle(bundle) {
    return Object.entries(bundle || {}).every(([resource, amount]) =>
      RESOURCES.includes(resource) && Number.isInteger(amount) && amount > 0);
  }

  respondTrade(accept) {
    if (this.phase !== 'trade-response' || !this.pendingTrade) return false;
    const trade = this.pendingTrade;
    const responder = trade.targets[trade.index];
    if (responder !== this.currentPlayer) return false;

    const canAccept = accept && this._hasBundle(responder, trade.receive);
    if (canAccept) {
      this._transferBundle(trade.proposer, responder, trade.give);
      this._transferBundle(responder, trade.proposer, trade.receive);
      this.lastAction = `${this.players[responder].name} accepted ${this.players[trade.proposer].name}'s trade.`;
      this._finishTrade();
      return true;
    }

    // Decline: advance to the next able responder, skipping any who can't pay.
    trade.index++;
    this.lastAction = `${this.players[responder].name} declined the trade.`;
    if (this._advanceToAffordableResponder()) {
      this._captureState();
      return true;
    }
    this.lastAction = `${this.players[trade.proposer].name}'s trade was declined.`;
    this._finishTrade();
    return true;
  }

  _finishTrade() {
    const trade = this.pendingTrade;
    this.currentPlayer = trade.proposer;
    this.phase = trade.returnPhase || 'action';
    this.pendingTrade = null;
    this._captureState();
  }

  endTurn() {
    if (!this._isActionPhase()) return false;
    const endingPhase = this.phase;
    const player = this.getCurrentPlayer();
    for (const card of Object.keys(player.newDevCards)) {
      player.devCards[card] += player.newDevCards[card];
      player.newDevCards[card] = 0;
    }
    player.playedDevThisTurn = false;
    this.freeRoadsRemaining = 0;
    this.tradeProposalsThisTurn = 0;
    this.pendingTrade = null;
    this.dice = null;

    if (this.pairedPlayers && endingPhase === 'action') {
      const pairedPlayer = this._pairedPlayerFor(this.primaryTurnPlayer);
      if (pairedPlayer && pairedPlayer !== this.currentPlayer) {
        this.currentPlayer = pairedPlayer;
        this.phase = 'paired-action';
        this.lastAction = `${this.players[this.currentPlayer].name}'s paired build phase.`;
        this._captureState();
        return true;
      }
    }

    const previousPrimary = this.primaryTurnPlayer || this.currentPlayer;
    this.currentPlayer = this._nextPlayerId(previousPrimary);
    this.primaryTurnPlayer = this.currentPlayer;
    if (this.currentPlayer === this.firstPlayer) this.turnNumber++; // round boundary

    // A player who reached the target off-turn (longest-road transfer, special
    // build) wins the moment their own turn begins.
    const startPoints = this.getVictoryPoints(this.currentPlayer);
    if (startPoints >= this.victoryTarget) {
      this.phase = 'game-over';
      this.winner = this.currentPlayer;
      this.winningPoints = startPoints;
      this.lastAction = `${this.players[this.currentPlayer].name} wins with ${startPoints} points at the start of their turn.`;
      this._captureState();
      return true;
    }

    // Safety net: a board's reachable VP ceiling can sit below the target (no
    // expansion VP sources), which would never end. After an unreasonable number
    // of rounds, award the win to the VP leader so every game terminates.
    if (this.turnNumber > MAX_GAME_TURNS) {
      const ids = this.getPlayerIds();
      const leader = ids.reduce((best, p) => (this.getVictoryPoints(p) > this.getVictoryPoints(best) ? p : best), ids[0]);
      this.phase = 'game-over';
      this.winner = leader;
      this.winningPoints = this.getVictoryPoints(leader);
      this.lastAction = `${this.players[leader].name} wins on points (game-length limit).`;
      this._captureState();
      return true;
    }

    this.phase = 'roll';
    this.lastAction = `${this.players[this.currentPlayer].name}'s turn.`;
    this._captureState();
    return true;
  }

  getTradeRatio(playerId, resource) {
    let ratio = 4;
    const player = this.players[playerId];
    for (const vertexId of [...player.settlements, ...player.cities]) {
      const port = this.vertices[vertexId].port;
      if (port === resource) ratio = Math.min(ratio, 2);
      if (port === 'any') ratio = Math.min(ratio, 3);
    }
    return ratio;
  }

  getTradeOptions(playerId = this.currentPlayer) {
    const options = [];
    for (const give of RESOURCES) {
      const ratio = this.getTradeRatio(playerId, give);
      if (this.players[playerId].resources[give] < ratio) continue;
      for (const receive of RESOURCES) {
        if (give === receive || this.bank[receive] < 1) continue;
        options.push({ type: 'trade', give, receive, ratio });
      }
    }
    return options;
  }

  getLegalMoves(options = {}) {
    const rollout = options.rollout === true;
    if (this.phase === 'game-over') return [];

    if (this.phase === 'setup-settlement') {
      return this.getValidSettlementVertices(this.currentPlayer, true)
        .map(vertexId => ({ type: 'setup-settlement', vertexId }));
    }

    if (this.phase === 'setup-road') {
      return this.getValidSetupRoadEdges(this.pendingSetupSettlement, this.currentPlayer)
        .map(edgeId => ({ type: 'setup-road', edgeId }));
    }

    if (this.phase === 'roll') {
      return [{ type: 'roll' }];
    }

    if (this.phase === 'discard') {
      const player = this.players[this.currentPlayer];
      return RESOURCES
        .filter(resource => player.resources[resource] > 0)
        .map(resource => ({ type: 'discard', resource }));
    }

    if (this.phase === 'robber') {
      const moves = [];
      for (const tile of this.tiles) {
        if (tile.id === this.robberTileId) continue;
        const victims = this.getRobberVictims(tile.id).filter(playerId => playerId !== this.currentPlayer);
        if (victims.length === 0) {
          moves.push({ type: 'move-robber', tileId: tile.id, stealPlayerId: null });
        } else {
          for (const victim of victims) {
            moves.push({ type: 'move-robber', tileId: tile.id, stealPlayerId: victim });
          }
        }
      }
      return moves;
    }

    if (this.phase === 'trade-response') {
      return [
        { type: 'respond-trade', accept: true },
        { type: 'respond-trade', accept: false },
      ];
    }

    if (!this._isActionPhase()) return [];

    const moves = [];
    const freeRoad = this.freeRoadsRemaining > 0;
    this.getValidCityVertices(this.currentPlayer).forEach(vertexId => moves.push({ type: 'build-city', vertexId }));
    this.getValidSettlementVertices(this.currentPlayer, false).forEach(vertexId => moves.push({ type: 'build-settlement', vertexId }));
    const roadEdges = this.getValidRoadEdges(this.currentPlayer, freeRoad);
    roadEdges.forEach(edgeId => moves.push({ type: 'build-road', edgeId, free: freeRoad }));

    if (this.devDeck.length > 0 && this.canAfford(this.currentPlayer, COSTS.dev)) {
      moves.push({ type: 'buy-dev' });
    }

    const player = this.getCurrentPlayer();
    if (!player.playedDevThisTurn) {
      if (player.devCards.knight > 0) moves.push({ type: 'play-knight' });
      if (player.devCards.roadBuilding > 0 && player.roads.length < this.pieceLimits.roads) moves.push({ type: 'play-road-building' });
      if (player.devCards.yearOfPlenty > 0) {
        for (const [resourceA, resourceB] of this._yearOfPlentyPairs()) {
          moves.push({ type: 'play-year-of-plenty', resourceA, resourceB });
        }
      }
      if (player.devCards.monopoly > 0) {
        for (const resource of RESOURCES) {
          moves.push({ type: 'play-monopoly', resource });
        }
      }
    }

    // In rollout (cheap) mode, skip the expensive full bank-trade and
    // propose-trade enumeration: keep only a few highest-need bank trades and no
    // player-to-player proposals. The default (non-rollout) path returns the
    // complete set unchanged so the test suite and real root decisions are intact.
    if (rollout) {
      this.getStrategicTradeOptions(this.currentPlayer, 4).forEach(move => moves.push(move));
    } else {
      this.getTradeOptions(this.currentPlayer).forEach(move => moves.push(move));
      this._proposeTradeOptions(this.currentPlayer).forEach(move => moves.push(move));
    }
    if (this.freeRoadsRemaining === 0 || roadEdges.length === 0) moves.push({ type: 'end-turn' });
    return moves;
  }

  // Unordered resource pairs (including two-of-the-same) the bank can currently supply.
  _yearOfPlentyPairs() {
    const pairs = [];
    for (let i = 0; i < RESOURCES.length; i++) {
      for (let j = i; j < RESOURCES.length; j++) {
        const a = RESOURCES[i];
        const b = RESOURCES[j];
        const needed = a === b ? 2 : 1;
        if (this.bank[a] >= (a === b ? needed : 1) && this.bank[b] >= 1 && (a !== b || this.bank[a] >= 2)) {
          pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }

  // Bounded set of player-to-player trade proposals for the AI: give 1-2 of a
  // single surplus resource for 1 of a single needed resource, offered to each
  // opponent individually and to all opponents at once. The engine itself
  // (proposeTrade) accepts arbitrary multi-resource bundles for human use; this
  // only curates what the search/NN enumerates so the action space stays small.
  _proposeTradeOptions(playerId = this.currentPlayer, limit = 10) {
    if (this.pairedPlayers) return [];
    const player = this.players[playerId];
    const opponents = this.getPlayerIds().filter(id => id !== playerId);
    if (opponents.length === 0) return [];
    if ((this.tradeProposalsThisTurn || 0) >= this.maxTradeProposalsPerTurn) return [];

    const surplus = RESOURCES.filter(resource => player.resources[resource] > 0);
    const needs = this._mostNeededResources(playerId)
      .filter(resource => this._resourceNeedScore(playerId, resource) > 0)
      .slice(0, 2);
    if (needs.length === 0) return [];

    const targetSets = [...opponents.map(id => [id]), opponents];
    const options = [];
    for (const give of surplus) {
      for (const receive of needs) {
        if (give === receive) continue;
        const giveAmount = player.resources[give] >= 2 ? 2 : 1;
        const receiveBundle = { [receive]: 1 };
        for (const targets of targetSets) {
          // Skip dead proposals: only offer if at least one targeted opponent
          // can actually afford the requested bundle.
          if (!targets.some(id => this._hasBundle(id, receiveBundle))) continue;
          options.push({
            type: 'propose-trade',
            give: { [give]: giveAmount },
            receive: { ...receiveBundle },
            targets: [...targets],
          });
        }
      }
    }

    return options
      .map(move => ({
        move,
        score: this._resourceNeedScore(playerId, Object.keys(move.receive)[0]) - move.targets.length * 0.05,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.move);
  }

  getStrategicTradeOptions(playerId = this.currentPlayer, limit = 12) {
    return this.getTradeOptions(playerId)
      .map(move => ({ move, score: this._resourceNeedScore(playerId, move.receive) - this._resourceNeedScore(playerId, move.give) * 0.35 - move.ratio * 0.04 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.move);
  }

  applyMove(move) {
    if (!move) return false;
    switch (move.type) {
      case 'setup-settlement':
        return this.placeSetupSettlement(move.vertexId);
      case 'setup-road':
        return this.placeSetupRoad(move.edgeId);
      case 'roll':
        return this.rollDice(move.total || null);
      case 'discard':
        return this.discardCard(move.resource);
      case 'move-robber':
        return this.moveRobber(move.tileId, move.stealPlayerId || null);
      case 'propose-trade':
        return this.proposeTrade(move.give, move.receive, move.targets);
      case 'respond-trade':
        return this.respondTrade(move.accept);
      case 'build-road':
        return this.buildRoad(move.edgeId, { free: !!move.free });
      case 'build-settlement':
        return this.buildSettlement(move.vertexId);
      case 'build-city':
        return this.buildCity(move.vertexId);
      case 'buy-dev':
        return this.buyDevelopmentCard();
      case 'play-knight':
        return this.playKnight();
      case 'play-year-of-plenty':
        return this.playYearOfPlenty(move.resourceA, move.resourceB);
      case 'play-monopoly':
        return this.playMonopoly(move.resource);
      case 'play-road-building':
        return this.playRoadBuilding();
      case 'trade':
        return this.tradeWithBank(move.give, move.receive, move.ratio);
      case 'end-turn':
        return this.endTurn();
      default:
        return false;
    }
  }

  _bestMonopolyResource(playerId) {
    let best = 'grain';
    let bestCount = -1;
    for (const resource of RESOURCES) {
      let count = 0;
      for (const player of this.getPlayerIds()) {
        if (player !== playerId) count += this.players[player].resources[resource];
      }
      if (count > bestCount) {
        best = resource;
        bestCount = count;
      }
    }
    return best;
  }

  _mostNeededResources(playerId) {
    return [...RESOURCES].sort((a, b) => this._resourceNeedScore(playerId, b) - this._resourceNeedScore(playerId, a));
  }

  _resourceNeedScore(playerId, resource) {
    const player = this.players[playerId];
    const have = player.resources[resource] || 0;
    let need = 0;

    for (const cost of [COSTS.city, COSTS.settlement, COSTS.road, COSTS.dev]) {
      if (cost[resource]) need += Math.max(0, cost[resource] - have) * (cost === COSTS.city ? 1.5 : 1);
    }

    const production = this._productionForResource(playerId, resource);
    return need + Math.max(0, 2 - production) * 0.8;
  }

  _productionForResource(playerId, resource) {
    let score = 0;
    for (const vertexId of [...this.players[playerId].settlements, ...this.players[playerId].cities]) {
      const building = this.vertices[vertexId].building;
      const multiplier = building?.type === 'city' ? 2 : 1;
      for (const tile of this.getAdjacentTilesForVertex(vertexId)) {
        if (tile.resource === resource && tile.number) {
          score += CatanBoard.getPipCount(tile.number) * multiplier;
        }
      }
    }
    return score;
  }

  static getPipCount(number) {
    if (!number || number === 7) return 0;
    return 6 - Math.abs(7 - number);
  }

  _payCost(playerId, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
      this.players[playerId].resources[resource] -= amount;
      this.bank[resource] += amount;
    }
  }

  _gainResource(playerId, resource, amount) {
    const available = Math.min(amount, this.bank[resource]);
    if (available <= 0) return 0;
    this.bank[resource] -= available;
    this.players[playerId].resources[resource] += available;
    return available;
  }

  _stealResource(fromPlayerId, toPlayerId) {
    const from = this.players[fromPlayerId].resources;
    // Steal a uniformly random card from the victim's hand (you don't get to
    // pick the best one), drawn proportionally to what they hold.
    const pool = [];
    for (const resource of RESOURCES) {
      for (let i = 0; i < from[resource]; i++) pool.push(resource);
    }
    if (pool.length === 0) return null;
    const resource = pool[Math.floor(this._random() * pool.length)];
    from[resource]--;
    this.players[toPlayerId].resources[resource]++;
    return resource;
  }

  _updateLargestArmy() {
    let bestPlayer = this.largestArmyHolder;
    let bestCount = bestPlayer ? this.players[bestPlayer].knightsPlayed : 2;
    for (const player of this.getPlayerIds()) {
      const count = this.players[player].knightsPlayed;
      if (count >= 3 && count > bestCount) {
        bestPlayer = player;
        bestCount = count;
      }
    }

    for (const player of this.getPlayerIds()) {
      this.players[player].largestArmy = player === bestPlayer;
    }
    this.largestArmyHolder = bestPlayer || null;
  }

  _updateLongestRoad() {
    const lengths = {};
    for (const player of this.getPlayerIds()) {
      lengths[player] = this._longestRoadForPlayer(player);
    }

    // The incumbent keeps the card while their road still qualifies (>= 5),
    // including on ties. A challenger must be strictly longer. If the road is
    // severed and the incumbent no longer qualifies (or challengers tie among
    // themselves), a unique longest road >= 5 takes the card; a tie sets it
    // aside (nobody holds it) per the official rule.
    const incumbent = this.longestRoadHolder && lengths[this.longestRoadHolder] >= 5
      ? this.longestRoadHolder
      : null;
    let bestPlayer = incumbent;
    const toBeat = incumbent ? lengths[incumbent] : 4;
    const challengers = this.getPlayerIds().filter(player => lengths[player] >= 5 && lengths[player] > toBeat);
    if (challengers.length > 0) {
      const best = Math.max(...challengers.map(player => lengths[player]));
      const atBest = challengers.filter(player => lengths[player] === best);
      bestPlayer = atBest.length === 1 ? atBest[0] : null;
    }

    for (const player of this.getPlayerIds()) {
      this.players[player].longestRoad = player === bestPlayer;
    }
    this.longestRoadHolder = bestPlayer || null;
  }

  _longestRoadForPlayer(playerId) {
    const ownedEdges = new Set(this.players[playerId].roads);
    if (ownedEdges.size === 0) return 0;

    const dfs = (vertexId, usedEdges) => {
      const vertex = this.vertices[vertexId];
      if (vertex.building && vertex.building.player !== playerId) return 0;

      let best = 0;
      for (const edgeId of vertex.edgeIds) {
        if (!ownedEdges.has(edgeId) || usedEdges.has(edgeId)) continue;
        const edge = this.edges[edgeId];
        const nextVertex = edge.vertices[0] === vertexId ? edge.vertices[1] : edge.vertices[0];
        usedEdges.add(edgeId);
        best = Math.max(best, 1 + dfs(nextVertex, usedEdges));
        usedEdges.delete(edgeId);
      }
      return best;
    };

    let best = 0;
    for (const edgeId of ownedEdges) {
      const edge = this.edges[edgeId];
      best = Math.max(best, dfs(edge.vertices[0], new Set()), dfs(edge.vertices[1], new Set()));
    }
    return best;
  }

  _checkWin() {
    // Official rule: you can only win during your own turn. A player pushed to
    // the target off-turn (longest-road transfer, special build) wins at the
    // start of their next turn instead (see endTurn).
    if (this.currentPlayer !== this.primaryTurnPlayer) return false;
    const points = this.getVictoryPoints(this.currentPlayer);
    if (points >= this.victoryTarget) {
      this.phase = 'game-over';
      this.winner = this.currentPlayer;
      this.winningPoints = points;
      this.lastAction = `${this.players[this.currentPlayer].name} wins with ${points} points.`;
      return true;
    }
    return false;
  }

  getStateHash() {
    const vertices = Object.values(this.vertices)
      .filter(vertex => vertex.building)
      .map(vertex => `${vertex.id}:${vertex.building.player}${vertex.building.type[0]}`)
      .sort()
      .join(';');
    const edges = Object.values(this.edges)
      .filter(edge => edge.owner)
      .map(edge => `${edge.id}:${edge.owner}`)
      .sort()
      .join(';');
    const resources = this.getPlayerIds()
      .map(player => RESOURCES.map(r => Math.min(9, this.players[player].resources[r])).join(','))
      .join('|');
    const devs = this.getPlayerIds()
      .map(player => Object.values(this.players[player].devCards).join(','))
      .join('|');
    return `${this.phase}|${this.currentPlayer}|${this.robberTileId}|${vertices}|${edges}|${resources}|${devs}|${this.freeRoadsRemaining}`;
  }

  serializeState() {
    return {
      seed: this.seed,
      rngState: this.rngState,
      rulesetId: this.rulesetId,
      scenarioId: this.scenarioId,
      playerCount: this.playerCount,
      playerIds: [...this.getPlayerIds()],
      mapProfileId: this.mapProfileId,
      mapName: this.mapName,
      victoryTarget: this.victoryTarget,
      scenarioTarget: this.scenarioTarget,
      pairedPlayers: this.pairedPlayers,
      pieceLimits: { ...this.pieceLimits },
      tiles: this.tiles.map(tile => ({ ...tile })),
      vertices: Object.fromEntries(Object.entries(this.vertices).map(([id, vertex]) => [id, {
        ...vertex,
        tileIds: [...vertex.tileIds],
        edgeIds: [...vertex.edgeIds],
        adjacent: [...vertex.adjacent],
        building: vertex.building ? { ...vertex.building } : null,
      }])),
      edges: Object.fromEntries(Object.entries(this.edges).map(([id, edge]) => [id, {
        ...edge,
        vertices: [...edge.vertices],
        tileIds: [...edge.tileIds],
      }])),
      robberTileId: this.robberTileId,
      players: Object.fromEntries(Object.entries(this.players).map(([id, player]) => [id, {
        ...player,
        resources: cloneResources(player.resources),
        devCards: cloneDevCards(player.devCards),
        newDevCards: cloneDevCards(player.newDevCards),
        roads: [...player.roads],
        settlements: [...player.settlements],
        cities: [...player.cities],
      }])),
      bank: cloneResources(this.bank),
      devDeck: [...this.devDeck],
      discardLog: this.discardLog.map(entry => ({ player: entry.player, resources: cloneResources(entry.resources) })),
      currentPlayer: this.currentPlayer,
      primaryTurnPlayer: this.primaryTurnPlayer,
      phase: this.phase,
      setupOrder: [...this.setupOrder],
      firstPlayer: this.firstPlayer,
      setupIndex: this.setupIndex,
      pendingSetupSettlement: this.pendingSetupSettlement,
      turnNumber: this.turnNumber,
      dice: this.dice,
      lastRoll: this.lastRoll,
      lastAction: this.lastAction,
      pendingAfterRobberPhase: this.pendingAfterRobberPhase,
      freeRoadsRemaining: this.freeRoadsRemaining,
      discardQueue: this.discardQueue.map(entry => ({ ...entry })),
      pendingTrade: this.pendingTrade
        ? {
            ...this.pendingTrade,
            give: { ...this.pendingTrade.give },
            receive: { ...this.pendingTrade.receive },
            targets: [...this.pendingTrade.targets],
          }
        : null,
      tradeProposalsThisTurn: this.tradeProposalsThisTurn,
      maxTradeProposalsPerTurn: this.maxTradeProposalsPerTurn,
      longestRoadHolder: this.longestRoadHolder,
      largestArmyHolder: this.largestArmyHolder,
      winner: this.winner,
      winningPoints: this.winningPoints,
      stateHistory: this.stateHistory,
      historyIndex: this.historyIndex,
      maxHistoryLength: this.maxHistoryLength,
    };
  }

  static fromSerializedState(state) {
    const board = new CatanBoard({
      seed: state.seed,
      playerCount: state.playerCount || 4,
      rulesetId: state.rulesetId || 'base-classic',
      scenarioId: state.scenarioId || null,
      mapProfileId: state.mapProfileId || null,
      skipInitialHistory: true,
    });
    board.rngState = state.rngState;
    board.rulesetId = state.rulesetId || board.rulesetId;
    board.scenarioId = state.scenarioId || board.scenarioId;
    board.playerCount = state.playerCount || Object.keys(state.players || {}).length || board.playerCount;
    board.playerIds = state.playerIds ? [...state.playerIds] : Array.from({ length: board.playerCount }, (_, index) => index + 1);
    board.mapProfileId = state.mapProfileId || board.mapProfileId;
    board.mapProfile = getMapProfile(board.mapProfileId);
    board.mapName = state.mapName || board.mapProfile.name;
    board.victoryTarget = state.victoryTarget || board.victoryTarget || 10;
    board.scenarioTarget = state.scenarioTarget || board.scenarioTarget || board.victoryTarget;
    board.pairedPlayers = state.pairedPlayers ?? board.pairedPlayers;
    board.pieceLimits = { ...board.mapProfile.pieceLimits, ...(state.pieceLimits || {}) };
    board.tiles = state.tiles.map(tile => ({ ...tile, vertices: [...tile.vertices], edges: [...tile.edges] }));
    board.vertices = Object.fromEntries(Object.entries(state.vertices).map(([id, vertex]) => [id, {
      ...vertex,
      tileIds: [...vertex.tileIds],
      edgeIds: [...vertex.edgeIds],
      adjacent: [...vertex.adjacent],
      building: vertex.building ? { ...vertex.building } : null,
    }]));
    board.edges = Object.fromEntries(Object.entries(state.edges).map(([id, edge]) => [id, {
      ...edge,
      vertices: [...edge.vertices],
      tileIds: [...edge.tileIds],
    }]));
    board.robberTileId = state.robberTileId;
    board.players = Object.fromEntries(Object.entries(state.players).map(([id, player]) => [Number(id), {
      ...player,
      resources: cloneResources(player.resources),
      devCards: cloneDevCards(player.devCards),
      newDevCards: cloneDevCards(player.newDevCards),
      roads: [...player.roads],
      settlements: [...player.settlements],
      cities: [...player.cities],
    }]));
    board.bank = cloneResources(state.bank);
    board.devDeck = [...state.devDeck];
    board.discardLog = (state.discardLog || []).map(entry => ({ player: entry.player, resources: cloneResources(entry.resources) }));
    board.currentPlayer = state.currentPlayer;
    board.primaryTurnPlayer = state.primaryTurnPlayer || state.currentPlayer || 1;
    board.phase = state.phase;
    board.setupOrder = [...state.setupOrder];
    board.firstPlayer = state.firstPlayer ?? board.setupOrder[0] ?? 1;
    board.setupIndex = state.setupIndex;
    board.pendingSetupSettlement = state.pendingSetupSettlement;
    board.turnNumber = state.turnNumber;
    board.dice = state.dice;
    board.lastRoll = state.lastRoll;
    board.lastAction = state.lastAction;
    board.pendingAfterRobberPhase = state.pendingAfterRobberPhase;
    board.freeRoadsRemaining = state.freeRoadsRemaining || 0;
    board.discardQueue = (state.discardQueue || []).map(entry => ({ ...entry }));
    board.pendingTrade = state.pendingTrade
      ? {
          ...state.pendingTrade,
          give: { ...state.pendingTrade.give },
          receive: { ...state.pendingTrade.receive },
          targets: [...state.pendingTrade.targets],
        }
      : null;
    board.tradeProposalsThisTurn = state.tradeProposalsThisTurn || 0;
    board.maxTradeProposalsPerTurn = state.maxTradeProposalsPerTurn ?? 4;
    board.longestRoadHolder = state.longestRoadHolder;
    board.largestArmyHolder = state.largestArmyHolder;
    board.winner = state.winner;
    board.winningPoints = state.winningPoints;
    board.stateHistory = state.stateHistory || [];
    board.historyIndex = state.historyIndex ?? -1;
    board.maxHistoryLength = state.maxHistoryLength || 80;
    return board;
  }

  _captureState() {
    // Search clones set _skipHistory to avoid the per-move serialize cost; undo/
    // redo history is irrelevant during MCTS rollouts and tree expansion.
    if (this._skipHistory) return;
    const state = this.serializeState();
    state.stateHistory = [];
    state.historyIndex = -1;

    if (this.historyIndex < this.stateHistory.length - 1) {
      this.stateHistory = this.stateHistory.slice(0, this.historyIndex + 1);
    }

    this.stateHistory.push(JSON.stringify(state));
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
    }
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
    const restored = CatanBoard.fromSerializedState(parsed);
    Object.assign(this, restored);
  }
}

export { RESOURCES, COSTS, resourceTotal, emptyResources };
