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

type InboundMessage =
  InitMessage | ResizeMessage | ThemeMessage | VisibilityMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  requestAnimationFrame: (cb: (now: number) => void) => number;
}

const scope = self as unknown as WorkerScope;

const FONT_SIZE = 14;
const FRAME_INTERVAL = 60;
const CHARACTERS = "01010123456789ABCDEFλ§µsGoRustSIMDAVX2ptrchnsync".split("");

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let currentDpr = 1;
let isLight = false;
let hidden = false;
let drops: number[] = [];
let lastRenderTime = 0;

function layout(w: number, h: number, dpr: number): void {
  if (!canvas || !ctx) return;
  width = w;
  height = h;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  const dprChanged = Math.abs(currentDpr - dpr) > 0.001;

  if (canvas.width !== targetW || canvas.height !== targetH || dprChanged) {
    canvas.width = targetW;
    canvas.height = targetH;
    currentDpr = dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    // Explicitly purge entire viewport on zoom or resolution switch
    ctx.clearRect(0, 0, w, h);
  }

  const columns = Math.floor(w / FONT_SIZE);
  const next = new Array<number>(columns);
  for (let i = 0; i < columns; i++) {
    // Streams always enter from above the top edge on first paint (no mid-screen stalls)
    next[i] =
      i < drops.length ? (drops[i] ?? 0) : -Math.floor(Math.random() * 24);
  }
  drops = next;
}

function render(now: number): void {
  scope.requestAnimationFrame(render);
  if (hidden || !ctx || now - lastRenderTime < FRAME_INTERVAL) return;
  lastRenderTime = now;

  ctx.fillStyle = isLight
    ? "rgba(244, 246, 248, 0.16)"
    : "rgba(26, 2, 5, 0.12)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = isLight ? "#7A1C16" : "#D48B38";
  ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;

  for (let i = 0; i < drops.length; i++) {
    const dropY = drops[i] ?? 0;
    const char =
      CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] || "0";
    const x = i * FONT_SIZE;
    const y = dropY * FONT_SIZE;
    if (dropY > 0) {
      ctx.fillText(char, x, y);
    }
    // If drop fell below current viewport height after a zoom change, reset cleanly
    if (y > height + 50) {
      drops[i] = -Math.floor(Math.random() * 10);
    } else {
      drops[i] = y > height && Math.random() > 0.985 ? 0 : dropY + 1;
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
      scope.requestAnimationFrame(render);
      break;
    case "resize":
      layout(msg.width, msg.height, msg.dpr);
      break;
    case "theme":
      isLight = msg.isLight;
      break;
    case "visibility":
      hidden = msg.hidden;
      break;
  }
};
