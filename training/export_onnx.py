"""
Export trained PyTorch model to ONNX for browser inference.
Auto-detects model type (value-only or policy-value) from checkpoint.

Usage:
  python training/export_onnx.py --checkpoint training/best.pt --output public/models/yinsh-value-v1.onnx
"""

import argparse
import os
import torch

from model import YinshValueNet, YinshPolicyValueNet


def detect_model_type(state_dict):
    """Detect model type from state dict keys."""
    for key in state_dict:
        if key.startswith("policy_"):
            return "policy-value"
    return "value"


def main():
    parser = argparse.ArgumentParser(description="Export Yinsh value net to ONNX")
    parser.add_argument("--checkpoint", required=True, help="Path to .pt checkpoint")
    parser.add_argument("--output", default="public/models/yinsh-value-v1.onnx")
    args = parser.parse_args()

    # Load checkpoint and detect model type
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
        state_dict = ckpt["model_state_dict"]
        model_type = ckpt.get("model_type", detect_model_type(state_dict))
        print(f"Loaded full checkpoint (epoch {ckpt.get('epoch', '?')}, type: {model_type})")
    else:
        state_dict = ckpt
        model_type = detect_model_type(state_dict)
        print(f"Loaded legacy state_dict (type: {model_type})")

    # Create appropriate model
    if model_type == "policy-value":
        model = YinshPolicyValueNet()
    else:
        model = YinshValueNet()

    model.load_state_dict(state_dict)
    model.eval()

    # Dummy inputs
    board_planes = torch.randn(1, 4, 11, 11)
    meta = torch.randn(1, 5)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    # Configure export based on model type
    if model_type == "policy-value":
        output_names = ["value", "policy"]
        dynamic_axes = {
            "board_planes": {0: "batch"},
            "meta": {0: "batch"},
            "value": {0: "batch"},
            "policy": {0: "batch"},
        }
    else:
        output_names = ["value"]
        dynamic_axes = {
            "board_planes": {0: "batch"},
            "meta": {0: "batch"},
            "value": {0: "batch"},
        }

    # Export using legacy TorchScript exporter
    export_kwargs = dict(
        input_names=["board_planes", "meta"],
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=17,
    )
    # dynamo=False added in PyTorch 2.6+ to force legacy exporter
    if hasattr(torch.onnx, 'dynamo_export') or tuple(int(x) for x in torch.__version__.split('.')[:2]) >= (2, 6):
        export_kwargs['dynamo'] = False
    torch.onnx.export(model, (board_planes, meta), args.output, **export_kwargs)

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
                "board_planes": board_planes.numpy(),
                "meta": meta.numpy(),
            },
        )
        print(f"Verification passed:")
        print(f"  Value output: {result[0].flatten()}")
        if len(result) > 1:
            print(f"  Policy output shape: {result[1].shape}")
    except ImportError:
        print("onnxruntime not installed, skipping verification")


if __name__ == "__main__":
    main()
