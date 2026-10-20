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
  requestAnimationFrame: (cb: (now: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
}

const scope = self as unknown as WorkerScope;

const FONT_SIZE = 14;
const FRAME_INTERVAL = 1000 / 22; // ~22 FPS throttling for minimal texture transfer overhead
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
let rafId: number | null = null;
let drops: number[] = [];
let speeds: number[] = [];
let lastRenderTime = 0;

function layout(w: number, h: number, dpr: number): void {
  if (!canvas || !ctx) return;
  width = w;
  height = h;
  const clampedDpr = Math.min(dpr || 1, 1.25);
  const targetW = Math.round(w * clampedDpr);
  const targetH = Math.round(h * clampedDpr);
  const dprChanged = Math.abs(currentDpr - clampedDpr) > 0.001;

  if (canvas.width !== targetW || canvas.height !== targetH || dprChanged) {
    canvas.width = targetW;
    canvas.height = targetH;
    currentDpr = clampedDpr;
    ctx.resetTransform();
    ctx.scale(clampedDpr, clampedDpr);
    // Explicitly purge entire viewport on zoom or resolution switch
    ctx.clearRect(0, 0, w, h);
  }

  const columns = Math.floor(w / FONT_SIZE);
  const next = new Array<number>(columns);
  const nextSpeeds = new Array<number>(columns);
  for (let i = 0; i < columns; i++) {
    // Randomized stream entrances staggered above the viewport for natural entropy
    next[i] =
      i < drops.length ? (drops[i] ?? 0) : -Math.floor(Math.random() * 50 + 2);
    nextSpeeds[i] =
      i < speeds.length ? (speeds[i] ?? 1) : 0.65 + Math.random() * 0.7;
  }
  drops = next;
  speeds = nextSpeeds;
}

function scheduleNextFrame(): void {
  if (hidden || rafId !== null) return;
  rafId = scope.requestAnimationFrame(render);
}

function stopFrameLoop(): void {
  if (rafId !== null && typeof scope.cancelAnimationFrame === "function") {
    scope.cancelAnimationFrame(rafId);
  }
  rafId = null;
}

function render(now: number): void {
  rafId = null;
  if (hidden) return;
  scheduleNextFrame();
  if (!ctx || now - lastRenderTime < FRAME_INTERVAL) return;
  lastRenderTime = now;

  ctx.fillStyle = isLight
    ? "rgba(244, 246, 248, 0.16)"
    : "rgba(26, 2, 5, 0.12)";
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;

  for (let i = 0; i < drops.length; i++) {
    const dropY = drops[i] ?? 0;
    const speed = speeds[i] ?? 1;
    const char =
      CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] || "0";
    const x = i * FONT_SIZE;
    const y = Math.floor(dropY) * FONT_SIZE;

    if (dropY > 0) {
      // Occasional glowing head glyph for organic matrix rain depth
      const isLead = Math.random() < 0.12;
      if (isLead) {
        ctx.fillStyle = isLight ? "#8B1E17" : "#FEF08A";
      } else {
        ctx.fillStyle = isLight ? "#7A1C16" : "#D48B38";
      }
      ctx.fillText(char, x, y);
    }

    // Organic stream reset with variable delays and regenerated speeds
    if (y > height + 60) {
      drops[i] = -Math.floor(Math.random() * 45 + 5);
      speeds[i] = 0.65 + Math.random() * 0.7;
    } else {
      drops[i] = dropY + speed;
    }
  }
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
      isLight = msg.isLight;
      break;
    case "visibility":
      hidden = msg.hidden;
      if (hidden) {
        stopFrameLoop();
      } else {
        scheduleNextFrame();
      }
      break;
    case "pause":
      hidden = true;
      stopFrameLoop();
      break;
    case "resume":
      hidden = false;
      scheduleNextFrame();
      break;
  }
};
