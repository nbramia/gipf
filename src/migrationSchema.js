// Closed progress schemas. No storage, network, coercion, truncation or repair.
import ChessBoard from './games/chess/ChessBoard.js';
import { CATAN_RULESETS } from './games/catan/catanRulesets.js';

export const fail = () => { throw new Error('invalid_migration'); };
export const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export const text = (max = 2000) => v => typeof v === 'string' && v.length <= max;
export const number = (min = 0, max = 4102444800000) => v => Number.isFinite(v) && v >= min && v <= max;
export const integer = (min = 0, max = 4102444800000) => v => Number.isSafeInteger(v) && v >= min && v <= max;
export const one = (...values) => v => values.includes(v);
export const nullable = test => v => v === null || test(v);
export const array = (test, max = 2000) => v => Array.isArray(v) && v.length <= max && v.every(test);
export const shape = (required, optional = {}) => v => obj(v) &&
  Object.keys(required).every(k => Object.hasOwn(v, k)) && Object.entries(v).every(([k,x]) => {
    const test = Object.hasOwn(required, k) ? required[k] : Object.hasOwn(optional, k) ? optional[k] : null;
    return test && test(x);
  });
export const map = (test, key = /^[a-zA-Z0-9_-]{1,64}$/, max = 500) => v => obj(v) && Object.keys(v).length <= max && Object.entries(v).every(([k,x]) => key.test(k) && test(x));
export const bool = v => typeof v === 'boolean';
export const count = integer(0, 1000000);
export const timestamp = integer();
export const safeTree = (v, depth = 0) => {
  if (depth > 24) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (!Array.isArray(v) && !obj(v)) return false;
  return Object.entries(v).every(([k,x]) => !/^(?:__proto__|prototype|constructor|authToken|aesKey|profileId|usernameId|apiKey|password|token|secret|credentials|enc|encLichess|lichessToken|gipfAccount)$/i.test(k) && safeTree(x, depth + 1));
};
export const canonical = v => JSON.stringify(v, (_, x) => obj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,x[k]])) : x);
export const bytes = v => new TextEncoder().encode(v).length;

const fen = v => {
  if (!text(120)(v)) return false;
  try { new ChessBoard(v); return true; } catch (_) { return false; }
};
export const mistake = shape({
  id: text(80), fenBefore: fen, movePlayed: text(32), bestSan: text(32),
  // Local captures use an array; historical profile sanitization used a string.
  bestPv: v => text(2000)(v) || array(text(32), 200)(v), cpLoss: number(0, 1000000),
  classification: one('inaccuracy','mistake','blunder'), opening: nullable(text(256)),
  moveNo: count, createdAt: timestamp, attempts: count, streak: count, nextDueAt: timestamp,
});
const logEntry = shape({
  playedAt: timestamp, result: one('win','loss','draw'), color: one('w','b'), rated: bool,
  opponentKey: text(80), accuracy: nullable(number(0,100)),
  counts: shape({ blunder: integer(0,100000), mistake: integer(0,100000), inaccuracy: integer(0,100000) },
    { best: integer(0,100000), excellent: integer(0,100000), good: integer(0,100000) }),
  opening: nullable(text(256)), eco: nullable(text(16)), leftBookAtPly: nullable(integer(0,100000)), moves: integer(0,100000),
});
export const validLog = v => array(logEntry,200)(v) && bytes(JSON.stringify(v)) <= 100000;
export const powers = ['austria','england','france','germany','italy','russia','turkey'];
const json = test => raw => { try { return test(JSON.parse(raw)); } catch (_) { return false; } };
const preference = {};
for (const [game, names] of Object.entries({
  chess: ['DarkMode','ShowMoves','ShowEvalBar','Sound','Rated','IntroSeen','KeyNudgeDismissed','PuzzleShowTheme'],
  yinsh: ['DarkMode','ShowMoves','RandomSetup','KeepScore','TwoPlayer','ShowMoveHistory'],
  zertz: ['DarkMode','ShowMoves','TwoPlayer'], catan: ['DarkMode','ShowMoves'],
  splendor: ['DarkMode'], diplomacy: ['DarkMode','ShowOrders','ShowLastMoves'],
})) for (const name of names) preference[game + name] = one('true','false');
Object.assign(preference, {
  chessDifficulty: one('beginner','casual','intermediate','advanced','master'),
  chessTimeControl: one('off','3+2','5+0','10+0','15+10'), chessLearningGoal: text(),
  chessRating: json(integer(100,4000)), chessRatedGames: json(count),
  yinshDifficulty: one('easy','advanced','expert'), zertzDifficulty: one('easy','advanced','expert'),
  catanDifficulty: one('strong','expert','brutal'), splendorDifficulty: one('strong','expert','brutal'),
  yinshEvaluationMode: one('heuristic','nn'), yinshWins: json(shape({ 1: count, 2: count })),
  catanRulesetId: one(...CATAN_RULESETS.map(v => v.id)), catanScenarioId: one(...CATAN_RULESETS.flatMap(v => v.scenarios.map(s => s.id))),
  catanPlayerCount: one('3','4','5','6'), splendorPlayerCount: one('2','3','4'),
  diplomacySettings: json(shape({ power: one(...powers), difficulty: one('easy','normal','hard'), personaSpice: number(0,1), maxYears: integer(1901,2000) })),
});
export const PREFERENCE_KEYS = Object.keys(preference);
export const DATA_KEYS = {
  'chess-history': 'chessOppHistory', 'chess-puzzles': 'chessPuzzleProgress',
  'chess-mistakes': 'chessMistakes', 'chess-repertoire': 'chessRepertoire', 'chess-log': 'chessGameLog',
  'diplomacy-save': 'diplomacyGameState',
};
const schemas = {
  'chess-history': shape({ v: one(1), casual: map(shape({w:count,l:count,d:count}), /^[a-zA-Z0-9_-]{1,32}$/,32), rated: map(shape({w:count,l:count,d:count}), /^[a-zA-Z0-9_-]{1,32}$/,32) }),
  'chess-puzzles': shape({ rating: integer(100,4000), attempts: count, puzzles: map(shape({ attempts: count, solves: count, streak: count, nextDueAt: timestamp, lastResult: one('solved','failed') })) }),
  'chess-mistakes': array(mistake,200),
  'chess-repertoire': shape({version:one(1),white:array(text(256),200),black:array(text(256),200)}),
  'chess-log': validLog,
};
export function validateData(kind, id, data) {
  if (!safeTree(data)) fail();
  if (kind === 'preference') {
    if (!Object.hasOwn(preference,id) || typeof data !== 'string' || !preference[id](data)) fail();
  } else if (Object.hasOwn(schemas,kind)) {
    if (!(id === DATA_KEYS[kind] || (kind === 'chess-log' && /^chessGameLog:[a-f0-9]{64}$/.test(id))) || !schemas[kind](data)) fail();
  } else if (kind === 'diplomacy-save') {
    if (id !== 'diplomacyGameState') fail(); // Caller runs closed Diplomacy schema.
  } else if (/^(chess|yinsh|zertz|catan)-match$/.test(kind)) {
    // The caller additionally runs the closed snapshot schema and real decoder.
    if (id !== data.id && !new RegExp(`^${data.id}:[a-f0-9]{64}$`).test(id)) fail();
  } else fail();
}
export function destinationKey(record) {
  if (record.kind === 'preference') return record.id;
  if (DATA_KEYS[record.kind]) return DATA_KEYS[record.kind];
  return `${record.kind.slice(0,-6)}Match:v1`;
}
