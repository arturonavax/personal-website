# Security Hardening, CSP & Abuse Protection

This document outlines the security architecture and defensive controls implemented across this web portal, from the Cloudflare Edge network down to client-side CSP headers.

---

## 1. Edge Security & HTTP Headers (`public/_headers`)

Every response served by Cloudflare Workers or Static Assets includes rigorous security headers:

```ini
# Security and universal headers
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Alt-Svc: h3=":443"; ma=86400
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=(), accelerometer=(), gyroscope=(), magnetometer=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' data: https://static.cloudflareinsights.com https://app.cal.com https://challenges.cloudflare.com; script-src-elem 'self' 'unsafe-inline' data: https://static.cloudflareinsights.com https://app.cal.com https://challenges.cloudflare.com; frame-src 'self' https://app.cal.com https://cal.com https://challenges.cloudflare.com; child-src 'self' https://app.cal.com https://cal.com https://challenges.cloudflare.com; connect-src 'self' https://cloudflareinsights.com https://cal.com https://app.cal.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; object-src 'none';
```

### Key Security Directives:

- **`Strict-Transport-Security` (HSTS):** Enforced with `max-age=63072000; includeSubDomains; preload`, guaranteeing that all connections use HTTPS and qualify for browser HSTS preload lists.
- **`X-Frame-Options: DENY` & `frame-ancestors 'none'`:** Completely mitigates Clickjacking attacks by forbidding the embedding of this site inside any `<iframe>`.
- **`Permissions-Policy`:** Disables all invasive browser hardware sensors and APIs (`camera`, `microphone`, `geolocation`, `browsing-topics`, `usb`, `payment`).
- **`Content-Security-Policy` (CSP):** Limits execution strictly to trusted origins (`'self'`, Cloudflare Turnstile, Cloudflare Web Analytics, and Cal.com booking modal). `object-src 'none'` prevents Flash/Java applet execution.

---

## 2. Contact Form Defense & Bot Deterrence (`/api/contact`)

The contact endpoint (`cloudflare/worker.ts`) implements layered bot and abuse mitigation:

### 2.1. Honeypot Trap

The form includes hidden inputs (`website` / `honeypot`) that are invisible to real users but frequently populated by automated scrapers.

- If a honeypot field is filled, the request is **silently dropped** with a simulated HTTP 200 response, wasting the bot's resources while preventing any notification dispatch.

### 2.2. Cloudflare Turnstile Captcha

Human presence is verified non-intrusively via Cloudflare Turnstile:

- The client passes `cf-turnstile-response`.
- The worker verifies the token cryptographically against `https://challenges.cloudflare.com/turnstile/v0/siteverify` using `TURNSTILE_SECRET_KEY`.

### 2.3. IP-Based Sliding Rate Limiting

- Contact submissions are restricted by client IP (`cf-connecting-ip`).
- Maximum allowance: 5 submissions per 10-minute window.
- Exceeding the threshold returns `HTTP 429 Too Many Requests` with a `Retry-After: 600` header.

### 2.4. Strict Input Constraints & Sanitization

All fields are constrained and sanitized against buffer overflow and injection attacks:

- `name`: max 100 characters.
- `email`: max 120 characters, RFC-compliant regex validation.
- `phone`: max 35 characters.
- `subject`: max 150 characters.
- `message`: max 4,000 characters.

---

## 3. Administrative Surface Isolation (Zero Trust)

The administration dashboard (`/admin`) provides real-time telemetry, lead management, and deployment status. To prevent unauthorized access:

- **Apex Path Lockdown:** Accessing `https://arturonavax.dev/admin` issues an immediate HTTP 308 redirect to `https://admin.arturonavax.dev`.
- **Dedicated Subdomain Gating:** `admin.arturonavax.dev` is protected by **Cloudflare Access (Zero Trust)**. Any request without a valid Cloudflare Access session token is rejected at the edge before reaching the Worker code.
- **Cache Invalidation:** Administrative routes set `Cache-Control: no-store, private` and `X-Robots-Tag: noindex, nofollow, noarchive` to prevent search engine indexing or proxy caching.

---

## 4. Automated Static Architecture Gates (`scripts/audit-codebase.ts`)

To ensure security, performance, and accessibility standards never regress, `scripts/audit-codebase.ts` executes in CI:

- **No Unmanaged Images:** Every image must use Astro's `<Image/>` or `<Picture/>` with responsive dimensions and explicit formats (`webp`/`avif`), or carry `role="presentation"`.
- **No Prohibited CSS Layout Transitions:** Prevents Cumulative Layout Shift (CLS) regressions by failing builds if transitions on `width`, `height`, `padding`, or `margin` are detected.
- **No Static `will-change`:** Prevents GPU memory leaks.
- **Tailwind v4 Invariant:** Ensures zero legacy `tailwind.config.*` files exist.

---

## 5. Vulnerability Scanner & Exploit Mitigation (Multi-Tier Edge Defense)

Automated scanners (e.g. searching for `.env`, `wp-login.php`, `xmlrpc.php`, `phpmyadmin`, `actuator/env`) probe web properties continuously. The portal implements a defense-in-depth model that neutralizes scans without false positives on legitimate content routes:

### 5.1. Tier 0: Global Edge WAF (`http_request_firewall_custom`)

- **Location:** Cloudflare CDN Edge, evaluated prior to Worker execution.
- **Rule ID:** `00386b6cb5f2423393f92b3d620f97c7` (Version 2).
- **Behavior:** Blocks known exploit payloads with HTTP 403 Forbidden.
- **Precision Matching:** Uses `starts_with(http.request.uri.path, ...)` and `ends_with(...)` instead of substring matching. This guarantees zero false positives for legitimate content or blog slugs (e.g., `/blog/wordpress-migration`, `/services/telescope-integration`).
- **Performance Impact:** 0 ms Worker CPU time and 0 D1 write operations consumed.

### 5.2. Tier 1: Worker Fast-Path Rejection (`isVulnerabilityScannerPath`)

- **Location:** `cloudflare/worker.ts`, executed on requests reaching the Worker.
- **Canary Honeypot Set:** $O(1)$ set lookup (`HONEYPOT_CANARY_PATHS`) for high-confidence probes (`/.env`, `/.git/config`, `/wp-login.php`, `/adminer.php`, etc.).
- **Prefix & Extension Regex:** Evaluates root paths with segment boundaries `(?:\/|$|\.)` so routes like `/storage-guide` are never blocked.
- **RFC 8615 Well-Known Allowlist:** Explicitly permits standard endpoints (`/.well-known/security.txt`, ACME challenges, passkey assertions, app links).
- **Response:** Static HTTP 404 with `Cache-Control: public, max-age=86400`, bypassing `env.ASSETS` and telemetry completely.

### 5.3. Telemetry Beacon Endpoint Protection (`/api/v1/telemetry`)

- **Same-Origin Enforcement:** Rejects cross-origin POST requests via `Sec-Fetch-Site: same-origin` or strict origin header comparison (HTTP 403).
- **Payload Ceiling:** Rejects bodies exceeding 2 KB (`TELEMETRY_MAX_BODY_BYTES`) with HTTP 413.
- **Path Sanitization:** Rejects scanner paths and non-content URLs before processing.
- **Server-Side Trust:** Client-supplied visitor hashes are discarded; hashes are derived deterministically on the edge server from request IP, User-Agent, and salt.
- **Isolated Table Writes:** Writes exclusively to `edge_telemetry_events`, preventing beacon double-counting with server-side pageviews.
