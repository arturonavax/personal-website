/** Fractional-pixel falling glyph trains, shared by Worker and fallback. */
type DrawingContext = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "drawImage" | "globalAlpha"
>;
type GlyphCanvas = HTMLCanvasElement | OffscreenCanvas;

const FONT_SIZES = [18, 21, 24, 28] as const;
const LENS_RADIUS_SQUARED = 360 * 360;
const ROWS_PER_SECOND = 6.5;
const MUTATION_INTERVAL = 120;
const CHARACTERS = "012345789Z*+:=<>¦ｱｲｳｴｵｶｷｹｻｼｽｾﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾕﾗﾘﾜ";

interface Train {
  glyphs: number[];
  energy: Float32Array;
  target: Float32Array;
}

interface Stream {
  x: number;
  variant: number;
  cellSize: number;
  fade: Float32Array;
  position: number;
  speed: number;
  tailLength: number;
  spacing: number;
  mutationElapsed: number;
  mutationInterval: number;
  cells: Map<number, Train>;
}

function cellSizeFor(fontSize: number): number {
  // Preserve enough spacing for the lens's bounded radial compression.
  return fontSize + Math.ceil(fontSize * 0.24);
}

function createAtlas(): GlyphCanvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(1, 1)
    : document.createElement("canvas");
}

export class MatrixGrid {
  private streams: Stream[] = [];
  private width = 0;
  private coveredWidth = 0;
  private pointerX = 0;
  private pointerY = 0;
  private pointerTargetX = 0;
  private pointerTargetY = 0;
  private pointerInitialized = false;
  private lens = 0;
  private lensTarget = 0;
  private height = 0;
  private isLight = false;
  private readonly atlases: GlyphCanvas[];

  constructor(
    private readonly ctx: DrawingContext,
    private readonly random: () => number = Math.random,
    createCanvas: () => GlyphCanvas = createAtlas,
  ) {
    // Pack by font size instead of allocating every row at the largest size.
    // Both palettes are cached at boot: switching theme never rasterizes glyphs.
    this.atlases = FONT_SIZES.map((fontSize) => {
      const atlas = createCanvas();
      const cell = cellSizeFor(fontSize);
      atlas.width = CHARACTERS.length * cell;
      atlas.height = cell * 4;
      this.cacheGlyphs(atlas, fontSize, cell);
      return atlas;
    });
  }

  private cacheGlyphs(
    atlas: GlyphCanvas,
    fontSize: number,
    cell: number,
  ): void {
    const ctx = atlas.getContext("2d");
    if (!ctx) return;
    ctx.font = `${fontSize}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let palette = 0; palette < 2; palette++) {
      for (let tone = 0; tone < 2; tone++) {
        ctx.fillStyle =
          tone === 1
            ? palette === 1
              ? "#8B1E17"
              : "#FEF08A"
            : palette === 1
              ? "#7A1C16"
              : "#D48B38";
        for (let glyph = 0; glyph < CHARACTERS.length; glyph++) {
          ctx.fillText(
            CHARACTERS[glyph]!,
            glyph * cell + cell / 2,
            (palette * 2 + tone) * cell + cell / 2,
            fontSize,
          );
        }
      }
    }
  }

  setPointer(x: number, y: number, active: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pointerTargetX = x;
    this.pointerTargetY = y;
    if (!this.pointerInitialized && active) {
      this.pointerX = x;
      this.pointerY = y;
      this.pointerInitialized = true;
    }
    this.lensTarget = active ? 0.18 : 0;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // Never discard lane identities when zoom temporarily narrows the viewport.
    while (this.coveredWidth < width) {
      const depth = this.random();
      const variant = depth < 0.2 ? 0 : depth < 0.55 ? 1 : depth < 0.85 ? 2 : 3;
      const cellSize = cellSizeFor(FONT_SIZES[variant]!);
      const tailLength = 12 + Math.floor(this.random() * 5);
      const spacing = tailLength + 14 + Math.floor(this.random() * 13);
      const mutationInterval = MUTATION_INTERVAL * (1 + this.random());
      this.streams.push({
        x: this.coveredWidth,
        variant,
        cellSize,
        fade: Float32Array.from(
          { length: tailLength },
          (_, i) => (1 - i / tailLength) ** 1.65,
        ),
        // Stratified jitter fills the viewport immediately, without a shared
        // entrance wave or a synchronized wait for all streams to restart.
        position:
          ((this.streams.length * 0.61803398875 + this.random() * 0.35) % 1) *
          spacing,
        speed: 0.8 + this.random() * 0.4,
        tailLength,
        spacing,
        mutationElapsed: this.random() * mutationInterval,
        mutationInterval,
        cells: new Map(),
      });
      this.coveredWidth += cellSize;
    }
    this.repaint();
  }

  setTheme(isLight: boolean): void {
    if (this.isLight === isLight) return;
    this.isLight = isLight;
    this.repaint();
  }

  repaint(): void {
    this.draw(0);
  }

  draw(elapsed: number): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    // Time-based easing keeps fast mouse events from teleporting the lens.
    // Pointer messages only update targets; navigation never touches this state.
    const follow = 1 - Math.exp(-elapsed / 300);
    this.pointerX += (this.pointerTargetX - this.pointerX) * follow;
    this.pointerY += (this.pointerTargetY - this.pointerY) * follow;
    const smoothing = 1 - Math.exp(-elapsed / 80);
    this.lens += (this.lensTarget - this.lens) * smoothing;
    if (this.lens < 0.00001) this.lens = 0;
    for (let column = 0; column < this.streams.length; column++) {
      const stream = this.streams[column]!;
      stream.position += (elapsed * ROWS_PER_SECOND * stream.speed) / 1000;
      stream.mutationElapsed += elapsed;
      const mutate = stream.mutationElapsed >= stream.mutationInterval;
      stream.mutationElapsed %= stream.mutationInterval;
      if (stream.x >= this.width) continue;
      const rows = this.height / stream.cellSize;
      // Multiple separated trains in each lane keep tall viewports populated.
      // Train identities remain stable as they cross the viewport boundaries.
      const first = Math.ceil((-1 - stream.position) / stream.spacing);
      const last = Math.floor(
        (rows + stream.tailLength - stream.position) / stream.spacing,
      );
      for (const train of stream.cells.keys()) {
        if (train < first || train > last) stream.cells.delete(train);
      }
      for (let train = first; train <= last; train++) {
        let state = stream.cells.get(train);
        if (!state) {
          const target = Float32Array.from(
            { length: stream.tailLength },
            () => 0.6 + this.random() * 0.4,
          );
          state = {
            glyphs: Array.from({ length: stream.tailLength }, () =>
              Math.floor(this.random() * CHARACTERS.length),
            ),
            energy: target.slice(),
            target,
          };
          stream.cells.set(train, state);
        }
        const glyphs = state.glyphs;
        const head = stream.position + train * stream.spacing;
        const pulse =
          (((stream.position * 0.7 + train * 0.37) % stream.tailLength) +
            stream.tailLength) %
          stream.tailLength;
        const cell = stream.cellSize;
        const atlas = this.atlases[stream.variant]!;
        for (let index = 0; index < stream.tailLength; index++) {
          const y = (head - index) * cell;
          if (y <= -cell || y >= this.height) continue;
          // The entire train recodes at its head's cadence, rather than leaving
          // most tail glyphs frozen across several head changes.
          if (mutate) {
            state.target[index] = 0.6 + this.random() * 0.4;
            glyphs[index] =
              (glyphs[index]! +
                1 +
                Math.floor(this.random() * (CHARACTERS.length - 1))) %
              CHARACTERS.length;
          }
          state.energy[index] =
            state.energy[index]! +
            (state.target[index]! - state.energy[index]!) * smoothing;
          const glint = Math.max(0, 1 - Math.abs(index - pulse) / 1.5) * 0.18;
          this.ctx.globalAlpha =
            index === 0
              ? 1
              : stream.fade[index]! * Math.min(1, state.energy[index]! + glint);
          let dx = stream.x;
          let dy = y;
          if (this.lens > 0) {
            const vx = dx + cell / 2 - this.pointerX;
            const vy = dy + cell / 2 - this.pointerY;
            const distance = vx * vx + vy * vy;
            if (distance < LENS_RADIUS_SQUARED) {
              const falloff = 1 - distance / LENS_RADIUS_SQUARED;
              const warp = this.lens * falloff * falloff * falloff;
              dx += vx * warp;
              dy += vy * warp;
            }
          }
          // Move the symbols themselves, not just an envelope over fixed cells.
          // One atlas blit per separated glyph; no accumulated ghost frames.
          this.ctx.drawImage(
            atlas,
            glyphs[index]! * cell,
            ((this.isLight ? 2 : 0) + (index === 0 ? 1 : 0)) * cell,
            cell,
            cell,
            dx,
            dy,
            cell,
            cell,
          );
        }
      }
    }
    this.ctx.globalAlpha = 1;
  }
}
