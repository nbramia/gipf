// valueNetwork.js — Browser-side ONNX inference for Zertz value/policy-value network.
// Loads an ONNX model via onnxruntime-web (WASM backend) and evaluates positions.
//
// Supports both class-based (multiple models) and module-level (single model) API.
// Handles both value-only and policy-value models transparently.

import { extractFeatures, modelFeatureSchema, GRID_SIZE, NUM_META } from './features.js';

/**
 * ValueNetwork class — allows loading multiple models simultaneously.
 */
export class ValueNetwork {
  constructor() {
    this.session = null;
    this.loading = false;
    this.hasPolicy = false;
    this.featureVersion = null;
    this.lastError = null;
  }

  async load(modelPath = `${process.env.PUBLIC_URL || ''}/models/zertz-value-v1.onnx`) {
    if (this.session) return true;
    if (this.loading) {
      while (this.loading) {
        await new Promise(r => setTimeout(r, 50));
      }
      return this.session !== null;
    }

    this.loading = true;
    this.lastError = null;
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
      });
      // Legacy names select the unchanged v1 representation; v2 has a versioned
      // board input name, also readable in older native ONNX runtimes.
      let schema;
      try {
        schema = modelFeatureSchema(session);
        const result = await session.run({
          [schema.boardInput]: new ort.Tensor('float32', new Float32Array(schema.numPlanes * GRID_SIZE * GRID_SIZE), [1, schema.numPlanes, GRID_SIZE, GRID_SIZE]),
          meta_input: new ort.Tensor('float32', new Float32Array(NUM_META), [1, NUM_META]),
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
    } finally {
      this.loading = false;
    }
  }

  async evaluatePosition(board) {
    if (!this.session) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const ort = await import('onnxruntime-web');
    const { board: boardData, meta } = extractFeatures(board, this.featureVersion);

    const boardTensor = new ort.Tensor('float32', boardData, [1, this.schema.numPlanes, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new ort.Tensor('float32', meta, [1, NUM_META]);

    const results = await this.session.run({
      [this.schema.boardInput]: boardTensor,
      meta_input: metaTensor,
    });

    return results.value.data[0];
  }

  async evaluatePositionWithPolicy(board) {
    if (!this.session) {
      throw new Error('Value network not loaded. Call load() first.');
    }

    const ort = await import('onnxruntime-web');
    const { board: boardData, meta } = extractFeatures(board, this.featureVersion);

    const boardTensor = new ort.Tensor('float32', boardData, [1, this.schema.numPlanes, GRID_SIZE, GRID_SIZE]);
    const metaTensor = new ort.Tensor('float32', meta, [1, NUM_META]);

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

export async function loadValueNetwork(modelPath = `${process.env.PUBLIC_URL || ''}/models/zertz-value-v1.onnx`) {
  if (_default.isLoaded()) return true;
  return _default.load(modelPath);
}

export async function evaluatePosition(board) {
  return _default.evaluatePosition(board);
}

export function isLoaded() {
  return _default.isLoaded();
}
