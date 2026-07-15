// useMistakeDrill.js — drill session state machine for the mistake library (#23).
//
// Owns everything about a "retry your mistake" session except the board itself:
// the queue of entries, solving/checking/correct/revealed state, the feedback
// message, scheduler recording, and correctness checking. The component applies
// moves to its visual board and asks this hook whether they solve the drill.
//
// Correctness mirrors the puzzle checker's honesty principle: the stored best
// move always counts, and any other move counts when live full-strength
// analysis says it concedes under DRILL_CP_TOLERANCE centipawns. Analysis goes
// through the same serialized engine queue as coaching (the `analyze` arg from
// useStockfish), so drill checks never collide with other searches.

import { useCallback, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { buildMovePayload } from '../coach/analyzeMove.js';
import { requestCommentary } from '../coach/coachClient.js';
import {
  loadMistakes,
  saveMistakes,
  recordAttempt,
  drillMoveCorrect,
} from '../coach/mistakeStore.js';

export default function useMistakeDrill({ analyze, onStoreChange }) {
  const [active, setActive] = useState(false);
  const [pool, setPool] = useState([]);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState('solving'); // solving | checking | correct | revealed
  const [message, setMessage] = useState('');
  const recordedRef = useRef(false); // one scheduler write per entry: first result decides
  const seqRef = useRef(0); // ignores stale analysis after next/exit

  const entry = active ? pool[index] || null : null;

  const record = useCallback(
    (id, success) => {
      if (recordedRef.current) return;
      recordedRef.current = true;
      const next = recordAttempt(loadMistakes(), id, success);
      saveMistakes(next);
      if (onStoreChange) onStoreChange(next);
    },
    [onStoreChange]
  );

  const loadAt = useCallback((entries, i) => {
    seqRef.current += 1;
    recordedRef.current = false;
    setPool(entries);
    setIndex(i);
    setActive(true);
    setState('solving');
    setMessage('');
    return entries[i];
  }, []);

  // Start a session over `entries`; returns the first entry (its fenBefore is
  // what the caller should load on the board), or null for an empty pool.
  const start = useCallback((entries) => {
    if (!entries || !entries.length) return null;
    return loadAt(entries, 0);
  }, [loadAt]);

  // Advance to the next entry, or return null when the session is done.
  const next = useCallback(() => {
    if (index + 1 >= pool.length) return null;
    return loadAt(pool, index + 1);
  }, [pool, index, loadAt]);

  const exit = useCallback(() => {
    seqRef.current += 1;
    setActive(false);
    setPool([]);
    setIndex(0);
    setState('solving');
    setMessage('');
  }, []);

  // Give up on the current entry: counts as a miss, shows the stored best line.
  const reveal = useCallback(() => {
    if (!entry || state === 'correct' || state === 'checking') return;
    record(entry.id, false);
    const line = (entry.bestPv || []).slice(0, 5).join(' ');
    setState('revealed');
    setMessage(
      `The move was ${entry.bestSan}${line && line !== entry.bestSan ? ` — the line continues ${line}.` : '.'} ` +
        `You played ${entry.movePlayed} in the game. This one will come back for review.`
    );
  }, [entry, state, record]);

  // Judge an attempted move. Returns:
  //   { legal:false }                     — snap the piece back
  //   { legal:true, correct:true,  san }  — keep the move on the board
  //   { legal:true, correct:false, san }  — undo the move (caller reverts)
  //   { legal:true, stale:true }          — session moved on mid-analysis
  const evaluate = useCallback(
    async (from, to, promotion) => {
      if (!entry || state !== 'solving') return { legal: false };
      const game = new Chess(entry.fenBefore);
      let mv;
      try {
        mv = game.move({ from, to, promotion });
      } catch (_) {
        return { legal: false };
      }
      if (!mv) return { legal: false };

      // The stored best move needs no analysis — solved on the spot.
      if (mv.san === entry.bestSan) {
        record(entry.id, true);
        setState('correct');
        setMessage(`${mv.san} — that's the move.`);
        const payload = {
          kind: 'player-move',
          fen: entry.fenBefore,
          sideToMove: mv.color,
          movePlayed: { san: mv.san },
          classification: 'best',
          bestMove: { san: entry.bestSan, pv: entry.bestPv || [], eval: '' },
          candidates: [],
        };
        const seq = seqRef.current;
        requestCommentary(payload).then(({ text }) => {
          if (seq === seqRef.current && text) setMessage(text);
        });
        return { legal: true, correct: true, san: mv.san };
      }

      // Anything else is judged by live full-strength analysis.
      setState('checking');
      setMessage('Checking your move with Stockfish…');
      const seq = seqRef.current;
      try {
        const [analysisBefore, analysisAfter] = await Promise.all([
          analyze(entry.fenBefore, { multipv: 3 }),
          analyze(game.fen(), { multipv: 1 }),
        ]);
        if (seq !== seqRef.current) return { legal: true, stale: true };
        const payload = buildMovePayload({
          fenBefore: entry.fenBefore,
          fenAfter: game.fen(),
          movePlayedSan: mv.san,
          moverColor: mv.color,
          analysisBefore,
          analysisAfter,
          kind: 'player-move',
        });
        if (drillMoveCorrect({ bestSan: entry.bestSan, playedSan: mv.san, cpLoss: payload.cpLoss })) {
          record(entry.id, true);
          setState('correct');
          setMessage(`${mv.san} works — it holds the position.`);
          requestCommentary(payload).then(({ text }) => {
            if (seq === seqRef.current && text) setMessage(text);
          });
          return { legal: true, correct: true, san: mv.san };
        }
        record(entry.id, false);
        setState('solving');
        setMessage(`${mv.san} still gives too much away. Try again, or show the solution.`);
        return { legal: true, correct: false, san: mv.san };
      } catch (_) {
        if (seq !== seqRef.current) return { legal: true, stale: true };
        setState('solving');
        setMessage('Analysis unavailable — try the engine’s move, or show the solution.');
        return { legal: true, correct: false, san: mv.san };
      }
    },
    [entry, state, analyze, record]
  );

  return { active, entry, state, message, index, total: pool.length, start, next, exit, reveal, evaluate };
}
