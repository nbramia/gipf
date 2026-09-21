import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRequest, authenticate } from '../server/publicSecurity.js';

const response = () => ({ statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; }, json(v) { this.body=v; return this; }, end() {} });
const req = (body={}) => ({method:'POST', headers:{}, socket:{remoteAddress:'192.0.2.1'}, body});
process.env.KV_REST_API_URL='https://synthetic.invalid';
process.env.KV_REST_API_TOKEN='synthetic';
test('durable limits work across separately imported handler instances', async () => {
  const counts=new Map();
  globalThis.fetch=async (_url, options) => {
    const c=JSON.parse(options.body);
    assert.equal(c[0], 'EVAL');
    const key=c[3]; counts.set(key,(counts.get(key)||0)+1);
    return {ok:true,json:async()=>({result:counts.get(key)})};
  };
  const second=await import('../server/publicSecurity.js?instance=2');
  for(let i=0;i<3;i++) assert.equal(await guardRequest(req(),response(),{bucket:'test',limit:3}),true);
  const res=response();
  assert.equal(await second.guardRequest(req(),res,{bucket:'test',limit:3}),false);
  assert.equal(res.statusCode,429);
});
test('oversized and malformed input fails before storage', async()=>{
  globalThis.fetch=()=>{throw new Error('must not fetch');};
  for(const [body,status] of [['x'.repeat(100),413],['{',400]]) {
    const res=response(); await guardRequest(req(body),res,{maxBytes:50}); assert.equal(res.statusCode,status);
  }
});
test('public ID cannot authenticate and wrong password is denied', async()=>{
  const res=response(); assert.equal(await authenticate({u:'a'.repeat(64)},res),null); assert.equal(res.statusCode,401);
  globalThis.fetch=async()=>({ok:true,json:async()=>({result:JSON.stringify({authHash:'c'.repeat(64)})})});
  const denied=response(); assert.equal(await authenticate({u:'a'.repeat(64),auth:'b'.repeat(64)},denied),null); assert.equal(denied.statusCode,401);
});
test('storage failures fail closed and redact detail', async()=>{
  globalThis.fetch=async()=>{throw new Error('synthetic-private-value');};
  const res=response(); assert.equal(await guardRequest(req(),res),false); assert.equal(res.statusCode,503);
  assert.ok(!JSON.stringify(res).includes('synthetic-private-value'));
});
test('app and Chess account copies remain identical', async()=>{
  const { readFile }=await import('node:fs/promises');
  assert.equal(await readFile(new URL('../src/account.js',import.meta.url),'utf8'),await readFile(new URL('../src/games/chess/engine/account.js',import.meta.url),'utf8'));
});
