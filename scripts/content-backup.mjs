// Explicit, offline snapshot of the mapped local editorial inputs. Never reads R2.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  lstat,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ROOT,
  MAPPINGS,
  collectLocalFiles,
  computeRootHash,
  sha256File,
} from "./lib/r2-content.mjs";

const outputRel = ".cache/backups";

async function checkDirectory(rel) {
  let current = ROOT;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Unsafe mapped path: ${path.relative(ROOT, current)}`);
    }
  }
  return true;
}

async function checkMappedTree(rel) {
  if (!(await checkDirectory(rel))) return;
  const dir = path.join(ROOT, rel);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const child = path.join(rel, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unsafe mapped path: ${child}`);
    if (entry.isDirectory()) await checkMappedTree(child);
  }
}

async function checkBackupDirectory() {
  await checkDirectory(outputRel);
  let info;
  try {
    info = await lstat(path.join(ROOT, outputRel));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if ((info.mode & 0o777) !== 0o700) {
    throw new Error(
      `Unsafe backup directory permissions: ${outputRel} (expected 0700)`,
    );
  }
}

async function backup() {
  if (process.argv.length !== 2) {
    throw new Error("Usage: node scripts/content-backup.mjs (no arguments)");
  }
  // Inspect mapped ancestors and nested entries before the collector silently skips symlinks.
  for (const [, dir] of MAPPINGS) await checkMappedTree(dir);
  const files = await collectLocalFiles();
  if (!files.length) throw new Error("No mapped local files to back up.");

  const records = [];
  for (const file of files) {
    await checkDirectory(path.dirname(file.rel).split(path.sep).join("/"));
    const actual = await realpath(file.file);
    if (actual !== file.file || !(await lstat(file.file)).isFile()) {
      throw new Error(`Unsafe mapped path: ${file.rel}`);
    }
    if (file.rel.includes("\n") || file.rel.includes("\r")) {
      throw new Error(`Unsafe mapped path: ${file.rel}`);
    }
    records.push({
      key: file.key,
      path: file.rel.split(path.sep).join("/"),
      size: (await stat(file.file)).size,
      sha256: await sha256File(file.file),
    });
  }
  const manifest = {
    version: 1,
    rootHash: computeRootHash(records),
    files: records,
  };
  const name = `website-content-${manifest.rootHash.slice(0, 16)}.tar.gz`;
  const relative = `${outputRel}/${name}`;
  const destination = path.join(ROOT, relative);

  // All metadata lives in a private system temp directory, not in the checkout.
  const scratch = await mkdtemp(path.join(tmpdir(), "website-backup-"));
  let handle;
  let created = false;
  try {
    await writeFile(
      path.join(scratch, "backup-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(scratch, "paths"),
      Buffer.from(records.map((r) => `${r.path}\0`).join("")),
      { mode: 0o600 },
    );
    await checkBackupDirectory();
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await checkBackupDirectory();
    try {
      handle = await open(destination, "wx", 0o600);
      created = true;
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(`Backup already exists: ${relative}`);
      throw error;
    }
    // tar emits regular files and the manifest; no extraction and no remote transport.
    const tar = spawn(
      "tar",
      [
        "-czf",
        "-",
        "-C",
        ROOT,
        "--null",
        "-T",
        path.join(scratch, "paths"),
        "-C",
        scratch,
        "backup-manifest.json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let errorText = "";
    tar.stderr.setEncoding("utf8");
    tar.stderr.on("data", (chunk) => {
      errorText += chunk;
    });
    const exit = new Promise((resolve, reject) => {
      tar.on("error", reject);
      tar.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`tar failed (${code}): ${errorText.trim()}`)),
      );
    });
    await Promise.all([pipeline(tar.stdout, handle.createWriteStream()), exit]);
    // A concurrent editorial edit must not produce a backup with a stale manifest.
    for (const record of records) {
      const file = path.join(ROOT, record.path);
      if (
        (await stat(file)).size !== record.size ||
        (await sha256File(file)) !== record.sha256
      ) {
        throw new Error(`Source changed during backup: ${record.path}`);
      }
    }
    handle = null;
    console.log(
      `[backup] Created ${relative} (${records.length} files); local only.`,
    );
  } catch (error) {
    if (handle) await handle.close();
    if (created) await rm(destination);
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

backup().catch((error) => {
  console.error(`[backup] Error: ${error.message}`);
  process.exitCode = 1;
});
