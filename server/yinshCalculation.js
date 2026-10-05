import { Worker } from 'node:worker_threads';
// WorkerClass is injectable only by server tests; request fields cannot alter the deadline.
export function calculateYinshMove(body, WorkerClass = Worker) {
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(new URL('./yinshWorker.js', import.meta.url), { workerData: body, stdout: true, stderr: true });
    // Engine diagnostics may include malformed state; discard them at the boundary.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error('calculation_failed'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(true), 3000);
    worker.once('message', result => finish(false, result));
    worker.once('error', () => finish(true));
    worker.once('exit', () => finish(true));
  });
}
