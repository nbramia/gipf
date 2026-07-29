import { Chess } from 'chess.js';
import { searchBest, verifyTactic } from './tacticSolver.js';

describe('searchBest', () => {
  test('finds a free hanging piece', () => {
    // White queen on d1, black rook hanging on d5 with nothing defending it.
    const game = new Chess('4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1');
    const { key, score } = searchBest(game, 3);
    expect(`${key.from}${key.to}`).toBe('d1d5');
    expect(score).toBeGreaterThan(400); // won a rook
  });

  test('does not grab a defended piece that loses material', () => {
    // Black rook on d5 is defended by the pawn on e6; Qxd5 loses the queen.
    const game = new Chess('4k3/8/4p3/3r4/8/8/8/3QK3 w - - 0 1');
    const game2 = new Chess('4k3/8/4p3/3r4/8/8/8/3QK3 w - - 0 1');
    const { key } = searchBest(game, 4);
    expect(`${key.from}${key.to}`).not.toBe('d1d5');

    // Sanity: the greedy 1-ply view *would* take it, which is exactly what a
    // deeper search must avoid.
    const shallow = searchBest(game2, 1);
    expect(`${shallow.key.from}${shallow.key.to}`).toBe('d1d5');
  });

  test('reports checkmate as terminal for the side to move', () => {
    // Back-rank mate: the rook covers the 8th, the king's own pawns cover the 7th.
    const mated = new Chess('R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1');
    expect(mated.isCheckmate()).toBe(true);
    const { score, key } = searchBest(mated, 3);
    expect(score).toBe(-100000);
    expect(key).toBeNull();
  });

  test('depth 0 returns the static material balance from the mover POV', () => {
    const game = new Chess('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    expect(searchBest(game, 0).score).toBe(900);
    const black = new Chess('3qk3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(searchBest(black, 0).score).toBe(900);
  });
});

describe('verifyTactic', () => {
  test('rejects an illegal first move', () => {
    const res = verifyTactic('4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1', ['a1a8']);
    expect(res.sound).toBe(false);
    expect(res.reason).toBe('illegal-first-move');
  });

  test('accepts a genuine, unique material win', () => {
    // Rxd5 simply takes an undefended queen; the only other forcing try
    // (Rd8+) hangs the rook to the king.
    const res = verifyTactic('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', ['d1d5']);
    expect(res.gain).toBeGreaterThanOrEqual(800);
    expect(res.unique).toBe(true);
    expect(res.sound).toBe(true);
  });

  test('flags a position where another forcing try does just as well', () => {
    // Two rooks, either of which wins the same hanging queen — a real puzzle
    // needs one key move, so uniqueness must fail here.
    const res = verifyTactic('4k3/8/8/3q4/8/8/8/1R1RK3 w - - 0 1', ['d1d5']);
    expect(res.unique).toBe(false);
    expect(res.sound).toBe(false);
  });

  test('rejects a move that wins nothing', () => {
    // Nothing hanging: a quiet king step gains no material.
    const res = verifyTactic('4k3/8/8/8/8/8/8/3QK3 w - - 0 1', ['e1e2']);
    expect(res.sound).toBe(false);
    expect(res.gain).toBeLessThan(150);
  });
});
