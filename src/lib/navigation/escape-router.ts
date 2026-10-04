/**
 * SPEC-006 REQ-UXE-07: Infallible Hierarchical Esc State Machine & Navigation Router
 *
 * Deterministic Ergonomics:
 * 1. Closes open native dialogs (dialog[open]).
 * 2. Closes open details dropdown menus (header details, mobile nav).
 * 3. Closes table of contents (TOC) panel if open.
 * 4. Blurs active input/textarea/select/contentEditable elements.
 * 5. Progressive smooth scroll to top if scrollY > 40px.
 * 6. Hierarchical navigation back if at top (scrollY <= 40px):
 *    e.g., /experience/slug/ -> /experience/, /experience/ -> /,
 *    and /es/experience/slug/ -> /es/experience/, /es/experience/ -> /es/.
 * 7. Opens/toggles ShortcutsModal if at homepage top (scrollY <= 40px).
 *
 * @param currentPath Current URL pathname (e.g. window.location.pathname)
 * @param navigateFn Navigation callback to navigate to a new URL
 * @returns boolean indicating whether the escape action was handled
 */
export function handleEscapeKey(
  currentPath: string,
  navigateFn: (url: string) => void,
): boolean {
  if (typeof document === "undefined") return false;

  // 1. Close open native dialogs or modal panels
  const openDialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (openDialog) {
    if (typeof openDialog.close === "function") {
      openDialog.close();
    } else {
      openDialog.removeAttribute("open");
    }
    return true;
  }

  // 2. Close open details dropdown menus (header, mobile nav, etc.)
  const openDetails = document.querySelector<HTMLDetailsElement>(
    "header details[open], details.group\\/more[open], #mobile-nav-details[open]",
  );
  if (openDetails) {
    openDetails.removeAttribute("open");
    return true;
  }

  // 3. Close TOC (Table of Contents) expanded panel if open
  if (
    typeof window !== "undefined" &&
    (window as any).__isPageIndexOpen &&
    typeof (window as any).__toggleIndexPanel === "function"
  ) {
    (window as any).__toggleIndexPanel(false);
    return true;
  }
  const tocPanel = document.getElementById("index-expanded-panel");
  if (tocPanel && !tocPanel.classList.contains("hidden")) {
    if (
      typeof window !== "undefined" &&
      typeof (window as any).__toggleIndexPanel === "function"
    ) {
      (window as any).__toggleIndexPanel(false);
    } else {
      tocPanel.classList.add("hidden");
    }
    const currentBtn =
      document.getElementById("open-index-floating-btn") ||
      document.getElementById("mobile-page-index-btn");
    if (currentBtn && typeof currentBtn.focus === "function") {
      currentBtn.focus();
    }
    return true;
  }

  // 4. Blur active input/textarea/select/editable elements
  const active = document.activeElement;
  const tag = active?.tagName?.toUpperCase() || "";
  const isInput =
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    Boolean((active as HTMLElement)?.isContentEditable);
  if (isInput && typeof (active as HTMLElement)?.blur === "function") {
    (active as HTMLElement).blur();
    return true;
  }

  // 5. Progressive smooth scroll to top if scrolled past tolerance threshold (40px)
  const currentScrollY =
    typeof window !== "undefined"
      ? window.pageYOffset ||
        document.documentElement?.scrollTop ||
        document.body?.scrollTop ||
        0
      : 0;

  if (currentScrollY > 40) {
    if (
      typeof window !== "undefined" &&
      typeof window.scrollTo === "function"
    ) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return true;
  }

  // 6. Hierarchical route navigation back when at top (scrollY <= 40px)
  const normalizedPath = currentPath.replace(/\/+$/, "") || "/";
  const segments = normalizedPath.split("/").filter(Boolean);
  const isEs = segments[0] === "es";
  const effectiveSegments = isEs ? segments.slice(1) : segments;

  if (effectiveSegments.length > 1) {
    // E.g., /experience/slug -> /experience/
    // E.g., /es/experience/slug -> /es/experience/
    const parentSegments = isEs
      ? ["es", ...effectiveSegments.slice(0, -1)]
      : effectiveSegments.slice(0, -1);
    navigateFn("/" + parentSegments.join("/") + "/");
    return true;
  }

  if (effectiveSegments.length === 1) {
    // E.g., /experience -> /
    // E.g., /es/experience -> /es/
    navigateFn(isEs ? "/es/" : "/");
    return true;
  }

  // 7. Homepage at top: open / toggle shortcuts modal
  if (
    typeof window !== "undefined" &&
    typeof (window as any).__openShortcutsModal === "function"
  ) {
    (window as any).__openShortcutsModal();
    return true;
  }
  if (
    typeof window !== "undefined" &&
    typeof (window as any).__toggleShortcutsModal === "function"
  ) {
    (window as any).__toggleShortcutsModal();
    return true;
  }
  const shortcutsBtn =
    typeof document !== "undefined"
      ? document.getElementById("open-shortcuts-btn")
      : null;
  if (shortcutsBtn) {
    shortcutsBtn.click();
    return true;
  }

  return false;
}
