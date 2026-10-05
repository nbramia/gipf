import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRequest, authenticate, verifyLegacyAccount, networkIdentity, hash, AUTH_FAILURES } from '../server/publicSecurity.js';

const response = () => ({ statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; }, json(v) { this.body=v; return this; }, end() {} });
const req = (body={}) => ({method:'POST', headers:{'content-type':'application/json'}, socket:{remoteAddress:'192.0.2.1'}, body});
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
test('only a session cookie authenticates: body credentials and public IDs are refused', async()=>{
  globalThis.fetch=()=>{throw new Error('must not fetch');};
  for(const body of [{u:'a'.repeat(64)},{u:'a'.repeat(64),auth:'b'.repeat(64)}]) {
    const res=response(); assert.equal(await authenticate(body,res,'192.0.2.1',req(body)),null); assert.equal(res.statusCode,401);
  }
});
test('the legacy-account verifier denies a public ID and a wrong password', async()=>{
  const res=response(); fakeStore(); assert.equal(await verifyLegacyAccount('a'.repeat(64),undefined,res,'192.0.2.1'),null); assert.equal(res.statusCode,401);
  fakeStore().set(`chess:account:${'a'.repeat(64)}`,JSON.stringify({authHash:'c'.repeat(64)}));
  const denied=response(); assert.equal(await verifyLegacyAccount('a'.repeat(64),'b'.repeat(64),denied,'192.0.2.1'),null); assert.equal(denied.statusCode,401);
});
test('storage failures fail closed and redact detail', async()=>{
  globalThis.fetch=async()=>{throw new Error('synthetic-private-value');};
  const res=response(); assert.equal(await guardRequest(req(),res),false); assert.equal(res.statusCode,503);
  assert.ok(!JSON.stringify(res).includes('synthetic-private-value'));
});
test('Chess uses the one app account module', async()=>{
  const app=await import('../src/account.js');
  const chess=await import('../src/games/chess/engine/account.js');
  for (const name of Object.keys(app)) assert.equal(chess[name],app[name],name);
});
// Minimal synthetic store for the commands these boundaries issue.
function fakeStore() {
  const data=new Map();
  globalThis.fetch=async (_url, options) => {
    const [cmd,...a]=JSON.parse(options.body);
    let result=null;
    if(cmd==='EVAL') { const key=a[2]; data.set(key,String(Number(data.get(key)||0)+1)); result=Number(data.get(key)); }
    else if(cmd==='MGET') result=a.map(k=>data.get(k)??null);
    else if(cmd==='GET') result=data.get(a[0])??null;
    else if(cmd==='EXISTS') result=data.has(a[0])?1:0;
    else if(cmd==='SET') { if(a[2]==='NX'&&data.has(a[0])) result=null; else { data.set(a[0],a[1]); result='OK'; } }
    return {ok:true,json:async()=>({result})};
  };
  return data;
}
test('IPv6 addresses are limited per /64, IPv4 per address', async()=>{
  assert.equal(networkIdentity('2001:db8:1:2::1'),networkIdentity('2001:0db8:1:2:ffff:0:0:9'));
  assert.notEqual(networkIdentity('2001:db8:1:2::1'),networkIdentity('2001:db8:1:3::1'));
  assert.equal(networkIdentity('::ffff:192.0.2.7'),'192.0.2.7');
  assert.notEqual(networkIdentity('192.0.2.7'),networkIdentity('192.0.2.8'));
  fakeStore();
  const second=await import('../server/publicSecurity.js?instance=v6');
  const v6=ip=>({method:'POST',headers:{'content-type':'application/json'},socket:{remoteAddress:ip},body:{}});
  for(let i=0;i<3;i++) assert.equal(await guardRequest(v6(`2001:db8:1:2::${i+1}`),response(),{bucket:'v6',limit:3}),true);
  const res=response();
  assert.equal(await second.guardRequest(v6('2001:db8:1:2:aaaa::9'),res,{bucket:'v6',limit:3}),false);
  assert.equal(res.statusCode,429);
});
test('failed verifications share one network budget, then even the right password is refused', async()=>{
  const data=fakeStore(); const u='a'.repeat(64), auth='b'.repeat(64);
  data.set(`chess:account:${u}`,JSON.stringify({authHash:hash(auth)}));
  for(let i=0;i<AUTH_FAILURES;i++) { const r=response(); assert.equal(await verifyLegacyAccount(u,'f'.repeat(64),r,'192.0.2.1'),null); assert.equal(r.statusCode,401); }
  const locked=response(); assert.equal(await verifyLegacyAccount(u,auth,locked,'192.0.2.1'),null); assert.equal(locked.statusCode,429);
  assert.ok(await verifyLegacyAccount(u,auth,response(),'192.0.2.2'));
});
test('username/password creation, sign-in and client-encrypted key writes are retired', async()=>{
  const data=fakeStore();
  const { default: account }=await import('../api/chessAccount.js');
  const enc={iv:'AAAAAAAAAAAAAAAA',ct:'AAAAAAAAAAAAAAAAAAAAAA=='};
  for(const action of ['create','login','setKey']) {
    const res=response(); await account(req({action,u:'e'.repeat(64),auth:'b'.repeat(64),enc}),res);
    assert.deepEqual([res.statusCode,res.body],[410,{error:'retired'}]);
  }
  assert.equal([...data.keys()].some(k=>k.startsWith('chess:account:')),false);
});
test('direct Chess match writes bound PGN before replay', async()=>{
  const { validMatch }=await import('../server/matchValidation.js');
  const { MIGRATION_LIMITS }=await import('../server/migrationActivation.js');
  const pgn=Array.from({length:4000},(_,i)=>`${i+1}. Nf3 Nf6 ${i+1}... Ng1 Ng8`).join(' ');
  const started=Date.now();
  assert.equal(validMatch('chess',{state:{pgn,initialFen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}}),false);
  assert.ok(Date.now()-started<50);
  assert.ok(Buffer.byteLength(pgn)>MIGRATION_LIMITS.pgnBytes);
});
