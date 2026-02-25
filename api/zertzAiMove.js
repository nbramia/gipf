// Serverless API endpoint for Zertz AI move computation
// Heuristic-only (no NN in serverless environment)

import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
import { MCTS } from '../src/games/zertz/engine/mcts.js';

const ALLOWED_ORIGINS = [
  'https://gipf.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const cors = getCorsHeaders(origin);

  // Set CORS headers
  for (const [key, value] of Object.entries(cors)) {
    res.setHeader(key, value);
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { boardState, simulations = 200 } = req.body;

    if (!boardState) {
      res.status(400).json({ error: 'Missing boardState' });
      return;
    }

    // Clamp simulations
    const sims = Math.min(Math.max(simulations, 50), 500);

    // Reconstruct board and compute move
    const board = ZertzBoard.fromSerializedState(boardState);
    const mcts = new MCTS({ evaluationMode: 'heuristic' });
    const move = await mcts.getBestMove(board, sims);

    res.status(200).json({
      success: true,
      move,
      stats: {
        simulations: sims,
        phase: board.gamePhase,
        evaluationMode: 'heuristic',
      },
    });
  } catch (err) {
    console.error('AI move error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
