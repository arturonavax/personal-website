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
import { mkdir, readdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

export const ROOT = process.cwd();
export const BUCKET = process.env.R2_BUCKET_NAME || "personal-website-content";
export const MANIFEST_KEY = "_manifest.json";
export const BUNDLE_KEY = "_bundle.tar.gz";
export const CONCURRENCY = Number(process.env.R2_CONCURRENCY) || 8;
/** Above this many changed files a single bundle download beats per-file requests. */
export const BUNDLE_THRESHOLD = 8;

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
      else if (entry.isFile()) out.push({ file: full, key, rel: path.relative(ROOT, full) });
    }
  }
  for (const [prefix, dir] of MAPPINGS) await walk(path.join(ROOT, dir), prefix);
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

/** Runs fn over items with bounded parallelism; throws on the first failure. */
export async function pool(items, fn, limit = CONCURRENCY) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export async function readManifest(driver) {
  const buf = await driver.getBuffer(MANIFEST_KEY);
  return buf ? JSON.parse(buf.toString("utf8")) : null;
}

/** Picks the transport: S3 when API tokens exist, otherwise the authenticated `cf` CLI. */
export async function createDriver() {
  const { CLOUDFLARE_ACCOUNT_ID: acc, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret } =
    process.env;
  if (process.env.R2_DRIVER !== "cf" && acc && id && secret) return createS3Driver(acc, id, secret);
  try {
    await run("cf", ["--version"]);
  } catch {
    throw new Error(
      "No R2 transport available. Install `cf` (npm i -g cf@latest) and run `cf auth login`, " +
        "or set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
    );
  }
  return createCfDriver();
}

function createCfDriver() {
  const base = ["--bucket-name", BUCKET];
  const cf = (args, opts = {}) =>
    run("cf", args, { maxBuffer: 512 * 1024 * 1024, encoding: "buffer", ...opts });
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
      await cf(["r2", "objects", "put", key, ...base, "--file", file, "--content-type", contentTypeFor(file), "-q"]);
    },
    async deleteMany(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        await cf(["r2", "objects", "bulk-delete", ...base, "--body", JSON.stringify(keys.slice(i, i + 1000)), "-q"]);
      }
    },
  };
}

async function createS3Driver(accountId, accessKeyId, secretAccessKey) {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    name: "s3",
    async getBuffer(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
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
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
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
  const { stdout } = await run("tar", ["-tzf", bundleFile], { maxBuffer: 64 * 1024 * 1024 });
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
