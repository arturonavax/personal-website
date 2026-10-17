# personal-website

Astro 7 static site (`output: 'static'`) served from Cloudflare Workers + Static Assets.
Editorial content is **not stored in Git**: its source of truth is a private Cloudflare R2 bucket.

## Quick start (new machine)

```sh
pnpm install
cf auth login            # Cloudflare CLI (npm i -g cf@latest). `wrangler login` is not needed for content.
pnpm dev                 # first run auto-pulls content from R2 (~3 s), then serves on http://0.0.0.0:4321
```

Requirements: Node 22+, pnpm, [`cf`](https://developers.cloudflare.com/cf/), `tar`, and (only to
optimize CV PDFs) `qpdf`. Bun is used for `pnpm test` / `pnpm audit`.

## Content & R2

### Where everything must live

| In R2 (bucket `personal-website-content`, private) | Local path (git-ignored)                    | Used by                          |
| -------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| `content/<collection>/<locale>/<file>.md(x)`       | `src/content/<collection>/<locale>/<file>`  | Astro content collections        |
| `assets/<path>`                                    | `public/remote-assets/<path>`               | Images/files referenced by posts |
| `downloads/ArturoNava-CV-{en,es}.pdf`              | `public/downloads/ArturoNava-CV-{en,es}.pdf` | "Download CV" button in `/resume/` |
| `_manifest.json`, `_bundle.tar.gz`                 | (not stored locally)                        | Sync index and fast-pull archive |

Collections: `posts`, `projects`, `services`, `experience`, `resume`. Locale folders: `en`, `es`
(the `resume` collection keeps its files at the collection root).
Only the `.gitkeep` placeholders under `src/content/*/` and `public/{downloads,remote-assets}/`
are committed; everything else there is ignored by `.gitignore`.

### Daily workflow

| Goal                                              | Command                         |
| ------------------------------------------------- | ------------------------------- |
| Dev (auto-pulls only if content is missing)       | `pnpm dev`                      |
| Dev forcing a sync with R2 first                  | `pnpm dev:r2`                   |
| Dev fully offline with what is on disk            | `pnpm dev:local`                |
| Local Worker (D1/R2 bindings), exposed on the LAN | `pnpm dev:worker`               |
| Production build + Worker preview                 | `pnpm dev-prod`                 |
| Deploy to Cloudflare (auto-pulls R2 + builds)     | `pnpm run deploy`               |
| Build (auto-pulls if content missing or `CONTENT_SOURCE=r2`) | `pnpm build`         |
| Download changes from R2                          | `pnpm content:pull`             |
| See what a push would upload                      | `pnpm content:push:dry`         |
| Upload changes to R2                              | `pnpm content:push`             |
| Same, deleting R2 objects removed locally         | `node scripts/r2-push.mjs --prune` |
| Optimize + publish the CV PDFs                    | `pnpm cv:publish`               |

All dev/preview servers listen on `0.0.0.0` (`--host` / `--ip 0.0.0.0`) so phones and other
machines on the LAN can open `http://<your-lan-ip>:4321` (Astro) or `:8788` (Worker).

### How the sync stays fast

- **Incremental:** every file is compared by SHA-256 against `_manifest.json`; only differences move.
  A no-op pull or push costs one small request (~1.5 s).
- **Bundle:** when more than 8 files differ (new machine, big update) `pull` downloads the single
  `_bundle.tar.gz` (validated by checksum and path-safety check) instead of one request per file.
- **Parallel:** remaining files transfer 8 at a time (`R2_CONCURRENCY` to tune).
- **Safe by default:** `push` never deletes remote objects unless `--prune`, so a machine with partial
  content cannot wipe the bucket. `pull` never deletes local files unless `--prune`.

### Updating the CV

Keep the source PDFs in `.cv/ArturoNava-CV-en.pdf` and `.cv/ArturoNava-CV-es.pdf` (git-ignored), then:

```sh
pnpm cv:publish   # lossless qpdf optimization (~-19 %, text stays selectable) -> public/downloads -> R2
```

### CI / Workers Builds

`cf` is not available in CI, so the scripts switch to the S3 API automatically when these variables
exist (see [.env.example](./.env.example)): `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (bucket-scoped token, Object Read & Write). Set `CONTENT_SOURCE=r2` to always
sync on build. Details: [docs/content-sync.md](./docs/content-sync.md).

## Build / test

```sh
pnpm build        # astro build (content is pulled first if needed)
pnpm check        # astro check
pnpm test         # bun test
pnpm audit        # SPEC-004 static gates
```

## License & Proprietary Notice

The code structure and UI architecture of this site are source-available under a **Custom Non-Commercial License** (see [LICENSE](./LICENSE)).

- **Proprietary Assets (All Rights Reserved):** All articles (`/src/content/posts`), project writeups (`/src/content/projects`), CV data (`/src/content/cv`), and personal images (`/src/assets/arturonava.jpg`) are strictly proprietary to Arturo Nava and may not be republished or deployed elsewhere.
- **Using this template:** You may use the code layout for non-commercial, personal projects provided you replace all personal assets and retain the visible attribution link in the footer.
