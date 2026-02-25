// Import from the correct file
import YinshBoard from '../YinshBoard.js';

function testYinshGame() {
  let testsPassed = 0;
  let testsFailed = 0;
  
  console.log('=== Starting Yinsh Tests ===\n');

  try {
    // Test 1: Setup Phase
    console.log('Test 1: Setup Phase');
    const board = new YinshBoard();
    
    // Verify initial state
    console.assert(board.getGamePhase() === 'setup', 
      `Initial phase should be setup, got ${board.getGamePhase()}`);
    console.assert(board.getCurrentPlayer() === 1, 
      `First player should be 1, got ${board.getCurrentPlayer()}`);
    
    // Place rings alternately in valid positions
    const setupPositions = [
      [-4, -1], [4, 1],   // Player 1, Player 2
      [-3, 2], [3, -2],   // Player 1, Player 2
      [-2, 3], [2, -3],   // Player 1, Player 2
      [-1, 4], [1, -4],   // Player 1, Player 2
      [0, 0], [-4, 4]     // Player 1, Player 2
    ];

    console.log('Placing rings...');
    for (let i = 0; i < setupPositions.length; i++) {
      const [q, r] = setupPositions[i];
      const player = (i % 2) + 1;
      board.handleSetupRingClick(player, Math.floor(i/2));
      board.handleClick(q, r);
      console.log(`Placed ring for Player ${player} at [${q},${r}]`);
    }

    console.assert(board.getGamePhase() === 'play', 
      `Game should transition to play phase, got ${board.getGamePhase()}`);
    console.assert(board.getRingsPlaced()[1] === 5, 
      `Player 1 should have 5 rings, got ${board.getRingsPlaced()[1]}`);
    console.assert(board.getRingsPlaced()[2] === 5, 
      `Player 2 should have 5 rings, got ${board.getRingsPlaced()[2]}`);
    
    console.log('✅ Setup Phase Test Passed\n');
    testsPassed++;

    // Test 2: Basic Move
    console.log('Test 2: Basic Move');
    const initialHash = board.getStateHash();
    console.log('Initial state hash:', initialHash);
    
    board.handleClick(-4, -1);
    const validMoves = board.getValidMoves();
    console.log(`Found ${validMoves.length} valid moves:`, validMoves);
    console.assert(validMoves.length > 0, 'Should have valid moves');
    
    board.handleClick(-4, 2);
    console.log('Moving ring from [-4,-1] to [-4,2]');
    
    const boardState = board.getBoardState();
    console.assert(boardState['-4,-1']?.type === 'marker' && boardState['-4,-1']?.player === 1,
      `Original position should have player 1 marker, got ${JSON.stringify(boardState['-4,-1'])}`);
    console.assert(boardState['-4,2']?.type === 'ring' && boardState['-4,2']?.player === 1,
      `New position should have player 1 ring, got ${JSON.stringify(boardState['-4,2'])}`);

    const newHash = board.getStateHash();
    console.log('New state hash:', newHash);
    console.assert(initialHash !== newHash, 'State hash should change after move');
    
    console.log('✅ Basic Move Test Passed\n');
    testsPassed++;

    // Test 3: Marker Flipping
    console.log('\nTest 3: Marker Flipping');
    const flipTestBoard = new YinshBoard();
    flipTestBoard.gamePhase = 'play';
    // Set up a line of markers that can be flipped
    flipTestBoard.boardState = {
      '0,0': { type: 'ring', player: 1 },
      '0,1': { type: 'marker', player: 2 },
      '0,2': { type: 'marker', player: 2 },
      '0,3': { type: 'marker', player: 2 },
      '1,4': { type: 'ring', player: 2 }  
    };
    flipTestBoard.currentPlayer = 1;

    console.log('Initial board state:', JSON.stringify(flipTestBoard.getBoardState(), null, 2));
    
    // First click to select the ring
    flipTestBoard.handleClick(0, 0);
    // Second click to move it past the markers to an empty space
    flipTestBoard.handleClick(0, 4);  // Move beyond the markers to an empty space
    
    const flippedState = flipTestBoard.getBoardState();
    console.log('Final board state:', JSON.stringify(flippedState, null, 2));
    
    const markersFlipped = 
      flippedState['0,1']?.player === 1 &&
      flippedState['0,2']?.player === 1 &&
      flippedState['0,3']?.player === 1;
    
    if (!markersFlipped) {
      console.log('❌ Marker Flipping Test Failed\n');
      testsFailed++;
    } else {
      console.log('✅ Marker Flipping Test Passed\n');
      testsPassed++;
    }

    // Test 4: Row Detection
    console.log('Test 4: Row Detection');
    const rowTestBoard = new YinshBoard();
    rowTestBoard.gamePhase = 'play';
    rowTestBoard.currentPlayer = 1;
    rowTestBoard.boardState = {
      '0,0': { type: 'marker', player: 1 },
      '1,0': { type: 'marker', player: 1 },
      '2,0': { type: 'marker', player: 1 },
      '3,0': { type: 'marker', player: 1 },
      '4,0': { type: 'marker', player: 1 },
      '-1,0': { type: 'ring', player: 1 }
    };

    const singleRowDetected = rowTestBoard.checkForRows();
    console.log('Detected single row:', JSON.stringify(singleRowDetected, null, 2));

    // Test for unique rows in single row case
    const singleUniqueRow = singleRowDetected.filter((row, index, self) => 
      index === self.findIndex(r => 
        JSON.stringify(r.markers) === JSON.stringify(row.markers)
      )
    );

    console.assert(singleUniqueRow.length === 1, 
      `Should detect exactly one unique row of 5 markers, got ${singleUniqueRow.length} rows`);
    
    if (singleUniqueRow.length !== 1) {
      console.log('❌ Row Detection Test Failed\n');
      testsFailed++;
    } else {
      console.log('✅ Row Detection Test Passed\n');
      testsPassed++;
    }

    // Test 5: Game End Condition
    console.log('Test 5: Game End Condition');
    const endGameBoard = new YinshBoard();
    endGameBoard.gamePhase = 'play';
    endGameBoard.scores = { 1: 2, 2: 0 };
    
    console.assert(endGameBoard.getWinner() === null, 
      `Game should not be over yet, got winner ${endGameBoard.getWinner()}`);
    
    endGameBoard.scores[1] = 3;
    endGameBoard.gamePhase = 'game-over';
    endGameBoard.winner = 1;
    
    console.assert(endGameBoard.getWinner() === 1, 
      `Player 1 should win with 3 points, got winner ${endGameBoard.getWinner()}`);
    
    console.log('✅ Game End Condition Test Passed\n');
    testsPassed++;

    // New Test 6: Invalid Move Detection
    console.log('\nTest 6: Invalid Move Detection');
    const invalidMoveBoard = new YinshBoard();
    invalidMoveBoard.gamePhase = 'play';
    invalidMoveBoard.boardState = {
      '0,0': { type: 'ring', player: 1 },
      '1,0': { type: 'ring', player: 2 }
    };
    invalidMoveBoard.currentPlayer = 1;
    
    // Try to move without selecting
    invalidMoveBoard.handleClick(2, 0);
    console.assert(Object.keys(invalidMoveBoard.getBoardState()).length === 2,
      'Board should not change without ring selection');
    
    // Try to move opponent's ring
    invalidMoveBoard.handleClick(1, 0);
    console.assert(invalidMoveBoard.selectedRing === null,
      "Should not be able to select opponent's ring");

    console.log('✅ Invalid Move Detection Test Passed\n');
    testsPassed++;

    // Test 7: Multiple Row Detection
    console.log('\nTest 7: Multiple Row Detection');
    const multiRowBoard = new YinshBoard();
    multiRowBoard.gamePhase = 'play';
    multiRowBoard.currentPlayer = 1;
    // Create two distinct rows
    multiRowBoard.boardState = {
      '0,0': { type: 'marker', player: 1 },
      '1,0': { type: 'marker', player: 1 },
      '2,0': { type: 'marker', player: 1 },
      '3,0': { type: 'marker', player: 1 },
      '4,0': { type: 'marker', player: 1 },
      // Second row
      '0,1': { type: 'marker', player: 1 },
      '1,1': { type: 'marker', player: 1 },
      '2,1': { type: 'marker', player: 1 },
      '3,1': { type: 'marker', player: 1 },
      '4,1': { type: 'marker', player: 1 }
    };

    // Use the actual game's row detection
    const multipleRowsDetected = multiRowBoard.checkForRows();
    console.log('Detected multiple rows:', JSON.stringify(multipleRowsDetected, null, 2));

    // Test for unique rows in multiple row case
    const multipleUniqueRows = multipleRowsDetected.filter((row, index, self) => 
      index === self.findIndex(r => 
        JSON.stringify(r.markers) === JSON.stringify(row.markers)
      )
    );

    console.assert(multipleUniqueRows.length === 2, 
      `Should detect exactly two unique rows of 5 markers, got ${multipleUniqueRows.length} rows`);
    
    if (multipleUniqueRows.length !== 2) {
      console.log('❌ Multiple Row Detection Test Failed\n');
      testsFailed++;
    } else {
      console.log('✅ Multiple Row Detection Test Passed\n');
      testsPassed++;
    }

    // New Test 8: Ring Selection
    console.log('\nTest 8: Ring Selection');
    const selectionBoard = new YinshBoard();
    selectionBoard.gamePhase = 'play';
    selectionBoard.boardState = {
      '0,0': { type: 'ring', player: 1 },
      '1,0': { type: 'ring', player: 2 }
    };
    selectionBoard.currentPlayer = 1;

    // Try selecting own ring
    selectionBoard.handleClick(0, 0);
    console.assert(selectionBoard.getSelectedRing() !== null, 
      "Should be able to select own ring");

    // Try selecting opponent's ring
    selectionBoard.handleClick(1, 0);
    console.assert(selectionBoard.getSelectedRing()?.[0] === 0 && selectionBoard.getSelectedRing()?.[1] === 0,
      "Selected ring should not change when clicking opponent's ring");

    console.log('✅ Ring Selection Test Passed\n');
    testsPassed++;

    // New Test 9: State Hash Consistency
    console.log('\nTest 9: State Hash Consistency');
    const hashBoard = new YinshBoard();
    const emptyBoardHash = hashBoard.getStateHash();
    
    // Make a move
    hashBoard.gamePhase = 'play';
    hashBoard.boardState['0,0'] = { type: 'ring', player: 1 };
    const modifiedBoardHash = hashBoard.getStateHash();
    
    console.assert(emptyBoardHash !== modifiedBoardHash,
      "State hash should change when board state changes");
    
    const sameBoard = new YinshBoard();
    sameBoard.gamePhase = 'play';
    sameBoard.boardState['0,0'] = { type: 'ring', player: 1 };
    console.assert(sameBoard.getStateHash() === modifiedBoardHash,
      "Same board state should produce same hash");

    console.log('✅ State Hash Consistency Test Passed\n');
    testsPassed++;

  } catch (error) {
    console.error('Test error:', error);
    testsFailed++;
  }

  console.log(`=== Test Summary ===`);
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);
  
  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed successfully!');
  }
}

// Run the tests
testYinshGame(); 