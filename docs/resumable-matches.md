# Four-game resumable matches

Chess, Yinsh, Zertz and Catan save the current match on the device and, for a
signed-in account, in the cloud.

## User behavior

Chess, Yinsh, Zertz and Catan save the current match after gameplay changes and
resume it when their route is reopened or refreshed. Guests remain local.
Signing in opts into authenticated cloud saves. New games replace the current
match and receive a new ID. Chess puzzle/drill exercises are transient; their
progress stores are independent. Splendor and Diplomacy have no resumable match.

A new signed-in device waits for hydration before mounting its engine. An absent
local match can hydrate automatically; an explicitly cleared match with no sync
baseline requires a conflict choice when the cloud holds a match. The engine
stays unmounted until that choice, so its initial save cannot overwrite the cloud. If cloud
access fails it can play locally; the current snapshot is the durable pending
payload. While that game is open, sync polls every 30 seconds when idle. Local
edits and reconnects can bring the next check forward, with at least 10 seconds
between automatic attempts; transient failures back off from 10 to 120 seconds.
Each check compares the snapshot with the last acknowledged account/game baseline. Timestamps never
select a winner. A changed cloud match or another tab's match pauses play and
presents **Keep this match** / **Use cloud match** (or **Use other tab match**).
A cloud keep-local choice makes an explicit CAS write; a second conflict requires
another decision. Both alternatives are staged in local recovery before either
is replaced. **Match recovery** exposes the last eight distinct retained alternatives.

Saving is quiet: while saves and syncs succeed, the match chrome shows no status
line and no recovery control. A notice appears in a polite live region, with
**Match recovery** beside it, only when the player may need to act: a local save
failed, the cloud is unavailable or rejected the match (it retries automatically
where it can), a conflict choice was just made, or recovery holds a copy newer
than both the current and the account match. Older retained copies are the
history of a match the player moved on from and are not mentioned. A conflict
or damaged save carries its own **Match recovery** control.
Storage failure cancels destructive replacement and displays an error.
Malformed recovery containers are preserved byte-for-byte as an unreadable
alternative in the same account-owned recovery key before that container is
replaced. These raw alternatives cannot be restored by the current decoder.

HTTP 400/413 rejects pause automatic retries of the unchanged local match;
changing or restoring the match allows another attempt. Unsupported cloud
snapshots pause sync and require an explicit choice; the cloud version is kept
in recovery before a replacement can be sent. Non-JSON 502/proxy failures remain
transient. Recovery and status controls use scoped light/dark styling and follow
the game's theme preference, including while hydration or a conflict hides play.

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
  Clock ticks update the display without serializing a snapshot. Remaining time
  is saved with meaningful match/UI changes (including moves, increments and
  timeout), and on pagehide, visibility loss and route unmount. Abrupt process
  termination without a lifecycle event can resume the last such checkpoint;
  clocks pause while the page is closed. Completed-game flags prevent reloads
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

The `/migration` page ([games migration](games-migration.md)) nests this object in its `ramia-migration`,
`version:1`, `app:"games"` outer envelope as a record's `data`. The record `id`
is this match ID; account ownership and server CAS revision are **not** portable
credentials. Read the latest local match even when cloud sync is pending. Do not
export `*MatchSync:v1`, `*MatchRecovery:v1`, the transition marker, account
sessions, tokens, raw keys, or encrypted credential envelopes. Migration must
validate the complete outer bundle and each game's decoder before writes,
preserve destination edits, and make repeat imports idempotent.

For active-account local-only **alternatives**, the migration UI may capture the
current authenticated session identity, read each `*MatchRecovery:v1` array and
`chessStatsRecovery:v1`, and extract progress values only. Run each match through
its game's `decodeMatch` and each statistics log through the existing bounded
entry schema before including it as a separate outer migration record. Assign
distinct outer record IDs to different contents of the same match; preserve the
inner match ID, deduplicate identical contents, and retain explicit destination
conflict choices. Recheck the captured identity and transition lease before
reading and after any await. Never export the raw containers or their metadata.

If the active account has an encrypted device recovery copy, the migration UI
can use the local `decryptApiKey(await accountKey(session), sealed)` functions on
`play:recovery:<that same usernameId>` after the user has authenticated that
account. From the decoded progress object, allowlist only the four portable
match values, `chessGameLog`, and validated progress extracted from the recovery
arrays above. Credentials, AES keys, ciphertext wrappers, queue baselines,
account IDs, and other accounts' containers never become export records.
Malformed or future-version alternatives cannot pass the current decoders;
their source copies stay intact and the limitation is reported to the user rather
than silently omitting the only copy.

Legacy `chessGameState` v1 is converted non-destructively by `fromLegacy` only
when `chessMatch:v1` is absent; the source key remains available. An explicit
clear writes JSON `null` to the existing match key, so clear/remount cannot
re-import the old legacy game. This local empty sentinel is not a portable
snapshot; exporters must skip it, while cloud sync sends the existing null-clear
payload. It follows the existing account cleanup/recovery of that same key,
without a device-wide import marker. Valid empty PGN
is supported. Historical terminal games lacked result flags, so conversion
marks those results already applied to protect existing statistics. Damaged
legacy data is retained rather than replaced with a new empty game silently.

## Authenticated server contract

`POST /api/chessProfile`:

```json
{
  "u": "authenticated-username-hash",
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

Redis keys are `play:match:v1:<usernameId>:<game>`. Each account/game has its own
atomic CAS revision. The match Lua operation stores validated JSON opaquely:
Redis `cjson` otherwise turns empty arrays into objects. Profile and settings
records likewise store JS-serialized JSON opaquely, and their writes use exact
snapshots (see
[public accounts](public-accounts.md#json-preservation-and-damaged-records)).
Match keys and revisions are
independent of them. The 300,000-byte request bound and durable account/network
rate limits apply.

## Ownership, pending writes, preferences and statistics

`<game>MatchSync:v1` contains `{v:1,owner,revision,baseline}`. `owner` is an
account username hash, never an authorization secret. The latest portable match
is the queued content; its difference from the baseline is the pending flag.
A mounted store captures the complete current session identity and checks the
actual browser storage before every local write, before a network request,
after reading the response, and before acknowledgment. It never replaces those
credentials with the next active account's credentials. Metadata from another
owner cannot authorize a replay. Reopening the game resumes an offline queue.

The account module's encrypted recovery/cleanup allowlist includes all twelve
match/sync/recovery keys plus `chessStatsRecovery:v1`. Guest import still requires the explicit
unchecked opt-in; restored account data takes priority over a repeated guest
import. A shared, bounded account-transition lease freezes match writers before
async claims/encryption, including writers in tabs that have not received a
storage event yet. Account commit checks fail closed if the lease is replaced or
expires; a crashed tab's lease expires after 60 seconds. Account transitions and
match replacement unmount game controllers; worker IDs and component generations
reject late AI responses; Yinsh, Zertz and Catan share this worker-generation
pattern.

Four-game preferences, Yinsh win counts and Chess finished-game statistics
(`chessGameLog`) use the separate settings CAS record. The Chess log is a validated
JSON string of at most 200 entries / 100,000 UTF-8 bytes, so Redis
never re-encodes its arrays. Settings conflict choices preserve both Chess logs
in the account-scoped `chessStatsRecovery:v1` key; **Statistics recovery** can
restore an alternative without adding or duplicating counters. That internal
recovery key is excluded from ordinary exports; `chessGameLog` remains portable. Chess's rating, opponent history, puzzles and
mistakes use the authenticated profile domains. These records
are not atomically committed with matches.

## Verification

Focused tests cover engine snapshots, Chess repetition/custom-start restoration,
worker cancellation, local/conflict recovery, expired ownership, offline queues,
quota errors, account switches, repeat guest import and actual Redis CAS across
four account/game scopes. The browser fixture runs the built app at the root with
real handlers and a disposable Redis container; external requests are blocked.
See `tests/match-browser.mjs` and `tests/match-redis.test.mjs`.

```sh
# Dedicated play-test-* container only, never shared/production Redis; the tests flush it.
export PLAY_TEST_REDIS_CONTAINER=play-test-matches
docker run --rm -d --name "$PLAY_TEST_REDIS_CONTAINER" redis:7-alpine
node --test tests/match-redis.test.mjs
npm run build
PLAY_TEST_PORT=3189 node tests/serve-public-security.mjs &
# With Playwright available, or PLAYWRIGHT_MODULE pointing to its installed index.mjs:
node tests/match-browser.mjs
docker exec "$PLAY_TEST_REDIS_CONTAINER" redis-cli FLUSHDB   # each network may create five accounts a day
node tests/match-import-browser.mjs
```

Match storage does not rewrite profile records; for profile records whose empty arrays
were stored as objects, see
[public accounts](public-accounts.md#json-preservation-and-damaged-records).
