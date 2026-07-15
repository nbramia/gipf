#!/bin/bash
# queue-yinsh-followup.sh — one-shot: wait for the currently running batch
# (PID passed as $1) to exit, then run a yinsh-only follow-up batch of $2
# iterations under caffeinate. Designed to be nohup'd/disowned so it needs
# no supervision. Resume-safe like the main wrapper (state files).
#
# Usage: nohup ./scripts/queue-yinsh-followup.sh <wait-pid> <iterations> >/dev/null 2>&1 &

set -uo pipefail
WAIT_PID=$1
ITERS=$2

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

while kill -0 "$WAIT_PID" 2>/dev/null; do sleep 120; done
sleep 60  # let the finished batch's last commit/push settle

STAMP=$(date '+%Y%m%d-%H%M%S')
LOG="training/batch-${STAMP}-yinsh-followup.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Follow-up yinsh batch: ${ITERS} iterations (queued behind PID ${WAIT_PID})" >> "$LOG"
if caffeinate -s ./scripts/continuous-train.sh --max-iterations "$ITERS" >> "$LOG" 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Follow-up complete. Deployed: $(cat .deployed-checkpoint)" >> "$LOG"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: follow-up exited non-zero. Deployed: $(cat .deployed-checkpoint)" >> "$LOG"
fi
