# Adapting the website without losing its behavior

Start with the [current specification index](../openspec/specs/README.md). This is a maintained application with private editorial inputs and account-side integrations, not an instant fully configured template. Review [LICENSE](../LICENSE) before reuse.

## Establish a local baseline

1. Use the repository's `packageManager`/lockfile and install the declared dependencies. The inspected baseline records pnpm 12.5.1 and Astro 7.3.4; do not follow old Astro 5 or generic pnpm 9 examples.
2. Obtain your own authorized editorial files/assets/PDFs or create schema-valid content. The public checkout intentionally contains placeholders rather than the owner's private R2 data.
3. Use `pnpm dev:local` for Astro-only development with local content. It does not emulate the production Worker APIs, Access, telemetry or Static Assets routing.
4. Use `pnpm dev-prod` for the project's check/build/local-Worker workflow on port 8788 when inputs and local bindings are ready. It performs content/build hooks; it is not a read-only command.

Dev scripts expose `0.0.0.0` by default; prefer loopback or a trusted LAN. Bun is required for `pnpm test`/audit. qpdf and `tar` are needed only for their respective PDF/bundle workflows. Browser tests additionally need a compatible executable and running server.

## Change identity at the real sources

| Area                             | Where to inspect/change                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Site URL and static routing      | `astro.config.mjs`, `wrangler.jsonc`, Worker routing, `public/_redirects`                     |
| Owner/schema identity            | `src/lib/seo/schema-builder.ts`, `src/utils/seo.ts`, resume serializers, metadata literals    |
| UI language and names            | `src/i18n/`, layouts/components, page frontmatter                                             |
| Profile/content                  | Schema-valid files under `src/content/`, `src/data/resume.ts` resolver conventions            |
| Public identity/link data        | `src/data/` social links, companies, sponsorships, online judges, tools and simulations       |
| Visual identity                  | `src/styles/global.css`, portrait/assets, favicon files, `site.webmanifest`, default OG image |
| Search/machine-readable identity | Search documents, RSS, `public/llms.txt`, full catalog generator, robots and sitemap URLs     |

There is no demonstrated single `SITE_URL` environment switch that rewrites every tracked identity literal. Search references deliberately, review generated metadata in both languages, and keep `#person` identity consistent. Do not copy the original owner's administrative email allowlist, Access audience, account/database IDs, secrets or session configuration into a new account.

## Supply content correctly

Use [the content guide](content-sync.md) and `src/content.config.ts`. Required publication inputs are posts/projects/services/experience in their supported Markdown formats and flat locale-suffixed resume Markdown. The schema has five collections; case-study simulations are tracked code/data, not a sixth R2 collection.

- Use stable translation keys for real counterpart entries; translated slugs may differ.
- Keep draft/hidden flags explicit and verify that unpublished entries are absent from public outputs.
- Keep downloaded content and remote assets ignored by Git.
- Keep an owner-controlled backup; bucket availability and a public repository are not a complete backup strategy.

`content:push` publishes and can notify IndexNow. Its dry-run is local-only and does not prove the remote diff. Prune can delete content and must never be an automatic setup step.

## Configure integrations separately

| Integration                    | Prerequisites and boundary                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build-time R2 content          | Your bucket/backup and explicitly authorized S3 or CLI access; separate from Worker runtime storage                                                               |
| Runtime D1/R2                  | Your bindings, fresh schema/upgrade plan, persistence and quota verification                                                                                      |
| Admin                          | Your Cloudflare Access application/team/audience/email policy and/or configured secret-token method; preserve fail-closed Worker verification and vault isolation |
| Search                         | Optional AI/Vectorize configuration; retain static-index/static-memory fallback                                                                                   |
| Contact/captcha/email/webhooks | Your service credentials/site keys and delivery configuration; preserve validation and abuse controls                                                             |
| Domains and deployment         | Your DNS/custom-domain routes, cache/security policy, build environment and deploy authorization                                                                  |

Follow [edge operations](../openspec/specs/current-edge-operations.md) for safe bootstrap/release boundaries. Do not run remote schema resets, content pruning, deployment or credential discovery merely to customize styles. Environment examples are configuration references; copy only needed variable names into private local/CI secret stores.

## Preserve non-negotiable behavior

- Keep one persistent Matrix canvas/Worker and the same render clock through Astro navigation and cached timeline commits.
- Keep theme snapshot/reveal lifecycle, reduced-motion paths, keyboard/input isolation and persistent toast behavior.
- Preserve separate project/post article header/content surfaces and shared scalable corner geometry.
- Keep initial server-side visit recording plus committed-route collector events and dedupe. Narrowing Worker-first to admin-only changes that contract.
- Preserve public-asset bypasses, protected admin vault, auth checks, quota degradation and clear failure behavior.
- Keep resume print/selectable text, live exports and recruiter UTM behavior; do not replace them with screenshot-only PDFs.

## Verify before publishing

Use the current [coverage/evidence index](../openspec/specs/README.md), not historical fixed test counts. At minimum verify the changed domain, typecheck, static/unit checks and applicable browser paths using both locales/themes. Content-dependent browser skips must be explained. Inspect rendered head/sitemap/feeds and protect admin/API access with realistic requests.

A successful local build does not certify an account's deployed Access policy, external delivery, D1 writes, free-tier headroom or field Core Web Vitals. Record those checks separately. Remote changes and publishing require explicit destination/operation/session authorization; local development does not grant it.
