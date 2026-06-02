"""
Splendor policy + value network (MLP over flat features).

Input:  216 floats = players (4*14=56) + market (12*12=144) + meta (16),
        in that order (see src/games/splendor/engine/features.js extractFeatures).
Policy: 230 logits — must match engine/features.js POLICY_SIZE.
Value:  4 seat logits (softmax -> win-prob over seats relative to the to-move
        player; index 0 = self). Trained with cross-entropy to the eventual
        winner's seat (`winnerSeat`) — the AlphaZero-style maxⁿ value target.
        At inference the NNEvaluator softmaxes these and maps them to player ids.

forward(x) -> (value_logits[B,4], policy_logits[B,230]).

Scaffold: this pipeline exists but no Splendor model is trained/deployed. See
docs/splendor.md for why (and why it may be more tractable than Catan's was).
"""

import torch
import torch.nn as nn

INPUT_SIZE = 216
POLICY_SIZE = 230
NUM_SEATS = 4


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


class SplendorPolicyValueNet(nn.Module):
    INPUT_SIZE = INPUT_SIZE
    POLICY_SIZE = POLICY_SIZE
    NUM_SEATS = NUM_SEATS

    def __init__(self, hidden=128, blocks=2, dropout=0.15):
        super().__init__()
        self.input_fc = nn.Linear(INPUT_SIZE, hidden)
        self.input_norm = nn.LayerNorm(hidden)
        self.blocks = nn.ModuleList([ResidualFC(hidden, dropout) for _ in range(blocks)])
        self.policy_head = nn.Sequential(
            nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, POLICY_SIZE)
        )
        # Seat value head: logits over the to-move-relative seats (softmax in JS).
        self.value_head = nn.Sequential(
            nn.Linear(hidden, 64), nn.ReLU(), nn.Linear(64, NUM_SEATS)
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
    model = SplendorPolicyValueNet()
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model
