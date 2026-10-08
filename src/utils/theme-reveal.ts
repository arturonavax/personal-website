// src/utils/theme-reveal.ts
/**
 * WAAPI Circular Reveal Isolation Engine (SPEC-004 REQ-MOT-01 / REQ-CWV-02)
 * Provides GPU-assisted clipPath circular reveal for zero-layout-shift theme transitions.
 */

export async function triggerCircularThemeReveal(
  event: MouseEvent,
  applyDomMutations: () => void,
): Promise<void> {
  const isReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    isReduced
  ) {
    applyDomMutations();
    return;
  }

  const { clientX: x, clientY: y } = event;
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(() => {
    applyDomMutations();
  });

  await transition.ready;

  // Enforce explicit containment and compositor execution
  const animation = document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${maxRadius}px at ${x}px ${y}px)`,
      ],
    },
    {
      duration: 380,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      pseudoElement: "::view-transition-new(root)",
    },
  );

  await animation.finished;
}
