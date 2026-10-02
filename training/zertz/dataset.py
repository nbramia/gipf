"""
NDJSON dataset loader for Zertz value/policy-value network training.

Each v2 line: {"featureVersion": 2, "board": [294 floats], "meta": [12 floats], "value": 1.0|-1.0,
            "policy": [49 floats]?, "heuristic": float?}

Policy field is optional — if missing, a uniform distribution (1/49) is used.
Heuristic field is optional — if missing, the game outcome value is used.
Supports 6-fold rotational augmentation of the hexagonal board and policy targets.
"""

import json
import hashlib
import warnings
import numpy as np
import torch
from torch.utils.data import Dataset
from zertz.schema import board_planes, records_version

GRID_SIZE = 7
OFFSET = 3
NUM_PLANES = 6
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
    """Rotate all 5 (v1) or 6 (v2) planes, including forced-jump identity."""
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
    def __init__(self, filepath=None, augment=False, records=None):
        self.boards = []
        self.metas = []
        self.values = []
        self.policies = []
        self.heuristics = []

        if records is None:
            records = read_records(filepath)
        self.feature_version = records_version(records)
        num_planes = board_planes(self.feature_version)
        self.records = records
        for record in records:
            board = np.array(record["board"], dtype=np.float32).reshape(num_planes, GRID_SIZE, GRID_SIZE)
            meta = np.array(record["meta"], dtype=np.float32)
            if not np.isfinite(board).all() or not np.isfinite(meta).all():
                raise ValueError("ZERTZ features must contain finite floats")
            if self.feature_version == 2:
                jumping = board[5]
                if not np.isin(jumping, [0, 1]).all() or jumping.sum() > 1:
                    raise ValueError("ZERTZ v2 jumping plane must be zero or one-hot")
                if jumping.sum():
                    y, x = np.argwhere(jumping)[0]
                    if not is_valid_hex(int(x) - OFFSET, int(y) - OFFSET) or not board[0, y, x] or not board[1:4, y, x].any() or not np.isclose(meta[10], 0.66):
                        raise ValueError("ZERTZ v2 forced jumper must mark a marble on a ring in capture phase")
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


def read_records(filepath):
    with open(filepath) as source:
        return [json.loads(line) for line in source if line.strip()]


def split_records(records, seed=42):
    """Hold out source games; legacy records use rotation-canonical inputs.

    Legacy provenance cannot be reconstructed. Matching legacy inputs also tie
    known games together to prevent a duplicated legacy position leaking across.
    Labels/policies are deliberately excluded from position identity.
    """
    feature_version = records_version(records)
    num_planes = board_planes(feature_version)
    legacy = sum(not record.get("gameId") for record in records)
    if legacy:
        warnings.warn(f"{legacy} legacy records lack gameId: splitting by canonical "
                      "board/meta identity; source-game isolation cannot be guaranteed.",
                      UserWarning)
    parents = list(range(len(records)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    def join(a, b):
        parents[root(a)] = root(b)

    games = {}
    positions = {}
    legacy_positions = set()
    for i, record in enumerate(records):
        game = record.get("gameId")
        if game:
            if game in games:
                join(i, games[game])
            games[game] = i
        if not legacy:
            continue
        board = np.asarray(record["board"], dtype=np.float32).reshape((num_planes, GRID_SIZE, GRID_SIZE))
        canonical = min(rotate_board_planes(board, r).tobytes() for r in range(6))
        key = hashlib.sha256(canonical + np.asarray(record["meta"], dtype=np.float32).tobytes()).digest()
        positions.setdefault(key, []).append(i)
        if not game:
            legacy_positions.add(key)
    for key in legacy_positions:
        indices = positions[key]
        for i in indices[1:]:
            join(i, indices[0])
    groups = {}
    for i in range(len(records)):
        groups.setdefault(root(i), []).append(i)
    if len(groups) < 2:
        raise ValueError("Need at least two independent source groups for train/validation; "
                         "collect more games (or distinct legacy positions).")
    keys = list(groups)
    np.random.default_rng(seed).shuffle(keys)
    val_keys = set(keys[:max(1, int(len(keys) * 0.1))])
    train, validation = [], []
    for key, indices in groups.items():
        target = validation if key in val_keys else train
        target.extend(records[i] for i in indices)
    return train, validation


def load_split(filepath, append_path=None, merge_ratio=0.5, seed=42, augment=False):
    if not 0 <= merge_ratio <= 1:
        raise ValueError("merge-ratio must be between 0 and 1")
    records = read_records(filepath)
    if append_path:
        extra = read_records(append_path)
        # Validate before sampling: even a low merge ratio cannot hide a mixed schema.
        records_version(records + extra)
        indices = np.random.default_rng(seed).permutation(len(extra))[:int(len(extra) * merge_ratio)]
        records.extend(extra[i] for i in indices)
    train, validation = split_records(records, seed)
    return ZertzDataset(records=train, augment=augment), ZertzDataset(records=validation)
