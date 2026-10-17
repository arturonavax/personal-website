# Content sync with Cloudflare R2

See the "Content & R2" section of the root [README](../README.md) for the full workflow and file
locations. Technical notes:

- R2 is touched **only at build/dev time**, never on HTTP requests (`output: 'static'`).
- Bucket `personal-website-content` is private (r2.dev disabled, no custom domain).
- Layout: `content/`, `assets/`, `downloads/`, `_manifest.json`, `_bundle.tar.gz`.
- Transports: `cf` CLI (OAuth, default locally) or S3 API (CI, when `CLOUDFLARE_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are set). Force `cf` with `R2_DRIVER=cf`.
- Safety: bundle entries are validated (no absolute paths, no `..`, only synced directories) and
  every file/bundle is checked against its SHA-256 from the manifest.
