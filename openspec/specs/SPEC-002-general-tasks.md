# OpenSpec: Technical Implementation & Refactoring Specification

```yaml
id: SPEC-2026-REFACTOR-FEATURE-002
title: Codebase Refactor, Edge Telemetry Optimization, Cross-Browser Print & Resume Maker
status: APPROVED-FOR-IMPLEMENTATION
target_framework: Astro v7+ / Cloudflare Workers & Static Assets
methodology: Requirement-Driven Development (RDD) & Spec-Driven Development (SDD)
version: 1.0.0
```

---

## 1. Scope & Strategy Overview

This specification addresses the pending functional fixes, browser inconsistencies, SEO canonical guarantees, edge telemetry hardening, and the implementation of the new **Resume Maker** tool, while eliminating unneeded assets and renaming `cv` domain models to `resume` across the entire project.

### Excluded / Delegated Tasks (Out of Scope for this Spec)

- **Account / Human Identity Management:** Phone number verification for `arturo@arturonavax.com`.
- **Manual Heuristics & Research Tasks:** Investigation of upstream 503 errors on edge prefetch, discovery of external SEO skill repositories, smart `notranslate` linguistic research, and public directory PDF hosting research.
- **Pre-completed Tasks (`[x]`):** CV link removal before print, shortcut "p" mobile button removal, and LinkGenerator base utility.

---

## 2. Requirements Matrix (RDD)

### REQ-01: Asset Hygiene & Banner Pruning

- **R1.1:** Audit and eliminate all unused banner image files (`banner-16x9-*`, `banner-3x1-*`, `banner-4x1-*`) located in `public/`.
- **R1.2:** Retain only active assets (`arturonava.png`, profile favicons, Apple touch icons, default OpenGraph images).

### REQ-02: Zero-Action Mailto & Direct Clipboard Protocol

- **R2.1:** Eliminate traditional browser `mailto:` navigation (`href="mailto:..."`) to prevent accidental mail client launches.
- **R2.2:** Transform all email contact points into copy-to-clipboard interactions, accompanied by visual confirmation ("Copied to clipboard") and proper accessible attributes (`aria-live="polite"`).

### REQ-03: SEO Canonical URL Integrity & SPA View Transitions

- **R3.1:** Canonical URLs must strictly omit tracking and filtering query parameters (`utm_*`, `ref`, `company`, `tag`).
- **R3.2:** When navigating via keyboard shortcuts, timeline arrows, or `ClientRouter` view transitions, dynamic canonical tags must update in the DOM to reflect the exact current canonical path without query strings.

### REQ-04: Edge Worker Telemetry Optimization & Prefetch Protection

- **R4.1:** The edge worker (`cloudflare/worker.ts`) must detect speculative prefetch requests (`Purpose: prefetch`, `Sec-Purpose: prefetch`, or `X-Astro-Prefetch`).
- **R4.2:** Prefetch requests must bypass database mutations (D1) and pass through directly to Cloudflare edge cache to minimize subrequest compute and database load.
- **R4.3:** Real visits must be non-blocking, executing analytics logging in the background via `ctx.waitUntil()`.

### REQ-05: Single-Select Search Filters in Experience

- **R5.1:** Refactor company filtering in `ExperienceFilterBar.astro` from multi-select to single-select: selecting a company deselects all others; clicking the active company toggles it back to "All".

### REQ-06: Universal Search Modal SPA Navigation

- **R6.1:** Pressing `Enter` on a search result within `UniversalSearchModal.astro` must use Astro's client router `navigate()` API from `astro:transitions/client`.
- **R6.2:** Form submission and traditional page reloads must be explicitly prevented (`event.preventDefault()`).

### REQ-07: Domain Refactor — Rename `cv` to `resume`

- **R7.1:** Rename directory `src/content/cv/` to `src/content/resume/`.
- **R7.2:** Rename `src/data/cv.ts` to `src/data/resume.ts`.
- **R7.3:** Rename components `CvExportBar.astro` to `ResumeExportBar.astro` and `CvAttributionBar.astro` to `ResumeAttributionBar.astro`.
- **R7.4:** Update all content collection schemas in `src/content.config.ts`, TypeScript declarations in `src/types/`, and route references across layouts and templates.

### REQ-08: Cross-Browser Print Normalization (Firefox & Mobile PDF)

- **R8.1:** Set the dynamic print file name to `ArturoNava-CV-{lang}.pdf` by setting `document.title` on `beforeprint` and restoring it on `afterprint`.
- **R8.2:** Apply `@page` rules and `@media print` CSS overrides to ensure identical margins, background colors, typography, and page breaks across Chrome, Safari, and Firefox.

### REQ-09: Mobile & Firefox Scroll-Margin Offset Fix

- **R8.3:** Apply `scroll-margin-top: calc(var(--header-height, 4rem) + 1rem)` to all headings and anchored sections (`#...`) so navigation from `PageIndexNav.astro` does not obscure content beneath sticky navigation bars.

### REQ-10: View Transitions Circular Reveal Hardening

- **R10.1:** Fix Firefox and mobile viewport clipping and color jumps during the circular theme transition by enforcing explicit `containment` and pseudo-element isolation on `::view-transition-group(root)`.
- **R10.2:** Provide instantaneous fallback for browsers where pseudo-element blending causes paint flashes.

### REQ-11: Multi-Format Resume Exporters (MD, JSON, TOML, XML)

- **R11.1:** Provide serialization from the canonical Resume markdown into:
  - **Raw Markdown:** Original markdown frontmatter + body with current UTM params.
  - **JSON:** Structured JSON representation (`Schema.org/Resume` or custom schema).
  - **TOML:** Key-value format for CLI and automated scrapers.
  - **XML:** Valid XML formatted resume.
- **R11.2:** Inject real-time `utm_content` values into all links inside exported files based on user inputs.

### REQ-12: The Resume Maker (`/resume/maker/` & `/es/resume/maker/`)

- **R12.1:** Implement a dedicated route providing an in-browser markdown code editor (monospace textarea).
- **R12.2:** Include a phone number select/input toolbar to optionally append contact information to the header.
- **R12.3:** Provide a toolbar with actions: Strip Links, Toggle Sections, and Trigger Print Preview.
- **R12.4:** Render the markdown into a live preview matching the exact `/resume` styles, retaining the export bar and UTM customization components.

---

## 3. Implementation Blueprint

### 3.1. Pruning Unused Banners (REQ-01)

Remove obsolete graphic assets from `public/`:

```bash
rm -f public/banner-16x9-*.png public/banner-3x1-*.png public/banner-4x1-*.png
```

---

### 3.2. Email Copy Button Component (`src/components/ui/EmailCopyButton.astro`) (REQ-02)

```astro
---
interface Props {
  email: string;
  label?: string;
  class?: string;
}

const { email, label, class: className = "" } = Astro.props;
---

<email-copy-trigger
  data-email={email}
  class={`inline-flex items-center gap-1.5 ${className}`}
>
  <button
    type="button"
    class="group inline-flex items-center gap-1.5 font-mono text-sm text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    aria-label={`Copy ${email} to clipboard`}
  >
    <span>{label || email}</span>
    <svg
      xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
      class="h-3.5 w-3.5 opacity-60 transition-transform group-hover:scale-110 group-active:scale-95"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
    <span class="sr-only">Copy email address</span>
  </button>
  <span
    class="copy-feedback pointer-events-none fixed bottom-4 right-4 z-50 rounded bg-neutral-900 px-3 py-1.5 text-xs text-neutral-50 opacity-0 transition-opacity duration-200 dark:bg-neutral-100 dark:text-neutral-900"
    role="status"
    aria-live="polite"
  >
    Copied to clipboard
  </span>
</email-copy-trigger>

<script>
  class EmailCopyTrigger extends HTMLElement {
    private button: HTMLButtonElement | null = null;
    private feedback: HTMLElement | null = null;
    private timeoutId: ReturnType<typeof setTimeout> | null = null;

    connectedCallback() {
      this.button = this.querySelector("button");
      this.feedback = this.querySelector(".copy-feedback");
      this.button?.addEventListener("click", this.handleCopy);
    }

    disconnectedCallback() {
      this.button?.removeEventListener("click", this.handleCopy);
      if (this.timeoutId) clearTimeout(this.timeoutId);
    }

    private handleCopy = async () => {
      const email = this.dataset.email;
      if (!email) return;

      try {
        await navigator.clipboard.writeText(email);
        if (this.feedback) {
          this.feedback.classList.remove("opacity-0");
          this.feedback.classList.add("opacity-100");
          if (this.timeoutId) clearTimeout(this.timeoutId);
          this.timeoutId = setTimeout(() => {
            this.feedback?.classList.remove("opacity-100");
            this.feedback?.classList.add("opacity-0");
          }, 2000);
        }
      } catch (err) {
        console.error("Failed to copy email:", err);
      }
    };
  }

  if (!customElements.get("email-copy-trigger")) {
    customElements.define("email-copy-trigger", EmailCopyTrigger);
  }
</script>
```

---

### 3.3. Canonical Hardening & Header Navigation Fix (`src/components/common/SEOHead.astro`) (REQ-03)

```astro
---
interface Props {
  title: string;
  description: string;
  image?: string;
  locale: string;
  articleDate?: Date;
}

const { title, description, image, locale, articleDate } = Astro.props;

// Strip all query strings (UTMs, filters) to generate pristine canonical URLs
const canonicalURL = new URL(
  Astro.url.pathname,
  Astro.site || "[https://arturonava.com](https://arturonava.com)",
);
---

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalURL.href} />

  <!-- Update canonical dynamically across ClientRouter lifecycle -->
  <script is:inline>
    document.addEventListener("astro:page-load", () => {
      const canonicalTag = document.querySelector('link[rel="canonical"]');
      if (canonicalTag) {
        const cleanHref = window.location.origin + window.location.pathname;
        canonicalTag.setAttribute("href", cleanHref);
      }
    });
  </script>
</head>
```

#### Logo / About "Scroll to Top" Fix (`src/components/common/Header.astro`)

```typescript
// Client-side script inside Header.astro
document.addEventListener("astro:page-load", () => {
  const homeLinks =
    document.querySelectorAll<HTMLAnchorElement>("a[data-home-link]");
  homeLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetPath = new URL(link.href, window.location.origin).pathname;
      const currentPath = window.location.pathname;
      if (targetPath === currentPath) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });
});
```

---

### 3.4. Cloudflare Worker Prefetch Shielding (`cloudflare/worker.ts`) (REQ-04)

```typescript
export interface Env {
  ANALYTICS_DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // 1. Detect Prefetch / Speculative Requests
    const isPrefetch =
      request.headers.get("Purpose") === "prefetch" ||
      request.headers.get("Sec-Purpose") === "prefetch" ||
      request.headers.get("X-Astro-Prefetch") !== null ||
      request.headers.get("Sec-Fetch-Dest") === "empty";

    // 2. Telemetry Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      if (isPrefetch) {
        // Discard speculative analytics to protect D1 and worker quotas
        return new Response(null, { status: 204 });
      }

      // Process telemetry asynchronously without blocking client thread
      ctx.waitUntil(
        (async () => {
          try {
            const data = (await request.json()) as Record<string, unknown>;
            await env.ANALYTICS_DB.prepare(
              `INSERT INTO edge_telemetry_events (id, timestamp, path, locale, country, user_agent, visitor_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                crypto.randomUUID(),
                Date.now(),
                String(data.path || "").slice(0, 255),
                String(data.locale || "en").slice(0, 10),
                request.headers.get("cf-ipcountry") || "XX",
                request.headers.get("user-agent")?.slice(0, 512) || "unknown",
                String(data.visitorHash || "").slice(0, 32),
              )
              .run();
          } catch (err) {
            // Silently swallow analytics errors to avoid impacting edge performance
          }
        })(),
      );

      return new Response(JSON.stringify({ status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Static Asset Delegation via Cloudflare Workers Static Assets
    const response = await env.ASSETS.fetch(request);

    // 4. Immutable Cache Optimization for Pre-rendered Chunks
    if (
      url.pathname.startsWith("/_astro/") ||
      url.pathname.startsWith("/fonts/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    return response;
  },
};
```

---

### 3.5. Universal Search Modal SPA Navigation (`src/components/ui/UniversalSearchModal.astro`) (REQ-06)

```typescript
// Replace window.location or standard form submit with Astro's navigate()
import { navigate } from "astro:transitions/client";

function selectResult(url: string) {
  closeModal();
  navigate(url);
}

// In keydown listener:
if (event.key === "Enter") {
  event.preventDefault();
  const selectedItem = resultsContainer.querySelector<HTMLAnchorElement>(
    '[aria-selected="true"]',
  );
  if (selectedItem?.href) {
    selectResult(selectedItem.href);
  }
}
```

---

### 3.6. Experience Filters Single-Select Architecture (`src/components/ui/ExperienceFilterBar.astro`) (REQ-05)

```typescript
// Single-select toggle implementation for experience filter buttons
class ExperienceFilterBar extends HTMLElement {
  connectedCallback() {
    const buttons = this.querySelectorAll<HTMLButtonElement>(
      "[data-company-filter]",
    );
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetCompany = btn.dataset.companyFilter;
        const currentActive = this.querySelector<HTMLButtonElement>(
          '[data-company-filter][aria-pressed="true"]',
        );

        if (currentActive === btn) {
          // Deselect: show all
          btn.setAttribute("aria-pressed", "false");
          this.applyFilter(null);
        } else {
          // Select strictly one
          buttons.forEach((b) => b.setAttribute("aria-pressed", "false"));
          btn.setAttribute("aria-pressed", "true");
          this.applyFilter(targetCompany || null);
        }
      });
    });
  }

  private applyFilter(company: string | null) {
    const timelineItems = document.querySelectorAll<HTMLElement>(
      "[data-company-item]",
    );
    timelineItems.forEach((item) => {
      const match = !company || item.dataset.companyItem === company;
      item.style.display = match ? "" : "none";
    });
  }
}
customElements.define("experience-filter-bar", ExperienceFilterBar);
```

---

### 3.7. Resume Renaming Migration Map (REQ-07)

1. **Filesystem Migration:**

   ```bash
   git mv src/content/cv src/content/resume
   git mv src/content/resume/ArturoNava-CV-en.md src/content/resume/ArturoNava-Resume-en.md
   git mv src/content/resume/ArturoNava-CV-es.md src/content/resume/ArturoNava-Resume-es.md
   git mv src/data/cv.ts src/data/resume.ts
   git mv src/components/ui/CvExportBar.astro src/components/ui/ResumeExportBar.astro
   git mv src/components/ui/CvAttributionBar.astro src/components/ui/ResumeAttributionBar.astro
   ```

2. **Content Layer Definition (`src/content.config.ts`):**

   ```typescript
   import { defineCollection, z } from "astro:content";
   import { glob } from "astro/loaders";

   const resume = defineCollection({
     loader: glob({
       pattern: "ArturoNava-Resume-*.md",
       base: "src/content/resume",
     }),
     schema: z.object({
       title: z.string(),
       name: z.string(),
       role: z.string(),
       updatedDate: z.date().optional(),
     }),
   });

   export const collections = {
     resume,
     // ... other collections
   };
   ```

---

### 3.8. Cross-Browser Print & Page Index Offset (`src/styles/global.css`) (REQ-08, REQ-09)

```css
/* Sticky Header Offset for Page Index & Anchors */
[id] {
  scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem);
}

/* Firefox and Mobile Print Normalization */
@media print {
  @page {
    margin: 1.5cm 1.2cm 1.5cm 1.2cm;
    size: A4 portrait;
  }

  html,
  body {
    background: #ffffff !important;
    color: #111827 !important;
    font-size: 10.5pt !important;
    line-height: 1.4 !important;
    width: 100% !important;
  }

  /* Hide UI elements */
  header,
  footer,
  nav,
  .print-hidden,
  #matrix-background {
    display: none !important;
  }

  /* Prevent page breaks inside work items */
  .resume-section-item,
  article,
  section {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
}
```

#### Dynamic Print Title Script (`src/pages/[...lang]/resume.astro`)

```typescript
<script is:inline>
  window.addEventListener('beforeprint', () => {
    window.__originalTitle = document.title;
    const lang = document.documentElement.lang || 'en';
    document.title = `ArturoNava-CV-${lang}`;
  });

  window.addEventListener('afterprint', () => {
    if (window.__originalTitle) {
      document.title = window.__originalTitle;
    }
  });
</script>
```

---

### 3.9. View Transitions Circular Reveal Firefox Hardening (`src/components/common/ThemeToggle.astro`) (REQ-10)

```typescript
// Inside ThemeToggle WAAPI circular wave handler
async function toggleTheme(event: MouseEvent) {
  const isDark = document.documentElement.classList.contains("dark");
  const nextTheme = isDark ? "light" : "dark";

  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    applyTheme(nextTheme);
    return;
  }

  const x = event.clientX;
  const y = event.clientY;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(() => {
    applyTheme(nextTheme);
  });

  await transition.ready;

  // Enforce zero layout jump in Firefox 129+
  document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${x}px${y}px)`,
        `circle(${endRadius}px at ${x}px${y}px)`,
      ],
    },
    {
      duration: 400,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      pseudoElement: "::view-transition-new(root)",
    },
  );
}
```

---

### 3.10. Resume Format Exporter Engine (`src/utils/resumeExporters.ts`) (REQ-11)

```typescript
export interface ResumeExportData {
  name: string;
  role: string;
  summary: string;
  skills: Record<string, string[]>;
  experience: Array<{
    company: string;
    role: string;
    period: string;
    highlights: string[];
  }>;
}

export function exportToJSON(
  data: ResumeExportData,
  utmSuffix: string,
): string {
  const jsonClone = JSON.parse(JSON.stringify(data));
  return JSON.stringify(jsonClone, null, 2);
}

export function exportToTOML(data: ResumeExportData): string {
  let toml = `name = "${data.name}"\nrole = "${data.role}"\nsummary = "${data.summary.replace(/"/g, '\\"')}"\n\n[skills]\n`;
  for (const [category, list] of Object.entries(data.skills)) {
    toml += `${category} = [${list.map((s) => `"${s}"`).join(", ")}]\n`;
  }
  return toml;
}

export function exportToXML(data: ResumeExportData): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<resume>\n  <name>${data.name}</name>\n  <role>${data.role}</role>\n  <summary>${data.summary}</summary>\n</resume>`;
  return xml;
}
```

---

### 3.11. The Resume Maker Route (`src/pages/[...lang]/resume/maker.astro`) (REQ-12)

```astro
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import ResumeExportBar from "@/components/ui/ResumeExportBar.astro";
import { getCollection } from "astro:content";
import { getStaticLocalePaths, type Locale } from "@/i18n/routing";

export function getStaticPaths() {
  return getStaticLocalePaths();
}

interface Props {
  locale: Locale;
}

const { locale } = Astro.props;
const rawResumeList = await getCollection("resume");
const currentResume =
  rawResumeList.find((r) => r.id.includes(locale)) || rawResumeList[0];
const initialMarkdown = currentResume?.body || "";
---

<BaseLayout
  Arturo
  Maker
  Nava`
  }
  description="Customizable interactive developer resume generator and live markdown renderer."
  locale="{locale}"
  title="{`Resume"
  —
>
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <!-- Toolbar -->
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <h1 class="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
        Resume Maker Studio
      </h1>

      <div class="flex items-center gap-3">
        <!-- Phone Injector -->
        <label for="phone-selector" class="sr-only">
          Add Phone Contact
        </label>
        <select
          id="phone-selector"
          class="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="">No Phone</option>
          <option value="+573000000000">Colombia (+57)</option>
          <option value="+10000000000">USA (+1)</option>
          <option value="custom">Custom...</option>
        </select>

        <button
          id="strip-links-btn"
          type="button"
          class="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Strip Links
        </button>

        <button
          id="print-btn"
          type="button"
          class="rounded bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-950"
        >
          Print PDF
        </button>
      </div>
    </header>

    <!-- Split Screen: Editor & Live Preview -->
    <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <!-- Monospace Editor Column -->
      <div class="flex flex-col">
        <label
          for="markdown-editor"
          class="mb-2 font-mono text-xs text-neutral-500"
        >
          Markdown Source Editor
        </label>
        <textarea
          id="markdown-editor"
          class="h-[750px] w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
          spellcheck="false"
        >{initialMarkdown}</textarea>
      </div>

      <!-- Live Render Column (Exact Resume Styles) -->
      <div class="flex flex-col">
        <span class="mb-2 font-mono text-xs text-neutral-500">
          Document Live Preview
        </span>
        <div
          id="resume-preview-container"
          class="prose prose-neutral h-[750px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-8 shadow-sm dark:prose-invert dark:border-neutral-800 dark:bg-neutral-900"
        >
          <!-- Live markdown output rendered here -->
        </div>
      </div>
    </div>

    <!-- Bottom Actions: Exporters & UTM Injector -->
    <div class="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <ResumeExportBar currentLocale="{locale}" />
    </div>
  </div>
</BaseLayout>

<script>
  import { marked } from "marked";

  const editor = document.getElementById(
    "markdown-editor",
  ) as HTMLTextAreaElement;
  const preview = document.getElementById(
    "resume-preview-container",
  ) as HTMLDivElement;
  const printBtn = document.getElementById("print-btn") as HTMLButtonElement;
  const stripLinksBtn = document.getElementById(
    "strip-links-btn",
  ) as HTMLButtonElement;

  function renderPreview() {
    if (!editor || !preview) return;
    preview.innerHTML = marked.parse(editor.value) as string;
  }

  editor?.addEventListener("input", renderPreview);
  renderPreview();

  stripLinksBtn?.addEventListener("click", () => {
    editor.value = editor.value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    renderPreview();
  });

  printBtn?.addEventListener("click", () => {
    window.print();
  });
</script>
```

---

## 4. Verification & Testing Matrix

| Test ID     | Area              | Verification Procedure                                              | Expected Outcome                                                                   |
| :---------- | :---------------- | :------------------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| **TEST-01** | Asset Pruning     | Run `ls public/banner*`                                             | File not found (zero dead banners in production build).                            |
| **TEST-02** | Contact Protocol  | Click on any email component                                        | Email copied to clipboard; zero mail client popups; toast notification shows.      |
| **TEST-03** | SEO Canonical     | Append `?utm_source=linkedin&utm_medium=cpc` to `/resume`           | `<link rel="canonical">` strictly reads `https://arturonava.com/resume`.           |
| **TEST-04** | Edge Worker       | Send request with header `Purpose: prefetch` to `/api/v1/telemetry` | HTTP `204 No Content`; zero writes to Cloudflare D1.                               |
| **TEST-05** | Universal Search  | Highlight an item and press `Enter`                                 | Page transitions via `ClientRouter` SPA without full browser refresh.              |
| **TEST-06** | Experience Filter | Click Company A, then Company B                                     | Only Company B is selected; multi-selection disabled.                              |
| **TEST-07** | Print Formatting  | Trigger print in Firefox & Chrome                                   | Margin parity, title saved as `ArturoNava-CV-{lang}.pdf`, page-breaks intact.      |
| **TEST-08** | Resume Maker      | Edit markdown in `/resume/maker`                                    | Live preview renders instantly; Print PDF produces identical styling to `/resume`. |
