import * as chess from './games/chess/matchSnapshot.js';
import * as yinsh from './games/yinsh/matchSnapshot.js';
import * as zertz from './games/zertz/matchSnapshot.js';
import * as catan from './games/catan/matchSnapshot.js';
import { shape, array, map, text, number, integer, one, nullable, bool, count, mistake, safeTree, fail } from './migrationSchema.js';

const p2 = one(1,2), p6 = integer(1,6), coord = v => array(integer(-5,5),2)(v) && v.length === 2;
const setupRing = nullable(shape({player:p2,index:integer(0,4)}));
const row = shape({player:p2,markers:array(coord,5)}, {direction:coord});
const yinshState = shape({
  boardState: map(nullable(shape({type:one('ring','marker'),player:p2})), /^-?\d+,-?\d+$/, 100),
  gamePhase: one('setup','play','remove-row','remove-ring','game-over'), currentPlayer:p2,
  ringsPlaced:shape({1:integer(0,5),2:integer(0,5)}), scores:shape({1:integer(0,3),2:integer(0,3)}),
  selectedRing:nullable(coord), validMoves:array(coord,100), rows:array(row,100), nextTurnPlayer:nullable(p2),
  rowResolutionQueue:array(shape({player:p2,rows:array(row,100)}),100), pendingRowsAfterRingRemoval:bool,
  winner:nullable(p2), selectedSetupRing:setupRing,
  notation:shape({currentMoveNumber:count,moveHistory:array(shape({moveNumber:count,player:p2,type:one('placement','move','row-removal','ring-removal'),notation:text()},
    {from:nullable(coord),to:coord,markersFlipped:count,rowFormed:bool,row:array(coord,5),position:coord,gameWon:bool}))}),
});
const colors = one('white','grey','black');
const marbleCounts = shape({white:integer(0,24),grey:integer(0,24),black:integer(0,24)});
const coordKey = v => typeof v === 'string' && /^-?\d+,-?\d+$/.test(v);
const zertzState = shape({
  rings:array(coordKey,37),marbles:map(colors,/^-?\d+,-?\d+$/,37),pool:marbleCounts,captures:shape({1:marbleCounts,2:marbleCounts}),
  currentPlayer:p2,gamePhase:one('place-marble','remove-ring','capture','game-over'),winner:nullable(p2),
  winConditionMet:nullable(shape({white:count,grey:count,black:count})),
  selectedColor:nullable(colors),jumpingMarble:nullable(coordKey),captureStarted:bool,
});
const short = text(80), ids = array(short,500), resources = ['brick','lumber','wool','grain','ore'];
const amounts = shape(Object.fromEntries(resources.map(k => [k,integer(0,1000)])));
const partialAmounts = shape({}, Object.fromEntries(resources.map(k => [k,integer(0,1000)])));
const dev = shape(Object.fromEntries(['knight','victoryPoint','roadBuilding','yearOfPlenty','monopoly'].map(k => [k,integer(0,25)])));
const port = nullable(one(...resources,'any','generic','3:1'));
const tile = shape({id:short,q:integer(-10,10),r:integer(-10,10),x:number(-50,50),y:number(-50,50),resource:one(...resources,'desert'),number:nullable(integer(0,12)),vertices:ids,edges:ids});
const vertex = shape({id:short,x:number(-50,50),y:number(-50,50),tileIds:ids,edgeIds:ids,adjacent:ids,port,building:nullable(shape({player:p6,type:one('settlement','city')}))});
const edge = shape({id:short,vertices:ids,tileIds:ids,owner:nullable(p6)}, {port});
const player = shape({id:p6,name:short,color:short,resources:amounts,devCards:dev,newDevCards:dev,roads:ids,settlements:ids,cities:ids,knightsPlayed:count,playedDevThisTurn:bool,longestRoad:bool,largestArmy:bool});
const phase = one('setup-settlement','setup-road','roll','action','discard','robber','trade-response','paired-action','game-over');
const catanState = shape({
  seed:integer(0,Number.MAX_SAFE_INTEGER),rngState:integer(-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),rulesetId:short,scenarioId:nullable(short),playerCount:integer(3,6),playerIds:array(p6,6),mapProfileId:short,mapName:text(256),
  victoryTarget:count,scenarioTarget:count,pairedPlayers:bool,pieceLimits:shape({roads:count,settlements:count,cities:count}),
  tiles:array(tile,100),vertices:map(vertex,/^v\d+$/,500),edges:map(edge,/^v\d+\|v\d+$/,1000),robberTileId:short,players:map(player,/^[1-6]$/,6),bank:amounts,
  devDeck:array(one('knight','victoryPoint','roadBuilding','yearOfPlenty','monopoly'),100),discardLog:array(shape({player:p6,resources:amounts})),
  currentPlayer:p6,primaryTurnPlayer:p6,phase,setupOrder:array(p6,12),firstPlayer:p6,setupIndex:count,pendingSetupSettlement:nullable(short),turnNumber:count,dice:nullable(integer(2,12)),lastRoll:nullable(integer(2,12)),lastAction:text(),pendingAfterRobberPhase:nullable(phase),freeRoadsRemaining:integer(0,2),
  discardQueue:array(shape({player:p6,remaining:count}),6),specialBuildQueue:array(p6,6),
  pendingTrade:nullable(shape({proposer:p6,give:partialAmounts,receive:partialAmounts,targets:array(p6,6),index:count,returnPhase:phase})),
  tradeProposalsThisTurn:count,maxTradeProposalsPerTurn:count,longestRoadHolder:nullable(p6),largestArmyHolder:nullable(p6),winner:nullable(p6),winningPoints:count,
  stateHistory:array(() => false,0),historyIndex:one(-1),maxHistoryLength:count,
});
const analysis = shape({}, {fenBefore:text(120),fenAfter:text(120),movePlayed:short,classification:short,evalBefore:short,evalAfter:short,bestMove:text(),opening:text(256),commentary:text(10000)});
const dialogue = shape({id:v => text(80)(v) || count(v),ply:count,kind:short,san:text(32),tone:short,label:short,text:text(10000),source:short,pending:bool},
  {opening:nullable(text(256)),leftBook:bool,analysis,thread:array(shape({role:one('user','assistant'),content:text(10000)}),200)});
const uiSchemas = {
  chess:shape({}, {humanColor:one('w','b'),orientation:one('white','black'),resigned:nullable(one('w','b')),rated:bool,difficulty:short,clock:nullable(shape({w:number(),b:number()})),timeControl:short,flagged:nullable(one('w','b')),ratedApplied:bool,historyApplied:bool,gameLogged:bool,dialogue:array(dialogue),moveStats:array(shape({ply:count,moverColor:one('w','b'),cpLoss:number(0,1000000),classification:short})),gameMistakes:array(mistake,200)}),
  yinsh:shape({}, {humanPlayer:p2,twoPlayerMode:bool,showModal:bool,difficulty:short,selectedSetupRing:setupRing,scoreApplied:bool}),
  zertz:shape({}, {humanPlayer:p2,twoPlayerMode:bool,showModal:bool,difficulty:short,lastMoveKeys:array(coordKey,37)}),
  catan:shape({}, {showModal:bool,gameConfig:shape({rulesetId:short,playerCount:integer(3,6)},{scenarioId:nullable(short)}),selectedAction:nullable(short),
    lastMove:nullable(shape({type:short},{vertexId:short,edgeId:short,tileId:short,stealPlayerId:nullable(p6),resource:one(...resources),resourceA:one(...resources),resourceB:one(...resources),resources:partialAmounts,player:p6,give:v => partialAmounts(v) || one(...resources)(v),receive:v => partialAmounts(v) || one(...resources)(v),targets:array(p6,6),accept:bool,free:bool,ratio:integer(2,4)})),
    showTradeBuilder:bool,tradeGive:partialAmounts,tradeReceive:partialAmounts,tradeTargets:array(p6,6),showMonopolyPicker:bool,showYopPicker:bool,yopPick:array(one(...resources),2),robberVictimPicker:nullable(shape({tileId:short,victims:array(p6,6)})),gameLog:array(text())}),
};
const adapters = {chess,yinsh,zertz,catan};
const states = {chess:shape({pgn:text(240000),initialFen:text(120)}),yinsh:yinshState,zertz:zertzState,catan:catanState};
export function validatePortableMatch(value, game) {
  if (!safeTree(value) || !states[game]?.(value?.state) || !uiSchemas[game](value.ui)) fail();
  adapters[game].decodeMatch(value);
}
