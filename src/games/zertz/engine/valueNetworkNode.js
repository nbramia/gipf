// valueNetworkNode.js — Node.js ONNX inference for Zertz value/policy-value network.
// Uses onnxruntime-node (native backend) instead of onnxruntime-web (WASM/browser).
// Used by CLI scripts (tournament, self-play with NN eval).
//
// Supports both class-based (multiple models) and module-level (single model) API.
// Handles both value-only and policy-value models transparently.

import { extractFeatures, GRID_SIZE, NUM_PLANES, NUM_META } from './features.js';

/**
 * ValueNetwork class — allows loading multiple models simultaneously.
 * Used for NN-vs-NN tournaments where two models play against each other.
 */
export class ValueNetwork {
  constructor() {
    this.session = null;
    this.ortModule = null;
    this.hasPolicy = false;
  }

  async load(modelPath) {
    try {
      this.ortModule = await import('onnxruntime-node');
      this.session = await this.ortModule.InferenceSession.create(modelPath);
      // Detect if model has policy output
      this.hasPolicy = this.session.outputNames.includes('policy');
      return true;
    } catch (err) {
      console.error('Failed to load value network:', err);
      this.session = null;
      return false;
    }
  }

  async evaluatePosition(board) {
    if (!this.session || !this.ortModule) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const { board: boardData, meta } = extractFeatures(board);

    const boardTensor = new this.ortModule.Tensor('float32', boardData, [1, NUM_PLANES, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new this.ortModule.Tensor('float32', meta, [1, NUM_META]);

    const results = await this.session.run({
      board_input: boardTensor,
      meta_input: metaTensor,
    });

    return results.value.data[0];
  }

  async evaluatePositionWithPolicy(board) {
    if (!this.session || !this.ortModule) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const { board: boardData, meta } = extractFeatures(board);

    const boardTensor = new this.ortModule.Tensor('float32', boardData, [1, NUM_PLANES, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new this.ortModule.Tensor('float32', meta, [1, NUM_META]);

    const results = await this.session.run({
      board_input: boardTensor,
      meta_input: metaTensor,
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

export async function loadValueNetwork(modelPath) {
  if (_default.isLoaded()) return true;
  return _default.load(modelPath);
}

export async function evaluatePosition(board) {
  return _default.evaluatePosition(board);
}

export function isLoaded() {
  return _default.isLoaded();
}
