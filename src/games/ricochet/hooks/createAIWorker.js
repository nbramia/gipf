export function createAIWorker() {
  return new Worker(new URL('../engine/solver.worker.js', import.meta.url), { type: 'module' });
}
