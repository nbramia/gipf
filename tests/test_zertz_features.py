"""Native contract tests: PYTHONPATH=training python -m unittest discover -s tests -p test_zertz_features.py."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import torch

from zertz.dataset import ZertzDataset, load_split
from zertz.model import ZertzPolicyValueNet, ZertzValueNet, load_model
from zertz.schema import records_version

ROOT = Path(__file__).resolve().parents[1]


def node(code, *args):
    result = subprocess.run(["node", "--input-type=module", "-", *map(str, args)],
                            input=code, text=True, capture_output=True, cwd=ROOT, timeout=60)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class ZertzFeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        torch.manual_seed(57)
        cls.temp = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temp.name)
        cls.features = node("""
import Board from './src/games/zertz/ZertzBoard.js';
import {extractFeatures, augmentFeatures} from './src/games/zertz/engine/features.js';
const result = {};
for (const version of [1,2]) {
  result[version] = [];
  for (const jumper of ['0,0','-1,1']) {
    const b=new Board();
    b.gamePhase='capture';
    b.marbles={'0,0':'black','1,0':'grey','-1,1':'white','-1,0':'grey'};
    b.jumpingMarble=jumper;
    const f=extractFeatures(b,version);
    result[version].push({featureVersion:version, board:Array.from(f.board),meta:Array.from(f.meta),
      value:1,gameId:jumper,rotations:augmentFeatures(f.board,f.meta).map(x=>Array.from(x.board))});
  }
}
console.log(JSON.stringify(result));
""")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_js_python_rotation_and_feature_semantics(self):
        self.assertEqual(self.features["1"][0]["board"], self.features["1"][1]["board"])
        self.assertNotEqual(self.features["2"][0]["board"], self.features["2"][1]["board"])
        for version in (1, 2):
            records = self.features[str(version)]
            dataset = ZertzDataset(records=records, augment=True)
            self.assertEqual(dataset.feature_version, version)
            for i, record in enumerate(records):
                for rotation in range(6):
                    np.testing.assert_array_equal(
                        dataset.boards[i * 6 + rotation].ravel(), record["rotations"][rotation])

    def test_legacy_records_stay_legacy_and_mixed_or_untagged_v2_fail(self):
        legacy = copy.deepcopy(self.features["1"][0])
        legacy.pop("featureVersion")
        self.assertEqual(ZertzDataset(records=[legacy]).boards.shape, (1, 5, 7, 7))
        with self.assertRaisesRegex(ValueError, "Cannot mix"):
            ZertzDataset(records=[legacy, self.features["2"][0]])
        untagged = copy.deepcopy(self.features["2"][0])
        untagged.pop("featureVersion")
        with self.assertRaisesRegex(ValueError, "legacy arrays cannot supply"):
            ZertzDataset(records=[untagged])
        unknown = {**legacy, "featureVersion": 3}
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            records_version([unknown])
        # A sixth zero plane cannot be added implicitly to a legacy capture state.
        self.assertEqual(len(legacy["board"]), 245)

    def test_mixed_append_rejected_before_sampling_even_at_zero_ratio(self):
        a, b = self.directory / "v1.ndjson", self.directory / "v2.ndjson"
        a.write_text("".join(json.dumps(r) + "\n" for r in self.features["1"]))
        b.write_text("".join(json.dumps(r) + "\n" for r in self.features["2"]))
        with self.assertRaisesRegex(ValueError, "Cannot mix"):
            load_split(a, b, merge_ratio=0)

    def test_malformed_v2_identity_rejected(self):
        record = copy.deepcopy(self.features["2"][0])
        record["board"][245 + 25] = 1
        with self.assertRaisesRegex(ValueError, "zero or one-hot"):
            ZertzDataset(records=[record])
        record = copy.deepcopy(self.features["2"][0])
        record["meta"][10] = 0
        with self.assertRaisesRegex(ValueError, "capture phase"):
            ZertzDataset(records=[record])

    def test_checkpoint_schema_compatibility(self):
        for model_class in (ZertzValueNet, ZertzPolicyValueNet):
            legacy = model_class(feature_version=1)
            loaded, _ = load_model(legacy.state_dict())
            self.assertEqual(loaded.feature_version, 1)
            full = {"model_state_dict": legacy.state_dict(), "model_type": "value", "epoch": 3}
            self.assertEqual(load_model(full)[0].feature_version, 1)
            modern = model_class(feature_version=2)
            self.assertEqual(load_model({"model_state_dict": modern.state_dict(),
                                         "feature_version": 2})[0].feature_version, 2)
            with self.assertRaisesRegex(ValueError, "feature_version is required"):
                load_model(modern.state_dict())
            with self.assertRaisesRegex(ValueError, "conflicts"):
                load_model({"model_state_dict": legacy.state_dict(), "feature_version": 2})
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                load_model({"model_state_dict": legacy.state_dict(), "feature_version": 17})

    def test_native_export_and_node_parity_for_legacy_and_v2(self):
        for version in (1, 2):
            model = ZertzPolicyValueNet(feature_version=version).eval()
            checkpoint = self.directory / f"v{version}.pt"
            output = self.directory / f"v{version}.onnx"
            # Use an actual old-format raw state dict for legacy compatibility.
            torch.save(model.state_dict() if version == 1 else {
                "model_state_dict": model.state_dict(), "feature_version": version,
                "model_type": "policy-value",
            }, checkpoint)
            result = subprocess.run(
                [sys.executable, str(ROOT / "training/zertz/export_onnx.py"),
                 "--checkpoint", str(checkpoint), "--output", str(output)],
                capture_output=True, text=True, cwd=ROOT, timeout=90,
                env={**os.environ, "PYTHONPATH": str(ROOT / "training"), "OMP_NUM_THREADS": "1"})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Verification passed", result.stdout)
            import onnx
            artifact = onnx.load(output)
            self.assertEqual({p.key: p.value for p in artifact.metadata_props}["zertz.feature_version"], str(version))
            native = node("""
import Board from './src/games/zertz/ZertzBoard.js';
import {ValueNetwork} from './src/games/zertz/engine/valueNetworkNode.js';
const network=new ValueNetwork();
if (!await network.load(process.argv[2])) throw new Error(network.lastError);
const results=[];
for (const jumper of ['0,0','-1,1']) {
  const b=new Board();b.gamePhase='capture';
  b.marbles={'0,0':'black','1,0':'grey','-1,1':'white','-1,0':'grey'};
  b.jumpingMarble=jumper;
  results.push(await network.evaluatePositionWithPolicy(b));
}
console.log(JSON.stringify({version:network.featureVersion, results}));
await network.session.release();
""", output)
            self.assertEqual(native["version"], version)
            for record, actual in zip(self.features[str(version)], native["results"]):
                planes = 5 if version == 1 else 6
                with torch.no_grad():
                    value, policy = model(torch.tensor(record["board"], dtype=torch.float32).reshape(1, planes, 7, 7),
                                          torch.tensor(record["meta"], dtype=torch.float32).reshape(1, 12))
                np.testing.assert_allclose(actual["value"], value.item(), rtol=1e-4, atol=1e-5)
                np.testing.assert_allclose(actual["policy"], policy.numpy()[0], rtol=1e-4, atol=1e-5)
            if version == 1:
                self.assertEqual(native["results"][0], native["results"][1])
            else:
                self.assertNotEqual(native["results"][0], native["results"][1])
                if os.environ.get("ZERTZ_V2_SMOKE_MODEL"):
                    import shutil
                    shutil.copyfile(output, os.environ["ZERTZ_V2_SMOKE_MODEL"])

    def test_real_v2_selfplay_training_and_legacy_checkpoint_rejection(self):
        data = self.directory / "fresh-selfplay.ndjson"
        result = subprocess.run(["node", "--input-type=module", "-", "--games", "2",
                                 "--sims", "1", "--ramp", "0", "--output", str(data)],
                                input="let seed=57; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296); "
                                      "await import('./scripts/zertz/generate-training-data.mjs');",
                                capture_output=True, text=True, cwd=ROOT, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        records = [json.loads(line) for line in data.read_text().splitlines()]
        self.assertTrue(records)
        self.assertEqual({r["featureVersion"] for r in records}, {2})
        self.assertEqual(len({r["gameId"] for r in records}), 2)
        self.assertEqual(ZertzDataset(records=records).boards.shape[1:], (6, 7, 7))
        output = self.directory / "trained"
        command = [sys.executable, "-c",
                   "import torch,runpy,sys; torch.set_num_threads(1); "
                   "torch.backends.mps.is_available=lambda:False; torch.cuda.is_available=lambda:False; "
                   "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')",
                   "training/zertz/train.py", "--data", str(data), "--feature-version", "2",
                   "--epochs", "1", "--batch-size", "32", "--output-dir", str(output)]
        env = {**os.environ, "PYTHONPATH": str(ROOT / "training")}
        result = subprocess.run(command, capture_output=True, text=True, cwd=ROOT, env=env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        checkpoint = torch.load(output / "best.pt", weights_only=True)
        self.assertEqual(checkpoint["feature_version"], 2)
        self.assertEqual(checkpoint["model_state_dict"]["input_conv.weight"].shape[1], 6)
        legacy = self.directory / "legacy-resume.pt"
        torch.save(ZertzPolicyValueNet(feature_version=1).state_dict(), legacy)
        result = subprocess.run([*command, "--checkpoint", str(legacy)], capture_output=True,
                                text=True, cwd=ROOT, env=env, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Checkpoint feature-v1 cannot train on v2", result.stderr)

    def test_shipped_legacy_model_and_unknown_schema_native_load(self):
        result = node("""
import Board from './src/games/zertz/ZertzBoard.js';
import {ValueNetwork} from './src/games/zertz/engine/valueNetworkNode.js';
const v=new ValueNetwork();
if (!await v.load('public/models/zertz-value-v1.onnx')) throw new Error(v.lastError);
console.log(JSON.stringify({version:v.featureVersion,value:await v.evaluatePosition(new Board())}));
await v.session.release();
""")
        self.assertEqual(result["version"], 1)
        self.assertTrue(np.isfinite(result["value"]))
        import onnx
        from onnx import helper, TensorProto
        for name, planes in (("board_v3_input", 6), ("board_input", 6)):
            board = helper.make_tensor_value_info(name, TensorProto.FLOAT, [1, planes, 7, 7])
            meta = helper.make_tensor_value_info("meta_input", TensorProto.FLOAT, [1, 12])
            out = helper.make_tensor_value_info("value", TensorProto.FLOAT, [1, 1])
            value = helper.make_tensor("value", TensorProto.FLOAT, [1, 1], [0.2])
            model = helper.make_model(helper.make_graph([], "bad-schema", [board, meta], [out], [value]),
                                      opset_imports=[helper.make_opsetid("", 17)])
            model.ir_version = 9
            path = self.directory / f"bad-{name}.onnx"
            onnx.save(model, path)
            result = node("""
import {ValueNetwork} from './src/games/zertz/engine/valueNetworkNode.js';
const v=new ValueNetwork();const loaded=await v.load(process.argv[2]);
console.log(JSON.stringify({loaded,error:v.lastError,version:v.featureVersion}));
""", path)
            self.assertFalse(result["loaded"])
            self.assertIn("Incompatible or unavailable ZERTZ model", result["error"])
            self.assertIsNone(result["version"])

    def test_native_policy_probe_releases_and_retries(self):
        result = node("""
import assert from 'node:assert/strict';
import * as ort from 'onnxruntime-node';
import {ValueNetwork} from './src/games/zertz/engine/valueNetworkNode.js';
const originalCreate = ort.InferenceSession.create;
let checked = 0;
try {
  for (const version of [1, 2]) {
    for (const policy of [undefined, {}, {data: []},
        ...[NaN, Infinity, -Infinity].map(x => ({data: new Float32Array([0, x])}))]) {
      let releases = 0;
      let invalid = true;
      ort.InferenceSession.create = async () => ({
        inputNames: [version === 1 ? 'board_input' : 'board_v2_input', 'meta_input'],
        outputNames: ['value', 'policy'],
        run: async feeds => {
          assert.deepEqual(feeds[version === 1 ? 'board_input' : 'board_v2_input'].dims,
            [1, version === 1 ? 5 : 6, 7, 7]);
          return {value: {data: [0.2]}, policy: invalid ? policy : {data: [0, 1]}};
        },
        release: async () => { releases++; },
      });
      const v = new ValueNetwork();
      assert.equal(await v.load('boundary-fixture'), false);
      assert.equal(v.isLoaded(), false);
      assert.equal(v.featureVersion, null);
      assert.equal(v.hasPolicy, false);
      assert.match(v.lastError, /Invalid policy output/);
      assert.equal(releases, 1);
      invalid = false;
      assert.equal(await v.load('retry-fixture'), true);
      assert.equal(v.featureVersion, version);
      assert.equal(v.hasPolicy, true);
      assert.equal(v.lastError, null);
      await v.session.release();
      assert.equal(releases, 2);
      checked++;
    }
    ort.InferenceSession.create = async () => ({
      inputNames: [version === 1 ? 'board_input' : 'board_v2_input', 'meta_input'],
      outputNames: ['value'], run: async () => ({value: {data: [0.2]}}),
      release: async () => {},
    });
    const legacy = new ValueNetwork();
    assert.equal(await legacy.load('value-only'), true);
    assert.equal(legacy.hasPolicy, false);
    assert.equal(legacy.featureVersion, version);
    await legacy.session.release();
  }
} finally {
  ort.InferenceSession.create = originalCreate;
}
console.log(JSON.stringify({checked}));
""")
        self.assertEqual(result['checked'], 12)


if __name__ == "__main__":
    unittest.main()
