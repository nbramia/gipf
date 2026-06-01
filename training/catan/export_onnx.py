"""
Export a trained Catan checkpoint to ONNX for onnxruntime-web / -node.

  training/.venv/bin/python training/catan/export_onnx.py \
    --checkpoint training/catan/v1.pt --output public/models/catan-value-v1.onnx

Single input "input" [batch, 360]; two outputs "value" [batch, 6] and
"policy" [batch, 483] (raw logits — softmax/mask applied in JS at inference).
"""

import argparse
import torch

from model import CatanPolicyValueNet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    model = CatanPolicyValueNet()
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True))
    model.eval()

    dummy = torch.zeros(1, CatanPolicyValueNet.INPUT_SIZE)
    torch.onnx.export(
        model,
        dummy,
        args.output,
        input_names=["input"],
        output_names=["value", "policy"],
        dynamic_axes={"input": {0: "batch"}, "value": {0: "batch"}, "policy": {0: "batch"}},
        opset_version=args.opset,
    )
    print(f"exported {args.output}")


if __name__ == "__main__":
    main()
