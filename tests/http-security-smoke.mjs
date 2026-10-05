// Run against tests/serve-public-security.mjs. Output contains no credentials.
import assert from 'node:assert/strict';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
const base=`http://127.0.0.1:${process.env.GIPF_TEST_PORT || 3187}/gipf/api/`;
import { hash } from '../server/publicSecurity.js';
import { redis } from './redis-fixture.mjs';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
const u='6'.repeat(64),auth='7'.repeat(64);
async function call(name,body,status) {
  const response=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  assert.equal(response.status,status,`${name}: ${JSON.stringify(data)}`);
  assert.equal(response.headers.get('cache-control'),'no-store');
  console.log(`${name}: ${response.status} ${data.error || (data.success ? 'move returned' : 'ok')}`);
  return data;
}
const created=await fetch(base+'chessAccount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',u,auth,enc:null})});
assert.ok([200,409].includes(created.status));
await call('chessAccount',{action:'login',u,auth},200);
await call('chessAccount',{action:'login',u,auth:'8'.repeat(64)},401);
await call('chessProfile',{action:'read',u,auth},200);
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
const network=`gipf:limit:account:${hash('127.0.0.1')}`, failures=`gipf:limit:auth-fail:${hash('127.0.0.1')}`;
redis('DEL',network,failures);
for(let i=0;i<20;i++) await call('chessAccount',{action:'login',u,auth:'8'.repeat(64)},401);
await call('chessAccount',{action:'login',u,auth:'8'.repeat(64)},429);
redis('DEL',network);
// The shared failed-authentication budget still refuses the right password from this network.
await call('chessAccount',{action:'login',u,auth},429);
await call('chessProfile',{action:'read',u,auth},429);
redis('DEL',failures);
await call('chessAccount',{action:'login',u,auth},200);
await call('chessAccount',{action:'setKey',u,auth,enc:null},200);
const emptyIds=Array.from({length:8},(_,i)=>(i+80).toString(16).padStart(64,'0'));
for(const legacyId of emptyIds) assert.equal((await call('chessProfile',{action:'claim',u,auth,legacyId},200)).claimed,false);
const legacyId=emptyIds[0];
redis('SET',`chess:rating:${legacyId}`,JSON.stringify({rating:1550,ratedGames:4}));
for(let i=0;i<8;i++) await call('chessProfile',{action:'claim',u,auth,legacyId},200);
const later=emptyIds[1];redis('SET',`chess:rating:${later}`,JSON.stringify({rating:1650,ratedGames:5}));
await call('chessProfile',{action:'claim',u,auth,legacyId:later},200);
assert.equal(redis('GET',`gipf:limit:claim-user:${hash(u)}`),'2');
console.log('PASS: HTTP bad-auth flood then correct login/setKey; empty/repeated claims then real migration');

// Session cookie: created once from the derived token, then the only credential sent.
redis('DEL',`gipf:limit:account:${hash('127.0.0.1')}`,`gipf:limit:sync:${hash('127.0.0.1')}`);
const origin=new URL(base).origin;
const same={'Content-Type':'application/json','X-Games-Request':'1',Origin:origin,'Sec-Fetch-Site':'same-origin'};
const post=(name,body,headers=same,cookie)=>fetch(base+name,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
const started=await post('session',{action:'create',u,auth});
assert.equal(started.status,200);
const setCookie=started.headers.get('set-cookie');
assert.match(setCookie,/^__Host-games_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000$/);
const cookie=setCookie.split(';')[0];
assert.equal((await post('chessProfile',{action:'read'},same,cookie)).status,200);
assert.equal((await post('chessAccount',{action:'login'},same,cookie)).status,200);
assert.equal((await post('chessProfile',{action:'read'},{'Content-Type':'application/json',Origin:origin},cookie)).status,403);
assert.equal((await post('chessProfile',{action:'read'},{...same,Origin:'https://evil.example'},cookie)).status,403);
assert.equal((await post('chessProfile',JSON.stringify({action:'read'}),{...same,'Content-Type':'text/plain'},cookie)).status,415);
assert.equal((await fetch(base+'session',{headers:{Cookie:cookie}})).status,200);
const ended=await post('session',{action:'logout'},same,cookie);
assert.equal(ended.status,200);
assert.match(ended.headers.get('set-cookie'),/^__Host-games_session=; .*Max-Age=0$/);
assert.equal((await post('chessProfile',{action:'read'},same,cookie)).status,401);
assert.equal((await fetch(base+'session',{headers:{Cookie:cookie}})).status,401);
console.log('PASS: session cookie flags, cookie-authenticated reads, CSRF refusals, logout revocation');

