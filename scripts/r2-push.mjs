// Incremental push of local content to Cloudflare R2: uploads only files whose sha256 changed.
//   node scripts/r2-push.mjs             upload changes, refresh manifest + bundle
//   node scripts/r2-push.mjs --dry-run   show the plan only
//   node scripts/r2-push.mjs --prune     also delete R2 objects that no longer exist locally
// Without --prune, remote-only objects are preserved (safe from machines with partial content).
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUCKET,
  BUNDLE_KEY,
  MANIFEST_KEY,
  collectLocalFiles,
  createBundle,
  createDriver,
  pool,
  readManifest,
  sha256File,
} from "./lib/r2-content.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const prune = args.has("--prune");

async function main() {
  const t0 = Date.now();
  const local = await collectLocalFiles();
  if (local.length === 0) throw new Error("No local content to push.");
  await pool(
    local,
    async (f) => {
      f.sha256 = await sha256File(f.file);
      f.size = (await stat(f.file)).size;
    },
    32,
  );

  const driver = dryRun ? null : await createDriver();
  const remote = dryRun ? null : await readManifest(driver);
  const remoteMap = new Map((remote?.files ?? []).map((f) => [f.key, f]));
  const localKeys = new Set(local.map((f) => f.key));

  const changed = local.filter(
    (f) => remoteMap.get(f.key)?.sha256 !== f.sha256,
  );
  const remoteOnly = [...remoteMap.keys()].filter((k) => !localKeys.has(k));
  const toDelete = prune ? remoteOnly : [];

  console.log(
    `[sync:push] bucket=${BUCKET} transport=${driver?.name ?? "n/a"} local=${local.length} changed=${changed.length} remote-only=${remoteOnly.length}${prune ? " (will delete)" : ""}`,
  );
  if (dryRun) {
    for (const f of local)
      console.log(`[sync:push] (dry-run) ${f.key} ${f.size}B`);
    console.log(
      "[sync:push] Dry run: remote state not queried, nothing uploaded.",
    );
    return;
  }

  const files = [
    ...local.map(({ key, size, sha256 }) => ({ key, size, sha256 })),
  ];
  if (!prune) for (const k of remoteOnly) files.push(remoteMap.get(k));
  files.sort((a, b) => a.key.localeCompare(b.key));

  await pool(changed, async (f) => {
    await driver.put(f.key, f.file);
    console.log(`[sync:push] uploaded ${f.key}`);
  });
  if (toDelete.length) {
    await driver.deleteMany(toDelete);
    console.log(`[sync:push] deleted ${toDelete.length} remote objects`);
  }

  const manifest = { generatedAt: new Date().toISOString(), files };
  const dir = await mkdtemp(path.join(tmpdir(), "r2-push-"));
  try {
    // The bundle must mirror the manifest exactly, so it is skipped when remote-only
    // entries (not present locally) are retained.
    const bundleComplete = remoteOnly.length === 0 || prune;
    const needsBundle =
      changed.length > 0 || toDelete.length > 0 || !remote?.bundle;
    if (bundleComplete && needsBundle) {
      const bundleFile = path.join(dir, "bundle.tar.gz");
      await createBundle(
        local.map((f) => f.rel),
        bundleFile,
      );
      await driver.put(BUNDLE_KEY, bundleFile);
      manifest.bundle = {
        key: BUNDLE_KEY,
        size: (await stat(bundleFile)).size,
        sha256: await sha256File(bundleFile),
      };
      console.log(
        `[sync:push] bundle refreshed (${(manifest.bundle.size / 1024).toFixed(0)} KB)`,
      );
    } else if (bundleComplete && remote?.bundle) {
      manifest.bundle = remote.bundle;
    } else {
      console.warn(
        "[sync:push] Remote-only objects retained: bundle omitted (run pull, then push, to rebuild it).",
      );
    }
    const manifestFile = path.join(dir, MANIFEST_KEY);
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await driver.put(MANIFEST_KEY, manifestFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`[sync:push] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  console.error("[sync:push] Error:", err.message ?? err);
  process.exit(1);
});
