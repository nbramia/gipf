// Real Redis Lua + actual HTTP handler, strictly synthetic container and fetch.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
import { signInAs, cookieHeaders } from './session-fixture.mjs';
import { canonical } from '../src/migrationSchema.js';
import { fromLegacy } from '../src/games/chess/matchSnapshot.js';
import { MIGRATION_LIMITS as limits, migrationActivation } from '../server/migrationActivation.js';
const redisContainer = process.env.PLAY_TEST_REDIS_CONTAINER;
if (!/^play-test-[a-z0-9-]+$/.test(redisContainer || '')) throw new Error('Set PLAY_TEST_REDIS_CONTAINER to a disposable play-test-* container');
const redis = (...args) => JSON.parse(execFileSync('docker',['exec','-i',redisContainer,'redis-cli','--json'],{encoding:'utf8',maxBuffer:8*1024*1024,input:args.map(v=>JSON.stringify(String(v))).join(' ')+'\n'}));
const u='a'.repeat(64), other='c'.repeat(64),auth='b'.repeat(64);
let tokens={};
const secretOf=id=>id===other?auth:auth;
// The signed-in device for a request: its session cookie when the body carries that account's
// own credential, none otherwise (a wrong or missing credential is a signed-out request).
const sessionHeaders=body=>{const id=body.u??u;return cookieHeaders(body.auth!==undefined&&body.auth===secretOf(id)?tokens[id]:null);};
const settings=`play:settings:v2:${u}`, profileKey=`play:profile:v2:${u}`;
const preference=(id,data)=>({kind:'preference',id,schemaVersion:1,revision:hash(canonical(data)),data});
const file=(records=[preference('chessDarkMode','true'),preference('chessRating','1500'),preference('splendorDifficulty','strong')])=>({format:'ramia-migration',version:1,app:'games',exportId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',exportedAt:'2026-09-21T00:00:00.000Z',sourceOrigin:'https://synthetic.example.test',records});
const payload=bundle=>({bundle,selected:bundle.records.map(r=>`${r.kind}/${r.id}`)});
async function call(body,handler=profile) {
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 const full={u,auth,...body};
 await handler({method:'POST',headers:{'content-type':'application/json',...sessionHeaders(full)},socket:{remoteAddress:'192.0.2.88'},body:full},res); return res;
}
const prepare=async p=>(await call({action:'migration-preview',...p})).body.token;
const claim=(p,token)=>call({action:'migration-activate',...p,token});
beforeEach(async()=>{
 redis('FLUSHDB');process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://synthetic.invalid');return {ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})};};
 for(const id of [u,other]) redis('SET',`chess:account:${id}`,JSON.stringify({authHash:hash(auth)}));
 tokens={[u]:await signInAs('owner',u),[other]:await signInAs('other',other)};
});
test('atomic activation updates existing writer domains, preserves old bytes, authenticates and replays durably',async()=>{
 const old=JSON.stringify({revision:3,profile:{preferences:{chessDarkMode:'false',chessGameLog:'[]'}}});redis('SET',settings,old);
 const p=payload(file()), token=await prepare(p);
 assert.equal((await call({action:'migration-activate',...p,token,auth:'f'.repeat(64)})).statusCode,401);
 assert.equal(redis('GET',settings),old);
 assert.equal((await claim(p,token)).body.status,'activated');
 assert.deepEqual(JSON.parse(redis('GET',settings)),{revision:4,profile:{preferences:{chessDarkMode:'true',chessGameLog:'[]'}}});
 assert.equal(JSON.parse(redis('GET',profileKey)).profile.rating.rating,1500);
 assert.equal(JSON.parse(redis('GET',`play:migration-extra:v1:${u}`)).profile.values.splendorDifficulty,'strong');
 const recovery=await call({action:'migration-recovery',...p});assert.equal(recovery.body.receipt.before[0],old);
 const before=redis('GET',settings);
 assert.equal((await claim(p,token)).body.status,'replay');assert.equal(redis('GET',settings),before);
 assert.equal((await call({action:'write',scope:'settings',revision:3,domains:{preferences:{}}})).statusCode,409);
 assert.equal((await call({action:'migration-preview',...p,u:other})).statusCode,409);
 assert.equal(redis('GET',`play:migration-count:v1:${u}`),'1');
});
test('stale preview and a same-revision write racing inside Lua cause no migration writes or ownership',async()=>{
 const p=payload(file()), token=await prepare(p), competing=JSON.stringify({revision:0,profile:{preferences:{chessDarkMode:'false'}}});
 const original=fetch;let raced=false;
 globalThis.fetch=async(url,options)=>{const args=JSON.parse(options.body);if(args[0]==='EVAL'&&args[2]===11){raced=true;redis('SET',settings,competing);}return original(url,options);};
 assert.equal((await claim(p,token)).statusCode,409);assert.ok(raced);assert.equal(redis('GET',settings),competing);
 assert.equal(redis('GET',profileKey),null);assert.equal(redis('GET',`play:migration-count:v1:${u}`),null);
 globalThis.fetch=original;assert.equal((await claim(p,token)).statusCode,409);
});
test('two independently imported handlers produce one owner and one increment',async()=>{
 const second=(await import('../api/chessProfile.js?migration-second')).default;
 const p=payload(file()), firstToken=await prepare(p), otherToken=(await call({action:'migration-preview',...p,u:other})).body.token;
 const results=await Promise.all([claim(p,firstToken),call({action:'migration-activate',...p,token:otherToken,u:other},second)]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 const owner=JSON.parse(redis('GET',`play:migration:v1:${hash(p.bundle.exportId)}`)).owner;
 assert.equal(redis('GET',`play:migration-count:v1:${owner}`),'1');
});
test('bad schema, digest, duplicate target, changed selection and lifetime bound fail closed',async()=>{
 const p=payload(file());p.bundle.records[0].revision='0'.repeat(64);
 assert.equal((await call({action:'migration-preview',...p})).statusCode,400);
 const good=payload(file());assert.equal((await call({action:'migration-preview',...good,selected:[...good.selected,good.selected[0]]})).statusCode,400);
 redis('SET',`play:migration-count:v1:${u}`,'50');assert.equal((await call({action:'migration-preview',...good})).statusCode,409);assert.equal(redis('GET',settings),null);
 redis('DEL',`play:migration-count:v1:${u}`);assert.equal((await claim(good,await prepare(good))).statusCode,200);
 assert.equal((await call({action:'migration-preview',...good,selected:[good.selected[0]]})).statusCode,409);
});
test('localhost HTTP performs preview, activation, read and rejects unauthenticated import',async()=>{
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;req.body=raw;res.status=n=>{res.statusCode=n;return res;};res.json=v=>res.end(JSON.stringify(v));await profile(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const send=body=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/play/api/chessProfile',method:'POST',headers:{'Content-Type':'application/json',...sessionHeaders({u,auth,...body})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(JSON.stringify({u,auth,...body}));});
 try {const p=payload(file()),preview=await send({action:'migration-preview',...p});assert.equal(preview.status,200);assert.equal((await send({action:'migration-activate',...p,token:preview.body.token,auth:undefined})).status,401);assert.equal((await send({action:'migration-activate',...p,token:preview.body.token})).status,200);assert.equal((await send({action:'read',scope:'settings'})).body.profile.preferences.chessDarkMode,'true');}
 finally {await new Promise(resolve=>server.close(resolve));}
});

const record=(kind,id,data)=>({kind,id,schemaVersion:1,revision:hash(canonical(data)),data});
const matchRecord=pgn=>{const data=fromLegacy({v:1,pgn:''});data.state.pgn=pgn;return record('chess-match',data.id,data);};
const shuffle=cycles=>Array.from({length:cycles},(_,i)=>`${i*2+1}. Nf3 Nf6 ${i*2+2}. Ng1 Ng8`).join(' ');
const receiptKey=p=>`play:migration:v1:${hash(p.bundle.exportId)}`;
const budgetKey=`play:migration-bytes:v1:${u}`;
const resetRate=()=>redis('DEL',`play:limit:migration-user:${hash(u)}`,`play:limit:sync:${hash('192.0.2.88')}`);
const unchanged=()=>{
 assert.equal(redis('GET',settings),null);
 assert.equal(redis('GET',`play:migration-count:v1:${u}`),null);
 assert.equal(redis('GET',budgetKey),null);
 assert.deepEqual(redis('KEYS','play:migration:v1:*'),[]);
};

test('CPU preflight rejects amplified PGNs, dense PGN tokens, record counts and malformed selections before Redis snapshots',async()=>{
 const cases=[
   payload(file([matchRecord(shuffle(2000))])),
   payload(file([matchRecord('Nf3 '.repeat(limits.pgnTokens+1))])),
   {...payload(file()),bundle:file(Array.from({length:limits.records+1},()=>preference('chessDarkMode','true')))},
   {...payload(file()),selected:Array.from({length:limits.selected+1},(_,i)=>`preference/fake${i}`)},
   {...payload(file()),selected:['__proto__']}, {...payload(file()),selected:[{}]},
 ];
 const original=fetch;let snapshots=0;
 globalThis.fetch=async(url,options)=>{const [cmd,first]=JSON.parse(options.body);if(cmd==='MGET'&&!first.startsWith('chess:account:'))snapshots++;return original(url,options);};
 for(const p of cases) for(const action of ['migration-preview','migration-activate','migration-recovery']) {
   const start=performance.now();assert.equal((await call({action,...p})).statusCode,400);
   assert.ok(performance.now()-start<3000,'bounded invalid request must return well below function duration');
 }
 assert.equal(snapshots,0);unchanged();
});

test('unselected PGNs are digest-bound without replay; selected legal PGN near token cap stays cheap',async()=>{
 const bad=matchRecord('this is not legal PGN '.repeat(8000));
 const p=payload(file([preference('chessDarkMode','true'),bad]));p.selected=[p.selected[0]];
 assert.equal((await claim(p,await prepare(p))).statusCode,200);
 assert.equal((await call({action:'migration-recovery',...p})).statusCode,200);
 assert.equal((await call({action:'migration-recovery',...p,u:other})).statusCode,409);
 bad.data.state.pgn+=' changed';
 assert.equal((await call({action:'migration-preview',...p})).statusCode,400,'even unselected digests are verified');
 bad.revision=hash(canonical(bad.data));
 assert.equal((await call({action:'migration-recovery',...p})).statusCode,409,'whole file still binds ownership');
 const legal=payload(file([matchRecord(shuffle(160))]));legal.bundle.exportId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const start=performance.now();assert.equal((await claim(legal,await prepare(legal))).statusCode,200);
 const elapsed=performance.now()-start;assert.ok(elapsed<3000,`two bounded PGN validations took ${elapsed}ms`);
 console.log(`Bounded legal PGN preview + activation (640 plies): ${Math.round(elapsed)}ms including Redis shim`);
});

test('migration rejects writer/storage overflows without trimming or claiming',async()=>{
 const puzzle={attempts:1,solves:1,streak:1,nextDueAt:0,lastResult:'solved'};
 const mistake={id:'m',fenBefore:fromLegacy({v:1,pgn:''}).state.initialFen,movePlayed:'e4',bestSan:'e4',bestPv:'x'.repeat(2000),cpLoss:1,classification:'mistake',opening:null,moveNo:1,createdAt:0,attempts:0,streak:0,nextDueAt:0};
 const cases=[
   [preference('chessLearningGoal','x'.repeat(2049)),400],
   [preference('chessLearningGoal','é'.repeat(2049)),400],
   [record('chess-puzzles','chessPuzzleProgress',{rating:1000,attempts:501,puzzles:Object.fromEntries(Array.from({length:501},(_,i)=>[`p${i}`,puzzle]))}),400],
   [record('chess-mistakes','chessMistakes',Array.from({length:130},()=>mistake)),400],
   [record('chess-repertoire','chessRepertoire',{version:1,white:['x'.repeat(limits.extrasBytes)],black:[]}),409],
 ];
 for(const [r,status] of cases){const p=payload(file([r]));assert.equal((await call({action:'migration-preview',...p})).statusCode,status);unchanged();}
 const p=payload(file([preference('chessLearningGoal','é'.repeat(2048)),record('chess-puzzles','chessPuzzleProgress',{rating:1000,attempts:500,puzzles:Object.fromEntries(Array.from({length:500},(_,i)=>[`p${i}`,puzzle]))})]));
 assert.equal((await claim(p,await prepare(p))).statusCode,200);
 const settingsValue=JSON.parse(redis('GET',settings)),profileValue=JSON.parse(redis('GET',profileKey));
 assert.equal((await call({action:'write',scope:'settings',revision:settingsValue.revision,domains:settingsValue.profile})).statusCode,200);
 assert.equal((await call({action:'write',revision:profileValue.revision,domains:profileValue.profile})).statusCode,200);
});

test('lifetime byte budget bounds rotating export IDs, remains durable and preserves recovery at exhaustion',async()=>{
 const p=payload(file([record('chess-repertoire','chessRepertoire',{version:1,white:['x'.repeat(120000)],black:[]})]));
 let last,activated=0;
 for(let i=0;i<20;i++){
   resetRate();p.bundle.exportId=`aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12,'0')}`;
   const preview=await call({action:'migration-preview',...p});
   if(preview.statusCode===409){assert.equal(preview.body.error,'migration_storage_limit');break;}
   assert.equal(preview.statusCode,200);assert.equal((await claim(p,preview.body.token)).statusCode,200);activated++;last=structuredClone(p);
   const stored=redis('KEYS','play:migration:v1:*').reduce((n,k)=>n+redis('STRLEN',k),0)+redis('STRLEN',`play:migration-extra:v1:${u}`);
   assert.ok(stored<=Number(redis('GET',budgetKey)));assert.ok(Number(redis('GET',budgetKey))<=limits.accountBytes);
 }
 assert.ok(activated>1&&activated<20);assert.equal(redis('GET',`play:migration-count:v1:${u}`),String(activated));
 const before=redis('GET',budgetKey);assert.equal((await claim(last,'stale')).body.status,'replay');
 const recovered=await call({action:'migration-recovery',...last});assert.equal(recovered.body.receipt.values.chessRepertoire,JSON.stringify(last.bundle.records[0].data));
 assert.equal(redis('GET',budgetKey),before);assert.equal(redis('TTL',receiptKey(last)),-1);
 redis('SET',profileKey,'x'.repeat(limits.snapshotBytes+1));
 assert.equal((await call({action:'migration-recovery',...last})).statusCode,200,'later oversized cloud state cannot hide a committed receipt');
 assert.equal((await claim(last,'stale')).body.status,'replay');
 console.log(`Storage amplification stopped after ${activated} imports at ${before} charged bytes`);
});

test('receipt/snapshot bounds and concurrent budget updates fail before any partial commit',async()=>{
 const p=payload(file());
 // Existing ordinary-writer data counts toward recovery even when untouched.
 redis('SET',profileKey,JSON.stringify({revision:1,profile:{legacy:'x'.repeat(limits.receiptBytes)}}));
 assert.equal((await call({action:'migration-preview',...p})).body.error,'migration_storage_limit');
 assert.equal(redis('GET',budgetKey),null);assert.equal(redis('GET',receiptKey(p)),null);
 redis('SET',profileKey,'x'.repeat(limits.snapshotBytes+1));
 assert.equal((await call({action:'migration-preview',...p})).body.error,'migration_storage_limit');
 redis('DEL',profileKey);
 const token=await prepare(p),original=fetch;
 globalThis.fetch=async(url,options)=>{const args=JSON.parse(options.body);if(args[0]==='EVAL'&&args[2]===11)redis('SET',budgetKey,String(limits.accountBytes));return original(url,options);};
 assert.equal((await claim(p,token)).body.error,'migration_conflict');assert.equal(redis('GET',settings),null);assert.equal(redis('GET',receiptKey(p)),null);
 assert.equal(redis('GET',`play:migration-count:v1:${u}`),null);assert.equal(redis('GET',budgetKey),String(limits.accountBytes));
});

test('migration rate limit and exhausted command deadline fail closed without committing',async()=>{
 const p=payload(file());redis('SET',`play:limit:migration-user:${hash(u)}`,'30');
 assert.equal((await call({action:'migration-preview',...p})).statusCode,429);unchanged();
 assert.equal((await call({action:'read',scope:'settings'})).statusCode,200,'ordinary sync has a separate bucket');
 await assert.rejects(migrationActivation({u,action:'migration-preview',...p},{},[],Date.now()+1000),/store_unavailable/);unchanged();
});

test('localhost HTTP bounds multi-megabyte input and rejects storage amplification',async()=>{
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;req.body=raw;res.status=n=>{res.statusCode=n;return res;};res.json=v=>res.end(JSON.stringify(v));await profile(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const send=body=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,method:'POST',headers:{'Content-Type':'application/json',...sessionHeaders(typeof body==='string'?{u,auth}:{u,auth,...body})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(typeof body==='string'?body:JSON.stringify({u,auth,...body}));});
 try {
   const small=JSON.stringify({u,auth,action:'migration-preview',...payload(file())});
   const padded=small+' '.repeat(limits.requestBytes-Buffer.byteLength(small));
   assert.equal((await send(padded)).status,200);
   assert.equal((await send(padded+' ')).status,413,'raw bytes count even when normalized JSON is tiny');
   const pgn=shuffle(8200),match=matchRecord(pgn);
   const attack=payload(file(Array.from({length:18},(_,i)=>({...match,id:`${match.id}:${String(i).padStart(64,'0')}`}))));
   for(const action of ['migration-preview','migration-activate','migration-recovery']){
     const start=performance.now();assert.equal((await send({action,...attack})).status,413);assert.ok(performance.now()-start<3000);
     assert.equal((await send({action,...payload(file([matchRecord(shuffle(1000))]))})).status,400);
     assert.equal((await send({action,...payload(file([preference('chessLearningGoal','x'.repeat(1000000))]))})).status,413);
   }
   unchanged();
 } finally {await new Promise(resolve=>server.close(resolve));}
});
