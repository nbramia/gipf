"""
NDJSON dataset for Catan policy/value training.

Each line (from scripts/catan/generate-training-data.mjs):
  {"tiles":[240], "players":[108], "meta":[12], "policy":[483],
   "winnerSeat": int, "value": float, ...}

Input  = concat(tiles, players, meta) = 360 floats.
Value target  = winnerSeat (perspective-relative class index, 0-based) for
                CrossEntropy over 6 seats.
Policy target = the visit distribution over 483 move slots (may be all-zero for
                forced moves; those contribute no policy loss).
Positions with no decided winner (winnerSeat < 0) are skipped.
"""

import json
import numpy as np
import torch
from torch.utils.data import Dataset

INPUT_SIZE = 360
POLICY_SIZE = 483


class CatanDataset(Dataset):
    def __init__(self, paths):
        if isinstance(paths, str):
            paths = [paths]
        self.x = []
        self.policy = []
        self.winner = []
        for path in paths:
            with open(path) as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    obj = json.loads(line)
                    seat = obj.get("winnerSeat", -1)
                    if seat is None or seat < 0:
                        continue
                    feats = (obj.get("tiles") or []) + (obj.get("players") or []) + (obj.get("meta") or [])
                    if len(feats) != INPUT_SIZE:
                        continue
                    policy = obj.get("policy") or []
                    if len(policy) != POLICY_SIZE:
                        policy = [0.0] * POLICY_SIZE
                    self.x.append(np.asarray(feats, dtype=np.float32))
                    self.policy.append(np.asarray(policy, dtype=np.float32))
                    self.winner.append(int(seat))

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return (
            torch.from_numpy(self.x[idx]),
            torch.from_numpy(self.policy[idx]),
            torch.tensor(self.winner[idx], dtype=torch.long),
        )
