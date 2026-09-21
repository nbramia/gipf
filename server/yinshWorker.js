// A separate worker keeps even non-yielding search under the hard deadline.
import { parentPort, workerData } from 'node:worker_threads';
import { searchYinsh } from './yinshSearch.js';
parentPort.postMessage(await searchYinsh(workerData));
