# SPEC-003: Vendor Exit Strategy & Decoupling Protocol

If migrating away from Cloudflare Edge infrastructure (to VPS, AWS, Node.js, Bun, Docker, or Vercel):

## Service Replacement Matrix

| Cloudflare Service         | Decoupled Replacement                            | Astro Code Modification Cost                                              |
| :------------------------- | :----------------------------------------------- | :------------------------------------------------------------------------ |
| **Cloudflare D1**          | SQLite or PostgreSQL with a new ingestion adapter | Requires implementing dedupe, dimensions, rollups and quota behavior; no ready-made fallback exists |
| **Cloudflare R2**          | MinIO, AWS S3 or DigitalOcean Spaces             | **0 lines** (activate `S3CompatibleStorageAdapter` via `StoragePort`)     |
| **Workers AI + Vectorize** | Ollama local / Transformers.js or Meilisearch    | **0 lines** (activate `StaticMemorySearchAdapter` via `SearchEnginePort`) |
| **Cloudflare Turnstile**   | Honeypot invisible + Altcha (Proof of Work)      | **0 lines** (activate `HoneypotCaptchaAdapter` via `CaptchaVerifierPort`) |
| **Cache API / PoP**        | Nginx Reverse Proxy / Caddy cache                | **0 lines** (web server cache headers)                                    |

---

## Migration planning (not a ready-to-run procedure)

1. **Step 1:** Implement and test a replacement for the active D1 ingestion and query behavior before changing the Worker binding.
2. **Step 2:** Update environment variables in `.env`:
   ```bash
   APP_STORAGE_DRIVER=local-fs        # from 'cloudflare-r2'
   APP_SEARCH_DRIVER=static-memory    # from 'cloudflare-vectorize'
   APP_CAPTCHA_DRIVER=honeypot        # from 'cloudflare-turnstile'
   ```
3. **Step 3:** Plan an authorized D1 export (these examples are illustrative, not approved operations):
   ```bash
   wrangler d1 export portfolio-production-db --output ./data/export.sql
   sqlite3 ./data/telemetry.sqlite < ./data/export.sql
   ```
4. **Step 4:** Build Astro static output:
   ```bash
   pnpm build
   ```
5. **Step 5:** Deploy `./dist` to Nginx, Caddy, Node.js server, or static host.
