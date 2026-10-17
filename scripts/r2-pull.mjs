// Incremental pull of editorial content from Cloudflare R2 (build/dev time only).
//   node scripts/r2-pull.mjs                sync: download only files whose sha256 differs
//   node scripts/r2-pull.mjs --auto         sync if CONTENT_SOURCE=r2 or local content is missing
//   node scripts/r2-pull.mjs --prune        also delete local synced files that are not in R2
//   node scripts/r2-pull.mjs --force        re-download everything
// Many changed files (or a fresh machine) -> one bundle download instead of N requests.
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUCKET, BUNDLE_KEY, BUNDLE_THRESHOLD, collectLocalFiles, createDriver, extractBundle,
  isContentMissing, pool, readManifest, resolveLocalPath, sha256File,
} from "./lib/r2-content.mjs";

const args = new Set(process.argv.slice(2));
const prune = args.has("--prune");
const force = args.has("--force");

async function main() {
  if (args.has("--auto")) {
    const isCI = Boolean(
      process.env.CI ||
      process.env.CF_PAGES ||
      process.env.CLOUDFLARE_BUILD ||
      process.env.GITHUB_ACTIONS
    );
    const wantsR2 = process.env.CONTENT_SOURCE === "r2" || isCI;
    if (!wantsR2 && !(await isContentMissing())) {
      console.log("[sync:pull] Local content present (CONTENT_SOURCE != r2); skipping.");
      return;
    }
    if (isCI) {
      console.log("[sync:pull] CI/Cloudflare environment detected; pulling fresh content from R2.");
    } else if (!wantsR2) {
      console.log("[sync:pull] Local content missing; pulling from R2.");
    }
  }

  const t0 = Date.now();
  const driver = await createDriver();
  const manifest = await readManifest(driver);
  if (!manifest) {
    throw new Error(`No ${BUCKET}/_manifest.json found. Run \`pnpm content:push\` from a machine that has the content.`);
  }
  console.log(`[sync:pull] bucket=${BUCKET} transport=${driver.name} files=${manifest.files.length}`);

  const outdated = async () => {
    const stale = [];
    await pool(manifest.files, async (f) => {
      const target = resolveLocalPath(f.key);
      if (!target) return;
      const same = !force && existsSync(target) && (await sha256File(target)) === f.sha256;
      if (!same) stale.push(f);
    }, 32);
    return stale;
  };

  let stale = await outdated();
  if (stale.length === 0) console.log("[sync:pull] Already up to date.");

  if (stale.length > BUNDLE_THRESHOLD && manifest.bundle) {
    const dir = await mkdtemp(path.join(tmpdir(), "r2-bundle-"));
    const file = path.join(dir, "bundle.tar.gz");
    try {
      console.log(`[sync:pull] ${stale.length} files changed -> downloading bundle (${(manifest.bundle.size / 1024).toFixed(0)} KB)`);
      await driver.getFile(BUNDLE_KEY, file);
      if ((await sha256File(file)) !== manifest.bundle.sha256) throw new Error("bundle checksum mismatch");
      const n = await extractBundle(file);
      console.log(`[sync:pull] Extracted ${n} entries from bundle.`);
      stale = await outdated(); // anything the (possibly older) bundle did not cover
    } catch (err) {
      console.warn(`[sync:pull] Bundle unusable (${err.message}); falling back to per-file download.`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  let downloaded = 0;
  await pool(stale, async (f) => {
    const target = resolveLocalPath(f.key);
    await driver.getFile(f.key, target);
    if ((await sha256File(target)) !== f.sha256) throw new Error(`Checksum mismatch for ${f.key}`);
    downloaded++;
    console.log(`[sync:pull] ${f.key}`);
  });

  if (prune) {
    const remote = new Set(manifest.files.map((f) => f.key));
    for (const { key, file } of await collectLocalFiles()) {
      if (!remote.has(key)) {
        await unlink(file);
        console.log(`[sync:pull] pruned local-only ${key}`);
      }
    }
  }
  console.log(`[sync:pull] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${downloaded} individual downloads).`);
}

main().catch((err) => {
  console.error("[sync:pull] Error:", err.message ?? err);
  process.exit(1);
});
