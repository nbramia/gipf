// testPositions.js
// Curated board positions with great/good/bad move tiers for AI evaluation.
// Each position has 5 rings per player and the current player set.

const testPositions = [
  // ============================================================================
  // DEFENSIVE BLOCKING (1-3)
  // ============================================================================
  {
    id: 'block-opponent-3-horizontal',
    name: 'Block opponent 3-in-a-row (horizontal)',
    description: 'P2 has 3 markers in a horizontal row. P1 ring at [-1,0] can jump over all 3 and flip them.',
    player: 1,
    rings: {
      1: [[-1, 0], [0, -2], [-3, 2], [-2, -1], [4, -3]],
      2: [[-3, 4], [3, -4], [-1, 3], [2, -2], [1, 2]]
    },
    markers: {
      1: [[-2, 1], [3, -1]],
      2: [[0, 0], [1, 0], [2, 0], [1, -1]]
    },
    moves: {
      great: [{ from: [-1, 0], to: [3, 0] }],   // Jumps over and flips all 3 P2 markers
      good: [{ from: [0, -2], to: [1, -2] }],    // Develops position, doesn't address threat
      bad: [{ from: [-1, 0], to: [-1, 1] }]      // Moves blocking ring away from threat
    }
  },
  {
    id: 'block-opponent-4-horizontal',
    name: 'Block opponent 4-in-a-row (critical)',
    description: 'P2 has 4 markers in a horizontal row. P1 must jump and flip to prevent scoring.',
    player: 1,
    rings: {
      1: [[-1, 1], [0, -3], [-3, 2], [-2, -1], [4, -3]],
      2: [[-3, 4], [3, -4], [-1, 4], [4, -2], [2, 3]]
    },
    markers: {
      1: [[0, -1], [2, -1], [-2, 2]],
      2: [[0, 1], [1, 1], [2, 1], [3, 1]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [4, 1] }],    // Jumps over 4 P2 markers, flips them all
      good: [{ from: [-2, -1], to: [-2, 0] }],   // Safe development
      bad: [{ from: [4, -3], to: [3, -3] }]       // Edge move, ignores critical P2 threat
    }
  },
  {
    id: 'block-opponent-3-diagonal',
    name: 'Block opponent 3-in-a-row (diagonal)',
    description: 'P2 has 3 markers in a diagonal [1,-1] row. P1 ring at [-1,1] can flip them.',
    player: 1,
    rings: {
      1: [[-1, 1], [-2, 3], [-3, 0], [3, -4], [4, -1]],
      2: [[-4, 3], [3, 0], [-1, -3], [2, 2], [0, 3]]
    },
    markers: {
      1: [[-1, 2], [1, 1], [-2, -1]],
      2: [[0, 0], [1, -1], [2, -2], [0, -2]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [3, -3] }],   // Jumps over 3 P2 diagonal markers, flips them
      good: [{ from: [-3, 0], to: [-2, 0] }],    // Develops ring toward center
      bad: [{ from: [3, -4], to: [2, -4] }]       // Pointless edge move
    }
  },

  // ============================================================================
  // OFFENSIVE COMPLETION (4-5)
  // ============================================================================
  {
    id: 'complete-own-4-horizontal',
    name: 'Complete own 4-in-a-row (horizontal)',
    description: 'P1 has 4 markers in a horizontal row. Ring at [-1,0] can move away to leave 5th marker.',
    player: 1,
    rings: {
      1: [[-1, 0], [-3, 2], [-2, -2], [3, -3], [0, 4]],
      2: [[-4, 3], [3, 1], [-1, -3], [2, 3], [4, -2]]
    },
    markers: {
      1: [[0, 0], [1, 0], [2, 0], [3, 0]],
      2: [[0, 2], [1, 2], [-1, -1], [2, -1]]
    },
    moves: {
      great: [{ from: [-1, 0], to: [-2, 0] }],   // Ring moves West, leaves marker completing 5-in-a-row
      good: [{ from: [3, -3], to: [2, -3] }],    // Safe ring development
      bad: [{ from: [-1, 0], to: [4, 0] }]        // Jumps East over own 4 markers, flips them to P2!
    }
  },
  {
    id: 'complete-own-4-diagonal',
    name: 'Complete own 4-in-a-row (diagonal)',
    description: 'P1 has 4 markers in diagonal [1,-1]. Ring at [-1,1] moving away completes the row.',
    player: 1,
    rings: {
      1: [[-1, 1], [-3, 3], [-2, -2], [3, 1], [0, -4]],
      2: [[-4, 2], [4, -1], [-1, -3], [2, 3], [-2, 4]]
    },
    markers: {
      1: [[0, 0], [1, -1], [2, -2], [3, -3]],
      2: [[0, 2], [1, 2], [2, 2], [-1, -2]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [-2, 1] }],   // Ring moves West, leaves marker at [-1,1] completing diagonal
      good: [{ from: [0, -4], to: [1, -4] }],    // Edge ring development
      bad: [{ from: [-1, 1], to: [4, -4] }]       // Jumps through own 4 markers flipping them to P2
    }
  },

  // ============================================================================
  // FLIP OPTIMIZATION (6-7)
  // ============================================================================
  {
    id: 'flip-opponent-markers',
    name: 'Flip opponent markers (offensive flipping)',
    description: 'P1 ring at [0,0] can jump East over 2 P2 markers, flipping them. Better than safe moves.',
    player: 1,
    rings: {
      1: [[0, 0], [-1, 2], [-3, -1], [3, -3], [4, 1]],
      2: [[-4, 1], [3, 2], [-2, 4], [1, -4], [4, -3]]
    },
    markers: {
      1: [[-2, 1], [1, -2], [2, 2]],
      2: [[1, 0], [2, 0], [0, 3], [-2, 2]]
    },
    moves: {
      great: [{ from: [0, 0], to: [3, 0] }],     // Flips 2 P2 markers to P1 (offensive capture)
      good: [{ from: [-1, 2], to: [-1, 3] }],    // Safe development, no flips
      bad: [{ from: [0, 0], to: [0, -1] }]        // Ignores flip opportunity, moves away
    }
  },
  {
    id: 'avoid-flipping-own',
    name: 'Avoid flipping own markers',
    description: 'P1 ring at [0,0] has path East through own markers. Moving East flips them to P2. Move elsewhere.',
    player: 1,
    rings: {
      1: [[0, 0], [-2, -1], [-4, 4], [3, -4], [4, -1]],
      2: [[-4, 2], [3, 2], [-1, 4], [2, -3], [4, -4]]
    },
    markers: {
      1: [[1, 0], [2, 0], [-1, -2], [0, -2]],
      2: [[0, 3], [1, 3], [-2, 1], [-3, 2]]
    },
    moves: {
      great: [{ from: [0, 0], to: [0, 1] }],     // Safe move, no flips
      good: [{ from: [-2, -1], to: [-2, 0] }],   // Safe ring development
      bad: [{ from: [0, 0], to: [3, 0] }]         // Flips 2 own markers to P2!
    }
  },

  // ============================================================================
  // COMBINED OFFENSE/DEFENSE (8-9)
  // ============================================================================
  {
    id: 'simultaneous-block-and-build',
    name: 'Block opponent + build own row',
    description: 'P2 has 3-in-a-row horizontal at r=1. P1 can jump over them, flipping to P1, building P1 4-in-a-row.',
    player: 1,
    rings: {
      1: [[-1, 1], [-3, 0], [-2, -2], [3, -3], [4, -1]],
      2: [[-4, 3], [3, -4], [-1, 3], [2, -2], [4, 0]]
    },
    markers: {
      1: [[-1, 0], [0, 0], [1, 0]],
      2: [[0, 1], [1, 1], [2, 1]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [3, 1] }],    // Flips 3 P2 markers + creates P1 4-in-a-row at r=1
      good: [{ from: [-3, 0], to: [-2, 0] }],    // Safe ring development toward center
      bad: [{ from: [4, -1], to: [3, -1] }]       // Random edge move ignoring threats
    }
  },
  {
    id: 'block-diagonal-build-horizontal',
    name: 'Block P2 diagonal + build P1 horizontal',
    description: 'P2 has 3 diag markers. P1 can flip them and the result extends P1 horizontal row to 4.',
    player: 1,
    rings: {
      1: [[-1, 1], [-4, 0], [3, 1], [4, -1], [0, -3]],
      2: [[-4, 3], [3, -4], [-2, 3], [2, 2], [4, -3]]
    },
    markers: {
      1: [[-1, 0], [-2, 0], [-3, 0]],
      2: [[0, 0], [1, -1], [2, -2]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [3, -3] }],   // Flips 3 P2 diag markers; [0,0] becomes P1 → P1 has [-3,0]...[0,0] = 4-in-a-row
      good: [{ from: [0, -3], to: [1, -3] }],    // Develops ring
      bad: [{ from: [4, -1], to: [3, 0] }]        // Ignores P2 diagonal threat
    }
  },

  // ============================================================================
  // TRAP AVOIDANCE (10-11)
  // ============================================================================
  {
    id: 'trap-flip-creates-opponent-4',
    name: 'Trap: flipping own marker gives opponent 4-in-a-row',
    description: 'P1 ring at [0,0] moving East flips P1 marker at [1,0] to P2, creating P2 4-in-a-row vertically.',
    player: 1,
    rings: {
      1: [[0, 0], [-2, -1], [-3, 2], [3, -3], [4, -1]],
      2: [[-4, 3], [3, 1], [-1, -3], [2, 3], [4, -3]]
    },
    markers: {
      1: [[1, 0], [-1, -2], [2, -1]],
      2: [[1, 1], [1, 2], [1, 3], [-2, 2]]
    },
    moves: {
      great: [{ from: [0, 0], to: [-1, 1] }],    // SW move, avoids flipping blocker at [1,0]
      good: [{ from: [-2, -1], to: [-1, -1] }],  // Safe ring development
      bad: [{ from: [0, 0], to: [2, 0] }]         // East: flips [1,0] P1→P2, giving P2 4-in-a-row at [1,0]-[1,3]
    }
  },
  {
    id: 'trap-tempting-extension',
    name: 'Trap: extending own row enables opponent win',
    description: 'P1 can extend to 3-in-a-row but the move flips a key blocker, letting P2 score next turn.',
    player: 1,
    rings: {
      1: [[0, -1], [-3, 1], [-2, -2], [3, -3], [4, -1]],
      2: [[-4, 3], [3, -2], [-1, -3], [2, 3], [-3, 4]]
    },
    markers: {
      1: [[0, 0], [0, 1], [1, -1]],
      2: [[-1, 0], [-1, 1], [-1, 2], [-1, 3], [2, -2]]
    },
    moves: {
      // P2 has 4-in-a-row at [-1,0] to [-1,3]! If P1 marker at [0,0] gets flipped to P2, nothing blocks.
      // But P1 ring [0,-1] moving SE (dir [0,1]) to [0,2] jumps over [0,0](P1),[0,1](P1) flipping them to P2.
      // Now P2 has [0,0],[0,1] (flipped) but the critical thing: P2 already has 4 markers at [-1,x].
      // The real trap: flipping [0,0] doesn't directly help P2's [-1,x] row, but it weakens P1.
      great: [{ from: [-3, 1], to: [-2, 1] }],   // Safe development, doesn't disturb blockers
      good: [{ from: [3, -3], to: [2, -3] }],    // Another safe development
      bad: [{ from: [0, -1], to: [0, 2] }]        // Flips own markers [0,0],[0,1] to P2
    }
  },

  // ============================================================================
  // POSITIONAL PLAY (12-13)
  // ============================================================================
  {
    id: 'positional-center-control',
    name: 'Positional: prefer center over edge',
    description: 'No immediate tactics. P1 should develop ring toward center rather than make edge moves.',
    player: 1,
    rings: {
      1: [[-2, 0], [-1, -2], [2, -3], [3, 1], [0, 3]],
      2: [[-3, 3], [-1, 4], [1, -4], [4, -2], [3, -1]]
    },
    markers: {
      1: [[-1, 1], [0, -1], [1, 0], [2, 0]],
      2: [[0, 2], [-2, 3], [1, -1], [3, -2]]
    },
    moves: {
      great: [{ from: [2, -3], to: [1, -2] }],   // Moves edge ring toward center
      good: [{ from: [-2, 0], to: [-1, 0] }],    // Develops toward center
      bad: [{ from: [0, 3], to: [0, 4] }]         // Moves ring further to edge
    }
  },
  {
    id: 'positional-ring-mobility',
    name: 'Positional: maintain ring mobility',
    description: 'No immediate tactics. P1 should avoid moving ring to a cramped position near markers.',
    player: 1,
    rings: {
      1: [[0, 0], [-3, 1], [-2, -2], [3, -2], [1, 3]],
      2: [[-4, 2], [-1, -3], [4, -1], [2, 2], [0, 4]]
    },
    markers: {
      1: [[1, -1], [-1, 0], [-2, 1], [0, 2]],
      2: [[-1, 2], [2, -1], [1, 1], [-2, 3], [3, -1]]
    },
    moves: {
      great: [{ from: [0, 0], to: [0, -1] }],    // Open position with good mobility
      good: [{ from: [-3, 1], to: [-3, 2] }],    // Safe move maintaining spread
      bad: [{ from: [0, 0], to: [0, 1] }]         // Moves into cluster of markers, reducing mobility
    }
  },

  // ============================================================================
  // SELF-FLIP AVOIDANCE (14-15)
  // ============================================================================
  {
    id: 'self-flip-avoidance-horizontal',
    name: 'Self-flip avoidance (horizontal)',
    description: 'P1 ring at [-1,0] has P1 markers at [0,0],[1,0] in path East. Jumping flips own markers to P2.',
    player: 1,
    rings: {
      1: [[-1, 0], [-3, 2], [3, -3], [4, -1], [0, -3]],
      2: [[-4, 3], [3, 1], [-1, -3], [2, 3], [4, -3]]
    },
    markers: {
      1: [[0, 0], [1, 0], [-2, 1], [0, -2]],
      2: [[-1, 2], [2, -1], [0, 2], [-2, -1]]
    },
    moves: {
      great: [{ from: [-1, 0], to: [-1, -1] }],  // NW move, avoids self-flip
      good: [{ from: [-3, 2], to: [-2, 2] }],    // Safe ring development
      bad: [{ from: [-1, 0], to: [2, 0] }]        // Jumps East, flips own [0,0],[1,0] to P2
    }
  },
  {
    id: 'self-flip-avoidance-diagonal',
    name: 'Self-flip avoidance (diagonal)',
    description: 'P1 ring at [-1,1] has P1 markers along [1,-1] diagonal. Jumping flips own markers to P2.',
    player: 1,
    rings: {
      1: [[-1, 1], [-3, 0], [3, 1], [4, -1], [0, -3]],
      2: [[-4, 3], [3, -4], [-2, 4], [2, 2], [4, -3]]
    },
    markers: {
      1: [[0, 0], [1, -1], [2, -2], [-2, 1]],
      2: [[-1, -1], [0, 3], [1, 2], [3, -2]]
    },
    moves: {
      great: [{ from: [-1, 1], to: [-2, 2] }],   // SW move, avoids flipping own diagonal
      good: [{ from: [-3, 0], to: [-2, 0] }],    // Safe development
      bad: [{ from: [-1, 1], to: [3, -3] }]       // Jumps through own 3 markers [0,0],[1,-1],[2,-2], flips to P2
    }
  }
];

export default testPositions;
