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

export default async function handler(req, res) {
  try {
    // CORS headers - Set these FIRST before anything else
    res.setHeader('Access-Control-Allow-Credentials', true);
    const allowedOrigins = [
      'http://localhost:3000',
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

      const { boardState, gamePhase, currentPlayer } = req.body;
      const board = new YinshBoard();
      board.deserialize({ boardState, gamePhase, currentPlayer });

      // Check main cache
      const stateHash = board.getStateHash();
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

        const iterationResult = mcts.runIteration(boardClone);
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
        result = mcts.getFallbackMove(board);
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