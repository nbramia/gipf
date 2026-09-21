// Real Redis Lua + actual HTTP handler, strictly synthetic container and fetch.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
import { canonical } from '../src/migrationSchema.js';
const redis = (...args) => JSON.parse(execFileSync('docker',['exec','-i','gipf-migration-activation-synthetic-redis','redis-cli','--json'],{encoding:'utf8',input:args.map(v=>JSON.stringify(String(v))).join(' ')+'\n'}));
const u='a'.repeat(64), other='c'.repeat(64),auth='b'.repeat(64);
const settings=`gipf:settings:v2:${u}`, profileKey=`gipf:profile:v2:${u}`;
const preference=(id,data)=>({kind:'preference',id,schemaVersion:1,revision:hash(canonical(data)),data});
const file=(records=[preference('chessDarkMode','true'),preference('chessRating','1500'),preference('splendorDifficulty','strong')])=>({format:'ramia-migration',version:1,app:'games',exportId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',exportedAt:'2026-09-21T00:00:00.000Z',sourceOrigin:'https://synthetic.example.test',records});
const payload=bundle=>({bundle,selected:bundle.records.map(r=>`${r.kind}/${r.id}`)});
async function call(body,handler=profile) {
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 await handler({method:'POST',headers:{},socket:{remoteAddress:'192.0.2.88'},body:{u,auth,...body}},res); return res;
}
const prepare=async p=>(await call({action:'migration-preview',...p})).body.token;
const claim=(p,token)=>call({action:'migration-activate',...p,token});
beforeEach(()=>{
 redis('FLUSHDB');process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://synthetic.invalid');return {ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})};};
 for(const id of [u,other]) redis('SET',`chess:account:${id}`,JSON.stringify({authHash:hash(auth)}));
});
test('atomic activation updates existing writer domains, preserves old bytes, authenticates and replays durably',async()=>{
 const old=JSON.stringify({revision:3,profile:{preferences:{chessDarkMode:'false',chessGameLog:'[]'}}});redis('SET',settings,old);
 const p=payload(file()), token=await prepare(p);
 assert.equal((await call({action:'migration-activate',...p,token,auth:'f'.repeat(64)})).statusCode,401);
 assert.equal(redis('GET',settings),old);
 assert.equal((await claim(p,token)).body.status,'activated');
 assert.deepEqual(JSON.parse(redis('GET',settings)),{revision:4,profile:{preferences:{chessDarkMode:'true',chessGameLog:'[]'}}});
 assert.equal(JSON.parse(redis('GET',profileKey)).profile.rating.rating,1500);
 assert.equal(JSON.parse(redis('GET',`gipf:migration-extra:v1:${u}`)).profile.values.splendorDifficulty,'strong');
 const recovery=await call({action:'migration-recovery',...p});assert.equal(recovery.body.receipt.before[0],old);
 const before=redis('GET',settings);
 assert.equal((await claim(p,token)).body.status,'replay');assert.equal(redis('GET',settings),before);
 assert.equal((await call({action:'write',scope:'settings',revision:3,domains:{preferences:{}}})).statusCode,409);
 assert.equal((await call({action:'migration-preview',...p,u:other})).statusCode,409);
 assert.equal(redis('GET',`gipf:migration-count:v1:${u}`),'1');
});
test('stale preview and a same-revision write racing inside Lua cause no migration writes or ownership',async()=>{
 const p=payload(file()), token=await prepare(p), competing=JSON.stringify({revision:0,profile:{preferences:{chessDarkMode:'false'}}});
 const original=fetch;let raced=false;
 globalThis.fetch=async(url,options)=>{const args=JSON.parse(options.body);if(args[0]==='EVAL'&&args[2]===9){raced=true;redis('SET',settings,competing);}return original(url,options);};
 assert.equal((await claim(p,token)).statusCode,409);assert.ok(raced);assert.equal(redis('GET',settings),competing);
 assert.equal(redis('GET',profileKey),null);assert.equal(redis('GET',`gipf:migration-count:v1:${u}`),null);
 globalThis.fetch=original;assert.equal((await claim(p,token)).statusCode,409);
});
test('two independently imported handlers produce one owner and one increment',async()=>{
 const second=(await import('../api/chessProfile.js?migration-second')).default;
 const p=payload(file()), firstToken=await prepare(p), otherToken=(await call({action:'migration-preview',...p,u:other})).body.token;
 const results=await Promise.all([claim(p,firstToken),call({action:'migration-activate',...p,token:otherToken,u:other},second)]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 const owner=JSON.parse(redis('GET',`gipf:migration:v1:${hash(p.bundle.exportId)}`)).owner;
 assert.equal(redis('GET',`gipf:migration-count:v1:${owner}`),'1');
});
test('bad schema, digest, duplicate target, changed selection and lifetime bound fail closed',async()=>{
 const p=payload(file());p.bundle.records[0].revision='0'.repeat(64);
 assert.equal((await call({action:'migration-preview',...p})).statusCode,400);
 const good=payload(file());assert.equal((await call({action:'migration-preview',...good,selected:[...good.selected,good.selected[0]]})).statusCode,400);
 redis('SET',`gipf:migration-count:v1:${u}`,'50');assert.equal((await call({action:'migration-preview',...good})).statusCode,409);assert.equal(redis('GET',settings),null);
 redis('DEL',`gipf:migration-count:v1:${u}`);assert.equal((await claim(good,await prepare(good))).statusCode,200);
 assert.equal((await call({action:'migration-preview',...good,selected:[good.selected[0]]})).statusCode,409);
});
test('localhost HTTP performs preview, activation, read and rejects unauthenticated import',async()=>{
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;req.body=raw;res.status=n=>{res.statusCode=n;return res;};res.json=v=>res.end(JSON.stringify(v));await profile(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const send=body=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/gipf/api/chessProfile',method:'POST',headers:{'Content-Type':'application/json'}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.on('error',reject);req.end(JSON.stringify({u,auth,...body}));});
 try {const p=payload(file()),preview=await send({action:'migration-preview',...p});assert.equal(preview.status,200);assert.equal((await send({action:'migration-activate',...p,token:preview.body.token,auth:undefined})).status,401);assert.equal((await send({action:'migration-activate',...p,token:preview.body.token})).status,200);assert.equal((await send({action:'read',scope:'settings'})).body.profile.preferences.chessDarkMode,'true');}
 finally {await new Promise(resolve=>server.close(resolve));}
});
