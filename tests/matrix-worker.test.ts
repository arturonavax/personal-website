import { describe, expect, it } from "bun:test";
import { MatrixGrid } from "../src/scripts/matrix-grid";
import { resizeMatrixSurface } from "../src/scripts/matrix-viewport";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(
    new URL("../src/scripts/matrix.worker.ts", import.meta.url),
    "utf8",
  ).replace(
    /import \{ (?:MatrixGrid|resizeMatrixSurface) \} from "\.\/matrix-(?:grid|viewport)";\s*/g,
    "",
  ),
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
  const glyphs: {
    time: number;
    y: number;
    text: string;
    alpha: number;
    size: number;
  }[] = [];
  const clears: number[] = [];
  let appliedScale = [1, 1];
  let glyphSize = 18;
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
    scale(x: number, y: number) {
      appliedScale = [x, y];
    },
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
      glyphSize = dw!;
      if (glyph) context.fillText(glyph.text, dx! + dw! / 2, dy! + dh! / 2);
    },
    fillText(text: string, x: number, y: number) {
      const key = `${x}:${y}`;
      if (occupied.has(key)) overlaps++;
      occupied.set(key, text);
      if (x < glyphSize)
        glyphs.push({
          time: now,
          y,
          text,
          alpha: context.globalAlpha,
          size: glyphSize,
        });
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
    resizeMatrixSurface,
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
    get appliedScale() {
      return appliedScale;
    },
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
    const position = () =>
      app.glyphs
        .filter((glyph) => glyph.time === app.glyphs.at(-1)!.time)
        .find((glyph) => glyph.alpha === 1 && glyph.y > 1000)!.y;
    const cell = app.glyphs.at(-1)!.size;
    const before = position();
    app.stall(500);
    expect(position() - before).toBeLessThanOrEqual(
      (6.5 * cell) / 30 + 0.000001,
    );
    expect(position() - before).toBeGreaterThan(0);
    const resumed = position();
    app.advance(17);
    expect(position() - resumed).toBeCloseTo((17 * 6.5 * cell) / 1000, 4);
    expect(app.pending.size).toBe(1);
  });

  it("advances the head while retaining a fading code trail without per-frame text rasterization", () => {
    const app = renderer();
    app.advance(3500);
    const startY = app.glyphs
      .filter((glyph) => glyph.time === app.glyphs.at(-1)!.time)
      .find((glyph) => glyph.alpha === 1 && glyph.y > 1000)!.y;
    const rasterizations = app.rasterizations;
    app.advance(1000);
    const heads = app.glyphs.filter(
      (glyph) => glyph.time === app.glyphs.at(-1)!.time && glyph.alpha === 1,
    );
    const advanced = heads.find(
      (glyph) => Math.abs(glyph.y - startY - 6.5 * glyph.size) < 5,
    );
    expect(advanced).toBeDefined();
    expect(app.rasterizations).toBe(rasterizations);
    const frame = app.glyphs.filter(
      (glyph) => glyph.time === app.glyphs.at(-1)!.time,
    );
    expect(frame.length).toBeGreaterThanOrEqual(12);
    const firstHead = frame.findIndex(
      (glyph) => glyph.alpha === 1 && glyph.y > 1000,
    );
    expect(frame[firstHead + 1]!.alpha).toBeLessThan(frame[firstHead]!.alpha);
    expect(frame[firstHead + 12]!.alpha).toBeLessThan(0.2);
  });

  it("clears every frame instead of accumulating ghost letters", () => {
    const app = renderer();
    app.advance(5000);
    expect(app.glyphs.length).toBeGreaterThan(0);
    expect(app.overlaps).toBe(0);
    expect(app.paints.length).toBe(0);
    expect(app.occupied.size).toBeLessThanOrEqual(
      8 * (Math.ceil(5000 / 18) + 2),
    );
    app.send({ type: "theme", isLight: true });
    expect(app.overlaps).toBe(0);
  });

  it("moves glyph positions every frame while keeping characters separated", () => {
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
      new Set([...frames.values()].map((rows) => rows[0]!.y)).size,
    ).toBeGreaterThanOrEqual(5);
    for (const rows of frames.values()) {
      expect(new Set(rows.map((glyph) => glyph.y)).size).toBe(rows.length);
      const positions = rows.map((glyph) => glyph.y).sort((a, b) => a - b);
      for (let i = 1; i < positions.length; i++)
        expect(positions[i]! - positions[i - 1]!).toBeGreaterThanOrEqual(
          17.999999,
        );
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
    const before = [...app.occupied.values()];
    app.advance(500);
    expect([...app.occupied.values()]).not.toEqual(before);
    expect(app.occupied.size).toBeGreaterThan(7 * 10);
  });

  it("maps the full backing store after small resizes and live DPR changes", () => {
    const app = renderer();
    for (const [width, height, dpr] of [
      [1440, 900, 1],
      [1460, 910, 1],
      [1430, 895, 0.8],
      [3840, 2160, 2],
      [3820, 2150, 2],
    ]) {
      app.send({ type: "resize", width, height, dpr });
      expect(app.appliedScale[0]! * width!).toBeCloseTo(app.canvas.width, 5);
      expect(app.appliedScale[1]! * height!).toBeCloseTo(app.canvas.height, 5);
      const scale = Math.min(
        dpr!,
        1,
        Math.sqrt((1920 * 1080) / (width! * height!)),
      );
      expect(app.canvas.width).toBe(Math.max(1, Math.floor(width! * scale)));
      expect(app.canvas.height).toBe(Math.max(1, Math.floor(height! * scale)));
      expect(app.pending.size).toBe(1);
    }
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
    expect(app.glyphs.at(-1)!.y - pausedY).toBeLessThanOrEqual(
      app.glyphs.at(-1)!.size,
    );
    expect(app.pending.size).toBe(1);
  });
});
