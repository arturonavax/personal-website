import { describe, expect, it } from "bun:test";
import { MatrixGrid } from "../src/scripts/matrix-grid";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(
    new URL("../src/scripts/matrix.worker.ts", import.meta.url),
    "utf8",
  ).replace(/import \{ MatrixGrid \} from "\.\/matrix-grid";\s*/, ""),
);

function renderer(ownerBlocked = false) {
  let now = 0;
  let id = 0;
  let ticks = 0;
  let overlaps = 0;
  let rasterizations = 0;
  const occupied = new Map<string, string>();
  const pending = new Map<number, { at: number; run: () => void }>();
  const paints: { time: number; alpha: number }[] = [];
  const glyphs: { time: number; y: number; text: string; alpha: number }[] = [];
  const clears: number[] = [];
  const context = {
    fillStyle: "",
    font: "",
    clearRect(x: number, y: number, w: number, h: number) {
      clears.push(now);
      for (const key of occupied.keys()) {
        const [cx, cy] = key.split(":").map(Number);
        if (w === 140 || (cx! >= x && cx! < x + w && cy! >= y && cy! < y + h))
          occupied.delete(key);
      }
    },
    resetTransform() {},
    scale() {},
    fillRect() {
      paints.push({
        time: now,
        alpha: Number(context.fillStyle.split(",").at(-1)?.replace(")", "")),
      });
    },
    globalAlpha: 1,
    drawImage(
      atlas: { glyphs: { text: string; x: number; y: number }[] },
      ...coords: number[]
    ) {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = coords;
      const glyph = atlas.glyphs.find(
        (glyph) =>
          glyph.x >= sx! &&
          glyph.x < sx! + sw! &&
          glyph.y >= sy! &&
          glyph.y < sy! + sh!,
      );
      if (glyph) context.fillText(glyph.text, dx! + dw! / 2, dy! + dh! / 2);
    },
    fillText(text: string, x: number, y: number) {
      const key = `${x}:${y}`;
      if (occupied.has(key)) overlaps++;
      occupied.set(key, text);
      if (x === 9)
        glyphs.push({ time: now, y, text, alpha: context.globalAlpha });
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
    MatrixGrid: class extends MatrixGrid {
      constructor(ctx: ConstructorParameters<typeof MatrixGrid>[0]) {
        super(
          ctx,
          () => random.random(),
          () => {
            const strip = {
              glyphs: [] as { text: string; x: number; y: number }[],
              getContext: () => ({
                clearRect() {
                  strip.glyphs.length = 0;
                },
                fillText(text: string, x: number, y: number) {
                  rasterizations++;
                  strip.glyphs.push({ text, x, y });
                },
              }),
            };
            return strip as unknown as OffscreenCanvas;
          },
        );
      }
    },
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
      now = Math.max(now, entry[1].at);
      ticks++;
      entry[1].run();
    }
    now = end;
  };
  return {
    paints,
    glyphs,
    clears,
    send,
    advance,
    stall(duration: number) {
      now += duration;
      advance(0);
    },
    pending,
    canvas,
    random,
    occupied,
    get ticks() {
      return ticks;
    },
    get rasterizations() {
      return rasterizations;
    },
    get overlaps() {
      return overlaps;
    },
  };
}

describe("Matrix Worker frame independence", () => {
  it("keeps its bounded 60Hz clock independent when owner-window animation frames stop", () => {
    const app = renderer(true);
    app.advance(1000);
    expect(app.ticks).toBeGreaterThanOrEqual(55);
    expect(app.ticks).toBeLessThanOrEqual(61);
    expect(app.pending.size).toBe(1);
  });

  it("bounds a delayed callback without accumulating catch-up debt", () => {
    const app = renderer();
    app.advance(3500);
    const position = () => {
      const head = app.glyphs.at(-1)!;
      return head.y - 9 - 18 + head.alpha * 18;
    };
    const before = position();
    app.stall(500);
    expect(position() - before).toBeLessThanOrEqual(4.800001);
    expect(position() - before).toBeGreaterThan(0);
    const resumed = position();
    app.advance(17);
    expect(position() - resumed).toBeCloseTo((17 * 8 * 18) / 1000, 4);
    expect(app.pending.size).toBe(1);
  });

  it("advances the head while retaining a fading code trail without per-frame text rasterization", () => {
    const app = renderer();
    app.advance(3500);
    const startY = app.glyphs.at(-1)!.y;
    const rasterizations = app.rasterizations;
    app.advance(1000);
    expect(app.glyphs.at(-1)!.y - startY).toBeCloseTo(8 * 18, -1);
    expect(app.rasterizations).toBe(rasterizations);
    const frame = app.glyphs.filter(
      (glyph) => glyph.time === app.glyphs.at(-1)!.time,
    );
    expect(frame.length).toBeGreaterThanOrEqual(12);
    expect(frame[0]!.alpha).toBeLessThan(frame.at(-2)!.alpha);
    expect(frame[0]!.alpha).toBeLessThan(0.2);
  });

  it("clears every frame instead of accumulating ghost letters", () => {
    const app = renderer();
    app.advance(5000);
    expect(app.glyphs.length).toBeGreaterThan(0);
    expect(app.overlaps).toBe(0);
    expect(app.paints.length).toBe(0);
    expect(app.occupied.size).toBeLessThanOrEqual(8 * 18);
    app.send({ type: "theme", isLight: true });
    expect(app.overlaps).toBe(0);
  });

  it("updates the light envelope every frame while keeping one character in each spaced position", () => {
    const app = renderer();
    app.advance(3500);
    const from = app.glyphs.length;
    app.advance(100);
    const frames = new Map<number, typeof app.glyphs>();
    for (const glyph of app.glyphs.slice(from)) {
      const rows = frames.get(glyph.time) ?? [];
      rows.push(glyph);
      frames.set(glyph.time, rows);
    }
    expect(frames.size).toBeGreaterThanOrEqual(5);
    expect(
      new Set([...frames.values()].map((rows) => rows[0]!.alpha)).size,
    ).toBeGreaterThanOrEqual(5);
    for (const rows of frames.values()) {
      expect(new Set(rows.map((glyph) => glyph.y)).size).toBe(rows.length);
      for (let i = 1; i < rows.length; i++)
        expect(rows[i]!.y - rows[i - 1]!.y).toBe(18);
    }
  });

  it("changes visible code while retaining a denser fading tail behind the head", () => {
    const app = renderer();
    let seed = 1;
    app.random.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    app.advance(5000);
    const before = new Map(app.occupied);
    app.advance(500);
    expect(
      [...before].some(
        ([cell, text]) =>
          app.occupied.has(cell) && app.occupied.get(cell) !== text,
      ),
    ).toBe(true);
    expect(app.occupied.size).toBeGreaterThan(7 * 10);
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
    app.advance(2500);
    app.send({ type: "pause" });
    const count = app.clears.length;
    const pausedY = app.glyphs.at(-1)!.y;
    expect(app.pending.size).toBe(0);
    app.advance(60_000);
    expect(app.clears.length).toBe(count);
    app.send({ type: "resume" });
    app.send({ type: "resume" });
    app.send({ type: "resize", width: 140, height: 5000, dpr: 1 });
    expect(app.pending.size).toBe(1);
    app.advance(50);
    expect(app.ticks).toBeGreaterThan(0);
    expect(app.glyphs.at(-1)!.y - pausedY).toBeLessThanOrEqual(20);
    expect(app.pending.size).toBe(1);
  });
});
