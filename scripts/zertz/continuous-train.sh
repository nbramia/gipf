#!/bin/bash
# continuous-train.sh — Autonomous continuous training loop for Zertz AI.
# Runs repeated self-play -> train -> tournament cycles with auto-promotion.
#
# Usage: ./scripts/zertz/continuous-train.sh [--max-iterations N]
#        caffeinate -s ./scripts/zertz/continuous-train.sh
#
# State files:
#   .current-version    — next version number to try
#   .deployed-checkpoint — path to best .pt file
#
# Press Ctrl+C to pause gracefully after the current step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

VENV=training/.venv/bin/python3
LOG_FILE=training/zertz/continuous.log
CHECKPOINT_DIR=training/zertz/checkpoints
DATA_DIR=data/zertz
MAX_ITERATIONS=${MAX_ITERATIONS:-999}
GAMES=${GAMES:-50}
SIMS=${SIMS:-200}
WORKERS=${WORKERS:-6}
PAUSED=0
WIN_COUNT=0

mkdir -p "$CHECKPOINT_DIR" "$DATA_DIR"

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --max-iterations=*) MAX_ITERATIONS="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

# Graceful pause on Ctrl+C
trap 'echo ""; echo ">>> Pause requested. Finishing current step..."; PAUSED=1' INT

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
}

check_paused() {
  if [ "$PAUSED" -eq 1 ]; then
    log "Paused by user. State saved."
    log "Resume with: ./scripts/zertz/continuous-train.sh"
    exit 0
  fi
}

verify_file() {
  local path="$1"
  local desc="$2"
  if [ ! -f "$path" ]; then
    log "ERROR: $desc missing: $path"
    return 1
  fi
  local size
  size=$(wc -c < "$path" 2>/dev/null | tr -d ' ')
  if [ "$size" -lt 100 ] 2>/dev/null; then
    log "WARNING: $desc too small (${size} bytes): $path"
    sleep 30
    size=$(wc -c < "$path" 2>/dev/null | tr -d ' ')
    if [ "$size" -lt 100 ] 2>/dev/null; then
      log "ERROR: $desc still too small after retry: $path"
      return 1
    fi
  fi
  return 0
}

# Initialize state
if [ -f .current-version ]; then
  VERSION=$(cat .current-version)
else
  LATEST=$(ls -1 "$CHECKPOINT_DIR"/v*.pt 2>/dev/null | sort -V | tail -1 | sed 's/.*v\([0-9]*\)\.pt/\1/')
  if [ -z "$LATEST" ]; then
    VERSION=1
  else
    VERSION=$((LATEST + 1))
  fi
  echo "$VERSION" > .current-version
fi

if [ -f .deployed-checkpoint ]; then
  DEPLOYED_PT=$(cat .deployed-checkpoint)
else
  DEPLOYED_PT=$(ls -1 "$CHECKPOINT_DIR"/v*.pt 2>/dev/null | sort -V | tail -1)
  if [ -n "$DEPLOYED_PT" ]; then
    echo "$DEPLOYED_PT" > .deployed-checkpoint
  fi
fi

DEPLOYED_VERSION="none"
if [ -n "${DEPLOYED_PT:-}" ] && [ -f "${DEPLOYED_PT:-}" ]; then
  DEPLOYED_VERSION=$(basename "$DEPLOYED_PT" .pt | sed 's/v//')
fi

log "================================================================"
log "  Zertz Continuous Training Loop"
log "  Starting at v${VERSION}, deployed: v${DEPLOYED_VERSION}"
log "  Games: ${GAMES} | Sims: ${SIMS} | Workers: ${WORKERS}"
log "  Max iterations: ${MAX_ITERATIONS}"
log "================================================================"

for ((iter=0; iter<MAX_ITERATIONS; iter++)); do
  check_paused

  log ""
  log "--- Iteration ${iter}: Training v${VERSION} (deployed: v${DEPLOYED_VERSION}) ---"
  ITER_START=$(date +%s)

  # Step 1: Parallel self-play
  # Use NN-guided self-play if a deployed model exists
  SELFPLAY_ARGS="--games $GAMES --sims $SIMS --output ${DATA_DIR}/v${VERSION}_selfplay.ndjson --workers $WORKERS"
  if [ -f "public/models/zertz-value-v1.onnx" ]; then
    SELFPLAY_ARGS="$SELFPLAY_ARGS --mode nn --model public/models/zertz-value-v1.onnx"
    log "Step 1/6: NN self-play (${GAMES} games, ${SIMS} sims, ${WORKERS} workers)..."
  else
    log "Step 1/6: Heuristic self-play (${GAMES} games, ${SIMS} sims, ${WORKERS} workers)..."
  fi
  check_paused
  node scripts/zertz/parallel-selfplay.mjs $SELFPLAY_ARGS 2>&1

  if ! verify_file "${DATA_DIR}/v${VERSION}_selfplay.ndjson" "Self-play data"; then
    log "Skipping v${VERSION} due to data generation failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi
  POSITIONS=$(wc -l < "${DATA_DIR}/v${VERSION}_selfplay.ndjson" | tr -d ' ')
  log "Generated ${POSITIONS} positions"

  # Step 2: Combine with recent data (last 5 generations)
  check_paused
  log "Step 2/6: Combining training data..."
  RECENT_DATA=("${DATA_DIR}/v${VERSION}_selfplay.ndjson")
  for f in $(ls -1t "${DATA_DIR}"/v*_selfplay.ndjson 2>/dev/null | grep -v "v${VERSION}_selfplay" | head -5); do
    SIZE=$(wc -c < "$f" | tr -d ' ')
    if [ "$SIZE" -gt 100 ]; then
      RECENT_DATA+=("$f")
    fi
    if [ ${#RECENT_DATA[@]} -ge 6 ]; then
      break
    fi
  done

  cat "${RECENT_DATA[@]}" > "${DATA_DIR}/combined_v${VERSION}.ndjson"
  COMBINED_LINES=$(wc -l < "${DATA_DIR}/combined_v${VERSION}.ndjson" | tr -d ' ')
  log "Combined ${#RECENT_DATA[@]} files (${COMBINED_LINES} positions)"

  # Step 3: Train
  check_paused
  log "Step 3/6: Training v${VERSION}..."

  TRAIN_ARGS="--data ${DATA_DIR}/combined_v${VERSION}.ndjson --lr 1e-4 --epochs 40 --patience 12 --model-type policy-value --augment --output-dir ${CHECKPOINT_DIR}"
  if [ -n "${DEPLOYED_PT:-}" ] && [ -f "${DEPLOYED_PT:-}" ]; then
    # Fine-tune from best checkpoint, rename output
    PYTHONPATH=training $VENV training/zertz/train.py $TRAIN_ARGS 2>&1
  else
    # First training: from scratch
    PYTHONPATH=training $VENV training/zertz/train.py $TRAIN_ARGS 2>&1
  fi

  # Rename best.pt to versioned checkpoint
  if [ -f "${CHECKPOINT_DIR}/best.pt" ]; then
    mv "${CHECKPOINT_DIR}/best.pt" "${CHECKPOINT_DIR}/v${VERSION}.pt"
  fi

  if ! verify_file "${CHECKPOINT_DIR}/v${VERSION}.pt" "Checkpoint"; then
    log "Skipping v${VERSION} due to training failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi

  # Step 4: Export ONNX
  check_paused
  log "Step 4/6: Exporting ONNX..."
  PYTHONPATH=training $VENV training/zertz/export_onnx.py \
    --checkpoint "${CHECKPOINT_DIR}/v${VERSION}.pt" \
    --output "public/models/zertz-value-v${VERSION}.onnx" 2>&1

  if ! verify_file "public/models/zertz-value-v${VERSION}.onnx" "ONNX model"; then
    log "Skipping v${VERSION} due to export failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi

  # Step 5: Tournament
  check_paused
  if [ -f "public/models/zertz-value-v1.onnx" ]; then
    log "Step 5/6: Tournament v${VERSION} vs deployed v${DEPLOYED_VERSION}..."
    set +e
    node scripts/zertz/tournament.mjs \
      --games 20 --sims 100 \
      --model "public/models/zertz-value-v${VERSION}.onnx" 2>&1
    RESULT=$?
    set -e
  else
    log "Step 5/6: No deployed model yet — auto-promoting v${VERSION}"
    RESULT=0
  fi

  ITER_END=$(date +%s)
  ITER_TIME=$(( ITER_END - ITER_START ))

  # Step 6: Promote if win
  if [ $RESULT -eq 0 ]; then
    WIN_COUNT=$((WIN_COUNT + 1))
    log "v${VERSION} WINS! Promoting as deployed model. (${ITER_TIME}s)"

    cp "public/models/zertz-value-v${VERSION}.onnx" public/models/zertz-value-v1.onnx

    DEPLOYED_PT="${CHECKPOINT_DIR}/v${VERSION}.pt"
    echo "$DEPLOYED_PT" > .deployed-checkpoint
    DEPLOYED_VERSION=$VERSION

    # Git commit + push
    git add public/models/zertz-value-v1.onnx
    git commit -m "feat: deploy zertz v${VERSION} model — continuous training win #${WIN_COUNT}" || true
    git push origin main || log "WARNING: git push failed (will retry next win)"
  else
    log "v${VERSION} did not win (exit code: ${RESULT}). (${ITER_TIME}s)"
  fi

  # Periodic checkpoint backup (every 5 versions)
  if [ $((VERSION % 5)) -eq 0 ] && [ -f "${CHECKPOINT_DIR}/v${VERSION}.pt" ]; then
    git add "${CHECKPOINT_DIR}/v${VERSION}.pt" 2>/dev/null || true
    git commit -m "chore: backup zertz checkpoint v${VERSION}" 2>/dev/null || true
    git push origin main 2>/dev/null || true
    log "Backed up checkpoint v${VERSION}"
  fi

  # Clean up temp combined files
  rm -f "${DATA_DIR}/combined_v${VERSION}.ndjson"

  # Increment version
  VERSION=$((VERSION + 1))
  echo "$VERSION" > .current-version

  log "Next version: v${VERSION}"
done

log ""
log "Continuous training complete after ${MAX_ITERATIONS} iterations."
log "Final deployed: v${DEPLOYED_VERSION}, wins: ${WIN_COUNT}"
