"""
Train the Catan policy+value network.

  training/.venv/bin/python training/catan/train.py \
    --data data/catan/gen0.ndjson --epochs 30 --output training/catan/v1.pt

Loss = value_weight * CrossEntropy(value_logits, winnerSeat)
     + heuristic_weight * MSE(value_logits[:,0] - value_logits.logsumexp normalized, heuristic)
     + policy_weight * CE(policy, visit_distribution)

Train/val is split BY GAME (not by position) to prevent within-game data
leakage.  Val accuracy reported here is honest generalisation to unseen games.
In a 4-player game, a random predictor achieves ~25% winner_acc; anything
measurably above that is real learning.
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


def run_epoch(model, loader, device, opt, value_weight, policy_weight, heuristic_weight):
    train = opt is not None
    model.train(train)
    total, batches, correct, seen = 0.0, 0, 0, 0
    for batch in loader:
        x, policy, winner, heuristic = [t.to(device) for t in batch]
        with torch.set_grad_enabled(train):
            value_logits, policy_logits = model(x)
            v_loss = F.cross_entropy(value_logits, winner)

            # Auxiliary: regress the perspective-normalised value (seat-0 logit
            # relative to the others) toward the heuristic eval score.  This
            # gives a low-variance per-position signal alongside the noisy
            # game-outcome label.
            value_probs = torch.softmax(value_logits, dim=1)
            own_prob = value_probs[:, 0]          # P(own player wins)
            h_loss = F.mse_loss(own_prob, (heuristic + 1.0) / 2.0)   # rescale [-1,1] -> [0,1]

            p_loss = -(policy * F.log_softmax(policy_logits, dim=1)).sum(dim=1).mean()
            loss = value_weight * v_loss + heuristic_weight * h_loss + policy_weight * p_loss
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
    ap.add_argument("--value-weight", type=float, default=0.5,
                    help="Weight for winner CrossEntropy (secondary bootstrap signal)")
    ap.add_argument("--policy-weight", type=float, default=1.0)
    ap.add_argument("--heuristic-weight", type=float, default=2.0,
                    help="Weight for heuristic regression (primary value signal; 0=disabled)")
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
        model.load_state_dict(torch.load(args.checkpoint, map_location=device, weights_only=True))
        print(f"resumed from {args.checkpoint}")
    print(f"params={model.count_parameters()}")
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    best, bad = float("inf"), 0
    for epoch in range(args.epochs):
        tr_loss, tr_acc = run_epoch(model, train_loader, device, opt,
                                    args.value_weight, args.policy_weight, args.heuristic_weight)
        val_loss, val_acc = run_epoch(model, val_loader, device, None,
                                      args.value_weight, args.policy_weight, args.heuristic_weight)
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
    print(f"best_val={best:.4f}  (random baseline winner_acc ~0.25 for 4P)")


if __name__ == "__main__":
    main()
