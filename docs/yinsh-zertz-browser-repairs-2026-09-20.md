# YINSH / ZERTZ browser repairs — issues #52 and #53

Date: 2026-09-20. Checkout: `/Users/nathanramia/orca/workspaces/gipf/yinsh-zertz-repairs`.

## Delivered

Both games remain independent. Each hook now assigns request IDs, clears callbacks before delivery, rejects mismatched/duplicate messages, and terminates pending workers on cancellation or overlap. Native errors are checked against worker identity. Unmount clears callbacks and terminates workers. A small per-game `createAIWorker.js` isolates the bundler's `import.meta.url` construction so real hooks can be tested without replacing them.

Each Game component versions requests and invalidates them synchronously whenever its board setter runs (including reset, keyboard/toolbar undo/redo, user moves, and position loading). Difficulty/player-mode changes also cancel outstanding work. Main-thread fallback uses a cloned board and checks the same version before accepting either success or error. ZERTZ toolbar undo/redo can now cancel thinking.

All browser model consumers use `PUBLIC_URL`. ZERTZ now bundles `onnxruntime-web` normally. Loaders probe the real model input/output contract with one inference and require a finite value before marking a session loaded; incompatible sessions are released. Workers cache only successful loads and report requested versus actual evaluation mode. Both games visibly report “Neural model unavailable — using heuristic AI.” Successful NN responses clear the notice. Difficulty names, simulation counts, model filenames, and stored preferences are unchanged. Future metadata compatibility checks can precede the loader probe.

## Files owned by this task

For each of `src/games/yinsh` and `src/games/zertz`:
- `YinshGame.jsx` / `ZertzGame.jsx`
- `hooks/useAIWorker.js`, new `hooks/createAIWorker.js`
- `engine/mcts.worker.js`, `engine/valueNetwork.js`
- New `YinshGame.worker.test.js` / `ZertzGame.worker.test.js`
- New `hooks/useAIWorker.test.js`, `engine/mcts.worker.test.js`, `engine/valueNetwork.test.js`

Also this report and an ignored `node_modules` symlink to the existing training-2 dependencies. No Board, MCTS search, features, Node network, Python, scripts, or existing models were edited by this task. Other agents' edits are present in the shared checkout.

## Automated verification

Final focused command:

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/yinsh/YinshGame.worker.test.js src/games/zertz/ZertzGame.worker.test.js src/games/yinsh/engine/valueNetwork.test.js src/games/zertz/engine/valueNetwork.test.js src/games/yinsh/engine/mcts.worker.test.js src/games/zertz/engine/mcts.worker.test.js src/games/yinsh/hooks/useAIWorker.test.js src/games/zertz/hooks/useAIWorker.test.js
```

**8 suites, 40 tests passed**, 13.083 seconds. Log: `/tmp/gipf-final-focused-pass.log`.

Coverage includes delayed reset results/errors while a new request is thinking; real toolbar and keyboard undo/redo; overlap, duplicate and mismatched IDs; native errors and unmount; normal exactly-once application; stale main-thread success/error after reset; visible fallback and recovery; empty and /gipf URL prefixes; loader inference, invalid output, incompatible shape, failed-load retry; worker cache separation and request-tagged errors.

Earlier `CI=true npm test -- --watchAll=false --runInBand` passed **57 suites / 1118 tests**. This run began before the new focused tests and concurrent agents' final changes; it is not a claim of final integrated validation. Log: `/tmp/gipf-repair-tests.log`.

`npm run build` succeeded twice; latest log `/tmp/gipf-repair-build2.log`. Build uses /gipf. Warning: existing chess.js source map references missing `node_modules/src/chess.ts`; CRA also emits existing Browserslist/Babel dependency notices. No build errors. Only worker formatting and test files changed in this task after that build. Scoped `git diff --check` passed.

## Actual production-build browser smoke

Used Playwright against a local static server serving the production `build/` at `http://127.0.0.1:4178/gipf`, with real bundled workers, WASM, and shipped models. Two-player mode and Expert difficulty were selected. No ONNX runtime or model was mocked for successful inference.

Server observed successful 200 responses for:
- `/gipf/models/zertz-value-v1.onnx`
- `/gipf/models/yinsh-value-v1.onnx`
- `/gipf/static/media/ort-wasm-simd-threaded.jsep.24bdb05d1085e3280ef4.wasm`

Instrumented the page's Worker constructor only to record real response messages. ZERTZ returned request 1 with `{requestedEvaluationMode:"nn", simulations:300, phase:"place-marble", evaluationMode:"nn"}` and applied a legal marble placement (UI advanced to remove-ring). YINSH returned request 1 with `{simulations:200, phase:"setup", evaluationMode:"nn", requestedEvaluationMode:"nn"}` and applied a ring placement. Neither UI showed fallback. Because loading now includes a successful finite-valued `session.run`, NN status also establishes actual ONNX inference, beyond a successful download.

Then used Playwright context routing to return 404 for `**/gipf/models/*.onnx`. Both games returned successful legal moves with `evaluationMode:"heuristic"`, `requestedEvaluationMode:"nn"`, and displayed the fallback notice. Removed the route and requested another move in the same YINSH worker: request 2 returned NN mode and the notice disappeared. Unit tests verify failed-cache recovery for both games.

Browser console had the ONNX CPU-vendor warning and an unrelated favicon 404. Expected model-load errors appeared during forced-404 testing.

## Remaining verification / limits

- Coordinator explicitly owns the final integrated full-suite/build after all workers settle; it remains pending.
- Claude adversarial review remains pending.
- Browser smoke exercised local production output under /gipf, not a deployed host, and Chromium only. No deploy was requested or performed.
- Browser smoke covers shipped expert models and early legal moves, not all difficulty models or complete games. Tier URLs/preferences are preserved in code; model strength is outside scope.
- Empty PUBLIC_URL is covered by loader/hook tests rather than a second production browser build.
- Inference probing checks tensor compatibility and a finite value, not semantic feature-version metadata; #57 owns that future compatibility contract.
- Cancelling in-flight work terminates that worker, so its model cache is discarded. Completed ordinary requests retain their worker/cache.
- YINSH's existing reset clears initial undo history, so the regression creates two legal placements before undo. No Board behavior was changed.
