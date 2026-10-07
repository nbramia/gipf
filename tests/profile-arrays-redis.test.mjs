// Actual handler + Redis Lua; this dedicated disposable container contains synthetic data only.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import profile from '../api/chessProfile.js';
import { signInAs, cookieHeaders } from './session-fixture.mjs';
const redisContainer = process.env.PLAY_TEST_REDIS_CONTAINER;
if (!/^play-test-[a-z0-9-]+$/.test(redisContainer || '')) throw new Error('Set PLAY_TEST_REDIS_CONTAINER to a disposable play-test-* container');
const redis = (...args) => JSON.parse(execFileSync('docker', ['exec', '-i', redisContainer, 'redis-cli', '--json'], {
  encoding:'utf8', input:args.map(arg=>JSON.stringify(String(arg))).join(' ')+'\n', maxBuffer:16*1024*1024,
}));
const u='a'.repeat(64), other='c'.repeat(64);
const key=`play:profile:v2:${u}`;
let tokens={};
// Requests are the owner's (data id u) with its session cookie; `as: null` sends none.
async function call(body, { handler=profile, as='owner' }={}) {
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{'content-type':'application/json',...cookieHeaders(as&&tokens[as])},socket:{remoteAddress:'192.0.2.62'},body:{u,...body}},res);return res;
}
const read = async(scope) => (await call({action:'read',scope})).body;
const write = (domains,revision=0,scope) => call({action:'write',domains,revision,scope});
const domains = {
  rating:{rating:1400,ratedGames:2}, history:{v:1,casual:{easy:{w:1,l:2,d:3}},rated:{}},
  puzzles:{rating:1500,attempts:0,puzzles:{}}, mistakes:{v:1,entries:[]},
};
beforeEach(async()=>{
  redis('FLUSHDB');
  process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'https://synthetic.invalid');
    return {ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})};
  };
  tokens={owner:await signInAs('owner',u),other:await signInAs('other',other)};
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
  const outcomes=await Promise.all([call(request),call({...request,domains:{rating:{rating:1800,ratedGames:1}}},{handler:second})]);
  assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);
  const before=redis('GET',key);
  assert.equal((await write(domains)).statusCode,409);
  assert.equal(redis('GET',key),before);
});
test('known empty-object mistakes allow the bundled game-end history and mistakes save',async()=>{
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:{v:1,entries:{}},history:domains.history}}));
  const history={v:1,casual:{easy:{w:2,l:2,d:3}},rated:{}};
  const result=await write({history,mistakes:{v:1,entries:[{fenBefore:'new'}]}},1);
  assert.equal(result.statusCode,200);assert.deepEqual(result.body.saved,['history','mistakes']);
  assert.deepEqual((await read()).profile.history,history);
  assert.equal((await read()).profile.mistakes.entries[0].fenBefore,'new');
});
test('nonempty malformed originals survive rejected bundled saves',async()=>{
  const damaged={v:1,entries:{original:'recover me'}};
  redis('SET',key,JSON.stringify({revision:1,profile:{mistakes:damaged,history:domains.history}}));
  const raw=redis('GET',key);
  const response=await write({history:domains.history,mistakes:domains.mistakes},1);
  assert.equal(response.statusCode,409);assert.equal(response.body.error,'legacy_shape_conflict');
  assert.equal(redis('GET',key),raw);
  assert.deepEqual((await read()).profile.mistakes,damaged);
});
test('empty stored JSON fails closed in reads and writes',async()=>{
  redis('SET',key,'');
  assert.equal((await call({action:'read'})).statusCode,503);
  assert.equal((await write(domains)).statusCode,503);
  assert.equal(redis('GET',key),'');
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
test('auth, request bounds and sanitizer rejection leave profiles untouched',async()=>{
  assert.equal((await call({action:'write',revision:0,domains},{as:null})).statusCode,401);
  assert.equal((await write({mistakes:{v:1,entries:{}}})).statusCode,400);
  assert.equal((await write({mistakes:{v:1,entries:Array(201).fill({fenBefore:'synthetic'})}})).statusCode,400);
  assert.equal((await call({action:'write',revision:0,domains,extra:'x'.repeat(300001)})).statusCode,413);
  assert.equal(redis('GET',key),null);
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
test('real localhost HTTP endpoint writes, reads and rejects stale writes',async()=>{
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
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/chessProfile',method:'POST',headers:{'Content-Type':'application/json',...cookieHeaders(tokens.owner)}},res=>{
      let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));
    });req.on('error',reject);req.end(JSON.stringify({u,...body}));
  });
  try {
    assert.equal((await send({action:'write',revision:0,domains})).status,200);
    assert.deepEqual((await send({action:'read'})).body.profile,domains);
    assert.equal((await send({action:'write',revision:0,domains})).status,409);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('maximum-count synthetic domains and five stored alternatives preserve exact CAS at measured payload sizes',async()=>{
  const entry={fenBefore:'f'.repeat(120),id:'i'.repeat(32),movePlayed:'m'.repeat(16),bestSan:'s'.repeat(16),bestPv:'p'.repeat(120),classification:'c'.repeat(64),opening:'o'.repeat(64),cpLoss:1e100,moveNo:1e100,createdAt:1e100,attempts:1e100,streak:1e100,nextDueAt:1e100};
  const historySide=Object.fromEntries(Array.from({length:32},(_,i)=>[String(i).padStart(32,'h'),{w:1000000,l:1000000,d:1000000}]));
  const large={rating:{rating:4000,ratedGames:1000000},history:{v:1,casual:historySide,rated:historySide},
    puzzles:{rating:4000,attempts:1000000,puzzles:Object.fromEntries(Array.from({length:500},(_,i)=>[String(i).padStart(64,'p'),{attempts:1000000,solves:1000000,streak:1000000,nextDueAt:4102444800000,lastResult:'solved'}]))},
    mistakes:{v:1,entries:Array.from({length:200},(_,i)=>({...entry,id:String(i).padStart(32,'i')}))}};
  assert.equal((await write(large)).statusCode,200);
  let writeBytes=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const args=JSON.parse(options.body);
    if(args[0]==='EVAL' && args[2]===1 && args[3]===key) writeBytes=Math.max(writeBytes,Buffer.byteLength(options.body));
    return original(url,options);
  };
  // Five pre-Auth0 claimed copies, as such records hold them in legacyProfiles.
  const stored=JSON.parse(redis('GET',key));
  stored.legacyProfiles=Object.fromEntries(Array.from({length:5},(_,i)=>[`play:claim:${String(i).repeat(64)}`,large]));
  stored.claimCount=5;
  redis('SET',key,JSON.stringify(stored));
  const before=await read();assert.equal(before.claimCount,5);
  assert.equal((await write(large,before.revision)).statusCode,200);
  const after=await read();assert.deepEqual(after.profile,large);assert.deepEqual(after.legacyProfiles,before.legacyProfiles);
  console.log(JSON.stringify({fixture:'maximum-count ASCII',mistakesBytes:Buffer.byteLength(JSON.stringify(large.mistakes)),recordBytes:Buffer.byteLength(redis('GET',key)),writeEvalBytes:writeBytes}));
});

