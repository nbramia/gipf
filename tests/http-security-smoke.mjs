// Run against tests/serve-public-security.mjs. Output contains no credentials.
import assert from 'node:assert/strict';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
const base=`http://127.0.0.1:${process.env.GIPF_TEST_PORT || 3187}/api/`;
import { hash } from '../server/publicSecurity.js';
import { redis } from './redis-fixture.mjs';
import { seedSession, identityFor } from './session-fixture.mjs';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
const origin=new URL(base).origin;
const same={'Content-Type':'application/json','X-Games-Request':'1',Origin:origin,'Sec-Fetch-Site':'same-origin'};
// Two signed-in identities, each with its own data.
const owner=`__Host-games_session=${await seedSession('smoke-owner')}`;
const fresh=`__Host-games_session=${await seedSession('smoke-fresh')}`;
async function call(name,body,status,cookie) {
  const response=await fetch(base+name,{method:'POST',headers:cookie?{...same,Cookie:cookie}:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status,status,`${name}: ${JSON.stringify(data)}`);
  assert.equal(response.headers.get('cache-control'),'no-store');
  console.log(`${name}: ${response.status} ${data.error || (data.success ? 'move returned' : 'ok')}`);
  return data;
}
// Password and link actions are unsupported: chessAccount treats them as unknown actions.
for(const action of ['create','login','setKey','link-verify','link']) await call('chessAccount',{action},400,fresh);
await call('chessAccount',{action:'setKeys',lichess:null},401);
await call('chessProfile',{action:'read'},401);
await call('chessProfile',{action:'read'},200,owner);
// Another account's data id in the body is refused, never read.
await call('chessProfile',{action:'read',u:identityFor('smoke-fresh')},401,owner);
const removed=await fetch(base+'chessRating',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(removed.status,404);
for(const name of ['chessCoach','catanRules','splendorRules','diplomacyAgent']) {
  await call(name,{},401);
  await call(name,{apiKey:'synthetic-provider-key',fen:'synthetic-fen',messages:[{role:'user',content:'synthetic question'}]},401);
}
await call('chessCoach',{apiKey:'synthetic-provider-key',mode:'thread',context:{},messages:[{role:'user',content:'synthetic question'}]},401);
await call('zertzAiMove',{boardState:new ZertzBoard().serializeState(),simulations:50},200);
await call('zertzAiMove',{boardState:{}},500);
await call('aiMove',new YinshBoard().serializeState(),200);
await call('aiMove',{boardState:'synthetic-private-value'},400);
console.log('PASS: real HTTP handlers, synthetic Redis/provider boundary, valid and error paths');

// Saving keys: the account-user budget bounds one identity across networks.
const freshBudget=`gipf:limit:account-user:${hash(identityFor('smoke-fresh'))}`;
redis('DEL',`gipf:limit:account:${hash('127.0.0.1')}`,freshBudget);
for(let i=0;i<20;i++) await call('chessAccount',{action:'setKeys',lichess:null},200,fresh);
// A fresh network does not reset it.
redis('DEL',`gipf:limit:account:${hash('127.0.0.1')}`);
await call('chessAccount',{action:'setKeys',lichess:null},429,fresh);
assert.equal(redis('GET',freshBudget),'21');
redis('DEL',`gipf:limit:account:${hash('127.0.0.1')}`,freshBudget);
console.log('PASS: setKeys with the session cookie, then the per-identity budget');

// The session cookie is the only credential: CSRF refusals, then logout revocation.
redis('DEL',`gipf:limit:account:${hash('127.0.0.1')}`,`gipf:limit:sync:${hash('127.0.0.1')}`);
const post=(name,body,headers=same,cookie)=>fetch(base+name,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
assert.equal((await post('chessProfile',{action:'read'},same,owner)).status,200);
assert.equal((await post('session',{action:'establish'},same,owner)).status,200);
assert.equal((await post('chessProfile',{action:'read'},{'Content-Type':'application/json',Origin:origin},owner)).status,403);
assert.equal((await post('chessProfile',{action:'read'},{...same,Origin:'https://evil.example'},owner)).status,403);
assert.equal((await post('chessProfile',JSON.stringify({action:'read'}),{...same,'Content-Type':'text/plain'},owner)).status,415);
assert.equal((await fetch(base+'session',{headers:{Cookie:owner}})).status,200);
const ended=await post('auth/logout',{},same,owner);
assert.equal(ended.status,200);
assert.match(ended.headers.get('set-cookie'),/^__Host-games_session=; .*Max-Age=0$/);
assert.equal((await post('chessProfile',{action:'read'},same,owner)).status,401);
assert.equal((await fetch(base+'session',{headers:{Cookie:owner}})).status,401);
console.log('PASS: cookie-authenticated reads, CSRF refusals, logout revocation');
