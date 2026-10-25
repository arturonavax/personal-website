// Optional local-only staging. Publication remains the explicit r2-push command.
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { MAPPINGS, ROOT, resolveLocalPath, sha256File } from "./r2-content.mjs";

const journalPath = path.join(ROOT, ".cache/obsidian-stage.json");
const backupRoot = path.join(ROOT, ".cache/obsidian-stage-backups");

async function ownedJournal() {
  try {
    const info = await lstat(journalPath);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Unsafe staging journal.");
    const parsed = JSON.parse(await readFile(journalPath, "utf8"));
    if (
      parsed.version !== 1 ||
      !parsed.files ||
      typeof parsed.files !== "object" ||
      Array.isArray(parsed.files)
    )
      throw new Error("Invalid staging journal.");
    for (const [key, hash] of Object.entries(parsed.files)) {
      if (
        !eligible(key) ||
        !resolveLocalPath(key) ||
        !/^[a-f0-9]{64}$/.test(hash)
      )
        throw new Error("Invalid staging journal.");
    }
    return parsed.files;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

const EDITORIAL = new Set([
  "posts",
  "projects",
  "services",
  "experience",
  "resume",
]);
const ASSET_EXT = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

function eligible(key) {
  if (key.startsWith("content/")) {
    const parts = key.slice("content/".length).split("/");
    const ext = path.extname(key).toLowerCase();
    return (
      EDITORIAL.has(parts[0]) &&
      (parts[0] === "resume"
        ? ext === ".md"
        : parts.length >= 3 &&
          (parts[1] === "en" || parts[1] === "es") &&
          (parts[0] === "posts" || parts[0] === "services"
            ? [".md", ".mdx"].includes(ext)
            : ext === ".md"))
    );
  }
  if (key.startsWith("assets/")) return ASSET_EXT.test(key);
  if (key.startsWith("downloads/")) return /\.pdf$/i.test(key);
  return false;
}

async function ensureSafeDestination(target, base) {
  let current = path.parse(base).root;
  for (const component of path.relative(current, base).split(path.sep)) {
    current = path.join(current, component);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Unsafe destination path.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const component of path.relative(base, target).split(path.sep)) {
    current = path.join(current, component);
    try {
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        (current === target ? !info.isFile() : !info.isDirectory())
      )
        throw new Error("Unsafe destination path.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/** No vault reads or network operations unless the opt-in path is set. */
export async function stageObsidianContent(
  vaultPath = process.env.OBSIDIAN_VAULT_PATH,
) {
  if (!vaultPath) return null;
  const vault = path.resolve(vaultPath);
  let rootInfo;
  try {
    rootInfo = await lstat(vault);
  } catch {
    /* Missing paths fail below. */
  }
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Vault must be an existing directory.");

  const candidates = [];
  let unpublished = 0;
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const key = `${prefix}${entry.name}`;
      // Check links before ignoring names: never follow a link even in an excluded subtree.
      if (entry.isSymbolicLink()) throw new Error(`Symlink in vault: ${key}`);
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) {
        unpublished++;
        continue;
      }
      if (entry.isDirectory())
        await walk(path.join(dir, entry.name), `${key}/`);
      else if (entry.isFile() && eligible(key)) {
        const source = path.join(dir, entry.name);
        if (key.startsWith("content/") && /\.mdx?$/i.test(key)) {
          const text = await readFile(source, "utf8");
          const frontmatter =
            /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
          if (
            /^\s*draft:\s*['"]?true['"]?\s*(?:#.*)?$/im.test(frontmatter) ||
            /^\s*visible:\s*['"]?false['"]?\s*(?:#.*)?$/im.test(frontmatter)
          ) {
            unpublished++;
            continue;
          }
        }
        const target = resolveLocalPath(key);
        if (!target) throw new Error(`Unsafe mapped key: ${key}`);
        const base = path.dirname(
          resolveLocalPath(`${key.split("/")[0]}/.probe`),
        );
        await ensureSafeDestination(target, base);
        candidates.push({ key, source, target });
      }
    }
  }
  for (const [prefix] of MAPPINGS) {
    const mappedRoot = path.join(vault, prefix);
    try {
      const info = await lstat(mappedRoot);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Symlink in vault: ${prefix}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await walk(mappedRoot, prefix);
  }
  await ensureSafeDestination(journalPath, path.join(ROOT, ".cache"));
  const previous = await ownedJournal();
  const next = {};
  const actions = [];
  let changed = 0;
  let unchanged = 0;
  // Preflight every destination before mutating any content or the journal.
  for (const { key, source, target } of candidates) {
    const hash = await sha256File(source);
    let local;
    try {
      local = await sha256File(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (local !== undefined && local !== hash && local !== previous[key])
      throw new Error(`Local staging conflict: ${key}`);
    next[key] = hash;
    if (local === hash) unchanged++;
    else {
      actions.push({ source, target });
      changed++;
    }
  }
  const retired = [];
  for (const [key, hash] of Object.entries(previous)) {
    if (key in next) continue;
    const target = resolveLocalPath(key);
    const base = path.dirname(resolveLocalPath(`${key.split("/")[0]}/.probe`));
    await ensureSafeDestination(target, base);
    let local;
    try {
      local = await sha256File(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (local !== undefined && local !== hash)
      throw new Error(`Local staging conflict: ${key}`);
    if (local !== undefined) retired.push({ target });
  }
  if (retired.length) {
    await ensureSafeDestination(
      path.join(backupRoot, ".probe"),
      path.join(ROOT, ".cache"),
    );
    await mkdir(backupRoot, { recursive: true });
    for (const { target } of retired) {
      // A unique, exclusive backup is completed before the owned local copy is retired.
      await copyFile(
        target,
        path.join(backupRoot, `${randomUUID()}-${path.basename(target)}`),
        constants.COPYFILE_EXCL,
      );
      await unlink(target);
    }
  }
  for (const { source, target } of actions) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await ensureSafeDestination(journalPath, path.join(ROOT, ".cache"));
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(
    journalPath,
    JSON.stringify({ version: 1, files: next }, null, 2) + "\n",
  );
  return { changed, unchanged, unpublished, retired: retired.length };
}
