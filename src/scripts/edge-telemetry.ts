/** One collector for Astro, cached timeline commits and bfcache restores. */
declare global {
  interface Window {
    __edgeTelemetryInstalled?: boolean;
  }
}

export function installEdgeTelemetry(): void {
  if (window.__edgeTelemetryInstalled) return;
  window.__edgeTelemetryInstalled = true;
  let lastCommittedPath = window.location.pathname || "/";
  let initial = true;
  const defer = (task: () => void) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(task, { timeout: 3500 });
    else setTimeout(task, 3000);
  };
  const refresh = async (path: string) => {
    const counters = document.querySelectorAll<HTMLElement>(
      "[data-edge-view-counter]",
    );
    if (!counters.length) return;
    try {
      const response = await fetch(
        `/api/telemetry/views?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok || window.location.pathname !== path) return;
      const data = (await response.json()) as { views?: number };
      const views = typeof data.views === "number" ? data.views : 0;
      counters.forEach((node) => {
        node.textContent = `${views.toLocaleString()} views`;
      });
    } catch {
      /* Optional counters never block content. */
    }
  };
  const record = (trigger: "spa_transition" | "bfcache") => {
    // Capture at commit, not at idle: another route may finish in the meantime.
    const path = window.location.pathname || "/";
    if (trigger === "spa_transition" && path === lastCommittedPath) return;
    lastCommittedPath = path;
    const payload = JSON.stringify({
      path,
      referrer: document.referrer || "",
      trigger,
      eventType: trigger,
    });
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        "/api/telemetry/collect",
        new Blob([payload], { type: "application/json" }),
      );
    if (!sent)
      void fetch("/api/telemetry/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    defer(() => {
      void refresh(path);
    });
  };
  document.addEventListener("astro:page-load", () => {
    if (initial) {
      initial = false;
      document.cookie = "ev_init=; Max-Age=0; Path=/; SameSite=Lax";
      const path = window.location.pathname || "/";
      defer(() => {
        void refresh(path);
      });
      return; // The initial document was already recorded by the Worker.
    }
    record("spa_transition");
  });
  document.addEventListener("site:route-committed", () =>
    record("spa_transition"),
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) record("bfcache");
  });
}
