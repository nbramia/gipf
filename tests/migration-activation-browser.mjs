// Built UI -> actual handler -> isolated Redis. Deny all other traffic before navigation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import profile from '../api/chessProfile.js';
import { hash } from '../server/publicSecurity.js';
import { canonical } from '../src/migrationSchema.js';
import { fromLegacy } from '../src/games/chess/matchSnapshot.js';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const build=path.resolve(process.env.MIGRATION_BUILD || 'build'),prefix=process.env.MIGRATION_PREFIX ?? '/gipf';
const origin='https://activation.example.test';
const redis=(...args)=>JSON.parse(execFileSync('docker',['exec','-i','gipf-migration-activation-synthetic-redis','redis-cli','--json'],{encoding:'utf8',input:args.map(v=>JSON.stringify(String(v))).join(' ')+'\n'}));
process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://synthetic.invalid');return {ok:true,json:async()=>({result:redis(...JSON.parse(options.body))})};};
redis('FLUSHDB');
const session={v:1,username:'Synthetic',usernameId:'a'.repeat(64),authToken:'b'.repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:'c'.repeat(64)};
redis('SET',`chess:account:${session.usernameId}`,JSON.stringify({authHash:hash(session.authToken)}));
const record=(kind,id,data)=>({kind,id,schemaVersion:1,revision:hash(canonical(data)),data});
const match=fromLegacy({v:1,pgn:''});
const bundle={format:'ramia-migration',version:1,app:'games',exportId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',exportedAt:'2026-09-21T00:00:00.000Z',sourceOrigin:'https://source.example.test',records:[record('preference','chessDarkMode','true'),record('preference','chessRating','1600'),record('chess-log','chessGameLog',[]),record('chess-match',match.id,match),record('preference','splendorDifficulty','strong')]};
const browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
const errors=[];let pauseRead=false,releaseRead,readReached;let loseResponse=false;
try {
 await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname===`${prefix}/api/chessProfile`){
     const body=JSON.parse(req.postData());
     const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
     await profile({method:'POST',headers:{},socket:{remoteAddress:'192.0.2.89'},body},res);
     if(pauseRead&&body.action==='read'&&body.scope==='settings'){pauseRead=false;readReached();await new Promise(resolve=>{releaseRead=resolve;});}
     if(loseResponse&&body.action==='migration-activate'){loseResponse=false;return route.abort();}
     return route.fulfill({status:res.statusCode,contentType:'application/json',body:JSON.stringify(res.body)});
   }
   if(url.pathname.includes('/api/'))return route.abort();
   const relative=url.pathname.slice(prefix.length+1);
   if(url.pathname===`${prefix}/migration`||url.pathname===`${prefix}/splendor`)return route.fulfill({contentType:'text/html',body:await readFile(path.join(build,'index.html'))});
   if(!url.pathname.startsWith(`${prefix}/`)||!relative.startsWith('static/')||relative.includes('..'))return route.abort();
   try {return route.fulfill({contentType:relative.endsWith('.js')?'application/javascript':'text/css',body:await readFile(path.join(build,relative))});}catch(_){return route.abort();}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}${prefix}/migration`);
 await page.evaluate(s=>{localStorage.setItem('gipfAccount',JSON.stringify(s));localStorage.setItem('chessDarkMode','false');localStorage.setItem('gipfApiKey','SYNTHETIC_EXCLUDED');},session);await page.reload();
 // Hydration reads old cloud and pauses before the browser gets the response.
 redis('SET',`gipf:settings:v2:${session.usernameId}`,JSON.stringify({revision:2,profile:{preferences:{chessDarkMode:'false'}}}));
 const reached=new Promise(resolve=>{readReached=resolve;});pauseRead=true;
 const stale=await context.newPage();stale.on('pageerror',e=>errors.push(e.message));await stale.goto(`${origin}${prefix}/splendor`);await reached;
 await page.getByLabel('Migration file').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
 await page.getByRole('button',{name:'Preview account activation'}).click();await page.getByText(/Cloud conflicts:/).waitFor();
 assert.equal(await page.getByRole('button',{name:'Activate selected progress'}).isDisabled(),true);
 await page.getByLabel(/I have selected the intended/).check();loseResponse=true;
 await page.getByRole('button',{name:'Activate selected progress'}).click();await page.getByText(/Unable to finish/).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('chessDarkMode')),'false');
 assert.equal(JSON.parse(redis('GET',`gipf:settings:v2:${session.usernameId}`)).profile.preferences.chessDarkMode,'true');
 releaseRead();await stale.getByText(/Reload before playing/).waitFor();
 await page.reload();await page.getByRole('button',{name:'Resume pending activation'}).click();await page.getByText(/Activation resumed/).waitFor();
 const active=await page.evaluate(()=>({dark:localStorage.getItem('chessDarkMode'),rating:localStorage.getItem('chessRating'),match:JSON.parse(localStorage.getItem('chessMatch:v1')),log:localStorage.getItem('chessGameLog'),extra:localStorage.getItem('splendorDifficulty')}));
 assert.equal(active.dark,'true');assert.equal(active.rating,'1600');assert.equal(active.match.id,match.id);assert.equal(active.log,'[]');assert.equal(active.extra,'strong');
 console.log('PASS actual browser/HTTP/Redis activation, lost response, reload recovery, match/statistics and delayed second-tab settings hydration');
 await page.getByRole('button',{name:'Show retained files'}).click();await page.getByRole('button',{name:'Preview retained file 1'}).click();await page.getByRole('button',{name:'Preview account activation'}).click();await page.getByText(/Cloud conflicts:/).waitFor();await page.getByLabel(/I have selected the intended/).check();
 await page.getByRole('button',{name:'Activate selected progress'}).click();await page.getByText(/already activated/).waitFor();assert.equal(redis('GET',`gipf:migration-count:v1:${session.usernameId}`),'1');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download activation recovery'}).click();const saved=await download;const recovered=JSON.parse(await readFile(await saved.path(),'utf8'));assert.equal(recovered.before.chessDarkMode,'false');assert.equal(JSON.parse(recovered.cloud.before[0]).profile.preferences.chessDarkMode,'false');assert.ok(!JSON.stringify(recovered).includes('SYNTHETIC_EXCLUDED'));assert.ok(!JSON.stringify(recovered).includes(session.authToken));
 console.log('PASS durable replay, retained-file activation and authenticated before/after recovery without credentials');
 await page.evaluate(s=>localStorage.setItem('gipfAccount',JSON.stringify({...s,usernameId:'d'.repeat(64)})),session);await page.reload();await page.getByRole('button',{name:'Show retained files'}).click();await page.getByText('No retained files for this identity.').waitFor();
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS account isolation and zero page errors');
}finally{await context.close();await browser.close();}
