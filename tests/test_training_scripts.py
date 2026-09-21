"""Isolated subprocess fixtures: never train, publish, or push in a real checkout."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import sys

ROOT = Path(__file__).resolve().parents[1]


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'package.json').write_text('{"type":"module"}')

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def copy(self, relative):
        return self.write(relative, (ROOT / relative).read_text())

    def node(self, script, *args, env=None):
        return subprocess.run(['node', script, *args], cwd=self.root, text=True,
                              capture_output=True, timeout=20, env={**os.environ, **(env or {})})

    def test_coordinators_wait_preserve_failure_and_reject_incomplete_success(self):
        for game in ['yinsh', 'zertz']:
            for failure in ['exit', 'incomplete']:
                with self.subTest(game=game, failure=failure):
                    script = 'scripts/parallel-selfplay.mjs' if game == 'yinsh' else 'scripts/zertz/parallel-selfplay.mjs'
                    worker = 'scripts/worker-selfplay.mjs' if game == 'yinsh' else 'scripts/zertz/generate-training-data.mjs'
                    self.copy(script)
                    self.write(worker, '''
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const output = process.env.OUTPUT || args[args.indexOf('--output') + 1];
const first = process.env.WORKER_ID === '0' || output.includes('_worker-0-');
writeFileSync(output, '{"recoverable":true}\\n');
if (first) process.exit(process.env.FAILURE === 'exit' ? 7 : 0);
setTimeout(() => {
  writeFileSync('settled', 'yes');
  process.send({type:'game_complete', game:1, positions:1});
  process.send({type:'done', games:1, positions:1}, () => process.exit(0));
}, 150);
''')
                    self.write('data/output.ndjson', 'previous output')
                    (self.root / 'settled').unlink(missing_ok=True)
                    result = self.node(script, '--games', '2', '--workers', '2',
                                       '--output', 'data/output.ndjson', env={'FAILURE': failure})
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertTrue((self.root / 'settled').exists(), result.stderr)
                    self.assertEqual((self.root / 'data/output.ndjson').read_text(), 'previous output')
                    self.assertTrue(list((self.root / 'data').rglob('*worker*')) or list((self.root / 'data').glob('w0_*')))

    def tournament_fixture(self):
        self.copy('scripts/zertz/tournament.mjs')
        self.write('src/games/zertz/ZertzBoard.js', '''
export default class Board {
  constructor() { this.currentPlayer=1; this.gamePhase='play'; this.winner=null; }
}
''')
        self.write('src/games/zertz/engine/mcts.js', '''
export class MCTS {
  constructor(options) { this.options=options; }
  async getBestMove(board) { return {candidate: this.options.valueNetwork?.path === 'candidate'}; }
}
export function applyMove(board, move) {
  board.winner=move.candidate ? board.currentPlayer : 3-board.currentPlayer;
  board.gamePhase='game-over';
}
''')
        self.write('src/games/zertz/engine/valueNetworkNode.js', '''
export class ValueNetwork {
  async load(path) { this.path=path; if(path==='corrupt') throw Error('corrupt'); return path!=='missing'; }
  isLoaded() { return this.path!=='unloaded'; }
  async evaluatePositionWithPolicy() { if(this.path==='bad-shape') throw Error('bad shape'); return {value:0,policy:[1]}; }
}
''')

    def test_generators_provenance_across_workers_and_legal_yinsh_setup(self):
        # Use real board geometry with a one-move fake search, exercising the
        # production generator and IPC paths without a full self-play game.
        for relative in ['src/games/yinsh/YinshBoard.js', 'src/games/yinsh/YinshNotation.js']:
            self.copy(relative)
        self.write('src/games/yinsh/engine/features.js', '''
export function extractFeatures(board) {
  const legal = new Set(board.constructor.generateGridPoints().map(p => p.join(',')));
  if(legal.size!==85 || Object.keys(board.boardState).length!==10 ||
     Object.keys(board.boardState).some(p=>!legal.has(p))) throw Error('illegal setup');
  return {board:[1],meta:[1]};
}
''')
        self.write('src/games/yinsh/engine/aiPlayer.js', '''
export function applyAIMove(board) { board.scores[1]=3; board.gamePhase='game-over'; board.winner=1; }
''')
        self.write('src/games/yinsh/engine/mcts.js', '''
export default class MCTS { async getBestMove() {
 return {move:[0,0],destination:[0,1],rootNode:{children:new Map()}};
} }
''')
        for relative in ['scripts/generate-training-data.mjs', 'scripts/worker-selfplay.mjs', 'scripts/parallel-selfplay.mjs']:
            self.copy(relative)
        (self.root / 'data').mkdir(exist_ok=True)
        result = self.node('scripts/generate-training-data.mjs', '--games', '8', '--sims', '1', '--output', 'data/single.ndjson')
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.node('scripts/parallel-selfplay.mjs', '--games', '8', '--workers', '2', '--sims', '1', '--mode', 'heuristic', '--output', 'data/parallel.ndjson')
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for name in ['single', 'parallel']
                   for line in (self.root / f'data/{name}.ndjson').read_text().splitlines()]
        self.assertEqual(len(records), 16)
        self.assertEqual(len({record['gameId'] for record in records}), 16)

        self.copy('scripts/zertz/generate-training-data.mjs')
        self.copy('scripts/zertz/parallel-selfplay.mjs')
        self.write('src/games/zertz/ZertzBoard.js', '''
export default class Board { constructor() { this.currentPlayer=1; this.gamePhase='play'; this.winner=null; } }
''')
        self.write('src/games/zertz/engine/features.js', 'export const extractFeatures=()=>({board:[1],meta:[1]});')
        self.write('src/games/zertz/engine/mcts.js', '''
export class MCTS { async getBestMove() { return {type:'place-marble',q:0,r:0}; } }
export const evaluatePosition=()=>0;
export function applyMove(board) { board.winner=1; board.gamePhase='game-over'; }
''')
        result = self.node('scripts/zertz/parallel-selfplay.mjs', '--games', '4', '--workers', '2', '--sims', '1', '--output', 'data/zertz.ndjson')
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for line in (self.root / 'data/zertz.ndjson').read_text().splitlines()]
        self.assertEqual(len(records), 4)
        self.assertEqual(len({record['gameId'] for record in records}), 4)

    def test_tournament_load_failures_and_alternating_incumbent(self):
        self.tournament_fixture()
        script = 'scripts/zertz/tournament.mjs'
        for bad in ['missing', 'corrupt', 'unloaded', 'bad-shape']:
            for side in ['--model1', '--model2']:
                args = ['--model1', 'candidate', '--model2', 'incumbent', '--games', '2']
                args[args.index(side) + 1] = bad
                result = self.node(script, *args)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('Results', result.stdout)
        result = self.node(script, '--model1', 'candidate', '--model2', 'incumbent', '--games', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('candidate=P1', result.stdout)
        self.assertIn('candidate=P2', result.stdout)
        self.assertNotEqual(self.node(script, '--model1', 'candidate').returncode, 0)
        result = self.node(script, '--mode', 'heuristic-vs-nn', '--model', 'candidate', '--games', '2')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_zertz_wrappers_continue_champion_and_gate_without_promotion(self):
        for script in ['scripts/zertz/train-iteration.sh', 'scripts/zertz/continuous-train.sh']:
            with self.subTest(script=script):
                self.copy(script)
                self.write('training/zertz/.deployed-checkpoint', 'training/zertz/checkpoints/v3.pt\n')
                self.write('training/zertz/.current-version', '4\n')
                self.write('training/zertz/checkpoints/v3.pt', 'champion')
                self.write('public/models/zertz-value-v1.onnx', 'incumbent')
                self.write('calls', '')
                python = self.write('training/.venv/bin/python3', '''#!/usr/bin/env python3
import sys, pathlib
args=sys.argv[1:]
with open('calls','a') as f: f.write('python '+repr(args)+'\\n')
if '--destination' in args: raise SystemExit('Unexpected promotion')
if args[0].endswith('/train.py'):
 assert args[args.index('--checkpoint')+1]=='training/zertz/checkpoints/v3.pt'
 pathlib.Path('training/zertz/checkpoints/best.pt').write_bytes(b'checkpoint'*50)
if '--output' in args: pathlib.Path(args[args.index('--output')+1]).write_bytes(b'model'*100)
''')
                python.chmod(0o755)
                node = self.write('bin/node', '''#!/usr/bin/env python3
import sys, pathlib
args=sys.argv[1:]
with open('calls','a') as f: f.write('node '+repr(args)+'\\n')
if 'parallel-selfplay' in args[0]:
 assert args[args.index('--mode')+1]=='nn'
 assert args[args.index('--model')+1]=='public/models/zertz-value-v1.onnx'
 pathlib.Path(args[args.index('--output')+1]).write_text('{}\\n'*100)
else:
 assert args[args.index('--mode')+1]=='nn-vs-nn'
 assert args[args.index('--model2')+1]=='public/models/zertz-value-v1.onnx'
 raise SystemExit(1)
''')
                node.chmod(0o755)
                file_cmd = self.write('bin/file', '#!/bin/sh\necho "Zip archive data"\n')
                file_cmd.chmod(0o755)
                git = self.write('bin/git', '#!/bin/sh\necho forbidden-git >> calls\nexit 99\n')
                git.chmod(0o755)
                args = ['4', '2', '1'] if 'train-iteration' in script else ['--max-iterations', '1']
                result = subprocess.run(['bash', script, *args], cwd=self.root, text=True, capture_output=True,
                                        timeout=20, env={**os.environ, 'PATH': str(self.root / 'bin') + ':' + os.environ['PATH']})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                calls = (self.root / 'calls').read_text()
                self.assertIn('--checkpoint', calls)
                self.assertIn('--model2', calls)
                self.assertNotIn('forbidden-git', calls)
                self.assertNotIn('--destination', calls)
                self.assertEqual((self.root / 'public/models/zertz-value-v1.onnx').read_text(), 'incumbent')

    def test_verified_bundle_embedded_external_and_failed_publish(self):
        import numpy as np
        import onnx
        import onnxruntime as ort
        from onnx import TensorProto, helper, numpy_helper

        graph = helper.make_graph(
            [helper.make_node('Add', ['x', 'weight'], ['y'])], 'fixture',
            [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1])],
            [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1])],
            [numpy_helper.from_array(np.array([2], dtype=np.float32), 'weight')])
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)], ir_version=8)
        target = self.root / 'deployed.onnx'
        for external in [False, True]:
            source = self.root / ('external.onnx' if external else 'embedded.onnx')
            onnx.save_model(model, source, save_as_external_data=external, all_tensors_to_one_file=True,
                            location='weights.bin', size_threshold=0)
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/verify-model.py'), str(source),
                                     '--destination', str(target)], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(any(t.data_location == TensorProto.EXTERNAL for t in onnx.load(target).graph.initializer))
            prediction = ort.InferenceSession(str(target)).run(None, {'x': np.array([3], dtype=np.float32)})
            self.assertEqual(prediction[0][0], 5)
        before = target.read_bytes()
        (self.root / 'weights.bin').unlink()
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/verify-model.py'), str(source),
                                 '--destination', str(target)], capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
