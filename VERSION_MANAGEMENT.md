# Yench (Yinsh Online) Version Management & Deployment

This document covers version management, deployment procedures, and release history for the Yench project.

## 🚀 Deployment Process

### **Current Deployment Status**

- **Application**: ✅ Deployed on Vercel
- **Production URL**: https://yinsh-nathan-ramias-projects.vercel.app
- **API Endpoint**: https://yinsh-nathan-ramias-projects.vercel.app/api/aiMove
- **Current Version**: v0.3.0
- **GitHub Repository**: https://github.com/nbramia/yinsh
- **Branch**: main

### **Deployment Method - Vercel Automatic Deployment**

Yench uses Vercel's GitHub integration for automatic deployment. No GitHub Actions or manual deployment scripts are required.

**How It Works:**
1. Developer pushes code to `main` branch on GitHub
2. Vercel detects the push via GitHub webhook
3. Vercel automatically runs `npm run build` (React Scripts build)
4. Vercel deploys the built application to production
5. Production site is live within 1-2 minutes

**Vercel Configuration** (vercel.json):
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Credentials", "value": "true" },
        { "key": "Access-Control-Allow-Origin", "value": "http://localhost:3000" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
        { "key": "Access-Control-Allow-Headers", "value": "..." }
      ]
    }
  ]
}
```

This configures CORS headers for the `/api/aiMove` serverless function.

---

## Release History

### **Latest Release - v0.3.0 (January 2025)**

**Move History, Undo/Redo & Mobile Responsiveness**

This release adds comprehensive undo/redo functionality with move history tracking, and optimizes the entire UI for mobile devices.

**Major Features:**
1. **Move History & Undo/Redo System**
   - State history tracking with 50-move limit
   - `undo()` and `redo()` methods work across all game phases
   - Keyboard shortcuts: Ctrl+Z/Ctrl+Y (Windows), Cmd+Z/Cmd+Shift+Z (Mac)
   - Move history side panel displaying chess-style notation
   - Current move highlighting after undo/redo
   - Persistent show/hide preference via localStorage

2. **Mobile-Responsive Design**
   - Tailwind responsive breakpoints (md: 768px+) throughout UI
   - Auto-hide move history panel on mobile to maximize board space
   - Touch-optimized button sizes and spacing
   - Smaller fonts and padding on mobile devices
   - Proper z-index layering for mobile UX
   - All features work seamlessly on mobile and desktop

**Technical Details:**
- Added 14 comprehensive undo/redo tests (57 total tests, all passing)
- State snapshots include: boardState, gamePhase, currentPlayer, scores, ringsPlaced, selectedRing, validMoves, rows, rowResolutionQueue, winner, selectedSetupRing, notation state
- History automatically cleared on `startNewGame()`
- Redo history cleared when new move made after undo
- Special handling for test helpers to skip initial history capture
- Bundle size increase: +1.3 kB gzipped (minimal impact)

**Files Modified:**
- `src/YinshBoard.js` - Added history tracking and undo/redo methods (+150 lines)
- `src/YinshGame.jsx` - Added move history UI and mobile responsiveness (+180 lines)
- `src/YinshBoard.test.js` - Added 14 undo/redo tests (+241 lines)
- `src/testHelpers.js` - Updated for history system compatibility
- `TO_DO.md` - Moved completed features, updated documentation

**Git Commits:**
- `d6296bb` - feat: Add comprehensive undo/redo functionality with move history
- `6342047` - feat: Add move history panel and undo/redo UI controls
- `7510ade` - feat: Add mobile-responsive design for all UI elements
- `71c1d7a` - docs: Update documentation for undo/redo and mobile features

---

### **v0.1.0 (January 28, 2025)**

**AI Move Button Enhancement & UI Refinements**

This release focuses on refining the AI interaction UX and improving the visual feedback for AI suggestions.

**AI Interaction Improvements:**
- ✅ **Separated AI Suggestion from Execution**: "AI Suggest" button now shows recommendation without auto-playing
- ✅ **Dedicated AI Move Button**: "AI Move" button executes the suggested move after review
- ✅ **Enhanced Visual Feedback**: Yellow circles highlight AI-suggested moves on board
- ✅ **Confidence Display**: AI confidence score shown with each suggestion
- ✅ **Thinking State Indicator**: "AI Thinking..." button state during calculation

**Technical Implementation:**
- ✅ **getAISuggestion(autoExecute)**: Added parameter to control auto-execution
- ✅ **aiSuggestion State**: New React state to store suggestion without immediate execution
- ✅ **executeAIMove()**: Separate function to apply suggested move
- ✅ **Conditional Rendering**: Show "AI Move" button only when suggestion exists

**Files Modified:**
- `src/YinshGame.jsx`: Updated AI button logic and state management
- UI rendering section: Added conditional "AI Move" button display

### **Previous Release - v0.1.0-beta.3 (January 28, 2025)**

**Intelligent Row & Ring Removal - Major AI Overhaul**

Major enhancement to MCTS AI for strategic decision-making in row and ring removal phases.

**Row Removal AI:**
- ✅ **Strategic Row Selection**: AI evaluates positional advantage of removing different rows
- ✅ **Clustering Analysis**: Prefers removing rows that break up opponent marker clusters
- ✅ **Mobility Preservation**: Considers impact on ring movement options
- ✅ **Phase-Specific Evaluation**: Custom heuristics for remove-row game phase

**Ring Removal AI:**
- ✅ **Positional Value Assessment**: Evaluates board position value of each ring
- ✅ **Strategic Sacrifice**: Removes rings from less valuable positions
- ✅ **Mobility Impact**: Considers remaining move options after ring removal
- ✅ **Endgame Awareness**: Different strategy for early vs late game ring removal

**Technical Implementation:**
- ✅ **Move Categorization**: Enhanced evaluation for 'remove-row' and 'remove-ring' move types
- ✅ **Playout Simulation**: Added phase-specific simulation logic
- ✅ **Evaluation Functions**: New position assessment helpers in mcts.js
- ✅ **Weighted Selection**: Smarter move selection during MCTS playouts

**Files Modified:**
- `src/engine/mcts.js`: Major refactoring of evaluation logic for removal phases
- `src/pages/api/aiMove.js`: Updated API response handling for new move types

### **Previous Release - v0.1.0-beta.2 (January 25, 2025)**

**Bug Fixes and Stability Improvements**

**Bug Fixes:**
- ✅ **Game Phase Transitions**: Fixed edge cases in phase transition logic
- ✅ **Row Detection**: Corrected diagonal row detection for edge positions
- ✅ **State Synchronization**: Fixed UI desync issues after complex move sequences
- ✅ **Transposition Table**: Fixed memory leak in MCTS state caching

**Improvements:**
- ✅ **Error Handling**: Added graceful fallbacks for API failures
- ✅ **Performance**: Reduced unnecessary re-renders in YinshGame.jsx
- ✅ **Console Logging**: Removed debug logs for production

**Files Modified:**
- `src/YinshBoard.js`: Phase transition edge case fixes
- `src/engine/mcts.js`: Transposition table cleanup
- `src/YinshGame.jsx`: State update optimization

### **Previous Release - v0.1.0-beta.1 (January 23, 2025)**

**Initial Public Release**

**Core Features:**
- ✅ **Complete Yinsh Implementation**: All game phases (setup, play, remove-row, remove-ring)
- ✅ **MCTS AI Engine**: Sophisticated Monte Carlo Tree Search algorithm
- ✅ **Dual AI Modes**: API-based (Vercel serverless) and local (client-side) execution
- ✅ **Dark Mode**: Theme toggle with localStorage persistence
- ✅ **Score Tracking**: Win counter across multiple games
- ✅ **Valid Move Indicators**: Visual feedback for legal moves
- ✅ **Random Setup**: Auto-generate randomized ring placements
- ✅ **Responsive UI**: SVG-based hexagonal board rendering

**Technical Stack:**
- ✅ **React 18.2.0**: Modern React with hooks
- ✅ **Tailwind CSS 3.4.17**: Utility-first styling
- ✅ **Vercel Deployment**: Serverless API + static hosting
- ✅ **Jest Testing**: Test framework configured

**Initial Commit Structure:**
- `src/App.jsx`: Root component
- `src/YinshGame.jsx`: Main game UI (953 lines)
- `src/YinshBoard.js`: Game logic (547 lines)
- `src/engine/mcts.js`: AI engine (1,589 lines)
- `src/pages/api/aiMove.js`: Vercel API endpoint (112 lines)

---

## 🔄 Deployment Workflow

⚠️ **CRITICAL: This process includes MANDATORY testing gates. Never skip any step.**

### **Standard Deployment Process**

**Step 1: Local Development**
```bash
# Start development server
npm start

# Application runs at http://localhost:3000
# Test all game phases manually
```

**Step 2: Testing (MANDATORY - DO NOT SKIP)**
```bash
# CRITICAL: Run full test suite in CI mode
CI=true npm test

# Verify output shows:
# "Tests: XX passed, XX total"
# "Test Suites: X passed, X total"

# If ANY test fails, DO NOT PROCEED to deployment
# Fix failing tests before continuing

# Expected: All 43 tests passing
# If test count changes, update this documentation

# Test MCTS engine
npm run test:engine

# Build production bundle locally to catch build errors
npm run build

# Verify no build errors appear
# Check build/static/ directory exists with bundled files
```

**⚠️ DEPLOYMENT GATE: Verify Test Results**
```bash
# Before proceeding, confirm:
✅ All 43 tests passed
✅ No test failures or errors
✅ Build completed successfully
✅ No console warnings or errors

# If any check fails, STOP and fix issues before deployment
```

**Step 3: Version Update (For New Releases)**
```bash
# Update version in package.json based on changes:
# PATCH (0.2.0 → 0.2.1): Bug fixes, small improvements
# MINOR (0.2.0 → 0.3.0): New features, non-breaking changes
# MAJOR (0.2.0 → 1.0.0): Breaking changes

npm version patch   # or minor/major
# This creates a git tag automatically

# Update VERSION_MANAGEMENT.md with release notes
# Include: version, date, changes, test results
```

**Step 4: Version Control**
```bash
# Stage changes
git add .

# Commit with descriptive message following convention:
# Format: "type: description"
# Types: feat, fix, refactor, docs, test, chore

git commit -m "type: Descriptive message about changes

- Detail 1
- Detail 2
- Tests: All 43 passing"

# Push to main branch (triggers automatic deployment)
git push origin main --tags
```

**Step 5: Automatic Deployment**
- Vercel detects push to main branch
- Builds application with `npm run build`
- Deploys to production automatically
- Deployment typically completes in 1-2 minutes

**⚠️ NOTE:** Vercel does NOT run tests automatically. You MUST run tests locally before pushing.

**Step 6: Post-Deployment Verification (MANDATORY)**
```bash
# Wait for Vercel deployment to complete (check dashboard or wait 2 min)

# Check production site loads
open https://yinsh-nathan-ramias-projects.vercel.app

# Manual test critical flows:
# 1. Place rings in setup phase
# 2. Move rings and create markers
# 3. Create a row and verify removal works
# 4. Test AI suggestion
# 5. Complete a game and verify win condition

# Test AI API endpoint
curl -X POST https://yinsh-nathan-ramias-projects.vercel.app/api/aiMove \
  -H "Content-Type: application/json" \
  -d '{"boardState":{},"gamePhase":"play","currentPlayer":1,"ringsPlaced":{"1":5,"2":5}}'

# Check Vercel logs for any errors
vercel logs yinsh --follow

# If any issues found, immediately rollback (see Emergency Rollback below)
```

**✅ Deployment Success Criteria:**
- All 43 tests passed locally before push
- Build completed without errors
- Vercel deployment succeeded
- Production site loads correctly
- All game phases playable
- No console errors in browser
- AI endpoint responds correctly

### **Emergency Rollback Procedure**

If a deployment breaks production:

**Option 1: Revert Commit**
```bash
# Revert to previous working commit
git revert HEAD
git push origin main

# Vercel will auto-deploy the reverted state
```

**Option 2: Vercel Dashboard Rollback**
1. Go to Vercel dashboard
2. Navigate to project "yinsh"
3. Find previous successful deployment
4. Click "Promote to Production"

**Option 3: Fix Forward**
```bash
# Fix the issue quickly
# Commit and push fix
git add .
git commit -m "Hotfix: [description of fix]"
git push origin main
```

---

## 📊 Version History

### **Versioning Strategy**

This project follows **Semantic Versioning (semver)**: `MAJOR.MINOR.PATCH`

**Version Increment Rules:**
- **MAJOR (1.0.0)**: Breaking changes to game logic, API, or localStorage schema
- **MINOR (0.2.0)**: New features (multiplayer, undo, tutorials)
- **PATCH (0.1.1)**: Bug fixes, small improvements, performance optimizations

**Current Version:** 0.1.0
- **Major**: 0 (pre-release, not production-ready by semver standards)
- **Minor**: 1 (initial feature set complete)
- **Patch**: 0 (stable release)

### **Version Update Procedure**

**When to Bump Version:**
- After significant feature additions (MINOR)
- After breaking changes (MAJOR)
- After bug fix releases (PATCH)

**How to Update Version:**
```bash
# Update package.json version
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# This creates a git tag and commits the version change
git push origin main --tags
```

### **Release Checklist**

Before creating a new release:
- [ ] All game phases tested manually
- [ ] AI makes legal moves in all scenarios
- [ ] No console errors in browser
- [ ] Dark mode works correctly
- [ ] localStorage preferences persist
- [ ] Build completes without errors (`npm run build`)
- [ ] Mobile layout tested
- [ ] API endpoint responds correctly
- [ ] Documentation updated (README.md, VERSION_MANAGEMENT.md)
- [ ] Commit message follows conventions
- [ ] Version number updated in package.json

---

## 🧪 Testing & Quality Assurance

### **Pre-Deployment Testing**

**Manual Testing Checklist:**

**Setup Phase:**
- [ ] Place all 10 rings successfully
- [ ] Cannot place ring on occupied space
- [ ] Game transitions to play phase after 10th ring
- [ ] Random setup option works

**Play Phase:**
- [ ] Select own ring and see valid moves
- [ ] Cannot select opponent's ring
- [ ] Move ring to valid destination
- [ ] Marker placed at starting position
- [ ] Jumped markers flip correctly
- [ ] Invalid move shows flash effect

**Row Removal:**
- [ ] All completed rows detected
- [ ] Can select and remove row
- [ ] Exactly 5 markers removed
- [ ] Transitions to ring removal

**Ring Removal:**
- [ ] Can only select own rings
- [ ] Score increments correctly
- [ ] Game ends at score 3
- [ ] Winner displayed correctly

**AI Testing:**
- [ ] AI makes legal moves in setup
- [ ] AI makes legal moves in play
- [ ] AI selects valid row removal
- [ ] AI selects valid ring removal
- [ ] Confidence score displays
- [ ] API mode works
- [ ] Local mode works
- [ ] No timeouts or freezes

**UI/UX Testing:**
- [ ] Dark mode toggle works
- [ ] Show moves toggle works
- [ ] Preferences persist after refresh
- [ ] Score tracking persists
- [ ] Modal dialogs display correctly
- [ ] Responsive on mobile
- [ ] Touch interactions work

### **Automated Testing Status**

**Current Status:**
- Jest configured ✅
- React Testing Library installed ✅
- Test files: **0 tests written** ⚠️

**Planned Test Coverage:**
- Unit tests for YinshBoard.js (game logic)
- Component tests for YinshGame.jsx (UI)
- Integration tests for AI interaction
- API endpoint tests for /api/aiMove

---

## 🔧 Build & Infrastructure

### **Build Configuration**

**React Scripts Build:**
```bash
npm run build
```

**Build Output:**
- Directory: `build/`
- Main bundle: `build/static/js/main.[hash].js`
- CSS: `build/static/css/main.[hash].css`
- Size: ~500KB (uncompressed)

**Optimization:**
- Minification: Yes (via Terser)
- Code splitting: Yes (React Scripts default)
- Tree shaking: Yes
- Source maps: Yes (production)

### **Vercel Serverless Function**

**API Route:** `/api/aiMove`

**Configuration:**
- Runtime: Node.js 18.x
- Memory: 1024 MB (Vercel default)
- Timeout: 10 seconds (Vercel free tier)
- Code timeout: 3 seconds (enforced in aiMove.js)

**Performance:**
- Cold start: ~500ms
- Warm execution: ~50-200ms (excluding AI calculation)
- AI calculation: 1-3 seconds (depends on complexity)

**Monitoring:**
- View logs: Vercel Dashboard → Functions → aiMove
- Error tracking: Automatic via Vercel
- Performance metrics: Vercel Analytics

---

## 📈 Future Infrastructure Plans

### **Performance Optimization**

- **Code Splitting**: Lazy load MCTS engine on first AI use
- **Web Workers**: Run MCTS in background thread to prevent UI blocking
- **Bundle Size**: Reduce to <300KB with dependency optimization
- **API Caching**: Cache common positions to reduce calculation time

### **Monitoring & Analytics**

- **Error Tracking**: Integrate Sentry for error monitoring
- **Performance Monitoring**: Add Web Vitals tracking
- **User Analytics**: Track game completions, AI usage, feature adoption
- **A/B Testing**: Test different UI layouts and AI difficulty levels

### **Scalability**

- **CDN Caching**: Cache static assets more aggressively
- **API Rate Limiting**: Prevent abuse of AI endpoint
- **Database**: Add database for game history, user accounts, statistics
- **WebSocket**: Real-time multiplayer infrastructure

---

## 🚨 Critical Notes

### **Deployment Requirements**

1. **Never Deploy Broken Game Logic**: Test all game phases before pushing
2. **Maintain API Compatibility**: Don't break `/api/aiMove` contract without versioning
3. **Preserve localStorage Schema**: Add migration if changing data structure
4. **Monitor Vercel Quotas**: Stay within free tier limits (100GB bandwidth/month)
5. **CORS Configuration**: Keep vercel.json CORS headers updated

### **Common Deployment Issues**

**Issue: Build Fails on Vercel**
- **Cause**: Dependency issues, syntax errors
- **Fix**: Run `npm run build` locally first, fix errors before pushing

**Issue: API Times Out**
- **Cause**: MCTS simulation takes too long
- **Fix**: Reduce simulation count, optimize algorithm, check MAX_TIME_MS

**Issue: Dark Mode Not Persisting**
- **Cause**: localStorage blocked or cleared
- **Fix**: Add error handling for localStorage access

**Issue: AI Returns Invalid Move**
- **Cause**: Game state desync, AI logic bug
- **Fix**: Log full state to debug, fix validation logic

---

## 📝 Documentation Maintenance

### **Update Schedule**

**After Every Deployment:**
- Update this file (VERSION_MANAGEMENT.md) with release notes
- Increment version in package.json if significant changes

**Monthly Review:**
- Review TO_DO.md and update completed items
- Update README.md if features changed
- Review HOW_TO.md for new patterns discovered

**Major Version Release:**
- Create detailed changelog
- Update all documentation
- Create GitHub release with notes
- Tag version in git

### **Documentation Sync**

**README.md** ↔ **VERSION_MANAGEMENT.md**
- README describes current features
- VERSION_MANAGEMENT tracks what changed and when

**HOW_TO.md** ↔ **VERSION_MANAGEMENT.md**
- HOW_TO describes development process
- VERSION_MANAGEMENT tracks deployment process

**TO_DO.md** ↔ **VERSION_MANAGEMENT.md**
- TO_DO plans future features
- VERSION_MANAGEMENT marks features as completed

---

## 🎯 Success Metrics

### **Deployment Health Indicators**

**✅ Healthy Deployment:**
- Vercel build succeeds within 2 minutes
- Production site loads in <2 seconds
- API endpoint responds in <5 seconds
- No console errors on page load
- All game phases playable
- AI makes legal moves consistently

**⚠️ Warning Signs:**
- Build time >5 minutes
- Page load time >5 seconds
- API timeouts >10% of requests
- Console errors present
- Game crashes in certain scenarios
- AI makes occasional illegal moves

**🚨 Critical Issues:**
- Build fails completely
- Site returns 500 errors
- API always times out
- Game unplayable
- Data loss from localStorage
- Security vulnerabilities

### **Monitoring Commands**

```bash
# Check Vercel deployment status
vercel ls

# View recent deployments
vercel ls --scope=personal

# Tail production logs
vercel logs yinsh --follow

# Check build logs
vercel logs [deployment-url]
```

---

## 🔐 Security Considerations

### **Current Security Measures**

- **CORS Configuration**: Restricts API access to allowed origins
- **No User Data Storage**: Game state only in client localStorage
- **No Authentication**: Public game, no sensitive data
- **Input Validation**: API validates game state before processing
- **Rate Limiting**: Vercel's automatic rate limiting on free tier

### **Future Security Enhancements**

- **API Key Authentication**: Prevent unauthorized API usage
- **Request Rate Limiting**: Custom rate limiting per IP
- **Input Sanitization**: More robust validation of game states
- **CSP Headers**: Content Security Policy for XSS protection

---

## 📅 Deployment Log

| Date | Version | Type | Description | Status |
|------|---------|------|-------------|--------|
| 2025-01-XX | v0.2.0 | Major | **Comprehensive rule implementation & refactoring** - 100% rule compliance, 43 tests, queue-based row resolution | 🟡 Ready |
| 2025-01-28 | v0.1.0 | Feature | AI move button enhancement | ✅ Live |
| 2025-01-28 | v0.1.0-beta.3 | Major | Intelligent row & ring removal AI overhaul | ✅ Live |
| 2025-01-25 | v0.1.0-beta.2 | Bugfix | Game phase transitions, row detection fixes | ✅ Live |
| 2025-01-23 | v0.1.0-beta.1 | Initial | Initial public release | ✅ Live |

---

### **v0.2.0 Release Notes** (Pending Deployment)

**Completion Date**: January 2025
**Test Status**: ✅ All 43 tests passing
**Build Status**: ✅ Production build successful
**Deployment Status**: 🟡 Ready for deployment (awaiting final approval)

**Major Changes:**
1. ✅ Fixed all 5 critical bugs in row handling
2. ✅ Implemented queue-based iterative row resolution
3. ✅ Added opponent row resolution system
4. ✅ Refactored row detection to return all possible subsets
5. ✅ Added path validation for marker flipping
6. ✅ Created comprehensive test suite (43 tests)
7. ✅ Added game status UI indicators
8. ✅ Added JSDoc documentation throughout

**Files Modified:**
- `src/YinshBoard.js` - Core refactoring (650+ lines)
- `src/YinshGame.jsx` - UI enhancements
- `src/YinshBoard.test.js` - NEW (540+ lines, 43 tests)
- `src/testHelpers.js` - NEW (275 lines)
- `TO_DO.md`, `README.md`, `VERSION_MANAGEMENT.md` - Documentation updates

**Testing:**
- **43/43 tests passing** (100% success rate)
- ~85% coverage of critical game logic
- All edge cases validated
- Integration tests completed

**Breaking Changes:** None - fully backward compatible

**Deployment Checklist:**
- [x] All tests passing
- [x] Build successful
- [x] Documentation updated
- [x] Code reviewed
- [ ] Version bumped in package.json
- [ ] Git tagged
- [ ] Pushed to GitHub
- [ ] Vercel deployment verified
- [ ] Production testing completed

---

**Remember**: **MANDATORY TESTING BEFORE DEPLOYMENT**
1. Run `CI=true npm test` - verify all 43 tests pass
2. Run `npm run build` - verify no build errors
3. Manual test all game phases
4. Only then push to GitHub for automatic deployment

When in doubt, test locally first, then deploy with confidence.
