# Editorial content and R2 synchronization

Editorial Markdown/MDX, synced images and CV PDFs are ignored by Git. The current-state contract is [PLAT08–09](../openspec/specs/current-platform.md#plat-08--content-synchronization-and-publication-inputs). Obtain an owner-authorized content backup or scoped bucket access before expecting a complete site.

## Source inputs

| Remote prefix                              | Local destination                                                        | Current content                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `content/`                                 | `src/content/`                                                           | Posts, projects, services, experience, resume                         |
| `assets/`                                  | `public/remote-assets/`                                                  | Editorial images/diagrams                                             |
| `downloads/`                               | `public/downloads/`                                                      | Downloadable CV PDFs                                                  |
| `content/_manifest.v2.json`                | `.cache/r2-manifest.json` and compatibility `.remote-sync-manifest.json` | Hash/size/type catalogue, root hash, bundle metadata                  |
| `content/_bundle-<rootHash-prefix>.tar.gz` | Temporary extraction input                                               | Content-addressed bulk transfer; `_bundle.tar.gz` compatibility alias |

The build-time bucket defaults to `personal-website-content`, overridable by `R2_BUCKET_NAME`. It is not necessarily the same bucket as the Worker's `STORAGE_BUCKET` used for application storage and telemetry WAL.

Resume's current Content Layer loader expects flat `ArturoNava-Resume-{en,es}.md` files, not structured JSON resumes. Other collections use locale directories and their declared Markdown/MDX extensions. The separate resume resolver retains compatibility paths; see [PLAT02/06](../openspec/specs/current-platform.md).

## Blog series

Add optional series metadata to each participating post's frontmatter:

```yaml
series:
  id: distributed-systems
  title: Distributed systems
  part: 2
```

Use the same stable `series.id` for related posts and a positive integer `part` for their authored order. The title can be localized; `translationKey` still identifies translations of the **same post**, not membership in a series. Posts without `series` keep their existing standalone presentation.

- The article shows a compact series label and previous/next navigation before and after its content. Links are ordinary server-rendered anchors, with no extra client JavaScript.
- Navigation groups by locale and series ID, then orders published parts numerically. English and Spanish never link across languages implicitly.
- Draft or hidden parts are excluded. Gaps link the nearest published part without renumbering authored parts or exposing unpublished titles. Duplicate published part numbers within the same locale/series fail the build instead of producing ambiguous pagination.
- Translating a post may change its slug: keep its stable `translationKey` so locale availability and the existing language switcher identify the correct visible counterpart.
- `updatedDate` (or legacy `updatedAt`) is forwarded to article metadata. A post cover image supplies the explicit social image when present; otherwise the site's default social-image strategy applies. Article canonicals remain route-based.

Do not add example posts to ignored editorial directories merely to test this feature. Use synthetic entries in `tests/post-series.test.ts`; owner-authorized content publication remains a separate operation.

## Local commands and side effects

| Command                            | Behavior                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                         | Pull `--auto`, then Astro dev; keeps local content when present unless remote freshness is requested         |
| `pnpm dev:local`                   | Starts Astro without content synchronization                                                                 |
| `pnpm dev:r2`                      | Checks remote content before Astro dev                                                                       |
| `pnpm content:pull`                | Reads the remote manifest and downloads changed/missing mapped files                                         |
| `pnpm content:stage`               | With `OBSIDIAN_VAULT_PATH`, stages changed mapped vault files locally; no remote access                      |
| `pnpm content:backup`              | Creates an offline compressed snapshot of existing mapped local files; no R2 or Drive access                 |
| `pnpm dev-prod`                    | Offline local Worker build; optionally stages vault content first; never publishes or pulls R2               |
| `pnpm content:push:dry`            | Local plan only; does not query remote state or show an authoritative remote diff                            |
| `pnpm content:push`                | Publishes local content/manifest/bundle and can notify IndexNow; requires explicit publication authorization |
| `node scripts/r2-pull.mjs --force` | Redownloads files instead of trusting equal local hashes                                                     |

Dev scripts use `--host`; they expose the server to the local network. Use a trusted network or explicitly bind loopback when appropriate.

### Optional Obsidian staging

Set `OBSIDIAN_VAULT_PATH` to a local vault directory only after authorizing that directory for reading. Without it, `content:stage` is a no-op and `dev-prod` retains its offline local-content path. The vault must contain paths under `content/`, `assets/`, or `downloads/` matching the R2 key layout above. For example, `content/posts/en/post.md` stages to `src/content/posts/en/post.md`; `assets/cover.png` stages to `public/remote-assets/cover.png`. Supported editorial collections are posts, projects, experience, services, and resume. Posts/services accept `.md`/`.mdx`, projects/experience/resume `.md`; mapped assets accept common image formats and downloads PDF. This does not convert Obsidian wikilinks, attachments or arbitrary vault notes into website content.

Staging checks SHA-256 and copies only changed files; ignored `_`/`.` names and `draft: true` or `visible: false` Markdown frontmatter (including trailing YAML comments) are not copied. It rejects vault symlinks and unsafe mapped destinations. An ignored or removed vault file previously staged by this workflow is retired **only if its local hash still matches** the ignored `.cache/obsidian-stage.json` ownership journal. Before retirement its bytes are saved to a unique file under ignored `.cache/obsidian-stage-backups/`. Local edits or conflicting unowned destinations fail closed before copying or retiring; inspect the reported key and resolve it manually. Keep the journal and backups with your private content backup; losing the journal prevents safe automatic retirement. Staging never retires remote-only/local-only files, reads R2, uploads, deletes R2 objects, or refreshes the remote manifest. Backups are local safety copies, not a versioned remote backup. Review visibility, links and generated routes on real content and run `pnpm check` before an explicitly authorized `pnpm content:push`; do not use `--prune` as a routine staging step. `content:push:dry` is local-only and not an authoritative remote diff.

Do **not** put prune commands into normal setup. Pull `--prune` deletes local-only synced files. Push `--prune` deletes remote-only objects. Back up the authoritative content and review the intended deletion set before either operation; a partial checkout is not a safe prune source. Ordinary push preserves remote-only files.

## Optional local backup

Run `pnpm content:backup` explicitly after hydrating or staging the intended private editorial files. It creates `.cache/backups/website-content-<root-hash-prefix>.tar.gz` (ignored by Git) with mode 0600 in a mode-0700 directory. The archive holds only existing files selected by the same mapping and hidden/underscore-name exclusions as `collectLocalFiles()` (`content/`, `assets/`, `downloads/`), plus `backup-manifest.json` (version, sorted R2 keys, local paths, sizes, SHA-256 hashes and root hash). It rejects mapped symlinks, including nested directory links that the file collector would otherwise skip, empty inputs and existing archive names; it never overwrites a prior archive. An existing `.cache/backups/` with permissions other than 0700 fails with `Unsafe backup directory permissions: .cache/backups (expected 0700)` without changing its mode or contents; secure it yourself before retrying. If the same content is backed up again, move the existing archive to owner-controlled storage first or change the input; no implicit rotation occurs. Unmapped notes, `.env` files, the Obsidian ownership journal and its retirement backups are **not** included. Keep those separately if needed.

The archive is a snapshot of **local** mapped bytes, not an R2 inventory, a vault backup, a publish action or proof of a usable build. Inspect the manifest and validate restored content before publishing; extract only into a trusted destination after checking entries and checksums. Keep the archive private and transfer it to an owner-controlled Drive/location manually if desired; this command never uploads or authenticates remotely. Requires a local `tar` with gzip support. Do not commit the archive or copy private contents into fixtures.

## Transport selection

`scripts/lib/r2-content.mjs#createDriver` selects:

1. S3-compatible API when `R2_DRIVER=s3` or the expected account/access-key/secret environment values are available, unless another driver was selected.
2. `cf` CLI when available and not explicitly disabled by the driver selection.
3. Wrangler CLI fallback with remote object operations.

`R2_DRIVER` can pin `s3`, `cf` or `wrangler`. CLI availability is not proof of login or bucket permission. A selected driver's failed operation is not guaranteed to retry through every other driver. Obtain authorization before using an existing authenticated session; never publish credential values in docs or logs.

## Manifest and transfer algorithm

- The v2 manifest contains sorted files/entries, SHA-256, size, content type, immutable-key metadata, `rootHash`, and a content-addressed bundle key.
- Pull can exit after a conditional 304 or equal root hash. Normal no-change v2 paths avoid listing all objects; actual request counts depend on transport/fallback behavior.
- Default concurrency is 6 (`R2_CONCURRENCY` override). More than 5 stale files triggers a bundle attempt; failed/unusable bundle transfer falls back to individual file downloads.
- Individual downloads are checked against their manifest SHA-256. Bundle checksum is checked when metadata supplies it; files are re-evaluated after extraction.
- Path mapping rejects escapes outside the mapped directory. Archive extraction retains its entry validation. Do not bypass those helpers in new sync tools.
- Push skips unchanged data, updates the manifest/bundle, and garbage-collects obsolete bundles while preserving current/previous and compatibility keys. It is not a globally atomic multi-object transaction or a full versioned editorial backup.

## Build hooks and integrity checks

`package.json` is authoritative: `prebuild` runs pull `--auto`; `build` runs Astro then admin-vault isolation; `predeploy` pulls content and builds. Wrangler also declares a build command containing pull and `pnpm run build`. Do not copy old snippets that redefine those scripts differently.

Auto mode requests remote freshness when `CONTENT_SOURCE=r2` or CI/Cloudflare/GitHub environment detection is active. Otherwise it skips a remote transfer if local content exists. Missing/unusable manifest is an error, not an instruction to deploy an empty site.

`verifyContentHydration()` expects at least one recognized `md`/`mdx`/`json` file per collection and locale, supporting subdirectories and flat locale suffixes. It is a presence check, **not** schema validation, draft visibility validation, or a content-completeness proof. `ALLOW_EMPTY_CONTENT=true|1` deliberately bypasses failure and must remain explicit.

Current limitation: several early pull exits (304/root-hash/up-to-date files) return before the final hydration check. Do not assume every successful sync ran it. Astro schema validation and a successful content-bearing build remain separate checks. See `tests/spec-012/seo-aeo-and-db-compaction.test.ts` for existing structural/algorithm regressions.

## CV PDF pipeline

`pnpm cv:optimize` reads `.cv/ArturoNava-CV-*.pdf` by default; `node scripts/optimize-pdf.mjs <input.pdf>` accepts explicit inputs. qpdf compresses streams and linearizes the PDF, preserving text/vector content. It writes the same filename under `public/downloads/` and copies the original if compression would enlarge it.

`pnpm cv:publish` runs optimization **and the full content push**, not just a local PDF update. Required qpdf installation, source PDFs and publication credentials are external prerequisites. A particular size reduction or completion time is not guaranteed.

## Recovery checklist

- Preserve an owner-controlled backup of content, remote assets, PDFs, and a matching manifest.
- Inspect local edits before pulling; pull can overwrite changed local files that differ from the remote manifest.
- Use an explicitly authorized destination/session for sync; never infer permission from an available OAuth token.
- Verify the collection schema, locale visibility and generated routes after restoration.
- Keep `.cache/`, downloaded content, PDFs, secrets and build artifacts out of the commit.
