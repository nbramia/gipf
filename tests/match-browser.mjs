// Synthetic browser acceptance against tests/serve-public-security.mjs (PR5 Redis).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import ChessBoard from '../src/games/chess/ChessBoard.js';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
import ZertzBoard from '../src/games/zertz/ZertzBoard.js';
import CatanBoard from '../src/games/catan/CatanBoard.js';
import { deriveCredentials } from '../src/account.js';
const origin = 'http://127.0.0.1:3189';
const boards = { chess: new ChessBoard(), yinsh: new YinshBoard(), zertz: new ZertzBoard(), catan: new CatanBoard({ seed: 1234 }) };
boards.chess.move('e2','e4'); boards.chess.move('e7','e5');
boards.yinsh.handleClick(0,0);
boards.zertz.selectMarbleColor('white'); boards.zertz.placeMarble(0,0);
boards.catan.applyMove(boards.catan.getLegalMoves()[0]);
// This named disposable fixture contains synthetic data only.
execFileSync('docker',['exec','gipf-pr5-synthetic-redis','redis-cli','FLUSHDB']);
const browser = await chromium.launch({ headless: true });
const contexts = [];
const errors = [];
async function device() {
  const context = await browser.newContext(); contexts.push(context);
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/gipf/`);
  return page;
}
const getSnapshot = (page, game) => page.evaluate(g => JSON.parse(localStorage.getItem(`${g}Match:v1`)), game);
try {
  for (const [game, board] of Object.entries(boards)) {
    const { encodeBoard } = await import(`../src/games/${game}/matchSnapshot.js`);
    const ui = game === 'chess' ? { humanColor:'w',orientation:'white',rated:false,timeControl:'off' } :
      game === 'catan' ? { showModal:true,gameConfig:{rulesetId:board.rulesetId,playerCount:board.playerCount,scenarioId:board.scenarioId} } :
      { showModal:false,twoPlayerMode:true,humanPlayer:1,difficulty:'advanced' };
    const snapshot = { v:1,game,id:`synthetic-${game}`,updatedAt:1,state:encodeBoard(board),ui };
    const a = await device();
    await a.evaluate(({game,snapshot}) => {
      localStorage.setItem(`${game}Match:v1`,JSON.stringify(snapshot));
      if(game==='chess') localStorage.setItem('chessGameLog',JSON.stringify([{playedAt:1,result:'win',color:'w',rated:false,opponentKey:'synthetic',accuracy:90,counts:{blunder:0,mistake:1,inaccuracy:2},opening:null,eco:null,leftBookAtPly:null,moves:20}]));
    }, {game,snapshot});
    await a.goto(`${origin}/gipf/${game}`);
    await a.locator(`.game-${game}`).waitFor();
    await a.reload(); await a.locator(`.game-${game}`).waitFor();
    assert.deepEqual((await getSnapshot(a,game)).state,JSON.parse(JSON.stringify(snapshot.state)));
    console.log(`PASS ${game}: guest reload retains canonical mid-turn state`);
    const u = String(Object.keys(boards).indexOf(game)+1).repeat(64), auth = '9'.repeat(64);
    const created = await a.request.post(`${origin}/gipf/api/chessAccount`,{data:{action:'create',u,auth,enc:null}});
    assert.ok([200,409].includes(created.status()));
    const session = {v:1,username:`Synthetic ${game}`,usernameId:u,authToken:auth,aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:'8'.repeat(64)};
    await a.evaluate(s => localStorage.setItem('gipfAccount',JSON.stringify(s)),session);
    await a.reload(); await a.locator(`.game-${game}`).waitFor();
    await a.getByText('Saved to your account.',{exact:true}).waitFor({timeout:20000});
    if(game==='chess') {
      const expectedLog=await a.evaluate(()=>localStorage.getItem('chessGameLog'));
      assert.ok(expectedLog);
      let synced=false;
      for(let attempt=0;attempt<20;attempt++) {
        const response=await a.request.post(`${origin}/gipf/api/chessProfile`,{data:{u,auth,scope:'settings',action:'read'}});
        const data=await response.json();
        if(data.profile?.preferences?.chessGameLog===expectedLog) { synced=true; break; }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      assert.ok(synced,'Chess statistics must be acknowledged before opening another device');
    }
    const b = await device();
    await b.evaluate(s => localStorage.setItem('gipfAccount',JSON.stringify(s)),session);
    await b.goto(`${origin}/gipf/${game}`); await b.locator(`.game-${game}`).waitFor();
    assert.deepEqual((await getSnapshot(b,game)).state,(await getSnapshot(a,game)).state);
    console.log(`PASS ${game}: second authenticated browser resumes same match`);
    if(game==='chess') {
      assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem('chessGameLog')).length),1);
      await b.reload(); await b.locator('.game-chess').waitFor();
      assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem('chessGameLog')).length),1);
      console.log('PASS chess: second-device statistics retain one log entry across repeated reloads');
    }
    await a.context().setOffline(true);
    const pending = await getSnapshot(a,game); pending.id=`offline-${game}`;
    await a.evaluate(({game,pending})=> { localStorage.setItem(`${game}Match:v1`,JSON.stringify(pending)); window.dispatchEvent(new StorageEvent('storage',{key:`${game}Match:v1`})); },{game,pending});
    await a.getByText('Use other tab match',{exact:true}).click();
    await a.locator(`.game-${game}`).waitFor();
    assert.equal((await getSnapshot(a,game)).id,`offline-${game}`);
    await a.context().setOffline(false);
    await a.getByText('Saved to your account.',{exact:true}).waitFor({timeout:20000});
    await b.getByText('Use cloud match',{exact:true}).waitFor({timeout:20000});
    await b.getByText('Use cloud match',{exact:true}).click();
    await b.locator(`.game-${game}`).waitFor();
    assert.equal((await getSnapshot(b,game)).id,`offline-${game}`);
    console.log(`PASS ${game}: offline pending match drains under its original account`);
    const competing = await getSnapshot(b,game); competing.id = `competing-${game}`;
    await b.evaluate(({game,competing}) => localStorage.setItem(`${game}Match:v1`,JSON.stringify(competing)),{game,competing});
    await b.reload(); await b.locator(`.game-${game}`).waitFor();
    await b.getByText('Saved to your account.',{exact:true}).waitFor({timeout:20000});
    await a.getByText('Keep this match',{exact:true}).waitFor({timeout:20000});
    await a.getByText('Use cloud match',{exact:true}).click();
    await a.locator(`.game-${game}`).waitFor();
    assert.equal((await getSnapshot(a,game)).id,`competing-${game}`);
    const recovery = await a.evaluate(g => JSON.parse(localStorage.getItem(`${g}MatchRecovery:v1`)),game);
    assert.ok(recovery.alternatives.some(x=>x.id===`offline-${game}`));
    console.log(`PASS ${game}: concurrent cloud change prompts and preserves both choices`);
    await a.context().close(); await b.context().close();
  }
  // Unsupported snapshots are preserved until an explicit recovery action.
  const invalid = await device();
  await invalid.evaluate(() => localStorage.setItem('yinshMatch:v1','{"v":99,"future":true}'));
  await invalid.goto(`${origin}/gipf/yinsh`);
  await invalid.getByText('Keep backup and start new game',{exact:true}).waitFor();
  assert.equal(await invalid.evaluate(()=>localStorage.getItem('yinshMatch:v1')),'{"v":99,"future":true}');
  await invalid.getByText('Keep backup and start new game',{exact:true}).click();
  await invalid.locator('.game-yinsh').waitFor();
  assert.ok(await invalid.evaluate(()=>localStorage.getItem('yinshMatchRecovery:v1').includes('future')));
  console.log('PASS malformed/future snapshot: explicit reset retains source backup');
  await invalid.context().close();

  const quota = await device();
  await quota.context().addInitScript(() => {
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value) { if(key==='zertzMatch:v1') throw new DOMException('Synthetic quota','QuotaExceededError'); return original.call(this,key,value); };
  });
  await quota.goto(`${origin}/gipf/zertz`);
  await quota.getByText('Save failed on this device. Keep this page open and free storage before retrying.',{exact:true}).waitFor();
  await quota.locator('.game-zertz').waitFor();
  console.log('PASS quota failure: visible error and local play stays mounted');
  await quota.context().close();

  // Two tabs on one device: a session change invalidates the old game before
  // any delayed callback can treat the replacement identity as its owner.
  const tabs = await device();
  await tabs.goto(`${origin}/gipf/yinsh`); await tabs.locator('.game-yinsh').waitFor();
  const secondTab = await tabs.context().newPage();
  await secondTab.goto(`${origin}/gipf/`);
  await secondTab.evaluate(() => {
    localStorage.setItem('gipf:account-transition',JSON.stringify({id:'synthetic-switch',until:Date.now()+60000}));
  });
  await tabs.getByText('Account changed. Reload to continue safely.',{exact:true}).waitFor();
  assert.equal(await tabs.locator('.game-yinsh').count(),0);
  console.log('PASS shared-device transition marker pauses the other tab before identity replacement');
  await tabs.context().close();

  // Exercise real account save/clear functions through the UI, across two tabs.
  const shared = await device();
  const pass = 'synthetic-password-for-browser';
  const ownerA = await deriveCredentials('synthetic-shared-a',pass);
  const ownerB = await deriveCredentials('synthetic-shared-b',pass);
  for (const owner of [ownerA,ownerB]) {
    const response=await shared.request.post(`${origin}/gipf/api/chessAccount`,{data:{action:'create',u:owner.usernameId,auth:owner.authToken,enc:null}});
    assert.equal(response.status(),200);
  }
  await shared.evaluate(owner=>localStorage.setItem('gipfAccount',JSON.stringify({v:1,...owner})),ownerA);
  await shared.goto(`${origin}/gipf/yinsh`); await shared.locator('.game-yinsh').waitFor();
  await shared.getByText('Saved to your account.',{exact:true}).waitFor({timeout:20000});
  const originalId=(await getSnapshot(shared,'yinsh')).id;
  const login=await shared.context().newPage(); await login.goto(`${origin}/gipf/`);
  await login.getByRole('button',{name:'Sign out',exact:true}).click();
  await login.getByRole('button',{name:'Sign out',exact:true}).click();
  await login.getByText('Sign in / Create account',{exact:true}).waitFor();
  await shared.waitForFunction(id=>!localStorage.getItem('gipfAccount') && JSON.parse(localStorage.getItem('yinshMatch:v1')||'null')?.id!==id,originalId);
  assert.ok(await login.evaluate(id=>localStorage.getItem(`gipf:recovery:${id}`),ownerA.usernameId));
  await login.getByText('Sign in / Create account',{exact:true}).click();
  await login.getByPlaceholder('Username',{exact:true}).fill(ownerB.username);
  await login.getByPlaceholder('Password',{exact:true}).fill(pass);
  await login.getByRole('button',{name:'Sign in',exact:true}).click();
  await login.waitForFunction(id=>JSON.parse(localStorage.getItem('gipfAccount')||'null')?.usernameId===id,ownerB.usernameId);
  await shared.waitForFunction(id=>JSON.parse(localStorage.getItem('gipfAccount')||'null')?.usernameId===id,ownerB.usernameId);
  assert.notEqual((await getSnapshot(shared,'yinsh'))?.id,originalId);
  console.log('PASS real A logout/B login across tabs: outgoing match sealed, no pending payload imported into B');
  await shared.context().close();

  assert.deepEqual(errors, []);
  console.log('PASS no browser page errors; all fixtures synthetic and external requests blocked');
} finally { await browser.close(); }
