#!/bin/bash
# train-iteration.sh — One complete self-improvement cycle.
#
# Usage: ./scripts/train-iteration.sh <next_version> [games] [sims]
# Example: ./scripts/train-iteration.sh 14 50 200
#
# The script:
# 1. Generates self-play data from the deployed model (v1.onnx)
# 2. Combines with previous high-quality datasets
# 3. Trains with augmentation, fine-tuning from best checkpoint
# 4. Exports to ONNX
# 5. Runs 20-game tournament vs deployed model
# 6. Promotes if new model wins
#
# Prerequisites:
# - training/.venv exists with PyTorch, onnx, onnxruntime, onnxscript
# - public/models/yinsh-value-v1.onnx is the current deployed model
# - The best .pt checkpoint exists (auto-detected)

set -e

NEXT=$1
GAMES=${2:-50}
SIMS=${3:-200}
VENV=training/.venv/bin/python3
LR=${LR:-2e-4}

if [ -z "$NEXT" ]; then
  echo "Usage: $0 <next_version> [games] [sims]"
  echo "Example: $0 14 50 200"
  echo ""
  echo "Environment variables:"
  echo "  LR=3e-4  Override learning rate (default: 2e-4)"
  exit 1
fi

# Auto-detect best checkpoint (highest numbered .pt file)
BEST_PT=$(ls -1 training/v*.pt 2>/dev/null | sort -V | tail -1)
if [ -z "$BEST_PT" ]; then
  echo "ERROR: No training/v*.pt checkpoints found"
  exit 1
fi
BEST_VERSION=$(basename "$BEST_PT" .pt | sed 's/v//')

echo "═══════════════════════════════════════════════════════════"
echo "  Training iteration → v${NEXT}"
echo "  Best checkpoint: ${BEST_PT} (v${BEST_VERSION})"
echo "  Games: ${GAMES} | Sims: ${SIMS} | LR: ${LR}"
echo "═══════════════════════════════════════════════════════════"

# 1. Generate self-play data from deployed model
echo ""
echo "Step 1/5: Generating self-play data (${GAMES} games, ${SIMS} sims)..."
echo "─────────────────────────────────────────────────────────"
node scripts/generate-training-data.mjs \
  --games $GAMES --sims $SIMS \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/v${NEXT}_selfplay.ndjson

# Verify data file
FILE_TYPE=$(file -b "data/v${NEXT}_selfplay.ndjson")
if echo "$FILE_TYPE" | grep -qi "empty"; then
  echo "ERROR: Generated data file is empty/corrupted!"
  exit 1
fi
POSITIONS=$(wc -l < "data/v${NEXT}_selfplay.ndjson" | tr -d ' ')
echo "Generated ${POSITIONS} positions. File type: ${FILE_TYPE}"

# 2. Combine with recent high-quality data (150+ sims)
echo ""
echo "Step 2/5: Combining training data..."
echo "─────────────────────────────────────────────────────────"

# Find the 2-3 most recent self-play files (excluding the one we just generated)
COMBINE_FILES="data/v${NEXT}_selfplay.ndjson"
APPEND_FILE=""
for f in $(ls -1t data/v*_selfplay.ndjson 2>/dev/null | grep -v "v${NEXT}_selfplay"); do
  SIZE=$(wc -c < "$f" | tr -d ' ')
  if [ "$SIZE" -gt 100 ]; then
    if [ -z "$APPEND_FILE" ]; then
      # First older file becomes the --data-append secondary data
      APPEND_FILE="$f"
    else
      # Additional files get combined into primary
      COMBINE_FILES="$COMBINE_FILES $f"
    fi
  fi
  # Stop after collecting 3 additional files
  COUNT=$(echo "$COMBINE_FILES $APPEND_FILE" | wc -w | tr -d ' ')
  if [ "$COUNT" -ge 4 ]; then
    break
  fi
done

# If we have multiple primary files, combine them
PRIMARY_FILE="data/v${NEXT}_selfplay.ndjson"
FILE_COUNT=$(echo $COMBINE_FILES | wc -w | tr -d ' ')
if [ "$FILE_COUNT" -gt 1 ]; then
  cat $COMBINE_FILES > "data/combined_v${NEXT}.ndjson"
  PRIMARY_FILE="data/combined_v${NEXT}.ndjson"
  echo "Combined ${FILE_COUNT} files into ${PRIMARY_FILE}"
fi
echo "Primary data: ${PRIMARY_FILE}"
echo "Secondary data: ${APPEND_FILE:-none}"

# 3. Train with augmentation
echo ""
echo "Step 3/5: Training v${NEXT} (augmented, LR=${LR})..."
echo "─────────────────────────────────────────────────────────"

TRAIN_CMD="$VENV training/train.py \
  --data ${PRIMARY_FILE} \
  --checkpoint ${BEST_PT} \
  --augment --lr ${LR} --epochs 40 --patience 12 \
  --output training/v${NEXT}.pt"

if [ -n "$APPEND_FILE" ]; then
  TRAIN_CMD="$TRAIN_CMD --data-append ${APPEND_FILE} --merge-ratio 0.3"
fi

eval $TRAIN_CMD

# Verify checkpoint
FILE_TYPE=$(file -b "training/v${NEXT}.pt")
if ! echo "$FILE_TYPE" | grep -qi "zip"; then
  echo "ERROR: Checkpoint appears corrupted! File type: ${FILE_TYPE}"
  exit 1
fi

# 4. Export to ONNX
echo ""
echo "Step 4/5: Exporting ONNX..."
echo "─────────────────────────────────────────────────────────"
$VENV training/export_onnx.py \
  --checkpoint training/v${NEXT}.pt \
  --output public/models/yinsh-value-v${NEXT}.onnx

# Verify ONNX files
for f in "public/models/yinsh-value-v${NEXT}.onnx" "public/models/yinsh-value-v${NEXT}.onnx.data"; do
  FILE_TYPE=$(file -b "$f")
  if echo "$FILE_TYPE" | grep -qi "empty"; then
    echo "ERROR: ONNX file corrupted: $f"
    exit 1
  fi
done

# 5. Tournament: new vs deployed (20 games)
echo ""
echo "Step 5/5: Tournament v${NEXT} vs deployed model (20 games, 50 sims)..."
echo "─────────────────────────────────────────────────────────"
set +e
node scripts/tournament.mjs --games 10 --sims 50 \
  --mode nn-vs-nn \
  --model1 public/models/yinsh-value-v${NEXT}.onnx \
  --model2 public/models/yinsh-value-v1.onnx
TOURNAMENT_EXIT=$?
set -e

# 6. Promote if new model wins
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $TOURNAMENT_EXIT -eq 0 ]; then
  echo "  v${NEXT} WINS! Promoting as deployed model."
  cp public/models/yinsh-value-v${NEXT}.onnx public/models/yinsh-value-v1.onnx
  cp public/models/yinsh-value-v${NEXT}.onnx.data public/models/yinsh-value-v1.onnx.data
  # Verify deployment
  FILE_TYPE=$(file -b "public/models/yinsh-value-v1.onnx.data")
  echo "  Deployed: yinsh-value-v1.onnx = v${NEXT} (verified: ${FILE_TYPE})"
  echo ""
  echo "  Next steps:"
  echo "    git add public/models/yinsh-value-v1.onnx public/models/yinsh-value-v1.onnx.data"
  echo "    git commit -m 'feat: deploy v${NEXT} model'"
  echo "    git push origin main"
elif [ $TOURNAMENT_EXIT -eq 2 ]; then
  echo "  Tournament TIED. Keeping deployed model."
  echo "  v${NEXT} saved at training/v${NEXT}.pt but not promoted."
  echo ""
  echo "  Tip: Try combining more data or lowering LR further."
else
  echo "  Deployed model wins. v${NEXT} not promoted."
  echo "  v${NEXT} saved at training/v${NEXT}.pt but not promoted."
  echo ""
  echo "  Tip: Try combining more data or lowering LR further."
fi
echo "═══════════════════════════════════════════════════════════"
