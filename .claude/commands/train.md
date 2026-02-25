---
description: "Run AI training iterations within a time budget"
---

# Yinsh AI Training Skill

You are running automated training iterations for the Yinsh policy-value network. The user has provided a time budget: $ARGUMENTS

## Time Budget Planning

Parse the time budget from the arguments. Common formats: "1 hour", "30 minutes", "2h", "90m", "overnight".

Estimate iteration times with parallel self-play:
- **Parallel self-play** (50 games, 200 sims, 6 workers): ~8 minutes
- **Training** (with augmentation): ~5-10 minutes
- **ONNX export**: ~30 seconds
- **SPRT Tournament** (up to 40 games, 50 sims): ~8 minutes avg
- **Total per iteration**: ~22-27 minutes

If "overnight" or open-ended: use `--max-iterations 20` (~7-9 hours).
If specific time budget: calculate iterations = floor(budget_minutes / 25), cap at 20.
Stop with 10 minutes remaining to ensure clean state.

## Before Starting

1. Read MEMORY.md for current state:
```
Read /Users/nathanramia/.claude/projects/-Users-nathanramia-Documents-Code-yinsh/memory/MEMORY.md
```

2. Check state files and determine starting point:
```bash
cat .current-version 2>/dev/null || echo "not set"
cat .deployed-checkpoint 2>/dev/null || echo "not set"
ls training/v*.pt | sort -V | tail -3
```

3. Verify the deployed model is healthy:
```bash
file public/models/yinsh-value-v1.onnx public/models/yinsh-value-v1.onnx.data
```

## Running the Training Loop

Use `scripts/continuous-train.sh` which handles: parallel self-play, data combining, training, ONNX export, SPRT tournament, auto-promotion, git commit/push, and state persistence.

### Start the loop:
```bash
caffeinate -s ./scripts/continuous-train.sh --max-iterations N 2>&1 | tee training/continuous.log
```

Where N is calculated from time budget (see above).

Run this in background. Monitor progress by tailing the log:
```bash
tail -f training/continuous.log
```

### What continuous-train.sh does each iteration:
1. Parallel self-play (6 workers) → `data/vN_selfplay.ndjson`
2. Combines with last 5 data files → `data/combined_vN.ndjson`
3. Trains with augmentation (LR 1e-4, patience 12) → `training/vN.pt`
4. Exports to ONNX → `public/models/yinsh-value-vN.onnx`
5. SPRT tournament vs deployed model
6. If win: promotes, commits, pushes. If loss: moves to next version
7. Backs up checkpoints every 5 versions

State survives Ctrl+C and restart:
- `.current-version` — next version to try
- `.deployed-checkpoint` — best checkpoint path

### If the script needs manual intervention:
- APFS I/O timeout: The script retries after 20s sleep. If persistent, `Ctrl+C` and restart.
- Git push failure: The script logs a warning and continues. Push manually if needed.
- Training failure: The script skips that version and continues with next.

## After Training Completes

1. **Check results in the log**:
```bash
grep -E "WINS|did not win|Promoted" training/continuous.log
```

2. **Verify final state**:
```bash
cat .current-version
cat .deployed-checkpoint
file public/models/yinsh-value-v1.onnx public/models/yinsh-value-v1.onnx.data
```

3. **Update MEMORY.md** with:
   - New deployed model version and lineage
   - Next version number to try
   - All tournament results from this session
   - Any new data files generated (check `ls -lt data/v*_selfplay.ndjson | head -10`)

4. **Report results** to the user: iterations run, wins/losses, scores, current deployed version

## Manual Single Iteration (Fallback)

If `continuous-train.sh` isn't working, run a single iteration manually:

```bash
# 1. Self-play
node scripts/parallel-selfplay.mjs --games 50 --sims 200 \
  --mode nn --model public/models/yinsh-value-v1.onnx \
  --output data/vN_selfplay.ndjson --workers 6

# 2. Combine data
cat data/vN_selfplay.ndjson data/vA.ndjson data/vB.ndjson > data/combined_vN.ndjson

# 3. Train
training/.venv/bin/python3 training/train.py \
  --data data/combined_vN.ndjson \
  --checkpoint training/vBEST.pt \
  --augment --lr 1e-4 --epochs 40 --patience 12 \
  --model-type policy-value \
  --output training/vN.pt

# 4. Export
training/.venv/bin/python3 training/export_onnx.py \
  --checkpoint training/vN.pt \
  --output public/models/yinsh-value-vN.onnx

# 5. Tournament
node scripts/tournament.mjs --games 10 --sims 50 --mode nn-vs-nn \
  --model1 public/models/yinsh-value-vN.onnx \
  --model2 public/models/yinsh-value-v1.onnx --sprt

# 6. Deploy if exit code 0
cp public/models/yinsh-value-vN.onnx public/models/yinsh-value-v1.onnx
cp public/models/yinsh-value-vN.onnx.data public/models/yinsh-value-v1.onnx.data
git add public/models/yinsh-value-v1.onnx public/models/yinsh-value-v1.onnx.data
git commit -m "feat: deploy vN model — beats vPREV X-Y in tournament"
git push origin main
```

## Critical Rules
- **NEVER skip `--augment`** — 6-fold hex rotation is essential
- **NEVER train from scratch** — always fine-tune from best checkpoint
- **NEVER deploy without winning a tournament**
- **ALWAYS verify files** with `file` command after generation/training/export
- **ALWAYS commit and push** after deploying a new model
- **Use `--model-type policy-value`** for new models (policy+value dual head)
- **Combine 3+ generations** of data for best results
