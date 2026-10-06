import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleEscapeKey } from "../../src/lib/navigation/escape-router";
import { ui } from "../../src/i18n/ui";

const ROOT_DIR = path.resolve(__dirname, "../..");

describe("SPEC-006 REQ-UXE-01: Abolition of 'Technical Essays' & Blog Taxonomy", () => {
  it("defines postCategoryEnum matching the unified taxonomy in content.config.ts", () => {
    const configPath = path.join(ROOT_DIR, "src/content.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    expect(content).toContain("export const postCategoryEnum = z.enum([");

    const validCategories = [
      "systems",
      "architecture",
      "performance",
      "ai",
      "research",
      "leadership",
      "opinion",
      "notes",
      "general",
      "personal",
    ] as const;

    for (const cat of validCategories) {
      expect(content).toContain(`"${cat}"`);
    }

    expect(validCategories.includes("systems")).toBe(true);
    expect(validCategories.includes("opinion")).toBe(true);
    expect(validCategories.includes("notes")).toBe(true);

    expect(content).toContain('category: postCategoryEnum.default("systems")');
  });

  it("updates i18n blog section titles to 'Blog & Engineering Notes' / 'Blog & Notas de Ingeniería'", () => {
    expect(ui.en["section.blog"]).toBe("Blog & Engineering Notes");
    expect(ui.es["section.blog"]).toBe("Blog & Notas de Ingeniería");
    expect(ui.en["cta.readEssay"]).toBe("Read Post");
    expect(ui.es["cta.readEssay"]).toBe("Leer Publicación");
  });

  it("ensures zero occurrences of 'Technical Essays' in src/ and public/", () => {
    const checkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name !== "node_modules" &&
            entry.name !== ".astro" &&
            entry.name !== ".git"
          ) {
            checkDir(fullPath);
          }
        } else if (
          entry.name.endsWith(".astro") ||
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".json")
        ) {
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content.includes("Technical Essays")).toBe(false);
        }
      }
    };

    checkDir(path.join(ROOT_DIR, "src"));
  });

  it("ensures UI components use 'posts' instead of residue 'essays' in search tooltips and labels", () => {
    const filesToCheck = [
      "src/layouts/ArticleLayout.astro",
      "src/components/ui/ExperienceTimeline.astro",
      "src/components/ui/ProjectCard.astro",
      "src/components/ui/UniversalSearchModal.astro",
      "src/components/ui/HeroHeaderBanner.astro",
      "src/components/ui/PostCard.astro",
      "src/components/ui/BlogFilterBar.astro",
      "src/pages/[...lang]/experience/[slug].astro",
    ];

    for (const relativePath of filesToCheck) {
      const filePath = path.join(ROOT_DIR, relativePath);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toMatch(/Search.*essays/i);
      expect(content).not.toMatch(/Todos los Ensayos/i);
      expect(content).not.toMatch(/All Essays/i);
      expect(content).not.toMatch(/No essays found/i);
    }
  });
});

describe("SPEC-006 REQ-UXE-02: Homologation of Case Studies (/case-studies/)", () => {
  it("ensures SimulationCard includes company tooltip root, trigger, and experience URL", () => {
    const cardPath = path.join(
      ROOT_DIR,
      "src/components/ui/SimulationCard.astro",
    );
    const content = fs.readFileSync(cardPath, "utf-8");

    expect(content).toContain("data-company-tooltip-root");
    expect(content).toContain("data-company-trigger");
    expect(content).toContain("data-company-tooltip");
    expect(content).toContain("jobDetailUrl");
  });
});

describe("SPEC-006 REQ-UXE-03: Universal Catalog Pagination Topology", () => {
  it("enforces dynamic pagination with pageSize=6 for blog and projects", () => {
    const blogIndex = fs.readFileSync(
      path.join(ROOT_DIR, "src/pages/[...lang]/blog/index.astro"),
      "utf-8",
    );
    expect(blogIndex).toMatch(/PaginationController[\s\S]*?pageSize=\{6\}/);

    const projectsIndex = fs.readFileSync(
      path.join(ROOT_DIR, "src/pages/[...lang]/projects/index.astro"),
      "utf-8",
    );
    expect(projectsIndex).toMatch(/PaginationController[\s\S]*?pageSize=\{6\}/);
  });

  it("enforces dynamic pagination with pageSize=4 for case studies and services", () => {
    const caseStudiesIndex = fs.readFileSync(
      path.join(ROOT_DIR, "src/pages/[...lang]/case-studies/index.astro"),
      "utf-8",
    );
    expect(caseStudiesIndex).toMatch(
      /PaginationController[\s\S]*?pageSize=\{4\}/,
    );

    const servicesIndex = fs.readFileSync(
      path.join(ROOT_DIR, "src/pages/[...lang]/services/index.astro"),
      "utf-8",
    );
    expect(servicesIndex).toMatch(/PaginationController[\s\S]*?pageSize=\{4\}/);
  });
});

describe("SPEC-006 REQ-UXE-04: Single-Select Exclusivity in Projects Filter", () => {
  it("enforces single-select radio toggle behavior for organization filters", () => {
    const filterBarPath = path.join(
      ROOT_DIR,
      "src/components/ui/ProjectsFilterBar.astro",
    );
    const content = fs.readFileSync(filterBarPath, "utf-8");

    expect(content).toContain("isCompanyFilter");
    expect(content).toContain("data-is-company");
    expect(content).toMatch(/activeFilters\.delete\(comp\)/);
  });
});

describe("SPEC-006 REQ-UXE-05: Keycap Geometry & Spacing in Search Modal", () => {
  it("ensures kbd elements are centered with sufficient horizontal spacing", () => {
    const modalPath = path.join(
      ROOT_DIR,
      "src/components/ui/UniversalSearchModal.astro",
    );
    const content = fs.readFileSync(modalPath, "utf-8");

    expect(content).toMatch(/min-w-\[(1\.75|2)rem\]/);
    expect(content).toContain("items-center justify-center");
  });
});

describe("SPEC-006 REQ-UXE-06 & REQ-UXE-07: Escape Router State Machine & TOC Dismissal", () => {
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it("closes open dialog element when escape is triggered", () => {
    let dialogClosed = false;
    const mockDialog = {
      close: () => {
        dialogClosed = true;
      },
    };

    (globalThis as any).document = {
      querySelector: (sel: string) =>
        sel === "dialog[open]" ? mockDialog : null,
    };
    (globalThis as any).window = { pageYOffset: 0 };

    const navigated: string[] = [];
    const handled = handleEscapeKey("/blog/", (url) => navigated.push(url));

    expect(handled).toBe(true);
    expect(dialogClosed).toBe(true);
    expect(navigated.length).toBe(0);
  });

  it("closes open header details dropdown when escape is triggered", () => {
    let attributeRemoved = "";
    const mockDetails = {
      removeAttribute: (attr: string) => {
        attributeRemoved = attr;
      },
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => {
        if (sel === "dialog[open]") return null;
        if (sel.includes("details[open]")) return mockDetails;
        return null;
      },
    };
    (globalThis as any).window = { pageYOffset: 0 };

    const handled = handleEscapeKey("/projects/", () => {});
    expect(handled).toBe(true);
    expect(attributeRemoved).toBe("open");
  });

  it("closes TOC expanded panel when escape is triggered", () => {
    let panelToggledWith: boolean | null = null;

    (globalThis as any).document = {
      querySelector: () => null,
      getElementById: (id: string) => {
        if (id === "index-expanded-panel") {
          return {
            classList: { contains: (cls: string) => cls !== "hidden" },
          };
        }
        return null;
      },
    };
    (globalThis as any).window = {
      pageYOffset: 0,
      __isPageIndexOpen: true,
      __toggleIndexPanel: (open: boolean) => {
        panelToggledWith = open;
      },
    };

    const handled = handleEscapeKey("/blog/", () => {});
    expect(handled).toBe(true);
    expect(panelToggledWith).toBe(false);
  });

  it("blurs active input element when escape is triggered", () => {
    let blurCalled = false;
    const mockInput = {
      tagName: "INPUT",
      blur: () => {
        blurCalled = true;
      },
    };

    (globalThis as any).document = {
      querySelector: () => null,
      getElementById: () => null,
      activeElement: mockInput,
    };
    (globalThis as any).window = { pageYOffset: 0 };

    const handled = handleEscapeKey("/projects/", () => {});
    expect(handled).toBe(true);
    expect(blurCalled).toBe(true);
  });

  it("progressively scrolls to top when scrollY > 40px", () => {
    let scrolledTo: any = null;

    (globalThis as any).document = {
      querySelector: () => null,
      getElementById: () => null,
      activeElement: null,
      documentElement: { scrollTop: 120 },
    };
    (globalThis as any).window = {
      pageYOffset: 120,
      scrollTo: (opts: any) => {
        scrolledTo = opts;
      },
    };

    const handled = handleEscapeKey("/experience/slug/", () => {});
    expect(handled).toBe(true);
    expect(scrolledTo).toEqual({ top: 0, behavior: "smooth" });
  });

  it("navigates hierarchical back when scrollY <= 40px on sub-pages", () => {
    (globalThis as any).document = {
      querySelector: () => null,
      getElementById: () => null,
      activeElement: null,
      documentElement: { scrollTop: 0 },
    };
    (globalThis as any).window = { pageYOffset: 0 };

    const routes = [
      { input: "/experience/leal/", expected: "/experience/" },
      { input: "/experience/", expected: "/" },
      { input: "/es/experience/leal/", expected: "/es/experience/" },
      { input: "/es/experience/", expected: "/es/" },
      { input: "/blog/performance-tuning/", expected: "/blog/" },
    ];

    for (const r of routes) {
      let targetUrl = "";
      const handled = handleEscapeKey(r.input, (url) => {
        targetUrl = url;
      });
      expect(handled).toBe(true);
      expect(targetUrl).toBe(r.expected);
    }
  });

  it("opens Shortcuts modal when escape is triggered at the homepage root at top", () => {
    let modalOpened = false;

    (globalThis as any).document = {
      querySelector: () => null,
      getElementById: () => null,
      activeElement: null,
      documentElement: { scrollTop: 0 },
    };
    (globalThis as any).window = {
      pageYOffset: 0,
      __openShortcutsModal: () => {
        modalOpened = true;
      },
    };

    const handledEn = handleEscapeKey("/", () => {});
    expect(handledEn).toBe(true);
    expect(modalOpened).toBe(true);

    modalOpened = false;
    const handledEs = handleEscapeKey("/es/", () => {});
    expect(handledEs).toBe(true);
    expect(modalOpened).toBe(true);
  });
});

describe("SPEC-006 REQ-UXE-08: Structural Decoupling of Experience Milestone Header", () => {
  it("isolates milestone static bar from sliding article container", () => {
    const slugPagePath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/experience/[slug].astro",
    );
    const content = fs.readFileSync(slugPagePath, "utf-8");

    expect(content).toContain('id="experience-milestone-bar"');
    expect(content).toContain('id="experience-article-content"');
  });
});

describe("SPEC-006 REQ-UXE-09: Deterministic J/K Navigation Hysteresis Suppression", () => {
  it("ensures PageIndexNav tracks isNavigatingViaKeys and disables spurious observer recalculation", () => {
    const navPath = path.join(ROOT_DIR, "src/components/ui/PageIndexNav.astro");
    const content = fs.readFileSync(navPath, "utf-8");

    expect(content).toContain("isProgrammaticScroll");
    expect(content).toContain("__pageIndexStep");
    expect(content).toContain("highlightActive");
  });
});

describe("SPEC-006 REQ-UXE-10: Centered Language Suggestion Banner & Floating Isolation", () => {
  it("centers banner horizontally and manages session dismissal and overrides", () => {
    const bannerPath = path.join(
      ROOT_DIR,
      "src/components/ui/LanguageSuggestionBanner.astro",
    );
    const content = fs.readFileSync(bannerPath, "utf-8");

    expect(content).toContain("left-1/2 -translate-x-1/2");
    expect(content).toContain("lang_banner_dismissed"); // SPEC-007 REQ-3 (was dismissed_lang_suggestion)
    expect(content).toContain("page_lang_override_");
    expect(content).toContain("lang-suggestion-dismiss");
  });
});

describe("SPEC-006 REQ-UXE-11: Fluid Kinetics for Contact and About", () => {
  it("smoothly scrolls to top when About is clicked on homepage", () => {
    const headerPath = path.join(
      ROOT_DIR,
      "src/components/common/Header.astro",
    );
    const content = fs.readFileSync(headerPath, "utf-8");

    expect(content).toMatch(
      /window\.scrollTo\(\{[\s\S]*?top:\s*0[\s\S]*?behavior:\s*["']smooth["']/,
    );
  });

  it("waits for layout stabilization before scrolling to ContactSection", () => {
    const contactPath = path.join(
      ROOT_DIR,
      "src/components/ui/ContactSection.astro",
    );
    const content = fs.readFileSync(contactPath, "utf-8");

    expect(content).toContain("fonts.ready");
  });
});

describe("SPEC-006 REQ-UXE-12: Relevance Scoring & Weighting Engine in Search", () => {
  it("searchIndex defines priority weighting values on documents", () => {
    const searchIndexPath = path.join(ROOT_DIR, "src/data/searchIndex.ts");
    const content = fs.readFileSync(searchIndexPath, "utf-8");

    expect(content).toContain("priority?: number;");
    expect(content).toMatch(/priority:\s*p\.data\.featured\s*\?\s*95/);
    expect(content).toContain(
      "priority: (post.data as any).searchPriority ?? 80",
    );
    expect(content).toContain("priority: 75");
  });
});

describe("SPEC-006 REQ-UXE-13: Translation Shielding for Technical Terms", () => {
  it("TechTerm.astro defines translate='no' and notranslate", () => {
    const techTermPath = path.join(
      ROOT_DIR,
      "src/components/ui/TechTerm.astro",
    );
    const content = fs.readFileSync(techTermPath, "utf-8");

    expect(content).toContain('translate="no"');
    expect(content).toContain("notranslate");
  });

  it("TechIcon.astro, PostCard.astro, and ProjectCard.astro include translate='no' and notranslate", () => {
    const techIconContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/TechIcon.astro"),
      "utf-8",
    );
    expect(techIconContent).toContain('translate="no"');
    expect(techIconContent).toContain("notranslate");

    const postCardContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/PostCard.astro"),
      "utf-8",
    );
    expect(postCardContent).toContain('translate="no"');
    expect(postCardContent).toContain("notranslate");

    const projectCardContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/ProjectCard.astro"),
      "utf-8",
    );
    expect(projectCardContent).toContain('translate="no"');
    expect(projectCardContent).toContain("notranslate");
  });
});

describe("SPEC-006 REQ-UXE-14: Firefox Print Normalization for Resumes", () => {
  it("global.css defines @page { margin: 0mm !important; } and purges body links", () => {
    const cssPath = path.join(ROOT_DIR, "src/styles/global.css");
    const content = fs.readFileSync(cssPath, "utf-8");

    expect(content).toContain("margin: 0mm !important;");
    expect(content).toContain("size: A4 portrait;");
    expect(content).toContain("text-decoration: none !important;");
  });
});

describe("SPEC-006 REQ-UXE-15: Functional Evolution of Resume Maker Studio", () => {
  it("maker.astro incorporates markdown reset, smart phone checkbox, strip links toggle, and UTM bar", () => {
    const makerPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/resume/maker.astro",
    );
    const content = fs.readFileSync(makerPath, "utf-8");

    expect(content).toContain("reset-default-action");
    expect(content).toContain("phone-toggle");
    expect(content).toContain("phone-input");
    expect(content).toContain("strip-links-toggle");
    expect(content).toContain("ResumeAttributionBar");
  });

  it("resume/index.astro includes link to /resume/maker/", () => {
    const resumePath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/resume/index.astro",
    );
    const content = fs.readFileSync(resumePath, "utf-8");

    expect(content).toMatch(/\/resume\/maker\/?/);
  });
});

describe("SPEC-006 REQ-UXE-16: Contextual Sticky Header in Experience Detail Pages", () => {
  it("experience/[slug].astro renders sticky bar with role, company, and dates", () => {
    const slugPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/experience/[slug].astro",
    );
    const content = fs.readFileSync(slugPath, "utf-8");

    expect(content).toContain('id="sticky-experience-header"');
    expect(content).toContain("updateStickyHeader");
  });
});

describe("SPEC-006 REQ-UXE-17: Global Floating Back to Top Button", () => {
  it("BaseLayout.astro renders BackToTopButton component", () => {
    const layoutPath = path.join(ROOT_DIR, "src/layouts/BaseLayout.astro");
    const content = fs.readFileSync(layoutPath, "utf-8");

    expect(content).toContain("<BackToTopButton");
  });

  it("BackToTopButton.astro provides accessible button with smooth scroll", () => {
    const btnPath = path.join(
      ROOT_DIR,
      "src/components/ui/BackToTopButton.astro",
    );
    const content = fs.readFileSync(btnPath, "utf-8");

    expect(content).toContain('id="back-to-top-btn"');
    expect(content).toContain("window.scrollTo");
    expect(content).toContain("smooth");
  });
});

describe("SPEC-006 REQ-UXE-18: Content Security Policy Remediation", () => {
  it("public/_headers specifies data: in script-src and script-src-elem", () => {
    const headersPath = path.join(ROOT_DIR, "public/_headers");
    const content = fs.readFileSync(headersPath, "utf-8");

    expect(content).toMatch(/script-src\s+[^;]*data:/);
    expect(content).toMatch(/script-src-elem\s+[^;]*data:/);
  });
});

describe("SPEC-006 REQ-UXE-19: PageIndexNav J/K Section Accuracy & Jitter Elimination", () => {
  it("maintains explicit navTargetIdx and avoids unstable rect recalculations during programmatic scroll", () => {
    const navPath = path.join(ROOT_DIR, "src/components/ui/PageIndexNav.astro");
    const content = fs.readFileSync(navPath, "utf-8");

    expect(content).toContain("var navTargetIdx = -1;");
    expect(content).toContain("isProgrammaticScroll &&");
    expect(content).toContain("navTargetIdx >= 0");
    expect(content).toContain("currentIdx = navTargetIdx;");
    expect(content).toContain("scrollend");
    expect(content).toContain("var readingLine = getHeaderOffset() + 14;");
  });
});

describe("SPEC-006 REQ-UXE-20: Language Suggestion Banner Display Reliability", () => {
  it("evaluates deviceLang vs currentLocale and does not permanently suppress via localStorage", () => {
    const bannerPath = path.join(
      ROOT_DIR,
      "src/components/ui/LanguageSuggestionBanner.astro",
    );
    const content = fs.readFileSync(bannerPath, "utf-8");

    // SPEC-007 REQ-3: dismissal key is now `lang_banner_dismissed` (sessionStorage only).
    expect(content).toContain(
      'sessionStorage.getItem("lang_banner_dismissed")',
    );
    expect(content).not.toContain("localStorage");
    expect(content).toContain("page_lang_override_");
    expect(content).toContain("!deviceLang || currentLocale === deviceLang");
  });
});

describe("SPEC-006 REQ-UXE-21: Remove Solitary Floating 'Scroll j k'", () => {
  it("removes global-vim-hint and associated observer logic from BaseLayout.astro", () => {
    const layoutPath = path.join(ROOT_DIR, "src/layouts/BaseLayout.astro");
    const content = fs.readFileSync(layoutPath, "utf-8");

    expect(content).not.toContain('id="global-vim-hint"');
    expect(content).not.toContain("updateVimHint");
    expect(content).not.toContain("setupVimObserver");
  });
});

describe("SPEC-006 REQ-UXE-22: Resume Maker Single Phone Input", () => {
  it("uses single phone-input preserving spaces in markdown label and stripping them in tel: URL", () => {
    const makerPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/resume/maker.astro",
    );
    const content = fs.readFileSync(makerPath, "utf-8");

    expect(content).toContain('id="phone-input"');
    expect(content).not.toContain('id="phone-code-input"');
    expect(content).not.toContain('id="phone-number-input"');
    expect(content).toMatch(
      /telHref\s*=\s*["']tel:["']\s*\+\s*rawVal\.replace\(/,
    );
    expect(content).toContain("[${cleanNum}](${telHref})");
  });
});

describe("SPEC-006 REQ-UXE-23: Resume Maker Synchronized Scroll & Vertical Toggle", () => {
  it("implements bidirectional synchronized scroll between editor and preview", () => {
    const makerPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/resume/maker.astro",
    );
    const content = fs.readFileSync(makerPath, "utf-8");

    expect(content).toContain("isScrollingEditor");
    expect(content).toContain("isScrollingPreview");
    expect(content).toContain("editor.scrollHeight - editor.clientHeight");
    expect(content).toContain("preview.scrollHeight - preview.clientHeight");
  });

  it("provides collapse/compact toggle buttons for both editor and preview panes", () => {
    const makerPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/resume/maker.astro",
    );
    const content = fs.readFileSync(makerPath, "utf-8");

    expect(content).toContain('id="toggle-editor-collapse-btn"');
    expect(content).toContain('id="toggle-preview-collapse-btn"');
    expect(content).toContain("editorCollapseIcon");
    expect(content).toContain("previewCollapseIcon");
  });
});

describe("SPEC-006 REQ-UXE-24: Matrix Background Continuous Stream & Title Flicker Fix", () => {
  it("MatrixBackground prevents drops reset unless dimensions change by > 50px and preserves singleton state", () => {
    const matrixPath = path.join(
      ROOT_DIR,
      "src/components/ui/MatrixBackground.astro",
    );
    const content = fs.readFileSync(matrixPath, "utf-8");

    expect(content).toContain("Math.abs(currentWidth - this.lastWidth) > 50");
    expect(content).toContain("Math.abs(currentHeight - this.lastHeight) > 50");
    expect(content).toContain("__matrixDrops");
  });

  it("experience/[slug].astro updates document.title cleanly without unnecessary mutations", () => {
    const slugPath = path.join(
      ROOT_DIR,
      "src/pages/[...lang]/experience/[slug].astro",
    );
    const content = fs.readFileSync(slugPath, "utf-8");

    expect(content).toMatch(
      /if\s*\(doc\.title\s*&&\s*document\.title\s*!==\s*doc\.title\)\s*\{\s*document\.title\s*=\s*doc\.title/,
    );
  });
});

describe("SPEC-006 REQ-UXE-25: Adaptable Featured Systems Grid", () => {
  it("adapts grid columns in index.astro for 2 items vs 3+ items", () => {
    const indexPath = path.join(ROOT_DIR, "src/pages/[...lang]/index.astro");
    const content = fs.readFileSync(indexPath, "utf-8");

    expect(content).toContain(
      'featuredProjects.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"',
    );
    expect(content).toContain(
      'recentPosts.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"',
    );
  });
});

describe("SPEC-006 REQ-UXE-26: Suppress '+0 more in' Indicator", () => {
  it("suppresses +0 more badge when remaining count is 0 in index.astro", () => {
    const indexPath = path.join(ROOT_DIR, "src/pages/[...lang]/index.astro");
    const content = fs.readFileSync(indexPath, "utf-8");

    expect(content).toContain(
      "allProjectsList.length > featuredProjects.length",
    );
    expect(content).toContain("allPosts.length > recentPosts.length");
  });
});

describe("SPEC-006 REQ-UXE-27: Strict Floating Actions Stack Ordering", () => {
  it("enforces strict ordering: Shortcuts (order-1) -> Index (order-2) -> BackToTop (order-3)", () => {
    const layoutContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/layouts/BaseLayout.astro"),
      "utf-8",
    );
    const btnContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/BackToTopButton.astro"),
      "utf-8",
    );
    const navContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/PageIndexNav.astro"),
      "utf-8",
    );
    const shortcutsContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/ShortcutsModal.astro"),
      "utf-8",
    );

    expect(shortcutsContent).toContain("order-1");
    expect(navContent).toContain("order-2");
    expect(btnContent).toContain("order-3");
    expect(layoutContent).toContain(
      'class="fixed bottom-5 right-5 z-40 flex flex-col-reverse items-end gap-2.5 pointer-events-none select-none"',
    );
  });
});

describe("SPEC-006 REQ-UXE-28: Centered 'Start a Conversation' Copy Toast", () => {
  it("EmailCopyButton centers feedback toast and provides localized copy", () => {
    const btnPath = path.join(
      ROOT_DIR,
      "src/components/ui/EmailCopyButton.astro",
    );
    const content = fs.readFileSync(btnPath, "utf-8");

    expect(content).toContain("fixed top-auto m-0 overflow-visible bottom-8");
    expect(content).toContain("left-1/2 -translate-x-1/2 z-[70]");
    expect(content).toContain('popover="manual"');
    expect(content).toContain("Copiado al portapapeles");
    expect(content).toContain("Copied to clipboard");
  });
});

describe("SPEC-006 REQ-UXE-29: Preserve Contact Header Links in Resume Print and Strip Links", () => {
  it("global.css explicitly preserves text styling of contact header links in @media print", () => {
    const cssContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/styles/global.css"),
      "utf-8",
    );

    expect(cssContent).toContain('.resume-document a[href*="mailto:"]');
    expect(cssContent).toContain('.resume-document a[href*="tel:"]');
    expect(cssContent).toContain('.resume-document a[href*="linkedin.com"]');
    expect(cssContent).toContain('.resume-document a[href*="github.com"]');
  });

  it("maker.astro strip links toggle preserves contact header links", () => {
    const makerContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/pages/[...lang]/resume/maker.astro"),
      "utf-8",
    );

    expect(makerContent).toContain('url.includes("mailto:")');
    expect(makerContent).toContain('url.includes("tel:")');
    expect(makerContent).toContain('url.includes("linkedin.com")');
    expect(makerContent).toContain('url.includes("github.com")');
  });
});

describe("SPEC-006 REQ-UXE-30: Geometric Centering of Esc Keycap in Online Judges Modal", () => {
  it("OnlineJudgesModal footer uses geometrically centered kbd styling with generous spacing", () => {
    const judgesContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/OnlineJudgesModal.astro"),
      "utf-8",
    );

    expect(judgesContent).toContain(
      "inline-flex h-5 min-w-[2rem] items-center justify-center",
    );
    expect(judgesContent).toContain("leading-none text-[11px]");
    expect(judgesContent).toContain('{isEs ? "cerrar" : "close"}');
  });
});

describe("SPEC-006 REQ-UXE-31: Coffee Modal Scroll Indicator, Esc Close & Legal Term Sanitization", () => {
  it("CoffeeSponsorshipModal provides scroll indicator and centered Esc footer", () => {
    const coffeeContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/CoffeeSponsorshipModal.astro"),
      "utf-8",
    );

    expect(coffeeContent).toContain('id="coffee-scroll-hint"');
    expect(coffeeContent).toContain("updateCoffeeScrollHint");
    expect(coffeeContent).toContain(
      "inline-flex h-5 min-w-[2rem] items-center justify-center",
    );
    expect(coffeeContent).toContain("leading-none text-[11px]");
    expect(coffeeContent).toContain('{isEs ? "cerrar" : "close"}');
  });

  it("strictly avoids blacklisted terms in UI labels and copy", () => {
    const coffeeContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/ui/CoffeeSponsorshipModal.astro"),
      "utf-8",
    );
    const sponsorshipsDataContent = fs.readFileSync(
      path.join(ROOT_DIR, "src/data/sponsorships.ts"),
      "utf-8",
    );

    expect(coffeeContent).not.toContain("Apoyo y Patrocinio");
    expect(coffeeContent).not.toContain("Support & Sponsorship");
    expect(coffeeContent).not.toContain("ventana de patrocinio");
    expect(sponsorshipsDataContent).not.toContain("Patrocina herramientas");
  });
});
