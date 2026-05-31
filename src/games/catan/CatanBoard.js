// CatanBoard.js
// Pure rules/state engine for a four-player base-game Catan implementation.

const SQRT3 = Math.sqrt(3);
const HEX_RADIUS = 2;

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const RESOURCE_TILES = [
  'brick', 'brick', 'brick',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'ore', 'ore', 'ore',
  'desert',
];
const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const PORTS = ['brick', 'lumber', 'wool', 'grain', 'ore', 'any', 'any', 'any', 'any'];

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
};

const PLAYER_COLORS = {
  1: '#DC2626',
  2: '#2563EB',
  3: '#16A34A',
  4: '#F59E0B',
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

function makeTileCoords() {
  const coords = [];
  for (let q = -HEX_RADIUS; q <= HEX_RADIUS; q++) {
    for (let r = -HEX_RADIUS; r <= HEX_RADIUS; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= HEX_RADIUS) {
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

function makeGeometry(seed = 1) {
  const random = mulberry32(seed);
  const coords = makeTileCoords();
  const vertexByPoint = new Map();
  const vertices = {};
  const edges = {};
  let vertexIndex = 0;

  const resources = makeBalancedResources(seed);
  const numbers = makeBalancedNumbers(resources, seed + 17);
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

  assignPorts(vertices, edges, random);
  const robberTileId = tiles.find(tile => tile.resource === 'desert')?.id || tiles[0].id;

  return { tiles, vertices, edges, robberTileId };
}

function makeBalancedResources(seed) {
  const random = mulberry32(seed);
  const coords = makeTileCoords();

  for (let attempt = 0; attempt < 80; attempt++) {
    const resources = shuffle(RESOURCE_TILES, random);
    const desertIndex = resources.indexOf('desert');
    const desert = coords[desertIndex];
    if (Math.max(Math.abs(desert.q), Math.abs(desert.r), Math.abs(desert.q + desert.r)) <= 1) {
      return resources;
    }
  }

  const resources = shuffle(RESOURCE_TILES, mulberry32(seed + 101));
  resources[resources.indexOf('desert')] = resources[9];
  resources[9] = 'desert';
  return resources;
}

function makeBalancedNumbers(resources, seed) {
  const random = mulberry32(seed);
  const coords = makeTileCoords();
  const adjacency = new Map();
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
    const tokens = shuffle(NUMBER_TOKENS, random);
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

  const tokens = [...NUMBER_TOKENS];
  return resources.map(resource => resource === 'desert' ? null : tokens.shift());
}

function assignPorts(vertices, edges, random) {
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

  const ports = shuffle(PORTS, random);
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
    skipInitialHistory = false,
  } = {}) {
    this.seed = seed;
    this.rngState = seed;
    const geometry = makeGeometry(seed);
    this.tiles = geometry.tiles;
    this.vertices = geometry.vertices;
    this.edges = geometry.edges;
    this.robberTileId = geometry.robberTileId;

    this.players = {};
    for (let player = 1; player <= 4; player++) {
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

    this.bank = { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 };
    this.devDeck = shuffle(DEV_DECK, mulberry32(seed + 31));
    this.discardLog = [];
    this.currentPlayer = 1;
    this.phase = 'setup-settlement';
    this.setupOrder = [1, 2, 3, 4, 4, 3, 2, 1];
    this.setupIndex = 0;
    this.pendingSetupSettlement = null;
    this.turnNumber = 1;
    this.dice = null;
    this.lastRoll = null;
    this.lastAction = 'Place your first settlement.';
    this.pendingAfterRobberPhase = null;
    this.freeRoadsRemaining = 0;
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
    const next = new CatanBoard({ seed });
    Object.assign(this, next);
    this._captureState();
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayer];
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
    for (let player = 1; player <= 4; player++) {
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
    if (!setup && (player.settlements.length >= 5 || !this.canAfford(playerId, COSTS.settlement))) {
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
    if (player.cities.length >= 4 || !this.canAfford(playerId, COSTS.city)) return [];
    return player.settlements.filter(vertexId => this.vertices[vertexId].building?.player === playerId);
  }

  getValidSetupRoadEdges(vertexId, playerId = this.currentPlayer) {
    if (!vertexId || !this.vertices[vertexId]) return [];
    return this.vertices[vertexId].edgeIds.filter(edgeId => !this.edges[edgeId].owner);
  }

  getValidRoadEdges(playerId = this.currentPlayer, free = false) {
    const player = this.players[playerId];
    if (player.roads.length >= 15) return [];
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

    if (this.setupIndex >= 4) {
      this._grantInitialResources(playerId, this.pendingSetupSettlement);
    }

    this.pendingSetupSettlement = null;
    this.setupIndex++;
    this._updateLongestRoad();

    if (this.setupIndex >= this.setupOrder.length) {
      this.currentPlayer = 1;
      this.phase = 'roll';
      this.lastAction = 'Setup complete. Player 1 rolls first.';
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
    const diceTotal = total || (1 + Math.floor(this._random() * 6)) + (1 + Math.floor(this._random() * 6));
    this.dice = diceTotal;
    this.lastRoll = diceTotal;

    if (diceTotal === 7) {
      this._discardForRobber();
      this.phase = 'robber';
      this.pendingAfterRobberPhase = 'action';
      this.lastAction = `${this.players[this.currentPlayer].name} rolled 7. Move the robber.`;
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

  _discardForRobber() {
    this.discardLog = [];
    for (let player = 1; player <= 4; player++) {
      const total = this.getPlayerResourceTotal(player);
      if (total <= 7) continue;
      const discardCount = Math.floor(total / 2);
      const discarded = this._discardResources(player, discardCount);
      this.discardLog.push({ player, resources: discarded });
    }
  }

  _discardResources(playerId, count) {
    const player = this.players[playerId];
    const discarded = emptyResources();
    for (let i = 0; i < count; i++) {
      const resource = RESOURCES
        .filter(r => player.resources[r] > 0)
        .sort((a, b) => player.resources[b] - player.resources[a])[0];
      if (!resource) break;
      player.resources[resource]--;
      this.bank[resource]++;
      discarded[resource]++;
    }
    return discarded;
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
    if (this.phase !== 'action') return false;
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
    if (this.phase !== 'action') return false;
    if (!this.getValidSettlementVertices(this.currentPlayer, false).includes(vertexId)) return false;
    const player = this.getCurrentPlayer();
    if (player.settlements.length >= 5) return false;
    if (!free) this._payCost(this.currentPlayer, COSTS.settlement);

    this.vertices[vertexId].building = { player: this.currentPlayer, type: 'settlement' };
    player.settlements.push(vertexId);
    this.lastAction = `${player.name} built a settlement.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  buildCity(vertexId) {
    if (this.phase !== 'action') return false;
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
    if (this.phase !== 'action') return false;
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
    if (this.phase !== 'action') return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.knight <= 0) return false;
    player.devCards.knight--;
    player.knightsPlayed++;
    player.playedDevThisTurn = true;
    this._updateLargestArmy();
    this.phase = 'robber';
    this.pendingAfterRobberPhase = 'action';
    this.lastAction = `${player.name} played a knight.`;
    this._checkWin();
    this._captureState();
    return true;
  }

  playYearOfPlenty(resourceA, resourceB) {
    if (this.phase !== 'action') return false;
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
    if (this.phase !== 'action') return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.monopoly <= 0) return false;
    if (!RESOURCES.includes(resource)) return false;

    player.devCards.monopoly--;
    player.playedDevThisTurn = true;
    let total = 0;
    for (let opponent = 1; opponent <= 4; opponent++) {
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
    if (this.phase !== 'action') return false;
    const player = this.getCurrentPlayer();
    if (player.playedDevThisTurn || player.devCards.roadBuilding <= 0) return false;
    player.devCards.roadBuilding--;
    player.playedDevThisTurn = true;
    this.freeRoadsRemaining = Math.min(2, 15 - player.roads.length);
    this.lastAction = `${player.name} played Road Building.`;
    this._captureState();
    return true;
  }

  tradeWithBank(give, receive, ratio = null) {
    if (this.phase !== 'action') return false;
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

  endTurn() {
    if (this.phase !== 'action') return false;
    const player = this.getCurrentPlayer();
    for (const card of Object.keys(player.newDevCards)) {
      player.devCards[card] += player.newDevCards[card];
      player.newDevCards[card] = 0;
    }
    player.playedDevThisTurn = false;
    this.freeRoadsRemaining = 0;
    this.dice = null;
    this.currentPlayer = this.currentPlayer === 4 ? 1 : this.currentPlayer + 1;
    if (this.currentPlayer === 1) this.turnNumber++;
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

  getLegalMoves() {
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

    if (this.phase === 'robber') {
      return this.tiles
        .filter(tile => tile.id !== this.robberTileId)
        .map(tile => ({
          type: 'move-robber',
          tileId: tile.id,
          stealPlayerId: this._bestRobberVictim(tile.id),
        }));
    }

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
      if (player.devCards.roadBuilding > 0 && player.roads.length < 15) moves.push({ type: 'play-road-building' });
      if (player.devCards.yearOfPlenty > 0) {
        const desired = this._mostNeededResources(this.currentPlayer);
        moves.push({ type: 'play-year-of-plenty', resourceA: desired[0], resourceB: desired[1] || desired[0] });
      }
      if (player.devCards.monopoly > 0) {
        moves.push({ type: 'play-monopoly', resource: this._bestMonopolyResource(this.currentPlayer) });
      }
    }

    this.getStrategicTradeOptions(this.currentPlayer).forEach(move => moves.push(move));
    if (this.freeRoadsRemaining === 0 || roadEdges.length === 0) moves.push({ type: 'end-turn' });
    return moves;
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
      case 'move-robber':
        return this.moveRobber(move.tileId, move.stealPlayerId || null);
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

  _bestRobberVictim(tileId) {
    const victims = this.getRobberVictims(tileId).filter(playerId => playerId !== this.currentPlayer);
    if (victims.length === 0) return null;
    return victims.sort((a, b) => this.getPlayerResourceTotal(b) - this.getPlayerResourceTotal(a))[0];
  }

  _bestMonopolyResource(playerId) {
    let best = 'grain';
    let bestCount = -1;
    for (const resource of RESOURCES) {
      let count = 0;
      for (let player = 1; player <= 4; player++) {
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
    const resource = RESOURCES
      .filter(r => from[r] > 0)
      .sort((a, b) => from[b] - from[a])[0];
    if (!resource) return null;
    from[resource]--;
    this.players[toPlayerId].resources[resource]++;
    return resource;
  }

  _updateLargestArmy() {
    let bestPlayer = this.largestArmyHolder;
    let bestCount = bestPlayer ? this.players[bestPlayer].knightsPlayed : 2;
    for (let player = 1; player <= 4; player++) {
      const count = this.players[player].knightsPlayed;
      if (count >= 3 && count > bestCount) {
        bestPlayer = player;
        bestCount = count;
      }
    }

    for (let player = 1; player <= 4; player++) {
      this.players[player].largestArmy = player === bestPlayer;
    }
    this.largestArmyHolder = bestPlayer || null;
  }

  _updateLongestRoad() {
    const lengths = {};
    for (let player = 1; player <= 4; player++) {
      lengths[player] = this._longestRoadForPlayer(player);
    }

    let bestPlayer = this.longestRoadHolder;
    let bestLength = bestPlayer ? lengths[bestPlayer] : 4;
    for (let player = 1; player <= 4; player++) {
      if (lengths[player] >= 5 && lengths[player] > bestLength) {
        bestPlayer = player;
        bestLength = lengths[player];
      }
    }

    if (bestPlayer && lengths[bestPlayer] < 5) bestPlayer = null;
    for (let player = 1; player <= 4; player++) {
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
    for (let player = 1; player <= 4; player++) {
      const points = this.getVictoryPoints(player);
      if (points >= 10) {
        this.phase = 'game-over';
        this.winner = player;
        this.winningPoints = points;
        this.lastAction = `${this.players[player].name} wins with ${points} points.`;
        return true;
      }
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
    const resources = [1, 2, 3, 4]
      .map(player => RESOURCES.map(r => Math.min(9, this.players[player].resources[r])).join(','))
      .join('|');
    const devs = [1, 2, 3, 4]
      .map(player => Object.values(this.players[player].devCards).join(','))
      .join('|');
    return `${this.phase}|${this.currentPlayer}|${this.robberTileId}|${vertices}|${edges}|${resources}|${devs}|${this.freeRoadsRemaining}`;
  }

  serializeState() {
    return {
      seed: this.seed,
      rngState: this.rngState,
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
      phase: this.phase,
      setupOrder: [...this.setupOrder],
      setupIndex: this.setupIndex,
      pendingSetupSettlement: this.pendingSetupSettlement,
      turnNumber: this.turnNumber,
      dice: this.dice,
      lastRoll: this.lastRoll,
      lastAction: this.lastAction,
      pendingAfterRobberPhase: this.pendingAfterRobberPhase,
      freeRoadsRemaining: this.freeRoadsRemaining,
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
    const board = new CatanBoard({ seed: state.seed, skipInitialHistory: true });
    board.rngState = state.rngState;
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
    board.phase = state.phase;
    board.setupOrder = [...state.setupOrder];
    board.setupIndex = state.setupIndex;
    board.pendingSetupSettlement = state.pendingSetupSettlement;
    board.turnNumber = state.turnNumber;
    board.dice = state.dice;
    board.lastRoll = state.lastRoll;
    board.lastAction = state.lastAction;
    board.pendingAfterRobberPhase = state.pendingAfterRobberPhase;
    board.freeRoadsRemaining = state.freeRoadsRemaining || 0;
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
