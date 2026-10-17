// Pull editorial content from Cloudflare R2 into the local tree (build/dev time only).
//   node scripts/r2-pull.mjs            always pull
//   node scripts/r2-pull.mjs --if-r2    pull only when CONTENT_SOURCE=r2 (used by `prebuild`)
import { BUCKET, createDriver, resolveLocalPath } from "./lib/r2-content.mjs";

const conditional = process.argv.includes("--if-r2");
if (conditional && process.env.CONTENT_SOURCE !== "r2") {
  console.log("[sync:pull] CONTENT_SOURCE is not 'r2'; using local content.");
  process.exit(0);
}

async function main() {
  const driver = await createDriver();
  console.log(`[sync:pull] bucket=${BUCKET} transport=${driver.name}`);
  const keys = await driver.list();
  if (keys.length === 0) {
    console.warn("[sync:pull] Remote index is empty; keeping local content.");
    return;
  }
  let downloaded = 0;
  for (const key of keys) {
    const target = resolveLocalPath(key);
    if (!target) continue;
    console.log(`[sync:pull] ${key} -> ${target}`);
    await driver.get(key, target);
    downloaded++;
  }
  console.log(`[sync:pull] Synchronized ${downloaded} files.`);
}

main().catch((err) => {
  console.error("[sync:pull] Error:", err.message ?? err);
  process.exit(1);
});
