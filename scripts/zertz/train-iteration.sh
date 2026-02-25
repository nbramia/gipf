#!/bin/bash
# train-iteration.sh — One complete self-improvement cycle for Zertz.
#
# Usage: ./scripts/zertz/train-iteration.sh <next_version> [games] [sims]
# Example: ./scripts/zertz/train-iteration.sh 2 50 200
#
# The script:
# 1. Generates self-play data (parallel workers)
# 2. Combines with previous datasets
# 3. Trains with augmentation, fine-tuning from best checkpoint
# 4. Exports to ONNX
# 5. Runs tournament vs deployed model (or auto-promotes if first model)
# 6. Promotes if new model wins
#
# Prerequisites:
# - training/.venv exists with PyTorch, onnx, onnxruntime, onnxscript
# - public/models/zertz-value-v1.onnx is the current deployed model (if exists)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

NEXT=$1
GAMES=${2:-50}
SIMS=${3:-200}
VENV=training/.venv/bin/python3
LR=${LR:-2e-4}
CHECKPOINT_DIR=training/zertz/checkpoints
DATA_DIR=data/zertz

mkdir -p "$CHECKPOINT_DIR" "$DATA_DIR"

if [ -z "$NEXT" ]; then
  echo "Usage: $0 <next_version> [games] [sims]"
  echo "Example: $0 2 50 200"
  echo ""
  echo "Environment variables:"
  echo "  LR=3e-4  Override learning rate (default: 2e-4)"
  exit 1
fi

# Auto-detect best checkpoint
BEST_PT=$(ls -1 "$CHECKPOINT_DIR"/v*.pt 2>/dev/null | sort -V | tail -1)
if [ -z "$BEST_PT" ]; then
  echo "No existing checkpoint found — will train from scratch."
  BEST_VERSION="none"
else
  BEST_VERSION=$(basename "$BEST_PT" .pt | sed 's/v//')
fi

echo "================================================================"
echo "  Zertz Training Iteration -> v${NEXT}"
echo "  Best checkpoint: ${BEST_PT:-none} (v${BEST_VERSION})"
echo "  Games: ${GAMES} | Sims: ${SIMS} | LR: ${LR}"
echo "================================================================"

# 1. Generate self-play data
echo ""
echo "Step 1/5: Generating self-play data (${GAMES} games, ${SIMS} sims)..."
echo "---"
node scripts/zertz/parallel-selfplay.mjs \
  --games "$GAMES" --sims "$SIMS" \
  --output "${DATA_DIR}/v${NEXT}_selfplay.ndjson" \
  --workers 6

FILE_TYPE=$(file -b "${DATA_DIR}/v${NEXT}_selfplay.ndjson")
if echo "$FILE_TYPE" | grep -qi "empty"; then
  echo "ERROR: Generated data file is empty/corrupted!"
  exit 1
fi
POSITIONS=$(wc -l < "${DATA_DIR}/v${NEXT}_selfplay.ndjson" | tr -d ' ')
echo "Generated ${POSITIONS} positions."

# 2. Combine with recent data
echo ""
echo "Step 2/5: Combining training data..."
echo "---"

COMBINE_FILES="${DATA_DIR}/v${NEXT}_selfplay.ndjson"
for f in $(ls -1t "${DATA_DIR}"/v*_selfplay.ndjson 2>/dev/null | grep -v "v${NEXT}_selfplay" | head -3); do
  SIZE=$(wc -c < "$f" | tr -d ' ')
  if [ "$SIZE" -gt 100 ]; then
    COMBINE_FILES="$COMBINE_FILES $f"
  fi
done

FILE_COUNT=$(echo $COMBINE_FILES | wc -w | tr -d ' ')
if [ "$FILE_COUNT" -gt 1 ]; then
  cat $COMBINE_FILES > "${DATA_DIR}/combined_v${NEXT}.ndjson"
  TRAIN_DATA="${DATA_DIR}/combined_v${NEXT}.ndjson"
  echo "Combined ${FILE_COUNT} files"
else
  TRAIN_DATA="${DATA_DIR}/v${NEXT}_selfplay.ndjson"
fi
echo "Training data: ${TRAIN_DATA}"

# 3. Train
echo ""
echo "Step 3/5: Training v${NEXT} (LR=${LR})..."
echo "---"

PYTHONPATH=training $VENV training/zertz/train.py \
  --data "${TRAIN_DATA}" \
  --lr "${LR}" --epochs 40 --patience 12 \
  --model-type policy-value --augment \
  --output-dir "${CHECKPOINT_DIR}"

# Rename best.pt to versioned checkpoint
if [ -f "${CHECKPOINT_DIR}/best.pt" ]; then
  mv "${CHECKPOINT_DIR}/best.pt" "${CHECKPOINT_DIR}/v${NEXT}.pt"
fi

FILE_TYPE=$(file -b "${CHECKPOINT_DIR}/v${NEXT}.pt")
if ! echo "$FILE_TYPE" | grep -qi "zip"; then
  echo "ERROR: Checkpoint appears corrupted! File type: ${FILE_TYPE}"
  exit 1
fi

# 4. Export to ONNX
echo ""
echo "Step 4/5: Exporting ONNX..."
echo "---"
PYTHONPATH=training $VENV training/zertz/export_onnx.py \
  --checkpoint "${CHECKPOINT_DIR}/v${NEXT}.pt" \
  --output "public/models/zertz-value-v${NEXT}.onnx"

# 5. Tournament
echo ""
if [ -f "public/models/zertz-value-v1.onnx" ]; then
  echo "Step 5/5: Tournament v${NEXT} vs deployed model (10 games, 50 sims)..."
  echo "---"
  set +e
  node scripts/zertz/tournament.mjs --games 10 --sims 50 \
    --model "public/models/zertz-value-v${NEXT}.onnx"
  TOURNAMENT_EXIT=$?
  set -e
else
  echo "Step 5/5: No deployed model — auto-promoting v${NEXT}"
  TOURNAMENT_EXIT=0
fi

# 6. Promote
echo ""
echo "================================================================"
if [ $TOURNAMENT_EXIT -eq 0 ]; then
  echo "  v${NEXT} WINS! Promoting as deployed model."
  cp "public/models/zertz-value-v${NEXT}.onnx" public/models/zertz-value-v1.onnx
  echo "  Deployed: zertz-value-v1.onnx = v${NEXT}"
  echo ""
  echo "  Next steps:"
  echo "    git add public/models/zertz-value-v1.onnx"
  echo "    git commit -m 'feat: deploy zertz v${NEXT} model'"
  echo "    git push origin main"
else
  echo "  Deployed model wins. v${NEXT} not promoted."
  echo "  v${NEXT} saved at ${CHECKPOINT_DIR}/v${NEXT}.pt"
  echo ""
  echo "  Tip: Try combining more data or lowering LR further."
fi
echo "================================================================"

# Clean up
rm -f "${DATA_DIR}/combined_v${NEXT}.ndjson"
