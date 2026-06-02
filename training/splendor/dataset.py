"""
Splendor self-play dataset loader.

Reads the NDJSON produced by scripts/splendor/generate-training-data.mjs. Each
line has: players[56], market[144], meta[16], policy[230], value (in {-1,0,1}),
winnerSeat (0..3 or -1), heuristic, player, numPlayers, gameId.

Features are concatenated players+market+meta -> 216 floats (the order the JS
NNEvaluator feeds the model). Targets: policy distribution (KL/CE) and the
winner seat class (cross-entropy). gameId enables a leakage-free train/val split
(group positions by game). Scaffold — see docs/splendor.md.
"""

import json
import torch
from torch.utils.data import Dataset

INPUT_SIZE = 216
POLICY_SIZE = 230


def _as_list(paths):
    return [paths] if isinstance(paths, str) else list(paths)


class SplendorDataset(Dataset):
    def __init__(self, paths, game_ids=None):
        self.rows = []
        for path in _as_list(paths):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    if game_ids is not None and row.get("gameId") not in game_ids:
                        continue
                    if row.get("winnerSeat", -1) < 0:
                        continue  # undecided positions carry no value label
                    self.rows.append(row)

    @staticmethod
    def all_game_ids(paths):
        ids = set()
        for path in _as_list(paths):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        ids.add(json.loads(line).get("gameId"))
        return sorted(ids)

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        row = self.rows[i]
        x = torch.tensor(row["players"] + row["market"] + row["meta"], dtype=torch.float32)
        assert x.numel() == INPUT_SIZE, f"expected {INPUT_SIZE} features, got {x.numel()}"
        policy = torch.tensor(row["policy"], dtype=torch.float32)
        seat = torch.tensor(int(row["winnerSeat"]), dtype=torch.long)
        return x, policy, seat
