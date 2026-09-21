"""ZERTZ feature contracts. V1 is deliberately preserved, never padded implicitly."""

FEATURE_VERSION = 2
GRID_SIZE = 7
META_SIZE = 12


def board_planes(version):
    if type(version) is not int or version not in (1, 2):
        raise ValueError(f"Unsupported ZERTZ feature version: {version!r}")
    return 5 if version == 1 else 6


def board_input_name(version):
    board_planes(version)
    return "board_input" if version == 1 else "board_v2_input"


def record_version(record):
    # Missing tags are accepted only for the exact historical representation.
    version = record.get("featureVersion", 1)
    expected = board_planes(version) * GRID_SIZE * GRID_SIZE
    if len(record.get("board", [])) != expected or len(record.get("meta", [])) != META_SIZE:
        raise ValueError(f"ZERTZ feature-v{version} record requires {expected} board and "
                         f"{META_SIZE} meta floats; v2 requires featureVersion: 2 and fresh "
                         "forced-jump identity (legacy arrays cannot supply it)")
    return version


def records_version(records):
    versions = {record_version(record) for record in records}
    if len(versions) > 1:
        raise ValueError("Cannot mix ZERTZ feature-v1 and feature-v2 examples; "
                         "regenerate v2 self-play instead of inventing legacy jumping identity")
    return next(iter(versions), FEATURE_VERSION)


def checkpoint_state(checkpoint):
    """Read tagged checkpoints and untagged five-plane legacy state dictionaries."""
    state = checkpoint.get("model_state_dict", checkpoint)
    weight = state.get("input_conv.weight")
    if weight is None or weight.ndim != 4:
        raise ValueError("Invalid ZERTZ checkpoint: missing input convolution weights")
    version = checkpoint.get("feature_version")
    if version is None:
        if weight.shape[1] != 5:
            raise ValueError("Untagged ZERTZ checkpoint is not legacy v1; feature_version is required")
        version = 1
    if weight.shape[1] != board_planes(version):
        raise ValueError(f"ZERTZ checkpoint feature-v{version} conflicts with input convolution shape")
    return state, version
