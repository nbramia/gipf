import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tileBase, buildManifest } from '../scripts/emit-tiles.mjs';

const canonical = ['/yinsh', '/zertz', '/chess', '/catan', '/splendor', '/diplomacy'];

test('PUBLIC_URL=/ (the play.ramia.us build) yields root-relative game hrefs', () => {
  const base = tileBase({ publicUrl: '/', homepage: '/gipf' });
  assert.equal(base, '');
  assert.deepEqual(buildManifest(base).tiles.map(t => t.href), canonical);
});

test('without PUBLIC_URL the homepage prefix is kept for the ramia.us/gipf build', () => {
  for (const publicUrl of [undefined, '']) {
    const base = tileBase({ publicUrl, homepage: '/gipf' });
    assert.equal(base, '/gipf');
    assert.deepEqual(buildManifest(base).tiles.map(t => t.href), canonical.map(p => `/gipf${p}`));
  }
});

test('trailing slashes and absolute URLs reduce to a bare path prefix', () => {
  assert.equal(tileBase({ publicUrl: '/games/' }), '/games');
  assert.equal(tileBase({ publicUrl: 'https://play.ramia.us/' }), '');
  assert.equal(tileBase({ homepage: 'https://ramia.us/gipf/' }), '/gipf');
  assert.equal(tileBase({}), '');
});

test('the script honours PUBLIC_URL from the build environment', () => {
  const out = fileURLToPath(new URL('../public/tiles.json', import.meta.url));
  const original = readFileSync(out, 'utf8');
  const script = fileURLToPath(new URL('../scripts/emit-tiles.mjs', import.meta.url));
  try {
    execFileSync(process.execPath, [script], { env: { ...process.env, PUBLIC_URL: '/' }, stdio: 'ignore' });
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).tiles.map(t => t.href), canonical);
  } finally {
    writeFileSync(out, original);
  }
});
