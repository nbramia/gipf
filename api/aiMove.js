import MCTS from '../src/games/yinsh/engine/mcts.js';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';

// Cache configurations
const stateCache = new Map();
const intermediateCache = new Map();
const boardClonePool = new WeakMap();

// Configuration - Conservative settings for Vercel
const MAX_TIME_MS = 2500;  // Reduced to ensure completion within Vercel limits
const MIN_SIMULATIONS = 30;  // Reduced for faster response
const CACHE_SIZE_LIMIT = 15000;
const CONFIDENCE_THRESHOLD = 0.75;  // Lower threshold for earlier exit

const SNAPSHOT_FIELDS = Object.keys(new YinshBoard().serializeState());
const CORE_FIELDS = ['boardState', 'gamePhase', 'currentPlayer'];
const BOARD_POINTS = new Set(YinshBoard.generateGridPoints().map(point => point.join(',')));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPlayer = value => value === 1 || value === 2;
const isPoint = value => Array.isArray(value) && value.length === 2 &&
  value.every(Number.isInteger) && BOARD_POINTS.has(value.join(','));

class InvalidSnapshot extends Error {}
function requireSnapshot(condition, message) {
  if (!condition) throw new InvalidSnapshot(message);
}

function restoreRequestBoard(body) {
  requireSnapshot(isObject(body), 'Request body must be a board snapshot object');
  requireSnapshot(isObject(body.boardState), 'boardState must be a coordinate-to-piece object');
  requireSnapshot(['setup', 'play', 'remove-row', 'remove-ring', 'game-over'].includes(body.gamePhase),
    'Invalid gamePhase');
  requireSnapshot(isPlayer(body.currentPlayer), 'currentPlayer must be 1 or 2');
  const counts = { 1: 0, 2: 0 };
  for (const [key, piece] of Object.entries(body.boardState)) {
    requireSnapshot(BOARD_POINTS.has(key) && isObject(piece) &&
      ['ring', 'marker'].includes(piece.type) && isPlayer(piece.player), `Invalid board piece at ${key}`);
    if (piece.type === 'ring') counts[piece.player]++;
  }
  requireSnapshot(counts[1] <= 5 && counts[2] <= 5, 'Too many rings on board');

  const missing = SNAPSHOT_FIELDS.filter(field => !Object.hasOwn(body, field));
  let snapshot = body;
  if (missing.length) {
    const minimal = !SNAPSHOT_FIELDS.some(field => !CORE_FIELDS.includes(field) && Object.hasOwn(body, field));
    requireSnapshot(minimal && ['setup', 'play'].includes(body.gamePhase),
      `Incomplete canonical snapshot; missing: ${missing.join(', ')}`);
    // Only these legacy states have unambiguous zero scores and no deferred turn.
    if (body.gamePhase === 'setup') {
      requireSnapshot(Object.values(body.boardState).every(piece => piece.type === 'ring') &&
        counts[1] + counts[2] < 10 &&
        (body.currentPlayer === 1 ? counts[1] === counts[2] : counts[1] === counts[2] + 1),
      'Legacy setup must contain only alternating ring placements');
    } else {
      requireSnapshot(counts[1] === 5 && counts[2] === 5,
        'Legacy play requires five rings per player; send a full snapshot for scored positions');
    }
    snapshot = { ...new YinshBoard().serializeState(), ...body, ringsPlaced: counts };
  }

  for (const [field, max] of [['ringsPlaced', 5], ['scores', 3]]) {
    requireSnapshot(isObject(snapshot[field]) && Object.keys(snapshot[field]).length === 2 &&
      [1, 2].every(player => Number.isInteger(snapshot[field][player]) &&
        snapshot[field][player] >= 0 && snapshot[field][player] <= max),
    `${field} must contain integer player 1 and 2 values between 0 and ${max}`);
  }
  requireSnapshot(snapshot.selectedRing === null || isPoint(snapshot.selectedRing), 'Invalid selectedRing');
  requireSnapshot(Array.isArray(snapshot.validMoves) && snapshot.validMoves.every(isPoint), 'Invalid validMoves');
  const validRow = row => isObject(row) && isPlayer(row.player) && Array.isArray(row.markers) &&
    row.markers.length === 5 && row.markers.every(isPoint) &&
    new Set(row.markers.map(point => point.join(','))).size === 5;
  requireSnapshot(Array.isArray(snapshot.rows) && snapshot.rows.every(validRow), 'Invalid rows');
  requireSnapshot(Array.isArray(snapshot.rowResolutionQueue) && snapshot.rowResolutionQueue.every(entry =>
    isObject(entry) && isPlayer(entry.player) && Array.isArray(entry.rows) &&
    entry.rows.every(row => validRow(row) && row.player === entry.player)), 'Invalid rowResolutionQueue');
  requireSnapshot(snapshot.nextTurnPlayer === null || isPlayer(snapshot.nextTurnPlayer), 'Invalid nextTurnPlayer');
  requireSnapshot(typeof snapshot.pendingRowsAfterRingRemoval === 'boolean', 'Invalid pendingRowsAfterRingRemoval');
  requireSnapshot(snapshot.winner === null || isPlayer(snapshot.winner), 'Invalid winner');
  requireSnapshot(snapshot.gamePhase === 'game-over'
    ? isPlayer(snapshot.winner) && snapshot.scores[snapshot.winner] === 3
    : snapshot.winner === null && snapshot.scores[1] < 3 && snapshot.scores[2] < 3,
  'winner and scores must agree with gamePhase');
  requireSnapshot(snapshot.selectedSetupRing === null || (isObject(snapshot.selectedSetupRing) &&
    isPlayer(snapshot.selectedSetupRing.player) && Number.isInteger(snapshot.selectedSetupRing.index) &&
    snapshot.selectedSetupRing.index >= 0 && snapshot.selectedSetupRing.index < 5), 'Invalid selectedSetupRing');
  if (['remove-row', 'remove-ring'].includes(snapshot.gamePhase)) {
    requireSnapshot(isPlayer(snapshot.nextTurnPlayer), 'Resolution requires an explicit nextTurnPlayer');
    requireSnapshot(counts[snapshot.currentPlayer] > 0, 'Resolution player must have a ring to score');
    if (snapshot.gamePhase === 'remove-row') {
      requireSnapshot(snapshot.rows.some(row => row.player === snapshot.currentPlayer),
        'remove-row requires current-player rows');
    }
  }

  const board = YinshBoard.fromSerializedState(snapshot);
  const liveRows = board.checkForRows();
  const rowKey = row => `${row.player}:${row.markers.map(point => point.join(',')).sort().join(';')}`;
  const liveRowKeys = new Set(liveRows.map(rowKey));
  requireSnapshot([...snapshot.rows, ...snapshot.rowResolutionQueue.flatMap(entry => entry.rows)]
    .every(row => liveRowKeys.has(rowKey(row))), 'Resolution rows must match live marker rows');
  if (missing.length && body.gamePhase === 'play') {
    requireSnapshot(liveRows.length === 0,
      'Legacy play contains unresolved rows; send a full resolution snapshot');
  }
  return board;
}

// Include every canonical field; object key order must not affect cache identity.
function cacheKey(value) {
  if (Array.isArray(value)) return `[${value.map(cacheKey).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${cacheKey(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export default async function handler(req, res) {
  try {
    // CORS headers - Set these FIRST before anything else
    res.setHeader('Access-Control-Allow-Credentials', true);
    const allowedOrigins = [
      'http://localhost:3000',
      'https://gipf.vercel.app',
      'https://yinsh.vercel.app',
      'https://yinsh-nathan-ramias-projects.vercel.app'
    ];

    // Always set CORS header if origin is allowed
    const origin = req.headers.origin;
    console.log('Request origin:', origin);

    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      console.warn('Origin not allowed:', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
      console.log('OPTIONS request received');
      return res.status(200).end();
    }

  if (req.method === 'POST') {
    try {
      const startTime = Date.now();
      console.log('Starting AI calculation');

      const board = restoreRequestBoard(req.body);

      // Check main cache
      const stateHash = cacheKey(board.serializeState());
      if (stateCache.has(stateHash)) {
        console.log('Cache hit!');
        return res.json(stateCache.get(stateHash));
      }

      // Check intermediate cache
      const cachedResult = intermediateCache.get(stateHash);
      if (cachedResult) {
        console.log('Using cached intermediate result');
        return res.json(cachedResult);
      }

      const mcts = new MCTS();
      let result = null;
      let simulationCount = 0;

      // Dynamic simulation count based on board complexity
      const complexity = board.getComplexityLevel?.() || 1;
      const MAX_SIMULATIONS = Math.min(500, Math.max(100, complexity * 50));
      
      while (simulationCount < MAX_SIMULATIONS) {
        const currentTime = Date.now() - startTime;
        if (simulationCount >= MIN_SIMULATIONS && currentTime > MAX_TIME_MS) {
          console.log(`Time limit reached after ${currentTime}ms`);
          break;
        }

        // Get cached clone or create new one
        let boardClone = boardClonePool.get(board);
        if (!boardClone) {
          boardClone = board.clone();
          boardClonePool.set(board, boardClone);
        }

        const iterationResult = await mcts.runIteration(boardClone);
        if (!iterationResult) break;

        simulationCount++;
        
        // Update best result
        if (!result || iterationResult.confidence > result.confidence) {
          result = iterationResult;
          
          // Cache intermediate results
          if (result.confidence > 0.6) {
            intermediateCache.set(stateHash, result);
          }

          // Exit early if we find a very good move
          if (result.confidence >= CONFIDENCE_THRESHOLD) {
            console.log('High-confidence move found, exiting early');
            break;
          }
        }

        if (simulationCount % 10 === 0) {
          console.log(`${simulationCount} simulations, confidence: ${result?.confidence}`);
        }
      }

      // Fallback to simple heuristic if no good move found
      if (!result || result.confidence < 0.3) {
        console.log('Using fallback move selection');
        result = await mcts.getFallbackMove(board);
      }

      // Cache final result if good enough
      if (result && result.confidence > 0.6) {
        if (stateCache.size >= CACHE_SIZE_LIMIT) {
          const oldestKey = stateCache.keys().next().value;
          stateCache.delete(oldestKey);
        }
        stateCache.set(stateHash, result);
      }

      const totalTime = Date.now() - startTime;
      console.log(`Completed ${simulationCount} simulations in ${totalTime}ms`);
      
      return res.json(result);

    } catch (error) {
      if (error instanceof InvalidSnapshot) {
        return res.status(400).json({ error: 'Invalid board snapshot', message: error.message });
      }
      console.error('Error in AI move calculation:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    // Outer error handler - catches CORS setup errors
    console.error('Critical error in handler:', error);
    console.error('Error stack:', error.stack);

    // Try to set CORS headers even in error case
    try {
      const origin = req.headers?.origin;
      const allowedOrigins = [
        'http://localhost:3000',
        'https://gipf.vercel.app',
        'https://yinsh.vercel.app',
        'https://yinsh-nathan-ramias-projects.vercel.app'
      ];
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } catch (e) {
      console.error('Failed to set CORS headers in error handler:', e);
    }

    return res.status(500).json({
      error: 'Critical server error',
      message: error.message
    });
  }
}
