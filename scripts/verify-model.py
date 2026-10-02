"""Validate a complete ONNX bundle; optionally publish it as one embedded file.

External tensors are loaded and checked before touching the deployed path.
"""
import argparse
import os
from pathlib import Path
import tempfile

import onnx
import onnxruntime as ort


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--destination")
    args = parser.parse_args()
    model = onnx.load(args.source, load_external_data=True)
    onnx.external_data_helper.convert_model_from_external_data(model)
    onnx.checker.check_model(model)
    data = model.SerializeToString()
    ort.InferenceSession(data, providers=["CPUExecutionProvider"])
    if args.destination:
        target = Path(args.destination)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as staging:
            temporary = staging.name
            staging.write(data)
        try:
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print(f"Verified model bundle: {args.source}")


if __name__ == "__main__":
    main()
