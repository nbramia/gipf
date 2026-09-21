"""Run with PYTHONPATH=training python -m unittest discover -s tests -p 'test_training*.py'."""
import copy
import importlib
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import os
import subprocess
import sys

import numpy as np
from torch.utils.data import DataLoader


class SplitTests(unittest.TestCase):
    def modules(self):
        for module, name, shape, meta in [
            ('dataset', 'YinshDataset', (4, 11, 11), 5),
            ('zertz.dataset', 'ZertzDataset', (5, 7, 7), 12),
        ]:
            yield importlib.import_module(module), name, shape, meta

    def records(self, shape, meta, count=20):
        return [dict(board=np.zeros(shape).ravel().tolist(), meta=[i] * meta,
                     value=1, gameId=f'game-{i // 2}') for i in range(count)]

    def test_group_split_and_train_only_augmentation(self):
        for module, name, shape, meta in self.modules():
            records = self.records(shape, meta)
            train, val = module.split_records(records, seed=8)
            self.assertTrue({r['gameId'] for r in train}.isdisjoint(r['gameId'] for r in val))
            self.assertEqual((train, val), module.split_records(records, seed=8))
            self.assertNotEqual(val, module.split_records(records, seed=9)[1])
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'data.ndjson'
                path.write_text(''.join(json.dumps(r) + '\n' for r in records))
                training, validation = module.load_split(path, seed=8, augment=True)
            self.assertEqual(len(training), len(train) * 6)
            self.assertEqual(len(validation), len(val))
            self.assertEqual(len(next(iter(DataLoader(training, batch_size=256)))[0]), len(training))
            for i in range(len(train)):
                for rotation in range(6):
                    np.testing.assert_array_equal(training.boards[i * 6 + rotation],
                                                  module.rotate_board_planes(training.boards[i * 6], rotation))

    def test_legacy_identical_rotations_and_labels_stay_together(self):
        for module, name, shape, meta in self.modules():
            records = self.records(shape, meta)
            original = records[0]
            original.pop('gameId')
            board = np.zeros(shape, dtype=np.float32)
            board[0, shape[1] // 2, shape[2] // 2 + 1] = 1
            original['board'] = board.ravel().tolist()
            sibling = copy.deepcopy(original)
            sibling['board'] = module.rotate_board_planes(board, 1).ravel().tolist()
            sibling['value'] = -1
            records.append(sibling)
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                train, val = module.split_records(records)
            self.assertIn('source-game isolation cannot be guaranteed', str(caught[0].message))
            self.assertEqual(original in train, sibling in train)
            self.assertEqual(original in val, sibling in val)

    def test_tiny_empty_single_group_and_small_batches(self):
        for module, name, shape, meta in self.modules():
            for records in [[], self.records(shape, meta, 1), self.records(shape, meta, 2)]:
                with self.assertRaisesRegex(ValueError, 'at least two independent'):
                    module.split_records(records)
            train, val = module.split_records(self.records(shape, meta, 3))
            dataset = getattr(module, name)(records=train)
            self.assertGreater(len(list(DataLoader(dataset, batch_size=256))), 0)
            self.assertGreater(len(val), 0)

    def test_append_duplicate_game_stays_together(self):
        for module, name, shape, meta in self.modules():
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'data.ndjson'
                path.write_text(''.join(json.dumps(r) + '\n' for r in self.records(shape, meta)))
                train, val = module.load_split(path, path, 1, seed=17)
                self.assertTrue({r['gameId'] for r in train.records}.isdisjoint(r['gameId'] for r in val.records))

    def test_real_trainers_take_a_step_with_tiny_data(self):
        root = Path(__file__).resolve().parents[1]
        for module, name, shape, meta in self.modules():
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'data.ndjson'
                path.write_text(''.join(json.dumps(r) + '\n' for r in self.records(shape, meta, 3)))
                zertz = name == 'ZertzDataset'
                script = str(root / ('training/zertz/train.py' if zertz else 'training/train.py'))
                output = ['--output-dir', directory] if zertz else ['--output', str(Path(directory) / 'best.pt')]
                command = [sys.executable, '-c',
                           'import torch, runpy, sys; torch.set_num_threads(1); '
                           'torch.backends.mps.is_available=lambda:False; '
                           'torch.cuda.is_available=lambda:False; '
                           'sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")',
                           script, '--data', str(path), '--epochs', '1', '--batch-size', '256', *output]
                result = subprocess.run(command, capture_output=True, text=True, timeout=30,
                                        env={**os.environ, 'PYTHONPATH': str(root / 'training')})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('Epoch   1/1', result.stdout)
                self.assertTrue((Path(directory) / 'best.pt').exists())


if __name__ == '__main__':
    unittest.main()
