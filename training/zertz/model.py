"""
Zertz neural networks for position evaluation and move policy.

Two architectures:
  ZertzValueNet       — value-only (~200K params)
  ZertzPolicyValueNet — policy + value dual-head (~230K params)

Shared trunk:
  Input: 5 x 7 x 7 planes + 12 scalars
  Conv2d(5, 64, 3x3, pad=1) -> BN -> ReLU
  ResBlock(64) x 4
"""

import torch
import torch.nn as nn


class ResBlock(nn.Module):
    """Residual block with two 3x3 convolutions."""

    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = torch.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = torch.relu(out + residual)
        return out


class ZertzValueNet(nn.Module):
    """Value-only network for Zertz position evaluation."""

    BOARD_PLANES = 5
    GRID_SIZE = 7
    META_SIZE = 12
    CHANNELS = 64
    NUM_RES_BLOCKS = 4

    def __init__(self):
        super().__init__()

        self.input_conv = nn.Conv2d(self.BOARD_PLANES, self.CHANNELS, 3, padding=1, bias=False)
        self.input_bn = nn.BatchNorm2d(self.CHANNELS)

        self.res_blocks = nn.Sequential(
            *[ResBlock(self.CHANNELS) for _ in range(self.NUM_RES_BLOCKS)]
        )

        self.value_conv = nn.Conv2d(self.CHANNELS, 1, 1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(self.GRID_SIZE * self.GRID_SIZE + self.META_SIZE, 128)
        self.value_fc2 = nn.Linear(128, 1)

    def forward(self, board_input, meta_input):
        x = torch.relu(self.input_bn(self.input_conv(board_input)))
        x = self.res_blocks(x)

        v = torch.relu(self.value_bn(self.value_conv(x)))
        v = v.view(v.size(0), -1)
        v = torch.cat([v, meta_input], dim=1)
        v = torch.relu(self.value_fc1(v))
        v = torch.tanh(self.value_fc2(v))

        return v

    def count_parameters(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


class ZertzPolicyValueNet(nn.Module):
    """Policy + value dual-head network for Zertz.

    Value head:  scalar in [-1, +1]
    Policy head: 49 logits over 7x7 grid (raw, softmax applied at inference)
    """

    BOARD_PLANES = 5
    GRID_SIZE = 7
    POLICY_SIZE = 49  # 7 * 7
    META_SIZE = 12
    CHANNELS = 64
    NUM_RES_BLOCKS = 4

    def __init__(self):
        super().__init__()

        # Shared trunk
        self.input_conv = nn.Conv2d(self.BOARD_PLANES, self.CHANNELS, 3, padding=1, bias=False)
        self.input_bn = nn.BatchNorm2d(self.CHANNELS)
        self.res_blocks = nn.Sequential(
            *[ResBlock(self.CHANNELS) for _ in range(self.NUM_RES_BLOCKS)]
        )

        # Value head
        self.value_conv = nn.Conv2d(self.CHANNELS, 1, 1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(self.GRID_SIZE * self.GRID_SIZE + self.META_SIZE, 128)
        self.value_fc2 = nn.Linear(128, 1)

        # Policy head
        self.policy_conv = nn.Conv2d(self.CHANNELS, 2, 1, bias=False)
        self.policy_bn = nn.BatchNorm2d(2)
        self.policy_fc = nn.Linear(2 * self.GRID_SIZE * self.GRID_SIZE, self.POLICY_SIZE)

    def forward(self, board_input, meta_input):
        """
        Args:
            board_input: (batch, 5, 7, 7)
            meta_input: (batch, 12)
        Returns:
            value: (batch, 1) in [-1, 1]
            policy: (batch, 49) raw logits
        """
        # Shared trunk
        x = torch.relu(self.input_bn(self.input_conv(board_input)))
        x = self.res_blocks(x)

        # Value head
        v = torch.relu(self.value_bn(self.value_conv(x)))
        v = v.view(v.size(0), -1)  # (batch, 49)
        v = torch.cat([v, meta_input], dim=1)  # (batch, 61)
        v = torch.relu(self.value_fc1(v))
        v = torch.tanh(self.value_fc2(v))

        # Policy head
        p = torch.relu(self.policy_bn(self.policy_conv(x)))
        p = p.view(p.size(0), -1)  # (batch, 98)
        p = self.policy_fc(p)  # (batch, 49) raw logits

        return v, p

    def count_parameters(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def detect_model_type(state_dict):
    """Detect model type from state dict keys."""
    for key in state_dict:
        if key.startswith("policy_"):
            return "policy-value"
    return "value"


def load_model(state_dict_or_path, device='cpu'):
    """Load a model, auto-detecting type."""
    if isinstance(state_dict_or_path, str):
        state_dict = torch.load(state_dict_or_path, map_location=device, weights_only=True)
    else:
        state_dict = state_dict_or_path

    model_type = detect_model_type(state_dict)
    if model_type == "policy-value":
        model = ZertzPolicyValueNet()
    else:
        model = ZertzValueNet()

    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    return model, model_type
