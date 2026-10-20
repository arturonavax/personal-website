# SPEC-003: Perimeter Security & WAF Defense Configuration

## 1. WAF Bot Defense Expression (L7 Rule)

Applied on Cloudflare Dashboard under **Security > WAF > Custom Rules** or via Terraform:

```hcl
resource "cloudflare_filter" "ai_bot_defense" {
  zone_id     = var.cloudflare_zone_id
  description = "Block or challenge aggressive AI scrapers and unauthorized bots on API endpoints"
  expression  = "(cf.client.bot) or (http.user_agent contains \"Bytespider\") or (http.user_agent contains \"ClaudeBot\") or (http.user_agent contains \"CCBot\") or (http.user_agent contains \"GPTBot\") or (http.user_agent contains \"Amazonbot\")"
}

resource "cloudflare_firewall_rule" "ai_bot_defense_rule" {
  zone_id     = var.cloudflare_zone_id
  filter_id   = cloudflare_filter.ai_bot_defense.id
  action      = "managed_challenge" # or "block" for /api/* endpoints
  description = "Enforce Managed Challenge against AI scrapers"
}
```

### Direct Expression

```
(cf.client.bot) or
(http.user_agent contains "Bytespider") or
(http.user_agent contains "ClaudeBot") or
(http.user_agent contains "CCBot") or
(http.user_agent contains "GPTBot") or
(http.user_agent contains "Amazonbot")
```

- **Action:** `Block` for `/api/*` endpoints; `Managed Challenge` for static crawl requests.

---

## 2. Query Parameter Normalization (Transform Rules)

To preserve the Edge Cache Hit Ratio and prevent social tracking query parameters from fragmenting the cache:

- **Expression:** `http.request.uri.path eq "/api/search"`
- **Stripped Query Parameters:**
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_term`
  - `utm_content`
  - `fbclid`
  - `gclid`

Note: Normalized in `cloudflare/worker.ts` as an edge invariant, and configurable as a Cloudflare Transform Rule.

---

## 3. Disabling Edge Challenge Platform JS Injection (`jsd/main.js`)

To achieve a 100/100 score in Lighthouse Best Practices and eradicate deprecated API warnings (`StorageType.persistent is deprecated`, `Protected Audience API is deprecated`) injected by Cloudflare's Bot Management layer:

1. **Edge Worker Sanitization (Active):**
   `cloudflare/worker.ts` automatically strips `<script.*src=["'][^"']*\/cdn-cgi\/challenge-platform\/scripts\/jsd\/main\.js[^"']*["'][^>]*><\/script>` and inline `__CF$cv$params` before serving HTML responses.

2. **Cloudflare Zone API Automation:**
   Cloudflare Bot Fight Mode JS injection can be disabled at the zone level:

   ```bash
   curl -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/bot_management" \
     -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
     -H "Content-Type: application/json" \
     --data '{"fight_mode": false, "enable_js": false}'
   ```

   Automated via `node scripts/disable-cf-jsd.mjs` whenever `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` are available in the deployment environment.
