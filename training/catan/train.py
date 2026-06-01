"""
Train the Catan policy+value network.

  training/.venv/bin/python training/catan/train.py \
    --data data/catan/gen0.ndjson --epochs 30 --output training/catan/v1.pt

Value loss  = CrossEntropy(value_logits, winnerSeat).
Policy loss = cross-entropy of the target visit distribution vs log-softmax of
              the policy logits (AlphaZero-style; illegal moves are masked at
              inference, not in training).
"""

import argparse
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, random_split

from model import CatanPolicyValueNet
from dataset import CatanDataset


def pick_device():
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def run_epoch(model, loader, device, opt, value_weight, policy_weight):
    train = opt is not None
    model.train(train)
    total, batches, correct, seen = 0.0, 0, 0, 0
    for x, policy, winner in loader:
        x, policy, winner = x.to(device), policy.to(device), winner.to(device)
        with torch.set_grad_enabled(train):
            value_logits, policy_logits = model(x)
            v_loss = F.cross_entropy(value_logits, winner)
            p_loss = -(policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean()
            loss = value_weight * v_loss + policy_weight * p_loss
            if train:
                opt.zero_grad()
                loss.backward()
                opt.step()
        total += loss.item()
        batches += 1
        correct += (value_logits.argmax(1) == winner).sum().item()
        seen += winner.size(0)
    return total / max(1, batches), correct / max(1, seen)


def main():
    ap = argparse.ArgumentParser(description="Train Catan policy/value net")
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--output", default="training/catan/best.pt")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--value-weight", type=float, default=1.0)
    ap.add_argument("--policy-weight", type=float, default=1.0)
    args = ap.parse_args()

    device = pick_device()
    print(f"device={device}")

    dataset = CatanDataset(args.data)
    print(f"samples={len(dataset)}")
    if len(dataset) < 4:
        raise SystemExit("not enough samples")
    n_val = max(1, int(len(dataset) * args.val_frac))
    n_train = len(dataset) - n_val
    train_set, val_set = random_split(dataset, [n_train, n_val])
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    model = CatanPolicyValueNet().to(device)
    if args.checkpoint:
        model.load_state_dict(torch.load(args.checkpoint, map_location=device, weights_only=True))
        print(f"resumed from {args.checkpoint}")
    print(f"params={model.count_parameters()}")
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    best, bad = float("inf"), 0
    for epoch in range(args.epochs):
        tr_loss, tr_acc = run_epoch(model, train_loader, device, opt, args.value_weight, args.policy_weight)
        val_loss, val_acc = run_epoch(model, val_loader, device, None, args.value_weight, args.policy_weight)
        print(f"epoch {epoch:3d}  train {tr_loss:.4f} (winner_acc {tr_acc:.3f})  "
              f"val {val_loss:.4f} (winner_acc {val_acc:.3f})")
        if val_loss < best:
            best, bad = val_loss, 0
            torch.save(model.state_dict(), args.output)
            print(f"  saved {args.output}")
        else:
            bad += 1
            if bad >= args.patience:
                print("early stop")
                break
    print(f"best_val={best:.4f}")


if __name__ == "__main__":
    main()
