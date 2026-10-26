# Security boundaries and operational safety

The current controls protect administrative data and reduce public endpoint abuse. They are source-backed behaviors, not a blanket security certification. The normative [edge/security specification](../openspec/specs/current-edge-operations.md) describes exact interfaces and known limitations; [telemetry/admin](../openspec/specs/current-telemetry-admin.md) describes data semantics.

## Trust boundaries

| Surface               | Trusted decision point                                                       | Lower-trust input                                   |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| Admin HTML/APIs       | Worker `verifyAdminAccess()` before protected data access                    | Request headers, cookies, URL tokens, browser state |
| Internal vault        | External normalized-path rejection + direct ASSETS binding lookup after auth | Caller-supplied `x-admin-vault-internal`            |
| Contact form          | Worker normalization, anti-abuse gates and persistence path                  | JSON fields, origin, timestamps, captcha response   |
| Visit collection      | Server-derived visitor hash, path validation, dedupe, quota policy           | Client path/referrer/event and fetch metadata       |
| Editorial/build input | Private content sync checks and content schemas                              | Downloaded content/assets and local edits           |
| Account configuration | Explicit owner-authorized Cloudflare administration                          | Documentation assertions or historical settings IDs |

## Admin authentication and HTML isolation

The Worker decodes the path once when valid, collapses slashes and strips terminal `.html`; lowercase matching identifies admin/vault routes. External `/__admin_vault__*` requests return 404/no-store before ASSETS reads, even with a forged internal header.

The build relocates generated admin pages into `dist/__admin_vault__/{default,en,es}/index.html` and removes unvaulted directories. Inspect actual output when verifying a build: the relocation helper tolerates missing source files. Authorized retrieval occurs through ASSETS, not a publicly reachable trusted-header shortcut.

Authentication supports two alternatives:

- **Cloudflare Access:** signature verification using cached JWKS, issuer, expected audience and numeric expiry; the configured normalized email allowlist is checked. `Cf-Access-Jwt-Assertion` or `CF_Authorization` is input, not authority until verified. An authenticated-email header alone is never sufficient.
- **Explicit configured token:** `ADMIN_ACCESS_TOKEN` (or `ADMIN_API_KEY`) of at least 20 characters, compared through SHA-256 digests and bytewise XOR. Bearer/header/session/query compatibility exists. Prefer Access or headers; putting tokens in URLs can leak through history/logs even when cookie compatibility exists.

No configured authentication with no require flags returns 403; otherwise unauthenticated access returns 401. HTML requests can receive the challenge page; API requests receive JSON and challenge/noindex headers. A true require-Access flag does not remove the independently configured token alternative. Production settings require correct issuer/audience, allowlist and an account-side Access application; source values alone do not establish that policy.

Protected APIs include telemetry detail/metrics/leads/deployments/status and admin paths. Public exceptions are collector POST and views GET, plus their preflights. The singular `/api/deployment` status route differs from protected `/api/deployments`. See [EDGE-03](../openspec/specs/current-edge-operations.md#edge-03--admin-boundary-and-vault) for exact matching and [boundary tests](../tests/admin-boundary.test.ts) for forged identity, malformed cookie, vault and valid-credential cases.

## Public contact and captcha behavior

`/api/contact` accepts POST only. It trims/truncates name/email/phone/subject/message (100/120/35/150/4,000 characters), requires name, email syntax and at least 20 message characters, normalizes locale/subjects and uses parameterized D1 statements.

Anti-abuse layers are deliberately not described as infallible:

- Honeypot and supplied sub-1.5s submission timestamp return simulated success without storage/notification.
- Five attempts per 10 minutes perIP use an **isolate-memory fixed window**, not a global distributed rate limiter; rejection is 429 with Retry-After 600.
- Existing origin checking is a predicate with allowed-host/localhost matching, not strict universal same-origin enforcement.
- Configured Turnstile requires a token, but explicit blocked-script/network fallback markers continue through other shields. Contact verification has an availability-oriented success-shaped timeout fallback. The separate `/api/verify-captcha` endpoint instead returns unsuccessful verification on its short timeout. Do not claim every accepted contact passed Turnstile.
- D1 failure can select reduced-schema retry or R2 lead WAL; notification transports are optional. If both database and WAL fail, success is not a guaranteed durable receipt.

Inbound email is a separate D1/webhook flow and does not automatically inherit the web form's quota/WAL guards. Details and source links are in [EDGE-04](../openspec/specs/current-edge-operations.md#edge-04--public-apis-contact-and-notifications).

## Telemetry privacy, integrity and read protection

Visits use server-derived daily visitor hashes and dedupe; these are pseudonymous, not a legal compliance certification. Contact leads can contain names, email, phone, message text, IP, user agent and geolocation/network metadata. Compatibility edge events can retain user-agent text. Treat stored records, admin exports and screenshots as private.

Public collection validates method/path/body and uses available fetch metadata; it is not an authenticated write API. The current collector rejects a supplied non-same-origin fetch-site header, but missing metadata is not itself rejected. The separate compatibility endpoint has its own origin validation. Never generalize one endpoint's boundary to all others.

Protected caches are accessed only after authentication. Private HTTP caching rules and internal Cache API copies serve different purposes. `/api/telemetry` does not synthesize visits: unavailable/degraded reads return 503 rather than fabricated zeros. Cached UI results, daily hash rotation, tier-dependent datasets and estimated quota panels mean populated UI or 202 status alone cannot prove real user counts or durable production writes.

## Response headers and browser policy

[`public/_headers`](../public/_headers) configures static response caching/security; the Worker separately sets relevant HTML/admin/API headers. HSTS includes includeSubDomains/preload, framing is denied, nosniff and referrer/permissions policies are set. A preload directive does not prove a browser preload registration or coverage of an unverified domain.

CSP currently allows selected external booking/captcha/analytics origins and inline/data allowances. It is not a nonce-only strict policy and does not eliminate all injection risk. Do not copy old CSP snippets without comparing the active file and actual response branch.

The source rejects scanner paths and contains narrow JSD script filtering. WAF/DNS/Access/Bot/JavaScript Detection/cache settings live outside Git. Historical rule identifiers or assertions of zero false positives/zero processing cost are not current evidence; no account-side settings were queried in this documentation pass.

## Public-repository and credential handling

- Never commit admin tokens, Turnstile secrets, R2/S3 access keys, webhook URLs, Telegram tokens, deployment credentials, private lead/telemetry dumps or real exported fixtures.
- Use variable names and clearly dummy examples in docs/tests; public identifiers are not credentials, but avoid copying account-specific configuration into new examples unnecessarily.
- Editorial content and downloaded PDFs/assets are externally synchronized/ignored inputs; public Git is not their backup.
- Inspect staged changes and intended history before publication. A secret deleted from HEAD may remain in history; a rewritten history does not revoke credentials or erase forks, clones, caches or already downloaded objects.
- Revocation/rotation, history rewriting, remote branch cleanup and account mutations are distinct scoped operations. Do not infer their authorization from a local documentation task.
- Never expose secrets through CLI logs, environment dumps, command arguments or screenshots. Read only the variable names/allowlisted non-secret configuration needed for the task.

## Proportionate verification

Existing source-level gates (`pnpm audit`) and tests reduce regressions but do not certify deployed infrastructure or field performance. Relevant checks include [admin boundaries](../tests/admin-boundary.test.ts), [visitor classification](../tests/spec-005/visitor-classification.test.ts), [quota/dedupe/WAL](../tests/spec-011/edge-telemetry-dedupe.test.ts), and [contact/edge integration assertions](../tests/odd-tasks.test.ts).

This update ran documentation checks only, not a fresh penetration test. Existing [production evidence](../odd/tasks/production-spa-delivery.md) still leaves persisted production telemetry, interactive owner Access and some deployed settings needing validation. Any future validation must be narrowly authorized, avoid private data disclosure, and report observed outcomes rather than perfect-security claims. Never reset production D1, deploy, upload content or purge caches merely to verify documentation.
