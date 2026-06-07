// Reactive view of the shared (cross-game) Anthropic API key. Re-renders the
// consumer whenever the key is set/cleared anywhere — in the Diplomacy chat, in
// another tab, or in another GIPF game (chess / Catan / Splendor) — so the key
// state stays in sync without a reload. The key itself is the app-wide
// `gipfApiKey` slot owned by agentClient.js.

import { useSyncExternalStore } from 'react';
import { hasApiKey, subscribeApiKey } from '../agents/agentClient.js';

export default function useHasApiKey() {
  return useSyncExternalStore(subscribeApiKey, hasApiKey, () => false);
}
