# Diplomacy

The Diplomacy implementation lives at `/diplomacy`. The human picks one of the seven
Great Powers — Austria-Hungary, England, France, Germany, Italy, Russia, or Turkey — and
plays it against the other six, each driven by an independent AI. Every season you write
orders for your armies and fleets, all powers' orders resolve simultaneously, and the
board advances. The goal is a **solo victory**: control **18 of the 34 supply centers**.
If no power reaches 18 by the configured final year, the game ends and the power leading
on supply-center count is declared the leader (a timeout result, not a negotiated draw).

What makes this version distinct is the conversational layer: each AI power has its own
persona and will talk to you — and, behind your back, to each other — forming alliances,
making (and breaking) deals, and translating that diplomacy into the orders it actually
submits.

## Rules Coverage

Faithful **classic Diplomacy on the standard 1901 Europe map** (the seven-power "standard"
variant). Implemented:

- **The full standard map**: 34 supply centers among 75 provinces (land / coastal / sea),
  the seven powers' home centers and their starting army/fleet placements.
- **Both unit types** — armies (land + coast) and fleets (coast + sea) — with correct
  movement adjacency: armies cannot enter sea spaces, fleets cannot enter landlocked
  provinces.
- **All four order types**: hold, move, support (support-hold and support-move), and
  convoy. Armies move across water along a chain of convoying fleets (`hasConvoyPath`
  validates a real fleet chain between origin and destination).
- **Simultaneous adjudication** of a whole season's orders at once: support strength is
  tallied, **standoffs** (equal strength) bounce both movers, **support is cut** by an
  attack on the supporting unit, and a unit moving with superior strength **dislodges** the
  occupant.
- **Dislodgement + retreats** as a distinct phase: a dislodged unit must retreat to an
  empty, adjacent, uncontested province or be disbanded; spring and fall each have their
  own retreat phase.
- **Winter adjustments**: after fall, each power's unit count is reconciled to its
  supply-center count — **builds** in open home centers (your choice of army or fleet) when
  ahead, **disbands** when behind.
- **Supply-center ownership** changes at the end of fall (occupy a center to capture it),
  feeding the winter build/disband math.
- **Solo victory at 18 centers** is checked after each adjudication; reaching the configured
  `maxYears` ends the game with the center leader.
- **Save / restore** via `serializeState` / `fromSerializedState` (a `clone()` round-trips
  through serialization), so an in-progress game survives a reload.

### Split coasts (STP / SPA / BUL) — implemented

The three split-coast provinces — **St. Petersburg, Spain, and Bulgaria** — are fully
modeled, per the standard rules:

- `COAST_PROVINCES = { STP: ['nc', 'sc'], SPA: ['nc', 'sc'], BUL: ['ec', 'sc'] }` and a
  `DEFAULT_COAST` for each.
- Each named coast has its **own fleet adjacency** (e.g. a fleet on `STP/sc` reaches
  different seas than one on `STP/nc`), and a fleet order targeting a split-coast province
  must commit to a specific coast (`STP/nc`, `SPA/sc`, `BUL/ec`, …). A **fleet build** in a
  split-coast home center emits one legal build per coast so the player chooses.
- Support and movement honor the per-coast adjacency, so e.g. a fleet on the wrong coast
  cannot support into a province only the other coast borders.

## Architecture

The module follows the same Board/Game split as the other games: all rules live in the pure
`DiplomacyBoard`, the UI mutates the board through public methods / `clone()`, and the AI and
agent layers touch the board only through `clone()` / `applyMove()` and read-only getters.

| File | Purpose |
|------|---------|
| `src/games/diplomacy/DiplomacyBoard.js` | Pure rules/state engine — map, adjacency, order generation, simultaneous adjudication, retreats, winter adjustments, victory check, serialize/restore (no React) |
| `src/games/diplomacy/DiplomacyGame.jsx` | React UI — SVG map, order entry, negotiation/chat panel, settings, the playable turn loop, save/resume wiring |
| `src/games/diplomacy/DiplomacySetup.jsx` | New-game setup screen — choose power, difficulty, persona spice, final year |
| `src/games/diplomacy/diplomacy.css` | Scoped `.game-diplomacy` (+ `.dark`) variables and styling |
| `src/games/diplomacy/engine/aiPlayer.js` | Tactical order AI — best-response / iterative-best-response search over board clones (no turn-based MCTS, since Diplomacy is simultaneous-move) |
| `src/games/diplomacy/engine/mcts.worker.js` | Web Worker that deserializes the board and computes orders/retreats/adjustments for all AI powers in one request |
| `src/games/diplomacy/hooks/useAIWorker.js` | React hook managing the AI worker lifecycle (one in-flight request, resolves a list of powers at once, graceful fallback) |
| `src/games/diplomacy/hooks/useDiplomacyTurn.js` | UI-level turn controller — the `negotiation → orders → resolving → retreats → winter` state machine |
| `src/games/diplomacy/agents/personas.js` | Per-power fixed temperament + opening dispositions that flavor each AI envoy |
| `src/games/diplomacy/agents/agentClient.js` | Browser client for `api/diplomacyAgent.js` — manages the BYO key and sends a conversation + board context |
| `src/games/diplomacy/agents/serializeContext.js` | Pure serializer turning a live board into a compact, prompt-friendly context object for one power |
| `src/games/diplomacy/agents/memory.js` | Per-power conversation memory — visible thread + private scratchpad (disposition toward others) |
| `src/games/diplomacy/agents/negotiator.js` | Negotiation orchestrator — runs bounded private pairwise AI↔AI conversations (and each AI's side of the human thread), extracting concrete deals |
| `src/games/diplomacy/agents/diplomaticState.js` | Persisted cross-turn diplomatic state — who trusts whom, which deals stand, which promises were kept/broken |
| `src/games/diplomacy/agents/trustModel.js` | Deterministic trust update — diffs promises against what units actually did, moving trust accordingly |
| `src/games/diplomacy/agents/betrayalModel.js` | Per-agreement honor-vs-break decision; assembles the strategic-intent object the tactical AI consumes |
| `src/games/diplomacy/agents/strategicIntent.js` | The strategic-intent schema + validator binding negotiation output to the tactical layer |
| `src/games/diplomacy/agents/intentBinding.js` | Integration layer turning a power's strategic intent into concrete legal orders via `engine/aiPlayer.js`, then reporting back which intents were honored |
| `src/games/diplomacy/agents/ChatPanel.jsx` | The negotiation/chat UI panel |
| `api/diplomacyAgent.js` | Serverless conversational agent (Claude API, bring-your-own key) |

### Subsystems at a glance

- **Tactical AI (`engine/`)** — Diplomacy is a seven-player simultaneous-move game with no
  turn order and no dice, so a turn-based PUCT MCTS doesn't apply. The engine instead runs a
  **best-response / iterative-best-response** search: it clones the board, fills predicted
  opponent orders, calls `applyMove`, and scores the resulting position; the search budget
  scales with difficulty.
- **Conversational agents (`agents/`)** — each AI power is given a voice grounded in the live
  board so the human can negotiate with it. The same machinery runs **AI↔AI** private
  channels.
- **AI↔AI negotiation** — the orchestrator runs a bounded number of private pairwise
  conversations among the AI powers each negotiation phase, extracts concrete deals
  (DMZs, mutual support, who takes which center) into the diplomatic state, and keeps these
  transcripts **separate** from the human's threads.
- **Intent binding** — the bridge from words to moves: a power's validated strategic intent
  is turned into actual legal orders by the tactical engine, so dialogue measurably changes
  what units do — not just chat text.
- **Negotiation loop** — `useDiplomacyTurn` ties everything into one playable cycle:
  `negotiation → orders → resolving → retreats → winter → (next) negotiation`. The
  negotiation phase is **UI-only** and precedes each engine orders phase; `DiplomacyBoard`
  itself is never given a negotiation phase.
- **Persistence** — one versioned save object under `diplomacyGameState` carries the board
  snapshot (`serializeState`), the UI phase, per-power controllers, and the diplomatic
  state, so reloading mid-game restores the in-progress game.

## Conversational AI — bring-your-own key + privacy/security

The AI powers can hold a real conversation only when you supply your own **Anthropic API
key**. The model mirrors the Catan rules assistant (`api/catanRules.js`) and chess coach
exactly:

- The key arrives **only in the request body** to `api/diplomacyAgent.js` — never from server
  environment variables. `git grep -n "process.env" api/diplomacyAgent.js` returns nothing.
- It is used for **exactly one upstream call** to the Anthropic API, then discarded. It is
  **never logged, never persisted server-side, and never returned** in the response. The
  error handler deliberately omits the request body so the key can't leak through an error.
- There is **no server-side fallback key** — no key in the body means no reply.
- The key is stored **client-side** in `localStorage` under the shared **`gipfApiKey`** slot,
  the same slot the chess coach and the Catan/Splendor rules chats use — a key saved in one
  game is reused here and vice versa.
- The endpoint only works on the **deployed site** (`gipf.vercel.app`) or under
  `vercel dev`. Plain `npm start` does not serve `/api/*`, so without a backend you can play
  the full game but the AI powers won't chat or negotiate.

The endpoint builds a per-power system prompt grounded in the serialized board state and
returns two fields: a visible plain-text `message` for the chat panel and a structured,
**private** `scratchpad` (the agent's true, possibly deceptive, disposition toward every
other power). The scratchpad is validated defensively, never shown to the human, and
persisted by the caller for the trust/betrayal model.

### CORS

`api/diplomacyAgent.js` defines `ALLOWED_ORIGINS = ['https://gipf.vercel.app',
'http://localhost:3000']` and applies them through a single `applyCors` helper reused by both
the main handler and the error path. Add new origins there. `vercel.json` already routes
`/api/:path*` to the serverless functions, so no rewrite change is needed to expose the
endpoint.

## Personas, negotiation, and betrayal

Each of the seven powers has a **fixed persona** (`agents/personas.js`): a temperament
(trust / aggression knobs) and a set of opening dispositions toward the other powers. The
persona seeds the system prompt and the per-power scratchpad, but the **live board state
drives actual choices** — a persona is flavor and a starting bias, not a script. A
`personaSpice` setting (0 = plain, 1 = spicy) biases how flavorful the personas play.

Diplomacy's defining feature is that **words are not binding**. The agents are explicitly
allowed to promise anything and to lie, mislead, or break a deal when it serves their power
— that is core Diplomacy. Alliances form when negotiation extracts a concrete deal into the
shared `diplomaticState`; they break when the betrayal model decides honoring an agreement is
no longer worth it.

Crucially, dialogue has **board consequences**. After each adjudication, `trustModel.js`
diffs the promises a power made against what its units actually did and moves trust
accordingly (verified promises clear; durable ones are promoted to standing agreements). The
`betrayalModel.js` then decides, per standing agreement, whether to honor or break it and
emits a strategic-intent object, which `intentBinding.js` turns into the orders the tactical
engine actually submits. So an alliance or betrayal changes resolved orders, not just chat
text.

## Difficulty and settings

Settings are chosen on the new-game setup screen (`DiplomacySetup.jsx`) and persisted:

- **Power** — which of the seven Great Powers you command; the other six become AI.
- **Difficulty** — `easy` / `normal` / `hard`. Difficulty maps to the tactical search budget
  (`diplomacySettings.js` `DIFFICULTY_BUDGET`: ~40 / 120 / 240 sims) and to how widely the
  engine searches plans and opponent responses (`engine/aiPlayer.js`).
- **Persona spice** — `personaSpice` in `[0, 1]`, how flavorful the AI personas play.
- **Final year** — `maxYears` (1901–2000); if no power solos by then the game ends with the
  center leader.
- **Dark mode** and **show orders** are toggled in-game.

## localStorage keys

| Key | Purpose |
|-----|---------|
| `diplomacyDarkMode` | Dark-mode toggle |
| `diplomacyShowOrders` | Whether order arrows/labels are shown on the map |
| `diplomacySettings` | New-game setup: `power`, `difficulty`, `personaSpice`, `maxYears` |
| `diplomacyGameState` | Versioned in-progress save: board snapshot, UI phase, per-power controllers, diplomatic state |
| `gipfApiKey` | Shared (app-wide) BYO Anthropic key — also used by chess, Catan, and Splendor |

Clearing a game removes every `diplomacy`-prefixed key **except** the shared `gipfApiKey`
(which belongs to the whole app).
