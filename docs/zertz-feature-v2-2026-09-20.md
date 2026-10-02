# ZERTZ feature v2 and legacy compatibility (#57)

Implemented in the repair checkout on 2026-09-20. Existing deployed ONNX assets and baseline training runs are unchanged.

## Feature contract

| Contract | Explicit legacy v1 | New v2 |
|---|---|---|
| Board tensor | float32, N × 5 × 7 × 7 | float32, N × 6 × 7 × 7 |
| Flattened board length | 245 | 294 |
| Meta tensor | float32, N × 12 | float32, N × 12, unchanged |
| ONNX board input name | `board_input` | `board_v2_input` |
| ONNX meta input name | `meta_input` | `meta_input` |
| Dataset tag | `featureVersion: 1`, or absent only for exact legacy shape | `featureVersion: 2` required |
| Checkpoint tag | `feature_version: 1`, or absent only for five-plane weights | `feature_version: 2` required |

Planes 0–4 and all meta semantics are unchanged. Plane 5 is a one-hot marker at `(r + 3) * 7 + q + 3` for `jumpingMarble` during capture. It is zero before a jumping marble is selected and outside capture. All six planes rotate together. Destination policy remains 49 entries; this change does not expand the policy action space.

The JS default extractor is v2. Adapters explicitly call `extractFeatures(board, detectedVersion)`, so legacy model requests still receive byte-equivalent five-plane features. Unknown feature versions and unknown ONNX input names fail clearly. Load-time inference probes validate the selected shape and require finite value output before caching a session. Failure returns false, exposes `lastError`, releases an incompatible session, and leaves the existing worker/UI fallback behavior intact.

Exports embed `zertz.feature_version` and `zertz.feature_schema` ONNX metadata. The versioned input name is the authoritative runtime-readable schema marker: the installed native onnxruntime-node does not expose input/custom metadata, so adapters cannot depend on that newer API. The input contract plus probe works in both runtimes.

## Data and checkpoint migration

New self-play always writes v2 examples and preserves the UUID `gameId` from the prior provenance repair, even when an explicitly legacy NN guides the search. The search model's encoding and the newly recorded training encoding are selected independently.

Legacy arrays do **not** contain enough information to reconstruct the forced jumping marble. The loader never appends a fabricated zero plane or infers a jumper from occupancy. Untagged 294-float records are rejected; tagged/untagged legacy records stay v1. Mixed v1/v2 datasets fail before splitting or append sampling, including an append ratio of zero. Dataset validation rejects non-finite features and malformed jumping planes. Source-game split and train-only rotation behavior are preserved.

Raw legacy state dictionaries and old full checkpoint dictionaries load explicitly as v1 from their five-plane convolution. New checkpoints carry `feature_version`. Unknown tags, missing tags on six-plane weights, and tags that conflict with weight shapes are rejected. Value-only and policy/value checkpoint types remain supported.

No automatic weight conversion is provided. A v1 checkpoint cannot resume against v2 examples; the trainer fails with an actionable message. This avoids pretending a shape change has learned forced-capture semantics.

Suggested explicit bootstrap, using new artifact names:

```sh
mkdir -p data/zertz/feature-v2
node scripts/zertz/generate-training-data.mjs --games 100 --sims 200 \
  --mode nn --model public/models/zertz-value-v1.onnx \
  --output data/zertz/feature-v2/bootstrap.ndjson

PYTHONPATH=training training/.venv/bin/python3 training/zertz/train.py \
  --data data/zertz/feature-v2/bootstrap.ndjson --feature-version 2 --augment \
  --output-dir training/zertz/checkpoints/feature-v2-bootstrap

PYTHONPATH=training training/.venv/bin/python3 training/zertz/export_onnx.py \
  --checkpoint training/zertz/checkpoints/feature-v2-bootstrap/best.pt \
  --output /tmp/zertz-feature-v2-candidate.onnx

node scripts/zertz/tournament.mjs --games 20 --sims 100 \
  --model1 /tmp/zertz-feature-v2-candidate.onnx \
  --model2 public/models/zertz-value-v1.onnx
```

These are migration instructions, not commands executed against production. Use the site's configured Python environment. Legacy training remains available with exclusively v1 data and `--feature-version 1`. To obtain genuine v2 examples from historical games, replay original serialized states if available or generate new self-play; old feature-only NDJSON cannot recover identity.

The automatic wrappers now preflight the selected checkpoint before any self-play: legacy v1 and corrupt checkpoints fail with an actionable bootstrap message. Bootstrap, evaluate, and explicitly select a v2 champion before restarting such a loop. A feature-v2 model must pass the explicit incumbent gate before promotion; no model was promoted here.

### Restarting wrappers without mixing old files

Both wrappers default to `DATA_DIR=data/zertz/feature-v2` and accept a `DATA_DIR` environment override. The one-shot wrapper appends up to three recent `v*_selfplay.ndjson` files from that directory, and the continuous wrapper appends up to fourteen. Preflight checks existing generation files for legacy records, invalid JSON, and incompatible feature shapes/tags before self-play. Historical top-level `data/zertz/v*_selfplay.ndjson` files remain unchanged and are not searched by the default v2 loop; no archival move or in-place schema conversion is needed.

After the bootstrap candidate passes its incumbent tournament, explicitly install the verified candidate and record its matching checkpoint. Using the candidate paths above:

```sh
training/.venv/bin/python3 scripts/verify-model.py /tmp/zertz-feature-v2-candidate.onnx \
  --destination public/models/zertz-value-v1.onnx
echo training/zertz/checkpoints/feature-v2-bootstrap/best.pt > training/zertz/.deployed-checkpoint
```

Do not execute installation after a failed tournament or in the active baseline training-2 checkout. The deployed ONNX and `.deployed-checkpoint` pointer must refer to the same v2 champion; `zertz-value-v1.onnx` is a deployment alias, not a feature-schema tag. A normal one-shot invocation is `DATA_DIR=data/zertz/feature-v2 ./scripts/zertz/train-iteration.sh <unused-version> 50 200`, replacing `<unused-version>` with an unused integer greater than 1. For the continuous path, confirm `.current-version` names an unused version, then use `DATA_DIR=data/zertz/feature-v2 ./scripts/zertz/continuous-train.sh --max-iterations 1`. The continuous script retains automatic commit/push behavior after a promotion.

Wrapper preflight is implemented separately in `scripts/zertz/preflight-training.py`, using the shared checkpoint loader and record schema validators. Both wrappers supply `--deployed-model public/models/zertz-value-v1.onnx`: resuming a v2 checkpoint requires a readable ONNX with v2 input names and a successful six-plane inference probe. Legacy, unknown, corrupt, or missing deployed models fail before Node self-play. This verifies schema compatibility, not exact weight identity; the operator must still install the ONNX exported from the recorded champion checkpoint. The wrappers still use explicit incumbent NN self-play and candidate-versus-incumbent tournaments; schema compatibility alone never authorizes promotion. See [the full bootstrap procedure](ai-engine.md#zertz-feature-v2-bootstrap).

For scratch training, supply the intended deployed-model path to preflight with no checkpoint; that path must not exist. The wrappers retain this no-incumbent heuristic path and cannot automatically promote its candidate. Manual v2 bootstrap using a v1 evaluation model remains available through the individual generation/training/tournament commands above, outside the normal wrapper preflight.

## Verification

- `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/games/zertz/engine/features.test.js src/games/zertz/engine/valueNetwork.test.js`: **2 suites / 10 tests passed**. Features distinguish the two forced-capture identities; explicit legacy arrays collide as expected; all six rotations preserve identity; browser adapter tests cover legacy/v2 feed shapes, prefixes, retry and unknown-schema failure.
- `PYTHONPATH=training ZERTZ_V2_SMOKE_MODEL=/tmp/gipf-zertz-v2-browser.onnx /Users/nathanramia/Code/Personal/gipf/training/.venv/bin/python3 -m unittest discover -s tests -p test_zertz_features.py -v`: **8 tests passed**, 4.483 seconds; log `/tmp/gipf-zertz-feature-tests.log`.
- Those Python tests execute real JS extraction and compare all rotations with Python; load both legacy checkpoint formats and tagged v2; reject schema mixtures, untagged v2 and malformed identities; export actual legacy/v2 ONNX; compare native Node value and all 49 policy outputs against PyTorch at rtol=1e-4, atol=1e-5; load the shipped legacy ONNX; reject unknown names and mismatched native tensor shapes.
- The same tests run deterministic seeded real self-play, verify v2/game provenance, train a real CPU epoch, inspect the saved six-plane/tagged checkpoint, and verify legacy-checkpoint resume rejection.
- `PYTHONPATH=training /Users/nathanramia/Code/Personal/gipf/training/.venv/bin/python3 -m unittest discover -s tests -p 'test_training*.py' -v`: **10 existing training/split/script tests passed**, 5.659 seconds; log `/tmp/gipf-zertz-existing-training.log`.
- An additional real two-game self-play smoke generated 118 v2 records, including three forced-jump examples, and completed one CPU epoch with separate game groups. Temporary artifacts are under `/tmp/gipf-zertz-v2-*`.
- `npm run build`: passed with the existing chess.ts source-map warning and CRA/Browserslist notices; log `/tmp/gipf-zertz-v2-build.log`.
- `CI=true npm test -- --watchAll=false --runInBand`: **68 suites / 1198 tests passed**, 68.939 seconds; log `/tmp/gipf-zertz-v2-full-suite.log`.
- Scoped `git diff --check` passed.

## Actual browser smoke

Playwright used the actual production build at `http://127.0.0.1:4178/gipf/zertz`, real bundled MCTS workers, and real WASM inference. A temporary server mapped `/gipf/models/zertz-smoke-v2.onnx` to the freshly exported `/tmp/gipf-zertz-v2-browser.onnx`; deployed files were not replaced.

A page-only Worker wrapper recorded responses and selected either the unchanged shipped legacy URL or the temporary v2 URL. The temporary preview server was stopped after verification. In each case:

1. The normal Expert AI Move completed with 300 simulations, `phase:"place-marble"`, `evaluationMode:"nn"`, and no fallback notice.
2. Direct requests 700/701 to that same real worker used otherwise identical capture boards with jumpers `0,0` and `-1,1`.
3. Both returned NN mode and legal captures from the corresponding forced marble.

The v2 load probe itself performs real ONNX inference, so this verifies runtime model compatibility beyond downloading an asset. Browser adapter feed semantics are unit-tested and native numerical parity is separately tested; browser worker messages do not expose raw network value/policy tensors, so this is not a claim of direct browser-versus-PyTorch numerical comparison. Chromium only; no deployed-host smoke or long strength tournament was run.

## Ownership and remaining review

Changed for #57: ZERTZ `engine/features.js`, `engine/valueNetwork.js`, `engine/valueNetworkNode.js`; new `engine/features.test.js` and expanded `engine/valueNetwork.test.js`; `training/zertz/{schema.py,model.py,dataset.py,train.py,export_onnx.py}`; self-play `scripts/zertz/generate-training-data.mjs` metadata; new `tests/test_zertz_features.py`; this report. Prior workers' split/provenance/loader changes are preserved.

No Board or MCTS edits, cross-game imports, deployed model writes, baseline training edits, commits, pushes, or deployments. Final integrated verification after concurrent edits and Claude adversarial review remain coordinator responsibilities. V2 training quality and promotion are intentionally outside this repair.
