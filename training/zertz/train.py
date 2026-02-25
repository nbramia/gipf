"""
Training loop for Zertz value / policy-value network.

Usage:
  python training/zertz/train.py --data data/zertz/train.ndjson --epochs 40
  python training/zertz/train.py --data data/zertz/new.ndjson --checkpoint training/zertz/checkpoints/v1.pt --epochs 40
  python training/zertz/train.py --data data/zertz/new.ndjson --data-append data/zertz/old.ndjson --merge-ratio 0.5
  python training/zertz/train.py --data data/zertz/new.ndjson --model-type policy-value --augment --epochs 40
"""

import argparse
import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, random_split, ConcatDataset, Subset

from zertz.model import ZertzValueNet, ZertzPolicyValueNet
from zertz.dataset import ZertzDataset


def main():
    parser = argparse.ArgumentParser(description="Train Zertz value/policy-value network")
    parser.add_argument("--data", required=True, help="Path to NDJSON training data")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--output-dir", default="training/zertz/checkpoints", help="Output directory")
    parser.add_argument("--patience", type=int, default=8, help="Early stop patience")
    parser.add_argument("--checkpoint", default=None, help="Resume from checkpoint")
    parser.add_argument("--data-append", default=None, help="Additional NDJSON data to merge")
    parser.add_argument("--merge-ratio", type=float, default=0.5, help="Proportion of appended data to keep (0-1)")
    parser.add_argument("--augment", action="store_true", help="6-fold hex rotation augmentation")
    parser.add_argument("--model-type", default="policy-value", choices=["value", "policy-value"],
                        help="Model type: 'value' (legacy) or 'policy-value' (default)")
    args = parser.parse_args()

    use_policy = args.model_type == "policy-value"
    output_path = os.path.join(args.output_dir, "best.pt")
    os.makedirs(args.output_dir, exist_ok=True)

    # Device selection: MPS (Apple Silicon) > CUDA > CPU
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")
    print(f"Device: {device}")

    # Load primary data
    dataset = ZertzDataset(args.data, augment=args.augment)
    print(f"Primary data: {len(dataset)} positions" + (" (6x augmented)" if args.augment else ""))

    # Optionally merge additional data
    if args.data_append:
        append_dataset = ZertzDataset(args.data_append, augment=args.augment)
        n_keep = int(len(append_dataset) * args.merge_ratio)
        if n_keep > 0:
            indices = torch.randperm(len(append_dataset))[:n_keep].tolist()
            append_subset = Subset(append_dataset, indices)
            dataset = ConcatDataset([dataset, append_subset])
            print(f"Appended data: {len(append_dataset)} positions, kept {n_keep} ({args.merge_ratio*100:.0f}%)")
        print(f"Total training data: {len(dataset)} positions")

    # Train/val split (90/10)
    val_size = max(1, int(len(dataset) * 0.1))
    train_size = len(dataset) - val_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size)

    print(f"Train: {train_size}, Val: {val_size}")

    # Model
    if use_policy:
        model = ZertzPolicyValueNet().to(device)
    else:
        model = ZertzValueNet().to(device)
    param_count = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Model: {args.model_type} | Parameters: {param_count:,}")

    # Training config
    value_criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=1e-5
    )

    # Optionally load checkpoint (with warm-start support for value → policy-value)
    if args.checkpoint:
        ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
        if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
            state_dict = ckpt["model_state_dict"]
            ckpt_model_type = ckpt.get("model_type", "value")
        else:
            state_dict = ckpt
            ckpt_model_type = "value"

        # Warm-start: load matching keys, skip missing ones (policy head gets random init)
        missing, unexpected = model.load_state_dict(state_dict, strict=False)
        if missing:
            print(f"Warm-start: {len(missing)} new params (randomly initialized): {[k.split('.')[0] for k in missing[:3]]}...")
        if unexpected:
            print(f"Ignored {len(unexpected)} unexpected keys from checkpoint")
        if not missing and not unexpected:
            print(f"Loaded checkpoint (full match): {args.checkpoint}")
        else:
            print(f"Loaded checkpoint ({ckpt_model_type} → {args.model_type}): {args.checkpoint}")
        model = model.to(device)

    # Always start fresh for best_val_loss — new data has different distribution
    best_val_loss = float("inf")
    patience_counter = 0

    for epoch in range(args.epochs):
        # Train
        model.train()
        train_loss = 0.0
        train_vloss = 0.0
        train_ploss = 0.0
        train_correct = 0
        train_total = 0

        for boards, metas, values, policies in train_loader:
            boards = boards.to(device)
            metas = metas.to(device)
            values = values.to(device)
            policies = policies.to(device)

            optimizer.zero_grad()

            if use_policy:
                value_pred, policy_logits = model(boards, metas)
                value_pred = value_pred.squeeze(-1)

                # Combined loss: MSE for value + cross-entropy for policy
                v_loss = value_criterion(value_pred, values)
                log_probs = F.log_softmax(policy_logits, dim=1)
                p_loss = -(policies * log_probs).sum(dim=1).mean()
                loss = v_loss + p_loss

                train_vloss += v_loss.item() * boards.size(0)
                train_ploss += p_loss.item() * boards.size(0)
            else:
                value_pred = model(boards, metas).squeeze(-1)
                loss = value_criterion(value_pred, values)
                train_vloss += loss.item() * boards.size(0)

            loss.backward()
            optimizer.step()

            train_loss += loss.item() * boards.size(0)
            train_correct += ((value_pred > 0) == (values > 0)).sum().item()
            train_total += boards.size(0)

        scheduler.step()

        train_avg = train_loss / max(train_total, 1)
        train_vacc = train_correct / max(train_total, 1) * 100
        train_vmse = train_vloss / max(train_total, 1)
        train_pce = train_ploss / max(train_total, 1) if use_policy else 0

        # Validate
        model.eval()
        val_loss = 0.0
        val_vloss = 0.0
        val_ploss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for boards, metas, values, policies in val_loader:
                boards = boards.to(device)
                metas = metas.to(device)
                values = values.to(device)
                policies = policies.to(device)

                if use_policy:
                    value_pred, policy_logits = model(boards, metas)
                    value_pred = value_pred.squeeze(-1)
                    v_loss = value_criterion(value_pred, values)
                    log_probs = F.log_softmax(policy_logits, dim=1)
                    p_loss = -(policies * log_probs).sum(dim=1).mean()
                    loss = v_loss + p_loss
                    val_vloss += v_loss.item() * boards.size(0)
                    val_ploss += p_loss.item() * boards.size(0)
                else:
                    value_pred = model(boards, metas).squeeze(-1)
                    loss = value_criterion(value_pred, values)
                    val_vloss += loss.item() * boards.size(0)

                val_loss += loss.item() * boards.size(0)
                val_correct += ((value_pred > 0) == (values > 0)).sum().item()
                val_total += boards.size(0)

        val_avg = val_loss / max(val_total, 1)
        val_vacc = val_correct / max(val_total, 1) * 100
        val_vmse = val_vloss / max(val_total, 1)
        val_pce = val_ploss / max(val_total, 1) if use_policy else 0

        lr = optimizer.param_groups[0]["lr"]
        if use_policy:
            print(
                f"Epoch {epoch+1:3d}/{args.epochs} | "
                f"Train V:{train_vmse:.4f} P:{train_pce:.4f} Acc:{train_vacc:.1f}% | "
                f"Val V:{val_vmse:.4f} P:{val_pce:.4f} Acc:{val_vacc:.1f}% | "
                f"LR: {lr:.2e}"
            )
        else:
            print(
                f"Epoch {epoch+1:3d}/{args.epochs} | "
                f"Train MSE: {train_vmse:.4f} Acc: {train_vacc:.1f}% | "
                f"Val MSE: {val_vmse:.4f} Acc: {val_vacc:.1f}% | "
                f"LR: {lr:.2e}"
            )

        # Early stopping on total validation loss
        if val_avg < best_val_loss:
            best_val_loss = val_avg
            patience_counter = 0
            # Save full checkpoint with model type metadata
            torch.save({
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scheduler_state_dict": scheduler.state_dict(),
                "epoch": epoch,
                "best_val_loss": best_val_loss,
                "model_type": args.model_type,
            }, output_path)
            print(f"  -> Saved best model (val loss: {val_avg:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"Early stopping at epoch {epoch+1}")
                break

    print(f"\nBest val loss: {best_val_loss:.4f}")
    print(f"Model saved to: {output_path}")


if __name__ == "__main__":
    main()
