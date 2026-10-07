import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../scripts/emit-tiles.mjs';

const canonical = ['/yinsh', '/zertz', '/chess', '/catan', '/splendor', '/diplomacy'];

test('every game tile links to its root route', () => {
  assert.deepEqual(buildManifest().tiles.map(t => t.href), canonical);
});

test('the script writes root hrefs whatever PUBLIC_URL the build environment carries', () => {
  const out = fileURLToPath(new URL('../public/tiles.json', import.meta.url));
  const original = readFileSync(out, 'utf8');
  const script = fileURLToPath(new URL('../scripts/emit-tiles.mjs', import.meta.url));
  try {
    for (const PUBLIC_URL of ['/', '/play', '']) {
      execFileSync(process.execPath, [script], { env: { ...process.env, PUBLIC_URL }, stdio: 'ignore' });
      assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).tiles.map(t => t.href), canonical);
    }
  } finally {
    writeFileSync(out, original);
  }
});
