"""
Catan policy + value network (MLP over flat features).

Input:  360 floats = tiles (30*8=240) + players (6*18=108) + meta (12),
        in that order (see src/games/catan/engine/features.js extractFeatures).
Policy: 483 logits — must match engine/features.js POLICY_SIZE.
Value:  scalar tanh in [-1, 1], matching evaluatePosition(board, currentPlayer).
        Trained with MSE regression to the heuristic eval score (behavioral
        cloning / distillation). At inference the NNEvaluator converts it to a
        player win-probability vector via (scalar+1)/2 for the to-move player.

forward(x) -> (value_scalar[B,1], policy_logits[B,483]).
"""

import torch
import torch.nn as nn

INPUT_SIZE = 360
POLICY_SIZE = 483


class ResidualFC(nn.Module):
    def __init__(self, dim, dropout=0.1):
        super().__init__()
        self.fc1 = nn.Linear(dim, dim)
        self.fc2 = nn.Linear(dim, dim)
        self.norm = nn.LayerNorm(dim)
        self.drop = nn.Dropout(dropout)

    def forward(self, x):
        h = torch.relu(self.fc1(x))
        h = self.drop(h)
        h = self.fc2(h)
        return torch.relu(self.norm(x + h))


class CatanPolicyValueNet(nn.Module):
    INPUT_SIZE = INPUT_SIZE
    POLICY_SIZE = POLICY_SIZE

    def __init__(self, hidden=128, blocks=2, dropout=0.15):
        super().__init__()
        self.input_fc = nn.Linear(INPUT_SIZE, hidden)
        self.input_norm = nn.LayerNorm(hidden)
        self.blocks = nn.ModuleList([ResidualFC(hidden, dropout) for _ in range(blocks)])
        self.policy_head = nn.Sequential(
            nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, POLICY_SIZE)
        )
        # Scalar value head: outputs tanh ∈ [-1,1] matching evaluatePosition range.
        self.value_head = nn.Sequential(
            nn.Linear(hidden, 64), nn.ReLU(), nn.Linear(64, 1), nn.Tanh()
        )

    def forward(self, x):
        h = torch.relu(self.input_norm(self.input_fc(x)))
        for block in self.blocks:
            h = block(h)
        return self.value_head(h), self.policy_head(h)

    def count_parameters(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def load_model(path_or_state, device="cpu"):
    state = (
        torch.load(path_or_state, map_location=device, weights_only=True)
        if isinstance(path_or_state, str)
        else path_or_state
    )
    model = CatanPolicyValueNet()
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model
