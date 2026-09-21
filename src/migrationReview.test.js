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
import { appendMessage, createMemory } from './games/diplomacy/agents/memory.js';

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
    const {bundle,issues} = await exportProgress(origin);
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
      const {bundle,issues} = await exportProgress(origin);
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
  const {bundle,issues} = await exportProgress(origin);
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
  const {bundle,issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundle.records.find(r => r.kind === 'chess-repertoire').data).toEqual(repertoire);
  expect(bundle.records.find(r => r.kind === 'diplomacy-save').data.conversations).toEqual(conversations);
});

test.each([false,true])('invalid retained entries stay byte-preserved while valid stages work (account=%s)', async signedIn => {
  if (signedIn) localStorage.setItem('gipfAccount',JSON.stringify(account));
  localStorage.setItem('chessDarkMode','true');
  const {bundle} = await exportProgress(origin);
  const original = `[ ${JSON.stringify(bundle)},\n { "future": 9, "private": "unvalidated" }, null ]\n`;
  const key = `gamesMigration:v1:${signedIn ? account.usernameId : 'guest'}`;
  const raw = signedIn ? JSON.stringify(await encryptApiKey(account.aesKey,original)) : original;
  localStorage.setItem(key,raw);
  expect(await inspectStages()).toEqual({stages:[bundle],unreadable:2});
  expect(rawStageRecovery()).toBe(raw);
  expect(localStorage.getItem(key)).toBe(raw);
  const another = (await exportProgress(origin)).bundle;
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
  const {bundle,issues} = await exportProgress(origin);
  expect(issues).toHaveLength(2);
  expect(issues.join(' ')).toContain('Other account recovery');
  expect(JSON.stringify({bundle,issues})).not.toMatch(/private-other-id|private-content/);
});

test('UTF-8 overflow yields a validated partial file, explicit omission and unchanged sources', async () => {
  // JS storage quota counts UTF-16 units; this fits locally but not in UTF-8.
  const goal = '界'.repeat(1800000);
  localStorage.setItem('chessLearningGoal',goal);
  localStorage.setItem('chessDarkMode','true');
  const {bundle,issues} = await exportProgress(origin);
  expect(bundle.records.map(r => r.id)).toEqual(['chessDarkMode']);
  expect(issues.join(' ')).toMatch(/chessLearningGoal: omitted.*5 MiB/);
  expect(new TextEncoder().encode(JSON.stringify(bundle)).length).toBeLessThanOrEqual(MAX_BYTES);
  expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
  expect(localStorage.getItem('chessLearningGoal')).toBe(goal);
  await stageImport(bundle,'retain');
  expect(localStorage.getItem('chessLearningGoal')).toBe(goal);
});

test('combined record overflow omits whole records while retaining later small records', async () => {
  const goal = '界'.repeat(1600000);
  const repertoire = JSON.stringify({version:1,white:['界'.repeat(200000)],black:[]});
  localStorage.setItem('chessLearningGoal',goal);
  localStorage.setItem('chessRepertoire',repertoire);
  // This DATA_KEYS entry is visited after the oversized repertoire record.
  saveGame({board:new DiplomacyBoard(),uiPhase:'orders'});
  const before = Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)]));
  const {bundle,issues} = await exportProgress(origin);
  expect(bundle.records.map(r => r.id)).toEqual(['chessLearningGoal','diplomacyGameState']);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatch(/chess-repertoire chessRepertoire: omitted/);
  expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
  expect(Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)]))).toEqual(before);
});

test('account change while decrypting stages cannot be swallowed as an invalid entry', async () => {
  localStorage.setItem('gipfAccount',JSON.stringify(account));
  const bundle = (await exportProgress(origin)).bundle;
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
