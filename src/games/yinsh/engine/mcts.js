import YinshBoard from '../YinshBoard.js';

const transpositionTable = new Map();

class MCTSNode {
  constructor(board, parentMove = null, parent = null, mcts = null) {
    this.board = board.clone();
    this.parentMove = parentMove;  // The move that led to this state
    this.parent = parent;  // Add parent reference needed for backpropagation
    this.children = new Map();     // Map of move -> MCTSNode
    this.visits = 0;               // Number of times this node was visited
    this.wins = 0;                 // Total score from this node's simulations
    this.untriedMoves = null;      // Lazy-loaded list of possible moves
    this.stateHash = board.getStateHash();  // Cache the state hash
    this.mcts = mcts;  // Reference to MCTS instance
    this.prior = 0;    // Policy prior probability (set by PUCT)

    // Get state hash and check transposition table
    const existingNode = transpositionTable.get(this.stateHash);
    if (existingNode) {
      // Copy stats from existing node
      this.visits = existingNode.visits;
      this.wins = existingNode.wins;
      this.children = existingNode.children;
      this.untriedMoves = existingNode.untriedMoves;
    } else {
      // Store this new node in the table
      transpositionTable.set(this.stateHash, this);
    }
  }

  // UCB1 formula for node selection (used as fallback when no policy)
  ucb1(parentVisits, explorationConstant = 1.41) {
    // Get latest stats from transposition table
    const nodeData = transpositionTable.get(this.stateHash);
    const visits = nodeData ? nodeData.visits : this.visits;
    const wins = nodeData ? nodeData.wins : this.wins;

    if (visits === 0) return Infinity;
    const exploitation = wins / visits;
    const exploration = Math.sqrt(Math.log(parentVisits) / visits);
    return exploitation + explorationConstant * exploration;
  }

  // PUCT formula for policy-guided selection (AlphaZero style)
  puct(parentVisits, cPuct = 2.5) {
    const nodeData = transpositionTable.get(this.stateHash);
    const visits = nodeData ? nodeData.visits : this.visits;
    const wins = nodeData ? nodeData.wins : this.wins;

    if (visits === 0) return Infinity;
    const q = wins / visits;
    const normalizedQ = this.mcts ? this.mcts.normalizeQ(q) : 0.5;
    return normalizedQ + cPuct * this.prior * Math.sqrt(parentVisits) / (1 + visits);
  }

  // Get all legal moves from this state
  getLegalMoves() {
    if (this.untriedMoves === null) {
      // Delegate to MCTS instance if available (which handles all phases correctly)
      if (this.mcts) {
        this.untriedMoves = this.mcts.getLegalMoves(this.board);
      } else {
        // Fallback if no MCTS instance (shouldn't happen but be safe)
        this.untriedMoves = [];
      }
    }
    return this.untriedMoves;
  }

  // Add method to update node stats
  updateStats(result) {
    this.visits++;
    this.wins += result;
    // Update transposition table
    transpositionTable.set(this.stateHash, this);
  }
}

export default class MCTS {
  constructor(maxTableSize = 100000, options = {}) {
    this.maxTableSize = maxTableSize;
    this.evaluationMode = options.evaluationMode || 'heuristic';
    this.valueNetwork = options.valueNetwork || null;
    // PUCT Q-value normalization bounds (updated during backpropagation)
    this.qMin = Infinity;
    this.qMax = -Infinity;
    // Whether to use policy-guided PUCT (set when policy is available)
    this.usePUCT = false;
    // Root policy priors cache (moveKey -> prior probability)
    this.rootPriors = null;
  }

  normalizeQ(q) {
    if (this.qMax <= this.qMin) return 0.5;
    return (q - this.qMin) / (this.qMax - this.qMin);
  }

  // ============================================================================
  // HELPER METHODS - Bridge between MCTS and YinshBoard API
  // ============================================================================

  /**
   * Check if a position is valid for ring placement in setup phase
   * @param {YinshBoard} board - The game board
   * @param {number} q - Axial q coordinate
   * @param {number} r - Axial r coordinate
   * @returns {boolean} - True if position is valid for ring placement
   */
  isValidRingPlacement(board, q, r) {
    const key = `${q},${r}`;
    const boardState = board.getBoardState();

    // Position must be empty
    if (boardState[key]) return false;

    // Position must be within valid grid
    const points = YinshBoard.generateGridPoints();
    return points.some(([pq, pr]) => pq === q && pr === r);
  }

  /**
   * Check if a player has any completed rows (5+ consecutive markers)
   * @param {YinshBoard} board - The game board
   * @param {number} player - Player number (1 or 2)
   * @returns {boolean} - True if player has completed row
   */
  hasCompletedRow(board, player) {
    const rows = this.getCompletedRows(board, player);
    return rows.length > 0;
  }

  /**
   * Get all completed rows for a player
   * @param {YinshBoard} board - The game board
   * @param {number} player - Player number (1 or 2)
   * @returns {Array} - Array of completed row objects
   */
  getCompletedRows(board, player) {
    const completedRows = [];
    const points = YinshBoard.generateGridPoints();
    const boardState = board.getBoardState();
    const directions = [[1, 0], [0, 1], [1, -1]];
    const visited = new Set();

    for (const [startQ, startR] of points) {
      const startKey = `${startQ},${startR}`;
      if (visited.has(startKey)) continue;

      const piece = boardState[startKey];
      if (!piece || piece.type !== 'marker' || piece.player !== player) continue;

      for (const [dq, dr] of directions) {
        let sequence = [[startQ, startR]];
        let q = startQ + dq;
        let r = startR + dr;

        // Build sequence in this direction
        while (true) {
          const key = `${q},${r}`;
          const nextPiece = boardState[key];
          if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== player) break;

          sequence.push([q, r]);
          visited.add(key);
          q += dq;
          r += dr;
        }

        // If sequence has 5+, add all possible 5-marker subsequences
        if (sequence.length >= 5) {
          for (let i = 0; i <= sequence.length - 5; i++) {
            const subSequence = sequence.slice(i, i + 5);
            completedRows.push({
              row: subSequence,
              start: subSequence[0],
              end: subSequence[4]
            });
          }
        }
      }
    }

    return completedRows;
  }

  /**
   * Evaluate basic position features
   * @param {YinshBoard} board - The game board
   * @param {number} player - Player to evaluate for
   * @returns {Object} - Evaluation object with score and features
   */
  _evaluateBasicPosition(board, player) {
    const points = YinshBoard.generateGridPoints();
    const boardState = board.getBoardState();
    let score = 0;

    // Count pieces
    let myRings = 0;
    let oppRings = 0;
    let myMarkers = 0;
    let oppMarkers = 0;

    for (const [q, r] of points) {
      const piece = boardState[`${q},${r}`];
      if (!piece) continue;

      if (piece.player === player) {
        if (piece.type === 'ring') myRings++;
        else if (piece.type === 'marker') myMarkers++;
      } else {
        if (piece.type === 'ring') oppRings++;
        else if (piece.type === 'marker') oppMarkers++;
      }
    }

    // Evaluate ring count (fewer rings = closer to winning, but need mobility)
    const scores = board.getScores();
    const myScore = scores[player] || 0;
    const oppScore = scores[3 - player] || 0;

    // Score difference is most important
    score += (myScore - oppScore) * 10000;

    // Ring count (having more rings is generally better unless winning)
    if (myScore < 2 && oppScore < 2) {
      score += (myRings - oppRings) * 100;
    }

    // Marker count (having more markers gives more control)
    score += (myMarkers - oppMarkers) * 10;

    return { score, myRings, oppRings, myMarkers, oppMarkers };
  }

  /**
   * Evaluate how well rings are spread across the board
   * @param {YinshBoard} board - The game board
   * @param {number} player - Player to evaluate for
   * @returns {number} - Score for ring spread
   */
  _evaluateRingSpread(board, player) {
    const points = YinshBoard.generateGridPoints();
    const boardState = board.getBoardState();
    const ringPositions = [];

    for (const [q, r] of points) {
      const piece = boardState[`${q},${r}`];
      if (piece?.type === 'ring' && piece.player === player) {
        ringPositions.push([q, r]);
      }
    }

    if (ringPositions.length === 0) return 0;

    // Calculate average distance between rings
    let totalDistance = 0;
    let pairCount = 0;

    for (let i = 0; i < ringPositions.length; i++) {
      for (let j = i + 1; j < ringPositions.length; j++) {
        const [q1, r1] = ringPositions[i];
        const [q2, r2] = ringPositions[j];
        const distance = Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs((q1 - r1) - (q2 - r2));
        totalDistance += distance;
        pairCount++;
      }
    }

    // Better spread = higher score (rings should be distributed, not clustered)
    return pairCount > 0 ? (totalDistance / pairCount) * 10 : 0;
  }

  // Convert these methods to arrow functions to preserve 'this' context
  evaluatePosition = (board, currentPlayer) => {
    const points = YinshBoard.generateGridPoints();

    // Helper to count markers for a player
    const countPlayerMarkers = (board, player) => {
      let count = 0;
      for (const [q, r] of points) {
        const piece = board.getBoardState()[`${q},${r}`];
        if (piece && piece.type === 'marker' && piece.player === player) {
          count++;
        }
      }
      return count;
    };

    // Helper to find scoring opportunities
    const findScoringMoves = (forPlayer) => {
      const opportunities = [];
      for (const [q, r] of points) {
        const piece = board.getBoardState()[`${q},${r}`];
        if (piece && piece.type === 'ring' && piece.player === forPlayer) {
          const testBoard = board.clone();
          testBoard.handleClick(q, r);
          const validMoves = testBoard.getValidMoves();
          
          for (const move of validMoves) {
            const moveBoard = testBoard.clone();
            moveBoard.handleClick(move[0], move[1]);
            if (moveBoard.isGameOver() === forPlayer) {
              opportunities.push({ start: [q, r], end: move });
            }
          }
        }
      }
      return opportunities;
    };

    // Evaluate row lengths and potential scores
    const evaluateRows = (forPlayer) => {
      let maxRow = 0;
      let numThrees = 0;
      let numFours = 0;
      
      const directions = [[1, 0], [0, 1], [1, -1]];
      for (const [startQ, startR] of points) {
        const startKey = `${startQ},${startR}`;
        const piece = board.getBoardState()[startKey];
        if (!piece || piece.type !== 'marker' || piece.player !== forPlayer) continue;

        for (const [dq, dr] of directions) {
          let count = 1;
          let q = startQ + dq;
          let r = startR + dr;
          while (count < 6) {
            const key = `${q},${r}`;
            const nextPiece = board.getBoardState()[key];
            if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== forPlayer) break;
            count++;
            q += dq;
            r += dr;
          }
          maxRow = Math.max(maxRow, count);
          if (count === 3) numThrees++;
          if (count === 4) numFours++;
        }
      }
      return { maxRow, numThrees, numFours };
    };

    // New helper to evaluate row potential
    const evaluateRowPotential = (forPlayer) => {
      const potentialRows = [];
      const directions = [[1, 0], [0, 1], [1, -1]];
      
      for (const [startQ, startR] of points) {
        const startKey = `${startQ},${startR}`;
        const piece = board.getBoardState()[startKey];
        if (!piece || piece.type !== 'marker' || piece.player !== forPlayer) continue;

        for (const [dq, dr] of directions) {
          let sequence = [[startQ, startR]];
          let gaps = [];
          let q = startQ + dq;
          let r = startR + dr;
          let blocked = false;
          
          // Look ahead up to 6 spaces
          while (sequence.length + gaps.length < 6) {
            const key = `${q},${r}`;
            const nextPiece = board.getBoardState()[key];
            
            if (!nextPiece) {
              // Empty space - potential gap
              gaps.push([q, r]);
            } else if (nextPiece.type === 'marker') {
              if (nextPiece.player === forPlayer) {
                sequence.push([q, r]);
              } else {
                blocked = true;
                break;
              }
            } else if (nextPiece.type === 'ring') {
              // Ring blocks the sequence
              blocked = true;
              break;
            }
            
            q += dq;
            r += dr;
          }

          if (sequence.length >= 3 && !blocked && gaps.length <= 2) {
            potentialRows.push({
              sequence,
              gaps,
              quality: sequence.length * 2 - gaps.length
            });
          }
        }
      }
      
      return potentialRows;
    };

    // New helper to evaluate ring mobility and positioning
    const evaluateRingPosition = (forPlayer) => {
      let mobility = 0;
      let positioning = 0;
      const centerDist = new Map();
      
      for (const [q, r] of points) {
        const piece = board.getBoardState()[`${q},${r}`];
        if (piece?.type === 'ring' && piece.player === forPlayer) {
          // Calculate mobility (available moves)
          const testBoard = board.clone();
          testBoard.handleClick(q, r);
          const validMoves = testBoard.getValidMoves();
          mobility += validMoves.length;
          
          // Calculate distance from center
          const distFromCenter = Math.abs(q) + Math.abs(r);
          centerDist.set(`${q},${r}`, distFromCenter);
          
          // Evaluate strategic positioning
          if (distFromCenter <= 2) {
            positioning += 3;  // Central position
          } else if (distFromCenter <= 4) {
            positioning += 2;  // Mid-board position
          } else {
            positioning += 1;  // Edge position
          }
        }
      }
      
      return { mobility, positioning, centerDist };
    };

    // New helper to evaluate marker distribution and clusters
    const evaluateMarkerDistribution = (forPlayer) => {
      const regions = new Map();  // Divide board into regions
      let clusters = 0;
      let vulnerableMarkers = 0;
      
      for (const [q, r] of points) {
        const piece = board.getBoardState()[`${q},${r}`];
        if (piece?.type === 'marker') {
          // Assign to region (divide board into 6 sectors)
          const region = Math.floor((Math.atan2(r, q) + Math.PI) / (Math.PI / 3));
          regions.set(region, (regions.get(region) || 0) + (piece.player === forPlayer ? 1 : -1));
          
          // Check for clusters
          if (piece.player === forPlayer) {
            // Count adjacent markers directly instead of using this._countAdjacentMarkers
            const directions = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
            const adjacentSame = directions.filter(([dq, dr]) => {
              const adjPiece = board.getBoardState()[`${q+dq},${r+dr}`];
              return adjPiece?.type === 'marker' && adjPiece.player === forPlayer;
            }).length;
            if (adjacentSame >= 2) clusters++;
            
            // Check vulnerability directly instead of using this._isMarkerVulnerable
            const isVulnerable = directions.some(([dq, dr]) => {
              // Check if there's an opponent ring that could move to flip this marker
              const ringQ = q - dq;
              const ringR = r - dr;
              const ringPiece = board.getBoardState()[`${ringQ},${ringR}`];
              if (ringPiece?.type === 'ring' && ringPiece.player !== forPlayer) {
                // Check if there's a valid landing spot
                const landQ = q + dq;
                const landR = r + dr;
                const landingSpot = board.getBoardState()[`${landQ},${landR}`];
                return !landingSpot;
              }
              return false;
            });
            if (isVulnerable) vulnerableMarkers++;
          }
        }
      }
      
      return { regions, clusters, vulnerableMarkers };
    };

    // Get all evaluations
    const myScoring = findScoringMoves(currentPlayer);
    const oppScoring = findScoringMoves(3 - currentPlayer);
    const myRows = evaluateRows(currentPlayer);
    const oppRows = evaluateRows(3 - currentPlayer);
    const myPotentialRows = evaluateRowPotential(currentPlayer);
    const oppPotentialRows = evaluateRowPotential(3 - currentPlayer);
    const myRingPosition = evaluateRingPosition(currentPlayer);
    const oppRingPosition = evaluateRingPosition(3 - currentPlayer);
    const myMarkerDist = evaluateMarkerDistribution(currentPlayer);
    const oppMarkerDist = evaluateMarkerDistribution(3 - currentPlayer);

    return {
      myScoring,
      oppScoring,
      myRows,
      oppRows,
      myPotentialRows,
      oppPotentialRows,
      myRingPosition,
      oppRingPosition,
      myMarkerDist,
      oppMarkerDist,
      myMarkers: countPlayerMarkers(board, currentPlayer),
      oppMarkers: countPlayerMarkers(board, 3 - currentPlayer)
    };
  }

  select(rootNode) {
    let node = rootNode;
    while (node.children.size > 0 && node.getLegalMoves().length === 0) {
      let bestScore = -Infinity;
      let bestChild = null;

      for (const [_, child] of node.children.entries()) {
        const score = this.usePUCT ? child.puct(node.visits) : child.ucb1(node.visits);
        if (score > bestScore) {
          bestScore = score;
          bestChild = child;
        }
      }

      if (!bestChild) break;
      node = bestChild;
    }
    return node;
  }

  expand(node) {
    const moves = node.getLegalMoves();
    if (!moves || moves.length === 0) return null;

    // Pick first untried move (sorted by heuristic score at root, arbitrary deeper)
    const selectedMove = moves[0];

    // CRITICAL: Remove this move from untried moves so select() can traverse
    node.untriedMoves.splice(0, 1);

    // Create new board state with the selected move
    const newBoard = node.board.clone();
    this._applyMove(newBoard, selectedMove);

    // Create child node
    const childNode = new MCTSNode(newBoard, selectedMove, node, this);

    // Assign policy prior if available
    const moveKey = JSON.stringify(selectedMove);
    if (this.rootPriors && this.rootPriors.has(moveKey)) {
      childNode.prior = this.rootPriors.get(moveKey);
    }

    // Add child to parent's children Map
    node.children.set(moveKey, childNode);

    return childNode;
  }

  backpropagate(node, result) {
    while (node !== null) {
      node.updateStats(result);
      // Track Q-value bounds for PUCT normalization
      if (node.visits > 0) {
        const q = node.wins / node.visits;
        if (q < this.qMin) this.qMin = q;
        if (q > this.qMax) this.qMax = q;
      }
      result = -result;
      node = node.parent;
    }
    this.cleanTranspositionTable();
  }

  simulate(node) {
    if (this.evaluationMode === 'nn' && this.valueNetwork) {
      return this._evaluateWithNN(node);
    }
    return this._simulateWithRollout(node);
  }

  async _evaluateWithNN(node) {
    const board = node.board;
    const winner = board.isGameOver();
    if (winner) {
      const startingPlayer = board.getCurrentPlayer();
      return winner === startingPlayer ? 10000 : -10000;
    }
    // Use evaluatePosition (value only) — policy is fetched separately at root
    const value = await this.valueNetwork.evaluatePosition(board);
    // Scale to match existing score range used by backpropagate
    return value * 5000;
  }

  _simulateWithRollout(node) {
    const MAX_PLAYOUT_DEPTH = 12;
    const board = node.board.clone();
    const startingPlayer = board.getCurrentPlayer();
    let currentDepth = 0;

    while (currentDepth < MAX_PLAYOUT_DEPTH) {
      // Check for game over
      const winner = board.isGameOver();
      if (winner) {
        return winner === startingPlayer ? 10000 : -10000;
      }

      // Get legal moves
      const moves = this._getLegalMovesForSimulation(board);
      if (!moves || moves.length === 0) {
        break;
      }

      // Use FAST heuristic to pick best move (lightweight mode for playouts)
      const selectedMove = this._selectMoveByFastHeuristic(moves, board, true).move;

      // Apply move
      this._applyMove(board, selectedMove);

      currentDepth++;
    }

    // Evaluate final position
    return this._evaluatePlayoutResult(board, startingPlayer);
  }

  /**
   * FAST move selection using lightweight heuristics
   * Actually simulates moves to check winning/blocking positions
   */
  _selectMoveByFastHeuristic(moves, board, lightweight = false) {
    const currentPlayer = board.getCurrentPlayer();
    const opponent = currentPlayer === 1 ? 2 : 1;

    let bestMove = moves[0];
    let bestScore = -Infinity;
    const allScores = lightweight ? null : new Map();

    for (const move of moves) {
      let score = 0;

      // CRITICAL: Simulate the move and check if it creates 5 in a row (INSTANT WIN)
      const winCheck = this._simulateAndCheckWin(move, board, currentPlayer);

      if (winCheck.wins) {
        return { move, score: Infinity };  // Take winning move immediately!
      }

      // CRITICAL: Check if this move GIVES opponent a threat (BAD!)
      // This happens when we flip our own markers, creating opponent rows
      const blockCheck = this._checkOpponentThreat(move, board, opponent);
      if (blockCheck.hasFourInRow) {
        score -= 5000;  // Heavily penalize giving opponent 4-in-a-row!
      } else if (blockCheck.hasThreeInRow) {
        score -= 1000;  // Penalize giving opponent 3-in-a-row
      }

      // OPPONENT RESPONSE LOOKAHEAD + SAFETY CHECKS (only at root level)
      if (!lightweight) {
        const testBoard = board.clone();
        this._applyMove(testBoard, move);

        // Evaluate best opponent reply position
        let worstOppResponse = 0;
        const oppRings = this._getPlayerRings(testBoard, opponent);
        for (const [ringQ, ringR] of oppRings) {
          const oppMoves = this._getRingMovesFrom(testBoard, ringQ, ringR);
          for (const oppMove of oppMoves) {
            const oppWinCheck = this._simulateAndCheckWin(oppMove, testBoard, opponent);
            if (oppWinCheck.wins) {
              worstOppResponse = Math.max(worstOppResponse, 10000);
              break;
            } else if (oppWinCheck.maxRow >= 4) {
              worstOppResponse = Math.max(worstOppResponse, 3000);
            } else if (oppWinCheck.maxRow >= 3) {
              worstOppResponse = Math.max(worstOppResponse, 500);
            }
          }
          if (worstOppResponse >= 10000) break;
        }
        score -= worstOppResponse;
      }

      // ALSO check if this move creates NEW threats for opponent (not pre-existing)
      const oppBeforeWinCheck = this._checkPlayerMaxRow(board, opponent);
      const oppWinCheck = this._simulateAndCheckWin(move, board, opponent);

      // Only penalize if we're CREATING a new threat, not if it already existed
      if (oppWinCheck.maxRow >= 4 && oppWinCheck.maxRow > oppBeforeWinCheck) {
        score -= 6000;  // Creating opponent 4-in-a-row is terrible!
      } else if (oppWinCheck.maxRow >= 3 && oppWinCheck.maxRow > oppBeforeWinCheck) {
        score -= 1500;  // Creating opponent 3-in-a-row is bad
      }

      // Count markers we'll flip
      const flipResult = this._fastCountFlips(move, board, currentPlayer);

      // CRITICAL: Check if we're flipping a marker that BLOCKS opponent's threat
      let flipPenalty = 0;
      if (!lightweight) {
        const helpingOpponentThreat = this._checkIfFlipHelpsOpponent(move, board, currentPlayer, opponent);
        if (helpingOpponentThreat) {
          flipPenalty = -15000;  // Absolutely catastrophic!
          score += flipPenalty;
        }
      }

      // Check for creating threats after this move
      let threatBonus = 0;
      if (winCheck.maxRow >= 4) {
        // Check if this 4-in-a-row is completable next turn
        const completable = this._check4InRowCompletable(move, board, currentPlayer);
        threatBonus = completable ? 5000 : 1200;  // Completable is CRITICAL, non-completable still very good
      } else if (winCheck.maxRow >= 3) {
        threatBonus = 600;  // 3-in-a-row is a serious threat
      } else if (winCheck.maxRow >= 2) {
        threatBonus = 200;  // 2-in-a-row is building toward something
      }
      score += threatBonus;

      // Flip scoring: penalize flipping own markers, bonus for flipping opponent's
      if (flipPenalty === 0) {
        if (flipResult.oppMarkersFlipped > 0) {
          score += flipResult.oppMarkersFlipped * 100;
        }
        if (flipResult.ourMarkersFlipped > 0) {
          score -= flipResult.ourMarkersFlipped * 300;
        }
      }

      // Check if we're disrupting opponent's threats by flipping their markers
      const scores = board.getScores();
      const myScore = scores[currentPlayer] || 0;
      const oppScore = scores[opponent] || 0;
      const scoreDiff = myScore - oppScore;

      let disruptionBonus = this._checkDisruptionValue(move, board, currentPlayer, opponent);

      if (scoreDiff >= 0) {
        disruptionBonus *= 1.2;  // 20% bonus when ahead/even
      } else {
        disruptionBonus *= 0.8;  // 20% penalty when behind
      }

      score += disruptionBonus;

      // Estimate markers opponent can flip after this move (negative value)
      const opponentFlipPotential = this._fastEstimateOpponentFlips(move, board, opponent);
      score -= opponentFlipPotential * 5;

      // Small randomness to avoid deterministic play
      score += Math.random() * 2;

      if (allScores) allScores.set(move, score);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return { move: bestMove, score: bestScore, allScores };
  }

  /**
   * Check if player can win on their next turn
   * Returns true if they have a completable 4-in-a-row OR can create 5-in-a-row
   */
  _checkCanWinNextTurn(board, player) {
    // Check if they have a completable 4-in-a-row
    const rings = this._getPlayerRings(board, player);
    for (const [ringQ, ringR] of rings) {
      const ringMoves = this._getRingMovesFrom(board, ringQ, ringR);
      for (const ringMove of ringMoves) {
        const winCheck = this._simulateAndCheckWin(ringMove, board, player);
        if (winCheck.wins) {
          return true;  // They can win next turn!
        }
      }
    }
    return false;
  }

  /**
   * Check player's max row length on current board (no simulation)
   * Returns the longest row length for the player
   */
  _checkPlayerMaxRow(board, player) {
    const boardState = board.getBoardState();
    const directions = [[1, 0], [0, 1], [1, -1]];

    let maxRow = 0;

    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type !== 'marker' || piece.player !== player) continue;
      const [startQ, startR] = key.split(',').map(Number);

      for (const [dq, dr] of directions) {
        let count = 1;
        let q = startQ + dq;
        let r = startR + dr;

        // Count consecutive markers in this direction
        while (count < 6) {
          const nextPiece = boardState[`${q},${r}`];
          if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== player) break;
          count++;
          q += dq;
          r += dr;
        }

        maxRow = Math.max(maxRow, count);
      }
    }

    return maxRow;
  }

  /**
   * Simulate move and check if it creates a winning position
   * Returns { wins: boolean, maxRow: number }
   */
  _simulateAndCheckWin(move, board, player) {
    try {
      // Clone board and apply move
      const testBoard = board.clone();
      this._applyMove(testBoard, move);

      // Check all positions for rows of our markers
      const boardState = testBoard.getBoardState();
      const directions = [[1, 0], [0, 1], [1, -1]];

      let maxRow = 0;

      for (const [key, piece] of Object.entries(boardState)) {
        if (!piece || piece.type !== 'marker' || piece.player !== player) continue;

        const [startQ, startR] = key.split(',').map(Number);

        for (const [dq, dr] of directions) {
          let count = 1;
          let q = startQ + dq;
          let r = startR + dr;

          // Count consecutive markers in this direction
          while (count < 6) {
            const nextPiece = boardState[`${q},${r}`];
            if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== player) break;
            count++;
            q += dq;
            r += dr;
          }

          if (count > maxRow) {
            maxRow = count;
          }
          if (count >= 5) {
            return { wins: true, maxRow: count };
          }
        }
      }

      return { wins: false, maxRow };
    } catch (e) {
      console.error('[ERROR _simulateAndCheckWin]', e);
      return { wins: false, maxRow: 0 };
    }
  }

  /**
   * Check if opponent can win on their next turn
   * SIMPLIFIED VERSION - just check if opponent has 4-in-a-row after our move
   * This is much faster than simulating all opponent moves
   * Returns { canWin: boolean, hasFourInRow: boolean }
   */
  _checkOpponentThreat(move, board, opponent) {
    try {
      // Check opponent's max row BEFORE our move
      const oppBeforeMaxRow = this._checkPlayerMaxRow(board, opponent);

      // Clone board and apply our move
      const testBoard = board.clone();
      this._applyMove(testBoard, move);

      // Check opponent's max row AFTER our move
      const oppAfterMaxRow = this._checkPlayerMaxRow(testBoard, opponent);

      // Only flag as threat if we INCREASED opponent's max row (created new threat)
      return {
        canWin: false,  // Too expensive to check all opponent moves
        hasFourInRow: oppAfterMaxRow >= 4 && oppAfterMaxRow > oppBeforeMaxRow,
        hasThreeInRow: oppAfterMaxRow >= 3 && oppAfterMaxRow > oppBeforeMaxRow
      };
    } catch (e) {
      return { canWin: false, hasFourInRow: false, hasThreeInRow: false };
    }
  }

  /**
   * Check if player has a row of specified length
   */
  _checkPlayerHasRow(board, player, length) {
    const boardState = board.getBoardState();
    const directions = [[1, 0], [0, 1], [1, -1]];

    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type !== 'marker' || piece.player !== player) continue;
      const [startQ, startR] = key.split(',').map(Number);

      for (const [dq, dr] of directions) {
        let count = 1;
        let q = startQ + dq;
        let r = startR + dr;

        while (count < 6) {
          const nextPiece = boardState[`${q},${r}`];
          if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== player) break;
          count++;
          q += dq;
          r += dr;
        }

        if (count >= length) return true;
      }
    }

    return false;
  }

  /**
   * Get all ring positions for a player
   */
  _getPlayerRings(board, player) {
    const rings = [];
    const boardState = board.getBoardState();

    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type === 'ring' && piece.player === player) {
        rings.push(key.split(',').map(Number));
      }
    }

    return rings;
  }

  /**
   * Get all possible moves for a ring at a position
   */
  _getRingMovesFrom(board, startQ, startR) {
    const validDests = board.calculateValidMoves(startQ, startR);
    return validDests.map(([endQ, endR]) => ({
      type: 'move-ring',
      start: [startQ, startR],
      end: [endQ, endR]
    }));
  }

  /**
   * Check if a 4-in-a-row can be completed on the next turn
   * Returns true if there's a ring that can move to complete the row
   */
  _check4InRowCompletable(move, board, player) {
    try {
      // Simulate the move
      const testBoard = board.clone();
      this._applyMove(testBoard, move);

      // Find all 4-in-a-rows for this player
      const boardState = testBoard.getBoardState();
      const directions = [[1, 0], [0, 1], [1, -1]];

      for (const [key, piece] of Object.entries(boardState)) {
        if (piece.type !== 'marker' || piece.player !== player) continue;
        const [startQ, startR] = key.split(',').map(Number);

        for (const [dq, dr] of directions) {
          let count = 1;
          let sequence = [[startQ, startR]];
          let q = startQ + dq;
          let r = startR + dr;

          // Build sequence
          while (count < 5) {
            const nextPiece = boardState[`${q},${r}`];
            if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== player) break;
            sequence.push([q, r]);
            count++;
            q += dq;
            r += dr;
          }

          // If we have exactly 4 in a row, check if it's completable
          if (count === 4) {
            // Check both ends of the sequence
            const [firstQ, firstR] = sequence[0];
            const [lastQ, lastR] = sequence[3];

            // Check position before first marker
            const beforeQ = firstQ - dq;
            const beforeR = firstR - dr;
            if (this._canCompleteRow(testBoard, beforeQ, beforeR, player)) {
              return true;
            }

            // Check position after last marker
            const afterQ = lastQ + dq;
            const afterR = lastR + dr;
            if (this._canCompleteRow(testBoard, afterQ, afterR, player)) {
              return true;
            }
          }
        }
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if a ring can move FROM a position to complete a row
   * When a ring moves, it leaves a marker behind - that's what completes the row!
   */
  _canCompleteRow(board, targetQ, targetR, player) {
    // Target position must have our RING (not be empty!)
    // When the ring moves away, it leaves a marker, completing the row
    const targetPiece = board.getBoardState()[`${targetQ},${targetR}`];

    if (!targetPiece || targetPiece.type !== 'ring' || targetPiece.player !== player) {
      return false;
    }

    // We have a ring at this position! Check if it can move AWAY
    const ringMoves = this._getRingMovesFrom(board, targetQ, targetR);

    // As long as the ring can move anywhere, it will leave a marker and complete the row
    return ringMoves.length > 0;
  }

  /**
   * Check if flipping markers disrupts opponent's threats
   * Returns bonus points for disruption
   */
  _checkDisruptionValue(move, board, player, opponent) {
    if (move.type !== 'move-ring' || !move.start || !move.end) return 0;

    try {
      // Get markers we'll flip
      const [startQ, startR] = move.start;
      const [endQ, endR] = move.end;
      const dq = Math.sign(endQ - startQ);
      const dr = Math.sign(endR - startR);

      let disruptionValue = 0;
      let q = startQ + dq;
      let r = startR + dr;

      // Check each marker we'll flip
      while (q !== endQ || r !== endR) {
        const key = `${q},${r}`;
        const piece = board.boardState[key];

        if (piece?.type === 'marker' && piece.player === opponent) {
          // We're flipping an opponent marker - check if it's part of a threat
          const threatLevel = this._checkMarkerThreatLevel(board, q, r, opponent);
          if (threatLevel === 4) {
            disruptionValue += 5000;  // Breaking 4-in-a-row is CRITICAL (even more than creating our own)
          } else if (threatLevel === 3) {
            disruptionValue += 700;   // Breaking 3-in-a-row is very valuable
          } else if (threatLevel === 2) {
            disruptionValue += 250;   // Breaking 2-in-a-row is good
          }
        }

        q += dq;
        r += dr;
      }

      return disruptionValue;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Check what level of threat a marker is part of (2, 3, or 4 in a row)
   */
  _checkMarkerThreatLevel(board, q, r, player) {
    const directions = [[1, 0], [0, 1], [1, -1]];
    let maxThreat = 1;

    for (const [dq, dr] of directions) {
      let count = 1;  // Count this marker

      // Count in positive direction
      for (let i = 1; i < 5; i++) {
        const piece = board.boardState[`${q + dq * i},${r + dr * i}`];
        if (piece?.type === 'marker' && piece.player === player) {
          count++;
        } else {
          break;
        }
      }

      // Count in negative direction
      for (let i = 1; i < 5; i++) {
        const piece = board.boardState[`${q - dq * i},${r - dr * i}`];
        if (piece?.type === 'marker' && piece.player === player) {
          count++;
        } else {
          break;
        }
      }

      maxThreat = Math.max(maxThreat, count);
    }

    return maxThreat;
  }

  /**
   * Check if flipping our marker helps opponent complete a threat
   * Example: opp has [opp, opp, opp, OUR_MARKER] - if we flip it, they get 4-in-a-row!
   */
  _checkIfFlipHelpsOpponent(move, board, player, opponent) {
    // Accept both 'move' and 'move-ring' types
    if ((move.type !== 'move' && move.type !== 'move-ring') || !move.start || !move.end) return false;

    const [startQ, startR] = move.start;
    const [endQ, endR] = move.end;
    const dq = Math.sign(endQ - startQ);
    const dr = Math.sign(endR - startR);

    let q = startQ + dq;
    let r = startR + dr;

    // Check each marker we'll flip
    while (q !== endQ || r !== endR) {
      const key = `${q},${r}`;
      const piece = board.boardState[key];

      // If we're flipping OUR marker to opponent's color
      if (piece?.type === 'marker' && piece.player === player) {
        // Check if this position would extend an opponent threat
        const threatBefore = this._checkMarkerThreatLevel(board, q, r, opponent);
        // Simulate the flip
        const testBoard = board.clone();
        testBoard.boardState[key] = { type: 'marker', player: opponent };
        const threatAfter = this._checkMarkerThreatLevel(testBoard, q, r, opponent);

        // If flipping increases opponent's threat significantly
        if (threatAfter >= 4 || (threatAfter >= 3 && threatBefore < 2)) {
          return true;  // This flip helps opponent win!
        }
      }

      q += dq;
      r += dr;
    }

    return false;
  }

  /**
   * Fast count of marker value when flipping
   * Flipping opponent markers is GOOD (+1 each)
   * Flipping our own markers is BAD (-1 each)
   */
  _fastCountFlips(move, board, player) {
    // Accept both 'move' and 'move-ring' types
    if ((move.type !== 'move' && move.type !== 'move-ring') || !move.start || !move.end) return { oppMarkersFlipped: 0, ourMarkersFlipped: 0 };

    const [startQ, startR] = move.start;
    const [endQ, endR] = move.end;

    // Calculate direction
    const dq = Math.sign(endQ - startQ);
    const dr = Math.sign(endR - startR);

    let ourMarkersFlipped = 0;
    let oppMarkersFlipped = 0;
    let q = startQ + dq;
    let r = startR + dr;

    // Count markers along path by owner
    while (q !== endQ || r !== endR) {
      const key = `${q},${r}`;
      const piece = board.boardState[key];
      if (piece?.type === 'marker') {
        if (piece.player === player) {
          ourMarkersFlipped++;  // BAD - we're losing our own markers!
        } else {
          oppMarkersFlipped++;  // GOOD - we're capturing opponent markers
        }
      }
      q += dq;
      r += dr;
    }

    return { oppMarkersFlipped, ourMarkersFlipped };
  }

  /**
   * Estimate how many markers opponent could flip next turn
   * (simplified - just count markers near their rings)
   */
  _fastEstimateOpponentFlips(move, board, opponent) {
    // After our move, marker is at move.start
    if (!move.start) return 0;

    const [q, r] = move.start;
    let nearbyOpponentRings = 0;

    // Check 6 hexagonal directions for opponent rings
    const directions = [[1,0], [-1,0], [0,1], [0,-1], [1,-1], [-1,1]];

    for (const [dq, dr] of directions) {
      for (let dist = 1; dist <= 3; dist++) {
        const key = `${q + dq * dist},${r + dr * dist}`;
        const piece = board.boardState[key];
        if (piece?.type === 'ring' && piece.player === opponent) {
          nearbyOpponentRings++;
          break;
        }
      }
    }

    return nearbyOpponentRings;
  }


  _getLegalMovesForSimulation(board) {
    const gamePhase = board.getGamePhase();
    const currentPlayer = board.getCurrentPlayer();

    switch (gamePhase) {
      case 'setup':  // YinshBoard uses 'setup' for ring placement
        return this.getRingPlacements(board);

      case 'play':  // YinshBoard uses 'play' for main gameplay
        return this.getRingMoves(board);

      case 'remove-row':  // YinshBoard uses 'remove-row'
        return this.getRowRemovals(board);

      case 'remove-ring':  // YinshBoard uses 'remove-ring'
        return this.getRingRemovals(board);

      default:
        return [];
    }
  }

  _evaluateRingRemoval(board, q, r) {
    let score = 0;
    
    // Penalize removing central rings
    const distFromCenter = Math.abs(q) + Math.abs(r);
    if (distFromCenter <= 2) score -= 200;
    else if (distFromCenter <= 4) score -= 100;
    
    // Test mobility of this ring
    const testBoard = board.clone();
    testBoard.handleClick(q, r);
    const validMoves = testBoard.getValidMoves();
    score -= validMoves.length * 50;  // Penalize removing mobile rings
    
    // Check for potential marker captures
    let jumpPotential = 0;
    for (const move of validMoves) {
      const moveBoard = testBoard.clone();
      const beforeMarkers = this._countOpponentMarkers(moveBoard, 3 - board.getCurrentPlayer());
      moveBoard.handleClick(move[0], move[1]);
      const afterMarkers = this._countOpponentMarkers(moveBoard, 3 - board.getCurrentPlayer());
      if (afterMarkers < beforeMarkers) {
        jumpPotential += (beforeMarkers - afterMarkers);
      }
    }
    score -= jumpPotential * 100;  // Heavily penalize removing rings that can capture

    return score;
  }

  _evaluateRowRemoval(board, row) {
    let score = 0;
    const currentPlayer = board.getCurrentPlayer();
    
    // Count how many opponent markers would be disrupted
    let disruptedOpponentMarkers = 0;
    for (const [q, r] of row) {
      const directions = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
      for (const [dq, dr] of directions) {
        const piece = board.getBoardState()[`${q+dq},${r+dr}`];
        if (piece?.type === 'marker' && piece.player !== currentPlayer) {
          disruptedOpponentMarkers++;
        }
      }
    }
    score += disruptedOpponentMarkers * 50;

    // Prefer rows that don't break our own potential future rows
    const testBoard = board.clone();
    for (const [q, r] of row) {
      delete testBoard.boardState[`${q},${r}`];
    }
    const remainingRows = this._countPotentialRows(testBoard, currentPlayer);
    score += remainingRows * 100;

    return score;
  }

  _countPotentialRows(board, player) {
    let count = 0;
    const boardState = board.getBoardState();
    const directions = [[1, 0], [0, 1], [1, -1]];

    for (const [key, startPiece] of Object.entries(boardState)) {
      if (startPiece.type !== 'marker' || startPiece.player !== player) continue;
      const [startQ, startR] = key.split(',').map(Number);

      for (const [dq, dr] of directions) {
        let length = 1;
        let q = startQ + dq;
        let r = startR + dr;
        
        while (length < 4) {
          const piece = boardState[`${q},${r}`];
          if (!piece || piece.type !== 'marker' || piece.player !== player) break;
          length++;
          q += dq;
          r += dr;
        }
        
        if (length >= 4) count++;  // Count sequences of 4+ as potential rows
      }
    }
    return count;
  }

  _evaluatePlayoutResult(board, startingPlayer) {
    const evaluation = this.evaluatePosition(board, startingPlayer);
    let score = 0;

    // Add null checks for all evaluation properties
    const myScoring = evaluation?.myScoring || [];
    const oppScoring = evaluation?.oppScoring || [];
    const myPotentialRows = evaluation?.myPotentialRows || [];
    const oppPotentialRows = evaluation?.oppPotentialRows || [];
    const myRingPosition = evaluation?.myRingPosition || { mobility: 0, positioning: 0 };
    const oppRingPosition = evaluation?.oppRingPosition || { mobility: 0, positioning: 0 };
    const myMarkerDist = evaluation?.myMarkerDist || { vulnerableMarkers: 0, clusters: 0 };
    const oppMarkerDist = evaluation?.oppMarkerDist || { vulnerableMarkers: 0, clusters: 0 };

    // For ring removal phase, evaluate ring strategic value
    if (board.getGamePhase() === 'remove-ring') {
      const boardState = board.getBoardState();
      for (const [key, piece] of Object.entries(boardState)) {
        if (piece.type === 'ring' && piece.player === startingPlayer) {
          const [q, r] = key.split(',').map(Number);
          // Test mobility of this ring
          const testBoard = board.clone();
          testBoard.handleClick(q, r);
          const validMoves = testBoard.getValidMoves();
          
          // Value rings that can jump over opponent markers
          let jumpPotential = 0;
          for (const move of validMoves) {
            const moveBoard = testBoard.clone();
            const beforeMarkers = this._countOpponentMarkers(moveBoard, 3 - startingPlayer);
            moveBoard.handleClick(move[0], move[1]);
            const afterMarkers = this._countOpponentMarkers(moveBoard, 3 - startingPlayer);
            if (afterMarkers < beforeMarkers) {
              jumpPotential += (beforeMarkers - afterMarkers);
            }
          }
          
          // Add to score based on ring's strategic value
          score -= validMoves.length * 50;  // Penalize removing mobile rings
          score -= jumpPotential * 100;     // Heavily penalize removing rings that can capture
          
          // Consider position relative to center
          const distFromCenter = Math.abs(q) + Math.abs(r);
          if (distFromCenter <= 2) {
            score -= 200;  // Penalize removing central rings
          }
        }
      }
    } else {
      // Check for immediate scoring
      if (myScoring.length > 0) return 10000;
      if (oppScoring.length > 0) return -10000;

      // Ring score difference (most important)
      const ringScoreDiff = board.getScores()[startingPlayer] -
                           board.getScores()[3 - startingPlayer];
      score += ringScoreDiff * 5000;

      // Row evaluation
      const myRows = evaluation?.myRows || { maxRow: 0, numThrees: 0, numFours: 0 };
      const oppRows = evaluation?.oppRows || { maxRow: 0, numThrees: 0, numFours: 0 };

      score += (myRows.numFours || 0) * 1200;
      score += (myRows.numThrees || 0) * 300;
      score -= (oppRows.numFours || 0) * 1200;
      score -= (oppRows.numThrees || 0) * 300;

      // Marker control
      const myMarkers = evaluation?.myMarkers || 0;
      const oppMarkers = evaluation?.oppMarkers || 0;
      score += (myMarkers - oppMarkers) * 50;

      // Ring mobility advantage
      score += (myRingPosition.mobility - oppRingPosition.mobility) * 20;
      score += (myRingPosition.positioning - oppRingPosition.positioning) * 30;

      // Vulnerability penalty
      score -= (myMarkerDist.vulnerableMarkers || 0) * 40;
      score += (oppMarkerDist.vulnerableMarkers || 0) * 40;
    }

    return score;
  }

  _countOpponentMarkers(board, player) {
    let count = 0;
    const boardState = board.getBoardState();
    for (const piece of Object.values(boardState)) {
      if (piece.type === 'marker' && piece.player === player) {
        count++;
      }
    }
    return count;
  }

  _countAdjacentMarkers = (board, q, r, player) => {
    const directions = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
    return directions.filter(([dq, dr]) => {
      const piece = board.getBoardState()[`${q+dq},${r+dr}`];
      return piece?.type === 'marker' && piece.player === player;
    }).length;
  }

  _isMarkerVulnerable = (board, q, r, player) => {
    const directions = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
    for (const [dq, dr] of directions) {
      // Check if there's an opponent ring that could move to flip this marker
      let testQ = q - dq;
      let testR = r - dr;
      const ringPiece = board.getBoardState()[`${testQ},${testR}`];
      if (ringPiece?.type === 'ring' && ringPiece.player !== player) {
        // Check if there's a valid landing spot
        testQ = q + dq;
        testR = r + dr;
        const landingSpot = board.getBoardState()[`${testQ},${testR}`];
        if (!landingSpot) return true;
      }
    }
    return false;
  }

  _evaluateCenterControl = (board, player) => {
    let score = 0;
    const centerPoints = [
      [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, 1], [1, -1]
    ];

    for (const [q, r] of centerPoints) {
      const piece = board.getBoardState()[`${q},${r}`];
      if (piece) {
        if (piece.player === player) {
          score += piece.type === 'ring' ? 2 : 1;
        } else {
          score -= piece.type === 'ring' ? 2 : 1;
        }
      }
    }

    return score;
  }

  // Add method to manage table size
  cleanTranspositionTable() {
    if (transpositionTable.size > this.maxTableSize) {
      const entries = Array.from(transpositionTable.entries());
      entries.sort((a, b) => a[1].visits - b[1].visits);
      
      const numToRemove = Math.floor(this.maxTableSize * 0.2);
      entries.slice(0, numToRemove).forEach(([hash, _]) => {
        transpositionTable.delete(hash);
      });
    }
  }

  async getBestMove(board, numSimulations = 500) {
    transpositionTable.clear();
    // Reset Q normalization bounds for each search
    this.qMin = Infinity;
    this.qMax = -Infinity;
    this.usePUCT = false;
    this.rootPriors = null;

    if (!board) {
      return null;
    }
    if (board.isGameOver()) {
      return null;
    }

    const rootNode = new MCTSNode(board, null, null, this);
    const moves = rootNode.getLegalMoves();

    const evaluation = this.evaluatePosition(board, board.getCurrentPlayer());

    if (evaluation.myScoring.length > 0) {
      return {
        move: evaluation.myScoring[0].start,
        destination: evaluation.myScoring[0].end,
        confidence: 1.0,
        rootNode
      };
    }

    // Evaluate all moves with full heuristic (includes opponent response lookahead)
    const heuristicResult = this._selectMoveByFastHeuristic(moves, board, false);

    // Sort untried moves by heuristic score (best first) so MCTS explores promising moves first
    if (rootNode.untriedMoves && heuristicResult.allScores) {
      rootNode.untriedMoves.sort((a, b) =>
        (heuristicResult.allScores.get(b) || 0) - (heuristicResult.allScores.get(a) || 0)
      );
    }
    const heuristicMove = heuristicResult.move;
    const heuristicScore = heuristicResult.score;

    // Winning moves get returned with full confidence
    if (heuristicMove && heuristicScore === Infinity) {
      return {
        move: heuristicMove.start,
        destination: heuristicMove.end,
        confidence: 1.0,
        type: heuristicMove.type,
        row: heuristicMove.row,
        rootNode
      };
    }

    // Return high-confidence heuristic moves directly — the heuristic with opponent
    // lookahead is more reliable than 200 MCTS sims for tactically obvious moves
    // (e.g., creating 4-in-a-row, flipping multiple opponent markers, blocking threats)
    if (heuristicMove && heuristicScore >= 500) {
      return {
        move: heuristicMove.start,
        destination: heuristicMove.end,
        confidence: Math.min(0.95, 0.5 + heuristicScore / 20000),
        type: heuristicMove.type,
        row: heuristicMove.row,
        rootNode
      };
    }

    // Fetch policy priors from NN at root (if available)
    const useNN = this.evaluationMode === 'nn' && this.valueNetwork;
    if (useNN && this.valueNetwork.evaluatePositionWithPolicy) {
      try {
        const { policy } = await this.valueNetwork.evaluatePositionWithPolicy(board);
        if (policy) {
          this._assignPolicyPriors(rootNode, moves, policy);
          this.usePUCT = true;
        }
      } catch (e) {
        // Fall back to UCB1 if policy fetch fails
      }
    }

    // Run simulations
    for (let i = 0; i < numSimulations; i++) {
      let node = this.select(rootNode);
      let childNode = this.expand(node);

      if (childNode) {
        const result = useNN
          ? await this.simulate(childNode)
          : this.simulate(childNode);
        this.backpropagate(childNode, result);
      }
    }

    let bestVisits = -1;
    let bestMove = null;

    for (const [moveKey, child] of rootNode.children.entries()) {
      // Parse the move back from JSON string
      const move = JSON.parse(moveKey);
      if (child.visits > bestVisits) {
        bestVisits = child.visits;
        bestMove = move;
      }
    }

    return bestMove ? {
      move: bestMove.start,
      destination: bestMove.end,
      confidence: bestVisits / rootNode.visits,
      type: bestMove.type,
      row: bestMove.row,
      rootNode
    } : null;
  }

  /**
   * Compute policy prior for a move's destination index in the 11x11 grid.
   * Returns the (destR + 5) * 11 + (destQ + 5) index.
   */
  _getMoveDestIndex(move) {
    let destQ, destR;
    if (move.end) {
      [destQ, destR] = move.end;
    } else if (move.start) {
      [destQ, destR] = move.start;
    } else if (move.row && move.row.length > 0) {
      [destQ, destR] = move.row[0];
    } else {
      return -1;
    }
    return (destR + 5) * 11 + (destQ + 5);
  }

  /**
   * Assign policy priors to root node moves using NN policy output + Dirichlet noise.
   */
  _assignPolicyPriors(rootNode, moves, rawPolicy) {
    // Mask policy to legal move destinations and apply softmax
    const destIndices = moves.map(m => this._getMoveDestIndex(m));
    const moveKeys = moves.map(m => JSON.stringify(m));

    // Gather logits for legal destinations, compute softmax
    const logits = destIndices.map(idx => (idx >= 0 && idx < 121) ? rawPolicy[idx] : -Infinity);
    const maxLogit = Math.max(...logits.filter(l => l > -Infinity));
    const exps = logits.map(l => l > -Infinity ? Math.exp(l - maxLogit) : 0);
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const priors = exps.map(e => sumExps > 0 ? e / sumExps : 1.0 / moves.length);

    // Add Dirichlet noise at root for exploration
    const dirichletAlpha = 0.3;
    const noise = this._sampleDirichlet(moves.length, dirichletAlpha);
    const epsilon = 0.25;

    this.rootPriors = new Map();
    for (let i = 0; i < moves.length; i++) {
      const blendedPrior = (1 - epsilon) * priors[i] + epsilon * noise[i];
      this.rootPriors.set(moveKeys[i], blendedPrior);
    }

    // Assign priors to already-expanded children
    for (const [moveKey, child] of rootNode.children.entries()) {
      if (this.rootPriors.has(moveKey)) {
        child.prior = this.rootPriors.get(moveKey);
      }
    }
  }

  /**
   * Sample from Dirichlet distribution (simple gamma-based method).
   */
  _sampleDirichlet(n, alpha) {
    const samples = new Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // Approximate Gamma(alpha, 1) using the Marsaglia & Tsang method simplified for small alpha
      // For alpha < 1, use the Ahrens-Dieter transform
      let x;
      if (alpha < 1) {
        const u = Math.random();
        x = this._sampleGamma(alpha + 1) * Math.pow(u, 1.0 / alpha);
      } else {
        x = this._sampleGamma(alpha);
      }
      samples[i] = x;
      sum += x;
    }
    // Normalize
    if (sum > 0) {
      for (let i = 0; i < n; i++) samples[i] /= sum;
    } else {
      for (let i = 0; i < n; i++) samples[i] = 1.0 / n;
    }
    return samples;
  }

  /**
   * Sample from Gamma(alpha, 1) distribution using Marsaglia & Tsang's method.
   * Requires alpha >= 1.
   */
  _sampleGamma(alpha) {
    const d = alpha - 1.0 / 3.0;
    const c = 1.0 / Math.sqrt(9.0 * d);
    while (true) {
      let x, v;
      do {
        // Box-Muller for standard normal
        const u1 = Math.random();
        const u2 = Math.random();
        x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  runIteration(board) {
    const stateHash = board.getStateHash();
    const existingNode = transpositionTable.get(stateHash);
    
    if (existingNode) {
      this.root = existingNode;
    } else {
      this.root = new MCTSNode(board, null, null, this);
    }
    
    const node = this.select(this.root);
    const expandedNode = this.expand(node);
    
    if (!expandedNode) return null;
    
    const result = this.simulate(expandedNode);
    this.backpropagate(expandedNode, result);
    
    // Find best child
    let bestChild = null;
    let bestVisits = -1;
    
    for (const [move, child] of this.root.children.entries()) {
      const nodeData = transpositionTable.get(child.stateHash);
      const visits = nodeData ? nodeData.visits : child.visits;
      
      if (visits > bestVisits) {
        bestVisits = visits;
        bestChild = { move, node: child };
      }
    }
    
    if (bestChild) {
      // For row removal, include the full row information
      if (bestChild.move.type === 'remove-row') {  // Match the type we use in getRowRemovals
        return {
          type: 'remove-row',
          move: bestChild.move.start,
          destination: bestChild.move.end,
          row: bestChild.move.row,
          confidence: bestChild.node.visits / this.root.visits
        };
      }
      
      return {
        move: bestChild.move.start,
        destination: bestChild.move.end,
        confidence: bestChild.node.visits / this.root.visits
      };
    }
    
    return null;
  }

  getFallbackMove(board) {
    const validMoves = this.getLegalMoves(board);
    
    if (!validMoves || validMoves.length === 0) {
      return null;
    }
    
    // For ring movement, ensure start and end are different
    if (board.getGamePhase() === 'play' || board.getGamePhase() === 'move-ring') {  // Handle both 'play' and 'move-ring'
      const move = validMoves.find(m => 
        m.start && m.end && 
        (m.start[0] !== m.end[0] || m.start[1] !== m.end[1])
      );
      if (move) {
        return {
          move: move.start,
          destination: move.end,
          confidence: 0.5
        };
      }
    }
    
    if (board.getGamePhase() === 'remove-ring') {  // Changed from REMOVE_RING
      const scoredMoves = this.getRingRemovals(board);
      if (scoredMoves.length > 0) {
        const bestMove = scoredMoves[0];
        return {
          move: bestMove.start,
          destination: bestMove.end,
          confidence: 0.7
        };
      }
    }
    
    // Default case for other phases
    return {
      move: validMoves[0].start,
      destination: validMoves[0].end,
      confidence: 0.5
    };
  }

  // Add method to clear table between games
  clearTranspositionTable() {
    transpositionTable.clear();
  }

  getLegalMoves(board) {
    const gamePhase = board.getGamePhase();
    const currentPlayer = board.getCurrentPlayer();

    switch (gamePhase) {
      case 'setup':  // YinshBoard uses 'setup' for ring placement phase
        return this.getRingPlacements(board);

      case 'play':  // YinshBoard uses 'play' for main gameplay
        return this.getRingMoves(board);

      case 'remove-row':  // YinshBoard uses 'remove-row' for row removal
        return this.getRowRemovals(board);

      case 'remove-ring':  // YinshBoard uses 'remove-ring' for ring removal
        return this.getRingRemovals(board);

      case 'game-over':  // No moves in game over state
        return [];

      default:
        return [];
    }
  }

  getRingPlacements(board) {
    const moves = [];
    const points = YinshBoard.generateGridPoints();
    const boardState = board.getBoardState();

    for (const [q, r] of points) {
      if (!boardState[`${q},${r}`]) {
        moves.push({
          type: 'place-ring',
          start: null,
          end: [q, r]
        });
      }
    }
    return moves;
  }

  getMarkerPlacements(board) {
    const moves = [];
    const currentPlayer = board.getCurrentPlayer();
    const boardState = board.getBoardState();

    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type === 'ring' && piece.player === currentPlayer) {
        const pos = key.split(',').map(Number);
        moves.push({
          type: 'place-marker',
          start: pos,
          end: pos
        });
      }
    }
    return moves;
  }

  getRingMoves(board) {
    const moves = [];
    const currentPlayer = board.getCurrentPlayer();
    const boardState = board.getBoardState();

    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type === 'ring' && piece.player === currentPlayer) {
        const [q, r] = key.split(',').map(Number);
        const validDests = board.calculateValidMoves(q, r);
        for (const [endQ, endR] of validDests) {
          moves.push({
            type: 'move-ring',
            start: [q, r],
            end: [endQ, endR]
          });
        }
      }
    }
    return moves;
  }

  getRowRemovals(board) {
    const moves = [];
    const currentPlayer = board.getCurrentPlayer();
    const boardState = board.getBoardState();

    // Find all sequences of 5 or more markers
    // Scan both forward AND backward from each marker (like YinshBoard._findFullLine)
    // Use per-direction dedup to avoid missing rows when markers are visited cross-direction
    const directions = [[1, 0], [0, 1], [1, -1]];
    const seen = new Set(); // dedup by sorted marker keys

    for (const [startKey, piece] of Object.entries(boardState)) {
      if (piece.type !== 'marker' || piece.player !== currentPlayer) continue;
      const [startQ, startR] = startKey.split(',').map(Number);

      for (const [dq, dr] of directions) {
        // Scan forward
        let line = [[startQ, startR]];
        let q = startQ + dq;
        let r = startR + dr;
        while (true) {
          const key = `${q},${r}`;
          const nextPiece = boardState[key];
          if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== currentPlayer) break;
          line.push([q, r]);
          q += dq;
          r += dr;
        }

        // Scan backward
        q = startQ - dq;
        r = startR - dr;
        while (true) {
          const key = `${q},${r}`;
          const nextPiece = boardState[key];
          if (!nextPiece || nextPiece.type !== 'marker' || nextPiece.player !== currentPlayer) break;
          line.unshift([q, r]);
          q -= dq;
          r -= dr;
        }

        // If we found 5 or more in a row, add all possible 5-marker subsequences
        if (line.length >= 5) {
          for (let i = 0; i <= line.length - 5; i++) {
            const subSequence = line.slice(i, i + 5);
            const dedupKey = subSequence.map(([sq, sr]) => `${sq},${sr}`).sort().join('|');
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            moves.push({
              type: 'remove-row',
              start: subSequence[0],
              end: subSequence[subSequence.length - 1],
              row: subSequence
            });
          }
        }
      }
    }

    return moves;
  }

  getRingRemovals(board) {
    const moves = [];
    const currentPlayer = board.getCurrentPlayer();
    const boardState = board.getBoardState();

    // Helper to score ring position (prefer removing less valuable rings)
    const scoreRingPosition = (q, r) => {
      let score = 0;
      const distFromCenter = Math.abs(q) + Math.abs(r);

      // Prefer removing edge rings over central rings
      if (distFromCenter > 4) score += 3;
      else if (distFromCenter > 2) score += 1;
      else score -= 2;

      // Penalize removing rings near our own markers
      const directions = [[1,0], [1,-1], [0,-1], [-1,0], [-1,1], [0,1]];
      let nearMarkers = 0;

      for (const [dq, dr] of directions) {
        const testQ = q + dq;
        const testR = r + dr;
        const piece = boardState[`${testQ},${testR}`];
        if (piece?.type === 'marker' && piece.player === currentPlayer) {
          nearMarkers++;
        }
      }

      if (nearMarkers >= 2) score -= 3;
      return score;
    };

    // Get all removable rings with their scores
    const scoredRings = [];
    for (const [key, piece] of Object.entries(boardState)) {
      if (piece.type === 'ring' && piece.player === currentPlayer) {
        const [q, r] = key.split(',').map(Number);
        scoredRings.push({
          pos: [q, r],
          score: scoreRingPosition(q, r)
        });
      }
    }

    // Sort by score (highest first) and convert to moves
    scoredRings.sort((a, b) => b.score - a.score);
    return scoredRings.map(ring => ({
      type: 'remove-ring',  // Use hyphen for consistency
      start: ring.pos,
      end: ring.pos
    }));
  }

  // Removed duplicate evaluatePosition - using the comprehensive one at line 599

  _applyMove(board, move) {
    if (!move) return;

    // Use board's handleClick API for ALL moves to respect queue system
    const gamePhase = board.getGamePhase();

    if (gamePhase === 'setup') {
      // In setup phase, must first select a ring, then place it
      if (move.end) {
        const currentPlayer = board.getCurrentPlayer();
        const ringsPlaced = board.getRingsPlaced();
        // Select the next available ring for this player
        const ringIndex = ringsPlaced[currentPlayer] || 0;
        board.handleSetupRingClick(currentPlayer, ringIndex);
        // Now place it
        board.handleClick(move.end[0], move.end[1]);
      }
    } else if (gamePhase === 'play') {
      // In play phase, click start then end to move ring
      if (move.start && move.end) {
        board.handleClick(move.start[0], move.start[1]);
        board.handleClick(move.end[0], move.end[1]);
      }
    } else if (gamePhase === 'remove-row') {
      // In remove-row phase, click one of the row positions
      // The board will handle which row this selects
      if (move.row && move.row.length > 0) {
        const [q, r] = move.row[0];
        board.handleClick(q, r);
      }
    } else if (gamePhase === 'remove-ring') {
      // In remove-ring phase, click the ring to remove
      if (move.start) {
        board.handleClick(move.start[0], move.start[1]);
      }
    }
  }
}
