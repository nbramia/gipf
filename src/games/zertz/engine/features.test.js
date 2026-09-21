import Board from '../ZertzBoard';
import { extractFeatures, augmentFeatures, featureSchema, modelFeatureSchema } from './features';

function captureBoard(jumper) {
  const board = new Board();
  board.gamePhase = 'capture';
  board.marbles = { '0,0': 'black', '1,0': 'grey', '-1,1': 'white', '-1,0': 'grey' };
  board.jumpingMarble = jumper;
  return board;
}

test('v2 distinguishes different forced continuations that collide in legacy v1', () => {
  const a = captureBoard('0,0'), b = captureBoard('-1,1');
  expect(a.getJumpTargets(a.jumpingMarble)).not.toEqual(b.getJumpTargets(b.jumpingMarble));
  expect(extractFeatures(a, 1)).toEqual(extractFeatures(b, 1));
  const fa = extractFeatures(a), fb = extractFeatures(b);
  expect(fa.board.length).toBe(294);
  expect(fa.meta).toEqual(fb.meta);
  expect(fa.board.slice(0, 245)).toEqual(extractFeatures(a, 1).board);
  expect(fa.board).not.toEqual(fb.board);
  expect(fa.board[245 + 24]).toBe(1);
  expect(fb.board[245 + 4 * 7 + 2]).toBe(1);
});

test('v2 has no forced identity before selection or outside capture; invalid identities fail', () => {
  const board = captureBoard(null);
  expect(Array.from(extractFeatures(board).board.slice(245)).every(x => x === 0)).toBe(true);
  board.jumpingMarble = '0,0';
  board.gamePhase = 'place-marble';
  expect(Array.from(extractFeatures(board).board.slice(245)).every(x => x === 0)).toBe(true);
  board.gamePhase = 'capture'; board.jumpingMarble = '3,3';
  expect(() => extractFeatures(board)).toThrow('Invalid ZERTZ forced jumping marble');
});

test('rotation moves the sixth plane with the marble, and preserves explicit v1 shape', () => {
  const features = extractFeatures(captureBoard('-1,1'));
  const rotations = augmentFeatures(features.board, features.meta);
  let q = -1, r = 1;
  for (const rotated of rotations) {
    const index = (r + 3) * 7 + q + 3;
    expect(rotated.board[245 + index]).toBe(1);
    expect(rotated.board[49 + index]).toBe(1); // the same white marble
    expect(rotated.meta).toEqual(features.meta);
    [q, r] = [-r, q + r];
  }
  const legacy = extractFeatures(captureBoard('-1,1'), 1);
  expect(augmentFeatures(legacy.board, legacy.meta).every(f => f.board.length === 245)).toBe(true);
});

test('unknown feature/model schemas never silently become v1', () => {
  expect(() => featureSchema(3)).toThrow('Unsupported');
  expect(() => extractFeatures(new Board(), '2')).toThrow('Unsupported');
  expect(() => modelFeatureSchema({ inputNames: ['board_input', 'meta_v3_input'] })).toThrow('Unsupported');
  expect(() => augmentFeatures(new Float32Array(343), new Float32Array(12))).toThrow('Unsupported');
});
