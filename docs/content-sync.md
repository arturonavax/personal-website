# Content sync with Cloudflare R2

R2 is touched **only at build/dev time**, never on HTTP requests (`output: 'static'`).
Bucket `personal-website-content` is private (r2.dev disabled, no custom domain).

## Bucket layout

| R2 key                                | Local path                              |
| ------------------------------------- | --------------------------------------- |
| `content/<collection>/<locale>/<file>` | `src/content/<collection>/<locale>/<file>` |
| `assets/<path>`                       | `public/remote-assets/<path>`           |
| `resume/CV.pdf`                       | `public/CV.pdf`                         |
| `_manifest.json`                      | index (key, size, sha256) written by push |

Collections: `posts`, `projects`, `services`, `experience`, `resume`.

## Workflows

| Goal                               | Command                          |
| ---------------------------------- | -------------------------------- |
| Dev against local files            | `pnpm dev`                       |
| Dev against R2 (pull, then dev)    | `pnpm dev:r2`                    |
| Build with local files             | `pnpm build`                     |
| Build against R2                   | `CONTENT_SOURCE=r2 pnpm build`   |
| Pull R2 -> local                   | `pnpm content:pull`              |
| Preview what push would upload     | `pnpm content:push:dry`          |
| Push local -> R2                   | `pnpm content:push`              |

## Transports

- **Wrangler (default locally):** uses your `wrangler login` OAuth session. No secrets on disk.
- **S3 API (CI):** set `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  (bucket-scoped token, Object Read & Write) plus `CONTENT_SOURCE=r2` in Workers Builds.
  Force Wrangler with `R2_DRIVER=wrangler`.
