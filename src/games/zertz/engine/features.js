// Feature extraction for Zertz neural network
// Converts board state to tensor format for the value network

// 7x7 grid maps the 37-hex board (q+3, r+3)
const GRID_SIZE = 7;
const OFFSET = 3;
const FEATURE_VERSION = 2;
const LEGACY_NUM_PLANES = 5;
const NUM_PLANES = 6;
const NUM_META = 12;

export function featureSchema(version) {
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported ZERTZ feature version: ${version}`);
  }
  return { version, numPlanes: version === 1 ? LEGACY_NUM_PLANES : NUM_PLANES,
    boardInput: version === 1 ? 'board_input' : 'board_v2_input', metaInput: 'meta_input' };
}

// Input names are the runtime-readable schema tag (older native ORT has no
// inputMetadata/custom-metadata API). The load-time inference probe also checks shapes.
export function modelFeatureSchema(session) {
  const names = session.inputNames;
  const version = names?.includes('board_v2_input') ? 2 : 1;
  const schema = featureSchema(version);
  if (names?.length !== 2 || !names.includes(schema.boardInput) || !names.includes(schema.metaInput)) {
    throw new Error(`Unsupported ZERTZ model input schema: ${JSON.stringify(names)}`);
  }
  return schema;
}

/**
 * Check if (q, r) is a valid hex position
 */
function isValidHex(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3;
}

/**
 * Extract feature planes from a ZertzBoard.
 * V2: 6x7x7 planes; explicit v1: the original 5x7x7 planes. Both have 12 meta scalars.
 * Features are always from the current player's perspective.
 */
export function extractFeatures(board, version = FEATURE_VERSION) {
  const { numPlanes } = featureSchema(version);
  const boardFeatures = new Float32Array(numPlanes * GRID_SIZE * GRID_SIZE);
  const metaFeatures = new Float32Array(NUM_META); // 12

  const currentPlayer = board.currentPlayer;
  const opponent = currentPlayer === 1 ? 2 : 1;

  // Fill board feature planes
  for (let q = -OFFSET; q <= OFFSET; q++) {
    for (let r = -OFFSET; r <= OFFSET; r++) {
      if (!isValidHex(q, r)) continue;

      const gi = q + OFFSET;
      const gj = r + OFFSET;
      const idx = gj * GRID_SIZE + gi; // row-major within each plane
      const key = `${q},${r}`;

      // Plane 0: Ring present
      if (board.rings.has(key)) {
        boardFeatures[0 * GRID_SIZE * GRID_SIZE + idx] = 1.0;
      }

      // Plane 1-3: Marble colors
      const marble = board.marbles[key];
      if (marble === 'white') {
        boardFeatures[1 * GRID_SIZE * GRID_SIZE + idx] = 1.0;
      } else if (marble === 'grey') {
        boardFeatures[2 * GRID_SIZE * GRID_SIZE + idx] = 1.0;
      } else if (marble === 'black') {
        boardFeatures[3 * GRID_SIZE * GRID_SIZE + idx] = 1.0;
      }

      // Plane 4: Free (removable) rings
      // Computed lazily only if we have rings
      if (board.rings.has(key) && !board.marbles[key]) {
        // Check if this ring is free (has consecutive missing neighbors)
        // Use a simplified check matching board._canSlideAway
        const circularDirs = [
          [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
        ];
        const present = circularDirs.map(dir => {
          const nKey = `${q + dir[0]},${r + dir[1]}`;
          return board.rings.has(nKey);
        });
        const count = present.filter(Boolean).length;
        let canSlide = count <= 1;
        if (!canSlide) {
          for (let i = 0; i < 6; i++) {
            if (!present[i] && !present[(i + 1) % 6]) {
              canSlide = true;
              break;
            }
          }
        }
        if (canSlide) {
          boardFeatures[4 * GRID_SIZE * GRID_SIZE + idx] = 1.0;
        }
      }
    }
  }

  // Plane 5: forced continuation identity; all zero before a jumping marble is
  // selected and in non-capture phases. Never reconstruct it from occupancy.
  if (version === 2 && board.gamePhase === 'capture' && board.jumpingMarble != null) {
    const [q, r] = board.jumpingMarble.split(',').map(Number);
    if (!Number.isInteger(q) || !Number.isInteger(r) || !isValidHex(q, r) ||
        !board.rings.has(board.jumpingMarble) || !board.marbles[board.jumpingMarble]) {
      throw new Error('Invalid ZERTZ forced jumping marble');
    }
    boardFeatures[5 * GRID_SIZE * GRID_SIZE + (r + OFFSET) * GRID_SIZE + q + OFFSET] = 1;
  }

  // Meta features (12 scalars)
  const myCaps = board.captures[currentPlayer];
  const oppCaps = board.captures[opponent];

  // 0-2: Current player captures (W/G/B), normalized
  metaFeatures[0] = myCaps.white / 6;
  metaFeatures[1] = myCaps.grey / 8;
  metaFeatures[2] = myCaps.black / 10;

  // 3-5: Opponent captures (W/G/B), normalized
  metaFeatures[3] = oppCaps.white / 6;
  metaFeatures[4] = oppCaps.grey / 8;
  metaFeatures[5] = oppCaps.black / 10;

  // 6-8: Pool remaining (W/G/B), normalized
  metaFeatures[6] = board.pool.white / 6;
  metaFeatures[7] = board.pool.grey / 8;
  metaFeatures[8] = board.pool.black / 10;

  // 9: Board size
  metaFeatures[9] = board.rings.size / 37;

  // 10: Phase encoding
  const phaseMap = {
    'place-marble': 0.0,
    'remove-ring': 0.33,
    'capture': 0.66,
    'game-over': 1.0,
  };
  metaFeatures[10] = phaseMap[board.gamePhase] || 0.0;

  // 11: Current player (0.0=P1, 1.0=P2)
  metaFeatures[11] = currentPlayer === 1 ? 0.0 : 1.0;

  return { board: boardFeatures, meta: metaFeatures };
}

/**
 * Apply 6-fold hex rotation augmentation for training data.
 * Returns array of 6 rotated { board, meta } feature sets.
 */
export function augmentFeatures(boardFeatures, metaFeatures) {
  const numPlanes = boardFeatures.length / (GRID_SIZE * GRID_SIZE);
  if (![LEGACY_NUM_PLANES, NUM_PLANES].includes(numPlanes) || metaFeatures.length !== NUM_META) {
    throw new Error('Unsupported ZERTZ augmentation feature shape');
  }
  const results = [{ board: boardFeatures, meta: metaFeatures }];

  // 5 additional rotations (60, 120, 180, 240, 300 degrees)
  for (let rot = 1; rot <= 5; rot++) {
    const rotated = new Float32Array(boardFeatures.length);

    for (let q = -OFFSET; q <= OFFSET; q++) {
      for (let r = -OFFSET; r <= OFFSET; r++) {
        if (!isValidHex(q, r)) continue;

        // Apply rotation
        let rq = q, rr = r;
        for (let i = 0; i < rot; i++) {
          const tmp = rq;
          rq = -rr;
          rr = tmp + rr;
        }

        if (!isValidHex(rq, rr)) continue;

        const srcGi = q + OFFSET;
        const srcGj = r + OFFSET;
        const srcIdx = srcGj * GRID_SIZE + srcGi;

        const dstGi = rq + OFFSET;
        const dstGj = rr + OFFSET;
        const dstIdx = dstGj * GRID_SIZE + dstGi;

        for (let plane = 0; plane < numPlanes; plane++) {
          rotated[plane * GRID_SIZE * GRID_SIZE + dstIdx] =
            boardFeatures[plane * GRID_SIZE * GRID_SIZE + srcIdx];
        }
      }
    }

    results.push({ board: rotated, meta: new Float32Array(metaFeatures) });
  }

  return results;
}

export { GRID_SIZE, OFFSET, NUM_PLANES, NUM_META, FEATURE_VERSION, LEGACY_NUM_PLANES };
