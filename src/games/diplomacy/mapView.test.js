import {
  MIN_SCALE,
  MAX_SCALE,
  fitView,
  clampView,
  viewBoxOf,
  viewBoxString,
  pointInMap,
  zoomAt,
  panBy,
} from './mapView.js';

const B = { x: 0, y: 0, w: 1000, h: 800 };

describe('map view math', () => {
  test('fit shows the whole map', () => {
    expect(viewBoxOf(fitView(B), B)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(viewBoxString(fitView(B), B)).toBe('0.00 0.00 1000.00 800.00');
  });

  test('zoom keeps the point under the cursor fixed', () => {
    const before = fitView(B);
    const anchor = pointInMap(before, B, 0.75, 0.25);
    const after = zoomAt(before, B, 3, 0.75, 0.25);
    const now = pointInMap(after, B, 0.75, 0.25);
    expect(now.x).toBeCloseTo(anchor.x, 6);
    expect(now.y).toBeCloseTo(anchor.y, 6);
    expect(viewBoxOf(after, B).w).toBeCloseTo(1000 / 3, 6);
  });

  test('scale is clamped to its limits', () => {
    expect(zoomAt(fitView(B), B, 99).scale).toBe(MAX_SCALE);
    expect(zoomAt(fitView(B), B, 0.1).scale).toBe(MIN_SCALE);
  });

  test('the window can never leave the map', () => {
    let v = zoomAt(fitView(B), B, 4);
    v = panBy(v, B, -50, -50); // drag far past the right/bottom edge
    let vb = viewBoxOf(v, B);
    expect(vb.x + vb.w).toBeCloseTo(1000, 6);
    expect(vb.y + vb.h).toBeCloseTo(800, 6);
    v = panBy(v, B, 50, 50);
    vb = viewBoxOf(v, B);
    expect(vb.x).toBeCloseTo(0, 6);
    expect(vb.y).toBeCloseTo(0, 6);
  });

  test('zooming back out re-centres and cannot be panned at fit', () => {
    const v = panBy(fitView(B), B, 0.4, 0.4);
    expect(viewBoxOf(v, B)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    const zoomed = zoomAt(fitView(B), B, 4, 1, 1);
    expect(viewBoxOf(zoomAt(zoomed, B, MIN_SCALE), B)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });

  test('dragging right moves the window left (content follows the finger)', () => {
    const v = zoomAt(fitView(B), B, 2);
    const moved = panBy(v, B, 0.1, 0);
    expect(viewBoxOf(moved, B).x).toBeLessThan(viewBoxOf(v, B).x);
  });

  test('clampView is idempotent', () => {
    const v = clampView({ scale: 2, cx: -500, cy: 5000 }, B);
    expect(clampView(v, B)).toEqual(v);
  });
});
