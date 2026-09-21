// Explicitly disposable fixture only. Run before each browser smoke, with its server idle.
import { redis } from './redis-fixture.mjs';
import { hash } from '../server/publicSecurity.js';
redis('FLUSHDB');
redis('SET', `chess:rating:${hash('gipf-chess-rating:v1:synthetic-late-legacy')}`, JSON.stringify({ rating: 1777, ratedGames: 6 }));
console.log('Disposable browser fixture reset and synthetic legacy rating seeded');
