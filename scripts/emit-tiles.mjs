/**
 * Writes the tile manifest that portals read to list these games on their landing pages.
 *
 * Runs as a `prebuild` step so the manifest is derived from the games registry on every
 * build rather than maintained alongside it. Output goes to `public/`, which CRA copies
 * into the build verbatim. The app is served from its domain root (play.ramia.us), so
 * each href is the game's route.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { games } from '../src/games-registry.js'

export function buildManifest() {
  return {
    version: 1,
    project: 'gipf',
    tiles: games.map((game) => ({
      name: game.name,
      href: game.path,
      description: game.description,
    })),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = buildManifest()
  const out = join(root, 'public', 'tiles.json')
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`emit-tiles: ${manifest.tiles.length} tiles -> public/tiles.json`)
}
