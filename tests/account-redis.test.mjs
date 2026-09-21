// Real Redis Lua/CAS contract tests. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import rating from '../api/chessRating.js';
import { hash } from '../server/publicSecurity.js';
const redis = (...args) => JSON.parse(execFileSync('docker', ['exec', 'gipf-pr4-synthetic-redis', 'redis-cli', '--json', ...args.map(String)], {encoding:'utf8'}));
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
test('existing encrypted credential envelopes login unchanged; wrong auth cannot mutate',async()=>{
  const login=await call(account,{action:'login',u,auth});assert.deepEqual(login.body.enc,enc);assert.deepEqual(login.body.encLichess,enc);
  const bad=await call(account,{action:'setKey',u,auth:'f'.repeat(64),enc:null});assert.equal(bad.statusCode,401);
  assert.deepEqual((await call(account,{action:'login',u,auth})).body.enc,enc);
  assert.equal((await call(account,{action:'setKey',u,auth,enc:null})).statusCode,200);
  const after=await call(account,{action:'login',u,auth});assert.equal(after.body.enc,null);assert.deepEqual(after.body.encLichess,enc);
});
test('competing registrations have one winner and do not overwrite',async()=>{
  const id='1'.repeat(64);
  const outcomes=await Promise.all([call(account,{action:'create',u:id,auth,enc}),call(account,{action:'create',u:id,auth:'2'.repeat(64),enc:null})]);
  assert.deepEqual(outcomes.map(x=>x.statusCode).sort(),[200,409]);
  assert.equal(JSON.parse(redis('GET',`chess:account:${id}`)).authHash,hash(auth));
});
test('A cannot authorize B by swapping public ID; arbitrary id field is not authorization',async()=>{
  assert.equal((await call(profile,{action:'read',u:other,auth})).statusCode,401);
  assert.equal((await call(profile,{action:'read',id:other})).statusCode,401);
  assert.equal((await call(profile,{action:'write',u,auth,id:other,revision:0,domains:{rating:{rating:1400,ratedGames:2}}})).statusCode,200);
  assert.equal(redis('GET',`gipf:profile:v2:${other}`),null);
  assert.equal((await call(profile,{},'GET')).statusCode,405);
  assert.equal((await call(rating,{id:legacy},'GET')).statusCode,410);
});
test('legacy claim is atomic, preserves old records and forbids transfer or overwrite',async()=>{
  redis('SET',`chess:rating:${legacy}`,JSON.stringify({rating:1500,ratedGames:3}));
  redis('SET',`chess:profile:${legacy}:history`,JSON.stringify({v:1,casual:{easy:{w:1,l:0,d:0}},rated:{}}));
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:legacy})).statusCode,200);
  const read=await call(profile,{action:'read',u,auth});assert.equal(read.body.profile.rating.rating,1500);assert.equal(read.body.profile.history.casual.easy.w,1);
  assert.equal((await call(profile,{action:'claim',u:other,auth:'e'.repeat(64),legacyId:legacy})).statusCode,409);
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:legacy})).statusCode,200);
  assert.equal((await call(profile,{action:'read',u,auth})).body.revision,read.body.revision);
  assert.ok(redis('GET',`chess:rating:${legacy}`));
  process.env.GIPF_LEGACY_CLAIM_UNTIL='2000-01-01';
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:legacy})).statusCode,410);
});
test('stale revision conflicts without changing cloud data and settings revision is independent',async()=>{
  const write={action:'write',u,auth,revision:0,domains:{rating:{rating:1500,ratedGames:5}}};
  assert.equal((await call(profile,write)).body.revision,1);
  assert.equal((await call(profile,{...write,domains:{rating:{rating:1000,ratedGames:1}}})).statusCode,409);
  assert.equal((await call(profile,{action:'read',u,auth})).body.profile.rating.rating,1500);
  assert.equal((await call(profile,{...write,scope:'settings',domains:{preferences:{yinshWins:'{"1":2,"2":1}'}}})).body.revision,1);
  assert.equal((await call(profile,{...write,scope:'settings',revision:1,domains:{preferences:{gipfApiKey:'synthetic'}}})).statusCode,400);
});
test('two handler instances share login limits and bounded payloads',async()=>{
  const second=(await import('../api/chessAccount.js?second')).default;
  for(let i=0;i<20;i++) assert.equal((await call(i%2?second:account,{action:'login',u,auth})).statusCode,200);
  assert.equal((await call(second,{action:'login',u,auth})).statusCode,429);
  assert.equal((await call(account,{action:'login',u,auth,extra:'x'.repeat(13000)})).statusCode,413);
});
test('claim preserves an overlapping legacy domain as an authenticated alternative',async()=>{
  await call(profile,{action:'write',u,auth,revision:0,domains:{rating:{rating:1700,ratedGames:10}}});
  redis('SET',`chess:rating:${legacy}`,JSON.stringify({rating:1500,ratedGames:3}));
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:legacy})).statusCode,200);
  const data=(await call(profile,{action:'read',u,auth})).body;
  assert.equal(data.profile.rating.rating,1700);
  assert.equal(Object.values(data.legacyProfiles)[0].rating.rating,1500);
});
