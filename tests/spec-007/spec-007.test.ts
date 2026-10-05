import { describe, expect, it, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  HEADER_ALWAYS_VISIBLE_Y,
  HEADER_HIDE_AFTER_Y,
  HEADER_HYSTERESIS_PX,
  nextHeaderScrollState,
  type HeaderScrollState,
} from "../../src/lib/navigation/header-scroll";
import {
  MORE_ROUTES,
  resolveHeaderNavState,
} from "../../src/lib/navigation/nav-state";

const ROOT_DIR = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT_DIR, rel), "utf-8");

class MemoryStorage {
  private readonly store = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
    this.writes.length = 0;
  }
}

const sessionStorage = new MemoryStorage();
const localStorage = new MemoryStorage();

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("SPEC-007 REQ-1: Header scroll hysteresis & anchor lock", () => {
  const visible: HeaderScrollState = { hidden: false, lastY: 0 };
  const step = (
    state: HeaderScrollState,
    currentY: number,
    locked = false,
  ): HeaderScrollState => nextHeaderScrollState({ ...state, currentY, locked });

  it("exposes the spec constants", () => {
    expect(HEADER_HYSTERESIS_PX).toBe(16);
    expect(HEADER_ALWAYS_VISIBLE_Y).toBe(10);
    expect(HEADER_HIDE_AFTER_Y).toBe(80);
  });

  it("ignores jitter below the 16px hysteresis threshold", () => {
    const start: HeaderScrollState = { hidden: false, lastY: 400 };
    const after = step(start, 400 + HEADER_HYSTERESIS_PX - 1);
    expect(after).toEqual(start);
  });

  it("hides on a >=16px downward scroll past 80px", () => {
    const after = step({ hidden: false, lastY: 400 }, 416);
    expect(after).toEqual({ hidden: true, lastY: 416 });
  });

  it("does not hide below 80px even on a large downward delta", () => {
    const after = step({ hidden: false, lastY: 20 }, 70);
    expect(after.hidden).toBe(false);
    expect(after.lastY).toBe(70);
  });

  it("reveals on a >=16px upward scroll", () => {
    const after = step({ hidden: true, lastY: 900 }, 884);
    expect(after).toEqual({ hidden: false, lastY: 884 });
  });

  it("forces visibility at scrollY <= 10", () => {
    const after = step({ hidden: true, lastY: 500 }, HEADER_ALWAYS_VISIBLE_Y);
    expect(after).toEqual({ hidden: false, lastY: HEADER_ALWAYS_VISIBLE_Y });
  });

  it("never toggles while a programmatic anchor scroll is locked", () => {
    let state: HeaderScrollState = { hidden: false, lastY: 6000 };
    // Smooth scroll from footer (#contact) back to top (#about): wide, noisy deltas.
    for (const y of [5200, 4100, 4400, 2500, 2900, 900, 1200, 300, 80]) {
      state = step(state, y, true);
      expect(state.hidden).toBe(false);
      expect(state.lastY).toBe(y);
    }
  });

  it("resyncs lastY on unlock so the first real scroll has no phantom delta", () => {
    const locked = step({ hidden: false, lastY: 6000 }, 120, true);
    const after = step(locked, 125);
    expect(after).toEqual({ hidden: false, lastY: 120 });
  });
});

describe("SPEC-007 REQ-1: Header solid sticky invariant & zero-glitch contract", () => {
  const header = read("src/components/common/Header.astro");
  const css = read("src/styles/global.css");

  it("header is firmly pinned at sticky top-0 without auto-hiding or transform churn", () => {
    // Header must remain permanently sticky top-0 so subpages with sticky top-14 (ExperienceTimeline) never glitch
    expect(header).toMatch(
      /<header[^>]*id="site-header"[^>]*class="[^"]*sticky top-0/,
    );
    expect(header).not.toContain("header-hidden");
    expect(header).not.toContain("var(--header-translate");
  });

  it("global.css keeps header position sticky and free of layout/transform animations", () => {
    expect(css).toMatch(
      /header#site-header,\s*header\s*\{[^}]*position:\s*sticky;/,
    );
    expect(css).not.toMatch(/header#site-header\.header-hidden/);
    expect(css).not.toMatch(/transition:\s*transform/);
  });
});

describe("SPEC-007 REQ-2: Progressive content entrance (zero FOUC)", () => {
  const css = read("src/styles/global.css");

  it("defines the compositor-only blur keyframes", () => {
    const frames = css.match(
      /@keyframes progressiveContentFade\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(frames).toBeDefined();
    expect(frames).toContain("filter: blur(8px)");
    expect(frames).toContain("translateY(6px)");
    expect(frames).not.toMatch(/\b(top|left|margin|height|width)\s*:/);
  });

  it("defines .progressive-reveal with a reduced-motion opt-out that stays visible", () => {
    expect(css).toMatch(
      /\.progressive-reveal\s*\{[^}]*animation:\s*progressiveContentFade\s+300ms/,
    );
    const reduced = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.progressive-reveal\s*\{[^}]*\}/,
    )?.[0];
    expect(reduced).toBeDefined();
    expect(reduced).toContain("opacity: 1");
    expect(reduced).toContain("animation: none");
  });
});

describe("SPEC-007 REQ-3: Language banner session isolation", () => {
  const bannerSource = read("src/components/ui/LanguageSuggestionBanner.astro");
  const switcherSource = read("src/components/common/LanguageSwitcher.astro");
  const script = bannerSource.match(
    /<script is:inline>([\s\S]*?)<\/script>/,
  )?.[1];

  interface Harness {
    banner: { hidden: boolean; style: { display: string } };
    isVisible: () => boolean;
    click: (id: "lang-suggestion-dismiss") => void;
  }

  function runBanner(options: { languages?: string[] } = {}): Harness {
    if (!script) throw new Error("Banner inline script not found");
    const classes = new Set(["hidden", "translate-y-3", "opacity-0"]);
    const attrs: Record<string, string> = {
      "data-current-locale": "en",
      "data-target-locale": "es",
      "data-target-url": "/es/",
    };
    const banner = {
      hidden: false,
      style: { display: "" },
      offsetHeight: 0,
      classList: {
        add: (...c: string[]) => c.forEach((x) => classes.add(x)),
        remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
        contains: (c: string) => classes.has(c),
      },
      getAttribute: (n: string) => attrs[n] ?? null,
    };
    const dismiss: { onclick: null | (() => void) } = { onclick: null };
    const accept = { addEventListener: () => undefined };
    const elements: Record<string, unknown> = {
      "lang-suggestion-banner": banner,
      "lang-suggestion-dismiss": dismiss,
      "lang-suggestion-accept": accept,
    };
    const document = {
      readyState: "complete",
      documentElement: { getAttribute: () => "en" },
      getElementById: (id: string) => elements[id] ?? null,
      addEventListener: () => undefined,
    };
    const win = { location: { pathname: "/" } };
    const nav = { languages: options.languages ?? ["es-MX", "es"] };
    new Function(
      "document",
      "window",
      "navigator",
      "sessionStorage",
      "localStorage",
      "setTimeout",
      script,
    )(document, win, nav, sessionStorage, localStorage, () => 0);
    return {
      banner,
      isVisible: () => classes.has("flex") && !classes.has("hidden"),
      click: () => dismiss.onclick?.(),
    };
  }

  it("shows on the home page when the device language differs from the page", () => {
    expect(runBanner().isVisible()).toBe(true);
  });

  it("stays hidden when lang_banner_dismissed is set in sessionStorage", () => {
    sessionStorage.setItem("lang_banner_dismissed", "true");
    const h = runBanner();
    expect(h.isVisible()).toBe(false);
    expect(h.banner.hidden).toBe(true);
    expect(h.banner.style.display).toBe("none");
  });

  it("stays hidden after a manual language switch (lang_manual_override)", () => {
    sessionStorage.setItem("lang_manual_override", "true");
    const h = runBanner();
    expect(h.isVisible()).toBe(false);
    expect(h.banner.hidden).toBe(true);
    expect(h.banner.style.display).toBe("none");
  });

  it("persists dismissal to sessionStorage only, never localStorage", () => {
    const h = runBanner();
    h.click("lang-suggestion-dismiss");
    expect(sessionStorage.getItem("lang_banner_dismissed")).toBe("true");
    expect(localStorage.writes).toEqual([]);
    expect(runBanner().isVisible()).toBe(false);
  });

  it("banner source never touches localStorage", () => {
    expect(bannerSource).not.toContain("localStorage");
  });

  it("LanguageSwitcher records the manual override in sessionStorage", () => {
    expect(switcherSource).toMatch(
      /sessionStorage\.setItem\(\s*"lang_manual_override",\s*"true"\s*\)/,
    );
    expect(switcherSource).not.toMatch(
      /localStorage\.setItem\(\s*"lang_manual_override"/,
    );
  });

  it("the banner is rendered once by the root layout (home included)", () => {
    const layout = read("src/layouts/BaseLayout.astro");
    expect(layout.match(/<LanguageSuggestionBanner/g)?.length).toBe(1);
    const home = read("src/pages/[...lang]/index.astro");
    expect(home).toContain("BaseLayout");
    expect(home).not.toContain("<LanguageSuggestionBanner");
  });
});

describe('SPEC-007 REQ-4: Nav "More" vs "Services" active state', () => {
  it("activates Services and NOT More on /services routes (all locales)", () => {
    for (const p of [
      "/services/",
      "/es/services/",
      "/en/services/",
      "/es/services/backend-performance-audit/",
    ]) {
      const s = resolveHeaderNavState(p);
      expect(s.isServicesActive).toBe(true);
      expect(s.isMoreActive).toBe(false);
    }
  });

  it("still activates More for blog routes", () => {
    const s = resolveHeaderNavState("/es/blog/some-post/");
    expect(s.isMoreActive).toBe(true);
    expect(s.isServicesActive).toBe(false);
  });

  it("keeps More inactive on unrelated routes", () => {
    expect(resolveHeaderNavState("/").isMoreActive).toBe(false);
    expect(MORE_ROUTES.length).toBeGreaterThan(0);
  });

  it("Header uses the shared resolver and the client cascade no longer lights More for services", () => {
    const header = read("src/components/common/Header.astro");
    expect(header).toContain("@/lib/navigation/nav-state");
    expect(header).not.toMatch(
      /currentSection === "services"\s*&&\s*isServicesInMore/,
    );
  });
});

describe("SPEC-007 REQ-5: Matrix persistence & SPA navigation", () => {
  it("MatrixBackground declares transition:persist", () => {
    expect(read("src/components/ui/MatrixBackground.astro")).toMatch(
      /transition:persist/,
    );
  });

  it("experience page imports navigate from astro:transitions/client and never assigns window.location.href", () => {
    const slug = read("src/pages/[...lang]/experience/[slug].astro");
    expect(slug).toMatch(
      /import\s*\{\s*navigate\s*\}\s*from\s*"astro:transitions\/client"/,
    );
    expect(slug).toMatch(/navigate\(/);
    expect(slug).not.toMatch(/window\.location\.href\s*=/);
  });

  it("renders timeline nav steppers with z-30 after role-header in DOM tree", () => {
    const slug = read("src/pages/[...lang]/experience/[slug].astro");
    const roleHeaderIdx = slug.indexOf('id="role-header"');
    const pastStepperIdx = slug.indexOf('data-timeline-nav="past"');
    const futureStepperIdx = slug.indexOf('data-timeline-nav="future"');

    expect(roleHeaderIdx).toBeGreaterThan(-1);
    expect(pastStepperIdx).toBeGreaterThan(roleHeaderIdx);
    expect(futureStepperIdx).toBeGreaterThan(roleHeaderIdx);
    expect(slug).toMatch(/data-timeline-nav="past"[^>]*class="[^"]*z-30/);
    expect(slug).toMatch(/data-timeline-nav="future"[^>]*class="[^"]*z-30/);
  });
});

describe("SPEC-007 REQ-6: Print CV margin synchronization & Firefox chrome suppression", () => {
  const resumeCss = read("src/styles/resume.css");
  const globalCss = read("src/styles/global.css");
  const makerAstro = read("src/pages/[...lang]/resume/maker.astro");

  it("global.css defines @page with margin: 0mm !important to suppress Firefox headers/footers", () => {
    expect(globalCss).toMatch(/@page\s*\{[^}]*margin:\s*0mm\s*!important/i);
    expect(globalCss).toMatch(/@page\s*\{[^}]*size:\s*A4\s*portrait/i);
    // resume.css must not introduce a conflicting non-zero @page margin
    expect(resumeCss).not.toMatch(/@page\s*\{[^}]*margin:\s*12mm/i);
  });

  it("global.css defines uniform sheet padding simulating print bleed for both CV documents matching preview", () => {
    expect(globalCss).toMatch(/padding:\s*48px\s*!important/);
    expect(globalCss).toContain("#cv-document-sheet");
    expect(globalCss).toContain("#resume-live-preview");
  });

  it("maker.astro adds no conflicting print padding rule, inheriting uniform padding", () => {
    expect(makerAstro).not.toMatch(
      /#resume-live-preview\s*\{[^}]*padding:\s*0/,
    );
  });
});
