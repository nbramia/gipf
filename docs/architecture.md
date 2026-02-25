# Architecture

## Separation of Concerns

The codebase is split into three independent modules:

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/YinshBoard.js` | 1,045 | Pure game logic -- state, rules, phase transitions. No React, no UI. |
| `src/YinshGame.jsx` | 1,178 | React UI -- SVG board rendering, modals, interaction handlers, localStorage. |
| `src/engine/mcts.js` | ~2,400 | AI engine -- MCTS algorithm, heuristic + NN evaluation, move categorization. |

This separation means the AI can simulate game logic without UI overhead, tests run without React, and each module can be understood independently.

Supporting files:

| File | Purpose |
|------|---------|
| `src/YinshNotation.js` (262 lines) | Chess-style move notation recording and export |
| `api/aiMove.js` (173 lines) | Vercel serverless function wrapping MCTS for API-mode AI |
| `src/engine/features.js` | Board state → NN input feature extraction |
| `src/engine/valueNetwork.js` | Browser ONNX inference (onnxruntime-web) |
| `src/engine/valueNetworkNode.js` | Node.js ONNX inference (onnxruntime-node) |
| `src/engine/aiPlayer.js` | Shared AI move interface for UI and CLI |
| `src/hooks/useAIWorker.js` | React hook managing MCTS Web Worker lifecycle |
| `src/YinshBoard.test.js` | 84 Jest tests covering all game logic |
| `src/testHelpers.js` | Board state fixtures and test utilities |

## Coordinate System

The board uses **axial hexagonal coordinates** `(q, r)` where both range from -5 to 5, with 8 corner positions excluded, giving 85 grid points total (of which 51 are playable intersections on the standard Yinsh board).

**Storage:** Board state is an object with string keys: `boardState["q,r"]` maps to `{type: 'ring'|'marker', player: 1|2}`.

**Screen conversion:**
```
x = q * 50 + r * 25 + 300
y = r * 43.3 + 300
```

**Six hexagonal directions:**
```
[1, 0]   East        [-1, 0]  West
[0, 1]   Southeast   [0, -1]  Northwest
[-1, 1]  Southwest   [1, -1]  Northeast
```

## Game Phase State Machine

The game is driven by a `gamePhase` string that determines what actions are valid:

```
setup ──> play ──> remove-row ──> remove-ring ──> play (loop)
                                       │
                                 (if score == 3)
                                       │
                                  game-over
```

**Setup:** Players alternate placing 5 rings each (10 total). After the 10th ring, phase transitions to `play`.

**Play:** Player selects a ring, moves it along a straight line. A marker is placed at the origin. Jumped markers are flipped. If any rows of 5 are formed, phase transitions to `remove-row`.

**Remove-row:** Player selects exactly 5 consecutive markers to remove. This uses a **queue-based iterative resolution system** -- the most complex logic in the codebase.

**Remove-ring:** Player sacrifices one of their own rings to score a point. If they reach 3 points, game over. Otherwise, check for new rows or return to play.

### Row Resolution Queue

When a move creates rows, a queue is built:

```javascript
rowResolutionQueue = [
  { player: activePlayer, rows: [...] },
  { player: opponent,     rows: [...] }
]
```

The active player resolves ONE row at a time. After each removal, the board is re-checked for new rows (which get added to the FRONT of the queue for immediate resolution). After the active player finishes, the opponent resolves their rows the same way. Only when the queue is empty does the game proceed to ring removal and then back to play.

This queue system is critical to rule compliance. Direct state manipulation (bypassing the queue) will corrupt game state.

## State Management

### Data Flow

```
User Click
  → YinshGame.handleIntersectionClick(q, r)
    → YinshBoard.handleClick(q, r)     // mutates internal state
      → YinshBoard._captureState()      // snapshot for undo/redo
    → setYinshBoard(board.clone())     // React re-render
```

**YinshBoard is the single source of truth.** React state holds a clone of it for rendering. After any mutation to the board, `.clone()` must be called to trigger a React re-render.

### Undo/Redo

`_captureState()` is called after every successful move in every game phase. It creates a deep snapshot of the complete game state (board, phase, scores, notation, queue state, etc.) and pushes it onto `stateHistory`.

- History is limited to 50 moves to prevent memory issues
- `undo()` and `redo()` restore from snapshots
- Redo history is cleared when a new move is made after an undo
- History is cleared on `startNewGame()`
- Test helpers use `skipInitialHistory: true` to avoid capturing an empty initial state

### localStorage Persistence

User preferences are stored in localStorage with these keys:

```
yinshDarkMode          boolean
yinshShowMoves         boolean
yinshRandomSetup       boolean
yinshKeepScore         boolean
yinshWins              {1: number, 2: number}
yinshShowMoveHistory   boolean
yinshEvaluationMode    'heuristic' | 'nn'
```

These keys must not be renamed or restructured without migration logic. Users expect their preferences and scores to persist across sessions.

## Key Methods

### YinshBoard.js

| Method | Purpose |
|--------|---------|
| `handleClick(q, r)` | Main entry point for all game phases. Routes to phase-specific logic. |
| `calculateValidMoves(q, r)` | Returns all legal destination squares for a ring at (q, r). |
| `_scanDirectionForMoves(q, r, dq, dr)` | Scans one direction for valid landing spots, handling marker jumping. |
| `checkForRows(boardState)` | Detects all completed rows (5+ consecutive markers), returns all valid 5-marker subsets. |
| `_findFullLine(q, r, dq, dr, player, boardState)` | Finds a full consecutive line of markers in one direction. |
| `_flipMarkersAlongPath(fromQ, fromR, toQ, toR, boardState)` | Flips all markers along a ring's movement path. |
| `_startNextRowResolution()` | Processes the next item in the row resolution queue. |
| `_captureState()` | Creates a state snapshot for undo/redo. |
| `clone()` | Deep-clones the board for React state updates and AI simulation. |

### YinshGame.jsx

| Function | Purpose |
|----------|---------|
| `handleIntersectionClick(q, r)` | User click handler -- delegates to `board.handleClick()`, then updates React state. |
| `getAISuggestion()` | Requests an AI move recommendation (API or local mode). |
| `executeAIMove(suggestion)` | Applies the AI's recommended move to the board. |

## Testing

84 tests in `YinshBoard.test.js` covering:

- Initialization and constants
- Setup phase ring placement
- Valid move calculation (jumping, blocking, directions)
- Marker placement and flipping
- Row detection (exact, overlapping, multi-directional)
- Win conditions and scoring
- State cloning and independence
- Row/ring removal operations
- Row resolution queue (multi-row, opponent rows)
- Undo/redo across all phases

Run with `CI=true npm test`. All must pass before deployment.
