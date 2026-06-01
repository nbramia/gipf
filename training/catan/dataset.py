"""
NDJSON dataset for Catan policy/value training.

Each line (from scripts/catan/generate-training-data.mjs):
  {"tiles":[240], "players":[108], "meta":[12], "policy":[483],
   "winnerSeat": int, "heuristic": float, "numPlayers": int, ...}

Input  = concat(tiles, players, meta) = 360 floats.
Value targets:
  - winnerSeat: perspective-relative class index (0 = own player) for
    CrossEntropy.  All positions in one game share the same label, so we
    MUST split by game (not by position) to prevent data leakage.
  - heuristic: the per-position heuristic eval score (a lower-variance
    per-position signal used as a regression auxiliary target to warm-start
    the value head and stabilise early training).
Policy target = the MCTS visit distribution over 483 move slots.

Game-level splitting: load all data grouped by (path, game_index) so the
caller can split on games rather than positions.  This ensures that all
positions from one game go entirely into train OR val -- not both -- giving
honest generalisation metrics.

Positions with no decided winner (winnerSeat < 0) are skipped.
"""

import json
import numpy as np
import torch
from torch.utils.data import Dataset

INPUT_SIZE = 360
POLICY_SIZE = 483


def load_games(paths):
    """Load positions grouped by game.

    Game boundaries are detected in priority order:
    1. 'gameId' field in the record (new data; exact).
    2. Heuristic: the meta[1] feature = turnNumber/40 drops back near 0 at
       the start of each new game. A significant drop (> 0.1) signals a new
       game. Reliable for old data without the gameId field.
    Returns a list of games, each being a list of (x, policy, winner, heuristic).
    """
    if isinstance(paths, str):
        paths = [paths]
    all_games = []
    for path in paths:
        current_game = []
        prev_game_id = None
        prev_turn_norm = None
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
                heuristic = float(obj.get("heuristic") or 0.0)
                game_id = obj.get("gameId")
                turn_norm = feats[240 + 108 + 1]  # meta[1] = turnNumber/40

                # Detect game boundary.
                new_game = False
                if game_id is not None:
                    new_game = (game_id != prev_game_id and prev_game_id is not None)
                    prev_game_id = game_id
                elif prev_turn_norm is not None and prev_turn_norm > 0.1 and turn_norm < 0.05:
                    new_game = True  # turnNumber reset -> new game
                prev_turn_norm = turn_norm

                if new_game and current_game:
                    all_games.append(current_game)
                    current_game = []
                current_game.append((
                    np.asarray(feats, dtype=np.float32),
                    np.asarray(policy, dtype=np.float32),
                    int(seat),
                    heuristic,
                ))
        if current_game:
            all_games.append(current_game)
    return all_games


class CatanDataset(Dataset):
    """Flat position dataset built from a list of (x, policy, winner, heuristic) tuples."""

    def __init__(self, positions):
        self.x = [p[0] for p in positions]
        self.policy = [p[1] for p in positions]
        self.winner = [p[2] for p in positions]
        self.heuristic = [p[3] for p in positions]

    @classmethod
    def from_paths(cls, paths, val_frac=0.0):
        """Load data with game-level train/val split to prevent leakage.

        Returns (train_dataset, val_dataset) if val_frac > 0, else one dataset.
        """
        games = load_games(paths)
        if val_frac > 0:
            n_val = max(1, int(len(games) * val_frac))
            # Put the last n_val games in val (they tend to be later gens with
            # better data; keeping them out of train is a safe choice).
            import random
            random.shuffle(games)
            train_games, val_games = games[n_val:], games[:n_val]
            train_pos = [p for g in train_games for p in g]
            val_pos = [p for g in val_games for p in g]
            return cls(train_pos), cls(val_pos)
        positions = [p for g in games for p in g]
        return cls(positions)

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return (
            torch.from_numpy(self.x[idx]),
            torch.from_numpy(self.policy[idx]),
            torch.tensor(self.winner[idx], dtype=torch.long),
            torch.tensor(self.heuristic[idx], dtype=torch.float32),
        )
