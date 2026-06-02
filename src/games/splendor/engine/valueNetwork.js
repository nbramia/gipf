// Browser ONNX inference for the Splendor policy/value network (onnxruntime-web).
// Mirror of valueNetworkNode.js (onnxruntime-node) — keep both in sync
// (CLAUDE.md mistake #8). Lazy-imports onnxruntime-web so the deployed bundle
// (heuristic engine) never pulls the runtime unless an NN is actually used.
//
// predict(Float32Array[216]) -> { value: Float32Array[4], policy: Float32Array[POLICY_SIZE] }
//
// Scaffold: no model is trained/deployed yet (see docs/splendor.md).

export default class SplendorValueNetwork {
  constructor(session, ort) {
    this.session = session;
    this.ort = ort;
  }

  static async load(modelUrl) {
    const ort = await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(modelUrl);
    return new SplendorValueNetwork(session, ort);
  }

  async predict(input) {
    const tensor = new this.ort.Tensor('float32', input, [1, input.length]);
    const output = await this.session.run({ input: tensor });
    return { value: output.value.data, policy: output.policy.data };
  }
}
