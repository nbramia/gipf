# Move Notation (Yinsh)

Every Yinsh move is automatically recorded in a chess-inspired notation format. The notation system is implemented in `src/games/yinsh/YinshNotation.js` and integrated into `YinshBoard` -- moves are logged as they happen during gameplay.

## Format

### Setup Phase

```
R@[q,r]                   Ring placement at coordinates [q,r]
```

### Play Phase

```
R[q,r]->[q,r]             Ring moved from start to end
R[q,r]->[q,r]xN           Ring moved, flipped N markers
R[q,r]->[q,r]+            Ring moved, formed a row
R[q,r]->[q,r]xN+          Ring moved, flipped N markers, formed a row
```

### Row Removal

```
Row[[q,r],[q,r],[q,r],[q,r],[q,r]]    Five markers removed
```

### Ring Removal (Scoring)

```
-R[q,r]+                  Ring removed, scored 1 point
-R[q,r]++                 Ring removed, won the game
```

## Symbols

| Symbol | Meaning |
|--------|---------|
| `R@` | Ring placement (setup) |
| `R` | Ring (play phase) |
| `->` | Move direction |
| `xN` | N markers flipped |
| `+` | Row formed / point scored |
| `++` | Game won |
| `-R` | Ring removal |

Player indicators in game logs: `○` = Player 1, `●` = Player 2.

## Programmatic Access

```javascript
// Move history as array of notation strings
board.getMoveHistory();
// ["R@[0,0]", "R@[-3,2]", "R[0,0]->[1,0]", ...]

// Formatted full game log
board.getGameLog();

// Compact single-line export
board.exportNotation();
// "R@[0,0] R@[-3,2] R[0,0]->[1,0] ..."

// Toggle console logging (notation tracking continues regardless)
board.setLogging(false);
board.setLogging(true);
```

## Example Game Log

```
=====================================
       YINSH GAME NOTATION
=====================================

--- Setup Phase ---
1. ○ R@[0,0]
2. ● R@[-3,2]
3. ○ R@[2,-2]
...
10. ● R@[2,2]

--- Play Phase ---
11. ○ R[0,0]->[1,0]
12. ● R[-3,2]->[-1,2]x2
13. ○ R[1,0]->[1,3]+
14. ○ Row[[1,1],[1,2],[1,3],[1,4],[1,5]]
15. ○ -R[0,0]+
...
42. ● -R[2,2]++

=====================================
Player 2 ● wins!
=====================================
```

## Internal Data Structure

Each move is stored as:

```javascript
{
  moveNumber: 15,
  player: 1,
  type: 'move',               // 'placement' | 'move' | 'row-removal' | 'ring-removal'
  notation: 'R[0,0]->[2,0]x3+',
  from: [0, 0],
  to: [2, 0],
  markersFlipped: 3,
  rowFormed: true
}
```

The notation system is independent of the UI and works in headless mode (tests, AI simulations).

## Comparison to Chess Notation

| Yinsh | Chess | Meaning |
|-------|-------|---------|
| `R@[0,0]` | -- | Piece placement (setup only) |
| `R[0,0]->[2,0]` | `Nf3` | Piece move |
| `xN` | `x` | Captures (markers flipped vs piece taken) |
| `+` | `+` | Row formed / check |
| `++` | `#` | Game won / checkmate |

Key differences: Yinsh uses exact coordinates rather than named squares, tracks flip count, and has multi-phase notation (setup, play, removal).
