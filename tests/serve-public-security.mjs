// Local-only integration fixture: built browser app + real handlers + disposable Redis.
// Run with the container documented in docs/public-accounts.md. No provider calls.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { redisAsync } from './redis-fixture.mjs';
import aiMove from '../api/aiMove.js';
import account from '../api/chessAccount.js';
import profile from '../api/chessProfile.js';
import rating from '../api/chessRating.js';
import zertz from '../api/zertzAiMove.js';
import chessCoach from '../api/chessCoach.js';
import catanRules from '../api/catanRules.js';
import splendorRules from '../api/splendorRules.js';
import diplomacyAgent from '../api/diplomacyAgent.js';
import session from '../api/session.js';
import auth from '../api/auth.js';
import { useTestKeyCustody, seedSession } from './session-fixture.mjs';
import { safeReturn } from '../server/auth0.js';
useTestKeyCustody();
process.env.KV_REST_API_URL='https://synthetic.invalid';
process.env.KV_REST_API_TOKEN='synthetic';
process.env.GIPF_LEGACY_CLAIM_FROM=new Date(Date.now()-60000).toISOString();
process.env.GIPF_LEGACY_CLAIM_UNTIL=new Date(Date.now()+86400000).toISOString();
const handlers={session,auth,aiMove,chessAccount:account,chessProfile:profile,chessRating:rating,zertzAiMove:zertz,chessCoach,catanRules,splendorRules,diplomacyAgent};
globalThis.fetch=async (url,options)=>{
  if(url!=='https://synthetic.invalid') return {ok:false,status:401,json:async()=>({error:{message:'synthetic provider rejection'}})};
  const args=JSON.parse(options.body).map(String);
  const result=await redisAsync(...args);
  return {ok:true,json:async()=>({result})};
};
const root=resolve('build');
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/gipf/api/auth/login') {
    // Synthetic Auth0: sign in the identity named by the page's `fixture-identity` cookie
    // (optionally `label:dataId`) exactly as a successful callback would, then finish at
    // /login like the real flow. Auth0 itself is never contacted.
    const named=decodeURIComponent((req.headers.cookie||'').match(/(?:^|;\s*)fixture-identity=([^;]*)/)?.[1]||'synthetic-player');
    const [label,data]=named.split(':');
    const token=await seedSession(label,data||undefined);
    const returnTo=safeReturn(new URL(req.url,'http://localhost').searchParams.get('return'));
    res.writeHead(302,{'Set-Cookie':`__Host-games_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`,Location:`/gipf/login?signedin=1&return=${encodeURIComponent(returnTo)}`});
    res.end();return;
  }
  const authAction=pathname.match(/^\/gipf\/api\/auth\/(\w+)$/)?.[1];
  const name=authAction?'auth':pathname.match(/^\/gipf\/api\/(\w+)$/)?.[1];
  if(name) {
    if(!handlers[name]) {res.writeHead(404);res.end();return;}
    req.query={...Object.fromEntries(new URL(req.url,'http://localhost').searchParams),...(authAction?{action:authAction}:{})};
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
const port = Number(process.env.GIPF_TEST_PORT || 3187);
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic fixture ready at http://127.0.0.1:${port}/gipf`));
