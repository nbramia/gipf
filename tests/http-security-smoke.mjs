// Run against tests/serve-public-security.mjs. Output contains no credentials.
import assert from 'node:assert/strict';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
const base=`http://127.0.0.1:${process.env.GIPF_TEST_PORT || 3187}/gipf/api/`;
import { hash } from '../server/publicSecurity.js';
import { redis } from './redis-fixture.mjs';
import { seedSession, identityFor } from './session-fixture.mjs';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
const u='6'.repeat(64),auth='7'.repeat(64);
const origin=new URL(base).origin;
const same={'Content-Type':'application/json','X-Games-Request':'1',Origin:origin,'Sec-Fetch-Site':'same-origin'};
// A pre-Auth0 account, an identity already linked to it, and a new identity that is not.
redis('SET',`chess:account:${u}`,JSON.stringify({authHash:hash(auth),enc:null,encLichess:null}));
const owner=`__Host-games_session=${await seedSession('smoke-owner',u)}`;
const fresh=`__Host-games_session=${await seedSession('smoke-fresh')}`;
async function call(name,body,status,cookie) {
  const response=await fetch(base+name,{method:'POST',headers:cookie?{...same,Cookie:cookie}:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status,status,`${name}: ${JSON.stringify(data)}`);
  assert.equal(response.headers.get('cache-control'),'no-store');
  console.log(`${name}: ${response.status} ${data.error || (data.success ? 'move returned' : 'ok')}`);
  return data;
}
for(const action of ['create','login','setKey']) await call('chessAccount',{action,u,auth,enc:null},410);
await call('chessProfile',{action:'read',u,auth},401);
await call('chessProfile',{action:'read'},200,owner);
await call('chessProfile',{action:'read',id:u},401);
await call('chessRating',{id:u},410);
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

// Only the fixture network counter is reset to model a fresh network; owner counters stay intact.
const network=`gipf:limit:account:${hash('127.0.0.1')}`, failures=`gipf:limit:auth-fail:${hash('127.0.0.1')}`, freshBudget=`gipf:limit:account-user:${hash(identityFor('smoke-fresh'))}`;
redis('DEL',network,failures);
for(let i=0;i<20;i++) await call('chessAccount',{action:'link-verify',u,auth:'8'.repeat(64)},401,fresh);
await call('chessAccount',{action:'link-verify',u,auth:'8'.repeat(64)},429,fresh);
redis('DEL',network,freshBudget);
// The shared failed-authentication budget still refuses the right password from this network.
await call('chessAccount',{action:'link-verify',u,auth},429,fresh);
redis('DEL',failures);
await call('chessAccount',{action:'link-verify',u,auth},200,fresh);
await call('chessAccount',{action:'setKeys',lichess:null},200,fresh);
const emptyIds=Array.from({length:8},(_,i)=>(i+80).toString(16).padStart(64,'0'));
for(const legacyId of emptyIds) assert.equal((await call('chessProfile',{action:'claim',legacyId},200,owner)).claimed,false);
const legacyId=emptyIds[0];
redis('SET',`chess:rating:${legacyId}`,JSON.stringify({rating:1550,ratedGames:4}));
for(let i=0;i<8;i++) await call('chessProfile',{action:'claim',legacyId},200,owner);
const later=emptyIds[1];redis('SET',`chess:rating:${later}`,JSON.stringify({rating:1650,ratedGames:5}));
await call('chessProfile',{action:'claim',legacyId:later},200,owner);
assert.equal(redis('GET',`gipf:limit:claim-user:${hash(u)}`),'2');
console.log('PASS: HTTP bad-token link flood then correct verify/setKeys; empty/repeated claims then real migration');

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
