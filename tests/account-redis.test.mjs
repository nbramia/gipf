// Real Redis Lua/CAS contract tests. Use only the disposable synthetic container.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { redis, redisAsync } from './redis-fixture.mjs';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import { signInAs, cookieHeaders } from './session-fixture.mjs';
const u='a'.repeat(64), other='c'.repeat(64);
const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
// Requests carry the session cookie of the signed-in identity `as` (owner by default;
// null sends none). owner's data id is u and other's is `other`; fresh is a new identity.
let tokens={};
async function call(handler, body, method='POST', ip='192.0.2.1', as='owner') {
  const res=response(); await handler({method,headers:{'content-type':'application/json',...cookieHeaders(as&&tokens[as])},socket:{remoteAddress:ip},body},res);return res;
}
beforeEach(async()=>{
  redis('FLUSHDB');
  process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
  globalThis.fetch=async (_url,options)=>({ok:true,json:async()=>({result:await redisAsync(...JSON.parse(options.body))})});
  tokens={owner:await signInAs('owner',u),other:await signInAs('other',other),fresh:await signInAs('fresh')};
});
test('A cannot authorize B by swapping public ID; arbitrary id field is not authorization',async()=>{
  assert.equal((await call(profile,{action:'read',u:other})).statusCode,401);
  assert.equal((await call(profile,{action:'read',id:other},'POST','192.0.2.1',null)).statusCode,401);
  assert.equal((await call(profile,{action:'write',u,id:other,revision:0,domains:{rating:{rating:1400,ratedGames:2}}})).statusCode,200);
  assert.equal(redis('GET',`gipf:profile:v2:${other}`),null);
  assert.equal((await call(profile,{},'GET')).statusCode,405);
});
test('stale revision conflicts without changing cloud data and settings revision is independent',async()=>{
  const write={action:'write',u,revision:0,domains:{rating:{rating:1500,ratedGames:5}}};
  assert.equal((await call(profile,write)).body.revision,1);
  assert.equal((await call(profile,{...write,domains:{rating:{rating:1000,ratedGames:1}}})).statusCode,409);
  assert.equal((await call(profile,{action:'read',u})).body.profile.rating.rating,1500);
  assert.equal((await call(profile,{...write,scope:'settings',domains:{preferences:{yinshWins:'{"1":2,"2":1}'}}})).body.revision,1);
  assert.equal((await call(profile,{...write,scope:'settings',revision:1,domains:{preferences:{gipfApiKey:'synthetic'}}})).statusCode,400);
});
test('two handler instances share account limits and bounded payloads',async()=>{
  const second=(await import('../api/chessAccount.js?second')).default;
  for(let i=0;i<20;i++) assert.equal((await call(i%2?second:account,{action:'setKeys',lichess:null},'POST','192.0.2.1','fresh')).statusCode,200);
  assert.equal((await call(second,{action:'setKeys',lichess:null},'POST','192.0.2.1','fresh')).statusCode,429);
  assert.equal((await call(account,{action:'setKeys',lichess:null,extra:'x'.repeat(13000)},'POST','192.0.2.9','fresh')).statusCode,413);
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

test('retired account and claim actions are refused without touching the store',async()=>{
  for(const action of ['create','login','setKey','link','link-verify']) {
    const r=await call(account,{action,u,auth:'b'.repeat(64)},'POST','192.0.2.1','fresh');
    assert.deepEqual([r.statusCode,r.body],[400,{error:'bad_request'}]);
  }
  const claim=await call(profile,{action:'claim',u,legacyId:'d'.repeat(64)});
  assert.deepEqual([claim.statusCode,claim.body],[400,{error:'bad_request'}]);
  assert.equal(redis('EXISTS',`gipf:profile:v2:${u}`),0);
});
test('profiles claimed before Auth0 keep their legacyProfiles copies through reads and writes',async()=>{
  const legacy={'gipf:claim:synthetic':{rating:{rating:1500,ratedGames:3}}};
  redis('SET',`gipf:profile:v2:${u}`,JSON.stringify({revision:1,profile:{rating:{rating:1700,ratedGames:10}},legacyProfiles:legacy,claimCount:1}));
  const read=(await call(profile,{action:'read',u})).body;
  assert.equal(read.profile.rating.rating,1700);
  assert.deepEqual(read.legacyProfiles,legacy);
  assert.equal((await call(profile,{action:'write',u,revision:1,domains:{rating:{rating:1720,ratedGames:11}}})).body.revision,2);
  assert.deepEqual(JSON.parse(redis('GET',`gipf:profile:v2:${u}`)).legacyProfiles,legacy);
});
