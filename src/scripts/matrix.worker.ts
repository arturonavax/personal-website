/// Matrix rain renderer running entirely off the main thread (OffscreenCanvas + dedicated Worker).
/// Main thread only forwards: init (transferred canvas), resize, theme and visibility.

interface InitMessage {
  type: "init";
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  isLight: boolean;
}

interface ResizeMessage {
  type: "resize";
  width: number;
  height: number;
  dpr: number;
}

interface ThemeMessage {
  type: "theme";
  isLight: boolean;
}

interface VisibilityMessage {
  type: "visibility";
  hidden: boolean;
}

interface PauseMessage {
  type: "pause";
}

interface ResumeMessage {
  type: "resume";
}

type InboundMessage =
  | InitMessage
  | ResizeMessage
  | ThemeMessage
  | VisibilityMessage
  | PauseMessage
  | ResumeMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  setTimeout: (cb: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
}

const scope = self as unknown as WorkerScope;

const FONT_SIZE = 14;
const FRAME_INTERVAL = 1000 / 60;
const SIMULATION_INTERVAL = 1000 / 22;
const ROWS_PER_SECOND = 8;
const GLYPH_HOLD_MS = 150;
const MAX_BACKING_PIXELS = 1920 * 1080;
const CHARACTERS =
  "01010123456789ABCDEFλ§µΔΨΩθπσ0x::->/*!=&|^GoRustSIMDAVX2ptrchnsync".split(
    "",
  );

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let currentDpr = 1;
let isLight = false;
let hidden = false;
let frameTimerId: number | null = null;
let drops: number[] = [];
let speeds: number[] = [];
let lastRenderTime: number | null = null;
const glyphs: string[] = [];
const highlights: boolean[] = [];
let lastGlyphUpdate = -Infinity;

function layout(w: number, h: number, dpr: number): void {
  if (!canvas || !ctx) return;
  const clampedDpr = Math.min(
    dpr || 1,
    1,
    Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, w * h)),
  );
  const targetW = Math.max(1, Math.floor(w * clampedDpr));
  const targetH = Math.max(1, Math.floor(h * clampedDpr));
  const dprChanged = Math.abs(currentDpr - clampedDpr) > 0.001;

  // CRITICAL: Setting canvas.width clears the entire bitmap buffer.
  // NEVER re-assign or clear canvas buffer unless dimensions changed by > 50px or zoom/DPR shifted,
  // AND never re-assign if canvas width/height already match target dimensions.
  if (
    (canvas.width !== targetW || canvas.height !== targetH) &&
    (canvas.width === 0 ||
      canvas.height === 0 ||
      Math.abs(canvas.width - targetW) > 50 ||
      Math.abs(canvas.height - targetH) > 50 ||
      dprChanged)
  ) {
    canvas.width = targetW;
    canvas.height = targetH;
    currentDpr = clampedDpr;
    width = w;
    height = h;
    ctx.resetTransform();
    ctx.scale(clampedDpr, clampedDpr);
  } else {
    width = w;
    height = h;
    currentDpr = clampedDpr;
  }

  const columns = Math.floor(w / FONT_SIZE);
  if (columns !== drops.length) {
    const next = new Array<number>(columns);
    const nextSpeeds = new Array<number>(columns);
    for (let i = 0; i < columns; i++) {
      // Randomized stream entrances staggered above the viewport for natural entropy,
      // preserving falling drops to avoid resetting the animation stream during navigations
      next[i] =
        i < drops.length ? (drops[i] ?? 0) : -Math.floor(Math.random() * 24);
      nextSpeeds[i] =
        i < speeds.length ? (speeds[i] ?? 1) : 0.65 + Math.random() * 0.7;
    }
    drops = next;
    speeds = nextSpeeds;
  }
}

function scheduleNextFrame(): void {
  if (hidden || frameTimerId !== null) return;
  // Worker rAF depends on the owner window's rendering opportunities. An owned,
  // bounded timer keeps OffscreenCanvas painting during main-thread navigation.
  const delay =
    lastRenderTime === null
      ? FRAME_INTERVAL
      : Math.max(0, FRAME_INTERVAL - (performance.now() - lastRenderTime));
  frameTimerId = scope.setTimeout(
    () => render(performance.now()),
    Math.ceil(delay),
  );
}

function stopFrameLoop(): void {
  if (frameTimerId !== null) {
    scope.clearTimeout(frameTimerId);
  }
  frameTimerId = null;
}

function drawGlyphStreams(frameScale: number, refreshGlyphs = false): void {
  if (!ctx) return;
  ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;

  for (let i = 0; i < drops.length; i++) {
    const dropY = drops[i] ?? 0;
    const speed = speeds[i] ?? 1;
    if (refreshGlyphs || glyphs[i] === undefined) {
      glyphs[i] =
        CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] || "0";
      highlights[i] = Math.random() < 0.12;
    }
    const char = glyphs[i] || "0";
    const x = i * FONT_SIZE;
    const y = dropY * FONT_SIZE;

    if (dropY > 0 && y < height + FONT_SIZE) {
      // Occasional glowing head glyph for organic matrix rain depth
      const isLead = highlights[i];
      if (isLead) {
        ctx.fillStyle = isLight ? "#8B1E17" : "#FEF08A";
      } else {
        ctx.fillStyle = isLight ? "#7A1C16" : "#D48B38";
      }
      ctx.fillText(char, x, y);
    }

    if (frameScale > 0) {
      // Organic stream reset with variable delays and regenerated speeds
      if (y > height + 60) {
        drops[i] = -Math.floor(Math.random() * 45 + 5);
        speeds[i] = 0.65 + Math.random() * 0.7;
      } else {
        drops[i] = dropY + speed * frameScale;
      }
    }
  }
}

function flushThemeBackdrop(): void {
  if (!ctx || width <= 0 || height <= 0) return;
  ctx.fillStyle = isLight
    ? "rgba(244, 246, 248, 0.88)"
    : "rgba(26, 2, 5, 0.88)";
  ctx.fillRect(0, 0, width, height);
  drawGlyphStreams(0);
}

function render(now: number): void {
  frameTimerId = null;
  if (hidden) return;
  if (!ctx) return;
  const elapsed =
    lastRenderTime === null
      ? FRAME_INTERVAL
      : Math.min(now - lastRenderTime, 100);
  const frameScale = elapsed / SIMULATION_INTERVAL;
  lastRenderTime = now;

  const alpha = 1 - (1 - (isLight ? 0.16 : 0.12)) ** frameScale;
  ctx.fillStyle = isLight
    ? `rgba(244, 246, 248, ${alpha})`
    : `rgba(26, 2, 5, ${alpha})`;
  ctx.fillRect(0, 0, width, height);
  const refreshGlyphs = now - lastGlyphUpdate >= GLYPH_HOLD_MS;
  if (refreshGlyphs) lastGlyphUpdate = now;
  drawGlyphStreams((elapsed * ROWS_PER_SECOND) / 1000, refreshGlyphs);
  scheduleNextFrame();
}

scope.onmessage = (event: MessageEvent<InboundMessage>): void => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      isLight = msg.isLight;
      layout(msg.width, msg.height, msg.dpr);
      scheduleNextFrame();
      break;
    case "resize":
      layout(msg.width, msg.height, msg.dpr);
      scheduleNextFrame();
      break;
    case "theme":
      if (isLight !== msg.isLight) {
        isLight = msg.isLight;
        flushThemeBackdrop();
      }
      scheduleNextFrame();
      break;
    case "visibility":
      hidden = msg.hidden;
      if (hidden) {
        lastRenderTime = null;
        stopFrameLoop();
      } else {
        scheduleNextFrame();
      }
      break;
    case "pause":
      hidden = true;
      lastRenderTime = null;
      stopFrameLoop();
      break;
    case "resume":
      hidden = false;
      scheduleNextFrame();
      break;
  }
};
