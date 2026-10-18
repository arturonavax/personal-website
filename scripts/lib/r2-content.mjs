// Shared helpers for syncing editorial content with Cloudflare R2.
//
// Bucket layout (one prefix per concern):
//   content/<collection>/<locale>/<file>  <-> src/content/<collection>/<locale>/<file>
//   assets/<path>                         <-> public/remote-assets/<path>
//   downloads/<file>                      <-> public/downloads/<file>   (CV PDFs, ...)
//   _manifest.json                        index of every object: key, size, sha256 (+ bundle info)
//   _bundle.tar.gz                        all files in one archive, for fast first-time pulls
//
// Transports (auto-selected, same interface):
//   - "cf": the `cf` CLI authenticated via `cf auth login` (default locally, no secrets on disk).
//   - "s3": @aws-sdk/client-s3 with R2 S3 API tokens (CI / Workers Builds, where `cf` is absent).
// R2 is only touched at build/dev time, never on incoming HTTP requests.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  stat,
  rm,
  mkdtemp,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);

export const ROOT = process.cwd();
export const BUCKET = process.env.R2_BUCKET_NAME || "personal-website-content";
export const MANIFEST_KEY = "_manifest.json";
export const REMOTE_MANIFEST_KEY = "content/_manifest.json";
export const MANIFEST_V2_KEY = "content/_manifest.v2.json";
export const LOCAL_MANIFEST_CACHE = path.join(
  ROOT,
  ".remote-sync-manifest.json",
);
export const LOCAL_MANIFEST_CACHE_PATH = path.join(
  ROOT,
  ".cache",
  "r2-manifest.json",
);
export const BUNDLE_KEY = "_bundle.tar.gz";
export const CONCURRENCY = Number(process.env.R2_CONCURRENCY) || 6;
/** Above this many changed files a single bundle download beats per-file requests. */
export const BUNDLE_THRESHOLD = 5;

/** [key prefix, local directory]. Order matters only for readability. */
export const MAPPINGS = [
  ["content/", "src/content"],
  ["assets/", "public/remote-assets"],
  ["downloads/", "public/downloads"],
];

const MIME_MAP = {
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/mdx; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".gz": "application/gzip",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export const contentTypeFor = (file) =>
  MIME_MAP[path.extname(file).toLowerCase()] || "application/octet-stream";

/** key -> absolute local path, or null if unmapped / escaping the mapped directory. */
export function resolveLocalPath(key) {
  for (const [prefix, dir] of MAPPINGS) {
    if (!key.startsWith(prefix)) continue;
    const base = path.join(ROOT, dir);
    const target = path.resolve(base, key.slice(prefix.length));
    return target.startsWith(base + path.sep) ? target : null;
  }
  return null;
}

/** Local files that belong in R2: [{ file, key, rel }] where rel is relative to ROOT. */
export async function collectLocalFiles() {
  const out = [];
  async function walk(dir, prefix) {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const full = path.join(dir, entry.name);
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(full, `${key}/`);
      else if (entry.isFile())
        out.push({ file: full, key, rel: path.relative(ROOT, full) });
    }
  }
  for (const [prefix, dir] of MAPPINGS)
    await walk(path.join(ROOT, dir), prefix);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** True when no synced content file exists locally (fresh clone / new machine). */
export async function isContentMissing() {
  const files = await collectLocalFiles();
  return !files.some((f) => f.key.startsWith("content/"));
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/** Runs fn over items with bounded parallelism (default concurrency = 6); throws on the first failure. */
export async function pool(items, fn, limit = CONCURRENCY) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Computes a deterministic SHA-256 hex digest over sorted `${key}:${sha256}` entries.
 */
export function computeRootHash(entries) {
  const pairs = [];
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && e.key && e.sha256) pairs.push(`${e.key}:${e.sha256}`);
    }
  } else if (entries && typeof entries === "object") {
    for (const [key, val] of Object.entries(entries)) {
      if (val && typeof val.sha256 === "string") {
        pairs.push(`${key}:${val.sha256}`);
      }
    }
  }
  pairs.sort();
  return createHash("sha256").update(pairs.join("\n")).digest("hex");
}

/**
 * Builds a v2 content manifest with `rootHash`, `bundleKey`, `entries` map, and `files` list.
 */
export function buildLocalManifestV2(
  localFiles = [],
  generatedAt = new Date().toISOString(),
) {
  const sorted = [...(localFiles ?? [])].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const entries = {};
  const files = [];
  for (const f of sorted) {
    const ext = path.extname(f.key);
    const baseNoExt = ext ? f.key.slice(0, -ext.length) : f.key;
    const shortSha = (f.sha256 || "").slice(0, 12);
    const immutableKey = `${baseNoExt}.${shortSha}${ext}`;
    const contentType = contentTypeFor(f.key);
    entries[f.key] = {
      sha256: f.sha256,
      size: f.size ?? 0,
      contentType,
      immutableKey,
    };
    files.push({
      key: f.key,
      size: f.size ?? 0,
      sha256: f.sha256,
      contentType,
      immutableKey,
    });
  }
  const rootHash = computeRootHash(files);
  const bundleKey = `content/_bundle-${rootHash.slice(0, 12)}.tar.gz`;
  return {
    version: 2,
    generatedAt,
    rootHash,
    bundleKey,
    entries,
    files,
  };
}

/**
 * Normalizes a v1 or v2 manifest into a consistent structure with both `files` array and `rootHash`.
 */
export function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  let files = Array.isArray(manifest.files) ? manifest.files : [];
  if (
    files.length === 0 &&
    manifest.entries &&
    typeof manifest.entries === "object"
  ) {
    files = Object.entries(manifest.entries).map(([key, val]) => ({
      key,
      size: val?.size ?? 0,
      sha256: val?.sha256 ?? "",
      contentType: val?.contentType ?? contentTypeFor(key),
      immutableKey: val?.immutableKey,
    }));
  }
  const rootHash = manifest.rootHash || computeRootHash(files);
  return {
    ...manifest,
    files,
    rootHash,
  };
}

/**
 * Reads the remote manifest from `content/_manifest.v2.json`, falling back to `content/_manifest.json`
 * and `_manifest.json` for backwards compatibility.
 */
export async function readManifest(driver) {
  const v2Buf = await driver.getBuffer(MANIFEST_V2_KEY);
  if (v2Buf) return normalizeManifest(JSON.parse(v2Buf.toString("utf8")));
  const primaryBuf = await driver.getBuffer(REMOTE_MANIFEST_KEY);
  if (primaryBuf)
    return normalizeManifest(JSON.parse(primaryBuf.toString("utf8")));
  const fallbackBuf = await driver.getBuffer(MANIFEST_KEY);
  return fallbackBuf
    ? normalizeManifest(JSON.parse(fallbackBuf.toString("utf8")))
    : null;
}

/**
 * Reads the cached local manifest from `.cache/r2-manifest.json` (or `.remote-sync-manifest.json`).
 */
export async function readLocalManifestCache(
  cachePath = LOCAL_MANIFEST_CACHE_PATH,
) {
  try {
    if (existsSync(cachePath)) {
      const raw = await readFile(cachePath, "utf8");
      return normalizeManifest(JSON.parse(raw));
    }
    if (
      cachePath !== LOCAL_MANIFEST_CACHE &&
      existsSync(LOCAL_MANIFEST_CACHE)
    ) {
      const raw = await readFile(LOCAL_MANIFEST_CACHE, "utf8");
      return normalizeManifest(JSON.parse(raw));
    }
  } catch {
    // Ignore corrupt or missing cache
  }
  return null;
}

/**
 * Persists the manifest to local cache (`.cache/r2-manifest.json` and `.remote-sync-manifest.json`).
 */
export async function writeLocalManifestCache(
  manifest,
  cachePath = LOCAL_MANIFEST_CACHE_PATH,
) {
  try {
    const normalized = normalizeManifest(manifest) ?? manifest;
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(normalized, null, 2));
    if (cachePath !== LOCAL_MANIFEST_CACHE) {
      await writeFile(
        LOCAL_MANIFEST_CACHE,
        JSON.stringify(normalized, null, 2),
      );
    }
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

/**
 * Computes incremental SHA-256 diff between local files and remote manifest.
 * @param {Array<{key: string, sha256: string, size?: number, file?: string, rel?: string}>} localFiles
 * @param {{files?: Array<{key: string, sha256: string, size?: number}>, entries?: Record<string, {sha256: string, size?: number}>} | null} remoteManifest
 */
export function computeRemoteManifestDiff(localFiles, remoteManifest) {
  const normalizedRemote = normalizeManifest(remoteManifest);
  const remoteFiles = normalizedRemote?.files ?? [];
  const remoteMap = new Map(remoteFiles.map((f) => [f.key, f]));
  const localMap = new Map(localFiles.map((f) => [f.key, f]));

  const toUpload = [];
  const unchanged = [];
  for (const localFile of localFiles) {
    const remoteEntry = remoteMap.get(localFile.key);
    if (!remoteEntry || remoteEntry.sha256 !== localFile.sha256) {
      toUpload.push(localFile);
    } else {
      unchanged.push(localFile);
    }
  }

  const toDownload = [];
  const orphanRemoteKeys = [];
  for (const remoteFile of remoteFiles) {
    const localEntry = localMap.get(remoteFile.key);
    if (!localEntry) {
      orphanRemoteKeys.push(remoteFile.key);
      toDownload.push(remoteFile);
    } else if (localEntry.sha256 !== remoteFile.sha256) {
      toDownload.push(remoteFile);
    }
  }

  return {
    toUpload,
    toDownload,
    unchanged,
    orphanRemoteKeys,
  };
}

/**
 * Deletes stale R2 keys that no longer exist locally when `--prune` is enabled.
 */
export async function pruneOrphanRemoteKeys(orphanKeys, options = {}) {
  const { driver, dryRun = false } = options;
  if (!Array.isArray(orphanKeys) || orphanKeys.length === 0) {
    return { deleted: 0, keys: [] };
  }
  if (dryRun || !driver) {
    return { deleted: 0, keys: orphanKeys };
  }
  await driver.deleteMany(orphanKeys);
  return { deleted: orphanKeys.length, keys: orphanKeys };
}

/** Picks the transport: S3 if credentials exist, cf CLI if available, or wrangler as fallback. */
export async function createDriver() {
  const {
    CLOUDFLARE_ACCOUNT_ID: acc,
    R2_ACCESS_KEY_ID: id,
    R2_SECRET_ACCESS_KEY: secret,
  } = process.env;
  if (
    process.env.R2_DRIVER === "s3" ||
    (process.env.R2_DRIVER !== "cf" &&
      process.env.R2_DRIVER !== "wrangler" &&
      acc &&
      id &&
      secret)
  ) {
    return createS3Driver(acc, id, secret);
  }
  if (process.env.R2_DRIVER !== "wrangler") {
    try {
      await run("cf", ["--version"]);
      return createCfDriver();
    } catch {
      // cf not available on PATH; fall through to wrangler
    }
  }
  try {
    const wrBin = existsSync(path.join(ROOT, "node_modules/.bin/wrangler"))
      ? path.join(ROOT, "node_modules/.bin/wrangler")
      : "wrangler";
    await run(wrBin, ["--version"]);
    return createWranglerDriver();
  } catch {
    throw new Error(
      "No R2 transport available. Install `cf` (npm i -g cf@latest), or install dependencies (`pnpm install`), " +
        "or provide CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.",
    );
  }
}

function createWranglerDriver() {
  const wrBin = existsSync(path.join(ROOT, "node_modules/.bin/wrangler"))
    ? path.join(ROOT, "node_modules/.bin/wrangler")
    : "wrangler";
  const wr = (args) =>
    run(wrBin, args, {
      cwd: ROOT,
      maxBuffer: 128 * 1024 * 1024,
      env: process.env,
    });
  return {
    name: "wrangler",
    async getBuffer(key) {
      const dir = await mkdtemp(path.join(tmpdir(), "r2-wr-"));
      const file = path.join(dir, "temp");
      try {
        await wr([
          "r2",
          "object",
          "get",
          `${BUCKET}/${key}`,
          "--remote",
          "--file",
          file,
        ]);
        return await readFile(file);
      } catch {
        return null;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async getFile(key, target) {
      await mkdir(path.dirname(target), { recursive: true });
      await wr([
        "r2",
        "object",
        "get",
        `${BUCKET}/${key}`,
        "--remote",
        "--file",
        target,
      ]);
    },
    async put(key, file) {
      await wr([
        "r2",
        "object",
        "put",
        `${BUCKET}/${key}`,
        "--remote",
        "--file",
        file,
        "--content-type",
        contentTypeFor(file),
      ]);
    },
    async deleteMany(keys) {
      for (const k of keys) {
        await wr(["r2", "object", "delete", `${BUCKET}/${k}`, "--remote"]);
      }
    },
  };
}

function createCfDriver() {
  const base = ["--bucket-name", BUCKET];
  const cf = (args, opts = {}) =>
    run("cf", args, {
      maxBuffer: 512 * 1024 * 1024,
      encoding: "buffer",
      ...opts,
    });
  return {
    name: "cf",
    /** Returns the object body, or null when the key does not exist. */
    async getBuffer(key) {
      try {
        const { stdout } = await cf(["r2", "objects", "get", key, ...base]);
        return stdout.length > 0 ? stdout : null;
      } catch {
        return null;
      }
    },
    async getFile(key, target) {
      const body = await this.getBuffer(key);
      if (!body) throw new Error(`Object not found: ${key}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    },
    async put(key, file) {
      await cf([
        "r2",
        "objects",
        "put",
        key,
        ...base,
        "--file",
        file,
        "--content-type",
        contentTypeFor(file),
        "-q",
      ]);
    },
    async deleteMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await cf([
          "r2",
          "objects",
          "bulk-delete",
          ...base,
          "--body",
          JSON.stringify(keys.slice(i, i + 1000)),
          "-q",
        ]);
      }
    },
  };
}

async function createS3Driver(accountId, accessKeyId, secretAccessKey) {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } =
    await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    name: "s3",
    async getBuffer(key) {
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        );
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (err) {
        if (err?.name === "NoSuchKey") return null;
        throw err;
      }
    },
    async getFile(key, target) {
      const body = await this.getBuffer(key);
      if (!body) throw new Error(`Object not found: ${key}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    },
    async put(key, file) {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: await readFile(file),
          ContentType: contentTypeFor(file),
        }),
      );
    },
    async deleteMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: {
              Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
            },
          }),
        );
      }
    },
  };
}

// ---- Bundle (tar.gz) helpers -------------------------------------------------------------

const ALLOWED_PREFIXES = MAPPINGS.map(([, dir]) => `${dir}/`);

/** Creates a tar.gz of the given ROOT-relative paths. */
export async function createBundle(relPaths, outFile) {
  const list = `${outFile}.list`;
  await writeFile(list, relPaths.join("\n") + "\n");
  try {
    await run("tar", ["-czf", outFile, "-C", ROOT, "-T", list]);
  } finally {
    await rm(list, { force: true });
  }
}

/** Extracts a bundle into ROOT after validating every entry stays inside the synced dirs. */
export async function extractBundle(bundleFile) {
  const { stdout } = await run("tar", ["-tzf", bundleFile], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = stdout.split("\n").filter(Boolean);
  for (const entry of entries) {
    const safe =
      !path.isAbsolute(entry) &&
      !entry.split("/").includes("..") &&
      ALLOWED_PREFIXES.some((p) => entry.startsWith(p));
    if (!safe) throw new Error(`Refusing bundle: unsafe entry "${entry}"`);
  }
  await run("tar", ["-xzf", bundleFile, "-C", ROOT, "--no-same-owner"]);
  return entries.length;
}

export const fileSize = async (file) => (await stat(file)).size;

export const REQUIRED_CONTENT_COLLECTIONS = [
  "posts",
  "projects",
  "experience",
  "services",
  "resume",
];

export const REQUIRED_CONTENT_LOCALES = ["en", "es"];

const VALID_CONTENT_EXT_REGEX = /\.(?:md|mdx|json)$/i;

async function listValidContentFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listValidContentFilesRecursive(full)));
    } else if (entry.isFile() && VALID_CONTENT_EXT_REGEX.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Build-Time Content Integrity Gate (TASK SEO-1).
 * Verifies that every required collection (`posts`, `projects`, `experience`, `services`, `resume`)
 * has >= 1 valid content file (`.md`, `.mdx`, or `.json`) for each supported locale (`en`, `es`).
 */
export async function verifyContentHydration(options = {}) {
  const contentRoot = options.contentRoot || path.join(ROOT, "src", "content");
  const collections = options.collections || REQUIRED_CONTENT_COLLECTIONS;
  const locales = options.locales || REQUIRED_CONTENT_LOCALES;
  const allowEmpty =
    options.allowEmpty === true ||
    process.env.ALLOW_EMPTY_CONTENT === "true" ||
    process.env.ALLOW_EMPTY_CONTENT === "1";

  const counts = {};
  const missing = [];

  for (const collection of collections) {
    counts[collection] = {};
    const collectionDir = path.join(contentRoot, collection);
    const topEntries = existsSync(collectionDir)
      ? await readdir(collectionDir, { withFileTypes: true })
      : [];

    for (const locale of locales) {
      const localeDir = path.join(collectionDir, locale);
      const localeSubdirFiles = await listValidContentFilesRecursive(localeDir);

      // Also support flat locale-suffixed files such as `ArturoNava-Resume-en.md`
      const flatLocaleRegex = new RegExp(
        `(?:^|[-_.])${locale}\\.(?:md|mdx|json)$`,
        "i",
      );
      const flatLocaleFiles = topEntries
        .filter((e) => e.isFile() && flatLocaleRegex.test(e.name))
        .map((e) => path.join(collectionDir, e.name));

      const total = localeSubdirFiles.length + flatLocaleFiles.length;
      counts[collection][locale] = total;

      if (total < 1) {
        missing.push(`${collection}/${locale}`);
      }
    }
  }

  if (missing.length > 0 && !allowEmpty) {
    throw new Error(
      `[ContentHydrationError] Build-time content integrity check failed. Missing content for: ${missing.join(", ")} in ${contentRoot}. Run \`pnpm content:pull\` or set ALLOW_EMPTY_CONTENT=true if intentional.`,
    );
  }

  return {
    valid: missing.length === 0,
    counts,
    missing,
  };
}
