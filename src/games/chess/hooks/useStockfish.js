// useStockfish.js — React hook managing the Stockfish engine lifecycle.
//
// Mirrors the suite's useAIWorker pattern: spins up the engine once, tears it
// down on unmount, and exposes async helpers. Two responsibilities:
//   - getMove(fen, tier)  → the engine's move at a given strength (opponent play)
//   - analyze(fen, opts)  → full-strength MultiPV analysis (coaching input)
//
// Both resolve from streaming UCI output. The engine is single-flight: callers
// await one request before issuing the next (the UI enforces turn order).

import { useEffect, useRef, useState, useCallback } from 'react';
import { createEngine, isEngineSupported } from '../engine/stockfishLoader.js';
import { parseInfoLine, parseBestMove, collectMultiPV, splitUciMove } from '../engine/uci.js';
import { getTier, ANALYSIS_MOVETIME_MS, ANALYSIS_MULTIPV } from '../engine/difficulty.js';

export default function useStockfish() {
  const engineRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(null); // active request handler for streamed lines
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const supported = isEngineSupported();

  useEffect(() => {
    if (!supported) {
      setStatus('error');
      return undefined;
    }
    let engine;
    try {
      engine = createEngine();
    } catch (e) {
      setStatus('error');
      return undefined;
    }
    engineRef.current = engine;

    const off = engine.onLine((line) => {
      if (typeof line !== 'string') return;
      if (line.startsWith('engine-load-error') || line.startsWith('engine-error')) {
        setStatus('error');
        return;
      }
      if (line === 'uciok') {
        engine.post('isready');
        return;
      }
      if (line === 'readyok' && !readyRef.current) {
        readyRef.current = true;
        setStatus('ready');
        return;
      }
      // Route analysis/bestmove lines to the active request, if any.
      if (pendingRef.current) pendingRef.current(line);
    });

    engine.post('uci');

    return () => {
      off();
      engine.terminate();
      engineRef.current = null;
      readyRef.current = false;
    };
  }, [supported]);

  // Run one `go` request, collecting info lines until `bestmove`.
  const runSearch = useCallback((fen, { elo, movetime, multipv }) => {
    return new Promise((resolve, reject) => {
      const engine = engineRef.current;
      if (!engine || !readyRef.current) {
        reject(new Error('Engine not ready'));
        return;
      }
      const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const infos = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          pendingRef.current = null;
          reject(new Error('Engine search timed out'));
        }
      }, (movetime || 1000) + 8000);

      pendingRef.current = (line) => {
        const info = parseInfoLine(line, sideToMove);
        if (info) {
          infos.push(info);
          return;
        }
        const best = parseBestMove(line);
        if (best !== null || /^bestmove/.test(line)) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          pendingRef.current = null;
          const lines = collectMultiPV(infos);
          resolve({ bestmove: best, lines, sideToMove });
        }
      };

      // Configure strength + MultiPV for this request, then search.
      if (typeof elo === 'number') {
        engine.post('setoption name UCI_LimitStrength value true');
        engine.post(`setoption name UCI_Elo value ${elo}`);
      } else {
        engine.post('setoption name UCI_LimitStrength value false');
      }
      engine.post(`setoption name MultiPV value ${multipv || 1}`);
      engine.post(`position fen ${fen}`);
      engine.post(`go movetime ${movetime || 1000}`);
    });
  }, []);

  // Opponent move at a difficulty tier. Returns {from,to,promotion} or null.
  const getMove = useCallback(
    async (fen, tierKey) => {
      const tier = getTier(tierKey);
      const { bestmove } = await runSearch(fen, {
        elo: tier.elo,
        movetime: tier.moveTimeMs,
        multipv: 1,
      });
      return bestmove ? splitUciMove(bestmove) : null;
    },
    [runSearch]
  );

  // Full-strength analysis for coaching. Returns {bestmove, lines, sideToMove}.
  const analyze = useCallback(
    async (fen, opts = {}) => {
      return runSearch(fen, {
        elo: undefined, // full strength for honest evaluation
        movetime: opts.movetime || ANALYSIS_MOVETIME_MS,
        multipv: opts.multipv || ANALYSIS_MULTIPV,
      });
    },
    [runSearch]
  );

  return { status, supported, getMove, analyze };
}
