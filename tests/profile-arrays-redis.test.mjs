// Actual handler + Redis Lua; this dedicated disposable container contains synthetic data only.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
const redis = (...args) => JSON.parse(execFileSync('docker', ['exec', 'gipf-issue62-synthetic-redis', 'redis-cli', '--json', ...args.map(String)], {encoding:'utf8'}));
const u='a'.repeat(64), auth='b'.repeat(64), other='c'.repeat(64), legacy='d'.repeat(64);
const key=`gipf:profile:v2:${u}`, claimKey=`gipf:claim:${legacy}`;
async function call(body, handler=profile) {
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{},socket:{remoteAddress:'192.0.2.62'},body:{u,auth,...body}},res);return res;
}
const read = async(scope) => (await call({action:'read',scope})).body;
const write = (domains,revision=0,scope) => call({action:'write',domains,revision,scope});
const domains = {
  rating:{rating:1400,ratedGames:2}, history:{v:1,casual:{easy:{w:1,l:2,d:3}},rated:{}},
  puzzles:{rating:1500,attempts:0,puzzles:{}}, mistakes:{v:1,entries:[]},
};
beforeEach(()=>{
  redis('FLUSHDB');
  process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
  process.env.GIPF_LEGACY_CLAIM_FROM=new Date(Date.now()-1000).toISOString();
  process.env.GIPF_LEGACY_CLAIM_UNTIL=new Date(Date.now()+86400000).toISOString();
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'https://synthetic.invalid');
    return {ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})};
  };
  for(const id of [u,other]) redis('SET',`chess:account:${id}`,JSON.stringify({authHash:hash(auth)}));
});
test('all sanitized domains preserve empty arrays and maps across partial writes',async()=>{
  assert.equal((await write(domains)).statusCode,200);
  assert.deepEqual((await read()).profile,domains);
  assert.equal((await write({rating:{rating:1600.2,ratedGames:3.1}},1)).statusCode,200);
  assert.deepEqual((await read()).profile,{...domains,rating:{rating:1600,ratedGames:3}});
  const entry={fenBefore:'synthetic',id:'x',movePlayed:'e4',bestSan:'d4',bestPv:'d4',classification:'mistake',opening:'',cpLoss:2,moveNo:1,createdAt:1,attempts:0,streak:0,nextDueAt:0};
  const nonempty={mistakes:{v:1,entries:[entry]},puzzles:{rating:1500,attempts:1,puzzles:{x:{attempts:1,solves:0,streak:0,nextDueAt:0,lastResult:'failed'}}}};
  assert.equal((await write(nonempty,2)).statusCode,200);
  assert.deepEqual((await read()).profile,{...domains,rating:{rating:1600,ratedGames:3},...nonempty});
});
test('settings preserve string JSON, null and objects with an independent revision',async()=>{
  await write(domains);
  const preferences={chessGameLog:'[]',yinshWins:'{"1":0,"2":0}',chessSound:null};
  assert.equal((await write({preferences},0,'settings')).statusCode,200);
  assert.deepEqual((await read('settings')).profile,{preferences});
  assert.equal((await write({preferences:{}},1,'settings')).statusCode,200);
  assert.deepEqual((await read('settings')).profile,{preferences:{}});
  assert.deepEqual((await read()).profile,domains);
});
test('two handler instances race; stale multi-domain write cannot mutate any bytes',async()=>{
  const second=(await import('../api/chessProfile.js?arrays-second')).default;
  const request={action:'write',revision:0,domains};
  const outcomes=await Promise.all([call(request),call({...request,domains:{rating:{rating:1800,ratedGames:1}}},second)]);
  assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);
  const before=redis('GET',key);
  assert.equal((await write(domains)).statusCode,409);
  assert.equal(redis('GET',key),before);
});
test('claim preserves source and existing nested JSON, collisions and owner retries',async()=>{
  const old={revision:4,profile:{...domains,mistakes:{v:1,entries:[]}},legacyProfiles:{previous:{nested:[[],{},[1,[],{}]],text:'quote " and \\ newline\n'}}};
  redis('SET',key,JSON.stringify(old));
  const sourceDomains={...domains,mistakes:{v:1,entries:[{fenBefore:'synthetic',id:'legacy'}]}};
  for(const [d,v] of Object.entries(sourceDomains)) redis('SET',`chess:profile:${legacy}:${d}`,JSON.stringify(v));
  const source=redis('GET',`chess:profile:${legacy}:mistakes`);
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  const after=await read();
  assert.deepEqual(after.profile,old.profile);
  assert.deepEqual(after.legacyProfiles,{...old.legacyProfiles,[claimKey]:sourceDomains});
  assert.equal(after.revision,5);assert.equal(after.claimCount,1);
  assert.equal(redis('GET',`chess:profile:${legacy}:mistakes`),source);
  const raw=redis('GET',key);
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  assert.equal((await call({action:'claim',legacyId:legacy,u:other})).statusCode,409);
  assert.equal(redis('GET',key),raw);
  assert.equal((await write({rating:{rating:1700,ratedGames:4}},5)).statusCode,200);
  assert.deepEqual((await read()).legacyProfiles,after.legacyProfiles);
});
test('competing claims have one owner and copy arrays into missing domains',async()=>{
  redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify(domains.mistakes));
  redis('SET',`chess:rating:${legacy}`,JSON.stringify(domains.rating));
  const outcomes=await Promise.all([call({action:'claim',legacyId:legacy}),call({action:'claim',legacyId:legacy,u:other})]);
  assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);
  const owner=redis('GET',claimKey);
  assert.deepEqual((await call({action:'read',u:owner})).body.profile,{mistakes:domains.mistakes,rating:domains.rating});
});
test('damaged legacy mistakes remain readable and retained, never guessed or overwritten',async()=>{
  const damaged={v:1,entries:{}};
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:damaged,history:domains.history}}));
  assert.deepEqual((await read()).profile.mistakes,damaged);
  assert.equal((await write({rating:domains.rating},1)).statusCode,200);
  assert.deepEqual((await read()).profile.mistakes,damaged);
  const raw=redis('GET',key);
  const response=await write({mistakes:domains.mistakes},2);
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'legacy_shape_conflict');
  assert.equal(redis('GET',key),raw);
  redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify(damaged));
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  assert.deepEqual((await read()).legacyProfiles[claimKey].mistakes,damaged);
});
test('auth, request bounds and sanitizer rejection leave profiles untouched',async()=>{
  assert.equal((await call({action:'write',revision:0,domains,auth:'f'.repeat(64)})).statusCode,401);
  assert.equal((await write({mistakes:{v:1,entries:{}}})).statusCode,400);
  assert.equal((await write({mistakes:{v:1,entries:Array(201).fill({fenBefore:'synthetic'})}})).statusCode,400);
  assert.equal((await call({action:'write',revision:0,domains,extra:'x'.repeat(300001)})).statusCode,413);
  assert.equal(redis('GET',key),null);
});
test('claim re-reads a changed source and destination instead of committing a stale snapshot',async()=>{
  redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify(domains.mistakes));
  const original=globalThis.fetch;let raced=false;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===7 && !raced) {
      raced=true;
      redis('SET',key,JSON.stringify({revision:1,profile:{rating:domains.rating}}));
      redis('SET',`chess:profile:${legacy}:history`,JSON.stringify(domains.history));
    }
    return original(url,options);
  };
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  assert.ok(raced);
  const data=await read();assert.equal(data.revision,2);assert.equal(data.claimCount,1);
  assert.deepEqual(data.profile,{rating:domains.rating,mistakes:domains.mistakes,history:domains.history});
});
test('exhausted claim races and lifetime limit mutate neither destination nor ownership',async()=>{
  const original=globalThis.fetch;let races=0,last;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===7) {
      last=JSON.stringify({revision:++races,profile:{mistakes:domains.mistakes}});
      redis('SET',key,last);
    }
    return original(url,options);
  };
  const response=await call({action:'claim',legacyId:legacy});
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'conflict');
  assert.equal(races,3);assert.equal(redis('GET',key),last);assert.equal(redis('GET',claimKey),null);
  globalThis.fetch=original;
  last=JSON.stringify({revision:5,claimCount:5,profile:domains});redis('SET',key,last);
  const limited=await call({action:'claim',legacyId:legacy});
  assert.equal(limited.statusCode,409);assert.equal(limited.body.error,'claim_limit');
  assert.equal(redis('GET',key),last);assert.equal(redis('GET',claimKey),null);
});
test('write compares exact stored bytes even if a competing record has the same revision',async()=>{
  const original=globalThis.fetch;const competing=JSON.stringify({revision:0,profile:domains});let raced=false;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===1 && args[3]===key) {
      raced=true;redis('SET',key,competing);
    }
    return original(url,options);
  };
  assert.equal((await write({rating:{rating:1900,ratedGames:10}})).statusCode,409);
  assert.ok(raced);assert.equal(redis('GET',key),competing);
});
test('real localhost HTTP endpoint writes, reads, rejects stale writes and claims',async()=>{
  const {createServer}=await import('node:http');
  const {request}=await import('node:http');
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req) raw+=chunk;
    req.body=JSON.parse(raw);
    res.status=n=>{res.statusCode=n;return res;};res.json=body=>res.end(JSON.stringify(body));
    await profile(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=body=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/chessProfile',method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));
    });req.on('error',reject);req.end(JSON.stringify({u,auth,...body}));
  });
  try {
    assert.equal((await send({action:'write',revision:0,domains})).status,200);
    assert.deepEqual((await send({action:'read'})).body.profile,domains);
    assert.equal((await send({action:'write',revision:0,domains})).status,409);
    redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify(domains.mistakes));
    assert.equal((await send({action:'claim',legacyId:legacy})).status,200);
    assert.deepEqual((await send({action:'read'})).body.legacyProfiles[claimKey].mistakes,domains.mistakes);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
