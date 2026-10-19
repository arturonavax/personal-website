# Ultra-Performance Personal Portal & Distributed Engineering Template

[![Astro](https://img.shields.io/badge/Astro-v5-FF5D01?style=flat&logo=astro&logoColor=white)](https://astro.build)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Core Web Vitals](https://img.shields.io/badge/Core%20Web%20Vitals-100%2F100-00C853?style=flat&logo=googlechrome&logoColor=white)](https://pagespeed.web.dev)
[![Client JS](https://img.shields.io/badge/Client%20JS-0%20KB%20Baseline-success?style=flat)](<>)
[![License](https://img.shields.io/badge/License-Custom%20Non--Commercial-blue.svg)](./LICENSE)

An ultra-high performance, edge-first web portal and personal brand platform engineered for Senior Software Engineers, Technical Architects, and Distributed Systems Leaders. Built on **Astro 5 Static Site Generation (SSG)**, **Cloudflare Workers with Static Assets**, **Hexagonal Architecture (Ports & Adapters)**, and **Cloudflare R2 Content Decoupling**.

Designed from the ground up to guarantee a **certified 100/100 across all Core Web Vitals**, **0 KB baseline client JavaScript** on public content, **flawless multilingual technical SEO**, and **strict Cloudflare Free-Tier quota defenses**.

---

## Key Architectural Highlights

- ⚡ **0 KB Baseline Client JS:** Public pages (Blog, Projects, Services, Experience, Resume) ship with zero framework hydration islands. Interactivity is powered by modern CSS (`:has()`, `:popover`, `<details>`) and zero-dependency inline web standards.
- 🌐 **Pure Edge Delivery:** Compiled statically (`output: 'static'`) and served from Cloudflare's global edge network via Cloudflare Workers + Static Assets. Fast-path document streaming achieves < 25 ms TTFB and < 0.5 ms Worker CPU time.
- 🛡️ **Hexagonal Architecture (Ports & Adapters):** Domain logic and presentation components interact exclusively through abstract TypeScript contracts (`src/lib/ports/`), enabling zero-code-change migrations across Cloudflare, AWS, Bun, Node, or In-Memory drivers.
- 📦 **Git-Decoupled Content (R2 Sync):** Editorial Markdown/MDX, case studies, and CV PDFs are **never tracked in Git**. A private Cloudflare R2 bucket (`personal-website-content`) serves as the single source of truth with automated 3-tier sync (`cf` CLI, S3 API, Wrangler) and tarball bundle acceleration.
- 🔍 **Impeccable Multilingual Technical SEO:** Strict trailing-slash normalization, reciprocal bidirectional `hreflang` tags (`en`, `es`, `x-default`) with zero phantom 404s, dynamic XML sitemaps, and Schema.org Knowledge Graph structured data (`@id: "https://arturonavax.dev/#person"`).
- 🏷️ **Thematic Vanity Subdomains:** Native 0ms Edge HTTP 308 canonicalization redirects `blog.arturonavax.dev`, `projects.`, `services.`, and `resume.` to apex canonical paths, consolidating 100% of SEO PageRank.
- 🔒 **Enterprise Edge Security & Zero-Trust Vault:**
  - Automated circuit breakers (`PrefetchQuotaCircuitBreaker`, `BotQuotaCircuitBreaker`) shield D1 database writes from speculative browser prefetching and search crawlers.
  - Selective `assets.run_worker_first` glob array bypassing Worker compute on immutable static assets (`/_astro/*`, `/fonts/*`, etc.).
  - Post-build admin vault relocation (`scripts/isolate-admin-build.mjs`) to internal path `dist/__admin_vault__/` eliminating static asset exposure.
  - Fail-closed Zero-Trust identity verification (Cloudflare Access RSASSA-PKCS1-v1_5 JWT & constant-time SHA-256 Bearer tokens).
  - 120-second edge in-memory caching for telemetry queries.
  - Cloudflare Turnstile captcha validation, honeypot traps, and IP sliding rate limiting on contact forms.
  - Strict Content-Security-Policy (CSP), HSTS preload, and permissions isolation.

---

## Detailed Documentation Suite

Exhaustive technical guides and implementation specifications are located in [`docs/`](./docs/):

| Guide                                                                   | Description                                                                       |
| :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| 📐 [**Architecture & System Design**](./docs/architecture.md)           | Hexagonal Architecture, Ports & Adapters, Astro SSG, and Fast-Path execution.     |
| ☁️ [**Cloudflare Edge & Quota Guards**](./docs/cloudflare-edge.md)      | D1 write shielding, edge caching, Vectorize/AI fail-open, and Zero Trust admin.   |
| 🔄 [**R2 Content Synchronization**](./docs/content-sync.md)             | R2 sync engine, 3-tier transport, bundle caching, and lossless CV PDF pipeline.   |
| 🌍 [**SEO & Multilingual (i18n) Engine**](./docs/seo-and-i18n.md)       | Reciprocal hreflangs, sitemaps, canonical trailing slashes, and JSON-LD schemas.  |
| 🛡️ [**Security & Abuse Protection**](./docs/security.md)                | CSP headers, Turnstile captcha, honeypots, rate limiting, and static audit gates. |
| 🚀 [**Template Customization Guide**](./docs/template-customization.md) | Step-by-step instructions for forking and deploying as your own personal site.    |

---

## Quick Start (New Machine Setup)

### 1. Requirements

- Node.js 22+, `pnpm` (`npm i -g pnpm`)
- Cloudflare CLI (`npm i -g cf@latest`)
- `tar` (for bundle extraction)
- Optional: `bun` (for tests/audits), `qpdf` (for CV PDF optimization)

### 2. Installation & First Run

```sh
# Clone the repository
git clone https://github.com/arturonavax/personal-website.git
cd personal-website

# Install dependencies
pnpm install

# Authenticate Cloudflare CLI (browser OAuth; wrangler login is not required for content)
cf auth login

# Start development server
pnpm dev
```

> [!TIP]
> On the first run, `pnpm dev` automatically pulls remote content from R2 (~2-3 s), creates local markdown files, and starts Astro on `http://0.0.0.0:4321`. LAN exposure (`--host`) is enabled by default so you can test on mobile devices immediately.

---

## Content & Cloudflare R2 Workflow

### Content Directory Layout

| In R2 Bucket (`personal-website-content`, private) | Local Path (Ignored by `.gitignore`)         | Purpose                                                                       |
| :------------------------------------------------- | :------------------------------------------- | :---------------------------------------------------------------------------- |
| `content/<collection>/<locale>/<file>.md(x)`       | `src/content/<collection>/<locale>/<file>`   | Content collections (`posts`, `projects`, `services`, `experience`, `resume`) |
| `assets/<path>`                                    | `public/remote-assets/<path>`                | Images, diagrams, and figures referenced by posts                             |
| `downloads/ArturoNava-CV-{en,es}.pdf`              | `public/downloads/ArturoNava-CV-{en,es}.pdf` | Downloadable CV PDFs in `/resume/`                                            |
| `_manifest.json`, `_bundle.tar.gz`                 | (Stored in R2 only)                          | Incremental SHA-256 catalogue and fast-pull archive                           |

> Only `.gitkeep` placeholder files under `src/content/*/` and `public/{downloads,remote-assets}/` are tracked in Git.

### Daily Command Cheatsheet

| Task                      | Command                            | Description                                                                  |
| :------------------------ | :--------------------------------- | :--------------------------------------------------------------------------- |
| **Dev (Smart)**           | `pnpm dev`                         | Starts server; auto-pulls R2 only if local content is absent.                |
| **Dev (Force R2)**        | `pnpm dev:r2`                      | Pulls latest remote content from R2, then launches Astro.                    |
| **Dev (Offline)**         | `pnpm dev:local`                   | Launches Astro immediately using existing disk content.                      |
| **Dev (Worker)**          | `pnpm dev:worker`                  | Runs local Cloudflare Worker with D1/R2 local persistence on `0.0.0.0:8788`. |
| **Build Preview**         | `pnpm dev-prod`                    | Builds static production bundle and serves via local Worker.                 |
| **Download Content**      | `pnpm content:pull`                | Pulls incremental changes from R2 (uses tarball bundle if > 8 files).        |
| **Dry Run Upload**        | `pnpm content:push:dry`            | Lists files that would be uploaded without modifying R2.                     |
| **Upload Content**        | `pnpm content:push`                | Pushes local changes to R2 and generates a fresh `_bundle.tar.gz`.           |
| **Upload + Prune**        | `node scripts/r2-push.mjs --prune` | Pushes local changes and removes remote objects deleted locally.             |
| **Optimize & Publish CV** | `pnpm cv:publish`                  | Optimizes PDFs via `qpdf` (-19% size, crisp text) and syncs to R2.           |
| **Reset D1 DB (Local)**   | `pnpm db:reset:local`              | Drops tables and re-initializes compacted D1 schema locally.                 |
| **Reset D1 DB (Remote)**  | `pnpm db:reset:remote`             | Drops tables and re-initializes compacted D1 schema on production D1.        |
| **Deploy to Edge**        | `pnpm run deploy`                  | Auto-pulls content from R2, compiles Astro SSG, and deploys Worker.          |

---

## Build, Testing & Architectural Gates

The repository includes a comprehensive automated quality suite:

```sh
pnpm build        # Compiles Astro SSG & isolates admin vault (auto-pulls R2 content if missing)
pnpm check        # Runs Astro & TypeScript type check (0 errors, 0 warnings)
pnpm test         # Runs 307 unit/integration tests via Bun (< 700 ms)
pnpm audit        # Runs static architectural gates & content hydration checks
```

### Static Architecture Gates:

1. **0 Unmanaged `<img>` tags:** Enforces `<Image/>` or `<Picture/>` with explicit layout dimensions.
2. **0 Layout Transitions:** Banned CSS animations on `width`, `height`, `padding`, `margin` to prevent Cumulative Layout Shift (CLS).
3. **0 Static `will-change`:** Enforces compositor isolation via WAAPI.
4. **Tailwind v4 CSS-First:** Enforces modern `@theme` declarations without legacy config files.

---

## License & Attribution Notice

The architectural framework, components, styling, and engineering tooling of this website are available under a **Custom Non-Commercial License** (see [LICENSE](./LICENSE)).

- **Proprietary Editorial Assets (All Rights Reserved):** All articles (`/src/content/posts`), project writeups (`/src/content/projects`), career experiences (`/src/content/experience`), CV data (`/src/content/resume`), and personal images (`/src/assets/arturonava.jpg`) are strictly proprietary to Arturo Nava and may not be republished or deployed in other projects.
- **Using this Template:** You are welcome to fork and use this repository as a template for your own non-commercial personal website or portfolio, provided you replace all personal assets/content and retain the visible attribution link in the site footer.
