import { describe, expect, it } from "bun:test";
import { MatrixQuality } from "../src/scripts/matrix-quality";

function feed(quality: MatrixQuality, cost: number, start = 0, count = 90) {
  for (let i = 0; i < count; i++) quality.record(cost, start + i * 17);
}

describe("adaptive Matrix raster budget", () => {
  it("keeps the full 60 Hz canvas on capable hardware and ignores short stalls", () => {
    const quality = new MatrixQuality();
    feed(quality, 2, 0, 300);
    expect(quality.level).toBe(0);
    feed(quality, 40, 5100, 8);
    feed(quality, 2, 5236, 180);
    expect(quality.level).toBe(0);
    expect(quality.frameInterval).toBeCloseTo(1000 / 60);
    expect(quality.scale).toBe(1);
  });

  it("reduces sustained rendering pressure without dropping canvas state", () => {
    const quality = new MatrixQuality();
    feed(quality, 20);
    expect(quality.level).toBe(1);
    expect(quality.frameInterval).toBeGreaterThan(1000 / 60);
    expect(quality.scale).toBeLessThan(1);
  });

  it("does not oscillate and probes recovery only after sustained cheap draws", () => {
    const quality = new MatrixQuality();
    feed(quality, 20);
    feed(quality, 2, 1600);
    expect(quality.level).toBe(1);
    feed(quality, 2, 12_000);
    expect(quality.level).toBe(0);
    expect(quality.scale).toBe(1);
  });

  it("pauses expensive decoration temporarily and retries instead of staying degraded", () => {
    const quality = new MatrixQuality();
    feed(quality, 20);
    feed(quality, 40, 1600);
    expect(quality.level).toBe(2);
    expect(quality.frameInterval).toBeGreaterThan(500);
    quality.record(2, 12_000);
    expect(quality.level).toBe(1);
  });
});
