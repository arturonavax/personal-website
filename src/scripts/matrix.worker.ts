import { MatrixGrid } from "./matrix-grid";
import { MatrixQuality } from "./matrix-quality";
import { resizeMatrixSurface } from "./matrix-viewport";

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

interface PointerMessage {
  type: "pointer";
  x: number;
  y: number;
  active: boolean;
}

interface QualityMessage {
  type: "quality";
  level: 0 | 1 | 2;
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
  | PointerMessage
  | QualityMessage
  | PauseMessage
  | ResumeMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  setTimeout: (cb: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
}

const scope = self as unknown as WorkerScope;

const FRAME_INTERVAL = 1000 / 60;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let isLight = false;
let hidden = false;
let frameTimerId: number | null = null;
let grid: MatrixGrid | null = null;
let lastRenderTime: number | null = null;
const quality = new MatrixQuality();
let viewport = { width: 0, height: 0, dpr: 1 };
function layout(w: number, h: number, dpr: number): void {
  if (!canvas || !ctx) return;
  viewport = { width: w, height: h, dpr };
  resizeMatrixSurface(canvas, ctx, w, h, dpr, quality.scale);
  grid?.resize(w, h);
}

function scheduleNextFrame(): void {
  if (hidden || frameTimerId !== null) return;
  // Worker rAF depends on the owner window's rendering opportunities. An owned,
  // bounded timer keeps OffscreenCanvas painting during main-thread navigation.
  const delay =
    lastRenderTime === null
      ? quality.frameInterval
      : Math.max(
          0,
          quality.frameInterval - (performance.now() - lastRenderTime),
        );
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
  const started = performance.now();
  grid?.draw(elapsed);
  if (quality.record(performance.now() - started, performance.now())) {
    layout(viewport.width, viewport.height, viewport.dpr);
  }
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
    case "pointer":
      grid?.setPointer(msg.x, msg.y, msg.active);
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
    case "quality":
      if (quality.setMinimumLevel(msg.level)) {
        layout(viewport.width, viewport.height, viewport.dpr);
        stopFrameLoop();
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
