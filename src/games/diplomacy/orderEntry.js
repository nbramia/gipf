// Pure helpers for the human's order entry (no React).

// Move options that enter province `base`. A split-coast province yields one
// option per coast.
export function moveOptionsInto(options, base, baseProvince) {
  return options.filter(o => baseProvince(o.to) === base);
}

// Toggle a winter adjustment in `list` under the engine's allowance `limit`.
// A build replaces any other build in the same home province (one unit per
// home); selecting beyond the allowance is rejected with a message.
// Returns { list, error }.
export function toggleAdjustment(list, order, limit, key, baseProvince) {
  const k = key(order);
  if (list.some(o => key(o) === k)) {
    return { list: list.filter(o => key(o) !== k), error: null };
  }
  let next = list;
  if (order.type === 'build') {
    const home = baseProvince(order.loc);
    next = list.filter(o => !(o.type === 'build' && baseProvince(o.loc) === home));
  }
  if (next.length >= limit) {
    const what = order.type === 'build' ? 'build' : 'disband';
    return {
      list,
      error: limit === 0
        ? `No ${what}s are available.`
        : `You can only ${what} ${limit} ${limit === 1 ? 'unit' : 'units'} this winter. Deselect one first.`,
    };
  }
  return { list: [...next, order], error: null };
}

// Reduce an arbitrary saved selection to one the allowance permits: later
// builds in the same home replace earlier ones, extras beyond `limit` drop.
export function normalizeAdjustments(list, limit, key, baseProvince) {
  let out = [];
  for (const order of list) {
    if (out.some(o => key(o) === key(order))) continue;
    out = toggleAdjustment(out, order, limit, key, baseProvince).list;
  }
  return out;
}
