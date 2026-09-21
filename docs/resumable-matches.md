# Four-game resumable matches (PR5)

Part of nbramia/ramia#22. This branch stacks account commit
`8ef678f5b61138ed6c57a5c91319c23622401894` and the frozen game-repair handoff
`86b6698b0d9cb159c775b941426bc40ff7b766eb`. It does not open the public gate,
change deployment origins, promote models, or certify either parent PR's review.

## User behavior

Chess, Yinsh, Zertz and Catan save the current match after gameplay changes and
resume it when their route is reopened or refreshed. Guests remain local.
Signing in opts into authenticated cloud saves. New games replace the current
match and receive a new ID. Chess puzzle/drill exercises remain transient; their
existing progress stores remain independent. Splendor and Diplomacy are unchanged.

A new signed-in device waits for hydration before mounting its engine. If cloud
access fails it can play locally; the current snapshot is the durable pending
payload. Every three seconds while that game is open (and on reconnect), sync
compares it with the last acknowledged account/game baseline. Timestamps never
select a winner. A changed cloud match or another tab's match pauses play and
presents **Keep this match** / **Use cloud match** (or **Use other tab match**).
A cloud keep-local choice makes an explicit CAS write; a second conflict requires
another decision. Both alternatives are staged in local recovery before either
is replaced. **Match recovery** exposes the last eight retained alternatives.
Storage failure cancels destructive replacement and displays an error.

Unsupported/malformed local snapshots are not silently reset. The player can
retain their raw contents in recovery before starting over. A failed save warns
the player to keep the page open; browser storage quota is not assumed unlimited.
Recovery alternatives stay local, and account switching encrypts them with the
outgoing account's existing AES key. They are not public export metadata.

## Portable snapshot schema and migration interface

Only these keys are portable current-match payloads:

| Game | localStorage key | Migration record kind | schemaVersion |
| --- | --- | --- | --- |
| Chess | `chessMatch:v1` | `chess-match` | 1 |
| Yinsh | `yinshMatch:v1` | `yinsh-match` | 1 |
| Zertz | `zertzMatch:v1` | `zertz-match` | 1 |
| Catan | `catanMatch:v1` | `catan-match` | 1 |

Each value is a JSON object with **exactly** the following allowed fields:

```json
{
  "v": 1,
  "game": "chess",
  "id": "synthetic-example-match",
  "updatedAt": 0,
  "state": {},
  "ui": {}
}
```

`game` must match the storage key and authenticated API game; `id` is 1–80 ASCII
letters/digits/underscore/hyphen; `updatedAt` is a nonnegative safe integer in
milliseconds. `state` and `ui` are objects. The entire UTF-8 JSON value is bounded
to **240,000 bytes**, nesting to 24 levels. Unknown envelope, state-root and UI
fields and nested credential/prototype fields are rejected. Known UI arrays are
bounded to 2,000 entries. Gameplay booleans must be booleans, enum text is bounded
to 80 characters, and game logs contain strings of at most 2,000 characters.
Per-game decoders also reconstruct the actual engine before acceptance.

The authoritative implementations are `src/matchSchema.js`,
`src/snapshotValidation.js`, and each game's `matchSnapshot.js`. `decodeMatch`
returns `{board, ui}` or throws, without changing storage; `encodeBoard(board)`
returns the canonical portable engine state.

- **Chess state:** `{pgn, initialFen}`. PGN includes the complete played move line,
  including promotions, castling, en passant, and repetition evidence. Empty
  starting positions are valid, including custom FEN starts. UI fields:
  `humanColor`, `orientation`, `resigned`, `rated`, `difficulty`, `clock`,
  `timeControl`, `flagged`, `ratedApplied`, `historyApplied`, `gameLogged`,
  `dialogue`, `moveStats`, `gameMistakes`. Dialogue strips provider thread history.
  Clocks pause while the page is closed. Completed-game flags prevent reloads
  from applying ratings, history, or the finished-game log twice.
- **Yinsh state:** all `YinshBoard.serializeState()` fields, plus
  `notation:{moveHistory,currentMoveNumber}`. This includes selected ring,
  legal destinations, rows, the row-resolution queue, pending ring/row flag,
  next turn, setup selections, scores, and winner. UI fields: `humanPlayer`,
  `twoPlayerMode`, `showModal`, `difficulty`, `selectedSetupRing`, `scoreApplied`.
- **Zertz state:** all `ZertzBoard.serializeState()` fields, including rings,
  marble map, pool, captures, selected color, `jumpingMarble`, `captureStarted`,
  phase and result. The restorer rebuilds the ring Set. UI fields: `humanPlayer`,
  `twoPlayerMode`, `showModal`, `difficulty`, `lastMoveKeys`.
- **Catan state:** all `CatanBoard.serializeState()` fields, with
  `stateHistory:[]` and `historyIndex:-1`. This preserves map/configuration,
  seeded RNG state, hidden development deck, player resources/cards, setup
  ordering, pending settlement, discard queue, robber continuation, free roads,
  trade proposal/responders, special-build queue, awards and winner. UI fields:
  `showModal`, `gameConfig`, `selectedAction`, `lastMove`, `showTradeBuilder`,
  `tradeGive`, `tradeReceive`, `tradeTargets`, `showMonopolyPicker`,
  `showYopPicker`, `yopPick`, `robberVictimPicker`, `gameLog`.

Undo/redo caches are intentionally not portable: Catan caches entire historical
maps and exceeds the wire budget. Yinsh/Zertz initialize a new undo history at
the restored current position. Chess preserves its played history, but a future
redo branch beyond the current pointer is not saved. AI computations, animation,
open settings/rules panels and transient provider requests are never resumed;
engines request fresh work only for the restored live position.

The migration track nests this object in its existing `ramia-migration`,
`version:1`, `app:"games"` outer envelope as a record's `data`. The record `id`
is this match ID; account ownership and server CAS revision are **not** portable
credentials. Read the latest local match even when cloud sync is pending. Do not
export `*MatchSync:v1`, `*MatchRecovery:v1`, the transition marker, account
sessions, tokens, raw keys, or encrypted credential envelopes. Migration must
validate the complete outer bundle and each game's decoder before writes,
preserve destination edits, and make repeat imports idempotent. This PR defines
the interface; cross-origin export/import tooling belongs to the migration PR.

Legacy `chessGameState` v1 is converted non-destructively by `fromLegacy` only
when `chessMatch:v1` is absent; the source key remains available. Valid empty PGN
is supported. Historical terminal games lacked result flags, so conversion
marks those results already applied to protect existing statistics. Damaged
legacy data is retained rather than replaced with a new empty game silently.

## Authenticated server contract

`POST ${PUBLIC_URL}/api/chessProfile`:

```json
{
  "u": "authenticated-username-hash",
  "auth": "password-derived-auth-token",
  "scope": "match",
  "game": "yinsh",
  "action": "write",
  "revision": 3,
  "domains": { "match": { "v": 1, "game": "yinsh" } }
}
```

The abbreviated match above must contain the full valid snapshot in real calls.
`read` needs no `revision`/`domains` and returns
`{configured:true,revision,profile:{match}}`, with revision 0 and empty profile
for a new record. `write` accepts only the `match` domain; null explicitly clears
a match. It returns the new revision. Wrong ownership returns 401, unsupported
schema/game or invalid engine state 400, stale revision 409, oversized request
413, rate limit 429, unavailable storage 503. No public-ID/bearer shortcut exists.
`claim` remains unsupported in match scope.

Redis keys are `gipf:match:v1:<usernameId>:<game>`. Each account/game has its own
atomic CAS revision. The match Lua operation stores validated JSON opaquely:
Redis `cjson` otherwise turns empty arrays into objects. Existing profile and
settings keys, claim behavior and legacy sources remain untouched. Existing
300,000-byte request and durable account/network rate limits still apply.

## Ownership, pending writes, preferences and statistics

`<game>MatchSync:v1` contains `{v:1,owner,revision,baseline}`. `owner` is an
account username hash, never an authorization secret. The latest portable match
is the queued content; its difference from the baseline is the pending flag.
A mounted store captures the complete current session identity and checks the
actual browser storage before every local write, before a network request,
after reading the response, and before acknowledgment. It never replaces those
credentials with the next active account's credentials. Metadata from another
owner cannot authorize a replay. Reopening the game resumes an offline queue.

Both existing account modules extend the encrypted recovery/cleanup allowlist
with all twelve match/sync/recovery keys plus `chessStatsRecovery:v1`. Guest import still requires the explicit
unchecked opt-in; restored account data takes priority over a repeated guest
import. A shared, bounded account-transition lease freezes match writers before
async claims/encryption, including writers in tabs that have not received a
storage event yet. Account commit checks fail closed if the lease is replaced or
expires; a crashed tab's lease expires after 60 seconds. Account transitions and
match replacement unmount game controllers; worker IDs and component generations
reject late AI responses. Catan now follows the same worker-generation pattern as
the frozen Yinsh/Zertz repair handoff.

Existing four-game preferences, Yinsh win counts and Chess finished-game statistics
(`chessGameLog`) use the separate settings CAS record. The Chess log is a validated
JSON string of at most 200 existing-format entries / 100,000 UTF-8 bytes, so Redis
never re-encodes its arrays. Settings conflict choices preserve both Chess logs
in the account-scoped `chessStatsRecovery:v1` key; **Statistics recovery** can
restore an alternative without adding or duplicating counters. That internal
recovery key is excluded from ordinary exports; `chessGameLog` remains portable. Chess's existing rating, opponent history, puzzles and
mistakes continue through the authenticated legacy profile domains. These records
are not atomically committed with matches. This does not introduce competitive
rankings, multiplayer, or new Zertz/Catan statistics.

## Verification and release boundary

Focused tests cover engine snapshots, Chess repetition/custom-start restoration,
worker cancellation, local/conflict recovery, expired ownership, offline queues,
quota errors, account switches, repeat guest import and actual Redis CAS across
four account/game scopes. The browser fixture runs the built `/gipf` app with
real handlers and a disposable PR5 Redis container; external requests are blocked.
See `tests/match-browser.mjs` and `tests/match-redis.test.mjs`.

```sh
# Dedicated fixture only, never shared/production Redis.
docker run --rm -d --name gipf-pr5-synthetic-redis redis:7-alpine
node --test tests/match-redis.test.mjs
npm run build
GIPF_SYNTHETIC_REDIS=gipf-pr5-synthetic-redis GIPF_TEST_PORT=3189 node tests/serve-public-security.mjs
# With Playwright available, or PLAYWRIGHT_MODULE pointing to its installed index.mjs:
node tests/match-browser.mjs
```

The coordinator owns full-suite verification, independent review, PR publication,
account-security acceptance and hosted checks. Existing legacy profile empty-array
corruption was reproduced separately and is tracked in **nbramia/gipf#62**; this
match implementation does not silently rewrite that parent-owned path. No main
merge, deployment, public-gate removal, or model promotion is performed here.
