// Pure zoom/pan math for the Diplomacy map. The view is { scale, cx, cy }: the
// visible window is the map's viewBox shrunk by `scale` and centred on (cx, cy)
// in map units, always clamped inside the map. The aspect ratio never changes, so
// the SVG's rendered height is stable while zooming.

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const ZOOM_STEP = 1.5;

export function fitView(bounds) {
  return { scale: MIN_SCALE, cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Keep the window inside the map and the scale inside its limits.
export function clampView(view, bounds) {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  const w = bounds.w / scale;
  const h = bounds.h / scale;
  return {
    scale,
    cx: clamp(view.cx, bounds.x + w / 2, bounds.x + bounds.w - w / 2),
    cy: clamp(view.cy, bounds.y + h / 2, bounds.y + bounds.h - h / 2),
  };
}

// The viewBox rectangle for a view.
export function viewBoxOf(view, bounds) {
  const w = bounds.w / view.scale;
  const h = bounds.h / view.scale;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

export function viewBoxString(view, bounds) {
  const vb = viewBoxOf(view, bounds);
  return `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`;
}

// Screen point (fx, fy as 0..1 fractions of the rendered SVG box) -> map point.
export function pointInMap(view, bounds, fx, fy) {
  const vb = viewBoxOf(view, bounds);
  return { x: vb.x + fx * vb.w, y: vb.y + fy * vb.h };
}

// Change the scale while keeping the map point under (fx, fy) fixed on screen.
export function zoomAt(view, bounds, nextScale, fx = 0.5, fy = 0.5) {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const anchor = pointInMap(view, bounds, fx, fy);
  const w = bounds.w / scale;
  const h = bounds.h / scale;
  return clampView({ scale, cx: anchor.x - fx * w + w / 2, cy: anchor.y - fy * h + h / 2 }, bounds);
}

// Pan by a screen delta expressed as fractions of the rendered SVG box.
export function panBy(view, bounds, dfx, dfy) {
  const vb = viewBoxOf(view, bounds);
  return clampView({ ...view, cx: view.cx - dfx * vb.w, cy: view.cy - dfy * vb.h }, bounds);
}
