/**
 * In-Page History Scroll Router
 *
 * Provides a fluid, elegant scroll experience when navigating back/forward
 * through sections and in-page anchors ("Go back one page"), matching the
 * ergonomics of the Esc key before leaving the current page.
 */

export interface HistoryScrollRouterOptions {
  window?: Window;
  document?: Document;
}

/**
 * Handles popstate events for in-page navigation (hashes and base route returns).
 * Returns true if an in-page scroll was handled, false otherwise.
 */
export function handlePopState(
  _event?: PopStateEvent | null,
  options?: HistoryScrollRouterOptions,
): boolean {
  const win =
    options?.window ?? (typeof window !== "undefined" ? window : null);
  const doc =
    options?.document ?? (typeof document !== "undefined" ? document : null);
  if (!win || !doc) return false;

  const currentHash = win.location.hash;

  // Respect reduced-motion preferences
  const isReducedMotion = Boolean(
    win.matchMedia &&
    win.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const scrollBehavior: ScrollBehavior = isReducedMotion ? "auto" : "smooth";

  // Case 1: Target has a hash (e.g., #experience, #projects, #contact)
  if (currentHash && currentHash.length > 1) {
    const targetId = decodeURIComponent(currentHash.substring(1));

    // Special case: contact section custom smooth scroll
    if (
      targetId === "contact" &&
      typeof (win as any).__smoothScrollToContact === "function"
    ) {
      (win as any).__smoothScrollToContact();
      return true;
    }

    // Delegate to PageIndexNav if mounted and available
    if (typeof (win as any).__pageIndexScrollToTarget === "function") {
      (win as any).__pageIndexScrollToTarget(targetId, true);
      return true;
    }

    // Standard DOM target scroll with header offset compensation
    const targetEl = doc.getElementById(targetId);
    if (targetEl) {
      (win as any).__isProgrammaticNav = true;
      doc.documentElement?.classList?.add("is-anchor-scrolling");

      const headerEl =
        doc.getElementById("site-header") || doc.querySelector("header");
      const headerOffset = headerEl
        ? (headerEl as HTMLElement).offsetHeight
        : 64;
      const currentScroll =
        win.pageYOffset ||
        doc.documentElement?.scrollTop ||
        doc.body?.scrollTop ||
        0;
      const elementPosition =
        targetEl.getBoundingClientRect().top + currentScroll;
      const targetTop = Math.max(0, Math.floor(elementPosition - headerOffset));

      if (typeof win.scrollTo === "function") {
        win.scrollTo({ top: targetTop, behavior: scrollBehavior });
      }

      const onScrollEnd = () => {
        (win as any).__isProgrammaticNav = false;
        doc.documentElement?.classList?.remove("is-anchor-scrolling");
        win.removeEventListener("scrollend", onScrollEnd);
      };

      if ("onscrollend" in win) {
        win.addEventListener("scrollend", onScrollEnd, { once: true });
      }
      setTimeout(onScrollEnd, 800);

      if (typeof (win as any).__highlightPageIndexActive === "function") {
        (win as any).__highlightPageIndexActive(targetId);
      }

      return true;
    }
  }

  // Case 2: Target has NO hash (or #about / #top / #role-header), returning to the top of current page
  if (
    !currentHash ||
    currentHash === "#" ||
    currentHash === "#about" ||
    currentHash === "#top" ||
    currentHash === "#role-header"
  ) {
    const currentScrollY =
      win.pageYOffset ||
      doc.documentElement?.scrollTop ||
      doc.body?.scrollTop ||
      0;

    if (currentScrollY > 40) {
      if (typeof (win as any).__pageIndexScrollToTop === "function") {
        (win as any).__pageIndexScrollToTop();
        return true;
      }

      (win as any).__isProgrammaticNav = true;
      if (typeof win.scrollTo === "function") {
        win.scrollTo({ top: 0, behavior: scrollBehavior });
      }

      const onScrollEnd = () => {
        (win as any).__isProgrammaticNav = false;
        win.removeEventListener("scrollend", onScrollEnd);
      };

      if ("onscrollend" in win) {
        win.addEventListener("scrollend", onScrollEnd, { once: true });
      }
      setTimeout(onScrollEnd, 800);

      const firstIndexItem =
        doc
          .querySelector("[data-index-link]")
          ?.getAttribute("data-index-link") ||
        (currentHash === "#role-header" ? "role-header" : "about");

      if (typeof (win as any).__highlightPageIndexActive === "function") {
        (win as any).__highlightPageIndexActive(firstIndexItem);
      }
      if (typeof (win as any).__updateActiveNavState === "function") {
        (win as any).__updateActiveNavState();
      }

      return true;
    }
  }

  return false;
}

/**
 * Initializes the history scroll router singleton.
 * Configures manual scroll restoration and binds the popstate listener.
 */
export function setupHistoryScrollRouter(): () => void {
  if (typeof window === "undefined") return () => {};

  if ((window as any).__historyScrollRouterInitialized) {
    return () => {};
  }
  (window as any).__historyScrollRouterInitialized = true;

  if ("scrollRestoration" in window.history) {
    try {
      window.history.scrollRestoration = "manual";
    } catch (_) {}
  }

  let lastPathname = window.location.pathname;

  const onPopState = (event: PopStateEvent) => {
    const currentPathname = window.location.pathname;

    // Cross-page navigation: allow Astro ClientRouter to handle it
    if (currentPathname !== lastPathname) {
      lastPathname = currentPathname;
      return;
    }

    // In-page navigation: handle fluid scroll through zones
    handlePopState(event);
  };

  window.addEventListener("popstate", onPopState);

  const onAfterSwap = () => {
    lastPathname = window.location.pathname;
    if ("scrollRestoration" in window.history) {
      try {
        window.history.scrollRestoration = "manual";
      } catch (_) {}
    }
  };
  document.addEventListener("astro:after-swap", onAfterSwap);

  return () => {
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("astro:after-swap", onAfterSwap);
    delete (window as any).__historyScrollRouterInitialized;
  };
}
