---
description: "Run AI training iterations within a time budget"
---

# Zertz AI Training Skill

You are running automated training iterations for the Zertz value network. The user has provided a time budget: $ARGUMENTS

## Time Budget Planning

Parse the time budget from the arguments. Common formats: "1 hour", "30 minutes", "2h", "90m", "overnight".

Estimate iteration times:
- **Parallel self-play** (50 games, 200 sims, 6 workers): ~10 minutes
- **Training** (with augmentation): ~5-10 minutes
- **ONNX export**: ~30 seconds
- **SPRT Tournament** (up to 40 games, 50 sims): ~10 minutes avg
- **Total per iteration**: ~26-31 minutes

If "overnight" or open-ended: use `--max-iterations 20` (~9-11 hours).
If specific time budget: calculate iterations = floor(budget_minutes / 30), cap at 20.
Stop with 10 minutes remaining to ensure clean state.

## Before Starting

1. Read MEMORY.md for current state:
```
Read /Users/nathanramia/.claude/projects/-Users-nathanramia-Documents-Code-zertz/memory/MEMORY.md
```

2. Check state files and determine starting point:
```bash
cat .current-version 2>/dev/null || echo "not set"
cat .deployed-checkpoint 2>/dev/null || echo "not set"
ls training/zertz/checkpoints/v*.pt 2>/dev/null | sort -V | tail -3
```

3. Verify Python venv exists:
```bash
test -f training/.venv/bin/python3 || (python3 -m venv training/.venv && training/.venv/bin/pip install torch onnx onnxruntime onnxscript)
```

4. If no checkpoint exists yet (first training run), generate initial data:
```bash
node scripts/zertz/generate-training-data.mjs --games 100 --sims 200
```
Then train from scratch:
```bash
PYTHONPATH=training training/.venv/bin/python3 training/zertz/train.py \
  --data data/zertz/*.ndjson --epochs 40 \
  --model-type policy-value --augment \
  --output-dir training/zertz/checkpoints
PYTHONPATH=training training/.venv/bin/python3 training/zertz/export_onnx.py \
  --checkpoint training/zertz/checkpoints/best.pt \
  --output public/models/zertz-value-v1.onnx
```

## Running the Training Loop

Use `scripts/zertz/continuous-train.sh` which handles: parallel self-play, data combining, training, ONNX export, SPRT tournament, auto-promotion, git commit/push, and state persistence.

### Start the loop:
```bash
caffeinate -s ./scripts/zertz/continuous-train.sh --max-iterations N 2>&1 | tee training/zertz/continuous.log
```

Where N is calculated from time budget (see above).

Run this in background. Monitor progress by tailing the log:
```bash
tail -f training/zertz/continuous.log
```

### What continuous-train.sh does each iteration:
1. Parallel self-play (6 workers) -> `data/zertz/vN_selfplay.ndjson`
2. Combines with last 5 data files -> `data/zertz/combined_vN.ndjson`
3. Trains with augmentation (LR 1e-4, patience 12) -> `training/zertz/checkpoints/vN.pt`
4. Exports to ONNX -> `public/models/zertz-value-vN.onnx`
5. SPRT tournament vs deployed model
6. If win: promotes, commits, pushes. If loss: moves to next version
7. Backs up checkpoints every 5 versions

State survives Ctrl+C and restart:
- `.current-version` -- next version to try
- `.deployed-checkpoint` -- best checkpoint path

### If the script needs manual intervention:
- APFS I/O timeout: The script retries after 20s sleep. If persistent, `Ctrl+C` and restart.
- Git push failure: The script logs a warning and continues. Push manually if needed.
- Training failure: The script skips that version and continues with next.

## After Training Completes

1. **Check results in the log**:
```bash
grep -E "WINS|did not win|Promoted" training/zertz/continuous.log
```

2. **Verify final state**:
```bash
cat .current-version
cat .deployed-checkpoint
file public/models/zertz-value-v1.onnx
```

3. **Update MEMORY.md** with:
   - New deployed model version and lineage
   - Next version number to try
   - All tournament results from this session
   - Any new data files generated (check `ls -lt data/zertz/v*_selfplay.ndjson | head -10`)

4. **Report results** to the user: iterations run, wins/losses, scores, current deployed version

## Manual Single Iteration (Fallback)

If `continuous-train.sh` isn't working, run a single iteration manually:

```bash
# 1. Self-play
node scripts/zertz/parallel-selfplay.mjs --games 50 --sims 200 \
  --output data/zertz/vN_selfplay.ndjson --workers 6

# 2. Combine data
cat data/zertz/vN_selfplay.ndjson data/zertz/vA_selfplay.ndjson > data/zertz/combined_vN.ndjson

# 3. Train
PYTHONPATH=training training/.venv/bin/python3 training/zertz/train.py \
  --data data/zertz/combined_vN.ndjson \
  --checkpoint training/zertz/checkpoints/vBEST.pt \
  --model-type policy-value --augment --lr 1e-4 --epochs 40 --patience 12 \
  --output-dir training/zertz/checkpoints

# 4. Export
PYTHONPATH=training training/.venv/bin/python3 training/zertz/export_onnx.py \
  --checkpoint training/zertz/checkpoints/vN.pt \
  --output public/models/zertz-value-vN.onnx

# 5. Tournament
node scripts/zertz/tournament.mjs --games 10 --sims 50 \
  --model public/models/zertz-value-vN.onnx

# 6. Deploy if it wins
cp public/models/zertz-value-vN.onnx public/models/zertz-value-v1.onnx
git add public/models/zertz-value-v1.onnx
git commit -m "feat: deploy vN model -- beats vPREV in tournament"
git push origin main
```

## Critical Rules
- **NEVER skip `--augment`** -- 6-fold hex rotation is essential
- **NEVER train from scratch** after v1 -- always fine-tune from best checkpoint
- **NEVER deploy without winning a tournament**
- **ALWAYS verify files** with `file` command after generation/training/export
- **ALWAYS commit and push** after deploying a new model
- **Combine 3+ generations** of data for best results
