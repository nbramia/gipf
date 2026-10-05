// Execute with Playwright browser_run_code_unsafe filename against the local fixture.
async (page) => {
  const base = page.url().startsWith('http://127.0.0.1:') ? new URL(page.url()).origin + '/gipf' : 'http://127.0.0.1:3187/gipf';
  const suffix = Date.now();
  const a = `synthetic-a-${suffix}`, b = `synthetic-b-${suffix}`;
  const password = 'synthetic-fixture-password';
  const check = (value, label) => { if (!value) throw new Error(label); return value; };
  const settlePreferences = async (p, ready = p.getByText(/^Signed in as /)) => {
    // Mounting Chess initializes preferences; choose them explicitly if cloud differs.
    const choice = p.getByRole('button', { name: 'Keep this device', exact: true });
    await Promise.race([ready.waitFor(), choice.waitFor()]);
    if (await choice.isVisible()) await choice.click();
  };
  const signIn = async (p, name, create = false, importGuest = false) => {
    await p.getByRole('button', { name: 'Sign in / Create account' }).click();
    const consent = p.getByRole('checkbox', { name: "Import this device's guest progress when signing in" });
    check(!(await consent.isChecked()), 'guest import defaults unchecked');
    if (importGuest) await consent.check();
    await p.getByPlaceholder('Username', { exact: true }).fill(name);
    await p.getByPlaceholder('Password', { exact: true }).fill(password);
    if (create) {
      await p.getByRole('button', { name: 'Create account', exact: true }).click();
      await p.getByPlaceholder('Confirm password').fill(password);
    }
    await p.getByRole('button', { name: create ? 'Create account' : 'Sign in', exact: true }).click();
    await settlePreferences(p);
    await p.getByText(`Signed in as ${name}`).waitFor();
  };
  const signOut = async p => {
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.getByRole('button', { name: 'Sign in / Create account' }).waitFor();
  };
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('gipfApiKey', 'synthetic-anthropic-a');
    localStorage.setItem('chessLichessToken', 'synthetic-lichess-a');
    localStorage.setItem('chessRating', '1234');
    localStorage.setItem('yinshWins', '{"1":2,"2":0}');
  });
  await page.reload();
  await signIn(page, a, true, true);
  const guestImported = check(await page.evaluate(() => localStorage.getItem('chessRating') === '1234'), 'guest import');
  await page.waitForTimeout(5500);
  const context = await page.context().browser().newContext();
  const second = await context.newPage();
  await second.goto(base);
  await signIn(second, a);
  const secondDevice = await second.evaluate(() => ({
    api: localStorage.getItem('gipfApiKey') === 'synthetic-anthropic-a',
    lichess: localStorage.getItem('chessLichessToken') === 'synthetic-lichess-a',
    score: localStorage.getItem('yinshWins') === '{"1":2,"2":0}',
  }));
  check(Object.values(secondDevice).every(Boolean), 'second device');
  await context.close();
  await signOut(page);
  const logoutCleared = check(await page.evaluate(() => ['gipfAccount', 'gipfApiKey', 'chessLichessToken', 'chessRating', 'yinshWins'].every(k => !localStorage.getItem(k))), 'logout');
  await signIn(page, b, true);
  const accountBIsolated = check(await page.evaluate(() => ['gipfApiKey', 'chessLichessToken', 'chessRating', 'yinshWins'].every(k => !localStorage.getItem(k))), 'account B isolation');
  await signOut(page);
  await signIn(page, a);
  const accountRecovery = check(await page.evaluate(() => localStorage.getItem('chessRating') === '1234'), 'account recovery');
  await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('gipfAccount'));
    const call = async body => {
      const response = await fetch('/gipf/api/chessProfile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: s.usernameId, auth: s.authToken, scope: 'settings', ...body }),
      });
      if (!response.ok) throw new Error('fixture request failed');
      return response.json();
    };
    const remote = await call({ action: 'read' });
    await call({ action: 'write', revision: remote.revision, domains: { preferences: { yinshWins: '{"1":9,"2":0}' } } });
    localStorage.setItem('yinshWins', '{"1":3,"2":0}');
  });
  await page.getByRole('button', { name: 'Use cloud' }).waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: 'Use cloud' }).click();
  const explicitCloudChoice = check(await page.evaluate(() => localStorage.getItem('yinshWins') === '{"1":9,"2":0}'), 'cloud conflict choice');
  // Repeated real Chess mounts must not issue legacy claim requests.
  let mountClaims = 0;
  const observeClaim = request => {
    if (request.url().includes('/api/chessProfile') && request.postDataJSON()?.action === 'claim') mountClaims++;
  };
  page.on('request', observeClaim);
  for (let i = 0; i < 6; i++) {
    await page.goto(base + '/chess');
    await settlePreferences(page, page.getByRole('button', { name: 'New Game', exact: true }));
    await page.getByRole('button', { name: 'New Game', exact: true }).waitFor();
    await page.goto(base);
    await settlePreferences(page);
    await page.getByText(`Signed in as ${a}`).waitFor();
  }
  page.off('request', observeClaim);
  check(mountClaims === 0, 'Chess mounts issued legacy claims');
  const emptyClaims = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('gipfAccount'));
    const outcomes = [];
    for (let i = 100; i < 108; i++) {
      const r = await fetch('/gipf/api/chessProfile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({action:'claim',u:s.usernameId,auth:s.authToken,legacyId:i.toString(16).padStart(64,'0')}) });
      outcomes.push(r.status === 200 && (await r.json()).claimed === false);
    }
    return outcomes.every(Boolean);
  });
  check(emptyClaims, 'empty claims consumed budget');
  await signOut(page);
  await page.evaluate(() => localStorage.setItem('gipfApiKey', 'synthetic-late-legacy'));
  await signIn(page, a, false, true);
  const lateMigration = await page.evaluate(async () => {
    const s=JSON.parse(localStorage.getItem('gipfAccount'));
    const r=await fetch('/gipf/api/chessProfile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',u:s.usernameId,auth:s.authToken})});
    const d=await r.json();
    return Object.values(d.legacyProfiles || {}).some(p=>p.rating?.rating===1777);
  });
  check(lateMigration, 'later explicit guest migration failed');
  await signOut(page);
  return { guestImported, secondDevice, logoutCleared, accountBIsolated, accountRecovery, visibleConflict: true, explicitCloudChoice, mountClaims, emptyClaims, lateMigration };
}
