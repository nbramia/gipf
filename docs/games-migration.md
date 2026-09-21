# Games local migration (preparatory, promotion blocked)

This implementation is stacked on `4487d0c6df5dfe690d55333d1082e4f00755c41e`.
It does not clear the account-security hold or implement hosted migration.
The coordinator explicitly restricted this dispatch to export, validation,
conflict preview and durable staged recovery import. Active destination promotion
is unavailable until the parent settings/account writer boundary is fixed and
reviewed. Staging is not completion of the migration acceptance criterion.
The required writer correction and later activation are tracked in
[nbramia/gipf#66](https://github.com/nbramia/gipf/issues/66).

## Path and integration

The dedicated route is `${PUBLIC_URL}/migration`: `/gipf/migration` in the
current build, `/migration` when built with an empty PUBLIC_URL. It is outside
the cloud-settings synchronization wrapper, not outside the existing middleware
gate. No middleware, authentication API, rewrite or redirect changes are needed.
The shell must preserve direct protected access on old apex, www and aliases;
each browser origin has independent storage and needs its own export. Public
host cutover, hosted protection verification and catalogue integration remain
coordinator work. Files are selected/downloaded locally; no migration network API.

## Version 1 schema

All object schemas are closed: unknown fields, wrong types, future versions,
prototype and credential fields reject. JSON text is at most 5 MiB UTF-8, at
most 10,000 records and nesting depth 24. No coercion or silent truncation.

Envelope fields are exactly `format:"ramia-migration"`, `version:1`,
`app:"games"`, `exportId` (UUID), `exportedAt` (canonical ISO UTC timestamp),
`sourceOrigin` (canonical HTTPS origin, or HTTP loopback for local fixtures),
and `records` (array). No URL username, password, path, query or fragment.
Each record has exactly `kind`, `id`, `schemaVersion:1`, `revision`, `data`.
IDs are 1–160 ASCII letters/digits/colon/underscore/hyphen. Revision is a
SHA-256 hex digest of canonical JSON data; it is not a cloud CAS revision.
Duplicate kind/id pairs reject. Digest verification covers every record before
staging. Match alternatives use content-derived outer IDs and retain inner IDs.

| Kind | ID | Data schema / destination key |
| --- | --- | --- |
| `preference` | Exact allowlisted storage key | Original string, validated by the key-specific schema below |
| `chess-history` | `chessOppHistory` | `{v:1,casual,rated}`; maps of up to 32 bounded opponent keys to exact `{w,l,d}` integer counts 0–1,000,000 |
| `chess-puzzles` | `chessPuzzleProgress` | `{rating,attempts,puzzles}`; rating 100–4000, attempts 0–1,000,000; up to 500 puzzle IDs with exact `{attempts,solves,streak,nextDueAt,lastResult}`; result solved/failed; timestamp 0–4102444800000 |
| `chess-mistakes` | `chessMistakes` | At most 200 entries: `id,fenBefore,movePlayed,bestSan,bestPv,cpLoss,classification,opening,moveNo,createdAt,attempts,streak,nextDueAt`; valid FEN, bounded strings/numbers, classification inaccuracy/mistake/blunder; nullable opening |
| `chess-repertoire` | `chessRepertoire` | `{version:1,white,black}`; each at most 200 opening names of at most 256 characters |
| `chess-log` | `chessGameLog` or content-derived alternative | Existing bounded finished-game entry schema from `server/chessLogValidation.js`, at most 200 entries / 100,000 bytes; exact nested counts |
| `diplomacy-save` | `diplomacyGameState` | Existing version-1 envelope: `version,savedAt,board,uiPhase,controllers,personas,conversations,diplomaticState,uiState`; maximum 400,000 bytes; closed progress-only schemas described below |
| `chess-match`, `yinsh-match`, `zertz-match`, `catan-match` | Inner ID or content-derived alternative | Full version-1 snapshot, authoritative game decoder plus migration's closed nested field validation; see `resumable-matches.md` |

Preference allowlist is the actual game-local inventory, excluding secrets:

- Boolean strings `true`/`false`: Chess DarkMode, ShowMoves, ShowEvalBar, Sound,
  Rated, IntroSeen, KeyNudgeDismissed, PuzzleShowTheme; Yinsh DarkMode, ShowMoves,
  RandomSetup, KeepScore, TwoPlayer, ShowMoveHistory; Zertz DarkMode, ShowMoves,
  TwoPlayer; Catan DarkMode, ShowMoves; Splendor DarkMode; Diplomacy DarkMode,
  ShowOrders, ShowLastMoves. Prefixes are lower-case game names, e.g. `chessDarkMode`.
- `chessDifficulty`: beginner/casual/intermediate/advanced/master;
  `chessTimeControl`: off/3+2/5+0/10+0/15+10;
  `chessLearningGoal`: text at most 2000 characters;
  `chessRating`: integer 100–4000; `chessRatedGames`: integer 0–1,000,000.
- `yinshDifficulty`, `zertzDifficulty`: easy/advanced/expert;
  `catanDifficulty`, `splendorDifficulty`: strong/expert/brutal;
  `yinshEvaluationMode`: heuristic/nn.
  `yinshWins`: exact JSON object with player keys `1`,`2`, nonnegative integer counts.
- `catanRulesetId`, `catanScenarioId`: actual catalogue IDs;
  `catanPlayerCount`: 3–6; `splendorPlayerCount`: 2–4.
- `diplomacySettings`: exact JSON `{power,difficulty,personaSpice,maxYears}`;
  power one of seven countries, difficulty easy/normal/hard, spice 0–1,
  integer maxYears 1901–2000.

Splendor has no persistent match in this parent. Diplomacy's permissive loader
is supplemented by a migration-only closed validator; no game behavior changes.
Its board fields are exactly those from `DiplomacyBoard.serializeState()`.
Units are `{power,type}`, powers are the seven country IDs above, and unit
types are army/fleet. Province map keys are actual province/coast IDs. History
is bounded to 80 JSON snapshots whose own histories must be empty. Orders admit
only engine order fields; resolution history admits only phase, orders,
resolved, retreats, retreatResolution and adjustments. All counters, coordinates,
order fields, maps and arrays are checked before engine reconstruction.
Controllers map country IDs to human/AI. Personas have name, temperament
`{trust,aggression}`, openingDisposition and blurb. Conversation threads have
power, messages (`{role,content,turn}`), scratchpad and updatedAt. Scratchpads
have self, dispositions (trust/stance/intent/optional note), confidence and
optional priority. Diplomatic state has version 1, humanPower, relations,
agreements, promises, promiseLedger, scratchpads and summaries. Agreement fields
are id/type/parties/from/to/provinces/target/actingPower/phase; promise fields are
id/type/from/to/expectedOrder/madePhase/actingPower. UI state has pendingOrders,
retreatChoices and buildOrders. Arbitrary additional negotiation extensions are
unsupported, explicitly reported and left intact rather than silently stripped.

## Recovery and preservation

Read only enumerated progress keys. Latest local unsynced matches are included.
Legacy `chessGameState` is passed to authoritative `fromLegacy` only when the
current match key is absent; legacy source stays untouched. Explicit JSON null
is a clear sentinel, never a portable match. A shadowed legacy save is surfaced
as retained, non-exported content, not silently erased.

Active-account match recovery arrays and Chess statistics alternatives are
decoded into separate validated progress records. Encrypted recovery is read
only for the captured active account, using the unchanged `decryptApiKey` format;
only the documented four match keys, finished-game log and their alternatives
are consumed from it. Other known retained progress that differs from the current
device is reported as excluded from this recovery interface. Unknown/damaged
alternatives are surfaced. Neither raw
containers nor their metadata enter export. Guest retained recovery is kept
separate and never attributed to a signed-in account.

Identity and the exact account-transition marker are captured and checked before
reads and after every asynchronous step. Any active, changed, malformed or
expired-in-flight transition invalidates the operation. These checks do not
repair unfenced parent writers in other tabs: close other game tabs before export.

Import validates the complete file before any write. Preview compares against
current destination values, reports equal/different/missing records, and requires
an explicit keep-destination or retain-imported-alternative choice. Neither
choice writes active game keys. Equal replay is keyed by app/exportId/kind/id
and is idempotent; reusing an export ID with different content is rejected.

Staging uses one bounded atomic localStorage value per captured identity and
Web Locks to serialize migration writers. Signed-in stages use existing AES-GCM
encryption; guest stages have a separate key. At most 50 files and 5 MiB of
decrypted staged JSON are retained per identity. Quota failure leaves the old stage
and all active keys untouched. No multi-key transaction or rollback is claimed.
Retained files can be downloaded again from the migration page under the same
identity; they do not automatically activate or cross account boundaries.

No originals are cleaned up, no origin/cache is cleared, no credentials are
transferred and no redirect occurs. Re-enter original account/encryption secrets
for cloud recovery. Keep both the old device and downloaded files until future
promotion and hosted verification are complete.

## Focused verification

`src/migration.test.js` covers real engine round trips, closed schemas and UTF-8
bounds, populated Chess statistics/trainer formats, alternatives, encrypted
recovery, account/transition changes during cryptography, replay, conflicts and
storage/encryption failure preservation. `src/GamesMigration.test.jsx` covers
explicit staging opt-in and invalidation of prepared data on identity events.
`src/migrationParentBoundary.test.jsx` deliberately reproduces the two inherited
writer defects for #66; its passing assertions describe the defect, not a fixed
authorization boundary. Flip those assertions when the parent is corrected.

`tests/migration-browser.mjs` uses built assets with deny-by-default context
routing installed before navigation and service workers blocked. Only four
explicit synthetic HTTPS fixture origins are fulfilled from local files. The
unchanged middleware executes in the fixture, and unauthenticated navigation
is denied. No route continues to the network, and any API request fails the
test. The fixture covers both base-path builds, three independent source
origins, keyboard export/import, mobile overflow, destination preservation,
encrypted staging across reload and cross-account isolation. It does not
establish hosted protection, live account authentication or deployment readiness.
