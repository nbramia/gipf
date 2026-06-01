// Node ONNX inference for the Catan policy/value network (onnxruntime-node).
// Used by self-play generation and tournament gating. Mirror of valueNetwork.js
// (onnxruntime-web) for the browser — keep both in sync (CLAUDE.md mistake #8).
//
// predict(Float32Array[360]) -> { value: Float32Array[6], policy: Float32Array[483] }
// (raw logits; the NNEvaluator applies softmax + legal-move masking).

import * as ort from 'onnxruntime-node';

export default class CatanValueNetworkNode {
  constructor(session) {
    this.session = session;
  }

  static async load(modelPath) {
    const session = await ort.InferenceSession.create(modelPath);
    return new CatanValueNetworkNode(session);
  }

  async predict(input) {
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    const output = await this.session.run({ input: tensor });
    return { value: output.value.data, policy: output.policy.data };
  }
}
