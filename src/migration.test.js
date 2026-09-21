import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import ChessBoard from './games/chess/ChessBoard.js';
import YinshBoard from './games/yinsh/YinshBoard.js';
import ZertzBoard from './games/zertz/ZertzBoard.js';
import CatanBoard from './games/catan/CatanBoard.js';
import * as chess from './games/chess/matchSnapshot.js';
import * as yinsh from './games/yinsh/matchSnapshot.js';
import * as zertz from './games/zertz/matchSnapshot.js';
import * as catan from './games/catan/matchSnapshot.js';
import { exportProgress, validateFile, previewImport, stageImport, readStages, captureIdentity, MAX_BYTES } from './migration.js';
import { encryptApiKey } from './account.js';
import { canonical } from './migrationSchema.js';
import DiplomacyBoard from './games/diplomacy/DiplomacyBoard.js';
import { saveGame } from './games/diplomacy/diplomacyPersistence.js';
import { createDiplomaticState } from './games/diplomacy/agents/diplomaticState.js';
import { createMemory } from './games/diplomacy/agents/memory.js';
import { PERSONAS } from './games/diplomacy/agents/personas.js';
import { validChessLog } from '../server/chessLogValidation.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  globalThis.TextEncoder = TextEncoder; globalThis.TextDecoder = TextDecoder;
  Object.defineProperty(navigator, 'locks', { value: { request: async (_, fn) => fn() }, configurable: true });
});
beforeEach(() => localStorage.clear());
const origin = 'https://old.example.test';
const snapshot = (game, adapter, board) => ({ v: 1, game, id: `${game}-synthetic`, updatedAt: 3, state: adapter.encodeBoard(board), ui: {} });
const exportFile = async () => (await exportProgress(origin)).bundle;

test.each([
  ['chess', chess, () => { const b = new ChessBoard(); b.move('e2','e4'); return b; }],
  ['yinsh', yinsh, () => { const b = new YinshBoard(); b.handleClick(0,0); return b; }],
  ['zertz', zertz, () => { const b = new ZertzBoard(); b.selectMarbleColor('white'); b.placeMarble(0,0); return b; }],
  ['catan', catan, () => { const b = new CatanBoard({ seed:7 }); b.applyMove(b.getLegalMoves()[0]); return b; }],
])('%s real engine round-trip and latest unsynced local data', async (game, adapter, create) => {
  const value = snapshot(game, adapter, create());
  localStorage.setItem(`${game}Match:v1`, JSON.stringify(value));
  localStorage.setItem(`${game}MatchSync:v1`, JSON.stringify({ owner: 'do-not-export', revision: 1, baseline: null }));
  const bundle = await exportFile();
  expect(bundle.records[0].data).toEqual(JSON.parse(JSON.stringify(value)));
  expect(JSON.stringify(adapter.encodeBoard(adapter.decodeMatch(bundle.records[0].data).board))).toBe(JSON.stringify(value.state));
  expect(JSON.stringify(bundle)).not.toContain('do-not-export');
  expect(await validateFile(JSON.stringify(bundle))).toEqual(bundle);
});

test('legacy empty PGN converts, explicit clear does not revive it, damaged source is surfaced', async () => {
  localStorage.setItem('chessGameState', JSON.stringify({ v: 1, pgn: '' }));
  expect((await exportFile()).records[0].data.id).toBe('legacy-chess');
  localStorage.setItem('chessMatch:v1', 'null');
  const result = await exportProgress(origin);
  expect(result.bundle.records).toHaveLength(0);
  expect(result.issues).toHaveLength(1);
  localStorage.setItem('yinshMatch:v1', '{');
  expect((await exportProgress(origin)).issues).toHaveLength(2);
  expect(localStorage.getItem('yinshMatch:v1')).toBe('{');
});

test('inventory covers all supported record kinds and six-game preferences without reading secrets', async () => {
  const values = {
    chessDarkMode: 'true', yinshWins: '{"1":2,"2":3}', zertzDifficulty: 'easy',
    catanPlayerCount: '4', splendorPlayerCount: '3', diplomacyShowOrders: 'true',
    chessOppHistory: '{"v":1,"casual":{},"rated":{}}',
    chessPuzzleProgress: '{"rating":1000,"attempts":0,"puzzles":{}}',
    chessMistakes: '[]', chessRepertoire: '{"version":1,"white":[],"black":[]}', chessGameLog: '[]',
    gipfApiKey: 'synthetic-api-secret', chessLichessToken: 'synthetic-lichess-secret', unrelated: 'private',
  };
  Object.entries(values).forEach(([k,v]) => localStorage.setItem(k,v));
  const result = await exportProgress(origin);
  expect(result.issues).toEqual([]);
  expect(result.bundle.records).toHaveLength(11);
  expect(JSON.stringify(result.bundle)).not.toMatch(/secret|private|gipfApiKey|chessLichessToken/);
  localStorage.setItem('diplomacyGameState', '{"version":1}');
  expect((await exportProgress(origin)).issues[0]).toContain('diplomacyGameState');
});

test('whole-file validation rejects malicious, future, oversized, duplicate and modified input before staging', async () => {
  localStorage.setItem('chessDarkMode','true');
  const good = await exportFile();
  for (const mutate of [
    b => { b.version = 2; }, b => { b.token = 'secret'; },
    b => { b.sourceOrigin = 'https://name:secret@example.test'; },
    b => { b.records[0].data = 'false'; }, b => { b.records[0].schemaVersion = 2; },
    b => { b.records.push(b.records[0]); }, b => { b.records[0].kind = 'future'; },
    b => { b.records[0].data = JSON.parse('{"__proto__":{"polluted":true}}'); },
  ]) {
    const bad = JSON.parse(JSON.stringify(good)); mutate(bad);
    await expect(validateFile(JSON.stringify(bad))).rejects.toThrow();
  }
  await expect(validateFile(' '.repeat(MAX_BYTES + 1))).rejects.toThrow();
  await expect(validateFile('é'.repeat(MAX_BYTES / 2 + 1))).rejects.toThrow();
  const tooMany = {...good,records:Array(10001).fill(good.records[0])};
  await expect(validateFile(JSON.stringify(tooMany))).rejects.toThrow();
  expect(localStorage.length).toBe(1);
});

test('nested unknown match fields reject instead of being hidden by a permissive decoder', async () => {
  const value = snapshot('catan', catan, new CatanBoard());
  value.state.players[1].resources.future = 7;
  localStorage.setItem('catanMatch:v1', JSON.stringify(value));
  const result = await exportProgress(origin);
  expect(result.bundle.records).toHaveLength(0);
  expect(result.issues).toHaveLength(1);
});

test('conflict preview, explicit choice, replay and atomic quota failure leave active destination unchanged', async () => {
  localStorage.setItem('chessDarkMode','true');
  const bundle = await exportFile();
  localStorage.setItem('chessDarkMode','false');
  const preview = previewImport(bundle);
  expect(preview[0].status).toBe('different');
  await expect(stageImport(bundle, '')).rejects.toThrow();
  await stageImport(bundle, 'retain');
  await stageImport(bundle, 'retain');
  expect(await readStages()).toHaveLength(1);
  expect(localStorage.getItem('chessDarkMode')).toBe('false');
  const old = localStorage.getItem('gamesMigration:v1:guest');
  const another = await exportFile();
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await expect(stageImport(another, 'retain')).rejects.toThrow();
  spy.mockRestore();
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBe(old);
  expect(localStorage.getItem('chessDarkMode')).toBe('false');
});

test('captured identity and transition changes invalidate asynchronous import', async () => {
  const bundle = await exportFile();
  const guard = captureIdentity();
  localStorage.setItem('gipfAccount', '{"synthetic":"other"}');
  await expect(stageImport(bundle, 'retain', guard)).rejects.toThrow('account_changed');
  localStorage.clear();
  const guard2 = captureIdentity();
  localStorage.setItem('gipf:account-transition', JSON.stringify({ id:'synthetic', until: Date.now()+60000 }));
  await expect(stageImport(bundle, 'retain', guard2)).rejects.toThrow('account_changed');
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBeNull();
});

test('Diplomacy actual save round-trips board, negotiation and local order-entry progress', async () => {
  const board = new DiplomacyBoard();
  board.processOrders({}); // Real all-hold adjudication populates resolution/history.
  const powers = board.getPowerIds();
  saveGame({board,uiPhase:'orders',controllers:Object.fromEntries(powers.map(p => [p,p==='england'?'human':'AI'])),personas:PERSONAS,conversations:createMemory(powers),diplomaticState:createDiplomaticState({board,humanPower:'england'}),uiState:{pendingOrders:{},retreatChoices:{},buildOrders:{}}});
  const original = localStorage.getItem('diplomacyGameState');
  const {bundle,issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundle.records[0].kind).toBe('diplomacy-save');
  expect(bundle.records[0].data).toEqual(JSON.parse(original));
  expect(DiplomacyBoard.fromSerializedState(bundle.records[0].data.board).serializeState()).toEqual(board.serializeState());
  await stageImport(bundle,'retain');
  expect(localStorage.getItem('diplomacyGameState')).toBe(original);
  const damaged = JSON.parse(original);
  damaged.conversations.threads.england.password = 'synthetic';
  localStorage.setItem('diplomacyGameState',JSON.stringify(damaged));
  expect((await exportProgress(origin)).issues).toHaveLength(1);
});

const account = n => ({v:1,username:`Synthetic ${n}`,usernameId:String(n).repeat(64),authToken:String(n+1).repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:String(n+2).repeat(64)});
test('active and encrypted alternatives are progress-only, deduplicated, recoverable and scoped', async () => {
  const session = account(1);
  localStorage.setItem('gipfAccount',JSON.stringify(session));
  const current = snapshot('chess',chess,new ChessBoard());
  const alternative = {...current,updatedAt:9,ui:{rated:true}};
  localStorage.setItem('chessMatch:v1',JSON.stringify(current));
  localStorage.setItem('chessMatchRecovery:v1',JSON.stringify({v:1,alternatives:[current,alternative,{unreadable:'secret-never-copy'}]}));
  localStorage.setItem('chessStatsRecovery:v1','["[]"]');
  const sealed = await encryptApiKey(session.aesKey,JSON.stringify({
    'chessMatch:v1':JSON.stringify(alternative),chessGameLog:'[]',
    gipfApiKey:'synthetic-never-export',chessLichessToken:'synthetic-never-export',
  }));
  localStorage.setItem(`gipf:recovery:${session.usernameId}`,JSON.stringify(sealed));
  localStorage.setItem(`gipf:recovery:${account(5).usernameId}`,'not this account');
  const {bundle,issues} = await exportProgress(origin);
  expect(bundle.records).toHaveLength(3);
  expect(issues).toHaveLength(1);
  expect(JSON.stringify(bundle)).not.toMatch(/secret-never-copy|synthetic-never-export|authToken|aesKey|usernameId|"ct"|"iv"/);
  expect(bundle.records.find(r => r.data.updatedAt === 9).id).toMatch(/^chess-synthetic:[a-f0-9]{64}$/);
  await stageImport(bundle,'retain');
  expect(localStorage.getItem(`gamesMigration:v1:${session.usernameId}`)).not.toContain('ramia-migration');
  expect(await readStages()).toEqual([bundle]);
  localStorage.setItem('gipfAccount',JSON.stringify(account(5)));
  expect(await readStages()).toEqual([]);
  localStorage.removeItem('gipfAccount');
  expect(await readStages()).toEqual([]);
});

test('excluded encrypted legacy/preferences content makes export explicitly incomplete', async () => {
  const session = account(1);
  localStorage.setItem('gipfAccount',JSON.stringify(session));
  const sealed = await encryptApiKey(session.aesKey,JSON.stringify({chessGameState:'{"v":1,"pgn":""}',chessDarkMode:'true',gipfApiKey:'do-not-copy'}));
  localStorage.setItem(`gipf:recovery:${session.usernameId}`,JSON.stringify(sealed));
  const {bundle,issues} = await exportProgress(origin);
  expect(bundle.records).toEqual([]);
  expect(issues).toHaveLength(2);
  expect(issues.join(' ')).toMatch(/chessGameState/);
  expect(issues.join(' ')).not.toMatch(/do-not-copy|gipfApiKey/);
});

test.each(['export','stage'])('account switch DURING asynchronous %s cryptography cannot finish under the next identity', async operation => {
  const session = account(1);
  localStorage.setItem('gipfAccount',JSON.stringify(session));
  const sealed = await encryptApiKey(session.aesKey,'{}');
  localStorage.setItem(`gipf:recovery:${session.usernameId}`,JSON.stringify(sealed));
  const bundle = await exportFile();
  const method = operation === 'export' ? 'decrypt' : 'encrypt';
  const real = webcrypto.subtle[method].bind(webcrypto.subtle);
  let reached, release;
  const started = new Promise(r => { reached = r; });
  const pause = new Promise(r => { release = r; });
  const spy = jest.spyOn(webcrypto.subtle,method).mockImplementation(async (...args) => {reached();await pause;return real(...args);});
  const pending = operation === 'export' ? exportProgress(origin) : stageImport(bundle,'retain');
  await started;
  localStorage.setItem('gipfAccount',JSON.stringify(account(5)));
  release();
  await expect(pending).rejects.toThrow('account_changed');
  spy.mockRestore();
  expect(localStorage.getItem(`gamesMigration:v1:${session.usernameId}`)).toBeNull();
  expect(localStorage.getItem(`gipf:recovery:${session.usernameId}`)).toBe(JSON.stringify(sealed));
});

test('different revisions sharing an export ID reject, keep performs no writes, and corrupt stage is preserved', async () => {
  localStorage.setItem('chessDarkMode','true');
  const first = await exportFile();
  await stageImport(first,'keep');
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBeNull();
  await stageImport(first,'retain');
  const old = localStorage.getItem('gamesMigration:v1:guest');
  localStorage.setItem('chessDarkMode','false');
  const changed = await exportFile(); changed.exportId = first.exportId;
  await expect(stageImport(changed,'retain')).rejects.toThrow('export_id_collision');
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBe(old);
  localStorage.setItem('gamesMigration:v1:guest','{damaged');
  await expect(stageImport(changed,'retain')).rejects.toThrow();
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBe('{damaged');
});

test('populated statistics and trainer stores preserve existing formats without sanitizing away values', async () => {
  const log = [{playedAt:1,result:'win',color:'w',rated:false,opponentKey:'casual',accuracy:90,counts:{best:3,blunder:0,mistake:1,inaccuracy:2},opening:null,eco:null,leftBookAtPly:null,moves:20}];
  expect(validChessLog(JSON.stringify(log))).toBe(true);
  const mistakes = [{id:'m-synthetic',fenBefore:new ChessBoard().positions[0],movePlayed:'e4',bestSan:'d4',bestPv:['d4','d5'],cpLoss:80,classification:'mistake',opening:null,moveNo:1,createdAt:1,attempts:0,streak:0,nextDueAt:1}];
  const puzzles = {rating:1200,attempts:1,puzzles:{synthetic:{attempts:1,solves:1,streak:1,nextDueAt:123,lastResult:'solved'}}};
  localStorage.setItem('chessGameLog',JSON.stringify(log));
  localStorage.setItem('chessMistakes',JSON.stringify(mistakes));
  localStorage.setItem('chessPuzzleProgress',JSON.stringify(puzzles));
  const {bundle,issues} = await exportProgress(origin);
  expect(issues).toEqual([]);
  expect(bundle.records.find(r => r.kind === 'chess-log').data).toEqual(log);
  expect(bundle.records.find(r => r.kind === 'chess-mistakes').data).toEqual(mistakes);
  expect(bundle.records.find(r => r.kind === 'chess-puzzles').data).toEqual(puzzles);
  log[0].counts.future = 1;
  localStorage.setItem('chessGameLog',JSON.stringify(log));
  expect((await exportProgress(origin)).issues).toHaveLength(1);
});

test('transition appearing during encryption and encryption failure leave account stage unchanged', async () => {
  const session = account(1);
  localStorage.setItem('gipfAccount',JSON.stringify(session));
  const bundle = await exportFile();
  await stageImport(bundle,'retain');
  const key = `gamesMigration:v1:${session.usernameId}`, original = localStorage.getItem(key);
  const next = await exportFile();
  const spy = jest.spyOn(webcrypto.subtle,'encrypt').mockRejectedValue(new Error('crypto_unavailable'));
  await expect(stageImport(next,'retain')).rejects.toThrow('crypto_unavailable');
  spy.mockRestore();
  expect(localStorage.getItem(key)).toBe(original);
  const real = webcrypto.subtle.encrypt.bind(webcrypto.subtle);
  const transition = jest.spyOn(webcrypto.subtle,'encrypt').mockImplementation(async (...args) => {
    const result = await real(...args);
    localStorage.setItem('gipf:account-transition',JSON.stringify({id:'synthetic-new-transition',until:Date.now()+60000}));
    return result;
  });
  await expect(stageImport(next,'retain')).rejects.toThrow('account_changed');
  transition.mockRestore();
  expect(localStorage.getItem(key)).toBe(original);
});

test.each(['chess','yinsh','zertz','catan'])('%s malformed nested payload with a correct digest rejects before mutation', async game => {
  const adapters = {chess,yinsh,zertz,catan};
  const boards = {chess:new ChessBoard(),yinsh:new YinshBoard(),zertz:new ZertzBoard(),catan:new CatanBoard()};
  localStorage.setItem(`${game}Match:v1`,JSON.stringify(snapshot(game,adapters[game],boards[game])));
  const bundle = await exportFile();
  bundle.records[0].data.ui.future = {password:'synthetic'};
  bundle.records[0].revision = Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(bundle.records[0].data)))).toString('hex');
  await expect(stageImport(bundle,'retain')).rejects.toThrow();
  expect(localStorage.getItem('gamesMigration:v1:guest')).toBeNull();
});
