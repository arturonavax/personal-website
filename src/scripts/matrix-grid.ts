/** Changing code with a moving light envelope, shared by Worker and fallback. */
type DrawingContext = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "drawImage" | "globalAlpha"
>;
type GlyphCanvas = HTMLCanvasElement | OffscreenCanvas;

const CELL_SIZE = 18;
const FONT_SIZE = 14;
const ROWS_PER_SECOND = 8;
const MUTATION_INTERVAL = 120;
const CHARACTERS = "012345789Z*+:=<>¦ｱｲｳｴｵｶｷｹｻｼｽｾﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾕﾗﾘﾜ";

interface Stream {
  position: number;
  speed: number;
  tailLength: number;
  cells: Map<number, number>;
}

function createAtlas(): GlyphCanvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(CHARACTERS.length * CELL_SIZE, CELL_SIZE * 2)
    : Object.assign(document.createElement("canvas"), {
        width: CHARACTERS.length * CELL_SIZE,
        height: CELL_SIZE * 2,
      });
}

export class MatrixGrid {
  private streams: Stream[] = [];
  private width = 0;
  private height = 0;
  private isLight = false;
  private mutationElapsed = 0;
  private readonly atlas: GlyphCanvas;

  constructor(
    private readonly ctx: DrawingContext,
    private readonly random: () => number = Math.random,
    createCanvas: () => GlyphCanvas = createAtlas,
  ) {
    this.atlas = createCanvas();
    this.atlas.width = CHARACTERS.length * CELL_SIZE;
    this.atlas.height = CELL_SIZE * 2;
    this.cacheGlyphs();
  }

  private cacheGlyphs(): void {
    const ctx = this.atlas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.atlas.width, this.atlas.height);
    ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let tone = 0; tone < 2; tone++) {
      ctx.fillStyle =
        tone === 1
          ? this.isLight
            ? "#8B1E17"
            : "#FEF08A"
          : this.isLight
            ? "#7A1C16"
            : "#D48B38";
      for (let glyph = 0; glyph < CHARACTERS.length; glyph++) {
        ctx.fillText(
          CHARACTERS[glyph]!,
          glyph * CELL_SIZE + CELL_SIZE / 2,
          tone * CELL_SIZE + CELL_SIZE / 2,
          FONT_SIZE,
        );
      }
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const columns = Math.ceil(width / CELL_SIZE);
    this.streams.length = Math.min(columns, this.streams.length);
    while (this.streams.length < columns) {
      this.streams.push({
        position: -Math.floor(this.random() * 24),
        speed: 0.8 + this.random() * 0.4,
        tailLength: 12 + Math.floor(this.random() * 5),
        cells: new Map(),
      });
    }
    this.repaint();
  }

  setTheme(isLight: boolean): void {
    if (this.isLight === isLight) return;
    this.isLight = isLight;
    this.cacheGlyphs();
    this.repaint();
  }

  repaint(): void {
    this.draw(0);
  }

  draw(elapsed: number): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.mutationElapsed += elapsed;
    const mutate = this.mutationElapsed >= MUTATION_INTERVAL;
    this.mutationElapsed %= MUTATION_INTERVAL;
    const rows = Math.ceil(this.height / CELL_SIZE);
    for (let column = 0; column < this.streams.length; column++) {
      const stream = this.streams[column]!;
      stream.position += (elapsed * ROWS_PER_SECOND * stream.speed) / 1000;
      if (stream.position >= rows + stream.tailLength) {
        stream.position = -5 - Math.floor(this.random() * 24);
        stream.speed = 0.8 + this.random() * 0.4;
        stream.cells.clear();
      }
      const head = Math.ceil(stream.position);
      const first = Math.max(0, Math.ceil(stream.position - stream.tailLength));
      for (const row of stream.cells.keys()) {
        if (row < first || row >= rows) stream.cells.delete(row);
      }
      for (let row = first; row <= Math.min(head, rows - 1); row++) {
        const distance = stream.position - row;
        const alpha =
          distance < 0
            ? 1 + distance
            : Math.max(0, 1 - distance / stream.tailLength) ** 1.3;
        if (alpha <= 0) continue;
        let glyph = stream.cells.get(row);
        if (glyph === undefined) {
          glyph = Math.floor(this.random() * CHARACTERS.length);
        } else if (mutate && (row === head || this.random() < 0.18)) {
          // Always replace, never crossfade different symbols in the same slot.
          glyph =
            (glyph + 1 + Math.floor(this.random() * (CHARACTERS.length - 1))) %
            CHARACTERS.length;
        }
        stream.cells.set(row, glyph);
        this.ctx.globalAlpha = alpha;
        // Glyphs stay anchored; the head and fading envelope flow down the code.
        this.ctx.drawImage(
          this.atlas,
          glyph * CELL_SIZE,
          row === head ? CELL_SIZE : 0,
          CELL_SIZE,
          CELL_SIZE,
          column * CELL_SIZE,
          row * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
        );
      }
    }
    this.ctx.globalAlpha = 1;
  }
}
