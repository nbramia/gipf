// Serverless Catan rules assistant — answers a player's questions about the
// ruleset/expansion of their current game, grounded in the live game context.
//
// Bring-your-own-key: the Anthropic API key arrives in the request body, is used
// for exactly one upstream call, and is never logged, persisted, or read from
// server env. There is no server-side fallback key. This mirrors the chess coach
// (api/chessCoach.js) and its BYO-key security model.

const ALLOWED_ORIGINS = ['https://gipf.vercel.app', 'http://localhost:3000'];
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildSystemPrompt(ctx = {}) {
  const modules = Array.isArray(ctx.modules) && ctx.modules.length
    ? ctx.modules.join(', ')
    : 'core base-game modules';
  return `You are an expert, friendly Catan rules teacher embedded in a digital Catan app. The player may be unfamiliar with the expansion they're playing and wants clear, accurate help.

The player's current game:
- Ruleset / expansion: ${ctx.rulesetName || 'Base Game'} (${ctx.edition || '3-4 players'}) — family: ${ctx.group || 'Core Game'}
- Scenario / map: ${ctx.scenarioName || 'Random Island'} on the ${ctx.mapName || 'Classic Island'}
- Players: ${ctx.players || 4}
- Victory target in this game: ${ctx.victoryTarget || 10} points
- Notable modules in this ruleset: ${modules}

Answer questions about how this ruleset/expansion works using the real published Catan rules. Explain unfamiliar mechanics plainly, with concrete examples. Be concise but complete. Never invent rules; if an obscure scenario detail is uncertain, say so.

Write for a small chat panel in plain text: no markdown headers or **bold**; use short paragraphs, and a simple "- " prefix if you need a short list.

Implementation note for THIS app: the playable engine is the base Catan rules engine (roads, settlements, cities, robber, development cards, bank/harbor trades, player-to-player trades, longest road, largest army) plus 5-6 player support. Expansion-specific special pieces and systems (ships, knights, city improvements, commodities, barbarians, exploration missions, gold fields, etc.) appear in the scenario catalog and the victory target is adapted, but their special mechanics are NOT simulated here. So when the question is about what the player can actually do in THIS game, distinguish (a) how the expansion works on the physical tabletop — explain it fully — from (b) what this digital version supports right now (base-game actions toward the ${ctx.victoryTarget || 10}-point target). Don't claim the app simulates a mechanic it doesn't.`;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const apiKey = body.apiKey;
    const messages = Array.isArray(body.messages) ? body.messages : null;

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({ error: 'missing_api_key', message: 'No API key provided.' });
      return;
    }
    if (!messages || messages.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'Missing messages.' });
      return;
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || DEFAULT_MODEL,
        max_tokens: 800,
        system: [
          {
            type: 'text',
            text: buildSystemPrompt(body.context),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: messages.slice(-16).map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
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
    const answer = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    res.status(200).json({ answer });
  } catch (err) {
    applyCors(req, res);
    res.status(500).json({ error: 'server_error', message: 'Failed to answer the question.' });
  }
}
