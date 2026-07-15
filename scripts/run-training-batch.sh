#!/bin/bash
# run-training-batch.sh — Sequential overnight training batch: yinsh then zertz.
#
# Runs each game's continuous training loop for a bounded number of iterations
# under caffeinate so laptop sleep can't kill the workers. The two loops are
# sequenced (never simultaneous) — both want ~6 workers on this machine.
#
# Usage: ./scripts/run-training-batch.sh [yinsh-iterations] [zertz-iterations]
#        nohup ./scripts/run-training-batch.sh > /dev/null 2>&1 &
#
# Logs: training/batch-<timestamp>.log (combined), plus each loop's own
#       continuous.log as before.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

YINSH_ITERS=${1:-8}
ZERTZ_ITERS=${2:-8}
STAMP=$(date '+%Y%m%d-%H%M%S')
BATCH_LOG="training/batch-${STAMP}.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$BATCH_LOG"
}

log "════════ Training batch: yinsh x${YINSH_ITERS}, then zertz x${ZERTZ_ITERS} ════════"

log "── Yinsh: ${YINSH_ITERS} iterations ──"
if caffeinate -s ./scripts/continuous-train.sh --max-iterations "$YINSH_ITERS" 2>&1 | tee -a "$BATCH_LOG"; then
  log "Yinsh batch finished."
else
  log "WARNING: yinsh batch exited non-zero; continuing to zertz."
fi

log "── Zertz: ${ZERTZ_ITERS} iterations ──"
if caffeinate -s ./scripts/zertz/continuous-train.sh --max-iterations "$ZERTZ_ITERS" 2>&1 | tee -a "$BATCH_LOG"; then
  log "Zertz batch finished."
else
  log "WARNING: zertz batch exited non-zero."
fi

log "════════ Batch complete. Deployed: yinsh v$(basename "$(cat .deployed-checkpoint)" .pt | sed 's/v//'), zertz v$(basename "$(cat training/zertz/.deployed-checkpoint)" .pt | sed 's/v//') ════════"
