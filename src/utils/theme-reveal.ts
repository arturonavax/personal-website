// src/utils/theme-reveal.ts
/**
 * WAAPI Circular Reveal Isolation Engine (SPEC-004 REQ-MOT-01 / REQ-CWV-02 & Phase 8)
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

  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "dark";
  const direction = currentTheme === "light" ? "to-dark" : "to-light";

  document.documentElement.setAttribute("data-theme-transitioning", "true");
  document.documentElement.setAttribute(
    "data-theme-transition-direction",
    direction,
  );
  document.documentElement.classList.add("theme-transitioning");

  try {
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
        duration: 420,
        fill: "both",
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        pseudoElement: "::view-transition-new(root)",
      },
    );

    await animation.finished;
  } finally {
    document.documentElement.classList.remove("theme-transitioning");
    document.documentElement.removeAttribute("data-theme-transitioning");
    document.documentElement.removeAttribute("data-theme-transition-direction");
    window.dispatchEvent(new CustomEvent("theme-transition-end"));
  }
}
