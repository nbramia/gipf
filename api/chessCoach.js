import { guardRequest } from '../server/publicSecurity.js';
import { requestKey } from '../server/accountKeys.js';
import { applyCors } from '../server/cors.js';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
// /api/chessCoach.js — Vercel serverless endpoint that turns structured
// Stockfish analysis into natural-language coaching prose via the Claude API.
//
// SECURITY MODEL: the Anthropic API key is BRING-YOUR-OWN. A guest's key
// arrives in the request body from that device; a signed-in player's is decrypted
// from their account on the server (server/accountKeys.js) and never reaches the
// browser. Either way it is used for exactly one upstream call and is NEVER logged
// or read from server env. There is intentionally no server-side key fallback, so a
// public deploy can never spend the maintainer's credits.
//
// CORS (server/cors.js) is applied in both the success and error paths, with
// OPTIONS preflight handled.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'; // fast + inexpensive for per-move use

// Whole-request deadline: vercel.json gives this function MAX_DURATION_MS. The
// upstream call gets whatever is left after the guard / key lookup that already
// ran, minus a margin so we can still answer before the platform kills us.
const MAX_DURATION_MS = 20000; // keep in sync with vercel.json
const DEADLINE_MARGIN_MS = 1500;
export function upstreamTimeoutMs(startedAt, now = Date.now()) {
  return MAX_DURATION_MS - DEADLINE_MARGIN_MS - (now - startedAt);
}
// When the budget is already spent there is no safe upstream call to make:
// fail as a timeout (-> 504) instead of scheduling past the platform deadline.
function upstreamSignal(startedAt) {
  const ms = upstreamTimeoutMs(startedAt);
  if (ms <= 0) throw Object.assign(new Error('deadline exhausted'), { name: 'TimeoutError' });
  return AbortSignal.timeout(ms);
}

const TIMEOUT_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
// True for an aborted / timed-out upstream call, including fetch's TypeError
// wrapper whose cause is the real timeout.
export function isTimeoutError(err, depth = 0) {
  if (!err || typeof err !== 'object' || depth > 3) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  if (typeof err.code === 'string' && TIMEOUT_CODES.has(err.code)) return true;
  return isTimeoutError(err.cause, depth + 1);
}

// Shared house style + legality rules for every coach reply.
const STYLE_RULES =
  'Write plain text with no markdown (no asterisks, no headings, no bullet syntax). ' +
  'Only name moves that appear in the supplied legal-move lists or in engine output you were given.';

// Untrusted client-supplied SAN list -> short, bounded, well-formed strings.
function cleanSanList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => typeof m === 'string' && /^[A-Za-z0-9+#=-]{2,10}$/.test(m))
    .slice(0, 120);
}

// Who made the move, relative to the human student.
function moverNote(mover, playerColor, sideToMove) {
  const colour = (c) => (c === 'b' ? 'Black' : 'White');
  const student = playerColor === 'w' || playerColor === 'b' ? colour(playerColor) : null;
  const opponent = student ? colour(playerColor === 'w' ? 'b' : 'w') : null;
  if (mover === 'engine') {
    return (
      `The student${student ? ` plays ${student}` : ''}. This move was made by the ENGINE OPPONENT` +
      `${opponent ? ` (${opponent})` : ''}, NOT by the student. Never say "you played" about it; ` +
      'call it "the opponent" or "the engine".'
    );
  }
  if (mover === 'user') {
    return `The student${student ? ` plays ${student}` : ''} and made this move themselves; address them as "you".`;
  }
  return `Side to move: ${colour(sideToMove)}.`;
}

const MATERIAL = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

// Fact line for what the move captured / promoted to. Enum values only; anything
// else is ignored. "Captured nothing" is claimed only when the SAN has no 'x', so
// an older client that never sent the field cannot cause a false statement.
function captureNote({ mover, playerColor, captured, promotion, san }) {
  const piece = MATERIAL.includes(captured) ? captured : null;
  const promo = MATERIAL.includes(promotion) ? promotion : null;
  const out = [];
  const sq = typeof san === 'string' ? (san.match(/x([a-h][1-8])/) || [])[1] : null;
  if (piece) {
    const owner =
      mover === 'engine' ? "the student's" : mover === 'user' ? "the engine's" : "the opponent's";
    out.push(`This move captured ${owner} ${piece}${sq ? ` on ${sq}` : ''}.`);
  } else if (typeof san === 'string' && san && !san.includes('x')) {
    out.push('This move captured nothing.');
  }
  if (promo) out.push(`The pawn promoted to a ${promo}.`);
  return out.join(' ');
}

// Build the coaching prompt from engine-grounded facts only.
export function buildPrompt(body) {
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
    weaknessProfile,
    theme,
    stage,
    hint,
    refutationPv,
    mateBudget,
    mover,
    playerColor,
    captured,
    promotion,
    legalMoves,
    legalMovesAfter,
  } = body;

  const lines = [];
  lines.push(`Position (FEN): ${fen}`);
  lines.push(`Side to move at this point: ${sideToMove === 'b' ? 'Black' : 'White'}`);
  if (mover === 'engine' || mover === 'user') lines.push(moverNote(mover, playerColor, sideToMove));
  if (movePlayed) lines.push(`Move played: ${movePlayed.san || movePlayed}`);
  if (movePlayed) {
    const note = captureNote({ mover, playerColor, captured, promotion, san: movePlayed.san || movePlayed });
    if (note) lines.push(note);
  }
  if (typeof evalBefore === 'string') lines.push(`Eval before (White POV): ${evalBefore}`);
  if (typeof evalAfter === 'string') lines.push(`Eval after (White POV): ${evalAfter}`);
  if (classification) {
    lines.push(
      `Engine classification of the move: ${classification}. Your prose MUST agree with this label ` +
        '(do not call a "mistake" or "blunder" fine, or a "best"/"excellent" move bad).'
    );
  }
  const legalBefore = cleanSanList(legalMoves);
  const legalAfter = cleanSanList(legalMovesAfter);
  if (legalBefore.length) lines.push(`Legal moves in the position above (before the move): ${legalBefore.join(' ')}`);
  if (legalAfter.length) lines.push(`Legal moves in the position after the move: ${legalAfter.join(' ')}`);
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
  // Puzzle coaching: the model only ever receives what it may reveal.
  if (theme && (kind === 'puzzle-hint' || kind === 'puzzle-fail')) {
    lines.push(`Puzzle theme: ${theme}`);
  }
  if (kind === 'puzzle-hint' && hint) {
    lines.push(`Allowed hint content (stage ${stage || 1}): ${hint}`);
  }
  if (kind === 'puzzle-fail' && Array.isArray(refutationPv) && refutationPv.length) {
    lines.push(`Engine refutation of the played move: ${refutationPv.join(' ')}`);
  }
  if (kind === 'puzzle-fail' && mateBudget) {
    lines.push('The puzzle requires checkmate within a set number of moves. The played move does not mate within that limit; do NOT say the win is lost or the chance is gone.');
  }
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

  const hardNegative = ['inaccuracy', 'mistake', 'blunder'].includes(classification);
  const openingNote = hardNegative
    ? ''
    : openingStats
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
      ? "Evaluate the human player's move (addressing the student as \"you\") as a friendly coach: name the quality, explain what they may have missed, and give the stronger move and its idea. Be encouraging but honest."
      : kind === 'puzzle-hint'
        ? 'The student asked for a hint in a tactics puzzle. Rephrase the allowed hint content as one short, encouraging sentence. You MUST NOT name any move, piece, or square that is not already in the allowed hint content — under no circumstances reveal the solution.'
        : kind === 'puzzle-fail'
          ? "The student's move failed a tactics puzzle. Using ONLY the engine refutation line given, explain in one or two sentences why the move falls short, then point them back to the puzzle theme. Do NOT reveal, name, or guess the correct move."
          : "Explain, for the student, the move their engine opponent just played (refer to it as \"the opponent\" or \"the engine\", never as the student's move): what it does, which other moves the engine considered (use the candidates above), and what the student should watch for next.";

  const goalNote = learningGoal
    ? `\n\nThe student told you they want to focus on: "${learningGoal}". Tailor your explanation toward that goal when relevant.`
    : '';

  const weaknessNote = weaknessProfile
    ? `\n\nThe student's recurring weaknesses from recent games: ${weaknessProfile} When this move fits one of those patterns, point out the connection.`
    : '';

  return (
    `${task}\n\n` +
    `Here is the engine analysis — use ONLY these facts. Do NOT invent moves, lines, or evaluations beyond what is given.\n\n` +
    lines.join('\n') +
    goalNote +
    weaknessNote +
    openingNote +
    `\n\nRespond in 2–4 sentences of plain, instructive prose. Refer to moves in standard algebraic notation. ${STYLE_RULES}`
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

// Mirror the browser tool schema, as for analyze_position above.
const QUERY_OPENINGS_TOOL = {
  name: 'query_openings',
  description:
    'Look up how often strong human players (Lichess masters database) have ' +
    'played each move in a position, with their win/draw/loss rates. Use this for ' +
    'opening questions about what is popular, mainstream, or theory — i.e. what ' +
    'humans actually play — as opposed to the objective engine evaluation from ' +
    'analyze_position. Only works in opening/known positions; returns an error ' +
    'if there is no master data or no Lichess token. NEVER invent popularity ' +
    'percentages or move counts you did not get from this tool.',
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        enum: ['before', 'after'],
        description:
          "Which position to query: 'before' = the position the player faced for " +
          "this move; 'after' = the position after the move. Defaults to 'before'.",
      },
      moves: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional sequence of moves (SAN or UCI) to play from the chosen position ' +
          'before querying, to ask about a specific resulting position.',
      },
    },
  },
};

export function buildThreadSystem(context) {
  const c = context || {};
  const facts = [];
  if (c.fenBefore) facts.push(`Position before the move (FEN): ${c.fenBefore}`);
  if (c.fenAfter) facts.push(`Position after the move (FEN): ${c.fenAfter}`);
  if (c.mover === 'engine' || c.mover === 'user') facts.push(moverNote(c.mover, c.playerColor, undefined));
  if (c.movePlayed) {
    facts.push(`Move played: ${c.movePlayed}`);
    const note = captureNote({ mover: c.mover, playerColor: c.playerColor, captured: c.captured, promotion: c.promotion, san: c.movePlayed });
    if (note) facts.push(note);
  }
  const legalBefore = cleanSanList(c.legalMoves);
  const legalAfter = cleanSanList(c.legalMovesAfter);
  if (legalBefore.length) facts.push(`Legal moves before the move: ${legalBefore.join(' ')}`);
  if (legalAfter.length) facts.push(`Legal moves after the move: ${legalAfter.join(' ')}`);
  const nextMoves = cleanSanList(c.movedPieceNextMoves);
  if (nextMoves.length) {
    facts.push(
      `If the side that just moved were to move again, the moved piece could go: ${nextMoves.join(' ')}. ` +
        'Use this for "where can it retreat / go next" questions; never name a destination not listed.'
    );
  }
  if (c.classification) facts.push(`Engine classification: ${c.classification}`);
  if (c.evalBefore) facts.push(`Eval before (White POV): ${c.evalBefore}`);
  if (c.evalAfter) facts.push(`Eval after (White POV): ${c.evalAfter}`);
  if (c.bestMove) facts.push(`Engine's best move here: ${c.bestMove}`);
  if (c.opening) facts.push(`Opening: ${c.opening}`);
  if (c.commentary) facts.push(`Your earlier comment on this move: ${c.commentary}`);

  return (
    'You are a chess coach having a follow-up conversation about one move in the ' +
    "student's game. Be concise, friendly, and concrete.\n\n" +
    'You have two tools. analyze_position runs Stockfish for the objective ' +
    'evaluation / best line of a position. query_openings looks up the Lichess ' +
    'masters database for how often strong humans play each move and their ' +
    'scores — use it for "what do people actually play / what is popular / is ' +
    'this theory" questions.\n\n' +
    'CRITICAL RULE: You must not state any evaluation, best move, concrete line, ' +
    'or opening-popularity statistic unless you obtained it from a tool in THIS ' +
    'conversation. To discuss any idea or "what if", call the appropriate tool and ' +
    'reason from its result. If a tool returns an error or you cannot get the data, ' +
    'say so rather than guessing. Refer to moves in standard algebraic ' +
    'notation. When suggesting a move for one of the two anchor positions, pick only ' +
    'from that position\'s legal-move list below; for deeper lines use only moves from ' +
    'tool output. The "Engine classification" label is authoritative: keep your wording ' +
    `consistent with it. ${STYLE_RULES}\n\nContext for the move under discussion:\n` +
    facts.join('\n')
  );
}

async function handleThread(req, res, body, apiKey, startedAt) {
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: 'bad_request', message: 'Missing conversation messages.' });
    return;
  }

  const system = [
    { type: 'text', text: buildThreadSystem(body.context), cache_control: { type: 'ephemeral' } },
  ];

  const upstream = await fetch(ANTHROPIC_URL, {
    signal: upstreamSignal(startedAt),
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
      tools: [ANALYZE_POSITION_TOOL, QUERY_OPENINGS_TOOL],
      messages,
    }),
  });

  if (!upstream.ok) {
    const status = upstream.status === 401 ? 401 : 502;
    let detail = 'Upstream error.';
    try {
      await upstream.json();
      detail = 'Model provider rejected the request.';
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

// The Lichess masters explorer for a signed-in player: the request carries only the
// position, and the account's Lichess token is added here, so it never reaches the
// browser. Guests query Lichess directly with their device-only token.
const EXPLORER_URL = 'https://explorer.lichess.ovh/masters';
const FEN_RE = /^[A-Za-z0-9/ -]{10,100}$/;
async function handleExplorer(req, res, body, startedAt) {
  if (typeof body.fen !== 'string' || !FEN_RE.test(body.fen)) {
    res.status(400).json({ error: 'bad_request', message: 'Missing position.' });
    return;
  }
  const token = await requestKey(req, res, {}, 'lichess', 'token');
  if (!token) return;
  const upstream = await fetch(`${EXPLORER_URL}?fen=${encodeURIComponent(body.fen)}&moves=12&topGames=0`, {
    signal: upstreamSignal(startedAt),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!upstream.ok) {
    res.status(502).json({ error: 'upstream_error', status: upstream.status });
    return;
  }
  res.status(200).json(await upstream.json());
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const explorer = req.body && typeof req.body === 'object' && req.body.mode === 'explorer';
  if (req.method === 'POST' && !await guardRequest(req, res, explorer ? { bucket: 'explorer', limit: 60 } : { bucket: 'ai', limit: 30 })) return;
  res.setHeader('Cache-Control', 'no-store');
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
    if (body.mode === 'explorer') {
      await handleExplorer(req, res, body, startedAt);
      return;
    }
    // A guest's key is in the body; a signed-in player's is read from the account.
    const apiKey = await requestKey(req, res, body, 'anthropic', 'apiKey');
    if (!apiKey) return;

    // Threaded Q&A path (tool-use) vs. the original single-shot commentary path.
    if (body.mode === 'thread') {
      await handleThread(req, res, body, apiKey, startedAt);
      return;
    }

    if (!body.fen) {
      res.status(400).json({ error: 'bad_request', message: 'Missing position.' });
      return;
    }

    const prompt = buildPrompt(body);

    const upstream = await fetch(ANTHROPIC_URL, {
    signal: upstreamSignal(startedAt),
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
        await upstream.json();
        detail = 'Model provider rejected the request.';
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
    if (isTimeoutError(err)) {
      res.status(504).json({ error: 'upstream_timeout', message: 'The model took too long to respond.' });
      return;
    }
    res.status(500).json({ error: 'server_error', message: 'Failed to generate commentary.' });
  }
}
