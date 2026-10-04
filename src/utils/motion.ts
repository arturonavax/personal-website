// src/utils/motion.ts
/**
 * Hardware Acceleration & Compositor Lifecycle Engine (SPEC-004 REQ-MOT-01 / REQ-MOT-02)
 * Manages dynamic will-change lifecycle to prevent permanent VRAM consumption and font blurriness.
 */

export function attachHardwareAcceleration(element: HTMLElement): () => void {
  element.style.willChange = "transform, opacity";

  return () => {
    element.style.willChange = "auto";
  };
}

export function isReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
