// Browser ONNX inference for the Catan policy/value network (onnxruntime-web).
// Mirror of valueNetworkNode.js (onnxruntime-node) — keep both in sync
// (CLAUDE.md mistake #8).
//
// predict(Float32Array[360]) -> { value: Float32Array[6], policy: Float32Array[483] }
// (raw logits; the NNEvaluator applies softmax + legal-move masking).

import * as ort from 'onnxruntime-web';

export default class CatanValueNetwork {
  constructor(session) {
    this.session = session;
  }

  static async load(modelUrl) {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
    });
    return new CatanValueNetwork(session);
  }

  async predict(input) {
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    const output = await this.session.run({ input: tensor });
    return { value: output.value.data, policy: output.policy.data };
  }
}
