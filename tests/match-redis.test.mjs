// Real Redis Lua/CAS contract tests. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import rating from '../api/chessRating.js';
import { hash } from '../server/publicSecurity.js';
const redis = (...args) => JSON.parse(execFileSync('docker', ['exec', 'gipf-pr5-synthetic-redis', 'redis-cli', '--json', ...args.map(String)], {encoding:'utf8'}));
const u='a'.repeat(64), auth='b'.repeat(64), other='c'.repeat(64), legacy='d'.repeat(64);
const enc={iv:'AAAAAAAAAAAAAAAA',ct:'AAAAAAAAAAAAAAAAAAAAAA=='};
const response = () => ({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
async function call(handler, body, method='POST') {
  const res=response(); await handler({method,headers:{},socket:{remoteAddress:'192.0.2.1'},body},res);return res;
}
beforeEach(()=>{
  redis('FLUSHDB');
  process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
  process.env.GIPF_LEGACY_CLAIM_FROM = new Date(Date.now()-1000).toISOString();
  process.env.GIPF_LEGACY_CLAIM_UNTIL = new Date(Date.now()+86400000).toISOString();
  globalThis.fetch=async (_url,options)=>({ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})});
  redis('SET',`chess:account:${u}`,JSON.stringify({authHash:hash(auth),enc,encLichess:enc}));
  redis('SET',`chess:account:${other}`,JSON.stringify({authHash:hash('e'.repeat(64))}));
});
// PR5: match records have their own account/game CAS, leaving legacy profile intact.
test('four match scopes authenticate and isolate concurrent devices without changing legacy domains', async () => {
  const { default: YinshBoard } = await import('../src/games/yinsh/YinshBoard.js');
  const { default: ZertzBoard } = await import('../src/games/zertz/ZertzBoard.js');
  const { default: CatanBoard } = await import('../src/games/catan/CatanBoard.js');
  const { default: ChessBoard } = await import('../src/games/chess/ChessBoard.js');
  const boards = { chess: new ChessBoard(), yinsh: new YinshBoard(), zertz: new ZertzBoard(), catan: new CatanBoard({ seed: 1234 }) };
  const old = { rating: { rating: 1400, ratedGames: 4 } };
  await call(profile, { action: 'write', u, auth, revision: 0, domains: old });
  for (const [game, board] of Object.entries(boards)) {
    const { encodeBoard } = await import(`../src/games/${game}/matchSnapshot.js`);
    const match = { v: 1, game, id: 'synthetic-match', updatedAt: 1, state: encodeBoard(board), ui: {} };
    const request = { scope: 'match', game, u, auth, action: 'write', revision: 0, domains: { match } };
    assert.equal((await call(profile, { ...request, u: other })).statusCode, 401);
    const writes = await Promise.all([call(profile, request), call(profile, request)]);
    assert.deepEqual(writes.map(r => r.statusCode).sort(), [200, 409]);
    const read = await call(profile, { scope: 'match', game, u, auth, action: 'read' });
    assert.equal(read.body.revision, 1);
    assert.deepEqual(read.body.profile.match, JSON.parse(JSON.stringify(match)));
    assert.equal((await call(profile, { ...request, revision: 1, domains: { match: { ...match, game: 'invalid' } } })).statusCode, 400);
    assert.equal((await call(profile, { ...request, revision: 1, domains: { match: { ...match, v: 99 } } })).statusCode, 400);
    assert.equal((await call(profile, { ...request, revision: 1, domains: { match: { ...match, ui: { authToken: 'forbidden' } } } })).statusCode, 400);
    const b = await call(profile, { scope: 'match', game, u: other, auth: 'e'.repeat(64), action: 'read' });
    assert.deepEqual(b.body.profile, {});
  }
  assert.deepEqual((await call(profile, { u, auth, action: 'read' })).body.profile, old);
});

test('bounded Chess statistics strings survive Redis arrays and stale device writes', async () => {
  const request = {u,auth,scope:'settings',action:'write',revision:0};
  const empty = await call(profile,{...request,domains:{preferences:{chessGameLog:'[]'}}});
  assert.equal(empty.statusCode,200);
  assert.equal((await call(profile,{u,auth,scope:'settings',action:'read'})).body.profile.preferences.chessGameLog,'[]');
  const log=JSON.stringify([{playedAt:1,result:'win',color:'w',rated:false,opponentKey:'synthetic',accuracy:90,counts:{best:5,excellent:3,good:2,blunder:0,mistake:1,inaccuracy:2},opening:null,eco:null,leftBookAtPly:null,moves:20}]);
  assert.equal((await call(profile,{...request,revision:1,domains:{preferences:{chessGameLog:log}}})).statusCode,200);
  assert.equal((await call(profile,{...request,revision:1,domains:{preferences:{chessGameLog:'[]'}}})).statusCode,409);
  assert.equal((await call(profile,{u,auth,scope:'settings',action:'read'})).body.profile.preferences.chessGameLog,log);
  assert.equal((await call(profile,{...request,revision:2,domains:{preferences:{chessGameLog:'[{"authToken":"secret"}]'}}})).statusCode,400);
  assert.deepEqual((await call(profile,{u:other,auth:'e'.repeat(64),scope:'settings',action:'read'})).body.profile,{});
});
