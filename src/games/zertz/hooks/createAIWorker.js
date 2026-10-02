export function createAIWorker() {
  return new Worker(new URL('../engine/mcts.worker.js', import.meta.url), { type: 'module' });
}
