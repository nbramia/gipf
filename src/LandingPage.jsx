import React from 'react';
import { Link } from 'react-router-dom';

const games = [
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
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-3">
        GIPF Project
      </h1>
      <p className="text-neutral-400 font-body text-lg mb-16 text-center max-w-md">
        Abstract strategy board games — playable in the browser.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl">
        {games.map((game) => (
          <Link
            key={game.path}
            to={game.path}
            className="group block rounded-2xl border border-neutral-800 bg-neutral-900 p-8 transition-all hover:border-neutral-600 hover:bg-neutral-800/60"
          >
            <h2
              className="font-display text-2xl font-bold tracking-wide mb-3"
              style={{ color: game.accent }}
            >
              {game.name}
            </h2>
            <p className="text-neutral-400 font-body text-sm leading-relaxed">
              {game.description}
            </p>
            <span className="inline-block mt-5 text-sm font-body text-neutral-500 group-hover:text-neutral-300 transition-colors">
              Play &rarr;
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
