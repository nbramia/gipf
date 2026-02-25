# Yinsh Notation System Documentation

## Overview

A comprehensive chess-style notation system for recording and displaying Yinsh games. The notation is automatically tracked during gameplay and logged to the console in real-time.

---

## Notation Format

### Setup Phase

**Ring Placement:**
```
R@[q,r]
```
- `R@` indicates ring placement
- `[q,r]` is the axial coordinate

**Examples:**
```
1. ○ R@[0,0]     - Player 1 places ring at origin
2. ● R@[-3,2]    - Player 2 places ring at [-3,2]
```

---

### Play Phase

**Basic Ring Move:**
```
R[q,r]->[q,r]
```

**Ring Move with Marker Flips:**
```
R[q,r]->[q,r]xN
```
- `xN` indicates N markers were flipped

**Ring Move Forming Row:**
```
R[q,r]->[q,r]+
```
- `+` indicates a row was formed (will be removed next)

**Combined:**
```
R[q,r]->[q,r]xN+
```
- Move flipped N markers AND formed a row

**Examples:**
```
11. ○ R[0,0]->[2,0]           - Player 1 moves ring
12. ● R[-3,2]->[0,2]x3        - Player 2 moves ring, flips 3 markers
13. ○ R[2,-2]->[2,2]+         - Player 1 moves ring, forms row
14. ● R[1,3]->[1,0]x2+        - Player 2 moves, flips 2, forms row
```

---

### Row Removal

```
Row[[q,r],[q,r],[q,r],[q,r],[q,r]]
```
- Lists all 5 positions of removed markers

**Example:**
```
15. ○ Row[[1,1],[2,1],[3,1],[4,1],[5,1]]
```

---

### Ring Removal (Scoring)

**Scoring a Point:**
```
-R[q,r]+
```
- `-R` indicates ring removal
- `+` indicates +1 point

**Winning Move:**
```
-R[q,r]++
```
- `++` indicates game won (checkmate equivalent)

**Examples:**
```
16. ○ -R[0,0]+      - Player 1 removes ring, scores 1 point
25. ● -R[-3,2]++    - Player 2 removes ring, wins game!
```

---

## Symbol Reference

| Symbol | Meaning |
|--------|---------|
| `○` | Player 1 |
| `●` | Player 2 |
| `R@` | Ring placement (setup) |
| `R` | Ring (in play phase) |
| `->` | Move from → to |
| `x` | Markers flipped (followed by count) |
| `+` | Point scored / Row formed |
| `++` | Game won |
| `-R` | Ring removal |

---

## Usage

### Automatic Logging (Default)

The notation system is automatically integrated into `YinshBoard`. Every move is logged to the console as it happens:

```javascript
const board = new YinshBoard();

// Moves are automatically logged:
board.handleSetupRingClick(1, 0);
board.handleClick(0, 0);
// Console: "1. ○ R@[0,0]"

board.handleSetupRingClick(2, 0);
board.handleClick(-3, 2);
// Console: "2. ● R@[-3,2]"
```

### Toggle Logging

```javascript
board.setLogging(false);  // Disable console logging
board.setLogging(true);   // Enable console logging
```

### Access Move History

```javascript
// Get all moves as array of notation strings
const moves = board.getMoveHistory();
// ["R@[0,0]", "R@[-3,2]", ...]

// Get full formatted game log
const log = board.getGameLog();
console.log(log);

// Print game log to console
board.printGameLog();

// Export in compact format
const compact = board.exportNotation();
// "R@[0,0] R@[-3,2] R@[2,-2] ..."
```

### Access Notation Object

```javascript
const notation = board.getNotation();
const lastMove = notation.getLastMove();
// {moveNumber: 10, player: 2, type: 'placement', notation: 'R@[2,2]', ...}
```

---

## Example Game Log

```
=====================================
       YINSH GAME NOTATION
=====================================

--- Setup Phase ---
1. ○ R@[0,0]
2. ● R@[-3,2]
3. ○ R@[2,-2]
4. ● R@[1,3]
5. ○ R@[-2,-1]
6. ● R@[3,-1]
7. ○ R@[1,-3]
8. ● R@[-1,-2]
9. ○ R@[-3,0]
10. ● R@[2,2]

--- Play Phase ---
11. ○ R[0,0]->[1,0]
12. ● R[-3,2]->[-1,2]x2
13. ○ R[1,0]->[1,3]+
14. ○ Row[[1,1],[1,2],[1,3],[1,4],[1,5]]
15. ○ -R[0,0]+
16. ● R[-1,2]->[2,2]x3+
17. ● Row[[0,2],[1,2],[2,2],[3,2],[4,2]]
18. ● -R[-3,2]+
...
42. ● -R[2,2]++

=====================================
          GAME RESULT
=====================================
Player 1 (○): 2 points
Player 2 (●): 3 points

🏆 Winner: Player 2 ●
=====================================
```

---

## Testing

Run the test script to see the notation system in action:

```bash
node test-notation.js
```

This demonstrates:
- Real-time move logging during setup
- Move history tracking
- Full game log formatting
- Compact notation export

---

## Implementation Details

### Files

1. **src/YinshNotation.js** - Core notation system
   - `recordRingPlacement()` - Record setup moves
   - `recordRingMove()` - Record play phase moves
   - `recordRowRemoval()` - Record row removals
   - `recordRingRemoval()` - Record ring removals
   - `formatGame()` - Format full game log
   - `exportCompact()` - Export compact notation

2. **src/YinshBoard.js** - Integration
   - Creates `notation` instance in constructor
   - Logs moves in `handleClick()` for all phases
   - Provides access methods: `getMoveHistory()`, `getGameLog()`, etc.

### Data Structure

Each move is stored as:
```javascript
{
  moveNumber: 15,
  player: 1,
  type: 'move',          // 'placement', 'move', 'row-removal', 'ring-removal'
  notation: 'R[0,0]->[2,0]x3+',
  from: [0, 0],
  to: [2, 0],
  markersFlipped: 3,
  rowFormed: true
}
```

---

## Future Enhancements

Potential additions:

1. **Import from Notation**
   - Parse notation string to replay games
   - Load games from external sources

2. **Game Analysis**
   - Highlight critical moves
   - Identify tactical patterns
   - Generate statistics

3. **Export Formats**
   - PGN-style format
   - JSON export with metadata
   - Shareable links

4. **Annotations**
   - Add comments to moves
   - Mark brilliant/blunder moves
   - Add variations

---

## Comparison to Chess Notation

| Yinsh | Chess | Meaning |
|-------|-------|---------|
| `R@[0,0]` | - | Ring placement (setup only) |
| `R[0,0]->[2,0]` | `Nf3` | Piece move |
| `x3` | `x` | Captures (markers flipped) |
| `+` | `+` | Check (row formed / point scored) |
| `++` | `#` | Checkmate (game won) |

Key differences:
- Yinsh shows exact coordinates `[q,r]` (more precise than chess squares)
- Yinsh tracks marker flips with count `x3`
- Yinsh has multi-phase notation (setup, play, removal)

---

## Notes

- Notation is automatically enabled by default
- All moves are logged in real-time to console
- Full game log is printed when game ends
- Logging can be disabled without affecting notation tracking
- Notation system is independent of UI (works in headless mode)
