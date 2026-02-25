# Yinsh AI System - Comprehensive Analysis

## Executive Summary

**Status:** ❌ **NON-FUNCTIONAL** - AI cannot make moves in any game phase

**Root Cause:** The MCTS implementation (src/engine/mcts.js) was written for an older version of YinshBoard with a different API. After the comprehensive refactoring (v0.2.0), the AI is now completely incompatible.

## Critical Issues Found

### 1. **Missing Methods - BLOCKING** ❌

The MCTS code calls methods that don't exist on YinshBoard:

| Method Called | Location | Actual Status |
|--------------|----------|---------------|
| `board.isValidRingPlacement(q, r)` | mcts.js:1360 | ❌ Does not exist |
| `board.hasCompletedRow(player)` | mcts.js:812, 1537 | ❌ Does not exist |
| `board.getCompletedRows(player)` | mcts.js:1337 | ❌ Does not exist |
| `board.getValidMoves(q, r)` | mcts.js:1395 | ✅ EXISTS |

**Impact:** Immediate crashes when AI tries to generate legal moves in setup phase.

**Test Evidence:**
```javascript
const board = new YinshBoard();
board.isValidRingPlacement(0, 0);
// TypeError: board.isValidRingPlacement is not a function
```

---

### 2. **Phase Name Mismatches - BLOCKING** ❌

YinshBoard uses different phase names than MCTS expects:

| MCTS Expects | YinshBoard Uses | Locations |
|--------------|----------------|-----------|
| `'place-rings'` | `'setup'` | mcts.js:804, 1327 |
| `'move-ring'` | `'play'` | mcts.js:809, 1334 |
| `'REMOVE_RING'` (caps) | `'remove-ring'` | mcts.js:987 |
| `'remove-row'` | `'remove-row'` | ✅ Match |
| `'remove-ring'` | `'remove-ring'` | ✅ Match |

**Impact:** Switch statements fail to match, causing AI to fall through to default cases or return empty move lists.

---

### 3. **Type Confusion in evaluatePosition - CRASHES** ❌

There are THREE different implementations of `evaluatePosition()`:

1. **MCTSNode.evaluatePosition()** (lines 128-367) - Returns object with myScoring, oppScoring, etc.
2. **MCTS.evaluatePosition()** (lines 424-663) - Returns object (arrow function)
3. **MCTS.evaluatePosition()** (lines 1520-1554) - Returns NUMBER (line 1553: `return score;`)

**The Bug:**
```javascript
// Line 1151 - calls version #3, which returns a number
const evaluation = this.evaluatePosition(board, board.getCurrentPlayer());

// Line 1154 - tries to access .myScoring.length on that number
if (evaluation.myScoring.length > 0) {  // ❌ CRASH!
```

**Test Evidence:**
```
Initial evaluation: 0
ERROR: Cannot read properties of undefined (reading 'length')
```

---

### 4. **Missing Helper Functions - CRASHES** ❌

Functions called but never defined:

```javascript
// Line 1533 - called from evaluatePosition
const evaluation = this._evaluateBasicPosition(board, currentPlayer);
// ❌ _evaluateBasicPosition is NEVER DEFINED

// Line 1527 - called from evaluatePosition
score += this._evaluateRingSpread(board, currentPlayer);
// ❌ _evaluateRingSpread is NEVER DEFINED
```

---

### 5. **MCTS Tree Never Grows - LOGIC ERROR** ❌

The core MCTS algorithm is broken:

```javascript
// Lines 1172-1187: Main MCTS loop in getBestMove()
for (let i = 0; i < numSimulations; i++) {
  let node = this.select(rootNode);           // 1. Select node
  let childNode = this.expand(node);          // 2. Expand node
  if (childNode) {
    const result = this.simulate(childNode);  // 3. Simulate
    this.backpropagate(childNode, result);    // 4. Backpropagate
  }
}
```

**The Problem:**
```javascript
// Lines 685-714: expand() function
expand(node) {
  const moves = this._getLegalMovesForSimulation(node.board);
  // ... select a move ...
  const newBoard = node.board.clone();
  this._applyMove(newBoard, selectedMove);

  return new MCTSNode(newBoard, node);  // Creates child
  // ❌ BUT NEVER ADDS IT TO node.children Map!
}
```

**Result:** The MCTS search tree never actually grows. Each simulation explores in isolation without building the tree structure needed for UCB1 selection to work.

---

### 6. **Move Type Inconsistencies - BLOCKING** ❌

Different parts use different type naming:

```javascript
// getRingPlacements() returns:
{ type: 'place_ring', ... }      // underscore

// getRowRemovals() returns:
{ type: 'remove_row', ... }      // underscore

// But _applyMove() checks:
switch (move.type) {
  case 'remove-row':             // hyphen ❌ NEVER MATCHES
  case 'remove-ring':            // hyphen ❌ NEVER MATCHES
```

**Impact:** Move application fails, simulations break.

---

### 7. **State Corruption in _applyMove - CRITICAL** ❌

Lines 1556-1588 directly manipulate board internals, bypassing the queue system:

```javascript
_applyMove(board, move) {
  switch (move.type) {
    case 'remove-row':
      for (const [q, r] of move.row) {
        delete board.boardState[`${q},${r}`];  // ❌ Direct manipulation
      }
      board.gamePhase = 'remove-ring';         // ❌ Bypasses queue system
      break;

    case 'remove-ring':
      delete board.boardState[...];            // ❌ Direct manipulation
      board.scores[board.currentPlayer]++;     // ❌ Bypasses validation
      board.currentPlayer = 3 - board.currentPlayer;  // ❌ Wrong!
      break;
  }
}
```

**Why This Is Critical:**
- The comprehensive refactoring (v0.2.0) implemented a queue-based row resolution system
- Multiple rows can exist simultaneously (player's + opponent's)
- Direct state manipulation corrupts the queue and violates game rules
- This was one of the 5 critical bugs that v0.2.0 fixed!

---

### 8. **getLegalMoves Returns Empty Array in Setup - BLOCKING** ❌

```javascript
// MCTSNode.getLegalMoves() - Lines 85-126
getLegalMoves() {
  if (this.untriedMoves === null) {
    const allMoves = [];
    const points = YinshBoard.generateGridPoints();

    for (const [q, r] of points) {
      const piece = this.board.getBoardState()[`${q},${r}`];
      // Looking for rings to move:
      if (piece && piece.type === 'ring' &&
          piece.player === this.board.getCurrentPlayer()) {
        // Add moves for this ring...
      }
    }
  }
}
```

**The Problem:** In setup phase, there are NO rings on the board yet! This returns an empty array, causing immediate crash at line 1154.

---

## API Compatibility Analysis

### What MCTS Expects (Old API):
```javascript
board.isValidRingPlacement(q, r)  // Check if position valid for ring
board.hasCompletedRow(player)      // Check if player has completed row
board.getCompletedRows(player)     // Get all completed rows
board.getValidMoves(q, r)          // Get valid moves for ring at q,r
// Phase names: 'place-rings', 'move-ring', 'REMOVE_RING'
```

### What YinshBoard v0.2.0 Actually Has:
```javascript
board.handleClick(q, r)            // State-driven interaction
board.calculateValidMoves(q, r)    // Calculate valid moves
board.getValidMoves()              // Get moves for selected ring
board.checkForRows()               // Check for rows (returns array)
board.getBoardState()              // Get board state
board.getGamePhase()               // Returns: 'setup', 'play', 'remove-row', 'remove-ring'
// Queue-based row resolution system
// No direct methods for checking ring placement validity
```

**Conclusion:** The APIs are fundamentally incompatible. MCTS was built for a different board implementation.

---

## Testing Results

### Test 1: Setup Phase
```bash
$ node test-ai.js
Game phase: setup
Testing AI in setup phase...
Legal moves at root: 0
ERROR: Cannot read properties of undefined (reading 'length')
```
**Result:** ❌ FAIL - Empty move list, type error

### Test 2: Play Phase
```bash
$ node test-ai.js
Game phase: setup  # Still setup - rings didn't place
ERROR: Cannot read properties of undefined (reading 'length')
```
**Result:** ❌ FAIL - Can't even set up test board properly

---

## Architecture Assessment

### ✅ **What's Good:**

1. **MCTS Algorithm Choice** - MCTS is appropriate for Yinsh
2. **Transposition Tables** - Good optimization for state caching
3. **Position Evaluation** - Comprehensive heuristics (when they work):
   - Row detection (3s, 4s, 5s)
   - Ring mobility and positioning
   - Marker clustering and vulnerability
   - Center control
   - Scoring opportunities

4. **Move Categorization** - 'best', 'good', 'neutral', 'bad' is sound approach

### ❌ **What's Broken:**

1. **API Integration** - Calls methods that don't exist
2. **Phase Handling** - Wrong phase names throughout
3. **Core MCTS Loop** - Tree doesn't grow (expand() bug)
4. **Type Safety** - evaluatePosition returns wrong types
5. **Move Application** - Corrupts board state
6. **Code Duplication** - Multiple implementations of same functions

### ⚠️ **What Needs Improvement:**

1. **Shallow Playouts** - MAX_PLAYOUT_DEPTH = 10 is very shallow for Yinsh
2. **Simulation Quality** - Weighted random is good but could be smarter
3. **Time Management** - Fixed simulation count, should be time-based
4. **Evaluation Tuning** - Heuristic weights not tuned/tested

---

## Recommended Approach

### Option 1: **Fix Existing MCTS** (Recommended for MVP)

**Pros:**
- Most of the evaluation logic is sound
- MCTS approach is appropriate
- Can get to "moderately strong" quickly

**Cons:**
- Significant refactoring needed
- Won't reach "extremely strong" without more work

**Estimated Effort:** 4-8 hours of focused work

**Steps:**
1. Create adapter layer between MCTS and YinshBoard v0.2.0
2. Fix phase name mismatches
3. Implement missing helper methods
4. Fix expand() to actually build tree
5. Fix evaluatePosition type consistency
6. Fix _applyMove to use board API properly
7. Test in all game phases
8. Tune heuristic weights

---

### Option 2: **AlphaZero-Style Neural Network** (For "Extremely Strong")

**Pros:**
- Can achieve superhuman play
- Self-play training improves over time
- Generalizes well to complex positions

**Cons:**
- Requires significant infrastructure:
  - Training pipeline with self-play
  - Neural network architecture (policy + value heads)
  - GPU resources for training
  - 10,000+ games for training data
- Development time: 2-4 weeks
- Complexity: High

**Components Needed:**
1. Neural network model (TensorFlow.js or PyTorch)
2. Self-play engine to generate training games
3. Training loop with game outcome labeling
4. MCTS guided by neural network policy/value
5. Model versioning and iteration

---

### Option 3: **Hybrid Approach** (Best Long-Term)

**Phase 1:** Fix existing MCTS (1 week)
- Get to "moderately strong" player
- Provides playable opponent immediately

**Phase 2:** Improve heuristics with expert knowledge (1 week)
- Analyze human expert games
- Tune evaluation weights
- Add opening book
- Reach "strong" player level

**Phase 3:** Neural network enhancement (3-4 weeks)
- Train small network on expert games
- Use network to guide MCTS policy
- Self-play for further improvement
- Reach "extremely strong" level

---

## Next Steps

**Immediate (To get AI working):**

1. ✅ Complete deep analysis (DONE)
2. ⬜ Mark current analysis todo as complete
3. ⬜ Fix critical bugs preventing AI from running:
   - Create adapter layer with missing methods
   - Fix phase name consistency
   - Fix expand() to build tree properly
   - Fix evaluatePosition type consistency
   - Fix _applyMove to use board API
4. ⬜ Test AI in all game phases
5. ⬜ Tune heuristics for basic competence
6. ⬜ Deploy working AI

**Short-Term (To reach "moderately strong"):**
- Improve playout depth and quality
- Better move ordering in MCTS
- Opening position knowledge
- Endgame heuristics

**Long-Term (To reach "extremely strong"):**
- Implement self-play training infrastructure
- Train neural network on game data
- Integrate network with MCTS (AlphaZero-style)

---

## Conclusion

The AI system has solid foundations (MCTS algorithm, good heuristics) but is completely non-functional due to:
1. API incompatibility with YinshBoard v0.2.0
2. Multiple critical bugs in implementation
3. Incomplete MCTS tree-building logic

**Recommended Path:** Fix the existing MCTS implementation first to get a working, moderately strong AI (4-8 hours), then plan for neural network enhancement if needed for extremely strong play.
