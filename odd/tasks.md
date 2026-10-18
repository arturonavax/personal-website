# Tareas del Proyecto (ODD)

No se deben realizar las tareas marcadas con (Human), ya que esas tareas las debe hacer el humano manualmente.

[] (Human) Rediseño total de el banner de About y Contact con Impecable skill.

[x] En /resume/ el boton flotante Download y Print deberia estar uno encima de otro como page index, ordenados por anchura (de preferencia page index arriba de todos en este caso)

[x] Si en cualquier pagina con filtros como /experience seleccionan un filtro y vuelven a presionar el boton de la navegacion (menu superior) de la misma pagina, debo resetear los filtros. (Y no solo volver a remarcar About)

[x] En pagina de experiences el page index no esta alineado con el banner principal con el titulo del job, debe estar siempre alineado al primer contenedor principal.

[x] Al moverme entre el timeline con las flechas sale el "Fetching..." cuando ya se llego al destino y no deberia ser, deberia salir apenas se haga las request y finalizar elegantemente cuando llegue, aunque dure muy poco.

[x] En el dashboard /admin quiero ver la metrica de Unique Visitors con filtro de humanos.

[x] Integra un filtrado o deteccion request que solo buscan vulnerabilidades en base a un listado comun de URLs o Paths evidentes, para marcarlos como bots (especificamente bots escaneando vulnerabilidades).

[x] Agrega otra capa de degradacion para los registros de telemetria: Si nos estamos quedando sin cuota deja de registrar las request que eran 404 Not Found.

[x] Integra todo esto de la forma mas correcta posible:

# TASK: Implement Edge Vulnerability Scan Filtering & D1 Telemetry Protection

## Context & Architecture

You are working on a high-performance personal website built with Astro v7 (Static output) deployed on the Cloudflare Edge ecosystem using Cloudflare Workers with Static Assets (`assets.run_worker_first: true`) and Cloudflare D1 (`personal-website-analytics`).

Currently, the asynchronous telemetry ingestion logger (`recordAnalyticsNonBlocking`) in `cloudflare/worker.ts` logs pageviews to D1 before validating the asset HTTP response status. Automated vulnerability scanners (e.g., probing for `/.env`, `wp-login.php`, `/.git/config`, `/actuator`) spoof standard desktop browser User-Agents and bypass `classifyVisitor`, causing artificial traffic spikes and exhausting Cloudflare D1 daily write quotas.

## Mission

Harden the edge ingress traffic pipeline across two tiers:

1. **Tier 0 (Cloudflare Edge WAF):** Block known scanner probes before reaching worker execution.
2. **Tier 1 (Cloudflare Worker & Telemetry Engine):** Implement immediate fast-path rejection for probe patterns, enhance `classifyVisitor` with path correlation, and enforce a strict HTTP `200/304` invariant before dispatching pageview analytics to D1.

---

## Technical Invariants & Constraints

- **Zero Latency Impact:** Scanner detection must run in $O(1)$ memory lookup / single regex evaluation without blocking human requests.
- **Zero False-Positives:** Legitimate static assets (`_astro/*`, `.woff2`, `.png`) and valid multilingual routes (`/`, `/es/`, `/blog/`, `/projects/`) must never be flagged as scanners.
- **D1 Quota Protection:** No request yielding a `404 Not Found` or hitting a scanner probe route may ever execute an `INSERT` into the `pageviews` table.
- **Test Integrity:** All existing tests in `tests/spec-005/` must pass, and new regression test cases for scanner classification must be added.

---

## Detailed Execution Steps

### Step 1: Configure Edge WAF Rules (Tier 0)

Using the Cloudflare CLI (`cf`) or Cloudflare API, configure a custom WAF firewall rule to block high-volume exploit scanning at the CDN edge before worker invocation.

Run or verify via terminal:

```bash
# Verify authentication and active zone
wrangler whoami

# Deploy WAF custom rule via Cloudflare API / CLI (or verify via Cloudflare dashboard)
# Expression to filter:
# (http.request.uri.path contains "/wp-" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git" or http.request.uri.path contains "/actuator" or http.request.uri.path contains "/phpmyadmin") -> Action: Block

```

---

### Step 2: Implement Scanner Path Guard & Honeypot in `cloudflare/worker.ts`

1. Define strict scanner detection constants in `cloudflare/worker.ts`:

```typescript
/**
 * Vulnerability probe patterns and forbidden extensions for static Astro sites.
 */
export const SCANNER_EXTENSION_REGEX =
  /\.(?:php|asp|aspx|jsp|jspx|cgi|env|git|sql|bak|old|backup|ini|conf|config|yml|yaml|action|do|sh|pl)$/i;

export const SCANNER_PATH_PREFIX_REGEX =
  /^\/(?:\.git|\.env|\.aws|\.ssh|\.vscode|\.well-known\/(?!security\.txt$)|wp-|wordpress|phpmyadmin|pma|adminer|actuator|solr|cgi-bin|console|boaform|telescope|vendor|storage)/i;

export const HONEYPOT_CANARY_PATHS = new Set<string>([
  "/.env",
  "/.git/config",
  "/wp-login.php",
  "/xmlrpc.php",
  "/wp-config.php",
  "/phpmyadmin/index.php",
  "/adminer.php",
  "/actuator/env",
  "/actuator/health",
  "/api/swagger",
  "/v2/_catalog",
  "/shell.php",
  "/eval-stdin.php",
]);

export function isVulnerabilityScannerPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  if (HONEYPOT_CANARY_PATHS.has(normalized)) return true;
  if (SCANNER_EXTENSION_REGEX.test(normalized)) return true;
  if (SCANNER_PATH_PREFIX_REGEX.test(normalized)) return true;
  return false;
}
```

1. Update `classifyVisitor(request: Request, pathname?: string): VisitorClassification`:

- Accept an optional `pathname?: string` parameter.
- Inject probe path evaluation before evaluating User-Agent headers:

```typescript
if (pathname && isVulnerabilityScannerPath(pathname)) {
  return {
    isBot: true,
    classification: "automated_client",
    reason: "vulnerability_scanner_path_probe",
    confidence: 1.0,
  };
}
```

1. Update the primary `fetch` lifecycle in `cloudflare/worker.ts`:

- **Fast Rejection:** Immediately return a static `404` with edge caching for scanner probes, short-circuiting asset lookup and D1 operations:

```typescript
if (isVulnerabilityScannerPath(pathname)) {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

- **Enforce HTTP 200/304 Status Invariant:** Await `assetResponse` before triggering analytics recording. Only dispatch `recordAnalyticsNonBlocking` via `ctx.waitUntil` if `response.status === 200 || response.status === 304`.

---

### Step 3: Add Unit & Edge Integration Tests

Edit `tests/spec-005/visitor-classification.test.ts` and add tests verifying scanner path classification:

```typescript
describe("Vulnerability Scanner & Exploit Path Filtering", () => {
  it("classifies spoofed Chrome requests targeting /.env as Bot", () => {
    const req = new Request(
      "[https://arturonavax.dev/.env](https://arturonavax.dev/.env)",
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
        },
      },
    );
    const res = classifyVisitor(req, "/.env");
    expect(res.isBot).toBe(true);
    expect(res.reason).toBe("vulnerability_scanner_path_probe");
  });

  it("classifies requests to WordPress administration probes as Bot", () => {
    const req = new Request(
      "[https://arturonavax.dev/wp-login.php](https://arturonavax.dev/wp-login.php)",
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 Safari/605.1.15",
        },
      },
    );
    const res = classifyVisitor(req, "/wp-login.php");
    expect(res.isBot).toBe(true);
  });

  it("preserves legitimate human navigation on valid content paths", () => {
    const req = new Request(
      "[https://arturonavax.dev/blog/](https://arturonavax.dev/blog/)",
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
          "accept-language": "en-US,en;q=0.9",
          "sec-fetch-dest": "document",
        },
      },
    );
    const res = classifyVisitor(req, "/blog/");
    expect(res.isBot).toBe(false);
    expect(res.classification).toBe("human");
  });
});
```

---

### Step 4: Verification & Deployment Workflow

Execute the following verification sequence in the project root:

```bash
# 1. Type check codebase
pnpm run check

# 2. Run edge tests with Bun
bun test tests/spec-005/visitor-classification.test.ts
bun test tests/spec-005/spec-005.test.ts

# 3. Build Astro static distribution
pnpm run build

# 4. Validate Cloudflare Worker locally via Wrangler
pnpm run dev:worker &
PID=$!
sleep 3

# Verify scanner probe returns 404 fast-path
curl -i [http://127.0.0.1:8788/.env](http://127.0.0.1:8788/.env)
curl -i [http://127.0.0.1:8788/wp-login.php](http://127.0.0.1:8788/wp-login.php)

# Verify legitimate document returns 200
curl -i [http://127.0.0.1:8788/](http://127.0.0.1:8788/)

kill $PID

# 5. Deploy to Cloudflare Edge
pnpm run deploy

```

---

## Deliverables Required

1. Modified `cloudflare/worker.ts` with clean exports for scanner detection functions.
2. Updated test suites in `tests/spec-005/` covering scanner rejection edge cases.
3. Successful output of `bun test` and `pnpm run check` with zero regressions.

```

```
