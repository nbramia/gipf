# YINSH / ZÈRTZ audit and repair record

Consolidated 2026-09-20 in `yinsh-zertz-repairs`. The initial audit examined revision `fdf80ef` in the separate `training-2` checkout. Its defects describe that baseline, **not the repaired working tree**. The coordinator accepted Claude's full review and final hardening review with **no blockers**. Final evidence is 1,212 JS tests / 68 suites, 25 Python tests, 12 Node API tests, and a successful production build, with browser-smoke evidence limits below. The reviewed repairs are packaged on feature branch `nbramia/yinsh-zertz-repairs`, based on `fdf80ef42f8fceb639b208c53ea6bf7e004596c9`, as 38 modified tracked files and 25 intentional new regular files. Local dependencies, generated output, and model/run artifacts are excluded. No stronger model, deployment, or promotion is claimed.

## Architecture

The games share an application shell and an architectural pattern, not a search implementation. Each owns its pure Board rules/state class, React/SVG UI, request-tracked Web Worker, MCTS, feature extractor, browser/Node ONNX adapters, and offline training pipeline. Board cloning/serialization connects UI, search, self-play, and the optional YINSH API. JS self-play emits NDJSON; Python splits source games, augments training examples, trains checkpoints, and exports ONNX; explicit tournaments precede promotion.

| Contract | YINSH | ZÈRTZ |
|---|---|---|
| Board/actions | 85 legal intersections; setup, movement, row removal, scoring-ring removal | Marble placement, ring removal, mandatory jumps and chains |
| Stored search value | Node's actual current player; selection converts to acting parent | Player choosing the incoming edge; backup respects actual player transitions |
| New NN input | 4 × 11 × 11 board + 5 meta | v2: 6 × 7 × 7 board + 12 meta |
| Legacy NN input | Existing input contract preserved | v1: 5 × 7 × 7 board + 12 meta, explicitly selected |
| Policy output | 121 destination logits | 49 destination logits; colors may share a destination |

An action need not finish a turn. YINSH resolves one row and one scoring ring, rechecks the live board, gives the original mover priority, and eventually resumes with `nextTurnPlayer`. ZÈRTZ retains the same player through placement/removal and capture-chain subactions. Search values must follow these actual transitions, not depth parity. See [architecture](architecture.md), [search/training details](ai-engine.md), and [YINSH rules](yinsh-rules.md).

## Initial findings → repair map

Issue links identify the requested work; “implemented” describes local code and tests, not a merged or deployed release.

| Issue | Baseline finding | Repair and evidence |
|---|---|---|
| [#50](https://github.com/nbramia/gipf/issues/50) | Child selection and backup mixed player perspectives | Actual-player value convention, per-engine transpositions, terminal and same-player tests. F1 follow-up adds visits → parent-relative mean → prior → stable action-key final selection to batch and incremental search. |
| [#51](https://github.com/nbramia/gipf/issues/51) | Stale row queues could rescore; overlapping windows lost action identity | Live row rechecks after each row/ring pair; exact five-marker removal through Board, search, and live AI; complete sequence/undo/serialization tests. F6 rejects invalid search row actions before child construction. |
| [#52](https://github.com/nbramia/gipf/issues/52) | Browser NN import/prefix/load failures could silently become heuristic | Bundled runtime, `PUBLIC_URL`, inference-before-cache, actual-mode reporting and visible fallback. F8 browser probes reject nonfinite policy outputs. Real local production-build inference and forced-404 recovery documented below. |
| [#53](https://github.com/nbramia/gipf/issues/53) | Reset/undo could accept stale worker moves | Request IDs, worker identity, board versions, cancellation/unmount settlement, and cloned main-thread fallback; delayed-result/error component and hook tests. |
| [#54](https://github.com/nbramia/gipf/issues/54) | Illegal setup points, incomplete worker output, scratch resumes, heuristic-only “incumbent” gate, sidecar assumption | YINSH setups use all 85 legal points; all workers settle before publication; explicit checkpoint/NN continuation; candidate-versus-incumbent ZÈRTZ gate fails closed; verified embedded ONNX publication. Wrapper subprocess fixtures never promote. |
| [#55](https://github.com/nbramia/gipf/issues/55) | Augmented siblings and positions from one game crossed validation split | UUID game provenance; seeded source-game grouping before train-only rotation; unaugmented validation; explicit legacy fallback and tiny-data errors/partial batches. |
| [#56](https://github.com/nbramia/gipf/issues/56) | ZÈRTZ one-visit ties ignored values; deeper zero-prior PUCT lost exploration | Root expansion follows priors without pruning; final visits/edge-mean/prior/key comparator; non-root UCB1 when no priors. Deterministic tests use the real 111-action opening and controlled deeper-node exploration. |
| [#57](https://github.com/nbramia/gipf/issues/57) | Features omitted which marble must continue jumping | Explicit v2 sixth plane, versioned data/checkpoint/input contracts, preserved v1 path, JS/Python rotation parity and native ONNX parity, real v2 self-play/CPU training/browser smoke. Wrappers preflight before self-play and isolate v2 history. |
| [#58](https://github.com/nbramia/gipf/issues/58) | Optional API discarded snapshot state and failed to await search | Current implementation restores canonical state, keys cache by full snapshot, awaits resolved moves, and rejects ambiguous legacy scoring requests. Twelve endpoint tests, 1,212 JS tests / 68 suites, and the production build passed. See [API contract](yinsh-api.md). |

## Component outcomes and evidence

**Search and rules.** Controlled NN fixtures exercise real expansion, evaluation, backup, and final selection at budgets below branching width, including same-player row actions. They establish correct value use, not tournament strength. ZÈRTZ tests preserve both placement/removal and forced-chain perspectives and verify all 111 opening actions remain available. YINSH's existing tactical heuristic shortcuts remain; its non-root policy behavior was not redesigned.

**Browser lifecycle and inference.** The [browser repair report](yinsh-zertz-browser-repairs-2026-09-20.md) records 8 focused suites / 40 tests and Chromium against local production output under `/gipf`: shipped YINSH/ZÈRTZ models performed real WASM inference, returned NN mode, and applied early legal moves; forced 404s produced visible heuristic fallback, with retry recovery. The [feature-v2 report](zertz-feature-v2-2026-09-20.md) separately exercised real legacy/v2 ZÈRTZ models and legal captures from two forced jumpers. These were not deployed-host, multi-browser, full-game, or browser/PyTorch numerical-parity tests. Native parity was tested separately. F8's later policy-finiteness addition has regression coverage; that smoke was not repeated after it.

**Data and gates.** Both coordinators require explicit completion, successful child close, expected game/position counts, and valid merged records before atomic publication; failures retain diagnostic artifacts. ZÈRTZ requires explicit candidate and incumbent models, successful load and inference, alternating sides, and wins in more than half of all games including draws. Heuristic benchmarking is a separate mode. Bundle verification supports external tensors but publishes embedded weights; no missing sidecar is required by the YINSH operator instruction.

**Validation split.** Seed 42 by default controls group assignment, append sampling, and training randomness. Holdout is approximately 10% of source groups, not necessarily 10% of positions. All examples with a given game ID stay together before rotation augmentation. Without IDs, rotation-canonical board/meta identities form fallback groups; identities represented by legacy records also join matching identified games. This prevents leakage for those legacy identities, not every repeated position across different identified games, and cannot reconstruct historical game boundaries. Fewer than two independent groups fails clearly; tiny training sets retain partial batches. New losses are not directly comparable with the old augmented validation split.

## Baseline training: finished, no promotion

Read-only inspection of `training-2/training/runs/20260920-{yinsh,zertz}/run.log` confirms both bounded runs finished naturally with exit 0. They used the original audited code and copied seed artifacts, not the repaired pipeline. No run was stopped and no original checkout was modified for this consolidation.

| Run | Data and training | Evaluation | Natural finish (UTC) |
|---|---|---|---|
| YINSH, seed checkpoint v167 | 50 games, 200 simulations, 3 workers; 2,662 positions; 40 fine-tuning epochs and export | Candidate 21 wins, seed 18 wins, 1 draw; 40 games at 100 simulations | 22:17:16 |
| ZÈRTZ, seed checkpoint v80 | 100 games, 300 simulations, 3 workers; 5,316 positions; fine-tuning and export | Candidate 14 wins, heuristic 6 wins, 0 draws; 20 games at 100 simulations | 21:51:53 |

The launch configuration used LR 1e-4, up to 40 epochs, patience 12, six rotations, and ZÈRTZ distillation 0.5. Opening self-play budgets ramped from one quarter for the first ten decisions. Baseline data retains the original engine/setup/split limitations. YINSH's small match advantage is an observed result, not demonstrated strength improvement; ZÈRTZ did not face its incumbent at all. Candidate/checkpoint/ONNX artifacts remain local in those run folders, with no automatic promotion. These are not validated stronger deployed models.

## Feature-v2 migration

Legacy ZÈRTZ features cannot recover forced-marble identity; neither a fabricated zero plane nor automatic weight conversion is used. Versioned runtime input names select exact v1/v2 extraction, and new datasets/checkpoints carry explicit schema tags. Mixed versions fail. Existing deployed filenames are champion aliases, not schema versions.

The [manual bootstrap procedure](ai-engine.md#zertz-feature-v2-bootstrap) generates fresh v2 examples (an explicit legacy NN may guide them), trains a new v2 model without resuming v1, exports separately, gates against the actual incumbent, then deliberately installs and records a matching champion only after success. Subsequent wrappers resume that v2 checkpoint. `DATA_DIR` defaults to `data/zertz/feature-v2`; historical top-level legacy datasets remain untouched. Preflight rejects legacy/corrupt checkpoints, incompatible selected history, and incompatible deployed ONNX input schemas/shapes or invalid inference outputs before self-play. A v2 checkpoint paired with a legacy ONNX is rejected by normal wrappers; deliberate legacy-guided bootstrap remains a separate path. Scratch preflight requires the explicitly supplied incumbent path to be absent. Schema compatibility does not prove the checkpoint and deployed ONNX contain identical weights. Continuous wrappers retain commit/push behavior after promotion and are not dry runs.

## Validation snapshots and review adjudication

| Evidence | Result / scope |
|---|---|
| Initial baseline audit | 333 tests / 6 YINSH-ZÈRTZ suites; original defects still present |
| Integrated repair snapshot | 1,198 JS tests / 68 suites and build passed; initial 18 Python tests preceded final wrapper edits |
| F1/F6/F8 final worker report | 39 focused tests; 1,212 JS tests / 68 suites; build passed |
| Coordinator final Python log | 22 tests passed in 19.973 seconds, including wrappers and v2 contracts |
| API owner final report | 12 Node endpoint tests and 1,212 JS tests / 68 suites passed; production build passed |
| F21/F23 hardening final Python log | 25 tests passed in 32.552 seconds, superseding the 22-test snapshot; includes native policy-probe and deployed-schema preflight regressions |
| Final handoff syntax/manifest | Global whitespace check and 27 syntax checks passed; 38 modified tracked files and 25 intentional new files were uncommitted at handoff and are included in the feature-branch repair package |

The build emitted existing Browserslist/Babel notices and the chess dependency's missing `chess.ts` source-map warning. Some Jest runs explicitly used `--forceExit`; passing results do not prove absence of open handles. These snapshots are not certification of edits made afterward.

Claude's initial read-only review reported 386 stable-scope tests, 10 feature/loader tests, and 10 training tests. The final full review confirms #50–#58 with no blockers, except that Claude did not independently rerun the two browser-smoke subcriteria (#52 C5 and #57 C5); those remain implementation-agent evidence, not failed criteria. **F1/F6/F8 are implemented and confirmed.** Final full-suite/build logs corroborate the 1,212-test result above; earlier 1,198-test references in review subsections describe older snapshots.

The accepted final delta review independently confirms **F21 and F23 MET**: real ONNX artifacts verify native policy-output rejection, value-only and legacy compatibility, and retry; eight actual preflight invocations verify checkpoint/deployed-model schema pairing, failure before self-play, and explicit absent-incumbent scratch behavior. Claude reran all 25 Python tests. No application/browser code changed in that delta, so the prior JS/API/build evidence stands without a broad rerun. F21's repository regression mocks the session boundary; the real invalid-policy ONNX coverage is reviewer evidence, not yet a permanent fixture.

**F12 is withdrawn:** the official [Node child-process close contract](https://nodejs.org/api/child_process.html#event-close) specifies close after exit or a failed-spawn error; the coordinator also reproduced failed-spawn error followed by close. The claimed missing-close hang does not justify a repair. **F13 does not affect the baseline:** edits are isolated in the repair checkout and both baseline runs naturally completed; future v1-to-v2 wrapper startup deliberately requires explicit migration. F17's documentation overclaim is narrowed to legacy identity fallback above.

**F3 and F9 are withdrawn in the delta review.** Actual search measurements did not support the prior “prior-only” normalization claim. Artifact inspection showed the historical v40 ONNX genuinely needs its external sidecar; it is not an orphan. The incorrect one-shot staging instruction is fixed, and the remaining conditional v1 sidecar staging branch is not a blocker. **F24** is a deliberate boundary requiring evaluated and authorized migration/promotion, not inherently human-only work or interruption of the finished baseline.

No speculative F2/F19 redesign or issue filing is included without additional reachability evidence; F19 remains plausible but unconfirmed. Destination-only policies, limited search breadth, worker-cache loss on cancellation, official-rule edge cases, and historical validation limitations are not transformed into claims of solved strength or complete conformance. Legacy snapshot fields are retained for compatibility (F4). The phase constant (F25) remains versioned and covered by cross-language parity tests. Group-based holdout, legacy-only identity protection, and record-level append sampling are documented limits (F16/F17/F18), not blanket duplicate-free guarantees. Preflight schema validation still cannot prove exact checkpoint/ONNX weight identity, and its missing-model error is a cosmetic raw runtime message. These are nonblocking limits; no further code fixes were required by the final coordinator adjudication.

## Follow-up: phase-aware YINSH tactical probes (#60)

After the repair package was pushed as `323434d3afa5768b8a4badc5b3002821ebcf7241`, fresh self-play exposed a pre-existing root-lookahead defect: it tried ordinary opponent ring replies while the candidate position required row resolution. The strict row guard rejected those probes; their catch returned a misleading no-threat estimate. Actual played actions remained legal. [#60](https://github.com/nbramia/gipf/issues/60) makes this bounded lookahead respect the resulting phase and actual actor, assigns pending opponent scoring an explicit conservative threat penalty, and preserves the strict guard and ordinary-play reply evaluation.

Ten new real-Board regressions cover opponent-only rows, mover resolution with and without pending opponent rows, ring scoring after marker removal, terminal outcomes, ordinary replies, actor gating, and unchanged input state. The updated full suite passed **1,222 tests / 69 suites**, API tests passed **12/12**, and the production build succeeded with existing warnings. Independent review passed **150 YINSH tests / 11 suites** with no blockers and reproduced **50 caught errors before / zero after** on the same root fixture. The coordinator's real Chromium production-build game completed **60 actual-NN actions**, including setup, play, row removal, and ring removal, ending in a Black win with zero invalid-row diagnostics; one unrelated console error remained. This is local Chromium evidence, not deployed-host or multi-browser certification.

Two nonblocking limits remain explicit: pending-row penalties also count pre-existing opponent rows and are not calibrated to ordinary-reply penalties; the unused `_checkCanWinNextTurn` helper must gain phase/actor checks before any future caller is added. This repair does not add an exhaustive scoring-resolution solver.

The fresh YINSH/ZÈRTZ experiments use immutable archives of **`323434d`**, so this follow-up is **not present in their source or data generation**. Preserve those runs and their logs; YINSH results carry the degraded-lookahead caveat. The actual shipped YINSH incumbent was verified as the byte-identical export of **v164**, not the initially suggested v167: ONNX SHA256 `834feeb527b8cea86af255a72ef63ac5c65327817ebacb4827986612f3041d4e`, checkpoint SHA256 `34107f8fe309134e13989daff8700477d3670d5fc157a9cfdc5e2245e7670c20`. Fresh data alone is used for fine-tuning; no model promotion or stronger-model conclusion follows from these repairs.

Local follow-up evidence: `/tmp/gipf-issue60-repair-report.md`, `/tmp/gipf-issue60-full-tests.log`, `/tmp/gipf-issue60-api-tests.log`, `/tmp/gipf-issue60-build.log`, reviewer message `msg_8287000616c0`, and coordinator browser message `msg_8a983ff20125`. Run manifests and artifacts live outside this checkout under `/Users/nathanramia/gipf-training-runs/`.

## Evidence provenance

Initial source: the same-named audit in the separate `training-2/docs/` checkout at `fdf80ef`. Local implementation records: `/tmp/gipf-training-repair-report.md`, `/tmp/gipf-zertz56-report.md`, `/tmp/gipf-docs-integration-report.md`, `/tmp/gipf-zertz-wrapper-migration.md`, `/tmp/gipf-review-fixes.md`, `/tmp/gipf-yinsh-api-repair.md`, `/tmp/gipf-final-hardening.md`, and `/tmp/gipf-integrated-validation.md`. Final review sources: `/tmp/gipf-claude-adversarial-review.md` and its superseding corrections in `/tmp/gipf-claude-delta-review.md`; coordinator acceptance: `msg_32f787e40bac`. Verified final logs: `/tmp/claude-rev3-fullsuite.log`, `/tmp/claude-rev3-build.log`, `/tmp/gipf-final-hardening-python.log`, and `/tmp/gipf-yinsh-api-tests.log`. Full uncommitted/new-file manifest and validation reconciliation: `/tmp/gipf-final-handoff.md`. Temporary paths are local session evidence, not portable repository artifacts; durable browser, feature, API, rules, and engine documents are linked above.
