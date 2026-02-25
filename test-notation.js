import YinshBoard from './src/games/yinsh/YinshBoard.js';

console.log('=====================================');
console.log('  YINSH NOTATION SYSTEM TEST');
console.log('=====================================\n');

console.log('Starting game with move-by-move logging...\n');
console.log('--- Setup Phase ---');

const board = new YinshBoard();

// Place rings for both players
const ringPlacements = [
  [0, 0],    // Player 1
  [-3, 2],   // Player 2
  [2, -2],   // Player 1
  [1, 3],    // Player 2
  [-2, -1],  // Player 1
  [3, -1],   // Player 2
  [1, -3],   // Player 1
  [-1, -2],  // Player 2
  [-3, 0],   // Player 1
  [2, 2]     // Player 2
];

ringPlacements.forEach(([q, r], i) => {
  const player = (i % 2) + 1;
  board.handleSetupRingClick(player, Math.floor(i / 2));
  board.handleClick(q, r);
});

console.log('\n✅ Setup complete! Phase:', board.getGamePhase());
console.log('\n=====================================');
console.log('     MOVE HISTORY (Setup)');
console.log('=====================================');
console.log(board.getMoveHistory().join('\n'));

console.log('\n=====================================');
console.log('     FULL GAME LOG');
console.log('=====================================');
board.printGameLog();

console.log('\n=====================================');
console.log('     COMPACT NOTATION EXPORT');
console.log('=====================================');
console.log(board.exportNotation());
console.log('\n✅ Notation system test complete!');
