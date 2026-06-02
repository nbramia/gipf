// Node ONNX inference for the Splendor policy/value network (onnxruntime-node).
// Used by self-play generation and tournament gating. Mirror of valueNetwork.js
// (onnxruntime-web) for the browser — keep both in sync (CLAUDE.md mistake #8).
//
// predict(Float32Array[216]) -> { value: Float32Array[4], policy: Float32Array[POLICY_SIZE] }
// (raw logits; the NNEvaluator applies softmax + legal-move masking).
//
// Scaffold: no model is trained/deployed yet (see docs/splendor.md). The
// heuristic PUCT tree is the live engine; this exists for the training pipeline.

import * as ort from 'onnxruntime-node';

export default class SplendorValueNetworkNode {
  constructor(session) {
    this.session = session;
  }

  static async load(modelPath) {
    const session = await ort.InferenceSession.create(modelPath);
    return new SplendorValueNetworkNode(session);
  }

  async predict(input) {
    const tensor = new ort.Tensor('float32', input, [1, input.length]);
    const output = await this.session.run({ input: tensor });
    return { value: output.value.data, policy: output.policy.data };
  }
}
