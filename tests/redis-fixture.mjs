// Explicit disposable target required: never flush the shared developer container.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const container = process.env.GIPF_TEST_REDIS_CONTAINER;
if (!/^gipf-test-[a-z0-9-]+$/.test(container || '')) throw new Error('Set GIPF_TEST_REDIS_CONTAINER to a disposable gipf-test-* container');
const argv = args => ['exec', container, 'redis-cli', '--json', ...args.map(String)];
export const redis = (...args) => JSON.parse(execFileSync('docker', argv(args), { encoding: 'utf8' }));
export const redisAsync = async (...args) => JSON.parse((await promisify(execFile)('docker', argv(args), { encoding: 'utf8' })).stdout);
