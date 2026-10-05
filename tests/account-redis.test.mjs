// Real Redis Lua/CAS contract tests. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import rating from '../api/chessRating.js';
import { hash } from '../server/publicSecurity.js';
import { identityKey, linkKey } from '../server/identity.js';
import { signInAs, identityFor, cookieHeaders } from './session-fixture.mjs';
const u='a'.repeat(64), auth='b'.repeat(64), other='c'.repeat(64), legacy='d'.repeat(64), otherAuth='e'.repeat(64);
const enc={iv:'AAAAAAAAAAAAAAAA',ct:'AAAAAAAAAAAAAAAAAAAAAA=='};
const sealKey=Buffer.alloc(32,9).toString('base64');
const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
// Profile requests: the body's auth picks the signed-in device of the account it belongs to
// (a wrong credential is a signed-out request). `as` names another signed-in identity.
let tokens={};
const sessionHeaders=(body,as)=>cookieHeaders(as?tokens[as]:body.auth===auth?tokens[u]:body.auth===otherAuth?tokens[other]:null);
async function call(handler, body, method='POST', ip='192.0.2.1', as) {
  const res=response(); await handler({method,headers:{'content-type':'application/json',...sessionHeaders(body,as)},socket:{remoteAddress:ip},body},res);return res;
}
beforeEach(async()=>{
  redis('FLUSHDB');
  process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
  process.env.GIPF_LEGACY_CLAIM_FROM = new Date(Date.now()-1000).toISOString();
  process.env.GIPF_LEGACY_CLAIM_UNTIL = new Date(Date.now()+86400000).toISOString();
  globalThis.fetch=async (_url,options)=>({ok:true,json:async()=>({result:await redisAsync(...JSON.parse(options.body))})});
  redis('SET',`chess:account:${u}`,JSON.stringify({authHash:hash(auth),enc,encLichess:enc}));
  redis('SET',`chess:account:${other}`,JSON.stringify({authHash:hash('e'.repeat(64))}));
  // owner/other are identities already linked to the two old accounts; fresh and mallory are new.
  tokens={[u]:await signInAs('owner',u),[other]:await signInAs('other',other),fresh:await signInAs('fresh'),mallory:await signInAs('mallory')};
});
test('link-verify returns the old envelopes unchanged; a wrong token neither verifies nor mutates',async()=>{
  const bad=await call(account,{action:'link-verify',u,auth:'f'.repeat(64)},'POST','192.0.2.1','fresh');assert.deepEqual([bad.statusCode,bad.body],[401,{error:'bad_credentials'}]);
  const ok=await call(account,{action:'link-verify',u,auth},'POST','192.0.2.1','fresh');
  assert.equal(ok.statusCode,200);assert.deepEqual(ok.body.enc,enc);assert.deepEqual(ok.body.encLichess,enc);
  assert.deepEqual(JSON.parse(redis('GET',`chess:account:${u}`)),{authHash:hash(auth),enc,encLichess:enc});
  assert.equal(redis('GET',linkKey(u)),null);
});
test('competing links of one old account to two identities have one winner',async()=>{
  const outcomes=await Promise.all(['fresh','mallory'].map(as=>call(account,{action:'link',u,auth,sealKey},'POST','192.0.2.1',as)));
  assert.deepEqual(outcomes.map(x=>x.statusCode).sort(),[200,409]);
  const winner=outcomes[0].statusCode===200?'fresh':'mallory';
  assert.equal(redis('GET',linkKey(u)),identityFor(winner));
  assert.equal(JSON.parse(redis('GET',identityKey(identityFor(winner==='fresh'?'mallory':'fresh')))).linked,null);
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
test('two handler instances share account limits and bounded payloads',async()=>{
  const second=(await import('../api/chessAccount.js?second')).default;
  for(let i=0;i<20;i++) assert.equal((await call(i%2?second:account,{action:'setKeys',lichess:null},'POST','192.0.2.1','fresh')).statusCode,200);
  assert.equal((await call(second,{action:'setKeys',lichess:null},'POST','192.0.2.1','fresh')).statusCode,429);
  assert.equal((await call(account,{action:'setKeys',lichess:null,extra:'x'.repeat(13000)},'POST','192.0.2.9','fresh')).statusCode,413);
});
test('claim preserves an overlapping legacy domain as an authenticated alternative',async()=>{
  await call(profile,{action:'write',u,auth,revision:0,domains:{rating:{rating:1700,ratedGames:10}}});
  redis('SET',`chess:rating:${legacy}`,JSON.stringify({rating:1500,ratedGames:3}));
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:legacy})).statusCode,200);
  const data=(await call(profile,{action:'read',u,auth})).body;
  assert.equal(data.profile.rating.rating,1700);
  assert.equal(Object.values(data.legacyProfiles)[0].rating.rating,1500);
});
test('bad-token link floods from fresh networks cannot spend the owner budget; guesses stay bounded per network',async()=>{
  const second=(await import('../api/chessAccount.js?flood')).default;
  for(let i=0;i<20;i++) {
    const denied=await call(i%2?second:account,{action:'link-verify',u,auth:'f'.repeat(64)},'POST',`192.0.2.${i+10}`,'mallory');
    assert.equal(denied.statusCode,401);assert.deepEqual(denied.body,{error:'bad_credentials'});
  }
  assert.equal(redis('GET',`gipf:limit:account-user:${hash(identityFor('fresh'))}`),null);
  assert.equal((await call(second,{action:'link-verify',u,auth},'POST','198.51.100.1','fresh')).statusCode,200);
  assert.equal((await call(account,{action:'setKeys',lichess:null},'POST','198.51.100.2','fresh')).statusCode,200);
  // Guesses remain bounded per network across usernames, identities and handler instances.
  tokens.eve=await signInAs('eve');
  for(let i=0;i<20;i++) assert.equal((await call(second,{action:'link-verify',u,auth:'f'.repeat(64)},'POST','203.0.113.1',i%2?'fresh':'eve')).statusCode,401);
  assert.equal((await call(account,{action:'link-verify',u:other,auth:otherAuth},'POST','203.0.113.1','fresh')).statusCode,429);
  const missing=await call(account,{action:'link-verify',u:'9'.repeat(64),auth},'POST','198.51.100.3','fresh');
  assert.deepEqual(missing.body,{error:'bad_credentials'});
});
test('concurrent empty claims and owner repeats do not spend daily or lifetime migration budgets',async()=>{
  const claim=legacyId=>call(profile,{action:'claim',u,auth,legacyId});
  const budget=`gipf:limit:claim-user:${hash(u)}`;
  const emptyIds=Array.from({length:8},(_,i)=>(i+20).toString(16).padStart(64,'0'));
  const empty=await Promise.all(emptyIds.map(claim));
  assert.ok(empty.every(r=>r.statusCode===200 && r.body.claimed===false));
  for(const id of emptyIds) assert.equal(redis('GET',`gipf:claim:${id}`),null);
  assert.equal(redis('GET',`gipf:profile:v2:${u}`),null);assert.equal(redis('GET',budget),null);
  // A previously empty ID can acquire a source later and be claimed successfully.
  redis('SET',`chess:rating:${emptyIds[0]}`,JSON.stringify({rating:1500,ratedGames:3}));
  const repeats=await Promise.all(Array.from({length:8},()=>claim(emptyIds[0])));
  assert.ok(repeats.every(r=>r.statusCode===200 && r.body.claimed));
  assert.equal(redis('GET',budget),'1');assert.ok(redis('TTL',budget)>0);
  let data=JSON.parse(redis('GET',`gipf:profile:v2:${u}`));assert.equal(data.claimCount,1);assert.equal(data.revision,1);
  redis('SET',`chess:rating:${legacy}`,JSON.stringify({rating:1600,ratedGames:5}));
  assert.equal((await claim(legacy)).statusCode,200);
  data=JSON.parse(redis('GET',`gipf:profile:v2:${u}`));assert.equal(data.claimCount,2);assert.equal(redis('GET',budget),'2');
  // Even exhausted budgets cannot block an owner repeat or a no-source no-op.
  redis('SET',budget,'5','EX',86400);
  assert.equal((await claim(legacy)).statusCode,200);
  assert.equal((await claim(emptyIds[1])).body.claimed,false);
  redis('SET',`chess:rating:${emptyIds[1]}`,JSON.stringify({rating:1600,ratedGames:5}));
  assert.equal((await claim(emptyIds[1])).statusCode,429);
  assert.equal(redis('GET',`gipf:claim:${emptyIds[1]}`),null);assert.equal(redis('GET',budget),'5');
});
test('competing owners bind once; failed foreign claims never consume the loser budget',async()=>{
  redis('SET',`chess:rating:${legacy}`,JSON.stringify({rating:1500,ratedGames:3}));
  const outcomes=await Promise.all([
    call(profile,{action:'claim',u,auth,legacyId:legacy}),
    call(profile,{action:'claim',u:other,auth:'e'.repeat(64),legacyId:legacy}),
  ]);
  assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);
  const owner=redis('GET',`gipf:claim:${legacy}`),loser=owner===u?other:u;
  assert.equal(redis('GET',`gipf:limit:claim-user:${hash(owner)}`),'1');
  assert.equal(redis('GET',`gipf:limit:claim-user:${hash(loser)}`),null);
});
test('concurrent distinct sources cannot exceed five lifetime claims',async()=>{
  const ids=Array.from({length:8},(_,i)=>(i+40).toString(16).padStart(64,'0'));
  for(const id of ids) redis('SET',`chess:rating:${id}`,JSON.stringify({rating:1500,ratedGames:3}));
  const outcomes=await Promise.all(ids.map(legacyId=>call(profile,{action:'claim',u,auth,legacyId})));
  assert.equal(outcomes.filter(r=>r.statusCode===200).length,5);
  assert.equal(outcomes.filter(r=>r.body.error==='claim_limit').length,3);
  const data=JSON.parse(redis('GET',`gipf:profile:v2:${u}`));
  assert.equal(data.claimCount,5);assert.equal(data.revision,5);
  assert.equal(redis('GET',`gipf:limit:claim-user:${hash(u)}`),'5');
  assert.equal(ids.filter(id=>redis('GET',`gipf:claim:${id}`)).length,5);
  const bound=ids.find(id=>redis('GET',`gipf:claim:${id}`));
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:bound})).statusCode,200);
  assert.equal((await call(profile,{action:'claim',u,auth,legacyId:'0'.repeat(64)})).body.claimed,false);
});
test('Yinsh and model proxies share the real Redis AI limit across imports',async()=>{
  const yinsh=(await import('../api/aiMove.js')).default;
  const second=(await import('../api/aiMove.js?second')).default;
  const coach=(await import('../api/chessCoach.js')).default;
  for(let i=0;i<30;i++) {
    const r=await call(i%2?yinsh:coach,{boardState:'synthetic-private-value'});
    assert.equal(r.statusCode,i%2?400:401);
  }
  assert.equal((await call(second,{})).statusCode,429);
});
