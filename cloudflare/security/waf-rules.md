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
