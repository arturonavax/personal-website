// scripts/isolate-admin-build.mjs
import fs from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "dist");
const vaultDir = path.join(distDir, "__admin_vault__");

async function moveIfExists(srcFile, destFile) {
  try {
    await fs.access(srcFile);
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.rename(srcFile, destFile);
    await fs.rm(path.dirname(srcFile), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  await moveIfExists(
    path.join(distDir, "admin", "index.html"),
    path.join(vaultDir, "default", "index.html"),
  );
  for (const locale of ["en", "es"]) {
    await moveIfExists(
      path.join(distDir, locale, "admin", "index.html"),
      path.join(vaultDir, locale, "index.html"),
    );
  }
}

run().catch((err) => {
  console.error("[isolate-admin-build] Fatal error:", err);
  process.exit(1);
});
