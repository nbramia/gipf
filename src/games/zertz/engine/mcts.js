// MCTS engine for Zertz AI
// Monte Carlo Tree Search with heuristic evaluation and PUCT policy priors

import ZertzBoard from '../ZertzBoard.js';

// --- Constants ---
const EXPLORATION_CONSTANT = 1.414;
const C_PUCT = 2.5;
const DIRICHLET_ALPHA = 0.3;
const DIRICHLET_EPSILON = 0.25;
const MAX_PLAYOUT_DEPTH = 20;
const DEFAULT_MAX_TABLE_SIZE = 50000;
const GRID_SIZE = 7;
const GRID_OFFSET = 3;

// Module-level transposition table
let transpositionTable = new Map();

// --- MCTSNode ---

class MCTSNode {
  constructor(board, parentMove = null, parent = null, mcts = null) {
    this.board = board;
    this.parentMove = parentMove;
    this.parent = parent;
    this.mcts = mcts;
    this.children = new Map(); // moveKey -> MCTSNode
    this.visits = 0;
    this.wins = 0;
    this.prior = 0; // policy prior P(a|s) from NN
    this.untriedMoves = null; // lazy init
    this.stateHash = null; // lazy init
  }

  getStateHash() {
    if (this.stateHash === null) {
      this.stateHash = this.board.getStateHash();
    }
    return this.stateHash;
  }

  getUntriedMoves() {
    if (this.untriedMoves === null) {
      const allMoves = this.board.getLegalMoves();
      const triedKeys = new Set(this.children.keys());
      this.untriedMoves = allMoves.filter(m => !triedKeys.has(moveToKey(m)));
    }
    return this.untriedMoves;
  }

  isFullyExpanded() {
    return this.getUntriedMoves().length === 0;
  }

  isTerminal() {
    return this.board.gamePhase === 'game-over';
  }

  /**
   * UCB1 score for tree selection (heuristic mode)
   */
  ucb1(parentVisits) {
    if (this.visits === 0) return Infinity;
    const exploitation = this.wins / this.visits;
    const exploration = EXPLORATION_CONSTANT * Math.sqrt(Math.log(parentVisits) / this.visits);
    return exploitation + exploration;
  }

  /**
   * PUCT score for policy-guided selection (AlphaZero style)
   */
  puct(parentVisits) {
    if (this.visits === 0) return Infinity;
    const q = this.wins / this.visits;
    const normalizedQ = this.mcts ? this.mcts._normalizeQ(q) : q;
    return normalizedQ + C_PUCT * this.prior * Math.sqrt(parentVisits) / (1 + this.visits);
  }

  /**
   * Select the best child using UCB1 or PUCT
   */
  selectChild() {
    let bestChild = null;
    let bestScore = -Infinity;
    const usePUCT = this.mcts && this.mcts.usePUCT;
    for (const child of this.children.values()) {
      const score = usePUCT ? child.puct(this.visits) : child.ucb1(this.visits);
      if (score > bestScore) {
        bestScore = score;
        bestChild = child;
      }
    }
    return bestChild;
  }
}

// --- Move Utilities ---

function moveToKey(move) {
  switch (move.type) {
    case 'place-marble':
      return `p:${move.color}:${move.q},${move.r}`;
    case 'remove-ring':
      return `r:${move.q},${move.r}`;
    case 'capture':
      return `c:${move.fromKey}>${move.toKey}`;
    default:
      return JSON.stringify(move);
  }
}

/**
 * Get the destination grid index (0-48) for a move, for policy mapping.
 * Maps move target position to 7x7 grid: index = (r+3)*7 + (q+3)
 */
function getMoveDestIndex(move) {
  let q, r;
  switch (move.type) {
    case 'place-marble':
      q = move.q;
      r = move.r;
      break;
    case 'remove-ring':
      q = move.q;
      r = move.r;
      break;
    case 'capture': {
      const parts = move.toKey.split(',').map(Number);
      q = parts[0];
      r = parts[1];
      break;
    }
    default:
      return -1;
  }
  return (r + GRID_OFFSET) * GRID_SIZE + (q + GRID_OFFSET);
}

function applyMove(board, move) {
  switch (move.type) {
    case 'place-marble':
      board.selectMarbleColor(move.color);
      board.placeMarble(move.q, move.r);
      break;
    case 'remove-ring':
      board.removeRing(move.q, move.r);
      break;
    case 'capture':
      board.executeCapture(move.fromKey, move.toKey);
      break;
  }
}

// --- Dirichlet Noise ---

function sampleGamma(alpha) {
  // Marsaglia & Tsang method for alpha >= 1
  if (alpha < 1) {
    return sampleGamma(alpha + 1) * Math.pow(Math.random(), 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = normalRandom();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normalRandom() {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleDirichlet(n, alpha) {
  const samples = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    samples[i] = sampleGamma(alpha);
    sum += samples[i];
  }
  if (sum > 0) {
    for (let i = 0; i < n; i++) samples[i] /= sum;
  } else {
    for (let i = 0; i < n; i++) samples[i] = 1 / n;
  }
  return samples;
}

// --- Heuristic Evaluation ---

function winDistance(captures, condition) {
  let dist = 0;
  for (const color of ['white', 'grey', 'black']) {
    if (condition[color] > 0) {
      dist += Math.max(0, condition[color] - captures[color]);
    }
  }
  return dist;
}

function bestWinDistance(captures) {
  let best = Infinity;
  for (const cond of ZertzBoard.WIN_CONDITIONS) {
    const d = winDistance(captures, cond);
    if (d < best) best = d;
  }
  return best;
}

function evaluatePosition(board, perspectivePlayer) {
  if (board.gamePhase === 'game-over') {
    if (board.winner === perspectivePlayer) return 1.0;
    if (board.winner !== null) return -1.0;
    return 0.0;
  }

  const opponent = perspectivePlayer === 1 ? 2 : 1;
  const myCaps = board.captures[perspectivePlayer];
  const oppCaps = board.captures[opponent];

  let score = 0;

  const myBestDist = bestWinDistance(myCaps);
  const oppBestDist = bestWinDistance(oppCaps);
  score += (oppBestDist - myBestDist) * 2000;

  for (const cond of ZertzBoard.WIN_CONDITIONS) {
    const myDist = winDistance(myCaps, cond);
    const oppDist = winDistance(oppCaps, cond);
    const totalNeeded = (cond.white || 0) + (cond.grey || 0) + (cond.black || 0);
    const myProgress = (totalNeeded - myDist) / totalNeeded;
    const oppProgress = (totalNeeded - oppDist) / totalNeeded;
    score += (myProgress - oppProgress) * 500;
  }

  const marbleKeys = Object.keys(board.marbles);
  let adjacentPairs = 0;
  for (const key of marbleKeys) {
    const [q, r] = board._fromKey(key);
    for (const dir of ZertzBoard.DIRECTIONS) {
      const neighborKey = board._toKey(q + dir[0], r + dir[1]);
      if (board.marbles[neighborKey]) adjacentPairs++;
    }
  }
  const captureOpportunitySign = board.currentPlayer === perspectivePlayer ? 1 : -1;
  score += adjacentPairs * 50 * captureOpportunitySign;

  if (board.gamePhase === 'remove-ring') {
    const freeRings = board.getFreeRings();
    score += freeRings.length * 30 * captureOpportunitySign;
  }

  const poolTotal = board.getPoolTotal();
  if (poolTotal === 0) {
    const myTotal = myCaps.white + myCaps.grey + myCaps.black;
    const oppTotal = oppCaps.white + oppCaps.grey + oppCaps.black;
    score += (myTotal - oppTotal) * 50;
  }

  return Math.tanh(score / 5000);
}

// --- Fast Heuristic Playout Policy ---

function selectMoveByFastHeuristic(moves, board) {
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const phase = moves[0].type;

  if (phase === 'capture') {
    const marbleValue = { white: 3, grey: 2, black: 1 };
    let bestMove = moves[0];
    let bestVal = -1;
    for (const move of moves) {
      const capturedColor = board.marbles[move.capturedKey];
      const val = marbleValue[capturedColor] || 0;
      if (val > bestVal) { bestVal = val; bestMove = move; }
    }
    if (Math.random() < 0.3) return moves[Math.floor(Math.random() * moves.length)];
    return bestMove;
  }

  if (phase === 'place-marble') {
    const colorPriority = { black: 3, grey: 2, white: 1 };
    let bestMove = moves[0];
    let bestPriority = -1;
    for (const move of moves) {
      const p = colorPriority[move.color] || 0;
      if (p > bestPriority) { bestPriority = p; bestMove = move; }
    }
    const bestColor = bestMove.color;
    const sameColorMoves = moves.filter(m => m.color === bestColor);
    if (Math.random() < 0.4) return moves[Math.floor(Math.random() * moves.length)];
    return sameColorMoves[Math.floor(Math.random() * sameColorMoves.length)];
  }

  if (phase === 'remove-ring') {
    let bestMove = null;
    let bestScore = -1;
    for (const move of moves) {
      let adjMarbles = 0;
      for (const dir of ZertzBoard.DIRECTIONS) {
        const nKey = board._toKey(move.q + dir[0], move.r + dir[1]);
        if (board.marbles[nKey]) adjMarbles++;
      }
      if (adjMarbles > bestScore) { bestScore = adjMarbles; bestMove = move; }
    }
    if (Math.random() < 0.5 || !bestMove) return moves[Math.floor(Math.random() * moves.length)];
    return bestMove;
  }

  return moves[Math.floor(Math.random() * moves.length)];
}

// --- MCTS Class ---

export class MCTS {
  constructor({
    maxTableSize = DEFAULT_MAX_TABLE_SIZE,
    evaluationMode = 'heuristic',
    valueNetwork = null,
  } = {}) {
    this.maxTableSize = maxTableSize;
    this.evaluationMode = evaluationMode;
    this.valueNetwork = valueNetwork;
    // PUCT state (reset per search)
    this.usePUCT = false;
    this.qMin = Infinity;
    this.qMax = -Infinity;
    this.rootPriors = null;
  }

  _normalizeQ(q) {
    if (this.qMax <= this.qMin) return 0.5;
    return (q - this.qMin) / (this.qMax - this.qMin);
  }

  /**
   * Assign policy priors to root node children from NN policy output.
   * Policy is 49 logits over the 7x7 grid. We softmax over legal move destinations.
   */
  _assignPolicyPriors(rootNode, moves, rawPolicy) {
    const destIndices = moves.map(m => getMoveDestIndex(m));

    // Gather logits for legal moves
    const logits = destIndices.map(idx =>
      (idx >= 0 && idx < GRID_SIZE * GRID_SIZE) ? rawPolicy[idx] : -Infinity
    );

    // Numerically stable softmax
    const finiteLogits = logits.filter(l => l > -Infinity);
    const maxLogit = finiteLogits.length > 0 ? Math.max(...finiteLogits) : 0;
    const exps = logits.map(l => l > -Infinity ? Math.exp(l - maxLogit) : 0);
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const priors = exps.map(e => sumExps > 0 ? e / sumExps : 1.0 / moves.length);

    // Add Dirichlet noise for exploration at root
    const noise = sampleDirichlet(moves.length, DIRICHLET_ALPHA);

    this.rootPriors = new Map();
    for (let i = 0; i < moves.length; i++) {
      const blended = (1 - DIRICHLET_EPSILON) * priors[i] + DIRICHLET_EPSILON * noise[i];
      this.rootPriors.set(moveToKey(moves[i]), blended);
    }
  }

  _simulate(board, rootPlayer) {
    const simBoard = board.clone();
    simBoard.stateHistory = [];
    simBoard.historyIndex = -1;

    let depth = 0;
    while (depth < MAX_PLAYOUT_DEPTH && simBoard.gamePhase !== 'game-over') {
      const moves = simBoard.getLegalMoves();
      if (moves.length === 0) break;
      const move = selectMoveByFastHeuristic(moves, simBoard);
      if (!move) break;
      applyMove(simBoard, move);
      depth++;
    }

    return evaluatePosition(simBoard, rootPlayer);
  }

  async _evaluateLeaf(board, rootPlayer) {
    if (this.evaluationMode === 'nn' && this.valueNetwork && this.valueNetwork.isLoaded()) {
      try {
        // Hybrid: short rollout (5 steps) then NN evaluation
        // This gives the NN lookahead context while being faster than full 20-step rollout
        const NN_ROLLOUT_DEPTH = 5;
        let evalBoard = board;
        if (board.gamePhase !== 'game-over') {
          const simBoard = board.clone();
          simBoard.stateHistory = [];
          simBoard.historyIndex = -1;
          let depth = 0;
          while (depth < NN_ROLLOUT_DEPTH && simBoard.gamePhase !== 'game-over') {
            const moves = simBoard.getLegalMoves();
            if (moves.length === 0) break;
            const move = selectMoveByFastHeuristic(moves, simBoard);
            if (!move) break;
            applyMove(simBoard, move);
            depth++;
          }
          evalBoard = simBoard;
        }
        if (evalBoard.gamePhase === 'game-over') {
          return evaluatePosition(evalBoard, rootPlayer);
        }
        const nnValue = await this.valueNetwork.evaluatePosition(evalBoard);
        if (evalBoard.currentPlayer !== rootPlayer) return -nnValue;
        return nnValue;
      } catch {
        return evaluatePosition(board, rootPlayer);
      }
    }
    return evaluatePosition(board, rootPlayer);
  }

  _select(node) {
    while (!node.isTerminal() && node.isFullyExpanded()) {
      node = node.selectChild();
      if (!node) break;
    }
    return node;
  }

  _expand(node) {
    const untriedMoves = node.getUntriedMoves();
    if (untriedMoves.length === 0) return node;

    const moveIndex = Math.floor(Math.random() * untriedMoves.length);
    const move = untriedMoves[moveIndex];

    const childBoard = node.board.clone();
    childBoard.stateHistory = [];
    childBoard.historyIndex = -1;
    applyMove(childBoard, move);

    const key = moveToKey(move);
    const childNode = new MCTSNode(childBoard, move, node, this);
    node.children.set(key, childNode);

    // Assign policy prior if available (root children only)
    if (this.rootPriors && node.parent === null) {
      childNode.prior = this.rootPriors.get(key) || (1 / untriedMoves.length);
    }

    node.untriedMoves = null;

    const hash = childNode.getStateHash();
    if (transpositionTable.has(hash)) {
      const cached = transpositionTable.get(hash);
      childNode.visits = cached.visits;
      childNode.wins = cached.wins;
    }

    return childNode;
  }

  _backpropagate(node, value, rootPlayer) {
    let current = node;
    while (current !== null) {
      current.visits++;
      if (current.parent) {
        const parentPlayer = current.parent.board.currentPlayer;
        if (parentPlayer === rootPlayer) {
          current.wins += (value + 1) / 2;
        } else {
          current.wins += (1 - value) / 2;
        }
      } else {
        current.wins += (value + 1) / 2;
      }

      // Track Q-value bounds for PUCT normalization
      if (current.visits > 0) {
        const q = current.wins / current.visits;
        if (q < this.qMin) this.qMin = q;
        if (q > this.qMax) this.qMax = q;
      }

      const hash = current.getStateHash();
      if (transpositionTable.size < this.maxTableSize) {
        transpositionTable.set(hash, { visits: current.visits, wins: current.wins });
      }

      current = current.parent;
    }
  }

  /**
   * Main entry point: find the best move for the current board state.
   * Returns { move, rootVisits } where rootVisits maps moveKey -> visitCount (for policy targets).
   */
  async getBestMove(board, numSimulations = 200) {
    transpositionTable.clear();

    // Reset PUCT state
    this.usePUCT = false;
    this.qMin = Infinity;
    this.qMax = -Infinity;
    this.rootPriors = null;

    const rootPlayer = board.currentPlayer;
    const legalMoves = board.getLegalMoves();

    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const rootBoard = board.clone();
    rootBoard.stateHistory = [];
    rootBoard.historyIndex = -1;
    const root = new MCTSNode(rootBoard, null, null, this);

    // Try to fetch policy from NN at root
    const useNN = this.evaluationMode === 'nn' && this.valueNetwork && this.valueNetwork.isLoaded();
    if (useNN && this.valueNetwork.evaluatePositionWithPolicy) {
      try {
        const { policy } = await this.valueNetwork.evaluatePositionWithPolicy(board);
        if (policy) {
          this._assignPolicyPriors(root, legalMoves, policy);
          this.usePUCT = true;
        }
      } catch {
        // Fall back to UCB1
      }
    }

    // Run simulations
    for (let i = 0; i < numSimulations; i++) {
      let node = this._select(root);

      if (!node.isTerminal()) {
        node = this._expand(node);
      }

      let value;
      if (node.isTerminal()) {
        value = evaluatePosition(node.board, rootPlayer);
      } else if (useNN) {
        value = await this._evaluateLeaf(node.board, rootPlayer);
      } else {
        value = this._simulate(node.board, rootPlayer);
      }

      this._backpropagate(node, value, rootPlayer);
    }

    // Collect root visit counts (for policy training targets)
    const rootVisits = {};
    let bestMove = null;
    let bestVisits = -1;
    for (const [key, child] of root.children) {
      rootVisits[key] = child.visits;
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        bestMove = child.parentMove;
      }
    }

    // Attach rootVisits to the move for self-play data generation
    if (bestMove) {
      bestMove._rootVisits = rootVisits;
      bestMove._legalMoves = legalMoves;
    }

    return bestMove;
  }
}

export { applyMove, evaluatePosition, moveToKey, bestWinDistance, winDistance, getMoveDestIndex };
