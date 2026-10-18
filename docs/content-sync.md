# Content Synchronization & Cloudflare R2 Workflow

This project implements an **R2-decoupled content architecture**. Editorial content (Markdown/MDX articles, project case studies, client services, work experience, resume data, assets, and CV PDFs) is **never committed to Git**. Instead, the private Cloudflare R2 bucket `personal-website-content` serves as the single source of truth across all machines and CI/CD pipelines.

---

## 1. Why Decouple Content from Git?

1. **Lightweight & Clean Repository:** The Git repository contains 100% executable architecture, layouts, styles, and tools. Clones are near-instantaneous (< 15 MB) and history is never bloated by large PDFs, screenshots, or frequent editorial typo commits.
2. **True Multi-Machine Workflow:** Whether developing on a laptop, desktop, or cloud workstation, running `pnpm dev` or `pnpm content:pull` instantly hydrates the local filesystem with the latest remote content in ~2-3 seconds.
3. **Proprietary Asset Protection:** When open-sourcing the portal template, the owner's personal essays, proprietary client descriptions, and resume PDFs remain private inside the authenticated R2 bucket.
4. **Zero Runtime Latency:** R2 is accessed **strictly at build or development time**. When deploying to Cloudflare Workers, Astro compiles the Markdown files into pure static HTML (`dist/`). Public visitors receive edge-accelerated static assets with **0 Class B read requests** to R2.

---

## 2. Directory Layout & Source of Truth

| In R2 Bucket (`personal-website-content`) | Local Directory (Ignored by `.gitignore`)    | Purpose                                        |
| :---------------------------------------- | :------------------------------------------- | :--------------------------------------------- |
| `content/posts/<locale>/<slug>.md(x)`     | `src/content/posts/<locale>/<slug>.md(x)`    | Technical essays & blog posts                  |
| `content/projects/<locale>/<slug>.md`     | `src/content/projects/<locale>/<slug>.md`    | Portfolio case studies                         |
| `content/services/<locale>/<slug>.md`     | `src/content/services/<locale>/<slug>.md`    | Architectural consulting services              |
| `content/experience/<locale>/<slug>.md`   | `src/content/experience/<locale>/<slug>.md`  | Career timeline entries                        |
| `content/resume/<file>.json`              | `src/content/resume/<file>.json`             | Structured resume & skill data                 |
| `assets/<path>`                           | `public/remote-assets/<path>`                | Post images, diagrams, architecture charts     |
| `downloads/ArturoNava-CV-{en,es}.pdf`     | `public/downloads/ArturoNava-CV-{en,es}.pdf` | Downloadable CV PDFs (on `/resume/`)           |
| `_manifest.json`                          | (Generated & stored in R2)                   | SHA-256 hash catalogue for incremental sync    |
| `_bundle.tar.gz`                          | (Generated & stored in R2)                   | Gzip bundle for 1-request cold start hydration |

> [!NOTE]
> Only `.gitkeep` placeholder files under `src/content/*/` and `public/{downloads,remote-assets}/` are tracked in Git so directory structures exist on fresh checkouts.

---

## 3. High-Performance Sync Engine (`scripts/lib/r2-content.mjs`)

The sync engine is engineered in pure Node.js (ESM) with zero heavy external dependencies. It guarantees idempotency, speed, and safety.

### 3.1. Three-Tier Resilient Transport

The driver auto-detects available credentials and selects the optimal transport:

```
                  ┌──────────────────────────────────────────────┐
                  │ Does S3 credentials exist in environment?     │
                  │ (CLOUDFLARE_ACCOUNT_ID + R2_ACCESS_KEY_ID)   │
                  └───────────────────────┬──────────────────────┘
                                          │
                                 YES ─────┴───── NO
                                  │               │
                                  ▼               ▼
                        ┌────────────────┐  ┌────────────────────────────────────┐
                        │ S3 REST Driver │  │ Is 'cf' CLI installed & logged in? │
                        │ (Fastest / CI) │  └─────────────────┬──────────────────┘
                        └────────────────┘                    │
                                                     YES ─────┴───── NO
                                                      │               │
                                                      ▼               ▼
                                            ┌────────────────┐  ┌─────────────────┐
                                            │ 'cf' CLI Driver│  │ Wrangler Driver │
                                            │ (OAuth Local)  │  │ (CLI Fallback)  │
                                            └────────────────┘  └─────────────────┘
```

1. **S3 REST API (Tier 1):** Uses standard AWS Signature v4 over HTTPS. Ideal for CI/CD environments and automated builds. Activated whenever `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are provided.
2. **`cf` CLI (Tier 2):** Uses the official Cloudflare CLI (`npm i -g cf@latest`). Provides zero-configuration local authentication via browser OAuth (`cf auth login`).
3. **`wrangler` CLI (Tier 3):** Uses `wrangler r2 object get/put` with `--remote`.

### 3.2. Incremental SHA-256 Checksums

Before transferring files, the sync engine computes the SHA-256 hash of each local file and compares it against `_manifest.json` in R2.

- If content has not changed, **zero bytes are transferred** (a pull/push check finishes in ~1.5 s).
- Only changed or missing files are downloaded or uploaded.

### 3.3. Fast-Pull Tarball Bundle (`_bundle.tar.gz`)

When a developer checks out the repo on a brand-new machine, syncing 50+ individual objects through sequential CLI calls would take 30+ seconds.

- **The Optimization:** `scripts/r2-push.mjs` automatically packages all content files into a single `_bundle.tar.gz` archive and uploads it alongside `_manifest.json`.
- When `scripts/r2-pull.mjs` detects more than 8 modified/missing files, it downloads the single compressed tarball and unpacks it locally, completing the full sync in **under 2.5 seconds**.

### 3.4. Safety Guards & Path Normalization

- **Path Traversal Protection:** Every entry inside `_bundle.tar.gz` is validated to prevent path traversal (`..` and absolute paths are rejected).
- **Prune Safety:** `pnpm content:push` never deletes remote objects unless explicitly passed the `--prune` flag. This prevents an empty checkout from inadvertently wiping remote production content.

---

## 4. Automated Deployment & Build Hooks

Content synchronization is wired directly into the build pipeline in `wrangler.jsonc` and `package.json`:

```jsonc
// wrangler.jsonc
{
  "build": {
    "command": "node scripts/r2-pull.mjs && pnpm run build",
  },
}
```

```json
// package.json
{
  "scripts": {
    "predeploy": "node scripts/r2-pull.mjs --auto",
    "deploy": "pnpm predeploy && wrangler deploy"
  }
}
```

When building in Cloudflare Workers CI:

1. `node scripts/r2-pull.mjs` executes automatically.
2. If `CI`, `CF_PAGES`, or `CLOUDFLARE_BUILD` is detected, it forces an incremental sync against R2.
3. `pnpm run build` compiles the statically hydrated Astro site into `./dist`.
4. Wrangler deploys the static assets and unified Worker to Cloudflare.

---

## 5. Lossless CV PDF Optimization Pipeline

CV documents placed in `public/downloads/` must remain lightweight (< 200 KB) for instantaneous downloads, yet preserve selectable vector fonts and pristine print geometry.

The project includes an automated lossless compression pipeline (`scripts/optimize-pdf.mjs`) using `qpdf`:

```sh
pnpm cv:publish
```

### What `pnpm cv:publish` Does:

1. Reads source PDFs from `.cv/ArturoNava-CV-en.pdf` and `.cv/ArturoNava-CV-es.pdf`.
2. Runs `qpdf --linearize --object-streams=generate --recompress-flate` to compress streams and optimize for Web Fast View.
3. Achieves **~19% size reduction** without downsampling text or rasterizing vector glyphs.
4. Copies the optimized files to `public/downloads/`.
5. Uploads the optimized PDFs directly to the R2 bucket.

---

## 6. Daily Developer Command Cheatsheet

| Task                      | Command                            | Notes                                              |
| :------------------------ | :--------------------------------- | :------------------------------------------------- |
| **Start Dev Server**      | `pnpm dev`                         | Auto-pulls from R2 only if local content is absent |
| **Dev with Fresh Pull**   | `pnpm dev:r2`                      | Forces remote check before launching Astro dev     |
| **Dev Fully Offline**     | `pnpm dev:local`                   | Uses local files without network check             |
| **Pull Remote Changes**   | `pnpm content:pull`                | Downloads latest updates from R2                   |
| **Dry Run Remote Push**   | `pnpm content:push:dry`            | Shows files that would be uploaded/updated         |
| **Upload Local Changes**  | `pnpm content:push`                | Pushes local content and updates manifest/bundle   |
| **Upload with Prune**     | `node scripts/r2-push.mjs --prune` | Deletes remote files removed locally               |
| **Optimize & Publish CV** | `pnpm cv:publish`                  | Runs qpdf optimization and syncs to R2             |
