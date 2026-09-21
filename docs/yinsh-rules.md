# YINSH rules and resolution

Primary source: [Kris Burm / Project GIPF official YINSH rules](https://www.gipf.com/yinsh/rules/rules.html), sections E–H (verified September 20, 2026).

Players alternate placing five rings each. During play, leave a marker inside a ring and move that ring along a straight line to an empty intersection. Rings block movement. A ring may cross empty intersections before jumping consecutive markers, but must land immediately after those markers. Flip every jumped marker.

Five adjacent, collinear markers of one color score a row. Remove those five markers, then one ring of that color. Repeat for surviving disjoint rows. For longer lines, choose any consecutive five; intersecting rows cease to qualify when their shared markers disappear. Resolve the mover's rows before the opponent's rows. The opponent then takes the next ordinary turn.

The third removed ring ends the game immediately, including when both players could otherwise score their third ring on the same move. The official rules also specify a marker-exhaustion ending; this repair does not add that separate rule.

## Engine contract

`removeRow(markers)` validates all five coordinates against the live position and advances to `remove-ring`. UI clicks select a live row through the same method. Search and live AI pass the complete row, avoiding ambiguity between overlapping windows. After ring removal, remaining rows are recomputed in mover-first order; cached queue entries never authorize a score. Clone, worker serialization, and history preserve the pending next player.

Search stores every value sum from that state's `currentPlayer` perspective. NN values use this perspective; heuristic rollouts evaluate for the player at the rollout's start. Terminal outcomes are +10000 for that player winning and -10000 for losing; NN nonterminal values retain the existing 5000 multiplier. Selection converts child values to the acting parent's perspective. Backpropagation converts by player identity, preserving same-player row/ring edges.

Transpositions share statistics within one engine, never children or parent pointers. State hashes include the pending next player because identical pieces during scoring can lead to different next turns. PUCT normalization bounds cover both signs. Terminal leaves receive visits on repeated selection, and heuristic evaluation includes terminal outcomes even at the rollout depth limit.
