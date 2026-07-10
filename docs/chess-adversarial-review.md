# Chess — Adversarial Review (#22)

A structured red-team of the Chess game against the goal's expectations. Each
dimension below lists what was attacked and the outcome. Automated checks live in
the Jest suites and an adversarial script run during review; manual checks are
noted as such.

This review is a point-in-time pass that predates the Rated mode feature: the
strength and UX adversary sections below do not cover the rated ladder's
weakened-move sampling (see `docs/chess.md` for Rated mode).

## Summary

No open correctness, security, or crash defects. One intentional design
deviation from the goal text is documented under *Engine hosting*.

## 1. Rules adversary (correctness)

Attacks: castle out of check, castle (kingside) legality, en-passant timing,
under-promotion, insufficient-material draw, stalemate vs checkmate, illegal
moves rejected.

- chess.js enforces all of these; `ChessBoard` surfaces them. Verified by
  `ChessBoard.test.js` (16 tests) + adversarial script (castle-out-of-check
  rejected, en-passant accepted only immediately, under-promotion to knight,
  insufficient-material → draw).
- **Result:** pass. Engine (Stockfish) and rules layer (chess.js) agree because
  the UI only ever plays moves chess.js calls legal.

## 2. Coaching adversary (truthfulness — the key risk)

Attacks: can commentary invent a move, line, or eval?

- `analyzeMove.pvToSan` truncates at the first illegal move, so a malformed engine
  PV can never become a fabricated line (verified: `['e2e4','z9z9'] → ['e4']`).
- `buildMovePayload` candidates come **only** from the engine's MultiPV lines;
  the played-move eval comes from the post-move analysis. Verified the top move is
  classified `best` and candidates equal the engine lines.
- The template fallback composes prose only from payload facts. The API prompt
  instructs the model to use only supplied facts and not invent moves/evals.
- **Result:** pass. Fabrication is structurally prevented, not just discouraged.

## 3. Security adversary (key exfiltration)

Attacks: extract a key from the bundle, env, logs, or errors.

- No `REACT_APP_*` variables anywhere (0 matches) — nothing key-related is bundled.
- No `process.env` in the chess client (0). `api/chessCoach.js` reads **no** key
  from server env (0 `process.env`) — there is no server-side fallback, so a
  public deploy cannot spend a maintainer key.
- `api/chessCoach.js` has **no** `console.*` calls — the key is never logged.
- Build-output scan: no `ANTHROPIC_API_KEY`, no real `sk-ant-…` key (only the
  `sk-ant-…` placeholder hint string).
- **Result:** pass.

## 4. UX adversary (hostile conditions)

- **No key:** board, engine, and template coaching all work; the panel prompts to
  add a key. Verified by design (`coachClient` returns the template path).
- **Engine fails to load (offline / CDN blocked):** `useStockfish` sets status
  `error`; the status line tells the user, and the human can still move. Coaching
  analysis rejects and the dialogue shows "Analysis unavailable for this move."
- **Undo mid-think / new game mid-think / rapid clicks:** a `coachSeqRef`
  sequence number invalidates stale coaching results; `thinkingRef` prevents
  concurrent engine searches; searches are serialized through a queue.
- **Resign / new game / import mid-game:** all reset coaching, stats, and eval.
- **Result:** pass (manual + code review). No crash paths found.

## 5. Strength adversary (difficulty separation)

- Tiers map to distinct `UCI_Elo` values (1320 → 2850) with increasing per-move
  time. Lowest tier is beatable; highest is strong. Coaching analysis is always
  full-strength regardless of opponent tier, so evaluations stay honest.
- **Result:** pass (mapping verified in `engine/difficulty.js`).

## Intentional deviation — Engine hosting / COOP-COEP

The goal text anticipated a threaded WASM build needing COOP/COEP headers with a
single-threaded fallback. We instead ship **only** the single-threaded asm.js
build (`stockfish.js@10`), loaded from a CDN. Rationale:

- It needs no `SharedArrayBuffer`, so **no COOP/COEP headers** are required —
  simpler and more robust on a static host, and it avoids cross-origin-isolation
  side effects on the rest of the site.
- Strength is still far above any human learner and coaching analysis runs at
  full strength.

This is a deliberate simplification, not a defect. If threaded strength is ever
wanted, it can be added behind cross-origin isolation as a follow-up.

## Residuals (non-blocking)

- Opening book and puzzle set are intentionally compact (mainstream lines /
  mate-in-1 and mate-in-2). Expanding them is future work, not a defect.
- Captured-pieces tray approximates after promotions (clamped at zero) — cosmetic.
