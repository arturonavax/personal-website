// Push locally authored content (all collections, remote assets, CV.pdf) to Cloudflare R2
// and refresh the bucket manifest. Usage: node scripts/r2-push.mjs [--dry-run]
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUCKET, MANIFEST_KEY, collectLocalFiles, createDriver, fileInfo,
} from "./lib/r2-content.mjs";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const files = await collectLocalFiles();
  const manifest = { generatedAt: new Date().toISOString(), files: [] };
  for (const { file, key } of files) {
    manifest.files.push({ key, ...(await fileInfo(file)) });
  }

  if (dryRun) {
    for (const f of manifest.files) console.log(`[sync:push] (dry-run) ${f.key} ${f.size}B`);
    console.log(`[sync:push] ${files.length} files would be uploaded to ${BUCKET}.`);
    return;
  }

  const driver = await createDriver();
  console.log(`[sync:push] bucket=${BUCKET} transport=${driver.name}`);
  for (const { file, key } of files) {
    await driver.put(key, file);
    console.log(`[sync:push] Uploaded: ${key}`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), "r2-push-"));
  try {
    const manifestFile = path.join(dir, MANIFEST_KEY);
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await driver.put(MANIFEST_KEY, manifestFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`[sync:push] Done: ${files.length} files + manifest.`);
}

main().catch((err) => {
  console.error("[sync:push] Error:", err.message ?? err);
  process.exit(1);
});
