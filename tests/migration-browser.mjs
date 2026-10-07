// All requests are intercepted BEFORE navigation; no production/provider traffic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const build = path.resolve(process.env.MIGRATION_BUILD || 'build');
const origins = ['https://old-apex.example.test','https://old-www.example.test','https://old-alias.example.test','https://destination.example.test'];
const browser = await chromium.launch({headless:true});
const contexts = [];
const errors = [], denied = [], apiRequests = [];
async function device(origin) {
  const context = await browser.newContext({serviceWorkers:'block',acceptDownloads:true}); contexts.push(context);
  await context.route('**/*',async route => {
    const req = route.request(), url = new URL(req.url());
    if (!origins.includes(url.origin)) { denied.push(url.origin); return route.abort(); }
    if (url.pathname.includes('/api/')) { apiRequests.push(url.pathname); return route.abort(); }
    if (url.pathname === '/migration' || url.pathname === '/migration/') {
      return route.fulfill({contentType:'text/html',body:await readFile(path.join(build,'index.html'))});
    }
    const relative = url.pathname.slice(1);
    if (!/^(static\/|favicon\.ico$|manifest\.json$)/.test(relative) || relative.includes('..')) return route.abort();
    try {
      const contentType = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      await route.fulfill({contentType,body:await readFile(path.join(build,relative))});
    } catch (_) { await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(`${origin}/migration`);
  return page;
}
try {
  let exported;
  for (let i=0;i<3;i++) {
    const page = await device(origins[i]);
    await page.getByRole('heading',{name:'Move your Games progress'}).waitFor();
    await page.evaluate(index => {
      localStorage.setItem('chessDarkMode',index === 1 ? 'false' : 'true');
      localStorage.setItem('splendorDifficulty','strong');
      localStorage.setItem('playApiKey','SYNTHETIC_SECRET_DO_NOT_EXPORT');
      localStorage.setItem('chessLichessToken','SYNTHETIC_LICHESS_DO_NOT_EXPORT');
      localStorage.setItem('chessGameState','{"v":1,"pgn":""}');
    },i);
    await page.getByRole('button',{name:'Prepare export'}).focus();
    await page.keyboard.press('Enter');
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'Download export',exact:true}).click();
    const file = await download;
    const raw = await readFile(await file.path(),'utf8');
    const bundle = JSON.parse(raw);
    assert.equal(bundle.sourceOrigin,origins[i]);
    assert.equal(bundle.records.length,3);
    assert.ok(!raw.includes('SYNTHETIC_SECRET') && !raw.includes('SYNTHETIC_LICHESS'));
    assert.equal(bundle.records.find(r => r.id === 'chessDarkMode').data,i===1?'false':'true');
    if (!i) exported = raw;
    console.log(`PASS synthetic ${['old apex','old www','old alias'][i]} /migration keyboard export and secret exclusion`);
  }
  const destination = await device(origins[3]);
  await destination.evaluate(() => localStorage.setItem('chessDarkMode','false'));
  const before = await destination.evaluate(() => localStorage.getItem('chessDarkMode'));
  const upload = async raw => {
    await destination.getByLabel('Migration file').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  };
  await upload(exported);
  await destination.getByText('different',{exact:true}).waitFor();
  const retain = destination.getByRole('button',{name:'Retain imported file separately'});
  assert.equal(await retain.isDisabled(),true);
  await destination.getByText('Guest privacy warning:',{exact:true}).waitFor();
  const checkbox = destination.getByLabel(/I have selected the intended/);
  await checkbox.focus(); await destination.keyboard.press('Space');
  await retain.focus(); await destination.keyboard.press('Enter');
  await destination.getByText(/File retained separately/).waitFor();
  assert.equal(await destination.evaluate(() => localStorage.getItem('chessDarkMode')),before);
  await destination.reload();
  await destination.getByRole('button',{name:'Show retained files'}).click();
  const download = destination.waitForEvent('download');
  await destination.getByRole('button',{name:'Download retained file 1'}).click();
  assert.deepEqual(JSON.parse(await readFile(await (await download).path(),'utf8')),JSON.parse(exported));
  await upload(exported); await checkbox.check(); await retain.click();
  await destination.getByText(/identical file is already retained/).waitFor();
  const bad = JSON.parse(exported); bad.records[0].password = 'synthetic';
  await upload(JSON.stringify(bad)); await destination.getByRole('alert').waitFor();
  assert.equal(await destination.evaluate(() => JSON.parse(localStorage.getItem('gamesMigration:v1:guest')).length),1);
  const brokenStage = await destination.evaluate(() => {
    const key = 'gamesMigration:v1:guest';
    const raw = localStorage.getItem(key).slice(0,-1) + ', {"future":9}]';
    localStorage.setItem(key,raw);
    localStorage.setItem('play:recovery:hidden-other-identity','synthetic-sealed');
    return raw;
  });
  await destination.getByRole('button',{name:'Show retained files'}).click();
  await destination.getByText(/1 retained entries cannot be validated/).waitFor();
  await destination.getByRole('button',{name:'Download retained file 1'}).waitFor();
  const rawButton = destination.getByRole('button',{name:'Download raw stage recovery'});
  assert.equal(await rawButton.isDisabled(),true);
  await destination.getByLabel(/I understand raw recovery/).check();
  const rawDownload = destination.waitForEvent('download'); await rawButton.click();
  assert.equal(await readFile(await (await rawDownload).path(),'utf8'),brokenStage);
  assert.equal(await destination.getByLabel(/I understand raw recovery/).isChecked(),false);
  assert.equal(await rawButton.isDisabled(),true);
  await destination.getByRole('button',{name:'Prepare export'}).click();
  await destination.getByText(/Other account recovery exists/).waitFor();
  assert.equal(await destination.getByText(/hidden-other-identity/).count(),0);
  console.log('PASS guest privacy consent, per-entry recovery isolation, explicit raw backup with consent reset and generic excluded-recovery warning');
  // Records whose UTF-8 total exceeds one 5 MiB file are split, never dropped.
  await destination.evaluate(() => {
    localStorage.setItem('chessLearningGoal','\u754c'.repeat(1000000));
    localStorage.setItem('chessRepertoire',JSON.stringify({version:1,white:['\u754c'.repeat(800000)],black:[]}));
  });
  await destination.getByRole('button',{name:'Prepare export'}).click();
  await destination.getByText(/Each file alone is partial/).waitFor();
  const parts = [];
  for (const n of [1,2]) {
    const part = destination.waitForEvent('download');
    await destination.getByRole('button',{name:`Download file ${n} of 2`}).click();
    parts.push(await readFile(await (await part).path(),'utf8'));
  }
  await destination.getByText(/2 of 2 downloads started/).waitFor();
  const partBundles = parts.map(p => JSON.parse(p));
  assert.ok(parts.every(p => Buffer.byteLength(p) <= 5 * 1024 * 1024));
  assert.notEqual(partBundles[0].exportId,partBundles[1].exportId);
  const ids = partBundles.flatMap(b => b.records.map(r => r.id));
  assert.ok(ids.includes('chessLearningGoal') && ids.includes('chessRepertoire'));
  assert.equal(await destination.evaluate(() => localStorage.getItem('chessLearningGoal').length),1000000);
  await destination.evaluate(() => { localStorage.removeItem('chessLearningGoal'); localStorage.removeItem('chessRepertoire'); });
  console.log('PASS oversized progress splits into independent downloadable files with sources unchanged');
  for (const width of [1280,480,320]) {
    await destination.setViewportSize({width,height:900});
    if (await destination.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      console.log(await destination.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth).map(e => [e.tagName,e.className,e.getBoundingClientRect().width,e.getBoundingClientRect().right])));
    }
    assert.ok(await destination.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`no overflow at ${width}px`);
  }
  console.log('PASS destination conflict preview, keyboard opt-in, reload recovery, replay, invalid file and mobile layout');
  // A signed-in device as /login leaves it: a v3 session and its seal key in IndexedDB.
  const syntheticSession = n => ({v:3,username:`Synthetic ${n}`,usernameId:String(n).repeat(64),sid:String(n+1).repeat(32)});
  const signIn = n => destination.evaluate(async ({session,sealKey}) => {
    const key = await crypto.subtle.importKey('raw',Uint8Array.from(atob(sealKey),c => c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);
    await new Promise((resolve,reject) => {
      const open = indexedDB.open('play-account',1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const tx = open.result.transaction('keys','readwrite'); tx.objectStore('keys').put(key,session.usernameId); tx.oncomplete = () => { open.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    });
    localStorage.setItem('playAccount',JSON.stringify(session));
  },{session:syntheticSession(n),sealKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='});
  await signIn(1);
  await destination.reload();
  await upload(exported); await checkbox.check(); await retain.click();
  await destination.getByText(/File retained separately/).waitFor();
  const ciphertext = await destination.evaluate(id => localStorage.getItem(`gamesMigration:v1:${id}`),syntheticSession(1).usernameId);
  assert.ok(ciphertext && !ciphertext.includes('ramia-migration') && !ciphertext.includes('chessDarkMode'));
  await destination.reload(); await destination.getByRole('button',{name:'Show retained files'}).click();
  await destination.getByRole('button',{name:'Download retained file 1'}).waitFor();
  await signIn(5);
  await destination.reload(); await destination.getByRole('button',{name:'Show retained files'}).click();
  await destination.getByText('No retained files for this identity.').waitFor();
  assert.equal(await destination.getByRole('button',{name:'Download retained file 1'}).count(),0);
  console.log('PASS encrypted account staging survives reload and is absent for another identity; no cloud sync mounted');
  assert.deepEqual(apiRequests,[]); assert.deepEqual(errors,[]);
  console.log(`PASS zero API requests or page errors; ${denied.length} external asset requests denied before network`);
} finally {
  await Promise.all(contexts.map(c => c.close())); await browser.close();
}
