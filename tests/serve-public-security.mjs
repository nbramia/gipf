// Local-only integration fixture: built browser app + real handlers + disposable Redis.
// Run with the container documented in docs/public-accounts.md. No provider calls.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import rating from '../api/chessRating.js';
import zertz from '../api/zertzAiMove.js';
import testAI from '../api/testAI.js';
import chessCoach from '../api/chessCoach.js';
import catanRules from '../api/catanRules.js';
import splendorRules from '../api/splendorRules.js';
import diplomacyAgent from '../api/diplomacyAgent.js';
process.env.KV_REST_API_URL='https://synthetic.invalid';
process.env.KV_REST_API_TOKEN='synthetic';
process.env.GIPF_LEGACY_CLAIM_FROM=new Date(Date.now()-60000).toISOString();
process.env.GIPF_LEGACY_CLAIM_UNTIL=new Date(Date.now()+86400000).toISOString();
const redisContainer = process.env.GIPF_SYNTHETIC_REDIS || 'gipf-pr4-synthetic-redis';
if (!/^gipf-pr[45]-synthetic-redis$/.test(redisContainer)) throw new Error('Synthetic containers only');
const port = Number(process.env.GIPF_TEST_PORT || 3187);
const handlers={testAI,chessAccount:account,chessProfile:profile,chessRating:rating,zertzAiMove:zertz,chessCoach,catanRules,splendorRules,diplomacyAgent};
globalThis.fetch=async (url,options)=>{
  if(url!=='https://synthetic.invalid') return {ok:false,status:401,json:async()=>({error:{message:'synthetic provider rejection'}})};
  const args=JSON.parse(options.body).map(String);
  const result=JSON.parse(execFileSync('docker',['exec',redisContainer,'redis-cli','--json',...args],{encoding:'utf8'}));
  return {ok:true,json:async()=>({result})};
};
const root=resolve('build');
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const name=pathname.match(/^\/gipf\/api\/(\w+)$/)?.[1];
  if(name) {
    if(!handlers[name]) {res.writeHead(404);res.end();return;}
    let body='';
    for await(const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>310000){res.writeHead(413);res.end();return;}}
    req.body=body||'{}';
    res.status=n=>{res.statusCode=n;return res;};
    res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};
    await handlers[name](req,res);return;
  }
  let path=resolve(root, '.'+pathname.replace(/^\/gipf/,''));
  if(!path.startsWith(root+'/'))path=resolve(root,'index.html');
  try {
    const data=await readFile(path);
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(data);
  } catch(_) {res.setHeader('Content-Type','text/html');res.end(await readFile(resolve(root,'index.html')));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic fixture ready at http://127.0.0.1:${port}/gipf`));
