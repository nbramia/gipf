# YINSH / ZERTZ fresh training experiments — 2026-09-20

**Final results; retain both incumbents.** Source repairs are packaged in [PR #59](https://github.com/nbramia/gipf/pull/59). Both fresh candidates trained and exported, and both completed automated browser games with real neural inference. ZERTZ finished its incumbent match at **49 wins / 51 losses / 0 draws** and failed its strict-majority gate. YINSH finished at **59 wins / 41 losses / 0 draws**, a promising marginal one-sided signal whose two-sided 95% interval still includes parity. The coordinator retained both incumbents: YINSH requires a confirmatory run, especially given its pre-issue-#60 generation caveat. Neither candidate was promoted; no production deployment is part of these experiments.

## Source repair and validation

The repair revision is `323434d3afa5768b8a4badc5b3002821ebcf7241`; the phase-aware YINSH tactical-probe follow-up is `dddbffe62ac46e6b5613d67920e748ef7d145316`. The coordinator reports both pushed to PR #59. The [audit](yinsh-zertz-audit-2026-09-20.md) describes the rules/search, worker lifecycle, model contracts, data validation, split, API, and wrapper repairs. Its follow-up records **1,222 JavaScript tests / 69 suites**, **12 API tests**, and a successful production build. The accepted Python snapshot is **25 passing tests**, from the preceding hardening revision; these are evidence snapshots, not a claim that every reviewer reran every check on the final commit.

Both fresh datasets and training runs use immutable archives of **323434d**, SHA-256 `61a06029b7e85874bea93f2d783f2d139375570300de3bb0e2e9e47ed2740b74`. The archive fixes repository source, but shared symlinked dependencies are not pinned by it. The completed final YINSH evaluation uses an immutable **dddbffe** snapshot, source-archive SHA-256 `91a39615e4f4414674718d33c6c1a49d22db79fe16d571a25239a8a5b605cc30`; this does not change its generation provenance.

Issue #60 matters to interpretation: generation on 323434d attempted ordinary opponent replies while a candidate board required scoring resolution. The strict guard caught invalid probes, which returned an optimistic no-threat estimate. Played actions remained legal, but root move ordering was degraded. The follow-up uses the actual phase and actor and preserves the strict guard. Independent review reproduced 50 caught fixture errors before and zero after, with 150 YINSH tests / 11 suites passing. This is a source correctness repair, not evidence of stronger candidate weights.

## ZERTZ: completed scratch six-plane bootstrap

Run directory: `/Users/nathanramia/gipf-training-runs/zertz-v2-20260920T224359Z-0916240c`.

The actual legacy v80 incumbent guided **100 fresh games at 300 simulations**, three workers, with a 75-simulation opening ramp for ten decisions. The emitted data uses the real six-plane v2 representation: **5,531 records**, including **246 nonzero forced-jumper positions** (4.4%). No legacy dataset, checkpoint resume, mixed schemas, or fabricated zero-plane conversion was used.

Seed 42 split whole games before training-only six-rotation augmentation: 90 training / 10 validation games, 5,019 source training positions → 30,114 augmented examples, and 512 validation positions. Training from scratch used 312,634 parameters, LR 0.001, Adam/cosine scheduling, batch 256, distillation weight 0.5, MPS, at most 40 epochs and patience 12. It stopped naturally at epoch 14; **epoch 2 was best**, validation loss 3.2684806585. Later epochs overfit (final training value-sign accuracy 97.9%, validation 47.9%).

Export declares `board_v2_input: [batch,6,7,7]`, `meta_input: [batch,12]`, and feature-version/schema metadata. ONNX checking and native PyTorch/ONNX value and policy parity passed. The incumbent has five board planes; its v80 checkpoint identity is supported by the deployment pointer and numerical parity, not byte equality between checkpoint and ONNX.

| Candidate side | Wins | Losses | Draws | Games |
|---|---:|---:|---:|---:|
| P1 | 24 | 26 | 0 | 50 |
| P2 | 25 | 25 | 0 | 50 |
| Total | 49 | 51 | 0 | 100 |

The completed NN-versus-NN tournament used 100 simulations per move and the actual incumbent. Exit 1 denotes the failed strict-majority gate, not an incomplete run. The observed 49% win rate has an approximate Wilson 95% interval of **39.4%–58.7%**, conditional on independent Bernoulli outcomes. Unseeded, unpaired stochastic games do not establish exact reproducibility or independence. This sample establishes neither improvement nor a meaningful strength difference. An early-best scratch bootstrap with sparse forced-jumper examples does **not** establish that the sixth plane is useless; dataset size, optimization, and search sensitivity remain possible limitations.

## YINSH: completed fresh-data fine-tuning and corrected evaluation

Run directory: `/Users/nathanramia/gipf-training-runs/yinsh-corrected-20260920-ctx_da67ede4fca3`.

The seed is the actual shipped **v164** export and its matching checkpoint, not v167 from the separate stale checkout. The incumbent ONNX matches the recorded v164 export byte-for-byte. Independent review additionally identified six matching fully connected checkpoint tensors; that limited tensor comparison alone is not a full-graph equivalence proof.

Fresh incumbent-guided generation on 323434d completed **50 games / 2,698 records**, 200 simulations, three workers, a ten-decision opening ramp, and 15 configured exploratory decisions. Seed 42 assigns 45 training / 5 validation games, with 2,412 / 286 source positions and no game-ID overlap. Fine-tuning used only these fresh data, v164 initialization, six rotations (14,472 training examples), MPS, LR 0.0001, up to 40 epochs, and patience 12. The training peer reports stopping after 15 epochs and retaining epoch 3, validation loss 3.117096289. Training, export, and bundle verification exited 0. The generation carries the issue #60 heuristic caveat above.

The original serial evaluation on 323434d was explicitly superseded and terminated by coordinator authorization. `superseded-evaluation-control.json` records that decision; its evaluation exited -15. The parent manifest was reclassified as `evaluation_superseded`, then finalized as `completed` with a pointer to the replacement evaluation and the original error preserved as `superseded_serial_error`. The interrupted serial stage does not invalidate the completed generation/export stages, and its partial tournament is **not a result**.

The replacement in `evaluation-dddbffe-20260920T2304Z/` completed at 23:21 UTC: four parallel immutable-dddbffe shards with **13, 13, 12, and 12 games per side**, at 100 simulations. Because YINSH `--games` means games **per side**, this is 26 + 26 + 24 + 24 = **100 total games, 50 on each side**. All four shards exited 0, their game rows reconcile with the aggregate, and each recorded **zero caught probe diagnostics**. Source-archive, candidate, incumbent, and shard-log hashes were verified against the manifest.

| Candidate side | Wins | Losses | Draws | Games |
|---|---:|---:|---:|---:|
| White | 29 | 21 | 0 | 50 |
| Black | 30 | 20 | 0 | 50 |
| Total | 59 | 41 | 0 | 100 |

The observed 59% win rate passes the plain-majority gate. Under an independent Bernoulli approximation, the Wilson two-sided 95% interval is **49.2%–68.1%**, exact two-sided binomial p = **0.0886**, and one-sided p = **0.0443** against parity. This is a promising marginal one-sided signal, not an absence of evidence, but it does not meet a two-sided 5% threshold. Fixed standard setup, unpaired unseeded stochastic search, and only 100 games limit generalization. Generation still contains **8,363 caught tactical-probe diagnostics** from pre-#60 source; corrected evaluation does not remove that training-data caveat. The coordinator therefore retained v164 pending a confirmatory run; this task launched no further training or evaluation.

The final independent review corrected and closed F6 with measured candidate PyTorch/ONNX parity on **32 legal boards** (31 play, one remove-row). Both value and policy passed `allclose(atol=2e-5, rtol=1e-5)`; ORT-Node 1.20.1 and ORT-Python 1.24.2 were bit-identical on that sample. This is bounded numerical evidence, not proof that export differences can never change an MCTS decision or a full search-trajectory equivalence test.

## Browser compatibility evidence

The coordinator drove full games through real UI AI Move controls in Chromium against a local production build under `/gipf`, with bundled workers and WASM inference. Worker instrumentation collected responses; successful inference and actions were not mocked. Candidate requests were redirected to the actual candidate bytes without replacing deployed assets.

| Model/build evidence | Completed actions | Result / coverage |
|---|---:|---|
| Shipped YINSH, initial repair build | 62 | Black wins; all four phases; caught probe diagnostics exposed #60 |
| Shipped ZERTZ, initial repair build | 72 | P2 wins; placement, removal, captures, exhausted pool and placement from captures |
| Fresh ZERTZ candidate | 63 | P1 wins; includes continued jumping |
| Shipped YINSH, issue #60 fixed build | 60 | Black wins; all four phases; no invalid-row diagnostics |
| Fresh YINSH candidate, issue #60 fixed build | 84 | Black wins; all four phases; no invalid-row diagnostics |

All recorded successful-game responses reported actual/requested `nn`. Forced model 404 checks in both games produced legal heuristic fallback and a visible notice; restoring requests recovered NN inference in the same worker. The fixed YINSH browser build was tested from stable uncommitted follow-up source before its packaging, not as a separately hashed immutable build. These are **coordinator automated UI play-throughs**, not independent Claude browser testing or human manual review. They cover local Chromium, not deployed hosts or all browsers. They establish compatibility and completion, not strength or browser/native raw-tensor parity.

## Artifact identities and evidence limits

Paths below are relative to the respective run directory above. SHA-256 values for both archives, candidates, incumbents, fresh data, and candidate checkpoints were recomputed during this synthesis; the ZERTZ v80 checkpoint digest comes from its completed run report.

| Run / artifact | SHA-256 |
|---|---|
| ZERTZ `incumbent-v80-v1.onnx` | `df068f82d7ec6270929946cf7bee30fae6d37d77e35ae481108028387271d40d` |
| ZERTZ recorded v80 checkpoint | `c913e0c91d7786be327c14d32f04a68a530c939406e035c933f1cd756cffc010` |
| ZERTZ `fresh-v2.ndjson` | `e889996a1b567d4411c905ea29980af5adac67e0d7cfcea1cca5810c4c041aa3` |
| ZERTZ `checkpoints/best.pt` | `af8e1239a4930323d80f9924535640deb686a5d6fdfa35d6b4ea6a5765c0c9be` |
| ZERTZ `candidate-v2.onnx` | `fd67ddcb4c60c86260ccbb884f9d240044ae35e5a85780dfe0b9ef6234949013` |
| YINSH `incumbent.onnx` | `834feeb527b8cea86af255a72ef63ac5c65327817ebacb4827986612f3041d4e` |
| YINSH `seed-v164.pt` | `34107f8fe309134e13989daff8700477d3670d5fc157a9cfdc5e2245e7670c20` |
| YINSH `selfplay.ndjson` | `13b5549f0360a9c6f9cd548f8005dfbda9c9a7c24e092e0c316c94ee2dca2376` |
| YINSH `candidate.pt` | `cc48a2512e7e7545d05f49811eb10c282620ff142f3e4dfe2fb171ff52cb3bd5` |
| YINSH `candidate.onnx` | `84f793482cc555c56bcc23b4b2510c82b48f4ff87c5297a34c803f4d856607f8` |

Whole-game splits prevent shared game IDs across partitions; they do not deduplicate repeated positions across different games. Small validation sets and changed splits/schemas prevent direct comparison with historical losses. The earlier flawed baseline experiments in the audit are separate runs and are not pooled with these results. Plain-majority gates are not statistical significance tests, and the games' draw handling differs; no automatic promotion follows from either runner.

Evidence: `/tmp/gipf-fresh-zertz-report.md`, `/tmp/gipf-release-browser-smoke.md`, `/tmp/gipf-release-claude-review.md`, `/tmp/gipf-final-evaluation-claude.md`, the linked audit, and the run manifests/logs (including YINSH `evaluation-dddbffe-20260920T2304Z/verification.json`). The Claude reviews independently check initial packaging, archives, model provenance, runner design, the #60 patch, and sampled candidate parity; their earlier live-run and uncommitted-source status is superseded where explicitly stated above. Temporary reports and local run directories are evidence pointers, not portable repository artifacts. ZERTZ completed at 22:57 UTC with before/after deployed-model hashes unchanged. This documentation task changed only this new report and did not alter source, models, environments, or training processes. Existing validation totals above were preserved; unchanged source tests were not rerun for this documentation-only addition.
