// Serve the existing /gipf production build locally and check real guest launch.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../build');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/gipf\/?/, '');
  const candidate = path.resolve(root, pathname);
  const file = candidate.startsWith(`${root}/`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
server.listen(4319, '127.0.0.1', async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    // No remote fonts, provider calls, or production endpoints are used.
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4319/') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:4319/gipf/');
    await page.getByRole('link', { name: 'Play YINSH', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/ramia22-games-design-evidence/production-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Play YINSH', exact: true }).click();
    await page.waitForURL('**/gipf/yinsh');
    await page.locator('.game-yinsh').waitFor();
    assert(await page.locator('.game-yinsh').isVisible());
    await page.screenshot({ path: '/tmp/ramia22-games-design-evidence/production-guest-yinsh.png', fullPage: true });
    console.log('PASS production /gipf catalogue and actual YINSH guest board launch; remote traffic blocked');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await browser?.close(); server.close(); }
});
