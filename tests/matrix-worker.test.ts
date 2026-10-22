import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(
    new URL("../src/scripts/matrix.worker.ts", import.meta.url),
    "utf8",
  ),
);

function renderer(ownerBlocked = false) {
  let now = 0;
  let id = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const paints: { time: number; alpha: number }[] = [];
  const glyphs: { time: number; y: number; text: string }[] = [];
  const context = {
    fillStyle: "",
    font: "",
    resetTransform() {},
    scale() {},
    fillRect() {
      paints.push({
        time: now,
        alpha: Number(context.fillStyle.split(",").at(-1)?.replace(")", "")),
      });
    },
    fillText(text: string, x: number, y: number) {
      if (x === 0) glyphs.push({ time: now, y, text });
    },
  };
  const schedule = (run: () => void, delay: number) => {
    const key = ++id;
    pending.set(key, { at: now + delay, run });
    return key;
  };
  const scope = {
    onmessage: (_event: { data: object }) => {},
    requestAnimationFrame: (run: (time: number) => void) =>
      ownerBlocked ? ++id : schedule(() => run(now), 1000 / 60),
    cancelAnimationFrame: (key: number) => pending.delete(key),
    setTimeout: (run: () => void, delay: number) => schedule(run, delay),
    clearTimeout: (key: number) => pending.delete(key),
  };
  const random = Object.create(Math) as Math;
  random.random = () => 0.5;
  runInNewContext(source, {
    self: scope,
    performance: { now: () => now },
    Math: random,
  });
  const send = (data: object) => scope.onmessage({ data });
  const canvas = { width: 0, height: 0, getContext: () => context };
  send({
    type: "init",
    canvas,
    width: 140,
    height: 5000,
    dpr: 1,
    isLight: false,
  });
  const advance = (duration: number) => {
    const end = now + duration;
    while (true) {
      const entry = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      pending.delete(entry[0]);
      now = entry[1].at;
      entry[1].run();
    }
    now = end;
  };
  return { paints, glyphs, send, advance, pending, canvas, random };
}

describe("Matrix Worker frame independence", () => {
  it("keeps painting at a bounded 60Hz when owner-window animation frames stop", () => {
    const app = renderer(true);
    app.advance(1000);
    expect(app.paints.length).toBeGreaterThanOrEqual(55);
    expect(app.paints.length).toBeLessThanOrEqual(61);
    expect(app.pending.size).toBe(1);
  });

  it("moves smoothly while preserving stream speed and trail lifetime", () => {
    const app = renderer();
    app.advance(2000);
    const startY = app.glyphs.at(-1)!.y;
    app.advance(1000);
    expect(app.glyphs.at(-1)!.y - startY).toBeCloseTo(8 * 14, -1);
    expect(
      app.glyphs.some(({ y }) => Math.abs(y / 14 - Math.round(y / 14)) > 0.01),
    ).toBe(true);
    const retention = app.paints
      .slice(0, 60)
      .reduce((remaining, paint) => remaining * (1 - paint.alpha), 1);
    expect(retention).toBeCloseTo(0.88 ** 22, 2);
  });

  it("holds glyph identity long enough to read rather than randomizing each paint", () => {
    const app = renderer();
    app.advance(2000);
    let seed = 1;
    let calls = 0;
    app.random.random = () => {
      calls++;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const from = app.glyphs.length;
    app.advance(1000);
    const changes = app.glyphs
      .slice(from)
      .filter((glyph, i, all) => !i || glyph.text !== all[i - 1]!.text);
    expect(calls).toBeLessThanOrEqual(160);
    expect(changes.length).toBeGreaterThan(2);
    for (let i = 2; i < changes.length; i++)
      expect(changes[i]!.time - changes[i - 1]!.time).toBeGreaterThanOrEqual(
        145,
      );
  });

  it("bounds decorative raster pixels on high-DPR and large viewports", () => {
    const app = renderer();
    app.send({ type: "resize", width: 1440, height: 900, dpr: 2 });
    expect(app.canvas.width).toBe(1440);
    expect(app.canvas.height).toBe(900);
    app.send({ type: "resize", width: 3840, height: 2160, dpr: 2 });
    expect(app.canvas.width * app.canvas.height).toBeLessThanOrEqual(
      1920 * 1080,
    );
    expect(app.pending.size).toBe(1);
  });

  it("pauses hidden work and resumes once without catch-up or duplicate loops", () => {
    const app = renderer();
    app.advance(2000);
    app.send({ type: "pause" });
    const count = app.paints.length;
    const pausedY = app.glyphs.at(-1)!.y;
    expect(app.pending.size).toBe(0);
    app.advance(60_000);
    expect(app.paints.length).toBe(count);
    app.send({ type: "resume" });
    app.send({ type: "resume" });
    app.send({ type: "resize", width: 140, height: 5000, dpr: 1 });
    expect(app.pending.size).toBe(1);
    app.advance(50);
    expect(app.paints.length - count).toBeGreaterThanOrEqual(2);
    expect(app.paints.length - count).toBeLessThanOrEqual(3);
    expect(app.glyphs.at(-1)!.y - pausedY).toBeLessThan(20);
    expect(app.pending.size).toBe(1);
  });
});
