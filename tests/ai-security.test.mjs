import test from 'node:test';
import assert from 'node:assert/strict';
import chess from '../api/chessCoach.js';
import catan from '../api/catanRules.js';
import splendor from '../api/splendorRules.js';
import diplomacy from '../api/diplomacyAgent.js';
const handlers=[chess,catan,splendor,diplomacy];
const req=body=>({method:'POST',headers:{},socket:{remoteAddress:'192.0.2.2'},body});
const res=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
process.env.KV_REST_API_URL='https://synthetic.invalid';process.env.KV_REST_API_TOKEN='synthetic';
test('all model proxies reject oversized requests and never use an environment key',async()=>{
  process.env.ANTHROPIC_API_KEY='synthetic-maintainer-key';
  for(const handler of handlers) {
    globalThis.fetch=async url=>{assert.equal(url,'https://synthetic.invalid');return {ok:true,json:async()=>({result:1})};};
    const missing=res();await handler(req({messages:[{role:'user',content:'hi'}]}),missing);assert.equal(missing.statusCode,401);
    globalThis.fetch=()=>{throw new Error('must not call');};
    const large=res();await handler(req({apiKey:'x',context:'a'.repeat(33000)}),large);assert.equal(large.statusCode,413);
  }
});
test('provider errors cannot echo request secrets and upstream calls have abort deadlines',async()=>{
  for(const handler of handlers) {
    globalThis.fetch=async (url,opts)=>{
      assert.ok(opts.signal);
      return url==='https://synthetic.invalid' ? {ok:true,json:async()=>({result:1})} : {ok:false,status:401,json:async()=>({error:{message:'synthetic-private-key'}})};
    };
    const response=res();await handler(req({apiKey:'synthetic-private-key',fen:'synthetic-fen',messages:[{role:'user',content:'hi'}]}),response);
    assert.equal(response.statusCode,401);assert.ok(!JSON.stringify(response.body).includes('synthetic-private-key'));assert.equal(response.headers['Cache-Control'],'no-store');
  }
});
test('AI bucket is shared by different model handler instances',async()=>{
  let count=0;
  globalThis.fetch=async url=>{
    assert.equal(url,'https://synthetic.invalid');
    return {ok:true,json:async()=>({result:++count})};
  };
  for(let i=0;i<30;i++) {
    const response=res();await handlers[i%handlers.length](req({}),response);assert.equal(response.statusCode,401);
  }
  const second=(await import('../api/chessCoach.js?second-instance')).default;
  const denied=res();await second(req({}),denied);assert.equal(denied.statusCode,429);
});
test('threaded chess proxy reaches the bounded provider call with both browser tool schemas',async()=>{
  globalThis.fetch=async(url,options)=>{
    if(url==='https://synthetic.invalid')return{ok:true,json:async()=>({result:1})};
    const body=JSON.parse(options.body);
    assert.deepEqual(body.tools.map(tool=>tool.name),['analyze_position','query_openings']);
    assert.ok(options.signal);
    return{ok:true,json:async()=>({stop_reason:'end_turn',content:[]})};
  };
  const response=res();await chess(req({apiKey:'synthetic',mode:'thread',messages:[{role:'user',content:'synthetic'}],context:{}}),response);
  assert.equal(response.statusCode,200);
});
