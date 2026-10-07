// Execute with Playwright browser_run_code_unsafe filename against the local fixture
// (tests/serve-public-security.mjs), whose /api/auth/login is a synthetic Auth0 sign-in of
// the identity named by the `fixture-identity` cookie.
async (page) => {
  const base = page.url().startsWith('http://127.0.0.1:') ? new URL(page.url()).origin : 'http://127.0.0.1:3187';
  const suffix = Date.now();
  const a = `synthetic-a-${suffix}`, b = `synthetic-b-${suffix}`;
  const check = (value, label) => { if (!value) throw new Error(label); return value; };
  const settlePreferences = async (p, ready = p.getByText(/^Signed in as /)) => {
    // Mounting Chess initializes preferences; choose them explicitly if cloud differs.
    const choice = p.getByRole('button', { name: 'Keep this device', exact: true });
    await Promise.race([ready.waitFor(), choice.waitFor()]);
    if (await choice.isVisible()) await choice.click();
  };
  // The first sign-in of an identity creates it, as a first Auth0 sign-in does.
  const signIn = async (p, name, importGuest = false) => {
    await p.context().addCookies([{ name: 'fixture-identity', value: name, url: new URL(base).origin }]);
    await p.goto(base + '/login');
    const consent = p.getByRole('checkbox', { name: "Import this device's guest progress when signing in" });
    check(!(await consent.isChecked()), 'guest import defaults unchecked');
    if (importGuest) await consent.check();
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('playAccount') || 'null')?.v === 3 && !location.pathname.endsWith('/login'));
    await p.goto(base + '/login');
    await settlePreferences(p);
    await p.getByText(`Signed in as ${name}@synthetic.example`).waitFor();
  };
  const signOut = async p => {
    await p.goto(base + '/login');
    await settlePreferences(p, p.getByRole('button', { name: 'Sign out', exact: true }));
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.getByRole('button', { name: 'Sign out', exact: true }).click();
    await p.getByText('Signed out of Games.').waitFor();
  };
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('playApiKey', 'synthetic-anthropic-a');
    localStorage.setItem('chessLichessToken', 'synthetic-lichess-a');
    localStorage.setItem('chessRating', '1234');
    localStorage.setItem('yinshWins', '{"1":2,"2":0}');
  });
  await page.reload();
  await signIn(page, a, true);
  const guestImported = check(await page.evaluate(() => localStorage.getItem('chessRating') === '1234'), 'guest import');
  await page.waitForTimeout(5500);
  const context = await page.context().browser().newContext();
  const second = await context.newPage();
  await second.goto(base);
  await signIn(second, a);
  // The guest keys moved to the account: the second device knows they exist, never holds them.
  const secondDevice = await second.evaluate(() => ({
    keys: localStorage.getItem('playAccountKeys') === '{"anthropic":true,"lichess":true}',
    noPlaintext: !localStorage.getItem('playApiKey') && !localStorage.getItem('chessLichessToken'),
    score: localStorage.getItem('yinshWins') === '{"1":2,"2":0}',
  }));
  check(Object.values(secondDevice).every(Boolean), 'second device');
  await context.close();
  await signOut(page);
  const logoutCleared = check(await page.evaluate(() => ['playAccount', 'playAccountKeys', 'playApiKey', 'chessLichessToken', 'chessRating', 'yinshWins'].every(k => !localStorage.getItem(k))), 'logout');
  await signIn(page, b);
  // Account B holds no keys: its marker says so, and no key or A's progress is on the device.
  const accountBIsolated = check(await page.evaluate(() => localStorage.getItem('playAccountKeys') === '{"anthropic":false,"lichess":false}' &&
    ['playApiKey', 'chessLichessToken', 'chessRating', 'yinshWins'].every(k => !localStorage.getItem(k))), 'account B isolation');
  await signOut(page);
  await signIn(page, a);
  const accountRecovery = check(await page.evaluate(() => localStorage.getItem('chessRating') === '1234'), 'account recovery');
  await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('playAccount'));
    const call = async body => {
      const response = await fetch('/api/chessProfile', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Games-Request': '1' },
        body: JSON.stringify({ u: s.usernameId, scope: 'settings', ...body }),
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
  // The choice seals a recovery copy first, so it completes asynchronously.
  const explicitCloudChoice = check(await page.waitForFunction(() => localStorage.getItem('yinshWins') === '{"1":9,"2":0}', null, { timeout: 10000 }).then(() => true, () => false), 'cloud conflict choice');
  // Repeated real Chess mounts sync through the session alone and stay signed in.
  for (let i = 0; i < 3; i++) {
    await page.goto(base + '/chess');
    await settlePreferences(page, page.getByRole('button', { name: 'New Game', exact: true }));
    await page.getByRole('button', { name: 'New Game', exact: true }).waitFor();
    await page.goto(base);
    await settlePreferences(page);
    await page.getByText(`Signed in as ${a}@synthetic.example`).waitFor();
  }
  await signOut(page);
  return { guestImported, secondDevice, logoutCleared, accountBIsolated, accountRecovery, visibleConflict: true, explicitCloudChoice };
}
