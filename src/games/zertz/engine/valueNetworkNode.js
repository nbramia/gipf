// valueNetworkNode.js — Node.js ONNX inference for Zertz value/policy-value network.
// Uses onnxruntime-node (native backend) instead of onnxruntime-web (WASM/browser).
// Used by CLI scripts (tournament, self-play with NN eval).
//
// Supports both class-based (multiple models) and module-level (single model) API.
// Handles both value-only and policy-value models transparently.

import { extractFeatures, modelFeatureSchema, GRID_SIZE, NUM_META } from './features.js';

/**
 * ValueNetwork class — allows loading multiple models simultaneously.
 * Used for NN-vs-NN tournaments where two models play against each other.
 */
export class ValueNetwork {
  constructor() {
    this.session = null;
    this.ortModule = null;
    this.hasPolicy = false;
    this.featureVersion = null;
    this.lastError = null;
  }

  async load(modelPath) {
    if (this.session) return true;
    this.lastError = null;
    try {
      this.ortModule = await import('onnxruntime-node');
      const session = await this.ortModule.InferenceSession.create(modelPath);
      let schema;
      try {
        schema = modelFeatureSchema(session);
        const result = await session.run({
          [schema.boardInput]: new this.ortModule.Tensor('float32',
            new Float32Array(schema.numPlanes * GRID_SIZE * GRID_SIZE), [1, schema.numPlanes, GRID_SIZE, GRID_SIZE]),
          meta_input: new this.ortModule.Tensor('float32', new Float32Array(NUM_META), [1, NUM_META]),
        });
        if (!Number.isFinite(result.value?.data?.[0])) throw new Error('Invalid value output');
        if (session.outputNames.includes('policy') &&
            (!result.policy?.data?.length || !Array.from(result.policy.data).every(Number.isFinite))) {
          throw new Error('Invalid policy output');
        }
      } catch (error) {
        await session.release();
        throw error;
      }
      this.session = session;
      this.schema = schema;
      this.featureVersion = schema.version;
      // Detect if model has policy output
      this.hasPolicy = this.session.outputNames.includes('policy');
      return true;
    } catch (err) {
      this.lastError = `Incompatible or unavailable ZERTZ model: ${err.message}`;
      console.error(this.lastError);
      this.session = null;
      this.featureVersion = null;
      return false;
    }
  }

  async evaluatePosition(board) {
    if (!this.session || !this.ortModule) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const { board: boardData, meta } = extractFeatures(board, this.featureVersion);

    const boardTensor = new this.ortModule.Tensor('float32', boardData, [1, this.schema.numPlanes, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new this.ortModule.Tensor('float32', meta, [1, NUM_META]);

    const results = await this.session.run({
      [this.schema.boardInput]: boardTensor,
      meta_input: metaTensor,
    });

    return results.value.data[0];
  }

  async evaluatePositionWithPolicy(board) {
    if (!this.session || !this.ortModule) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const { board: boardData, meta } = extractFeatures(board, this.featureVersion);

    const boardTensor = new this.ortModule.Tensor('float32', boardData, [1, this.schema.numPlanes, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new this.ortModule.Tensor('float32', meta, [1, NUM_META]);

    const results = await this.session.run({
      [this.schema.boardInput]: boardTensor,
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
