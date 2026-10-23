import { describe, expect, it } from "bun:test";
import { MatrixGrid } from "../src/scripts/matrix-grid";

type Glyph = {
  x: number;
  y: number;
  symbol: number;
  alpha: number;
  size: number;
};
function rain(width = 360, height = 640, seed = 1) {
  const frame: Glyph[] = [];
  let rasterizations = 0;
  const ctx = {
    globalAlpha: 1,
    clearRect() {
      frame.length = 0;
    },
    drawImage(_atlas: CanvasImageSource, ...coords: number[]) {
      frame.push({
        x: coords[4]!,
        y: coords[5]!,
        symbol: coords[0]!,
        alpha: ctx.globalAlpha,
        size: coords[6]!,
      });
    },
  };
  const grid = new MatrixGrid(
    ctx,
    () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    () =>
      ({
        getContext: () => ({
          clearRect() {},
          fillText() {
            rasterizations++;
          },
        }),
      }) as unknown as OffscreenCanvas,
  );
  grid.resize(width, height);
  return {
    grid,
    frame,
    get rasterizations() {
      return rasterizations;
    },
  };
}

describe("continuously falling Matrix rain", () => {
  it("moves the glyphs themselves by fractional pixels on each frame", () => {
    const app = rain();
    app.grid.draw(3500);
    const before = app.frame.find(
      (g) => g.alpha === 1 && g.y >= g.size && g.y < 500,
    )!;
    expect(before).toBeDefined();
    const rasterizations = app.rasterizations;
    app.grid.draw(1000 / 120);
    const moved = app.frame.find(
      (g) => g.x === before.x && g.y > before.y && g.y < before.y + 6,
    );
    expect(moved).toBeDefined();
    expect(moved!.alpha).toBeGreaterThan(0);
    expect(app.rasterizations).toBe(rasterizations);
  });

  it("changes the falling head symbol while retaining its fading tail", () => {
    const app = rain(360, 1800);
    const before = app.frame.find(
      (g) => g.x === 0 && g.alpha === 1 && g.y > 300 && g.y < 1500,
    )!;
    expect(before).toBeDefined();
    app.grid.draw(500);
    const head = app.frame.find(
      (g) =>
        g.x === 0 &&
        g.alpha === 1 &&
        g.y > before.y + before.size * 8 * 0.5 * 0.8 &&
        g.y < before.y + before.size * 8 * 0.5 * 1.2,
    );
    expect(head).toBeDefined();
    expect(head!.symbol).not.toBe(before.symbol);
    expect(
      app.frame.some((g) => g.x === 0 && g.y < head!.y && g.alpha < 0.2),
    ).toBe(true);
  });

  it("uses bounded depth sizes with most visible glyphs larger than the old minimum", () => {
    const app = rain(1440, 900, 789);
    const sizes = app.frame.map((g) => g.size);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(23);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(35);
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(3);
    expect(
      sizes.filter((size) => size > 23).length / sizes.length,
    ).toBeGreaterThan(0.5);
  });

  it("retains existing column phases when zoom shrinks then restores the viewport", () => {
    const app = rain(1440, 900);
    app.grid.draw(1000);
    const before = app.frame.map((g) => ({ x: g.x, y: g.y, size: g.size }));
    app.grid.resize(1200, 700);
    app.grid.resize(1440, 900);
    expect(app.frame.map((g) => ({ x: g.x, y: g.y, size: g.size }))).toEqual(
      before,
    );
  });

  it("warps only nearby rain around the pointer without extra text rasterization", () => {
    const plain = rain();
    const lens = rain();
    const rasterizations = lens.rasterizations;
    lens.grid.setPointer(180, 320, true);
    for (let frame = 0; frame < 12; frame++) {
      plain.grid.draw(1000 / 60);
      lens.grid.draw(1000 / 60);
    }
    expect(lens.frame.length).toBe(plain.frame.length);
    expect(
      lens.frame.some((glyph, i) => Math.abs(glyph.x - plain.frame[i]!.x) > 1),
    ).toBe(true);
    plain.frame.forEach((glyph, i) => {
      if ((glyph.x - 180) ** 2 + (glyph.y - 320) ** 2 > 405 ** 2) {
        expect(lens.frame[i]!.x).toBe(glyph.x);
        expect(lens.frame[i]!.y).toBe(glyph.y);
      }
    });
    expect(lens.rasterizations).toBe(rasterizations);
  });

  it("uses the requested 18–28px glyph range", () => {
    const app = rain(1920, 1080, 789);
    const sizes = [...new Set(app.frame.map((g) => g.size))];
    expect(sizes).toEqual(expect.arrayContaining([23, 27, 30, 35]));
    expect(Math.min(...sizes)).toBe(23);
    expect(Math.max(...sizes)).toBe(35);
  });

  it("keeps the expanded pointer lens active well outside its former radius", () => {
    const plain = rain(1200, 1000);
    const lens = rain(1200, 1000);
    lens.grid.setPointer(600, 500, true);
    for (let frame = 0; frame < 15; frame++) {
      plain.grid.draw(1000 / 60);
      lens.grid.draw(1000 / 60);
    }
    expect(
      plain.frame.some((g, i) => {
        const d = (g.x + g.size / 2 - 600) ** 2 + (g.y + g.size / 2 - 500) ** 2;
        return (
          d > 240 ** 2 && d < 320 ** 2 && Math.abs(lens.frame[i]!.x - g.x) > 0.1
        );
      }),
    ).toBe(true);
  });

  it("eases rapid pointer movement instead of teleporting the lens", () => {
    const smooth = rain(1200, 1000);
    const fixed = rain(1200, 1000);
    for (const app of [smooth, fixed]) {
      app.grid.setPointer(300, 500, true);
      app.grid.draw(1000);
    }
    smooth.grid.setPointer(900, 500, true);
    smooth.grid.repaint();
    expect(smooth.frame).toEqual(fixed.frame);
    smooth.grid.draw(1000 / 60);
    fixed.grid.draw(1000 / 60);
    const offsets = smooth.frame.map((g, i) =>
      Math.abs(g.x - fixed.frame[i]!.x),
    );
    expect(Math.max(...offsets)).toBeGreaterThan(0.1);
    expect(Math.max(...offsets)).toBeLessThan(6);
  });

  it("follows pointer targets with the same easing at 60 and 120Hz", () => {
    const sixty = rain(1200, 1000);
    const highRefresh = rain(1200, 1000);
    for (const app of [sixty, highRefresh]) {
      app.grid.setPointer(300, 500, true);
      app.grid.draw(1000);
      app.grid.setPointer(900, 500, true);
    }
    for (let i = 0; i < 30; i++) sixty.grid.draw(1000 / 60);
    for (let i = 0; i < 60; i++) highRefresh.grid.draw(1000 / 120);
    sixty.frame.forEach((g, i) => {
      expect(g.x).toBeCloseTo(highRefresh.frame[i]!.x, 7);
      expect(g.y).toBeCloseTo(highRefresh.frame[i]!.y, 7);
    });
  });

  it("switches cached palettes without rasterizing text during the theme reveal", () => {
    const app = rain();
    const rasterizations = app.rasterizations;
    app.grid.setTheme(true);
    expect(app.rasterizations).toBe(rasterizations);
    app.grid.setTheme(false);
    expect(app.rasterizations).toBe(rasterizations);
  });

  it("packs both palette caches by font size instead of duplicating largest-size rows", () => {
    const atlases: { width: number; height: number }[] = [];
    new MatrixGrid(
      { clearRect() {}, drawImage() {}, globalAlpha: 1 },
      () => 0.5,
      () => {
        const atlas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillText() {} }),
        };
        atlases.push(atlas);
        return atlas as unknown as OffscreenCanvas;
      },
    );
    expect(atlases.length).toBe(4);
    const pixels = atlases.reduce(
      (sum, atlas) => sum + atlas.width * atlas.height,
      0,
    );
    const uniform = atlases.at(-1)!.width * atlases.at(-1)!.height * 4;
    expect(pixels).toBeLessThan(uniform * 0.7);
  });

  it("keeps the same physical fall speed at 60 and 120 draw calls per second", () => {
    const sixty = rain();
    const highRefresh = rain();
    for (let frame = 0; frame < 60; frame++) sixty.grid.draw(1000 / 60);
    for (let frame = 0; frame < 120; frame++) highRefresh.grid.draw(1000 / 120);
    expect(sixty.frame.length).toBe(highRefresh.frame.length);
    sixty.frame.forEach((glyph, index) => {
      expect(glyph.x).toBe(highRefresh.frame[index]!.x);
      expect(glyph.y).toBeCloseTo(highRefresh.frame[index]!.y, 7);
    });
  });

  for (const [width, height] of [
    [360, 640],
    [1440, 900],
    [360, 1800],
  ]) {
    it(`distributes ongoing rain without synchronized empty waves at ${width}x${height}`, () => {
      const app = rain(width, height, 789);
      let minimum = Infinity;
      let maximum = 0;
      for (let time = 0; time < 120_000; time += 250) {
        const count = app.frame.length;
        minimum = Math.min(minimum, count);
        maximum = Math.max(maximum, count);
        // Includes initial paint, repeated cycles and independent column speeds.
        expect(count).toBeGreaterThan((((width! / 48) * height!) / 48) * 0.18);
        app.grid.draw(250);
      }
      // Below md the background is hidden; fewer large lanes naturally vary more.
      expect(maximum / minimum).toBeLessThan(width! < 768 ? 4 : 2);
    });
  }

  it("keeps falling glyph boxes separated and preserves positions on theme and same-size resize", () => {
    const app = rain();
    for (let frame = 0; frame < 180; frame++) {
      const columns = new Map<number, number[]>();
      for (const glyph of app.frame) {
        const ys = columns.get(glyph.x) ?? [];
        ys.push(glyph.y);
        columns.set(glyph.x, ys);
      }
      for (const ys of columns.values()) {
        ys.sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++)
          expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(17.999999);
      }
      app.grid.draw(1000 / 60);
    }
    const before = app.frame.map(({ x, y }) => ({ x, y }));
    app.grid.setTheme(true);
    expect(app.frame.map(({ x, y }) => ({ x, y }))).toEqual(before);
    app.grid.resize(360, 640);
    expect(app.frame.map(({ x, y }) => ({ x, y }))).toEqual(before);
  });
});
