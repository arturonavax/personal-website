/** Keep logical coordinates aligned with every actual backing-store size. */
export function resizeMatrixSurface(
  canvas: Pick<HTMLCanvasElement, "width" | "height">,
  ctx: Pick<CanvasRenderingContext2D, "resetTransform" | "scale">,
  width: number,
  height: number,
  dpr: number,
  qualityScale = 1,
): void {
  const scale =
    Math.min(
      dpr || 1,
      1,
      Math.sqrt((1920 * 1080) / Math.max(1, width * height)),
    ) * qualityScale;
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  // Floor rounding and sub-budget zoom changes must not leave a stale transform.
  ctx.resetTransform();
  ctx.scale(w / width, h / height);
}

/** One binding per persistent canvas; ignore transient detached/hidden layouts. */
export function observeMatrixViewport(
  canvas: HTMLCanvasElement,
  onResize: (width: number, height: number, dpr: number) => void,
): void {
  let width = canvas.clientWidth || window.innerWidth;
  let height = canvas.clientHeight || window.innerHeight;
  let dpr = window.devicePixelRatio || 1;
  const update = () => {
    if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight)
      return;
    const nextDpr = window.devicePixelRatio || 1;
    if (
      width === canvas.clientWidth &&
      height === canvas.clientHeight &&
      dpr === nextDpr
    )
      return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    dpr = nextDpr;
    onResize(width, height, dpr);
  };
  window.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("resize", update, { passive: true });
  new ResizeObserver(update).observe(canvas);
  const watchResolution = () => {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      .addEventListener(
        "change",
        () => {
          update();
          watchResolution();
        },
        { once: true },
      );
  };
  watchResolution();
}

/** At most one small message per owner frame, with no idle animation loop. */
export function observeMatrixPointer(
  onPointer: (x: number, y: number, active: boolean) => void,
): void {
  let pending = false;
  let x = 0;
  let y = 0;
  let active = false;
  const flush = () => {
    pending = false;
    onPointer(x, y, active);
  };
  const queue = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(flush);
    }
  };
  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      x = event.clientX;
      y = event.clientY;
      active = true;
      queue();
    },
    { passive: true },
  );
  const leave = () => {
    active = false;
    queue();
  };
  window.addEventListener(
    "pointerout",
    (event) => {
      if (!event.relatedTarget) leave();
    },
    { passive: true },
  );
  window.addEventListener("blur", leave);
}
