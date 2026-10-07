import { guardRequest } from '../server/publicSecurity.js';
import { requestKey } from '../server/accountKeys.js';
import { applyCors } from '../server/cors.js';
import { isUpstreamTimeout, upstreamBudgetMs } from '../server/upstreamDeadline.js';
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
// Serverless Splendor rules assistant — answers a player's questions about the
// game, grounded in the live game context.
//
// Bring-your-own-key: a guest's Anthropic key arrives in the request body; a
// signed-in player's is decrypted from their account on the server
// (server/accountKeys.js). Either way it is used for exactly one upstream call and
// is never logged or read from server env. There is no server-side fallback key.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function buildSystemPrompt(ctx = {}) {
  return `You are an expert, friendly Splendor rules teacher embedded in a digital Splendor app. The player wants clear, accurate help with the rules and basic strategy.

The player's current game:
- Game: ${ctx.game || 'Splendor'} — ${ctx.edition || 'Base game (2-4 players)'}
- Players: ${ctx.playerCount || 4}
- Victory target: ${ctx.victoryTarget || 15} prestige points

Answer questions using the real published Splendor rules. The base game in brief: on your turn you take exactly ONE action — (1) take 3 gem tokens of different colors, (2) take 2 tokens of the same color (only if that pile has at least 4), (3) reserve a development card (from the board or blindly from the top of a deck) and take 1 gold/joker if available, or (4) purchase a development card from the board or your reserve, paying its cost (gold is wild; card bonuses act as permanent discounts). You may hold at most 3 reserved cards and at most 10 tokens at the end of your turn (return the excess). Development cards give a permanent gem bonus and sometimes prestige. At the end of your turn, if your bonuses meet a noble's requirement you receive that noble (3 prestige); if several qualify you pick one. The first player to reach 15 prestige triggers the final round so everyone gets the same number of turns; most prestige wins, ties broken by fewest development cards.

Explain mechanics plainly with concrete examples. Be concise but complete. Never invent rules; if something is genuinely ambiguous, say so.

Write for a small chat panel in plain text: no markdown headers or **bold**; use short paragraphs, and a simple "- " prefix if you need a short list.

Implementation note for THIS app: it implements base-game Splendor only — it does NOT include the Cities of Splendor expansions (Cities, Strongholds, Trading Posts, The Orient) or the two-player Splendor Duel. If asked about those, you may explain how they work on the tabletop, but make clear this app does not simulate them.`;
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method === 'POST' && !await guardRequest(req, res, { bucket: 'ai', limit: 30 })) return;
  res.setHeader('Cache-Control', 'no-store');
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
    // A guest's key is in the body; a signed-in player's is read from the account.
    const apiKey = await requestKey(req, res, body, 'anthropic', 'apiKey');
    if (!apiKey) return;
    const messages = Array.isArray(body.messages) ? body.messages : null;

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'Missing messages.' });
      return;
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      signal: AbortSignal.timeout(upstreamBudgetMs({ startedAt, now: Date.now() })),
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
        await upstream.json();
        detail = 'Model provider rejected the request.';
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
    if (isUpstreamTimeout(err)) {
      res.status(504).json({ error: 'upstream_timeout', message: 'The model took too long to reply.' });
      return;
    }
    res.status(500).json({ error: 'server_error', message: 'Failed to answer the question.' });
  }
}
