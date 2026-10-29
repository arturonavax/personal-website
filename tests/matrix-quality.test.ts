import { describe, expect, it } from "bun:test";
import {
  MatrixQuality,
  MatrixScrollQuality,
} from "../src/scripts/matrix-quality";

function feed(quality: MatrixQuality, cost: number, start = 0, count = 90) {
  for (let i = 0; i < count; i++) quality.record(cost, start + i * 17);
}

describe("scroll-local Matrix composition trial", () => {
  const feed = (quality: MatrixScrollQuality, gap: number, start: number) => {
    let change: number | undefined;
    for (let i = 0; i < 24; i++)
      change = quality.record(gap, start + i * gap) ?? change;
    return change;
  };

  it("does not touch a smooth device or react to isolated missed frames", () => {
    const quality = new MatrixScrollQuality();
    expect(feed(quality, 16.7, 0)).toBeUndefined();
    for (let i = 0; i < 3; i++) quality.record(50, 500 + i * 50);
    expect(feed(quality, 16.7, 700)).toBeUndefined();
  });

  it("tries lower raster work only after sustained scroll stalls and keeps a measured win", () => {
    const quality = new MatrixScrollQuality();
    expect(feed(quality, 33.4, 0)).toBe(1);
    expect(feed(quality, 16.7, 1000)).toBe(1);
    expect(feed(quality, 16.7, 1500)).toBeUndefined();
    expect(quality.reset()).toBe(0);
  });

  it("tries near-static decoration if half-rate is insufficient", () => {
    const quality = new MatrixScrollQuality();
    expect(feed(quality, 50, 0)).toBe(1);
    expect(feed(quality, 50, 1300)).toBe(2);
    expect(feed(quality, 16.7, 2600)).toBe(2);
    expect(quality.reset()).toBe(0);
  });

  it("rejects unrelated scroll stalls and defers another trial", () => {
    const quality = new MatrixScrollQuality();
    expect(feed(quality, 50, 0)).toBe(1);
    expect(feed(quality, 50, 1300)).toBe(2);
    expect(feed(quality, 50, 2600)).toBe(0);
    expect(feed(quality, 50, 3900)).toBeUndefined();
    quality.reset();
    expect(feed(quality, 50, 5000)).toBeUndefined();
  });
});

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
