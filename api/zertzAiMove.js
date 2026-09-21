import { Worker } from 'node:worker_threads';
import { guardRequest } from '../server/publicSecurity.js';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
// Serverless API endpoint for Zertz AI move computation
// Heuristic-only (no NN in serverless environment)


function calculate(boardState, simulations) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../server/zertzWorker.js', import.meta.url), { workerData: { boardState, simulations } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('timeout')); }, 3000);
    worker.once('message', result => { clearTimeout(timer); worker.terminate(); resolve(result); });
    worker.once('error', () => { clearTimeout(timer); worker.terminate(); reject(new Error('calculation_failed')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('calculation_failed')); });
  });
}

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

  if (!await guardRequest(req, res, { bucket: 'ai', limit: 30 })) return;
  try {
    const { boardState, simulations = 200 } = req.body;

    if (!boardState) {
      res.status(400).json({ error: 'Missing boardState' });
      return;
    }

    // Clamp simulations
    const sims = Number.isFinite(simulations) ? Math.min(Math.max(simulations, 50), 200) : 50;

    // Reconstruct board and compute move
    const { move, phase } = await calculate(boardState, sims);

    res.status(200).json({
      success: true,
      move,
      stats: {
        simulations: sims,
        phase,
        evaluationMode: 'heuristic',
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Unable to calculate move',
    });
  }
}
