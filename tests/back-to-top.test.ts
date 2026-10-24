import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../src/components/ui/BackToTopButton.astro", import.meta.url),
  "utf8",
)
  .split("<script>")[1]!
  .split("</script>")[0]!;
function setup(path = "/", reducedMotion = false) {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const button = new EventTarget();
  Object.assign(button, {
    dataset: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
  });
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const location = new URL(`https://example.test${path}?query=kept#contact`);
  const state = { retained: true };
  let active = "contact";
  let behavior = "";
  let replacements = 0;
  const window = Object.assign(windowEvents, {
    location,
    pageYOffset: 1000,
    onscrollend: null,
    __isProgrammaticNav: false,
    __isContactInView: true,
    __updateActiveNavState() {
      active =
        path === "/" || path === "/es/"
          ? window.__isContactInView
            ? "contact"
            : "about"
          : "experience";
    },
    matchMedia() {
      return { matches: reducedMotion };
    },
    scrollTo(options: { behavior: string }) {
      behavior = options.behavior;
      window.pageYOffset = 0;
    },
  });
  const document = Object.assign(documentEvents, {
    readyState: "complete",
    getElementById() {
      return button;
    },
    documentElement: {
      scrollTop: 0,
      getAttribute() {
        return "en";
      },
    },
    body: { scrollTop: 0 },
  });
  const history = {
    state,
    replaceState(next: unknown, _title: string, url: string) {
      expect(next).toBe(state);
      replacements++;
      location.href = new URL(url, location).href;
    },
  };
  runInNewContext(source, {
    window,
    document,
    history,
    navigator: { userAgent: "test" },
    sessionStorage: {
      getItem() {
        return null;
      },
    },
    requestAnimationFrame(fn: () => void) {
      fn();
    },
    setTimeout(fn: () => void) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  });
  return {
    window,
    document,
    location,
    timers,
    click() {
      button.dispatchEvent(new Event("click"));
    },
    finish() {
      windowEvents.dispatchEvent(new Event("scrollend"));
    },
    active: () => active,
    behavior: () => behavior,
    replacements: () => replacements,
  };
}

describe("back-to-top runtime", () => {
  for (const path of ["/", "/es/"]) {
    it(`${path} clears contact only after reaching top, preserving query and state`, () => {
      const app = setup(path);
      app.click();
      app.finish();
      expect(app.location.href).toBe(`https://example.test${path}?query=kept`);
      expect(app.active()).toBe("about");
      expect(app.window.__isProgrammaticNav).toBe(false);
      expect(app.timers.size).toBe(0);
      app.finish();
      expect(app.replacements()).toBe(1);
    });
  }
  it("honors reduced motion and completes without a scrollend event", () => {
    const app = setup("/", true);
    app.click();
    expect(app.behavior()).toBe("instant");
    expect(app.active()).toBe("about");
    expect(app.location.hash).toBe("");
  });
  it("preserves nonhome navigation", () => {
    const app = setup("/experience/");
    app.click();
    app.finish();
    expect(app.active()).toBe("experience");
    expect(app.location.pathname).toBe("/experience/");
  });
  it("does not apply stale completion after navigation starts", () => {
    const app = setup();
    app.click();
    app.document.dispatchEvent(new Event("astro:before-preparation"));
    app.location.href = "https://example.test/es/#contact";
    app.window.__isProgrammaticNav = true;
    app.finish();
    for (const timer of app.timers.values()) timer();
    expect(app.location.hash).toBe("#contact");
    expect(app.window.__isProgrammaticNav).toBe(true);
    expect(app.replacements()).toBe(0);
  });
  it("releases the scroll guard when the visibility observer already removed contact", () => {
    const app = setup();
    app.click();
    app.location.hash = ""; // replaceState does not dispatch hashchange.
    app.finish();
    expect(app.active()).toBe("about");
    expect(app.window.__isProgrammaticNav).toBe(false);
    expect(app.timers.size).toBe(0);
  });
  it("does not clear an interrupted scroll or a new hash", () => {
    const app = setup();
    app.click();
    app.window.pageYOffset = 500;
    app.finish();
    expect(app.location.hash).toBe("#contact");
    app.click();
    app.location.hash = "other";
    app.finish();
    expect(app.location.hash).toBe("#other");
  });
  it("supports fallback completion and repeated clicks without stale timers", () => {
    const app = setup();
    app.click();
    app.window.pageYOffset = 1000;
    app.click();
    expect(app.timers.size).toBe(1);
    for (const timer of app.timers.values()) timer();
    expect(app.active()).toBe("about");
    expect(app.location.hash).toBe("");
    expect(app.timers.size).toBe(0);
  });
});
