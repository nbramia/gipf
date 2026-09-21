import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { exportProgress, validateFile, stageImport, readStages, inspectStages, rawStageRecovery, captureIdentity, MAX_BYTES } from './migration.js';
import { encryptApiKey, decryptApiKey } from './account.js';
import { recordPuzzleResult, saveProgress } from './games/chess/coach/puzzleProgress.js';
import DiplomacyBoard from './games/diplomacy/DiplomacyBoard.js';
import { saveGame } from './games/diplomacy/diplomacyPersistence.js';
import YinshBoard from './games/yinsh/YinshBoard.js';
import * as yinsh from './games/yinsh/matchSnapshot.js';
import { pinOpening, saveRepertoire } from './games/chess/coach/repertoire.js';
import { appendMessage, createMemory, updateScratchpad, validateScratchpad } from './games/diplomacy/agents/memory.js';
import { createDiplomaticState, recordAgreement, setScratchpad } from './games/diplomacy/agents/diplomaticState.js';
import { runNegotiationPhase } from './games/diplomacy/agents/negotiator.js';

beforeAll(() => {
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
  globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder;
  Object.defineProperty(navigator,'locks',{value:{request:async (_,fn) => fn()},configurable:true});
});
beforeEach(() => localStorage.clear());
const origin = 'https://synthetic.example.test';
const account = {v:1,username:'Synthetic',usernameId:'1'.repeat(64),authToken:'2'.repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:'3'.repeat(64)};

test('real Diplomacy adjudication survives winters, multi-year history and writer soft-cap overflow', async () => {
  const board = new DiplomacyBoard({maxYears:1950});
  let winters = 0, largest = 0;
  // England takes Norway, then builds: a legal winter enters undo history.
  // Subsequent all-hold adjudications grow late-game history without AI RNG.
  for (let step = 0; step < 45; step++) {
    if (board.isWinterPhase()) { winters++; board.processAdjustments({england:[{type:'build',power:'england',unitType:'fleet',loc:'LON'}]}); }
    else if (board.isRetreatPhase()) board.processRetreats({});
    else board.processOrders(step < 2 ? {england:[{type:'move',unitLoc:step === 0 ? 'LON' : 'NTH',to:step === 0 ? 'NTH' : 'NWY'}]} : {});
    expect(saveGame({board,uiPhase:board.isWinterPhase() ? 'winter' : 'orders'})).toBe(true);
    const raw = localStorage.getItem('diplomacyGameState');
    largest = Math.max(largest,new TextEncoder().encode(raw).length);
    const {bundles:[bundle],issues} = await exportProgress(origin);
    expect(issues).toEqual([]);
    expect(bundle.records[0].data).toEqual(JSON.parse(raw));
    expect(DiplomacyBoard.fromSerializedState(bundle.records[0].data.board).serializeState()).toEqual(board.serializeState());
    expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
    expect(localStorage.getItem('diplomacyGameState')).toBe(raw);
  }
  expect(winters).toBeGreaterThan(0);
  expect(board.year).toBeGreaterThan(1910);
  expect(largest).toBeGreaterThan(400000);
});

test('seeded legal Yinsh play exports remove-row and queued fullLineLength without dropping fields', async () => {
  const board = new YinshBoard();
  let seed = 17;
  const pick = list => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return list[seed % list.length]; };
  const cells = YinshBoard.generateGridPoints();
  for (let i = 0; i < 10; i++) {
    board.selectedSetupRing = {player:board.currentPlayer,index:board.ringsPlaced[board.currentPlayer]};
    board.handleClick(...pick(cells.filter(c => !board.boardState[c.join(',')])));
  }
  let rows = 0;
  for (let turn = 0; turn < 1500 && board.gamePhase !== 'game-over'; turn++) {
    if (board.gamePhase === 'play') {
      const rings = Object.entries(board.boardState).filter(([key,p]) => p?.type === 'ring' && p.player === board.currentPlayer && board.calculateValidMoves(...key.split(',').map(Number)).length);
      const [key] = pick(rings);
      board.handleClick(...key.split(',').map(Number));
      board.handleClick(...pick(board.validMoves));
    } else if (board.gamePhase === 'remove-row') {
      rows++;
      expect(board.rows.every(r => r.fullLineLength >= 5)).toBe(true);
      const value = {v:1,game:'yinsh',id:'seeded-yinsh',updatedAt:1,state:yinsh.encodeBoard(board),ui:{}};
      yinsh.decodeMatch(value);
      const raw = JSON.stringify(value);
      localStorage.setItem('yinshMatch:v1',raw);
      localStorage.setItem('yinshMatchRecovery:v1',JSON.stringify({v:1,alternatives:[{...value,updatedAt:2}]}));
      const {bundles:[bundle],issues} = await exportProgress(origin);
      expect(issues).toEqual([]);
      expect(bundle.records).toHaveLength(2);
      expect(bundle.records[0].data).toEqual(JSON.parse(raw));
      expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
      board.removeRow(board.rows[0].markers);
    } else if (board.gamePhase === 'remove-ring') {
      const [key] = Object.entries(board.boardState).find(([,p]) => p?.type === 'ring' && p.player === board.currentPlayer);
      board.handleClick(...key.split(',').map(Number));
    }
  }
  expect(rows).toBeGreaterThan(0);
  expect(board.gamePhase).toBe('game-over');
});

test('actual puzzle writer exceeds 500 entries and long learning goals remain portable', async () => {
  let progress = {rating:1000,attempts:0,puzzles:{}};
  for (let i = 0; i < 501; i++) progress = recordPuzzleResult(progress,{id:`daily_${i}`,rating:1000},i % 2 === 0,1000);
  saveProgress(progress);
  localStorage.setItem('chessLearningGoal','practice '.repeat(1000));
  const {bundles:[bundle],issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundle.records.find(r => r.kind === 'chess-puzzles').data).toEqual(progress);
  expect(bundle.records.find(r => r.id === 'chessLearningGoal').data).toBe(localStorage.getItem('chessLearningGoal'));
});

test('uncapped repertoire and Diplomacy conversation writers fit the envelope budget', async () => {
  let repertoire = {version:1,white:[],black:[]};
  for (let i = 0; i < 201; i++) repertoire = pinOpening(repertoire,'white',`Opening ${i}`);
  saveRepertoire(repertoire);
  const conversations = createMemory(['england']);
  appendMessage(conversations,'england',{role:'user',content:'discussion '.repeat(1100),turn:'Spring 1901'});
  expect(saveGame({board:new DiplomacyBoard(),uiPhase:'negotiation',conversations})).toBe(true);
  const {bundles:[bundle],issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundle.records.find(r => r.kind === 'chess-repertoire').data).toEqual(repertoire);
  expect(bundle.records.find(r => r.kind === 'diplomacy-save').data.conversations).toEqual(conversations);
});

test.each([false,true])('invalid retained entries stay byte-preserved while valid stages work (account=%s)', async signedIn => {
  if (signedIn) localStorage.setItem('gipfAccount',JSON.stringify(account));
  localStorage.setItem('chessDarkMode','true');
  const {bundles:[bundle]} = await exportProgress(origin);
  const original = `[ ${JSON.stringify(bundle)},\n { "future": 9, "private": "unvalidated" }, null ]\n`;
  const key = `gamesMigration:v1:${signedIn ? account.usernameId : 'guest'}`;
  const raw = signedIn ? JSON.stringify(await encryptApiKey(account.aesKey,original)) : original;
  localStorage.setItem(key,raw);
  expect(await inspectStages()).toEqual({stages:[bundle],unreadable:2});
  expect(rawStageRecovery()).toBe(raw);
  expect(localStorage.getItem(key)).toBe(raw);
  const another = (await exportProgress(origin)).bundles[0];
  await stageImport(another,'retain');
  expect(await readStages()).toEqual([bundle,another]);
  const stored = localStorage.getItem(key);
  const decoded = signedIn ? await decryptApiKey(account.aesKey,JSON.parse(stored)) : stored;
  expect(decoded).toContain(original.slice(0,original.lastIndexOf(']')));
  expect(await inspectStages()).toEqual({stages:[bundle,another],unreadable:2});
  const guard = captureIdentity(); guard.invalidate();
  expect(() => rawStageRecovery(guard)).toThrow('account_changed');
  if (signedIn) {
    expect(stored).not.toContain('unvalidated');
    localStorage.removeItem('gipfAccount');
    expect(await readStages()).toEqual([]);
    expect(() => rawStageRecovery()).toThrow();
  }
});

test('raw escape preserves damaged container but cannot enter validated migration', async () => {
  localStorage.setItem('gamesMigration:v1:guest','{unreadable original');
  expect(rawStageRecovery()).toBe('{unreadable original');
  await expect(validateFile(rawStageRecovery())).rejects.toThrow();
});

test.each([false,true])('excluded recovery warning is generic with no account IDs or counts (account=%s)', async signedIn => {
  if (signedIn) localStorage.setItem('gipfAccount',JSON.stringify(account));
  localStorage.setItem('gipf:recovery:private-other-id','sealed-private-content');
  localStorage.setItem('gipf:guest:recovery','guest-private-content');
  const {bundles:[bundle],issues} = await exportProgress(origin);
  expect(issues).toHaveLength(2);
  expect(issues.join(' ')).toContain('Other account recovery');
  expect(JSON.stringify({bundle,issues})).not.toMatch(/private-other-id|private-content/);
});

test('a single record over the file limit is reported, never truncated, and other records still export', async () => {
  // JS storage quota counts UTF-16 units; this fits locally but not in UTF-8.
  const goal = '界'.repeat(1800000);
  localStorage.setItem('chessLearningGoal',goal);
  localStorage.setItem('chessDarkMode','true');
  const {bundles,issues,manifest} = await exportProgress(origin);
  expect(bundles).toHaveLength(1);
  expect(bundles[0].records.map(r => r.id)).toEqual(['chessDarkMode']);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatch(/chessLearningGoal: larger than the 5 MiB single-file limit.*Nothing was truncated/);
  expect(manifest).toEqual(expect.arrayContaining([{kind:'preference',id:'chessLearningGoal',file:null},{kind:'preference',id:'chessDarkMode',file:1}]));
  expect(manifest).toHaveLength(2);
  expect(new TextEncoder().encode(JSON.stringify(bundles[0])).length).toBeLessThanOrEqual(MAX_BYTES);
  expect(await validateFile(JSON.stringify(bundles[0]))).toEqual(bundles[0]);
  expect(localStorage.getItem('chessLearningGoal')).toBe(goal);
  await stageImport(bundles[0],'retain');
  expect(localStorage.getItem('chessLearningGoal')).toBe(goal);
});

// Late-game Diplomacy history: all-hold adjudication after one legal build.
function lateDiplomacy(phases) {
  const board = new DiplomacyBoard({maxYears:1990});
  for (let step = 0; step < phases; step++) {
    if (board.isWinterPhase()) board.processAdjustments({england:[{type:'build',power:'england',unitType:'fleet',loc:'LON'}]});
    else if (board.isRetreatPhase()) board.processRetreats({});
    else board.processOrders(step < 2 ? {england:[{type:'move',unitLoc:step === 0 ? 'LON' : 'NTH',to:step === 0 ? 'NTH' : 'NWY'}]} : {});
  }
  expect(saveGame({board,uiPhase:'orders'})).toBe(true);
  return board;
}

test('records that together exceed one file are split into independent complete files, sources unchanged', async () => {
  lateDiplomacy(100);
  const save = localStorage.getItem('diplomacyGameState');
  const goal = '界'.repeat(1300000);
  localStorage.setItem('chessLearningGoal',goal);
  localStorage.setItem('chessDarkMode','true');
  const utf8 = v => new TextEncoder().encode(v).length;
  expect(utf8(save) + utf8(goal)).toBeGreaterThan(MAX_BYTES);
  const before = Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)]));
  const {bundles,issues,manifest} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundles).toHaveLength(2);
  expect(new Set(bundles.map(b => b.exportId)).size).toBe(2);
  for (const bundle of bundles) {
    expect(utf8(JSON.stringify(bundle))).toBeLessThanOrEqual(MAX_BYTES);
    expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
  }
  const all = bundles.flatMap(b => b.records);
  expect(all.map(r => r.id).sort()).toEqual(['chessDarkMode','chessLearningGoal','diplomacyGameState']);
  expect(all.find(r => r.kind === 'diplomacy-save').data).toEqual(JSON.parse(save));
  expect(manifest.every(r => r.file === bundles.findIndex(b => b.records.some(x => x.kind === r.kind && x.id === r.id)) + 1)).toBe(true);
  expect(Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)]))).toEqual(before);
}, 60000);

test('staging split files keeps distinct IDs and replays each file idempotently', async () => {
  const goal = '界'.repeat(1000000);
  localStorage.setItem('chessLearningGoal',goal);
  localStorage.setItem('chessRepertoire',JSON.stringify({version:1,white:['界'.repeat(800000)],black:[]}));
  const {bundles,issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundles).toHaveLength(2);
  // One identity's stage holds at most 5 MiB, so retain the smaller file here.
  const [smallest] = [...bundles].sort((a,b) => JSON.stringify(a).length - JSON.stringify(b).length);
  expect(await stageImport(smallest,'retain')).toEqual({status:'retained'});
  expect(await stageImport(smallest,'retain')).toEqual({status:'replay'});
  await expect(stageImport({...smallest,records:[]},'retain')).rejects.toThrow('export_id_collision');
});

test('account change while decrypting stages cannot be swallowed as an invalid entry', async () => {
  localStorage.setItem('gipfAccount',JSON.stringify(account));
  const bundle = (await exportProgress(origin)).bundles[0];
  await stageImport(bundle,'retain');
  const real = webcrypto.subtle.decrypt.bind(webcrypto.subtle);
  let release, reached;
  const pause = new Promise(r => { release = r; });
  const started = new Promise(r => { reached = r; });
  const spy = jest.spyOn(webcrypto.subtle,'decrypt').mockImplementation(async (...args) => { reached(); await pause; return real(...args); });
  const pending = inspectStages();
  await started;
  localStorage.removeItem('gipfAccount');
  release();
  await expect(pending).rejects.toThrow('account_changed');
  spy.mockRestore();
  expect(await readStages()).toEqual([]);
});

// Mirrors api/diplomacyAgent.js validateDeal, the gate for every stored deal.
const endpointProvince = p => typeof p === 'string' && /^[A-Za-z]{2,4}(\/(nc|sc|ec))?$/.test(p);
const negotiationBase = () => createDiplomaticState({board:new DiplomacyBoard(),humanPower:'england'});
async function exportsDiplomacy(diplomaticState, conversations = null) {
  localStorage.clear();
  expect(saveGame({board:new DiplomacyBoard(),uiPhase:'negotiation',diplomaticState,conversations})).toBe(true);
  const {bundles,issues} = await exportProgress(origin);
  const record = bundles.flatMap(b => b.records).find(r => r.kind === 'diplomacy-save');
  if (record) expect(record.data).toEqual(JSON.parse(localStorage.getItem('diplomacyGameState')));
  return {ok:!!record,issues};
}

test.each(['SPA','spa','Spa','stp/nc','Kie'])('chat DMZ and support deals with endpoint location %s export', async loc => {
  expect(endpointProvince(loc)).toBe(true);
  // DiplomacyGame.jsx foldDealIntoState entries.
  let ds = recordAgreement(negotiationBase(),{id:'chat-france-england-dmz',type:'dmz',parties:['france','england'],provinces:[loc,'bur']});
  ds = recordAgreement(ds,{id:'chat-france-england-support',type:'support',parties:['france','england'],to:loc});
  expect(await exportsDiplomacy(ds)).toEqual({ok:true,issues:[]});
});

test.each(['SPA','spa','Mun'])('AI-AI negotiated support deal to %s exports through runNegotiationPhase', async loc => {
  const askAgent = async ({power}) => ({reply:{message:`${power} proposes`,deal:{type:'support',from:'ven',to:loc},accept:true}});
  const {state} = await runNegotiationPhase({board:new DiplomacyBoard(),state:negotiationBase(),askAgent,options:{humanPower:'england',maxRounds:1,maxPairsPerRound:2,seed:3}});
  expect(state.agreements.some(a => a.to === loc && a.from === 'ven')).toBe(true);
  expect(await exportsDiplomacy(state)).toEqual({ok:true,issues:[]});
});

test.each(['germany','Germany','the Ottoman Empire'])('joint-attack target string %s exports', async target => {
  const ds = recordAgreement(negotiationBase(),{id:'chat-france-england-joint-attack',type:'joint-attack',parties:['france','england'],target});
  expect(await exportsDiplomacy(ds)).toEqual({ok:true,issues:[]});
});

const pad = extra => ({self:'hold the line',dispositions:{france:{trust:0.2,stance:'friendly',intent:'ally'}},confidence:0.5,...extra});
test.each([
  ['string priority',{priority:'Belgium'}],
  ['numeric priority',{priority:3}],
  ['extra top-level keys',{mood:'calm',plan:{spring:['BEL']}}],
  ['capitalized and unusual disposition keys',{dispositions:{France:{trust:0,stance:'neutral',intent:'x',note:7},'the Turks':{trust:-1,stance:'enemy',intent:''}}}],
  ['empty dispositions',{dispositions:{}}],
])('writer-valid scratchpad with %s exports from hidden state and chat thread', async (_,extra) => {
  const sp = pad(extra);
  expect(validateScratchpad(sp)).toBe(true);
  expect(await exportsDiplomacy(setScratchpad(negotiationBase(),'france',sp))).toEqual({ok:true,issues:[]});
  const conv = createMemory(['france']);
  updateScratchpad(conv,'france',{scratchpad:sp});
  expect(conv.threads.france.scratchpad).toBe(sp);
  expect(await exportsDiplomacy(negotiationBase(),conv)).toEqual({ok:true,issues:[]});
});

test.each([
  ['agreement unknown field',ds => recordAgreement(ds,{type:'dmz',parties:['france','england'],provinces:['spa'],surprise:1})],
  ['location beyond endpoint pattern',ds => recordAgreement(ds,{type:'dmz',parties:['france','england'],provinces:['Spain']})],
  ['empty joint-attack target',ds => recordAgreement(ds,{type:'joint-attack',parties:['france','england'],target:''})],
  ['scratchpad secret key',ds => setScratchpad(ds,'france',pad({token:'synthetic'}))],
  ['scratchpad missing confidence',ds => setScratchpad(ds,'france',{self:'x',dispositions:{}})],
  ['disposition bad stance',ds => setScratchpad(ds,'france',pad({dispositions:{france:{trust:0,stance:'lover',intent:'x'}}}))],
  ['too many disposition keys',ds => setScratchpad(ds,'france',pad({dispositions:Object.fromEntries(Array.from({length:257},(_,i) => [`p${i}`,{trust:0,stance:'neutral',intent:''}]))}))],
  ['too many extension keys',ds => setScratchpad(ds,'france',pad(Object.fromEntries(Array.from({length:257},(_,i) => [`k${i}`,i]))))],
])('negotiated content outside writer contracts or bounds stays excluded: %s', async (_,mutate) => {
  const r = await exportsDiplomacy(mutate(negotiationBase()));
  expect(r.ok).toBe(false);
  expect(r.issues).toEqual(['diplomacyGameState: unsupported or damaged; original retained.']);
});

test('real retreat phase from legal opening orders exports with pending retreats and retreat choices', async () => {
  const board = new DiplomacyBoard();
  board.processOrders({germany:[{type:'move',unitLoc:'MUN',to:'RUH'},{type:'move',unitLoc:'BER',to:'MUN'}],france:[{type:'move',unitLoc:'PAR',to:'BUR'}]});
  board.processOrders({germany:[{type:'move',unitLoc:'RUH',to:'BUR'},{type:'support-move',unitLoc:'MUN',from:'RUH',to:'BUR'}],france:[{type:'hold',unitLoc:'BUR'}]});
  expect(board.phase).toBe('fall-retreats');
  expect(board.pendingRetreats).toEqual([expect.objectContaining({unitLoc:'BUR',attackerFrom:'RUH'})]);
  const to = board.pendingRetreats[0].options[0];
  for (const [uiPhase,uiState] of [['retreats',{pendingOrders:{},retreatChoices:{BUR:to},buildOrders:{}}],['retreats',{pendingOrders:{},retreatChoices:{BUR:'DISBAND'},buildOrders:{}}]]) {
    localStorage.clear();
    expect(saveGame({board,uiPhase,uiState})).toBe(true);
    const {bundles:[bundle],issues} = await exportProgress(origin);
    expect(issues).toEqual([]);
    expect(bundle.records[0].data.board.pendingRetreats).toHaveLength(1);
    expect(DiplomacyBoard.fromSerializedState(bundle.records[0].data.board).serializeState()).toEqual(board.serializeState());
  }
  expect(board.processRetreats({france:[{type:'retreat',unitLoc:'BUR',to}]})).toBe(true);
  expect(board.phase).toBe('winter-build');
  localStorage.clear();
  expect(saveGame({board,uiPhase:'winter'})).toBe(true);
  expect((await exportProgress(origin)).issues).toEqual([]);
});

test('raw recovery with no stage reports a specific no_stage condition', () => {
  expect(() => rawStageRecovery()).toThrow('no_stage');
});
