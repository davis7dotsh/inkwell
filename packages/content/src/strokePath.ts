import type { Point, Stroke } from "./types";

/**
 * Builds a smoothed SVG path from raw input points: line segments through the
 * midpoints with the sampled points as quadratic control points.
 */
export function strokeToSvgPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  if (points.length === 1) {
    // Render a dot.
    return `M ${first.x} ${first.y} L ${first.x + 0.1} ${first.y + 0.1}`;
  }
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    const midX = (p.x + next.x) / 2;
    const midY = (p.y + next.y) / 2;
    d += ` Q ${p.x} ${p.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Distance from a point to the nearest sampled point of a stroke. */
export function distanceToStroke(stroke: Stroke, x: number, y: number): number {
  let best = Infinity;
  for (const p of stroke.points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < best) best = d;
  }
  return best;
}
