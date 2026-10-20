/**
 * Client-Side Visibility & Interaction Gate (SPEC-004 / Phase 2 Performance).
 * Detects restricted devices, low-concurrency CPUs, or battery-saver / reduced-motion environments.
 */
export function isRestrictedDevice(): boolean {
  if (typeof window === "undefined") return false;
  const prefersReduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const nav = navigator as unknown as {
    connection?: { saveData?: boolean };
    hardwareConcurrency?: number;
  };
  const saveData = nav.connection?.saveData === true;
  const lowCpu =
    typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
  return prefersReduced || saveData || lowCpu;
}

/**
 * Defers execution of non-critical loops/animations until after the initial critical TBT window
 * (3500ms post load) OR until the user explicitly performs an interaction (scroll, touch, key, pointer).
 * Returns a cancel function.
 */
export function runWhenIdleOrInteracted(
  callback: () => void,
  minDelayMs = 3500,
): () => void {
  if (typeof window === "undefined") return () => {};

  let fired = false;
  let timerId: number | null = null;
  let idleId: number | null = null;

  const trigger = () => {
    if (fired) return;
    fired = true;
    cleanup();
    callback();
  };

  const cleanup = () => {
    interactionEvents.forEach((evt) => {
      window.removeEventListener(evt, trigger);
    });
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    if (idleId !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
      idleId = null;
    }
  };

  const interactionEvents = [
    "scroll",
    "pointerdown",
    "keydown",
    "touchstart",
  ] as const;

  interactionEvents.forEach((evt) => {
    window.addEventListener(evt, trigger, { once: true, passive: true });
  });

  const scheduleIdle = () => {
    timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => trigger(), {
          timeout: 2000,
        });
      } else {
        trigger();
      }
    }, minDelayMs);
  };

  if (document.readyState === "complete") {
    scheduleIdle();
  } else {
    window.addEventListener("load", scheduleIdle, {
      once: true,
      passive: true,
    });
  }

  return cleanup;
}

/**
 * Combines IntersectionObserver and document visibilitychange.
 * Executes onVisible only when element is in the viewport and tab is active;
 * executes onHidden when out of view or tab is hidden.
 */
export function observeElementVisibility(
  element: Element,
  onVisible: () => void,
  onHidden?: () => void,
  options?: IntersectionObserverInit,
): () => void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    onVisible();
    return () => {};
  }

  let isIntersecting = false;

  const checkState = () => {
    if (isIntersecting && !document.hidden) {
      onVisible();
    } else {
      onHidden?.();
    }
  };

  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    isIntersecting = entry.isIntersecting;
    checkState();
  }, options);

  observer.observe(element);

  const handleVisibilityChange = () => {
    checkState();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
