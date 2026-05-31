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
    openingStats,
    inOpening,
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
  if (openingStats) {
    const alts = (openingStats.alternatives || [])
      .map((a) => `${a.san} (${a.sharePct}%, scores ${a.scorePct}%)`)
      .join(', ');
    lines.push(
      `Master-game practice (Lichess): this move is the #${openingStats.rank} choice, ` +
        `played in ${openingStats.sharePct}% of master games (${openingStats.games} games), ` +
        `scoring ${openingStats.scorePct}% for the side to move.` +
        (alts ? ` Other popular moves here: ${alts}.` : '')
    );
  }

  const openingNote = openingStats
    ? '\n\nThis is an OPENING position with established theory. Do NOT call a recognized ' +
      'master move a mistake or inaccuracy — many moves are viable here. Describe how ' +
      'mainstream the move is using the master-game data, name the plans behind it, and ' +
      'mention the other popular choices so the student sees there is no single right path.'
    : inOpening
      ? '\n\nThis is an OPENING position. Openings have many sound, viable paths, so do NOT ' +
        'call a reasonable developing move a mistake or inaccuracy or imply there is one ' +
        'correct move. Name the opening if you can, explain the plan behind the move ' +
        '(center, development, king safety), and note that several choices are playable here.'
      : '';

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
    openingNote +
    `\n\nRespond in 2–4 sentences of plain, instructive prose. Refer to moves in standard algebraic notation.`
  );
}

// --- Threaded Q&A (tool-use) -------------------------------------------------
//
// A follow-up conversation about a move. The browser owns Stockfish, so the
// engine "tool" is executed client-side; this endpoint is a thin pass-through
// that forwards the conversation + tool schema to Claude and returns Claude's
// raw response (stop_reason + content). The client runs the agentic loop:
// when Claude asks for analyze_position, the client runs Stockfish and posts
// back a tool_result, until Claude returns a final answer.
//
// The analyze_position tool schema is duplicated here (the serverless function
// can't import from src/ in all setups). Keep in sync with
// src/games/chess/coach/analysisTools.js.
const ANALYZE_POSITION_TOOL = {
  name: 'analyze_position',
  description:
    'Run the Stockfish chess engine to get an objective evaluation and the best ' +
    'lines for a position related to the move being discussed. Use this whenever ' +
    'you need an evaluation, a best move, or a principal variation — including to ' +
    'check a "what if" idea. NEVER state an evaluation or concrete line you did ' +
    'not get from this tool.',
  input_schema: {
    type: 'object',
    properties: {
      from: { type: 'string', enum: ['before', 'after'] },
      moves: { type: 'array', items: { type: 'string' } },
      multipv: { type: 'number' },
    },
  },
};

function buildThreadSystem(context) {
  const c = context || {};
  const facts = [];
  if (c.fenBefore) facts.push(`Position before the move (FEN): ${c.fenBefore}`);
  if (c.fenAfter) facts.push(`Position after the move (FEN): ${c.fenAfter}`);
  if (c.movePlayed) facts.push(`Move played: ${c.movePlayed}`);
  if (c.classification) facts.push(`Engine classification: ${c.classification}`);
  if (c.evalBefore) facts.push(`Eval before (White POV): ${c.evalBefore}`);
  if (c.evalAfter) facts.push(`Eval after (White POV): ${c.evalAfter}`);
  if (c.bestMove) facts.push(`Engine's best move here: ${c.bestMove}`);
  if (c.opening) facts.push(`Opening: ${c.opening}`);
  if (c.commentary) facts.push(`Your earlier comment on this move: ${c.commentary}`);

  return (
    'You are a chess coach having a follow-up conversation about one move in the ' +
    "student's game. Be concise, friendly, and concrete.\n\n" +
    'CRITICAL RULE: You must not state any evaluation, best move, or concrete line ' +
    'unless you obtained it from the analyze_position tool in THIS conversation. ' +
    'To discuss any idea or "what if", call analyze_position (optionally with a ' +
    'moves line) and reason from its result. If you cannot or should not analyze ' +
    'something, say so rather than guessing. Refer to moves in standard algebraic ' +
    'notation.\n\nContext for the move under discussion:\n' +
    facts.join('\n')
  );
}

async function handleThread(req, res, body, apiKey) {
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: 'bad_request', message: 'Missing conversation messages.' });
    return;
  }

  const system = [
    { type: 'text', text: buildThreadSystem(body.context), cache_control: { type: 'ephemeral' } },
  ];

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model || DEFAULT_MODEL,
      max_tokens: 700,
      system,
      tools: [ANALYZE_POSITION_TOOL],
      messages,
    }),
  });

  if (!upstream.ok) {
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
  // Return the raw assistant turn so the client can run the tool loop.
  res.status(200).json({ stop_reason: data.stop_reason, content: data.content || [] });
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

    // Threaded Q&A path (tool-use) vs. the original single-shot commentary path.
    if (body.mode === 'thread') {
      await handleThread(req, res, body, apiKey);
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
