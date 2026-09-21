// Execute with Playwright browser_run_code_unsafe filename against the local fixture.
async (page) => {
  const base = 'http://127.0.0.1:3187/gipf';
  const suffix = Date.now();
  const a = `synthetic-a-${suffix}`, b = `synthetic-b-${suffix}`;
  const password = 'synthetic-fixture-password';
  const check = (value, label) => { if (!value) throw new Error(label); return value; };
  const signIn = async (p, name, create = false) => {
    await p.getByRole('button', { name: 'Sign in / Create account' }).click();
    await p.getByPlaceholder('Username', { exact: true }).fill(name);
    await p.getByPlaceholder('Password', { exact: true }).fill(password);
    if (create) {
      await p.getByRole('button', { name: 'Create account', exact: true }).click();
      await p.getByPlaceholder('Confirm password').fill(password);
    }
    await p.getByRole('button', { name: create ? 'Create account' : 'Sign in', exact: true }).click();
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
  await page.getByRole('checkbox').check();
  await signIn(page, a, true);
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
  await signOut(page);
  return { guestImported, secondDevice, logoutCleared, accountBIsolated, accountRecovery, visibleConflict: true, explicitCloudChoice };
}
