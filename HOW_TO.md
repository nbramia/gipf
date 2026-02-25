# How to Work on Yinch (Yinsh Online)

## 🎯 **Core Development Philosophy**

**This project prioritizes GAME PLAYABILITY and CORRECTNESS over everything else.** When making changes:
- The game rules must always be enforced correctly
- AI performance and intelligence are key features
- User experience should be smooth and intuitive
- Code should be maintainable and well-organized

## 🚨 **Critical Rules - NEVER Break These**

### **Rule 1: Game Rules Are Sacred - Never Break Core Mechanics**
- **What NOT to do**: Modify game logic without understanding Yinsh rules completely
- **What TO do**: Verify all game rule changes against official Yinsh ruleset
- **Why**: This is a faithful implementation of a real board game - rule violations break the entire experience

### **Rule 2: Keep UI and Game Logic Separated**
- **What to do**:
  - **YinshBoard.js**: Pure game logic, no React dependencies, no UI code
  - **YinshGame.jsx**: UI rendering, React state, player interaction only
  - **mcts.js**: AI algorithm, independent of UI and React
- **Why**: This separation allows AI to use game logic without UI overhead, makes testing easier, and keeps code maintainable

### **Rule 3: MANDATORY Testing Before Deployment**
- **What to do** (ALL steps required):
  1. **Run full test suite**: `CI=true npm test` - MUST see all 57 tests passing
  2. **Run MCTS engine tests**: `npm run test:engine` (after MCTS modifications)
  3. **Build production**: `npm run build` - MUST complete without errors
  4. **Manual testing**: Verify all game phases work (setup, play, remove-row, remove-ring)
  5. **Test undo/redo**: Verify undo/redo works in all phases and keyboard shortcuts function
  6. **Use deployment script**: `./pre-deploy-checklist.sh` (runs all checks automatically)
- **Why**:
  - Broken game logic or failing tests = broken production
  - Vercel does NOT run tests automatically - you MUST run them locally
  - One failing test can indicate critical bugs that break gameplay
- **CRITICAL**: Never push to main without running tests first

### **Rule 4: Maintain Backward Compatibility with localStorage**
- **What to do**: Never break existing localStorage structure without migration
- **Keys to preserve**:
  - `yinshDarkMode` - Dark mode toggle
  - `yinshShowMoves` - Show valid moves indicator
  - `yinshRandomSetup` - Random ring placement in setup
  - `yinshKeepScore` - Track wins across games
  - `yinshWins` - Win counters (only when keepScore enabled)
  - `yinshShowMoveHistory` - Show/hide move history panel
- **Why**: Users expect their preferences and scores to persist

### **Rule 5: Understand Undo/Redo State Management**
- **How it works**:
  - `_captureState()` is called after EVERY successful move in ALL game phases
  - State snapshots include complete game state + notation state
  - History limited to 50 moves to prevent memory issues
  - Initial state captured in constructor (unless `skipInitialHistory: true`)
  - Test helpers use `skipInitialHistory: true` to avoid empty initial states
- **What to preserve**:
  - Always call `_captureState()` after state-changing operations
  - Never modify `stateHistory` or `historyIndex` directly
  - Use `undo()`, `redo()`, `canUndo()`, `canRedo()` methods
  - Call `clearHistory()` when starting new game
- **Why**: Undo/redo is now a core feature - breaking it degrades user experience

## 🧠 **Understanding the Codebase**

### **File Organization (What Lives Where)**

**YinshBoard.js (547 lines) - The Brain**
- Pure game logic - no React, no UI
- Game state management (boardState, gamePhase, currentPlayer, scores)
- Rule enforcement (valid move calculation, row detection, phase transitions)
- State cloning for AI simulation
- Key methods you'll modify most often:
  - `handleClick(q, r)` - Processes any board interaction
  - `calculateValidMoves(q, r)` - Determines legal moves
  - `checkForRows(boardState)` - Detects completed rows
  - `removeMarkers(markers)` / `removeRing(q, r)` - Handles removals

**YinshGame.jsx (953 lines) - The Face**
- React UI component - all rendering and interaction
- SVG hexagonal board rendering
- Modal dialogs (settings, game over)
- React state hooks for UI preferences (darkMode, showPossibleMoves)
- AI interaction (getAISuggestion, executeAIMove)
- Key functions you'll modify:
  - `handleIntersectionClick(q, r)` - User click handler
  - SVG rendering section - Visual appearance
  - Modal content - UI options and messaging

**mcts.js (1,589 lines) - The Intelligence**
- Monte Carlo Tree Search algorithm
- Position evaluation heuristics
- Move categorization (best, good, neutral, bad)
- Transposition table for state caching
- Playout simulation
- Key components:
  - `MCTSNode` class - Search tree nodes
  - `MCTS.getBestMove()` - Main AI entry point
  - Evaluation functions - Strategic assessment
  - Playout logic - Game simulation

**aiMove.js (112 lines) - The API**
- Vercel serverless function wrapper
- CORS configuration
- Request/response handling
- Timeout management
- State caching for performance

### **Coordinate System (Critical to Understand)**

**Axial Coordinates (q, r):**
- Hexagonal grid using cube coordinate system
- Range: q ∈ [-5, 5], r ∈ [-5, 5] (with corner exclusions)
- 51 total valid intersections
- Storage: Object keys as `"${q},${r}"`

**Screen Coordinates (x, y):**
- SVG canvas: 600x600px
- Conversion formulas:
  ```javascript
  x = q * 50 + r * 25 + 300
  y = r * 43.3 + 300
  ```

**Hexagonal Directions:**
```javascript
[
  [1, 0],   // East
  [0, 1],   // Southeast
  [-1, 1],  // Southwest
  [-1, 0],  // West
  [0, -1],  // Northwest
  [1, -1]   // Northeast
]
```

## 🔧 **Common Development Tasks**

### **Adding New Game Features**

**Example: Adding Undo Functionality**

1. **Update YinshBoard.js**:
   ```javascript
   // Add state history
   this.history = [];

   // Add method to save state
   saveState() {
     this.history.push({
       boardState: {...this.boardState},
       gamePhase: this.gamePhase,
       currentPlayer: this.currentPlayer,
       // ... all relevant state
     });
   }

   // Add undo method
   undo() {
     if (this.history.length > 0) {
       const prevState = this.history.pop();
       // Restore all state from prevState
     }
   }
   ```

2. **Update YinshGame.jsx**:
   ```javascript
   // Add UI button
   <button onClick={() => {
     yinshBoard.undo();
     setYinshBoard(yinshBoard.clone());
   }}>
     Undo Move
   </button>
   ```

3. **Test thoroughly**:
   - Test undo in each game phase
   - Verify state consistency
   - Check edge cases (undo at start of game)

### **Modifying AI Behavior**

**Example: Making AI More Aggressive**

1. **Locate evaluation logic in mcts.js**:
   ```javascript
   // Find move categorization section
   evaluateMove(board, move) {
     // Adjust weights for offensive moves
     if (this.createsRow(board, move)) {
       return 'best'; // Prioritize scoring
     }
   }
   ```

2. **Adjust playout weights**:
   ```javascript
   // In simulateGame() or playout section
   const weights = {
     'best': 0.7,   // Increase from 0.5
     'good': 0.25,  // Keep similar
     'neutral': 0.04,
     'bad': 0.01
   };
   ```

3. **Test with multiple games**:
   ```bash
   npm run test:engine
   ```

4. **Verify in browser**:
   - Play against AI
   - Check if it makes more offensive moves
   - Ensure it doesn't make illegal moves

### **Changing UI/UX**

**Example: Adding Animations**

1. **Locate rendering in YinshGame.jsx**:
   ```javascript
   // Find the piece rendering section
   <circle
     cx={x}
     cy={y}
     // Add transition CSS
     style={{transition: 'all 0.3s ease-in-out'}}
   />
   ```

2. **Add animation state**:
   ```javascript
   const [animatingPiece, setAnimatingPiece] = useState(null);

   // Before moving a piece
   setAnimatingPiece({from: [q1, r1], to: [q2, r2]});
   ```

3. **Test across devices**:
   - Check performance on mobile
   - Verify smooth animations
   - Ensure it doesn't interfere with gameplay

### **Updating Game Rules**

**Example: Adding Move History Display**

1. **Track moves in YinshBoard.js**:
   ```javascript
   this.moveHistory = [];

   // In handleClick when move is made
   this.moveHistory.push({
     player: this.currentPlayer,
     from: [q1, r1],
     to: [q2, r2],
     timestamp: Date.now()
   });
   ```

2. **Display in YinshGame.jsx**:
   ```javascript
   <div className="move-history">
     {yinshBoard.getMoveHistory().map((move, i) => (
       <div key={i}>
         Player {move.player}: ({move.from[0]}, {move.from[1]}) → ({move.to[0]}, {move.to[1]})
       </div>
     ))}
   </div>
   ```

## 🧪 **Testing Philosophy**

### **Manual Testing Checklist**

Before any deployment, test:

**Setup Phase:**
- [ ] Can place all 10 rings without errors
- [ ] Cannot place ring on occupied space
- [ ] Game transitions to play phase after 10th ring
- [ ] Random setup option works correctly

**Play Phase:**
- [ ] Valid moves are calculated correctly
- [ ] Cannot move opponent's rings
- [ ] Markers placed at start position
- [ ] Jumped markers flip color correctly
- [ ] Invalid move attempt shows flash effect

**Row Removal:**
- [ ] All completed rows detected
- [ ] Can select and remove any completed row
- [ ] Exactly 5 markers removed
- [ ] Transitions to ring removal phase

**Ring Removal:**
- [ ] Can only remove own rings
- [ ] Score increments correctly
- [ ] Game ends when score reaches 3
- [ ] Win modal displays correct winner

**AI Testing:**
- [ ] AI makes legal moves in all phases
- [ ] AI suggestions show confidence score
- [ ] API mode and local mode both work
- [ ] AI doesn't freeze or timeout

**UI/Preferences:**
- [ ] Dark mode toggle works
- [ ] Show moves toggle works
- [ ] Preferences persist after refresh
- [ ] Score tracking persists correctly

### **MCTS Engine Testing**

```bash
# Run standalone MCTS tests
npm run test:engine

# Test specific scenarios in test-yinsh.js
# Edit src/engine/test-yinsh.js to add custom tests
```

### **Jest Testing**

```bash
# Run all Jest tests
npm test

# Run in watch mode
npm test -- --watch
```

**Adding Tests:**
Create files matching `**/*.test.js` pattern:
```javascript
// YinshBoard.test.js
import YinshBoard from './YinshBoard';

describe('YinshBoard', () => {
  test('initializes with correct setup phase', () => {
    const board = new YinshBoard();
    expect(board.getGamePhase()).toBe('setup');
  });
});
```

## 🚀 **Deployment Workflow**

⚠️ **CRITICAL: All tests MUST pass before deployment - no exceptions!**

### **Recommended: Use Pre-Deployment Script**

```bash
# Run comprehensive pre-deployment checks
./pre-deploy-checklist.sh

# This script automatically:
# 1. Verifies you're on the correct branch
# 2. Runs all 43 tests (MUST pass)
# 3. Builds production bundle
# 4. Checks for uncommitted changes
# 5. Confirms version number
# 6. Provides deployment summary
```

### **Manual Deployment Process**

**Step 1: Make changes locally**
```bash
# Verify changes work
npm start
# Test in browser at localhost:3000
```

**Step 2: Run MANDATORY tests**
```bash
# CRITICAL: Run full test suite
CI=true npm test

# MUST see: "Tests: 43 passed, 43 total"
# If ANY test fails, STOP and fix before continuing

# Build production bundle
npm run build

# MUST complete without errors
```

**Step 3: Manual testing**
- Play through all game phases
- Test AI in multiple scenarios
- Create and remove rows
- Verify win condition
- Check UI on different screen sizes

**Step 4: Commit and push**
```bash
git add .
git commit -m "type: Descriptive commit message

- Detail 1
- Detail 2
- Tests: All 43 passing"

# Only push after ALL tests pass!
git push origin main
```

**Step 5: Vercel auto-deploys**
- Vercel detects push to main branch
- Builds with `npm run build`
- Deploys to production automatically
- Check deployment at: https://yinsh-nathan-ramias-projects.vercel.app

**Step 6: Post-deployment verification**
- Test production site manually
- Verify all game phases work
- Check AI functionality
- Monitor Vercel logs for errors

### **Local Build Testing**

```bash
# Test production build locally (optional but recommended)
npm run build

# Serve build folder
npx serve -s build

# Test at localhost:3000 (or whatever port serve uses)
```

### **Deployment Checklist**

⚠️ **MANDATORY - Check ALL items before pushing:**

**Pre-Deployment:**
- [ ] **All 43 tests passing** (`CI=true npm test`)
- [ ] **Build successful** (`npm run build`)
- [ ] **No console errors** in development
- [ ] **Manual testing completed** (all game phases)

**Code Quality:**
- [ ] All game phases tested manually
- [ ] AI makes reasonable moves
- [ ] No console errors in browser
- [ ] UI looks correct in light and dark mode
- [ ] localStorage preferences work
- [ ] Mobile/responsive design tested
- [ ] Build completes without errors (`npm run build`)

## 📝 **Documentation Standards**

### **Where Information Lives**

- **README.md**: Project overview, features, setup, tech stack (public-facing)
- **HOW_TO.md** (this file): Development workflow, coding standards, architecture
- **VERSION_MANAGEMENT.md**: Deployment history, version tracking, release notes
- **TO_DO.md**: Future features, bugs to fix, roadmap

### **When to Update Documentation**

**README.md:**
- New features added
- Tech stack changes
- API endpoint modifications
- Major architectural changes

**HOW_TO.md:**
- New development patterns discovered
- Common pitfalls identified
- Build/deployment process changes
- Testing procedures updated

**VERSION_MANAGEMENT.md:**
- After every deployment to production
- Major bug fixes
- Significant feature additions
- Performance improvements

**TO_DO.md:**
- New feature ideas
- Known bugs discovered
- User feedback received
- Planned improvements

### **Code Comments Best Practices**

**DO comment:**
- Complex algorithms (especially in mcts.js)
- Non-obvious game rules
- Performance optimizations
- Coordinate system transformations

**DON'T comment:**
- Obvious code (`x = x + 1 // increment x`)
- Redundant explanations
- Outdated information

**Example Good Comments:**
```javascript
// Yinsh rule: When a ring jumps markers, ALL jumped markers flip
// to the opponent's color. This is critical game logic.
jumpedPositions.forEach(pos => {
  boardState[pos].player = oppositePlayer;
});

// UCB1 formula: balances exploitation (known good moves)
// with exploration (untried moves). C=1.41 is standard.
const ucb1 = exploitation + 1.41 * Math.sqrt(exploration);
```

## 🎯 **Architecture Patterns**

### **State Management Pattern**

```
YinshBoard (Pure Logic)
    ↓ clone()
YinshGame React State
    ↓ render
SVG UI Display
    ↓ onClick
handleIntersectionClick
    ↓ validate & update
YinshBoard.handleClick()
    ↓ mutate internal state
YinshBoard.clone()
    ↓ setState
Re-render UI
```

**Key Principle**: YinshBoard is the single source of truth. React state is just a copy for rendering.

### **AI Integration Pattern**

```
User clicks "AI Suggest"
    ↓
getAISuggestion() [YinshGame]
    ↓
Choose API or Local mode
    ↓
API: POST to /api/aiMove  |  Local: MCTS.getBestMove()
    ↓
Receive {move, destination, confidence, stats}
    ↓
Display suggestion (yellow circles)
    ↓
User clicks "AI Move"
    ↓
executeAIMove()
    ↓
yinshBoard.handleClick() with AI's move
    ↓
Update UI
```

### **Game Phase Flow**

```
setup → play → remove-row → remove-ring → play (loop)
                                    ↓
                            (if score == 3)
                                    ↓
                               game-over
```

Each phase has different valid actions and UI states.

## 🔍 **Debugging Common Issues**

### **Problem: AI Returns Illegal Move**

**Diagnosis:**
1. Check AI response in browser console
2. Verify gamePhase matches board state
3. Check if move validation in YinshBoard is correct

**Fix:**
- Update MCTS move generation for that phase
- Fix move validation in `calculateValidMoves()`
- Add edge case handling in `handleClick()`

### **Problem: Board State Desync**

**Symptoms:** UI shows different state than game logic

**Diagnosis:**
1. Log `yinshBoard.getBoardState()` vs rendered pieces
2. Check if `setYinshBoard(yinshBoard.clone())` is called after mutations

**Fix:**
- Always clone YinshBoard after modifying it
- Never mutate yinshBoard directly in React component
- Use `yinshBoard.clone()` to trigger re-render

### **Problem: Valid Moves Not Showing**

**Diagnosis:**
1. Check if `showPossibleMoves` is true
2. Verify `yinshBoard.getValidMoves()` returns correct array
3. Check if selectedRing is set correctly

**Fix:**
- Ensure `setShowPossibleMoves(true)` on ring selection
- Fix `calculateValidMoves()` logic in YinshBoard.js
- Verify coordinate calculations in rendering

### **Problem: Row Detection Fails**

**Diagnosis:**
1. Log detected rows vs expected rows
2. Check marker colors in boardState
3. Verify directional scanning logic

**Fix:**
- Update `checkForRows()` in YinshBoard.js
- Verify consecutive marker counting logic
- Test with manual board state setup

## 💡 **Pro Tips**

### **Development Workflow**

1. **Use browser DevTools extensively**:
   - React DevTools to inspect component state
   - Console to log board state during moves
   - Network tab to debug API calls

2. **Test incrementally**:
   - Don't change 10 things and then test
   - Make one change, test immediately
   - Commit working code frequently

3. **Understand the game**:
   - Play Yinsh online or physically first
   - Read official rules thoroughly
   - Watch gameplay videos

4. **AI development**:
   - Start with simple evaluation functions
   - Add complexity gradually
   - Benchmark performance with `console.time()`

5. **UI changes**:
   - Test on mobile screen sizes
   - Check both light and dark mode
   - Verify touch interactions on tablet

### **Performance Optimization**

**YinshBoard.js:**
- Use object property lookups (`boardState["q,r"]`) instead of array searches
- Cache calculated valid moves
- Minimize state cloning frequency

**mcts.js:**
- Tune transposition table size vs memory usage
- Adjust simulation count based on complexity
- Use early termination in playouts

**YinshGame.jsx:**
- Memoize expensive rendering calculations
- Debounce AI suggestion requests
- Lazy load AI mode switching

### **Code Quality**

**Before committing:**
- Remove `console.log()` statements (or use proper logging)
- Check for unused variables/imports
- Format code consistently
- Write descriptive commit messages

**Commit Message Format:**
```
Short description (50 chars max)

Detailed explanation if needed:
- What changed
- Why it changed
- Any breaking changes

Examples:
"Add undo functionality to game"
"Fix row detection for diagonal rows"
"Improve AI move categorization"
"Update UI for mobile responsiveness"
```

## 🎉 **Success Metrics**

### **Good Signs:**

- AI makes intelligent moves in all game phases
- No illegal moves possible through UI
- Game rules correctly enforced
- Smooth gameplay experience
- No console errors during normal play
- Preferences persist across sessions
- Deployment succeeds without errors

### **Red Flags:**

- AI suggests illegal moves
- Game phase doesn't transition correctly
- UI freezes during AI calculation
- localStorage data lost on refresh
- Build fails on Vercel
- Mobile layout broken
- Dark mode styling issues

## 🔐 **Project Maintenance**

### **Regular Tasks**

**Weekly:**
- Check for npm package updates (`npm outdated`)
- Monitor Vercel deployment logs
- Test game on latest browsers

**Monthly:**
- Update dependencies (`npm update`)
- Review and test all game phases
- Check Vercel usage/limits

**Before Major Changes:**
- Create feature branch
- Backup localStorage data structure
- Document breaking changes
- Update version number in package.json

### **Versioning Strategy**

Current version: 0.1.0 (following semver)

**Increment:**
- **Major (1.0.0)**: Breaking changes to game logic or API
- **Minor (0.2.0)**: New features (multiplayer, replay system)
- **Patch (0.1.1)**: Bug fixes, small improvements

## 📚 **Learning Resources**

**Yinsh Game:**
- Official Yinsh rules: Search for "Yinsh GIPF project rules"
- Online gameplay: BoardGameArena, Yucata
- Strategy guides: YouTube gameplay videos

**MCTS Algorithm:**
- "A Survey of Monte Carlo Tree Search Methods" (IEEE paper)
- AlphaGo documentation for advanced MCTS
- Game AI programming resources

**React/JavaScript:**
- React official docs (react.dev)
- MDN Web Docs for JavaScript
- Tailwind CSS documentation

**Vercel Deployment:**
- Vercel documentation
- Serverless functions guide
- Next.js API routes (similar pattern)

## 🎯 **Remember**

**The Goal:** Create a faithful, playable, intelligent implementation of Yinsh that anyone can enjoy in their browser.

**Core Principles:**
1. Game rules correctness > Everything else
2. AI should be challenging but beatable
3. UI should be intuitive and responsive
4. Code should be maintainable and well-organized
5. Deploy with confidence through thorough testing

**When in doubt:**
- Test manually before deploying
- Consult official Yinsh rules
- Keep UI and logic separated
- Document significant changes

Happy coding! 🎮
