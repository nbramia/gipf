/**
 * Writes the tile manifest that portals read to list these games on their landing pages.
 *
 * Runs as a `prebuild` step so the manifest is derived from the games registry on every
 * build rather than maintained alongside it. Output goes to `public/`, which CRA copies
 * into the build verbatim.
 *
 * Hrefs carry the deploy prefix, resolved exactly as CRA resolves the prefix it bakes into
 * the router basename: a `PUBLIC_URL` environment variable wins, otherwise the `homepage`
 * field in package.json. Both must agree, or the manifest advertises paths the router does
 * not serve. The root-hosted `play` deployment sets `PUBLIC_URL=/` and gets `/chess`; a
 * build with no override takes `homepage` and gets `/gipf/chess` for the ramia.us subpath.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { games } from '../src/games-registry.js'

/** The path prefix for tile hrefs, with no trailing slash ('' for a root deploy). */
export function tileBase({ publicUrl, homepage } = {}) {
  // CRA treats an empty PUBLIC_URL as unset and falls back to homepage.
  const raw = publicUrl || homepage || ''
  // An absolute URL contributes only its path; the manifest's hrefs are same-origin.
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? new URL(raw).pathname : raw
  return path.replace(/\/+$/, '')
}

export function buildManifest(base) {
  return {
    version: 1,
    project: 'gipf',
    tiles: games.map((game) => ({
      name: game.name,
      href: `${base}${game.path}`,
      description: game.description,
    })),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const { homepage } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const base = tileBase({ publicUrl: process.env.PUBLIC_URL, homepage })
  const manifest = buildManifest(base)
  const out = join(root, 'public', 'tiles.json')
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`emit-tiles: ${manifest.tiles.length} tiles -> public/tiles.json (base: ${base || '/'})`)
}
