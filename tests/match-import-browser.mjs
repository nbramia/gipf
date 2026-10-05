// Real guest-import UI against the same dedicated synthetic PR5 browser fixture
// (tests/serve-public-security.mjs, whose /api/auth/login is a synthetic Auth0 sign-in).
import assert from 'node:assert/strict';
import YinshBoard from '../src/games/yinsh/YinshBoard.js';
import { encodeBoard } from '../src/games/yinsh/matchSnapshot.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin='http://127.0.0.1:3189';
const owner={label:`synthetic-import-${Date.now()}`};
owner.name=`${owner.label}@synthetic.example`;
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext();
  await context.route('https://**/*',route=>route.abort());
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/gipf/`);
  // The identity the synthetic Auth0 sign-in signs in.
  await context.addCookies([{name:'fixture-identity',value:owner.label,url:origin}]);
  const guest={v:1,game:'yinsh',id:'synthetic-guest-import',updatedAt:1,state:encodeBoard(new YinshBoard()),ui:{humanPlayer:1,twoPlayerMode:true,showModal:true}};
  await page.evaluate(s=>localStorage.setItem('yinshMatch:v1',JSON.stringify(s)),guest);
  const signIn=async importGuest=> {
    await page.goto(`${origin}/gipf/login`);
    const checkbox=page.getByRole('checkbox',{name:"Import this device's guest progress when signing in"});
    assert.equal(await checkbox.isChecked(),false);
    if(importGuest) await checkbox.check();
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gipfAccount')||'null')?.v===3);
    await page.goto(`${origin}/gipf/login`);
    await page.getByText(`Signed in as ${owner.name}`).waitFor();
  };
  const signOut=async()=> {
    await page.goto(`${origin}/gipf/login`);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByText('Signed out of Games.').waitFor();
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
