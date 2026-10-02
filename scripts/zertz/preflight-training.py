"""Reject incompatible checkpoints/history before launching v2 self-play."""
import argparse
import json
from pathlib import Path
import sys

from zertz.model import load_model
from zertz.schema import FEATURE_VERSION, record_version


def validate_deployed_model(path):
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    # Match the runtime-readable version tag used by JS modelFeatureSchema.
    names = [item.name for item in session.get_inputs()]
    if len(names) != 2 or set(names) != {'board_v2_input', 'meta_input'}:
        raise ValueError(f'Deployed ONNX must use feature-v2 inputs; got {names}. '
                         'Complete the manual v2 bootstrap before restarting these wrappers.')
    outputs = dict(zip([item.name for item in session.get_outputs()], session.run(None, {
        'board_v2_input': np.zeros((1, 6, 7, 7), dtype=np.float32),
        'meta_input': np.zeros((1, 12), dtype=np.float32),
    })))
    for name in ['value'] + (['policy'] if 'policy' in outputs else []):
        data = outputs.get(name)
        if data is None or not data.size or not np.isfinite(data).all():
            raise ValueError(f'Invalid deployed ONNX {name} output')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint')
    parser.add_argument('--deployed-model', required=True,
                        help='Incumbent ONNX path; may be absent only for scratch without a checkpoint')
    parser.add_argument('--data-dir', required=True)
    args = parser.parse_args()
    if args.checkpoint:
        model, _ = load_model(args.checkpoint)
        if model.feature_version != FEATURE_VERSION:
            raise ValueError(
                f'Checkpoint is feature-v{model.feature_version}; these wrappers generate '
                f'feature-v{FEATURE_VERSION}. Bootstrap a new v2 model manually on fresh '
                'v2 self-play WITHOUT --checkpoint, export a separate candidate, and gate '
                'it against the explicit incumbent before installing it and recording its '
                'checkpoint. See docs/ai-engine.md#zertz-feature-v2-bootstrap. '
                'Legacy jumping identity cannot be reconstructed; nothing was promoted.')
        validate_deployed_model(args.deployed_model)
    elif Path(args.deployed_model).exists():
        raise ValueError('A deployed model requires its v2 champion checkpoint; '
                         'scratch requires both incumbent artifacts to be absent.')
    # Only these files can enter the wrappers' recent-generation merge.
    for path in sorted(Path(args.data_dir).glob('v*_selfplay.ndjson')):
        with path.open() as source:
            for line_number, line in enumerate(source, 1):
                if not line.strip():
                    continue
                if record_version(json.loads(line)) != FEATURE_VERSION:
                    raise ValueError(f'{path}:{line_number} is legacy data; select a clean '
                                     'DATA_DIR for feature-v2 and retain historical files unchanged.')
    print(f'Preflight passed: feature-v{FEATURE_VERSION}, data directory {args.data_dir}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ZERTZ training preflight failed: {error}', file=sys.stderr)
        sys.exit(1)
