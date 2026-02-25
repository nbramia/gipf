"""
NDJSON dataset loader for Zertz value/policy-value network training.

Each line: {"board": [245 floats], "meta": [12 floats], "value": 1.0|-1.0,
            "policy": [49 floats]?, "heuristic": float?}

Policy field is optional — if missing, a uniform distribution (1/49) is used.
Heuristic field is optional — if missing, the game outcome value is used.
Supports 6-fold rotational augmentation of the hexagonal board and policy targets.
"""

import json
import numpy as np
import torch
from torch.utils.data import Dataset

GRID_SIZE = 7
OFFSET = 3
NUM_PLANES = 5
POLICY_SIZE = 49  # 7 * 7

# Hex axial coordinate rotations (60° increments around origin)
HEX_ROTATIONS = [
    lambda q, r: (q, r),           # 0°  (identity)
    lambda q, r: (-r, q + r),      # 60°
    lambda q, r: (-q - r, q),      # 120°
    lambda q, r: (-q, -r),         # 180°
    lambda q, r: (r, -q - r),      # 240°
    lambda q, r: (q + r, -q),      # 300°
]


def is_valid_hex(q, r):
    return max(abs(q), abs(r), abs(q + r)) <= 3


def rotate_board_planes(planes, rotation_idx):
    """Rotate 5x7x7 board planes using hex axial rotation."""
    if rotation_idx == 0:
        return planes.copy()

    rot = HEX_ROTATIONS[rotation_idx]
    result = np.zeros_like(planes)

    for y in range(GRID_SIZE):
        for x in range(GRID_SIZE):
            # Target axial coords
            q, r = x - OFFSET, y - OFFSET
            # Source axial coords (inverse rotation = rotate by -angle)
            inv_idx = (6 - rotation_idx) % 6
            sq, sr = HEX_ROTATIONS[inv_idx](q, r)
            sx, sy = sq + OFFSET, sr + OFFSET

            if 0 <= sx < GRID_SIZE and 0 <= sy < GRID_SIZE:
                result[:, y, x] = planes[:, sy, sx]

    return result


def rotate_policy_target(policy, rotation_idx):
    """Rotate 49-element policy target (7x7 grid) using hex axial rotation."""
    if rotation_idx == 0:
        return policy.copy()

    result = np.zeros_like(policy)
    inv_idx = (6 - rotation_idx) % 6

    for y in range(GRID_SIZE):
        for x in range(GRID_SIZE):
            q, r = x - OFFSET, y - OFFSET
            sq, sr = HEX_ROTATIONS[inv_idx](q, r)
            sx, sy = sq + OFFSET, sr + OFFSET

            if 0 <= sx < GRID_SIZE and 0 <= sy < GRID_SIZE:
                result[y * GRID_SIZE + x] = policy[sy * GRID_SIZE + sx]

    return result


UNIFORM_POLICY = np.full(POLICY_SIZE, 1.0 / POLICY_SIZE, dtype=np.float32)


class ZertzDataset(Dataset):
    def __init__(self, filepath, augment=False):
        self.boards = []
        self.metas = []
        self.values = []
        self.policies = []
        self.heuristics = []

        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                board = np.array(record["board"], dtype=np.float32).reshape(NUM_PLANES, GRID_SIZE, GRID_SIZE)
                meta = np.array(record["meta"], dtype=np.float32)
                value = np.float32(record["value"])

                # Policy target: use recorded distribution or uniform fallback
                if "policy" in record:
                    policy = np.array(record["policy"], dtype=np.float32)
                else:
                    policy = UNIFORM_POLICY.copy()

                # Heuristic evaluation: use recorded value or fall back to game outcome
                heuristic = np.float32(record.get("heuristic", value))

                if augment:
                    # Add all 6 rotations (including identity)
                    for rot_idx in range(6):
                        self.boards.append(rotate_board_planes(board, rot_idx))
                        self.metas.append(meta.copy())  # meta is rotation-invariant
                        self.values.append(value)
                        self.policies.append(rotate_policy_target(policy, rot_idx))
                        self.heuristics.append(heuristic)
                else:
                    self.boards.append(board)
                    self.metas.append(meta)
                    self.values.append(value)
                    self.policies.append(policy)
                    self.heuristics.append(heuristic)

        self.boards = np.array(self.boards)
        self.metas = np.array(self.metas)
        self.values = np.array(self.values)
        self.policies = np.array(self.policies)
        self.heuristics = np.array(self.heuristics)

    def __len__(self):
        return len(self.values)

    def __getitem__(self, idx):
        return (
            torch.from_numpy(self.boards[idx]),
            torch.from_numpy(self.metas[idx]),
            torch.tensor(self.values[idx], dtype=torch.float32),
            torch.from_numpy(self.policies[idx]),
            torch.tensor(self.heuristics[idx], dtype=torch.float32),
        )
