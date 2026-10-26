# Personal website

A bilingual engineering portfolio built with **Astro SSG**, **Cloudflare Workers + Static Assets**, TypeScript, Tailwind, and ports/adapters. Public content is statically generated; a persistent browser shell provides navigation, Matrix rendering, theme transitions, accessible controls, search, and résumé tools. The Worker handles protected administration, visits, APIs, and edge policies.

## Documentation

Start with the [current specification index](openspec/specs/README.md). It describes the actual source baseline, functional contracts, scenarios, test references, and known limitations. It replaces historical specs as the current-state entry point; it does not claim literal reproducibility of private content or a universal performance score.

| Topic                                    | Guide                                           | Detailed contract                                                |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Platform and public features             | [Architecture](docs/architecture.md)            | [Platform/content/SEO](openspec/specs/current-platform.md)       |
| Content workflow                         | [R2 synchronization](docs/content-sync.md)      | [Platform](openspec/specs/current-platform.md)                   |
| Search/discovery and locales             | [SEO and i18n](docs/seo-and-i18n.md)            | [Platform](openspec/specs/current-platform.md)                   |
| Navigation, Matrix, theme, visual system | [SPA continuity](docs/spa-continuity.md)        | [SPA and presentation](openspec/specs/current-spa.md)            |
| Metrics, quota guards, dashboard         | [Cloudflare edge](docs/cloudflare-edge.md)      | [Telemetry/admin](openspec/specs/current-telemetry-admin.md)     |
| Authentication and operations            | [Security](docs/security.md)                    | [Edge operations](openspec/specs/current-edge-operations.md)     |
| Checks and evidence                      | [Verification](docs/verification.md)            | [Coverage index](openspec/specs/README.md#coverage-and-evidence) |
| Adapting the site                        | [Customization](docs/template-customization.md) | [Agent instructions](AGENTS.md)                                  |

For a future visual redesign, start with the [preservation contract](docs/frontend-redesign.md): visual freedom, functional invariants, capability checklist and required evidence. The [bounded Search Console audit](odd/tasks/search-console-indexation.md) records dated, read-only URL inspections, not a guarantee of Google indexing or a complete issue inventory.

## Local development

Use the package manager pinned by `package.json` and `pnpm-lock.yaml` (baseline pnpm 12.5.1). Node.js must satisfy the installed Astro/toolchain engines. Bun is needed for the unit/integration suite; Playwright and a compatible browser are needed for browser tests. `tar` supports content bundles; PDF optimization optionally uses `qpdf`.

```sh
pnpm install --frozen-lockfile
# With editorial content already available locally:
pnpm dev:local
```

Astro development runs on port 4321. The configured development/preview commands bind to all interfaces; use a trusted network. For Worker-backed behavior, use the production-like local flow described in [verification](docs/verification.md).

### Useful commands

| Command                 | Effect / prerequisite                                                               |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`              | Smart content check/pull, then Astro dev; may access R2                             |
| `pnpm dev:r2`           | Explicit content pull, then Astro dev                                               |
| `pnpm dev:local`        | Astro dev using existing disk content                                               |
| `pnpm run dev-prod`     | Local check/build and Worker on port 8788; no R2 pull; optional local vault staging |
| `pnpm dev:worker`       | Local Worker using an existing build and local resource state                       |
| `pnpm check`            | Astro/TypeScript diagnostics                                                        |
| `pnpm test`             | Bun unit/integration tests; not the Playwright browser suite                        |
| `pnpm run audit`        | Project static architecture/hydration checks, not a dependency vulnerability audit  |
| `pnpm content:pull`     | Download private editorial content/assets/CVs; requires authorized transport        |
| `pnpm content:push:dry` | Inspect planned upload without changing R2                                          |

`CONTENT_SOURCE=local` is not an offline switch: missing content or truthy CI environment flags can still trigger a pull. For a static build that bypasses the content-pull hook, use the direct Astro commands in [verification](docs/verification.md#local-content-build-without-the-pull-hook). Wrangler also has a custom build command that can pull content.

Builds, content uploads, deploys, and database commands have different side effects. Read the domain guide before using them. Remote database reset commands are destructive maintenance operations, not setup or upgrade steps.

## What is and is not in Git

The source, tests, schemas, migrations, public configuration shape, and documentation are tracked. Editorial Markdown/MDX, synchronized remote assets, and CV downloads are ignored and come from private R2 or an authorized local copy. The website also depends on account-side resources, DNS, Access policy, and secret bindings that must be managed separately.

The configured deployment uses public HTML Worker interception plus explicit asset bypasses to support server-side visits. The admin HTML is moved into an internal build vault and served only through the authorization boundary. `/api/telemetry` returns observed empty data or explicit 503 unavailable/degraded results, not synthetic visits; bounded device/OS and sampled bot/AI coverage is not a site-wide total. The checked-in bot collection switch remains off until migration `0012` and deliberate activation. A populated dashboard or queued collector response is not proof of persisted production events.

## Performance and security expectations

Keep the site lightweight, readable, accessible, and continuous across SPA navigation. Client JavaScript is intentional for specific interactions; this is not a zero-byte JavaScript site. Rendering and quota protections are designed to reduce overhead, not to guarantee identical FPS, field Core Web Vitals, or free-tier eligibility on every account/device.

See the [verification evidence levels](docs/verification.md#evidence-levels) before treating a target or historical result as a current guarantee. No deployment or production account validation is implied by a local documentation update.

## License

See [LICENSE](LICENSE) for the custom non-commercial terms and attribution requirements. Personal editorial content, CV data, and personal assets are not licensed for republication as your own. Replace them when adapting the template and retain the attribution required by the license.
