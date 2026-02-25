#!/bin/bash
# continuous-train.sh — Autonomous continuous training loop.
# Runs repeated self-play → train → tournament cycles with auto-promotion.
#
# Usage: ./scripts/continuous-train.sh [--max-iterations N]
#        caffeinate -s ./scripts/continuous-train.sh
#
# State files:
#   .current-version    — next version number to try
#   .deployed-checkpoint — path to best .pt file
#
# Press Ctrl+C to pause gracefully after the current step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

VENV=training/.venv/bin/python3
LOG_FILE=training/continuous.log
MAX_ITERATIONS=${MAX_ITERATIONS:-999}
GAMES=${GAMES:-50}
SIMS=${SIMS:-200}
WORKERS=${WORKERS:-6}
PAUSED=0
WIN_COUNT=0

# Parse args
for arg in "$@"; do
  case "$arg" in
    --max-iterations) shift; MAX_ITERATIONS=$1; shift ;;
    --max-iterations=*) MAX_ITERATIONS="${arg#*=}" ;;
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
    log "Resume with: ./scripts/continuous-train.sh"
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
  # Use file size as primary check (avoids APFS I/O stalls with `file` command)
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
  # Auto-detect from highest existing checkpoint
  LATEST=$(ls -1 training/v*.pt 2>/dev/null | sort -V | tail -1 | sed 's/.*v\([0-9]*\)\.pt/\1/')
  VERSION=$((LATEST + 1))
  echo "$VERSION" > .current-version
fi

if [ -f .deployed-checkpoint ]; then
  DEPLOYED_PT=$(cat .deployed-checkpoint)
else
  DEPLOYED_PT=$(ls -1 training/v*.pt 2>/dev/null | sort -V | tail -1)
  echo "$DEPLOYED_PT" > .deployed-checkpoint
fi
DEPLOYED_VERSION=$(basename "$DEPLOYED_PT" .pt | sed 's/v//')

log "═══════════════════════════════════════════════════════════"
log "  Continuous Training Loop"
log "  Starting at v${VERSION}, deployed: v${DEPLOYED_VERSION}"
log "  Games: ${GAMES} | Sims: ${SIMS} | Workers: ${WORKERS}"
log "  Max iterations: ${MAX_ITERATIONS}"
log "═══════════════════════════════════════════════════════════"

for ((iter=0; iter<MAX_ITERATIONS; iter++)); do
  check_paused

  log ""
  log "━━━ Iteration ${iter}: Training v${VERSION} (deployed: v${DEPLOYED_VERSION}) ━━━"
  ITER_START=$(date +%s)

  # Step 1: Parallel self-play
  log "Step 1/6: Parallel self-play (${GAMES} games, ${SIMS} sims, ${WORKERS} workers)..."
  check_paused
  node scripts/parallel-selfplay.mjs \
    --games "$GAMES" --sims "$SIMS" \
    --mode nn --model public/models/yinsh-value-v1.onnx \
    --output "data/v${VERSION}_selfplay.ndjson" \
    --workers "$WORKERS" 2>&1

  if ! verify_file "data/v${VERSION}_selfplay.ndjson" "Self-play data"; then
    log "Skipping v${VERSION} due to data generation failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi
  POSITIONS=$(wc -l < "data/v${VERSION}_selfplay.ndjson" | tr -d ' ')
  log "Generated ${POSITIONS} positions"

  # Step 2: Combine with recent data (last 3 generations)
  check_paused
  log "Step 2/6: Combining training data..."
  RECENT_DATA=("data/v${VERSION}_selfplay.ndjson")
  for f in $(ls -1t data/v*_selfplay.ndjson 2>/dev/null | grep -v "v${VERSION}_selfplay" | head -5); do
    SIZE=$(wc -c < "$f" | tr -d ' ')
    if [ "$SIZE" -gt 100 ]; then
      RECENT_DATA+=("$f")
    fi
    if [ ${#RECENT_DATA[@]} -ge 6 ]; then
      break
    fi
  done

  # Primary = first 4 files combined, append = next 2
  PRIMARY_FILES=("${RECENT_DATA[@]:0:4}")
  APPEND_FILES=("${RECENT_DATA[@]:4}")

  cat "${PRIMARY_FILES[@]}" > "data/combined_v${VERSION}.ndjson"
  COMBINED_LINES=$(wc -l < "data/combined_v${VERSION}.ndjson" | tr -d ' ')
  log "Combined ${#PRIMARY_FILES[@]} files (${COMBINED_LINES} positions)"

  APPEND_ARG=""
  if [ ${#APPEND_FILES[@]} -gt 0 ]; then
    cat "${APPEND_FILES[@]}" > "data/append_v${VERSION}.ndjson"
    APPEND_ARG="--data-append data/append_v${VERSION}.ndjson --merge-ratio 0.3"
    log "Append data: ${#APPEND_FILES[@]} files"
  fi

  # Step 3: Train
  check_paused
  log "Step 3/6: Training v${VERSION}..."
  $VENV training/train.py \
    --data "data/combined_v${VERSION}.ndjson" \
    --checkpoint "$DEPLOYED_PT" \
    --augment --lr 1e-4 --epochs 40 --patience 12 \
    --model-type policy-value \
    --output "training/v${VERSION}.pt" \
    $APPEND_ARG 2>&1

  if ! verify_file "training/v${VERSION}.pt" "Checkpoint"; then
    log "Skipping v${VERSION} due to training failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi

  # Step 4: Export ONNX
  check_paused
  log "Step 4/6: Exporting ONNX..."
  $VENV training/export_onnx.py \
    --checkpoint "training/v${VERSION}.pt" \
    --output "public/models/yinsh-value-v${VERSION}.onnx" 2>&1

  if ! verify_file "public/models/yinsh-value-v${VERSION}.onnx" "ONNX model"; then
    log "Skipping v${VERSION} due to export failure"
    VERSION=$((VERSION + 1))
    echo "$VERSION" > .current-version
    continue
  fi

  # Step 5: SPRT Tournament
  check_paused
  log "Step 5/6: SPRT Tournament v${VERSION} vs v${DEPLOYED_VERSION}..."
  set +e
  node scripts/tournament.mjs \
    --games 10 --sims 50 \
    --mode nn-vs-nn \
    --model1 "public/models/yinsh-value-v${VERSION}.onnx" \
    --model2 public/models/yinsh-value-v1.onnx \
    --sprt 2>&1
  RESULT=$?
  set -e

  ITER_END=$(date +%s)
  ITER_TIME=$(( ITER_END - ITER_START ))

  # Step 6: Promote if win
  if [ $RESULT -eq 0 ]; then
    WIN_COUNT=$((WIN_COUNT + 1))
    log "v${VERSION} WINS! Promoting as deployed model. (${ITER_TIME}s)"

    cp "public/models/yinsh-value-v${VERSION}.onnx" public/models/yinsh-value-v1.onnx
    # Copy .data file if it exists (policy-value models may have external data)
    if [ -f "public/models/yinsh-value-v${VERSION}.onnx.data" ]; then
      cp "public/models/yinsh-value-v${VERSION}.onnx.data" public/models/yinsh-value-v1.onnx.data
    fi

    DEPLOYED_PT="training/v${VERSION}.pt"
    echo "$DEPLOYED_PT" > .deployed-checkpoint
    DEPLOYED_VERSION=$VERSION

    # Git commit + push
    git add public/models/yinsh-value-v1.onnx
    if [ -f public/models/yinsh-value-v1.onnx.data ]; then
      git add public/models/yinsh-value-v1.onnx.data
    fi
    git commit -m "feat: deploy v${VERSION} model — continuous training win #${WIN_COUNT}" || true
    git push origin main || log "WARNING: git push failed (will retry next win)"

    # Advanced model is pinned to v104 — no auto-promotion
    # To update: manually copy the desired ONNX to yinsh-value-advanced.onnx
  else
    log "v${VERSION} did not win (exit code: ${RESULT}). (${ITER_TIME}s)"
  fi

  # Periodic checkpoint backup (every 5 versions)
  if [ $((VERSION % 5)) -eq 0 ] && [ -f "training/v${VERSION}.pt" ]; then
    git add "training/v${VERSION}.pt" 2>/dev/null || true
    git commit -m "chore: backup checkpoint v${VERSION}" 2>/dev/null || true
    git push origin main 2>/dev/null || true
    log "Backed up checkpoint v${VERSION}"
  fi

  # Clean up temp combined files
  rm -f "data/combined_v${VERSION}.ndjson" "data/append_v${VERSION}.ndjson"

  # Increment version
  VERSION=$((VERSION + 1))
  echo "$VERSION" > .current-version

  log "Next version: v${VERSION}"
done

log ""
log "Continuous training complete after ${MAX_ITERATIONS} iterations."
log "Final deployed: v${DEPLOYED_VERSION}, wins: ${WIN_COUNT}"
