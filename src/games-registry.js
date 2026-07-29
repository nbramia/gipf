/**
 * The games this project offers, and the single place they are enumerated.
 *
 * Both the landing page and the build-time tile manifest read from here. The manifest is
 * what `ramia.us` fetches to list the games on its own front page, so a game added below
 * appears there on the next deploy with no change to that repo — which only holds as long
 * as this stays the one list.
 */
export const games = [
  {
    name: 'YINSH',
    path: '/yinsh',
    description: 'Place rings, flip markers, score rows. Features AI with neural network evaluation.',
    accent: '#93C5FD',
  },
  {
    name: 'ZERTZ',
    path: '/zertz',
    description: 'Capture marbles by jumping. Isolate rings to claim pieces. Pure strategy for two.',
    accent: '#A8A29E',
  },
  {
    name: 'CHESS',
    path: '/chess',
    description: 'Play against Stockfish with a built-in coach that explains every move — yours and its.',
    accent: '#818CF8',
  },
  {
    name: 'CATAN',
    path: '/catan',
    description: 'Build settlements, trade ports, and race three strong MCTS opponents to 10 points.',
    accent: '#2DD4BF',
  },
  {
    name: 'SPLENDOR',
    path: '/splendor',
    description: 'Collect gems, build a card engine, and court nobles. Race deep-search opponents to 15 prestige.',
    accent: '#D9A441',
  },
  {
    name: 'DIPLOMACY',
    path: '/diplomacy',
    description: 'Command armies and fleets across Europe. Enter simultaneous orders, resolve, and race to 18 supply centers.',
    accent: '#4FB8D4',
  },
];
