# Architecture & Technical Design

This project is engineered as an ultra-high performance, edge-first web portal and personal brand platform for Senior Software Engineers and Systems Architects. It implements **Hexagonal Architecture (Ports & Adapters)** coupled with **Astro 7 Static Site Generation (SSG)** and **Cloudflare Workers with Static Assets**, achieving 0 KB baseline client JavaScript on static content and a certified 100/100 across all Core Web Vitals.

---

## 1. High-Level Architecture Overview

```
                                      ┌─────────────────────────────────────────────────────────┐
                                      │              Cloudflare Edge Network                    │
                                      │                                                         │
   User / Bot / Crawler               │  ┌──────────────────────┐    ┌───────────────────────┐  │
 ─────────────────────────► HTTPS ────┼─►│  Edge Routing Policy │───►│ Cloudflare Redirects  │  │
                                      │  │ (308 Canonicalization)│    │ (blog., resume., etc.) │  │
                                      │  └──────────┬───────────┘    └───────────────────────┘  │
                                      │             │                                           │
                                      │             ▼                                           │
                                      │  ┌──────────────────────────────────────────────────┐   │
                                      │  │       Unified Edge Worker (cloudflare/worker.ts) │   │
                                      │  │  - Fast-Path Dispatcher                          │   │
                                      │  │  - Circuit Breakers (Prefetch / Bot Protection)  │   │
                                      │  │  - Edge Cache API (caches.default)               │   │
                                      │  └──────────┬───────────────────────────┬───────────┘   │
                                      │             │ (Fast Path)               │ (Dynamic API) │
                                      │             ▼                           ▼               │
                                      │  ┌──────────────────────┐    ┌───────────────────────┐  │
                                      │  │ Cloudflare Static    │    │ Cloudflare Services:  │  │
                                      │  │ Assets (dist/)       │    │ - D1 (Analytics)      │  │
                                      │  │ 0 KB Client JS Pages │    │ - Workers AI          │  │
                                      │  │ HTML, CSS, Fonts     │    │ - Vectorize (Search)  │  │
                                      │  └──────────────────────┘    │ - Email Routing       │  │
                                      │                              └───────────────────────┘  │
                                      └─────────────────────────────────────────────────────────┘
```

---

## 2. Hexagonal Architecture (Ports & Adapters)

To ensure zero vendor lock-in and complete decoupling from proprietary cloud APIs, all business logic and presentation layers interact exclusively through abstract TypeScript contracts defined in `src/lib/ports/`.

```
src/
├── lib/
│   ├── ports/                 # Pure TypeScript abstract interfaces
│   │   ├── edge-delivery.port.ts
│   │   ├── search.port.ts
│   │   ├── telemetry.port.ts
│   │   ├── captcha.port.ts
│   │   ├── storage.port.ts
│   │   └── email.port.ts
│   └── adapters/              # Pluggable concrete implementations
│       ├── cloudflare/        # Cloudflare Workers, D1, Vectorize, R2
│       ├── in-memory/         # Zero-dependency local fallbacks
│       └── factory.ts         # Environment-driven adapter instantiation
```

### Pluggable Adapter Matrix

| Port Domain              | Cloudflare Adapter                 | Local / Memory / Fallback Adapter | Switch Mechanism                       |
| :----------------------- | :--------------------------------- | :-------------------------------- | :------------------------------------- |
| **Edge Delivery**        | `CloudflareEdgeRoutingPolicy`      | In-memory path normalizer         | Runtime classification                 |
| **Semantic Search**      | `CloudflareVectorizeSearchAdapter` | `StaticMemorySearchAdapter`       | `APP_SEARCH_DRIVER` / timeout failover |
| **Telemetry & Metrics**  | `CloudflareD1TelemetryAdapter`     | `InMemoryTelemetryAdapter`        | `APP_TELEMETRY_DRIVER`                 |
| **Captcha Verification** | `CloudflareTurnstileAdapter`       | `PassThroughCaptchaAdapter`       | `APP_CAPTCHA_DRIVER`                   |
| **Asset Storage**        | `CloudflareR2StorageAdapter`       | Local filesystem / S3             | `APP_STORAGE_DRIVER`                   |
| **Transactional Email**  | `CloudflareEmailRoutingAdapter`    | Console / Webhook fallback        | `ENABLE_EMAIL_ROUTING`                 |

---

## 3. Astro 7 Static Site Generation (SSG)

### 0 KB Baseline Client JavaScript

Public documents (Blog posts, Case Studies, Experience entries, Project showcases, Services, and Resume) ship with **0 KB client JavaScript**. All interactions on content pages are implemented using modern web standards:

- **Navigation & Collapsibles:** CSS `:has()`, `<details>`, `<dialog>`, and `:popover`.
- **Keyboard Shortcuts:** Single vanilla script tag executing in `<script is:inline>` with zero external frameworks.
- **Micro-State Management:** Nano Stores (< 1.5 KB) only when reactive state is strictly necessary (e.g. dynamic CV filter studio).

### Dynamic Parameterized Routing (`[...lang]`)

All pages leverage Astro's catch-all parameterized routing in `src/pages/[...lang]/` to eliminate duplicate templates:

- `params: { lang: undefined }` compiles to `/` (default English canonical).
- `params: { lang: "es" }` compiles to `/es/` (Spanish localized canonical).

This reduces template maintenance surface by 50% while guaranteeing exact design parity across languages.

---

## 4. Edge Fast-Path vs. Dynamic Path

Requests arriving at the Cloudflare Edge are evaluated deterministically in `cloudflare/worker.ts`:

1. **Fast-Path (Static Assets & Documents):**
   - Bypasses Worker CPU overhead by streaming directly from `env.ASSETS`.
   - Non-blocking telemetry runs in the background using `ctx.waitUntil()` so visitors experience **0 ms telemetry latency penalty**.
2. **Subdomain Canonicalization:**
   - Evaluated before asset fetching.
   - Thematic vanity subdomains (`blog.arturonavax.dev`, `projects.arturonavax.dev`, `services.arturonavax.dev`, `resume.arturonavax.dev`) return an immediate **HTTP 308 Permanent Redirect** to the canonical apex path, consolidating SEO PageRank.
3. **Admin Surface Isolation:**
   - `/admin` requests on the apex domain are 308-redirected to `https://admin.arturonavax.dev`.
   - The admin subdomain is gated behind **Cloudflare Zero Trust Access** (WebAuthn / GitHub OAuth), preventing unauthorized execution.
4. **Dynamic API Endpoints:**
   - `/api/contact`: Honeypot detection, Turnstile captcha validation, rate limiting, and webhook forwarding.
   - `/api/search`: Edge-cached semantic vector search with instant in-memory fallback.
   - `/api/v1/telemetry`: High-efficiency batching and circuit-breaker guarded ingestion.

---

## 5. Build-Time Static Architecture Gates

Quality is enforced through automated static analysis before any build or commit:

- `scripts/audit-codebase.ts`: Scans for banned CSS transitions (`width`, `height`, `padding`, `margin` to prevent layout shifts), checks for unmanaged `<img>` tags, and bans legacy Tailwind configurations.
- `bun test`: Validates all hexagonal adapters, circuit breakers, routing policies, and fallback mechanics.
- `pnpm check`: Validates full TypeScript schema compliance across all Astro components.
