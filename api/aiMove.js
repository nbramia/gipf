import YinshBoard from '../src/games/yinsh/YinshBoard.js';
import { guardRequest } from '../server/publicSecurity.js';
import { calculateYinshMove } from '../server/yinshCalculation.js';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
const stateCache = new Map();
const CACHE_SIZE_LIMIT = 15000;
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://gipf.vercel.app',
  'https://yinsh.vercel.app',
  'https://yinsh-nathan-ramias-projects.vercel.app',
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Credentials', true);
  if (ALLOWED_ORIGINS.includes(req.headers?.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await guardRequest(req, res, { bucket: 'ai', limit: 30, maxBytes: 32768 })) return;
  try {
    const { boardState, gamePhase, currentPlayer } = req.body;
    const board = new YinshBoard();
    board.deserialize({ boardState, gamePhase, currentPlayer });
    const stateHash = board.getStateHash();
    if (stateCache.has(stateHash)) return res.json(stateCache.get(stateHash));
    const result = await calculateYinshMove({ boardState, gamePhase, currentPlayer });
    // Both old caches held the same best result above 0.6; retain one bounded cache.
    if (result && result.confidence > 0.6) {
      if (stateCache.size >= CACHE_SIZE_LIMIT) stateCache.delete(stateCache.keys().next().value);
      stateCache.set(stateHash, result);
    }
    return res.json(result);
  } catch (_) {
    return res.status(500).json({ error: 'Unable to calculate move' });
  }
}
