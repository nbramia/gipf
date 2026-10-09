/**
 * The games this project offers, and the single place they are enumerated.
 *
 * Both the landing page and the build-time tile manifest read from here. The manifest
 * (`/tiles.json`) is what portals such as home.ramia.us fetch to list these games, so a
 * game added below appears there on the next deploy with no change elsewhere — which only
 * holds as long as this stays the one list.
 */
export const games = [
  {
    name: 'YINSH',
    path: '/yinsh',
    description: 'Place rings, flip markers, score rows. Features AI with neural network evaluation.',
  },
  {
    name: 'ZERTZ',
    path: '/zertz',
    description: 'Capture marbles by jumping. Isolate rings to claim pieces. Pure strategy for two.',
  },
  {
    name: 'CHESS',
    path: '/chess',
    description: 'Play against Stockfish with a built-in coach that explains every move — yours and its.',
  },
  {
    name: 'CATAN',
    path: '/catan',
    description: 'Build settlements, trade ports, and race three strong MCTS opponents to 10 points.',
  },
  {
    name: 'SPLENDOR',
    path: '/splendor',
    description: 'Collect gems, build a card engine, and court nobles. Race deep-search opponents to 15 prestige.',
  },
  {
    name: 'DIPLOMACY',
    path: '/diplomacy',
    description: 'Command armies and fleets across Europe. Enter simultaneous orders, resolve, and race to 18 supply centers.',
  },
  {
    name: 'RICOCHET',
    path: '/ricochet',
    description: 'Slide four robots across a walled board to land the right one on its target. A solo puzzle that rates your skill.',
  },
];
