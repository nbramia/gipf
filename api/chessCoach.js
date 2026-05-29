// /api/chessCoach.js — Vercel serverless endpoint that turns structured
// Stockfish analysis into natural-language coaching prose via the Claude API.
//
// SECURITY MODEL (issue #6): the Anthropic API key is BRING-YOUR-OWN. It arrives
// in the request body (sent by the user's browser, where it lives only in
// localStorage), is used for exactly one upstream call, and is NEVER logged,
// persisted, or read from server env. There is intentionally no server-side key
// fallback, so a public deploy can never spend the maintainer's credits.
//
// CORS mirrors api/aiMove.js: an allowlist applied in BOTH the success and error
// paths, with OPTIONS preflight handled.

const ALLOWED_ORIGINS = ['https://gipf.vercel.app', 'http://localhost:3000'];

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'; // fast + inexpensive for per-move use

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Build the coaching prompt from engine-grounded facts only.
function buildPrompt(body) {
  const {
    kind, // 'ai-move' | 'player-move'
    fen,
    sideToMove,
    movePlayed,
    evalBefore,
    evalAfter,
    candidates = [],
    classification,
    bestMove,
    learningGoal,
    opening,
    leftBook,
  } = body;

  const lines = [];
  lines.push(`Position (FEN): ${fen}`);
  lines.push(`Side to move at this point: ${sideToMove === 'b' ? 'Black' : 'White'}`);
  if (movePlayed) lines.push(`Move played: ${movePlayed.san || movePlayed}`);
  if (typeof evalBefore === 'string') lines.push(`Eval before (White POV): ${evalBefore}`);
  if (typeof evalAfter === 'string') lines.push(`Eval after (White POV): ${evalAfter}`);
  if (classification) lines.push(`Engine classification of the move: ${classification}`);
  if (bestMove) {
    lines.push(`Engine's best move here: ${bestMove.san} (eval ${bestMove.eval}), line: ${(bestMove.pv || []).join(' ')}`);
  }
  if (candidates.length) {
    lines.push('Engine candidate moves (MultiPV), strongest first:');
    candidates.forEach((c, i) => {
      lines.push(`  ${i + 1}. ${c.san} — eval ${c.eval}${c.pv ? `, line ${c.pv.join(' ')}` : ''}`);
    });
  }
  if (opening) lines.push(`Opening: ${opening}${leftBook ? ' (this move leaves known theory)' : ''}`);

  const task =
    kind === 'player-move'
      ? "Evaluate the human player's move as a friendly coach: name the quality, explain what they may have missed, and give the stronger move and its idea. Be encouraging but honest."
      : "Explain the move you (the engine) just played: why it's good, which other moves you considered (use the candidates above), and why you chose this one over them.";

  const goalNote = learningGoal
    ? `\n\nThe student told you they want to focus on: "${learningGoal}". Tailor your explanation toward that goal when relevant.`
    : '';

  return (
    `${task}\n\n` +
    `Here is the engine analysis — use ONLY these facts. Do NOT invent moves, lines, or evaluations beyond what is given.\n\n` +
    lines.join('\n') +
    goalNote +
    `\n\nRespond in 2–4 sentences of plain, instructive prose. Refer to moves in standard algebraic notation.`
  );
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const apiKey = body.apiKey;

    if (!apiKey || typeof apiKey !== 'string') {
      // 401 (not 500) so the client knows to prompt for a key and use the
      // local templated fallback instead.
      res.status(401).json({ error: 'missing_api_key', message: 'No API key provided.' });
      return;
    }
    if (!body.fen) {
      res.status(400).json({ error: 'bad_request', message: 'Missing position.' });
      return;
    }

    const prompt = buildPrompt(body);

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || DEFAULT_MODEL,
        max_tokens: 320,
        system:
          'You are a concise, encouraging chess coach. You explain moves using only the engine analysis you are given. You never fabricate moves, lines, or evaluations. Keep it short and instructive.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!upstream.ok) {
      // Surface auth/rate issues clearly without echoing the key.
      const status = upstream.status === 401 ? 401 : 502;
      let detail = 'Upstream error.';
      try {
        const j = await upstream.json();
        detail = (j && j.error && j.error.message) || detail;
      } catch (_) {
        /* ignore */
      }
      res.status(status).json({ error: 'upstream_error', message: detail });
      return;
    }

    const data = await upstream.json();
    const commentary = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    res.status(200).json({ commentary });
  } catch (err) {
    // Never include the request body (which holds the key) in error output.
    applyCors(req, res);
    res.status(500).json({ error: 'server_error', message: 'Failed to generate commentary.' });
  }
}
