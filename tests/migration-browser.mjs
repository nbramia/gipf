// All requests are intercepted BEFORE navigation; no production/provider traffic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import middleware from '../middleware.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const build = path.resolve(process.env.MIGRATION_BUILD || 'build');
const prefix = process.env.MIGRATION_PREFIX ?? '/gipf';
const origins = ['https://old-apex.example.test','https://old-www.example.test','https://old-alias.example.test','https://destination.example.test'];
const secret = 'synthetic-local-fixture-only';
process.env.SITE_PASSWORD = secret;
const cookie = createHash('sha256').update(`ramia-gate-v1:${secret}`).digest('hex');
const browser = await chromium.launch({headless:true});
const contexts = [];
const errors = [], denied = [], apiRequests = [];
async function device(origin, authorized = true) {
  const context = await browser.newContext({serviceWorkers:'block',acceptDownloads:true}); contexts.push(context);
  if (authorized) await context.addCookies([{name:'ramia_gate',value:cookie,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  await context.route('**/*',async route => {
    const req = route.request(), url = new URL(req.url());
    if (!origins.includes(url.origin)) { denied.push(url.origin); return route.abort(); }
    if (url.pathname.includes('/api/')) { apiRequests.push(url.pathname); return route.abort(); }
    const gate = await middleware(new Request(req.url(),{method:req.method(),headers:await req.allHeaders()}));
    if (gate) return route.fulfill({status:gate.status,headers:Object.fromEntries(gate.headers),body:await gate.text()});
    if (url.pathname === `${prefix}/migration` || url.pathname === `${prefix}/migration/`) {
      return route.fulfill({contentType:'text/html',body:await readFile(path.join(build,'index.html'))});
    }
    const relative = url.pathname.slice(prefix.length + 1);
    if (!url.pathname.startsWith(`${prefix}/`) || !/^(static\/|favicon\.ico$|manifest\.json$)/.test(relative) || relative.includes('..')) return route.abort();
    try {
      const contentType = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      await route.fulfill({contentType,body:await readFile(path.join(build,relative))});
    } catch (_) { await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(`${origin}${prefix}/migration`);
  return page;
}
try {
  const locked = await device(origins[0],false);
  assert.equal(await locked.locator('input[type=password]').count(),1);
  assert.equal(await locked.getByRole('heading',{name:'Move your Games progress'}).count(),0);
  console.log('PASS existing middleware blocks anonymous migration navigation');
  let exported;
  for (let i=0;i<3;i++) {
    const page = await device(origins[i]);
    await page.getByRole('heading',{name:'Move your Games progress'}).waitFor();
    await page.evaluate(index => {
      localStorage.setItem('chessDarkMode',index === 1 ? 'false' : 'true');
      localStorage.setItem('splendorDifficulty','strong');
      localStorage.setItem('gipfApiKey','SYNTHETIC_SECRET_DO_NOT_EXPORT');
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
    console.log(`PASS synthetic ${['old apex','old www','old alias'][i]} ${prefix}/migration keyboard export and secret exclusion`);
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
  const checkbox = destination.getByLabel(/I understand this only stages/);
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
    localStorage.setItem('gipf:recovery:hidden-other-identity','synthetic-sealed');
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
  await destination.getByRole('button',{name:'Prepare export'}).click();
  await destination.getByText(/Other account recovery exists/).waitFor();
  assert.equal(await destination.getByText(/hidden-other-identity/).count(),0);
  console.log('PASS guest privacy consent, per-entry recovery isolation, explicit raw backup and generic excluded-recovery warning');
  for (const width of [1280,480,320]) {
    await destination.setViewportSize({width,height:900});
    if (await destination.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      console.log(await destination.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth).map(e => [e.tagName,e.className,e.getBoundingClientRect().width,e.getBoundingClientRect().right])));
    }
    assert.ok(await destination.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`no overflow at ${width}px`);
  }
  console.log('PASS destination conflict preview, keyboard opt-in, reload recovery, replay, invalid file and mobile layout');
  const syntheticSession = n => ({v:1,username:`Synthetic ${n}`,usernameId:String(n).repeat(64),authToken:String(n+1).repeat(64),aesKey:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',profileId:String(n+2).repeat(64)});
  await destination.evaluate(s => localStorage.setItem('gipfAccount',JSON.stringify(s)),syntheticSession(1));
  await destination.reload();
  await upload(exported); await checkbox.check(); await retain.click();
  await destination.getByText(/File retained separately/).waitFor();
  const ciphertext = await destination.evaluate(id => localStorage.getItem(`gamesMigration:v1:${id}`),syntheticSession(1).usernameId);
  assert.ok(ciphertext && !ciphertext.includes('ramia-migration') && !ciphertext.includes('chessDarkMode'));
  await destination.reload(); await destination.getByRole('button',{name:'Show retained files'}).click();
  await destination.getByRole('button',{name:'Download retained file 1'}).waitFor();
  await destination.evaluate(s => localStorage.setItem('gipfAccount',JSON.stringify(s)),syntheticSession(5));
  await destination.reload(); await destination.getByRole('button',{name:'Show retained files'}).click();
  await destination.getByText('No retained files for this identity.').waitFor();
  assert.equal(await destination.getByRole('button',{name:'Download retained file 1'}).count(),0);
  console.log('PASS encrypted account staging survives reload and is absent for another identity; no cloud sync mounted');
  assert.deepEqual(apiRequests,[]); assert.deepEqual(errors,[]);
  console.log(`PASS zero API requests or page errors; ${denied.length} external asset requests denied before network`);
} finally {
  await Promise.all(contexts.map(c => c.close())); await browser.close();
}
