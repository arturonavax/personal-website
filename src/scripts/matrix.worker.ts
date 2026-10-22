import { MatrixGrid } from "./matrix-grid";

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

const FRAME_INTERVAL = 1000 / 60;
const MAX_BACKING_PIXELS = 1920 * 1080;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let currentDpr = 1;
let isLight = false;
let hidden = false;
let frameTimerId: number | null = null;
let grid: MatrixGrid | null = null;
let lastRenderTime: number | null = null;
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
    ctx.resetTransform();
    ctx.scale(clampedDpr, clampedDpr);
  } else {
    currentDpr = clampedDpr;
  }

  grid?.resize(w, h);
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

function render(now: number): void {
  frameTimerId = null;
  if (hidden) return;
  if (!ctx) return;
  // Discard stalled-clock debt rather than jumping through unseen positions.
  const elapsed =
    lastRenderTime === null
      ? FRAME_INTERVAL
      : Math.min(now - lastRenderTime, FRAME_INTERVAL * 2);
  lastRenderTime = now;
  grid?.draw(elapsed);
  scheduleNextFrame();
}

scope.onmessage = (event: MessageEvent<InboundMessage>): void => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      grid = ctx ? new MatrixGrid(ctx) : null;
      isLight = msg.isLight;
      grid?.setTheme(isLight);
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
        grid?.setTheme(isLight);
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
