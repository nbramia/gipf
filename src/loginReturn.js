import { games } from './games-registry.js';

// `/login?return=` accepts only an exact game route from the registry. Anything
// else — absolute URLs, protocol-relative paths, encoded tricks, sub-routes —
// falls back to the catalogue, so the login page can never become an open redirect.
export function safeReturn(raw) {
  return games.some(game => game.path === raw) ? raw : '/';
}

export function loginHref(path) {
  return `/login?return=${safeReturn(path)}`;
}
