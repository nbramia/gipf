"""
Export trained PyTorch model to ONNX for browser inference.
Auto-detects model type (value-only or policy-value) from checkpoint.

Usage:
  python training/zertz/export_onnx.py --checkpoint training/zertz/checkpoints/best.pt --output /tmp/zertz-candidate.onnx
"""

import argparse
import os
import torch

from zertz.model import load_model
from zertz.schema import board_input_name


def main():
    parser = argparse.ArgumentParser(description="Export Zertz value net to ONNX")
    parser.add_argument("--checkpoint", required=True, help="Path to .pt checkpoint")
    parser.add_argument("--output", required=True, help="New candidate path; do not overwrite the deployed model")
    args = parser.parse_args()

    model, model_type = load_model(args.checkpoint)
    board_name = board_input_name(model.feature_version)
    print(f"Loaded {model_type} checkpoint with feature-v{model.feature_version}")

    param_count = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Parameters: {param_count:,}")

    # Dummy inputs matching Zertz dimensions
    board_input = torch.randn(1, model.BOARD_PLANES, 7, 7)
    meta_input = torch.randn(1, 12)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    # Configure export based on model type
    if model_type == "policy-value":
        output_names = ["value", "policy"]
        dynamic_axes = {
            board_name: {0: "batch"},
            "meta_input": {0: "batch"},
            "value": {0: "batch"},
            "policy": {0: "batch"},
        }
    else:
        output_names = ["value"]
        dynamic_axes = {
            board_name: {0: "batch"},
            "meta_input": {0: "batch"},
            "value": {0: "batch"},
        }

    # Export using legacy TorchScript exporter
    export_kwargs = dict(
        input_names=[board_name, "meta_input"],
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=17,
    )
    # dynamo=False added in PyTorch 2.6+ to force legacy exporter
    if hasattr(torch.onnx, 'dynamo_export') or tuple(int(x) for x in torch.__version__.split('.')[:2]) >= (2, 6):
        export_kwargs['dynamo'] = False
    torch.onnx.export(model, (board_input, meta_input), args.output, **export_kwargs)
    import onnx
    exported = onnx.load(args.output)
    onnx.helper.set_model_props(exported, {"zertz.feature_version": str(model.feature_version),
                                          "zertz.feature_schema": f"zertz-v{model.feature_version}"})
    onnx.checker.check_model(exported)
    onnx.save(exported, args.output)

    file_size = os.path.getsize(args.output)
    print(f"Exported to: {args.output} ({file_size / 1024:.0f} KB)")
    print(f"Model type: {model_type}, outputs: {output_names}")

    # Verify with onnxruntime
    try:
        import onnxruntime as ort
        import numpy as np

        session = ort.InferenceSession(args.output)
        result = session.run(
            None,
            {
                board_name: board_input.numpy(),
                "meta_input": meta_input.numpy(),
            },
        )
        with torch.no_grad():
            expected = model(board_input, meta_input)
        if not isinstance(expected, tuple):
            expected = (expected,)
        for actual, reference in zip(result, expected):
            np.testing.assert_allclose(actual, reference.numpy(), rtol=1e-4, atol=1e-5)
        print(f"Verification passed:")
        print(f"  Value output: {result[0].flatten()}")
        if len(result) > 1:
            print(f"  Policy output shape: {result[1].shape}")
    except ImportError:
        print("onnxruntime not installed, skipping verification")


if __name__ == "__main__":
    main()
