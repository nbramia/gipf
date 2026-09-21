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
| `chess-puzzles` | `chessPuzzleProgress` | `{rating,attempts,puzzles}`; rating 100–4000, attempts 0–1,000,000; up to 100,000 puzzle IDs, also limited by the 5 MiB envelope, with exact `{attempts,solves,streak,nextDueAt,lastResult}`; result solved/failed; timestamp 0–4102444800000 |
| `chess-mistakes` | `chessMistakes` | At most 200 entries: `id,fenBefore,movePlayed,bestSan,bestPv,cpLoss,classification,opening,moveNo,createdAt,attempts,streak,nextDueAt`; valid FEN, bounded strings/numbers, classification inaccuracy/mistake/blunder; nullable opening |
| `chess-repertoire` | `chessRepertoire` | `{version:1,white,black}`; each at most 100,000 names; free text bounded by the 5 MiB envelope |
| `chess-log` | `chessGameLog` or content-derived alternative | Existing bounded finished-game entry schema from `server/chessLogValidation.js`, at most 200 entries / 100,000 bytes; exact nested counts |
| `diplomacy-save` | `diplomacyGameState` | Existing version-1 envelope: `version,savedAt,board,uiPhase,controllers,personas,conversations,diplomaticState,uiState`; bounded by the enclosing 5 MiB export, including its metadata; closed progress-only schemas described below |
| `chess-match`, `yinsh-match`, `zertz-match`, `catan-match` | Inner ID or content-derived alternative | Full version-1 snapshot, authoritative game decoder plus migration's closed nested field validation; see `resumable-matches.md` |

Preference allowlist is the actual game-local inventory, excluding secrets:

- Boolean strings `true`/`false`: Chess DarkMode, ShowMoves, ShowEvalBar, Sound,
  Rated, IntroSeen, KeyNudgeDismissed, PuzzleShowTheme; Yinsh DarkMode, ShowMoves,
  RandomSetup, KeepScore, TwoPlayer, ShowMoveHistory; Zertz DarkMode, ShowMoves,
  TwoPlayer; Catan DarkMode, ShowMoves; Splendor DarkMode; Diplomacy DarkMode,
  ShowOrders, ShowLastMoves. Prefixes are lower-case game names, e.g. `chessDarkMode`.
- `chessDifficulty`: beginner/casual/intermediate/advanced/master;
  `chessTimeControl`: off/3+2/5+0/10+0/15+10;
  `chessLearningGoal`: free text bounded by the 5 MiB UTF-8 export;
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
Winter uses the engine's `winter-build` phase, including inside undo history.
The writer's 400,000-byte soft cap only trims conversation turns; legitimate
board histories exceed it. Migration does not treat that soft cap as a hard limit.
Units are `{power,type}`, powers are the seven country IDs above, and unit
types are army/fleet. Province map keys are actual province/coast IDs. History
is bounded to 80 JSON snapshots whose own histories must be empty. Orders admit
only engine order fields; resolution history admits only phase, orders,
resolved, retreats, retreatResolution and adjustments. All counters, coordinates,
order fields, maps and arrays are checked before engine reconstruction.
Controllers map country IDs to human/AI. Personas have name, temperament
`{trust,aggression}`, openingDisposition and blurb. Conversation threads have
power, messages (`{role,content,turn}`), scratchpad and updatedAt. Diplomatic
state has version 1, humanPower, relations, agreements, promises, promiseLedger,
scratchpads and summaries. Agreement fields are
id/type/parties/from/to/provinces/target/actingPower/phase; promise fields are
id/type/from/to/expectedOrder/madePhase/actingPower. UI state has pendingOrders,
retreatChoices and buildOrders.

Negotiated content follows the writers that store it verbatim:

- Deal locations (agreement `from`, `to`, `provinces`) use the agent endpoint's
  `validateDeal` pattern: 2–4 letters in any case with an optional coast, e.g.
  `SPA`, `spa`, `Spa`, `stp/nc`. `from`/`to` may also be a power id (durable
  promise promotion) and are nullable. At most 1,000 DMZ provinces.
- A joint-attack `target` is any non-empty string, as `validateDeal` admits.
- Scratchpads (hidden state and chat threads) require only what
  `validateScratchpad` requires: non-empty `self`, a `dispositions` object whose
  entries have trust −1…1, a known stance and string intent, and confidence 0…1.
  Disposition keys are any string. Other keys at the scratchpad or disposition
  level (priority, note, model additions) are open JSON, bounded to 256 extra keys
  per object, 256 dispositions and 4,096-character key names. Replies are capped
  at 700 output tokens, well inside these bounds. The secret-key denylist, the
  nesting-depth limit (24) and the 5 MiB envelope still apply to that content.
  Depth is counted from the export file's root, where a record's data sits three
  levels down (`records`, the record, `data`), so every record is checked at the
  depth it will occupy in a file. Secret denial takes precedence over writer fidelity: a writer-valid scratchpad
  with a denylisted key (for example `secret` or `token`) or nesting deeper than
  the limit makes the **whole** Diplomacy save unsupported. It is reported as
  `diplomacyGameState: unsupported or damaged`, excluded from every export file,
  and left unchanged in its source key; nothing is stripped or exported. Other
  progress still exports.

Everything else stays closed: an unknown agreement or promise field, a location
outside the endpoint pattern, an empty target or an invalid disposition is
reported and left intact rather than silently stripped.

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
When another account recovery key exists, a generic warning exposes no account
identifier, count or contents. A guest recovery warning also appears when signed
in. Only storage key names are inspected to detect other account recovery;
their values are never read or included in ordinary exports.

If the records would exceed 5 MiB UTF-8 or 10,000 records in one file, the
export is split. Whole records are packed, current values first, into as many
files as needed. Packing is first-fit, so a later small record may fill an
earlier file. Each file is an ordinary bundle with its own export ID and
digests, passes the same complete validation, and can be validated, previewed,
retained and replayed on its own. The page lists every file with its records and
counts how many downloads have started; it cannot confirm that the browser saved
a file. Split files are named `games-migration-<exportId>-part-<i>-of-<n>.json`.
The part index is in the filename only; the envelope carries no cross-file part
metadata, so renaming a file loses the grouping hint. It states that each file alone is partial
and that all of them must be kept together. A late Diplomacy game (about 4.1–4.4
MB at the 80-snapshot history cap) therefore exports alongside other progress
without anything being deleted.

A single record larger than one 5 MiB file cannot be exported. It is named in
the incomplete-export warning, stays in its original storage key and is never
truncated. Keep that source browser for future or manual recovery. Split files
do not make an export complete when any record is reported as unsupported or too
large. One identity's retained stage holds at most 5 MiB, so large split files may not
all fit. Keep such files as downloads rather than retaining them under another
identity: the usual alternative on one browser is guest staging, which is
unencrypted. When a file does not fit, the page says the stage limit was reached
and that nothing was stored.

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
decrypted staged JSON are structural limits per identity, not promised capacity.
AES-GCM ciphertext is base64 (about 4/3 overhead, plus IV/JSON), and shares the
browser's origin quota with active saves and other recovery. Browser quota/accounting
varies; a stage can fail well below the structural limit. Keep downloaded files.
Quota failure leaves the old stage
and all active keys untouched. No multi-key transaction or rollback is claimed.
Retained files can be downloaded again from the migration page under the same
identity; they do not automatically activate or cross account boundaries.
Guest staging is unencrypted and accessible to anyone using that browser as a
guest, including private progress in files exported while signed in. The page
always warns before guest staging and requires explicit consent; no identifying
metadata is added to portable files to guess their origin account.

The `gamesMigration:v1:<identity>` store remains a version-1 JSON array (AES-GCM
encrypted for accounts). Entries are validated independently: invalid entries
do not block downloading valid ones or appending a new valid file. Appends retain
the exact existing JSON text, including unreadable entries; all entries still
count toward capacity. ID collisions still reject. A damaged array or failed
decryption cannot be appended to and is never overwritten.

An explicitly consented **raw stage recovery** download preserves only the current
identity's original stage container (maximum 10 MiB stored text), even if the
container cannot be parsed. Account raw recovery stays AES-GCM encrypted with a
key derived from that account's original credentials. No current Games tool,
including this page, imports, opens or decrypts it, and it is not an ordinary
portable export. The download needs a fresh consent each time; asking with no
stage present reports that there is nothing to back up. Guest raw
recovery can contain private/unvalidated data. Neither format is accepted as a
validated migration file or promoted to active keys; keep it private for manual
repair. No other identity's stage or arbitrary localStorage is downloaded.

## Writer-bound audit (general review round 1)

| Writer group | Evidence and migration limit |
| --- | --- |
| Six-game preferences | Boolean/enumeration writers match the allowlist. Chess learning goal has no writer cap and now uses the envelope budget. Numeric counters still have the documented 1,000,000 safety limit, and timestamps stop at 2100; these are migration bounds, not writer guarantees. |
| Chess puzzles | `recordPuzzleResult` adds an entry per ID without a cap. Removed the 500-entry restriction; 100,000-entry safety ceiling plus 5 MiB budget. Regression writes 501 real results. |
| Chess repertoire | `pinOpening` has no list/name cap. Removed 200-entry/256-character restrictions; 100,000 names per color plus envelope budget. Regression uses 201 writer-generated names. |
| Chess history, mistakes and log | UI opponent keys come from five tiers/rating ladder (within 32 per bucket). `captureMistake` and `recordGame` cap at 200. Log's 100,000-byte limit follows the existing server boundary. Counts, FEN and string restrictions remain explicit migration validation; permissive historical loaders are not compatibility guarantees. |
| Four match writers | Existing authoritative decoders enforce 240,000-byte snapshots and UI arrays up to 2,000. Their restrictions stay in force. Yinsh rows now require engine `fullLineLength` (5–11); seeded legal play covers row removal and recovery alternatives through game end. Chess free coaching text now allows the snapshot byte budget; threads allow 10,000 entries, still bounded by snapshot bytes. Other closed typed game geometry, resources and fields remain unchanged. |
| Diplomacy board | 80 undo snapshots, 12 order-history entries per board; 400 KB is only a writer soft cap. Regression adjudicates 45 phases including a real winter build and saves beyond 1910 and 400 KB. No engine or persistence writer changed. |
| Diplomacy negotiation | `appendMessage`/scratchpad storage have no text cap; text now uses the envelope budget. Messages, agreements and promises have a 100,000-entry safety ceiling; summaries retain the writer's 200-character cap. Round 2: deal locations, targets and scratchpads now follow the endpoint `validateDeal` / client `validateScratchpad` contracts (see above), covered by writer-driven fixtures through `recordAgreement`, `runNegotiationPhase` with an injected agent, `setScratchpad` and `updateScratchpad`. No live LLM/provider verification. Agreement/promise fields, power sets, ID/turn/persona bounds still apply. |
| Recovery stores | Existing match alternatives and log recovery accept at most eight entries, using their existing decoders/bounds. Only the captured account's documented match/log encrypted recovery interface is consumed; other known content is visibly excluded. |

Unsupported historical extensions, over-limit counters/strings/arrays, and data
outside these supported interfaces are **not** silently repaired or removed.
They produce incomplete-export warnings and remain in source storage; retain the
source device. This audit and its deterministic fixtures do not prove every
historical or provider-generated shape can migrate. Active migration acceptance
and broader recovery completion remain held on #66 and subsequent review.

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
`src/migrationReview.test.js` adds deterministic multi-year/late-game Diplomacy,
seeded Yinsh through row removal, actual uncapped writers, per-entry stage
isolation and byte preservation, scoped raw recovery, generic excluded-recovery
warnings, and explicit UTF-8 overflow with source preservation. Round 2 adds
lower/mixed-case deal locations, free-form targets and model-shaped scratchpads
through the real negotiation writers (with rejected out-of-contract controls), a
real retreat phase from legal opening orders, split multi-file export of a late
Diplomacy game with other progress, per-file replay, and the no-stage raw
recovery message. `src/GamesMigration.test.jsx` covers the split-file listing and
download count, and consent reset after raw download. Round 3 adds the exact
packing boundary (two records at exactly 5 MiB stay in one file; one byte more,
through the comma, splits them), secret-key and depth-limit scratchpad controls
that exclude the whole save, split filenames with a part index, the
download-started wording, and the stage-full message. Round 4 adds the same
boundary with three records, so the running total must count each comma, and
real-writer scratchpads nested 19–21 deep (excluded alone, other progress
exported) and 2 and 18 deep (exported).
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
