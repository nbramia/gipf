"""
Train the Splendor policy+value network on self-play NDJSON.

  training/.venv/bin/python training/splendor/train.py \
    --data data/splendor/combined.ndjson --output training/splendor/v1.pt \
    --epochs 40 --lr 3e-4

Loss = policy cross-entropy (soft targets) + value cross-entropy (winner seat).
Train/val split is grouped by gameId to avoid leakage between positions of the
same game. Scaffold — no Splendor model is trained/deployed yet; see
docs/splendor.md for the (Catan-informed) reasons and what cracking it needs.
"""

import argparse
import random

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from dataset import SplendorDataset
from model import SplendorPolicyValueNet


def policy_loss(logits, target):
    logp = F.log_softmax(logits, dim=1)
    return -(target * logp).sum(dim=1).mean()


def run_epoch(model, loader, opt, device, train):
    model.train(train)
    total, n = 0.0, 0
    for x, policy, seat in loader:
        x, policy, seat = x.to(device), policy.to(device), seat.to(device)
        value_logits, policy_logits = model(x)
        loss = policy_loss(policy_logits, policy) + F.cross_entropy(value_logits, seat)
        if train:
            opt.zero_grad()
            loss.backward()
            opt.step()
        total += loss.item() * x.size(0)
        n += x.size(0)
    return total / max(1, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--patience", type=int, default=12)
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ids = SplendorDataset.all_game_ids(args.data)
    random.Random(0).shuffle(ids)
    cut = int(len(ids) * (1 - args.val_frac))
    train_ids, val_ids = set(ids[:cut]), set(ids[cut:])

    train_ds = SplendorDataset(args.data, train_ids)
    val_ds = SplendorDataset(args.data, val_ids)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True)
    val_dl = DataLoader(val_ds, batch_size=args.batch)

    model = SplendorPolicyValueNet().to(device)
    if args.checkpoint:
        model.load_state_dict(torch.load(args.checkpoint, map_location=device, weights_only=True))
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    print(f"params={model.count_parameters()} train={len(train_ds)} val={len(val_ds)} device={device}")
    best, since = float("inf"), 0
    for epoch in range(args.epochs):
        tr = run_epoch(model, train_dl, opt, device, True)
        with torch.no_grad():
            va = run_epoch(model, val_dl, opt, device, False)
        print(f"epoch {epoch + 1}: train={tr:.4f} val={va:.4f}")
        if va < best:
            best, since = va, 0
            torch.save(model.state_dict(), args.output)
        else:
            since += 1
            if since >= args.patience:
                print("early stop")
                break
    print(f"best val={best:.4f} -> {args.output}")


if __name__ == "__main__":
    main()
