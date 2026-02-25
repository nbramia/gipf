"""
Yinsh neural networks — CNN with residual blocks.

YinshValueNet (~315K params): Value-only network for position evaluation.
YinshPolicyValueNet (~345K params): Dual-head network with policy + value outputs.

Shared architecture:
  Input:  4 x 11 x 11 planes + 5 scalars
  Conv2d(4, 64, 3x3, pad=1) -> BN -> ReLU
  ResBlock(64) x 4  [Conv->BN->ReLU->Conv->BN + skip]

Value head:
  Conv2d(64, 1, 1x1) -> BN -> ReLU -> Flatten(121)
  Concat(121 + 5 meta = 126)
  Linear(126, 128) -> ReLU -> Linear(128, 1) -> Tanh
  Output: scalar in [-1, +1]

Policy head (YinshPolicyValueNet only):
  Conv2d(64, 2, 1x1) -> BN -> ReLU -> Flatten(242) -> Linear(242, 121)
  Output: 121 raw logits (softmax applied after masking in MCTS)
"""

import torch
import torch.nn as nn


class ResBlock(nn.Module):
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
        return torch.relu(out + residual)


class YinshValueNet(nn.Module):
    def __init__(self, num_planes=4, grid_size=11, num_meta=5, channels=64, num_blocks=4, fc_size=128):
        super().__init__()
        self.grid_size = grid_size

        # Input conv
        self.input_conv = nn.Conv2d(num_planes, channels, 3, padding=1, bias=False)
        self.input_bn = nn.BatchNorm2d(channels)

        # Residual blocks
        self.res_blocks = nn.Sequential(*[ResBlock(channels) for _ in range(num_blocks)])

        # Value head
        self.value_conv = nn.Conv2d(channels, 1, 1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        flat_size = grid_size * grid_size  # 121
        self.fc1 = nn.Linear(flat_size + num_meta, fc_size)
        self.fc2 = nn.Linear(fc_size, 1)

    def forward(self, board_planes, meta):
        """
        Args:
            board_planes: (batch, 4, 11, 11) float tensor
            meta: (batch, 5) float tensor
        Returns:
            value: (batch, 1) float tensor in [-1, 1]
        """
        x = torch.relu(self.input_bn(self.input_conv(board_planes)))
        x = self.res_blocks(x)

        # Value head
        v = torch.relu(self.value_bn(self.value_conv(x)))
        v = v.view(v.size(0), -1)  # (batch, 121)
        v = torch.cat([v, meta], dim=1)  # (batch, 126)
        v = torch.relu(self.fc1(v))
        v = torch.tanh(self.fc2(v))
        return v


class YinshPolicyValueNet(nn.Module):
    """Dual-head network: shared trunk + value head + policy head."""

    def __init__(self, num_planes=4, grid_size=11, num_meta=5, channels=64, num_blocks=4, fc_size=128):
        super().__init__()
        self.grid_size = grid_size

        # Shared trunk (same as YinshValueNet)
        self.input_conv = nn.Conv2d(num_planes, channels, 3, padding=1, bias=False)
        self.input_bn = nn.BatchNorm2d(channels)
        self.res_blocks = nn.Sequential(*[ResBlock(channels) for _ in range(num_blocks)])

        # Value head (same as YinshValueNet)
        self.value_conv = nn.Conv2d(channels, 1, 1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        flat_size = grid_size * grid_size  # 121
        self.fc1 = nn.Linear(flat_size + num_meta, fc_size)
        self.fc2 = nn.Linear(fc_size, 1)

        # Policy head
        self.policy_conv = nn.Conv2d(channels, 2, 1, bias=False)
        self.policy_bn = nn.BatchNorm2d(2)
        self.policy_fc = nn.Linear(2 * flat_size, flat_size)  # 242 -> 121

    def forward(self, board_planes, meta):
        """
        Args:
            board_planes: (batch, 4, 11, 11) float tensor
            meta: (batch, 5) float tensor
        Returns:
            value: (batch, 1) float tensor in [-1, 1]
            policy: (batch, 121) float tensor (raw logits)
        """
        x = torch.relu(self.input_bn(self.input_conv(board_planes)))
        x = self.res_blocks(x)

        # Value head
        v = torch.relu(self.value_bn(self.value_conv(x)))
        v = v.view(v.size(0), -1)  # (batch, 121)
        v = torch.cat([v, meta], dim=1)  # (batch, 126)
        v = torch.relu(self.fc1(v))
        v = torch.tanh(self.fc2(v))

        # Policy head
        p = torch.relu(self.policy_bn(self.policy_conv(x)))
        p = p.view(p.size(0), -1)  # (batch, 242)
        p = self.policy_fc(p)  # (batch, 121)

        return v, p


def count_parameters(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    # Test value-only network
    net = YinshValueNet()
    print(f"YinshValueNet parameters: {count_parameters(net):,}")
    board = torch.randn(2, 4, 11, 11)
    meta = torch.randn(2, 5)
    out = net(board, meta)
    print(f"  Value output shape: {out.shape}, values: {out.detach().numpy().flatten()}")

    # Test policy-value network
    pvnet = YinshPolicyValueNet()
    print(f"\nYinshPolicyValueNet parameters: {count_parameters(pvnet):,}")
    value, policy = pvnet(board, meta)
    print(f"  Value output shape: {value.shape}, values: {value.detach().numpy().flatten()}")
    print(f"  Policy output shape: {policy.shape}, sum: {policy.detach().sum(dim=1).numpy()}")
