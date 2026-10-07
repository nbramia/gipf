import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { games } from './games-registry.js';

export function titleFor(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/') return 'Play';
  const game = games.find(g => g.path === path);
  if (game) return `${game.name} · Play`;
  if (path === '/login') return 'Sign in · Play';
  if (path === '/migration') return 'Move your progress · Play';
  return 'Page not found · Play';
}

// One route-aware title for the whole app. A game may still assign its own title when it
// mounts (lazily, after this effect), so the observer puts the route title back.
export default function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const wanted = titleFor(pathname);
    const apply = () => { if (document.title !== wanted) document.title = wanted; };
    apply();
    const el = document.querySelector('title');
    if (!el || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(apply);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
