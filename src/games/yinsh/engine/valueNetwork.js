// valueNetwork.js — Browser-side ONNX inference for Yinsh value/policy-value network.
// Loads an ONNX model via onnxruntime-web (WASM backend) and evaluates positions.
//
// Supports both class-based (multiple models) and module-level (single model) API.
// Handles both value-only and policy-value models transparently.

import { extractFeatures, BOARD_FEATURES, META_FEATURES } from './features.js';

/**
 * ValueNetwork class — allows loading multiple models simultaneously.
 */
export class ValueNetwork {
  constructor() {
    this.session = null;
    this.loading = false;
    this.hasPolicy = false;
  }

  async load(modelPath = '/models/yinsh-value-v1.onnx') {
    if (this.session) return true;
    if (this.loading) {
      while (this.loading) {
        await new Promise(r => setTimeout(r, 50));
      }
      return this.session !== null;
    }

    this.loading = true;
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      this.session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
      });
      // Detect if model has policy output
      this.hasPolicy = this.session.outputNames.includes('policy');
      return true;
    } catch (err) {
      console.error('Failed to load value network:', err);
      this.session = null;
      return false;
    } finally {
      this.loading = false;
    }
  }

  async evaluatePosition(board) {
    if (!this.session) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const ort = await import('onnxruntime-web');
    const { board: boardData, meta } = extractFeatures(board);

    const boardTensor = new ort.Tensor('float32', boardData, [1, 4, 11, 11]);
    const metaTensor = new ort.Tensor('float32', meta, [1, 5]);

    const results = await this.session.run({
      board_planes: boardTensor,
      meta: metaTensor,
    });

    return results.value.data[0];
  }

  async evaluatePositionWithPolicy(board) {
    if (!this.session) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const ort = await import('onnxruntime-web');
    const { board: boardData, meta } = extractFeatures(board);

    const boardTensor = new ort.Tensor('float32', boardData, [1, 4, 11, 11]);
    const metaTensor = new ort.Tensor('float32', meta, [1, 5]);

    const results = await this.session.run({
      board_planes: boardTensor,
      meta: metaTensor,
    });

    return {
      value: results.value.data[0],
      policy: this.hasPolicy ? Array.from(results.policy.data) : null,
    };
  }

  isLoaded() {
    return this.session !== null;
  }
}

// Backward-compatible module-level API (delegates to a default instance)
const _default = new ValueNetwork();

export async function loadValueNetwork(modelPath = '/models/yinsh-value-v1.onnx') {
  if (_default.isLoaded()) return true;
  return _default.load(modelPath);
}

export async function evaluatePosition(board) {
  return _default.evaluatePosition(board);
}

export function isLoaded() {
  return _default.isLoaded();
}
