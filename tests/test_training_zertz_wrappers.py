"""Real schema preflight with isolated, non-promoting wrapper subprocess fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import onnx
from onnx import helper, TensorProto
import torch
from zertz.model import ZertzValueNet

ROOT = Path(__file__).resolve().parents[1]


class WrapperMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for relative in ['scripts/zertz/preflight-training.py', 'scripts/zertz/train-iteration.sh',
                         'scripts/zertz/continuous-train.sh', 'training/zertz/model.py',
                         'training/zertz/schema.py', 'training/zertz/__init__.py']:
            self.write(relative, (ROOT / relative).read_text())
        self.write('training/zertz/.current-version', '4\n')
        self.deployed_model(2)
        self.write('data/zertz/v1_selfplay.ndjson', json.dumps(self.record(1)) + '\n')
        self.write('calls', '')
        self.write('training/.venv/bin/python3', f'''#!{sys.executable}
import json, os, pathlib, subprocess, sys
args=sys.argv[1:]
with open('calls','a') as f: f.write(json.dumps(['python',*args])+'\\n')
if args[0].endswith('preflight-training.py'):
 raise SystemExit(subprocess.call([sys.executable,*args]))
if '--destination' in args: raise SystemExit('Unexpected promotion')
if args[0].endswith('/train.py'):
 assert args[args.index('--feature-version')+1]=='2'
 assert '--checkpoint' in args
 records=[json.loads(line) for line in pathlib.Path(args[args.index('--data')+1]).read_text().splitlines()]
 assert all(r.get('featureVersion')==2 for r in records)
 if os.environ.get('FAIL_TRAIN'): raise SystemExit(8)
 pathlib.Path('training/zertz/checkpoints/best.pt').write_bytes(b'checkpoint'*50)
if '--output' in args: pathlib.Path(args[args.index('--output')+1]).write_bytes(b'model'*100)
''', executable=True)
        self.write('bin/node', f'''#!{sys.executable}
import json, os, pathlib, sys
args=sys.argv[1:]
with open('calls','a') as f: f.write(json.dumps(['node',*args])+'\\n')
if 'parallel-selfplay' in args[0]:
 assert args[args.index('--mode')+1]=='nn'
 assert args[args.index('--model')+1]=='public/models/zertz-value-v1.onnx'
 if os.environ.get('FAIL_SELFPLAY'): raise SystemExit(7)
 record={{'featureVersion':2,'board':[0]*294,'meta':[0]*12,'value':1,'gameId':'fixture'}}
 pathlib.Path(args[args.index('--output')+1]).write_text(json.dumps(record)+'\\n')
else:
 assert args[args.index('--mode')+1]=='nn-vs-nn'
 assert args[args.index('--model2')+1]=='public/models/zertz-value-v1.onnx'
 raise SystemExit(1)
''', executable=True)
        self.write('bin/file', '#!/bin/sh\necho "Zip archive data"\n', executable=True)
        self.write('bin/git', '#!/bin/sh\necho forbidden-git >> calls\nexit 99\n', executable=True)

    def write(self, relative, text, executable=False):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        if executable:
            path.chmod(0o755)
        return path

    def record(self, version):
        return {'featureVersion': version, 'board': [0] * (245 if version == 1 else 294),
                'meta': [0] * 12, 'value': 1, 'gameId': 'historical'}

    def checkpoint(self, version):
        path = self.root / 'training/zertz/checkpoints/v3.pt'
        path.parent.mkdir(parents=True, exist_ok=True)
        state = ZertzValueNet(version).state_dict()
        torch.save(state if version == 1 else {'model_state_dict': state, 'feature_version': 2}, path)
        self.write('training/zertz/.deployed-checkpoint', 'training/zertz/checkpoints/v3.pt\n')

    def deployed_model(self, version, planes=None):
        path = self.root / 'public/models/zertz-value-v1.onnx'
        path.parent.mkdir(parents=True, exist_ok=True)
        name = 'board_input' if version == 1 else f'board_v{version}_input'
        inputs = [helper.make_tensor_value_info(name, TensorProto.FLOAT,
                                                [1, planes or (5 if version == 1 else 6), 7, 7]),
                  helper.make_tensor_value_info('meta_input', TensorProto.FLOAT, [1, 12])]
        output = helper.make_tensor_value_info('value', TensorProto.FLOAT, [1, 1])
        value = helper.make_tensor('value', TensorProto.FLOAT, [1, 1], [0.2])
        model = helper.make_model(helper.make_graph([], 'schema-fixture', inputs, [output], [value]),
                                  opset_imports=[helper.make_opsetid('', 17)])
        model.ir_version = 9
        onnx.save(model, path)

    def run_wrapper(self, continuous, **extra_env):
        script = 'continuous-train.sh' if continuous else 'train-iteration.sh'
        args = ['--max-iterations', '1'] if continuous else ['4', '2', '1']
        self.write('calls', '')
        self.write('training/zertz/.current-version', '4\n')
        before = (self.root / 'data/zertz/v1_selfplay.ndjson').read_bytes()
        pointer = (self.root / 'training/zertz/.deployed-checkpoint').read_bytes()
        deployed = self.root / 'public/models/zertz-value-v1.onnx'
        model_before = deployed.read_bytes() if deployed.exists() else None
        checkpoint = self.root / 'training/zertz/checkpoints/v3.pt'
        checkpoint_before = checkpoint.read_bytes()
        result = subprocess.run(['bash', 'scripts/zertz/' + script, *args], cwd=self.root,
                                capture_output=True, text=True, timeout=30,
                                env={**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH'], **extra_env})
        self.assertEqual(before, (self.root / 'data/zertz/v1_selfplay.ndjson').read_bytes())
        self.assertEqual(pointer, (self.root / 'training/zertz/.deployed-checkpoint').read_bytes())
        self.assertEqual(deployed.read_bytes() if deployed.exists() else None, model_before)
        self.assertEqual(checkpoint.read_bytes(), checkpoint_before)
        self.assertNotIn('forbidden-git', (self.root / 'calls').read_text())
        calls = [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]
        self.assertFalse(any('--destination' in call for call in calls))
        return result, calls

    def test_incompatible_or_missing_deployed_model_fails_before_selfplay(self):
        self.checkpoint(2)
        for continuous in [False, True]:
            for variant in ['v1', 'unknown', 'wrong-shape', 'corrupt', 'missing']:
                with self.subTest(continuous=continuous, variant=variant):
                    self.deployed_model(1 if variant == 'v1' else 3 if variant == 'unknown' else 2,
                                        planes=5 if variant == 'wrong-shape' else None)
                    path = self.root / 'public/models/zertz-value-v1.onnx'
                    if variant == 'corrupt':
                        path.write_bytes(b'corrupt')
                    elif variant == 'missing':
                        path.unlink()
                    result, calls = self.run_wrapper(continuous)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('preflight failed', result.stderr)
                    self.assertFalse(any(call[0] == 'node' for call in calls))
                    self.assertEqual((self.root / 'training/zertz/.current-version').read_text(), '4\n')

    def test_explicit_no_incumbent_scratch_preflight(self):
        path = self.root / 'public/models/zertz-value-v1.onnx'
        command = [sys.executable, 'scripts/zertz/preflight-training.py',
                   '--deployed-model', str(path), '--data-dir', 'data/zertz/feature-v2']
        env = {**os.environ, 'PYTHONPATH': str(self.root / 'training')}
        result = subprocess.run(command, cwd=self.root, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        path.unlink()
        result = subprocess.run(command, cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_and_corrupt_checkpoints_fail_before_selfplay(self):
        for continuous in [False, True]:
            for corrupt in [False, True]:
                with self.subTest(continuous=continuous, corrupt=corrupt):
                    self.checkpoint(1)
                    if corrupt:
                        self.write('training/zertz/checkpoints/v3.pt', 'corrupt')
                    result, calls = self.run_wrapper(continuous)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(any(call[0] == 'node' for call in calls))
                    self.assertIn('preflight failed', result.stderr)
                    if not corrupt:
                        self.assertIn('WITHOUT --checkpoint', result.stderr)
                        self.assertIn('Bootstrap', result.stderr)

    def test_v2_checkpoint_uses_isolated_default_or_configured_data(self):
        self.checkpoint(2)
        for continuous in [False, True]:
            for directory in [None, 'data/custom v2']:
                with self.subTest(continuous=continuous, directory=directory):
                    env = {'DATA_DIR': directory} if directory else {}
                    data_dir = directory or 'data/zertz/feature-v2'
                    self.write(data_dir + '/v2_selfplay.ndjson', json.dumps(self.record(2)) + '\n')
                    result, calls = self.run_wrapper(continuous, **env)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    preflight = next(i for i, call in enumerate(calls) if 'scripts/zertz/preflight-training.py' in call)
                    first_node = next(i for i, call in enumerate(calls) if call[0] == 'node')
                    self.assertLess(preflight, first_node)
                    self.assertIn(data_dir + '/v4_selfplay.ndjson', calls[first_node])
                    self.assertTrue(any('--model2' in call for call in calls))

    def test_explicit_legacy_history_rejected_before_selfplay(self):
        self.checkpoint(2)
        for continuous in [False, True]:
            result, calls = self.run_wrapper(continuous, DATA_DIR='data/zertz')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('legacy data', result.stderr)
            self.assertFalse(any(call[0] == 'node' for call in calls))

    def test_generation_and_training_errors_never_reach_gate_or_promotion(self):
        self.checkpoint(2)
        for continuous in [False, True]:
            for failure in ['FAIL_SELFPLAY', 'FAIL_TRAIN']:
                result, calls = self.run_wrapper(continuous, **{failure: '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('--model2' in call for call in calls))


if __name__ == '__main__':
    unittest.main()
