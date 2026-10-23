import { describe, expect, it } from "bun:test";
import { circularThemeClip } from "../src/scripts/theme-clip";

describe("rounded-inset circular theme reveal", () => {
  for (const [x, y, width, height] of [
    [1380, 28, 1440, 900],
    [180, 32, 360, 800],
    [0, 0, 1920, 1080],
    [960, 540, 1920, 1080],
  ] as const) {
    it(`keeps the circle centered and covers all corners at ${x},${y}`, () => {
      const frames = circularThemeClip(x, y, width, height);
      const parse = (value: string) => value.match(/-?[\d.]+/g)!.map(Number);
      const start = parse(frames[0]);
      const end = parse(frames[1]);
      expect(start).toEqual([y, width - x, height - y, x, 0]);
      for (const progress of [0, 0.1, 0.5, 1]) {
        const [top, right, bottom, left, radius] = start.map(
          (value, i) => value + (end[i]! - value) * progress,
        ) as [number, number, number, number, number];
        expect(width - left - right).toBeCloseTo(radius * 2, 8);
        expect(height - top - bottom).toBeCloseTo(radius * 2, 8);
        expect(left + radius).toBeCloseTo(x, 8);
        expect(top + radius).toBeCloseTo(y, 8);
      }
      for (const [cx, cy] of [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ]) {
        expect(Math.hypot(cx! - x, cy! - y)).toBeLessThanOrEqual(end[4]!);
      }
    });
  }
});
