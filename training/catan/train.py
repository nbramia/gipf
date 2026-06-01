"""
Train the Catan policy+value network.

  training/.venv/bin/python training/catan/train.py \
    --data data/catan/gen0.ndjson --epochs 30 --output training/catan/v1.pt

Value loss = MSE(value_scalar, heuristic_eval).
  The value head outputs tanh in [-1, 1], matching evaluatePosition's range.
  Training target is the per-position heuristic eval (dense, low-variance,
  accurate). This is pure behavioral cloning / distillation — the net learns
  to replicate the heuristic's position assessment from raw features.
  Once this works, NN self-play data bootstraps beyond the heuristic.

Policy loss = CE(policy_logits, visit_distribution) — unchanged.

Train/val split is BY GAME to prevent within-game data leakage.
Val MSE target is ~0 for a random model; lower is better. The heuristic eval
has zero mean (tanh of a zero-mean score), so val MSE < 0.5 is meaningful.
"""

import argparse
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from model import CatanPolicyValueNet
from dataset import CatanDataset


def pick_device():
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def run_epoch(model, loader, device, opt, policy_weight, outcome_weight):
    train = opt is not None
    model.train(train)
    total_value, total_policy, batches = 0.0, 0.0, 0
    for batch in loader:
        x, policy, winner, heuristic = [t.to(device) for t in batch]
        with torch.set_grad_enabled(train):
            value_scalar, policy_logits = model(x)
            # Blended value target: track the heuristic eval (stable, dense), but
            # drift toward the actual game outcome so the value can learn things
            # the heuristic misses (the path to exceeding it). outcome = +1 if the
            # perspective player won (winnerSeat 0), else -1.
            outcome = torch.where(winner == 0, torch.ones_like(heuristic), -torch.ones_like(heuristic))
            target = heuristic * (1.0 - outcome_weight) + outcome * outcome_weight
            v_loss = F.mse_loss(value_scalar.squeeze(1), target)
            # Policy: cross-entropy against visit distribution
            p_loss = -(policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean()
            loss = v_loss + policy_weight * p_loss
            if train:
                opt.zero_grad()
                loss.backward()
                opt.step()
        total_value += v_loss.item()
        total_policy += p_loss.item()
        batches += 1
    n = max(1, batches)
    return total_value / n, total_policy / n


def main():
    ap = argparse.ArgumentParser(description="Train Catan policy/value net")
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--output", default="training/catan/best.pt")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--policy-weight", type=float, default=1.0)
    ap.add_argument("--outcome-weight", type=float, default=0.0,
                    help="Blend toward game outcome vs heuristic eval. FINDING: any "
                         ">0 hurts — the per-position win/loss label is too noisy over "
                         "700-move stochastic games (0.15 -> val_mse 0.05 and 5%% win "
                         "vs the heuristic, vs 16.7%% for pure distillation). Keep at 0.")
    # Legacy args (ignored — kept for backward compat with train-loop.mjs)
    ap.add_argument("--value-weight", type=float, default=0.5)
    ap.add_argument("--heuristic-weight", type=float, default=2.0)
    args = ap.parse_args()

    device = pick_device()
    print(f"device={device}")

    train_set, val_set = CatanDataset.from_paths(args.data, val_frac=args.val_frac)
    print(f"games split: train={len(train_set)} positions  val={len(val_set)} positions (game-level split)")
    if len(train_set) < 4:
        raise SystemExit("not enough training samples")

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    model = CatanPolicyValueNet().to(device)
    if args.checkpoint:
        try:
            model.load_state_dict(torch.load(args.checkpoint, map_location=device, weights_only=True))
            print(f"resumed from {args.checkpoint}")
        except Exception as e:
            print(f"checkpoint incompatible ({e}), training fresh")
    print(f"params={model.count_parameters()}")
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    best_val, patience_count = float("inf"), 0
    for epoch in range(args.epochs):
        tr_v, tr_p = run_epoch(model, train_loader, device, opt, args.policy_weight, args.outcome_weight)
        va_v, va_p = run_epoch(model, val_loader, device, None, args.policy_weight, args.outcome_weight)
        print(f"epoch {epoch:3d}  train value_mse={tr_v:.4f} policy={tr_p:.4f}  "
              f"val value_mse={va_v:.4f} policy={va_p:.4f}")
        if va_v < best_val:
            best_val, patience_count = va_v, 0
            torch.save(model.state_dict(), args.output)
            print(f"  saved {args.output}")
        else:
            patience_count += 1
            if patience_count >= args.patience:
                print("early stop")
                break
    print(f"best_val_mse={best_val:.4f}  (perfect=0, random≈var(heuristic)≈0.1)")


if __name__ == "__main__":
    main()
