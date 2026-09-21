// Run against tests/serve-public-security.mjs. Output contains no credentials.
import assert from 'node:assert/strict';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
const base='http://127.0.0.1:3187/gipf/api/';
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
await call('testAI',{},200);
await call('zertzAiMove',{boardState:new ZertzBoard().serializeState(),simulations:50},200);
await call('zertzAiMove',{boardState:{}},500);
console.log('PASS: real HTTP handlers, synthetic Redis/provider boundary, valid and error paths');
