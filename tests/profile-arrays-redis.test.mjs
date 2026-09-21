// Actual handler + Redis Lua; this dedicated disposable container contains synthetic data only.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
const redis = (...args) => JSON.parse(execFileSync('docker', ['exec', '-i', 'gipf-r22-address-synthetic-redis', 'redis-cli', '--json'], {
  encoding:'utf8', input:args.map(arg=>JSON.stringify(String(arg))).join(' ')+'\n', maxBuffer:16*1024*1024,
}));
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
test('two handler instances reject a stale multi-domain write without changing bytes',async()=>{
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
test('known empty-object mistakes allow the bundled game-end history and mistakes save',async()=>{
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:{v:1,entries:{}},history:domains.history}}));
  const history={v:1,casual:{easy:{w:2,l:2,d:3}},rated:{}};
  const result=await write({history,mistakes:{v:1,entries:[{fenBefore:'new'}]}},1);
  assert.equal(result.statusCode,200);assert.deepEqual(result.body.saved,['history','mistakes']);
  assert.deepEqual((await read()).profile.history,history);
  assert.equal((await read()).profile.mistakes.entries[0].fenBefore,'new');
});
test('nonempty malformed originals survive rejected bundled saves and healthy claims',async()=>{
  const damaged={v:1,entries:{original:'recover me'}};
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:damaged,history:domains.history}}));
  const raw=redis('GET',key);
  const response=await write({history:domains.history,mistakes:domains.mistakes},1);
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'legacy_shape_conflict');
  assert.equal(redis('GET',key),raw);
  redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify({v:1,entries:[{fenBefore:'healthy'}]}));
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  assert.deepEqual((await read()).profile.mistakes,damaged);
  assert.equal((await read()).legacyProfiles[claimKey].mistakes.entries[0].fenBefore,'healthy');
});
test('claims retain empty-object alternatives and healthy sources without guessing conversions',async()=>{
  const damaged={v:1,entries:{}};
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:damaged}}));
  const source={v:1,entries:[{fenBefore:'healthy'}]};
  redis('SET',`chess:profile:${legacy}:mistakes`,JSON.stringify(source));
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,200);
  assert.deepEqual((await read()).profile.mistakes,damaged);
  assert.deepEqual((await read()).legacyProfiles[claimKey].mistakes,source);
  assert.equal((await write({history:domains.history,mistakes:source},2)).statusCode,200);
  assert.deepEqual(JSON.parse(redis('GET',`chess:profile:${legacy}:mistakes`)),source);
});
test('empty stored JSON fails closed in reads, writes and claim sources or destination',async()=>{
  redis('SET',key,'');
  assert.equal((await call({action:'read'})).statusCode,503);
  assert.equal((await write(domains)).statusCode,503);
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,503);
  assert.equal(redis('GET',key),'');assert.equal(redis('GET',claimKey),null);
  redis('DEL',key);redis('SET',`chess:profile:${legacy}:rating`,'');
  redis('SET',`chess:rating:${legacy}`,JSON.stringify(domains.rating));
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,503);
  assert.equal(redis('GET',key),null);assert.equal(redis('GET',claimKey),null);
});
test('CAS distinguishes a missing snapshot from concurrent empty-string corruption',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===1 && args[3]===key) redis('SET',key,'');
    return original(url,options);
  };
  assert.equal((await write(domains)).statusCode,409);assert.equal(redis('GET',key),'');
});
test('claim aggregate budget stops before another command can exceed the handler deadline',async()=>{
  const original=globalThis.fetch,now=Date.now;let elapsed=0,commands=0;
  Date.now=()=>now()+elapsed;
  globalThis.fetch=async(url,options)=>{
    commands++;const result=await original(url,options);elapsed+=2900;return result;
  };
  try {
    assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,503);
    assert.equal(commands,5);assert.equal(redis('GET',key),null);assert.equal(redis('GET',claimKey),null);
  } finally {Date.now=now;}
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

test('maximum-count synthetic domains and five alternatives preserve exact CAS at measured payload sizes',async()=>{
  const entry={fenBefore:'f'.repeat(120),id:'i'.repeat(32),movePlayed:'m'.repeat(16),bestSan:'s'.repeat(16),bestPv:'p'.repeat(120),classification:'c'.repeat(64),opening:'o'.repeat(64),cpLoss:1e100,moveNo:1e100,createdAt:1e100,attempts:1e100,streak:1e100,nextDueAt:1e100};
  const historySide=Object.fromEntries(Array.from({length:32},(_,i)=>[String(i).padStart(32,'h'),{w:1000000,l:1000000,d:1000000}]));
  const large={rating:{rating:4000,ratedGames:1000000},history:{v:1,casual:historySide,rated:historySide},
    puzzles:{rating:4000,attempts:1000000,puzzles:Object.fromEntries(Array.from({length:500},(_,i)=>[String(i).padStart(64,'p'),{attempts:1000000,solves:1000000,streak:1000000,nextDueAt:4102444800000,lastResult:'solved'}]))},
    mistakes:{v:1,entries:Array.from({length:200},(_,i)=>({...entry,id:String(i).padStart(32,'i')}))}};
  assert.equal((await write(large)).statusCode,200);
  let claimBytes=0,writeBytes=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===7) claimBytes=Math.max(claimBytes,Buffer.byteLength(options.body));
    if(args[0]==='EVAL' && args[2]===1 && args[3]===key) writeBytes=Math.max(writeBytes,Buffer.byteLength(options.body));
    return original(url,options);
  };
  for(let i=0;i<5;i++) {
    const id=String(i).repeat(64);
    for(const [domain,value] of Object.entries(large)) redis('SET',`chess:profile:${id}:${domain}`,JSON.stringify(value));
    assert.equal((await call({action:'claim',legacyId:id})).statusCode,200);
  }
  const before=await read();assert.equal(before.claimCount,5);
  assert.equal((await write(large,before.revision)).statusCode,200);
  const after=await read();assert.deepEqual(after.profile,large);assert.deepEqual(after.legacyProfiles,before.legacyProfiles);
  console.log(JSON.stringify({fixture:'maximum-count ASCII',mistakesBytes:Buffer.byteLength(JSON.stringify(large.mistakes)),recordBytes:Buffer.byteLength(redis('GET',key)),claimEvalBytes:claimBytes,writeEvalBytes:writeBytes}));
});

test('claim retry budget includes preflight and previous attempts',async()=>{
  const original=globalThis.fetch,now=Date.now;let elapsed=0,attempts=0,reads=0;
  Date.now=()=>now()+elapsed;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='MGET') reads++;
    if(args[0]==='EVAL' && args[2]===7) {
      attempts++;redis('SET',key,JSON.stringify({revision:attempts,profile:{}}));
    }
    const result=await original(url,options);elapsed+=2050;return result;
  };
  try {
    assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,503);
    assert.equal(attempts,1);assert.equal(reads,2);
    assert.equal(redis('GET',claimKey),null);assert.equal(JSON.parse(redis('GET',key)).revision,1);
  } finally {Date.now=now;}
});
test('claim detects missing-to-empty source race and preserves empty owners',async()=>{
  const original=globalThis.fetch;let raced=false;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===7 && !raced) {
      raced=true;redis('SET',`chess:profile:${legacy}:mistakes`,'');
    }
    return original(url,options);
  };
  assert.equal((await call({action:'claim',legacyId:legacy})).statusCode,503);
  assert.ok(raced);assert.equal(redis('GET',key),null);assert.equal(redis('GET',claimKey),null);
  redis('SET',claimKey,'');
  assert.equal((await call({action:'claim',legacyId:legacy})).body.error,'already_claimed');
  assert.equal(redis('GET',claimKey),'');
});
