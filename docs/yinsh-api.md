# Optional YINSH move API

The browser uses its local worker by default. The optional `POST /api/aiMove` endpoint accepts the board snapshot itself as the JSON body; when hosted under `/gipf`, use `/gipf/api/aiMove`. This repair does not change the default mode or CORS allowlist.

## Canonical request

Send the complete output of `YinshBoard.serializeState()`:

```js
const response = await fetch(`${process.env.PUBLIC_URL || ''}/api/aiMove`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(board.serializeState()),
});
const move = await response.json();
```

All canonical fields are required together:

| Field | Contract |
|---|---|
| `boardState` | Object keyed by valid YINSH `q,r` coordinates; pieces have `type: 'ring'` or `'marker'`, and `player: 1` or `2` |
| `gamePhase` | `setup`, `play`, `remove-row`, `remove-ring`, or `game-over` |
| `currentPlayer` | `1` or `2` |
| `ringsPlaced` | Player-keyed integer counts, 0–5 |
| `scores` | Player-keyed integer scores, 0–3 |
| `selectedRing` | Valid coordinate pair or `null` |
| `validMoves` | Array of valid coordinate pairs |
| `rows` | Current row objects, each containing a player and five distinct marker coordinates matching a live row |
| `nextTurnPlayer` | `null`, `1`, or `2`; must be explicitly `1` or `2` during scoring resolution |
| `rowResolutionQueue` | Array of `{ player, rows }` entries whose rows belong to that player and match live markers |
| `pendingRowsAfterRingRemoval` | Boolean |
| `winner` | `null` until game-over, then the player with score 3 |
| `selectedSetupRing` | `null` or `{ player, index }`, where index is 0–4 |

Resolution requires a ring belonging to the current player; `remove-row` also requires a current-player row. Validation checks the field types, ranges, geometry, live row references, winner/phase consistency, and essential resolution context. It does not reconstruct a game history or prove historical reachability.

The endpoint restores state through `fromSerializedState`, preserving the supplied scores, ring counts, row context, deferred turn, selections, and winner. Search receives its own clone. Cache keys include every canonical field and ignore object-key insertion order; positions with different scores or deferred next players cannot share a cached answer.

## Legacy compatibility

An old request containing only the three canonical core fields—`boardState`, `gamePhase`, and `currentPlayer`—is accepted only when its omitted state is unambiguous:

- **Setup:** rings only, fewer than ten placed, no player has more than five, and counts match alternating placements starting with player 1.
- **Play:** exactly five rings per player and no completed marker rows. Positions with fewer rings require a full snapshot because scores are missing.

These requests default to zero scores, ring counts inferred from pieces, empty move/row/queue arrays, `null` selections/winner/next player, and `pendingRowsAfterRingRemoval: false`.

Minimal resolution/game-over requests and partially supplied canonical state are rejected. For example, adding `scores` to a three-field legacy request is insufficient: send the complete canonical snapshot instead. No missing scoring context is invented.

## Responses and errors

Success returns the existing resolved move object or `null` when no move exists. Moves contain coordinate-pair-or-null `move` and `destination`, numeric `confidence`, and, where supplied by search, `type` and a full five-marker `row`. Both search iterations and fallback results are awaited; early-confidence exits and caching operate on completed results, never Promises.

Malformed/incomplete requests return HTTP 400 with `{ error: 'Invalid board snapshot', message }`. Search failures retain HTTP 500. `OPTIONS` retains HTTP 200 and unsupported methods retain HTTP 405. Allowed origins and CORS headers are unchanged.

## Regression tests

Run `node --test tests/test_yinsh_api.mjs`. Tests invoke the handler without network services, drive delayed search Promises and cache separation, round-trip real Board snapshots, exercise real iteration/coordinate/row responses with bounded simulation, and cover legacy requests, validation failures, methods, and CORS.
