// Real guest-import UI against the same dedicated synthetic PR5 browser fixture.
import assert from 'node:assert/strict';
import { deriveCredentials } from '../src/account.js';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
import { encodeBoard } from '../src/games/yinsh/matchSnapshot.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin='http://127.0.0.1:3189';
const password='synthetic-import-password';
const owner=await deriveCredentials(`synthetic-import-${Date.now()}`,password);
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext();
  await context.route('https://**/*',route=>route.abort());
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/gipf/`);
  const created=await page.request.post(`${origin}/gipf/api/chessAccount`,{data:{action:'create',u:owner.usernameId,auth:owner.authToken,enc:null}});
  assert.equal(created.status(),200);
  const guest={v:1,game:'yinsh',id:'synthetic-guest-import',updatedAt:1,state:encodeBoard(new YinshBoard()),ui:{humanPlayer:1,twoPlayerMode:true,showModal:true}};
  await page.evaluate(s=>localStorage.setItem('yinshMatch:v1',JSON.stringify(s)),guest);
  const signIn=async importGuest=> {
    const checkbox=page.getByRole('checkbox',{name:"Import this device's guest progress when signing in"});
    assert.equal(await checkbox.isChecked(),false);
    if(importGuest) await checkbox.check();
    await page.getByText('Sign in / Create account',{exact:true}).click();
    await page.getByPlaceholder('Username',{exact:true}).fill(owner.username);
    await page.getByPlaceholder('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem('gipfAccount')||'null')?.usernameId===id,owner.usernameId);
    await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  };
  const signOut=async()=> {
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByText('Sign in / Create account',{exact:true}).waitFor();
  };
  await signIn(false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('yinshMatch:v1')),null);
  await signOut();
  await signIn(true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('yinshMatch:v1')).id),'synthetic-guest-import');
  await page.evaluate(()=> {
    const snapshot=JSON.parse(localStorage.getItem('yinshMatch:v1'));
    snapshot.id='synthetic-account-edit';
    localStorage.setItem('yinshMatch:v1',JSON.stringify(snapshot));
  });
  await signOut();
  await signIn(true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('yinshMatch:v1')).id),'synthetic-account-edit');
  assert.deepEqual(errors,[]);
  console.log('PASS real guest import UI: unchecked default isolates guest, explicit choice imports, repeated import preserves account edits');
} finally { await browser.close(); }
