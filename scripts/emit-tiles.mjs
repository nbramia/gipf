/**
 * Writes the tile manifest that ramia.us reads to list these games on its landing page.
 *
 * Runs as a `prebuild` step so the manifest is derived from the games registry on every
 * build rather than maintained alongside it. Output goes to `public/`, which CRA copies
 * into the build verbatim.
 *
 * Hrefs carry the deploy prefix, read from `homepage` in package.json — the same field CRA
 * derives `PUBLIC_URL` from. It is read here rather than taken from the environment because
 * `PUBLIC_URL` is set by `react-scripts` for its own build and is absent from a `prebuild`
 * step, which would silently emit unprefixed hrefs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { games } from '../src/games-registry.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { homepage } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// A bare-root deploy has no homepage; a trailing slash would double up against game paths.
const base = (homepage ?? '').replace(/\/$/, '')

const manifest = {
  version: 1,
  project: 'gipf',
  tiles: games.map((game) => ({
    name: game.name,
    href: `${base}${game.path}`,
    description: game.description,
  })),
}

const out = join(root, 'public', 'tiles.json')
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`emit-tiles: ${manifest.tiles.length} tiles -> public/tiles.json (base: ${base || '/'})`)
