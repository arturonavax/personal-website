// Shared helpers for syncing editorial content with Cloudflare R2.
//
// Bucket layout (scalable, one prefix per concern):
//   content/<collection>/<locale>/<file>   <-> src/content/<collection>/<locale>/<file>
//   assets/<path>                          <-> public/remote-assets/<path>
//   resume/CV.pdf                          <-> public/CV.pdf
//   _manifest.json                         index of every synced object (key, size, sha256)
//
// Two interchangeable transports:
//   - "s3":       @aws-sdk/client-s3 with R2 S3 API tokens (CI / Workers Builds).
//   - "wrangler": the locally authenticated Wrangler CLI (OAuth). No secrets on disk.
// R2 is only ever touched at build/dev time, never on incoming HTTP requests.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const ROOT = process.cwd();
export const BUCKET = process.env.R2_BUCKET_NAME || "personal-website-content";
export const MANIFEST_KEY = "_manifest.json";

const WRANGLER_BIN = path.join(ROOT, "node_modules/.bin/wrangler");

export const MIME_MAP = {
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/mdx; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

/** key -> local path, or null when the key is not mapped (or tries to escape). */
export function resolveLocalPath(key) {
  if (key === "resume/CV.pdf") return path.join(ROOT, "public/CV.pdf");
  const mappings = [
    ["content/", "src/content"],
    ["assets/", "public/remote-assets"],
  ];
  for (const [prefix, dir] of mappings) {
    if (!key.startsWith(prefix)) continue;
    const base = path.join(ROOT, dir);
    const target = path.resolve(base, key.slice(prefix.length));
    return target.startsWith(base + path.sep) ? target : null;
  }
  return null;
}

/** Local files that belong in R2: [{ file, key }]. */
export async function collectLocalFiles() {
  const out = [];
  async function walk(dir, prefix) {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const full = path.join(dir, entry.name);
      const key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(full, key);
      else if (entry.isFile()) out.push({ file: full, key });
    }
  }
  await walk(path.join(ROOT, "src/content"), "content");
  await walk(path.join(ROOT, "public/remote-assets"), "assets");
  const cv = path.join(ROOT, "public/CV.pdf");
  if (existsSync(cv)) out.push({ file: cv, key: "resume/CV.pdf" });
  return out;
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

export function contentTypeFor(file) {
  return MIME_MAP[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/** Chooses the transport: S3 when API tokens exist, otherwise authenticated Wrangler. */
export async function createDriver() {
  const { CLOUDFLARE_ACCOUNT_ID: acc, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret } =
    process.env;
  const forced = process.env.R2_DRIVER;
  if (forced !== "wrangler" && acc && id && secret) return createS3Driver(acc, id, secret);
  if (!existsSync(WRANGLER_BIN)) {
    throw new Error("No R2 transport: set R2 S3 credentials or install wrangler.");
  }
  return createWranglerDriver();
}

async function createS3Driver(accountId, accessKeyId, secretAccessKey) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } =
    await import("@aws-sdk/client-s3");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    name: "s3",
    async list() {
      const keys = [];
      let token;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) {
          if (o.Key && !o.Key.endsWith("/") && o.Key !== MANIFEST_KEY) keys.push(o.Key);
        }
        token = res.NextContinuationToken;
      } while (token);
      return keys;
    },
    async get(key, target) {
      await mkdir(path.dirname(target), { recursive: true });
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      await pipeline(res.Body, createWriteStream(target));
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
  };
}

function createWranglerDriver() {
  const wr = (args) =>
    run(WRANGLER_BIN, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, env: process.env });
  return {
    name: "wrangler",
    // Wrangler has no `r2 object list`; the manifest written by `push` is the index.
    async list() {
      const dir = await mkdtemp(path.join(tmpdir(), "r2-manifest-"));
      const file = path.join(dir, "manifest.json");
      try {
        await wr(["r2", "object", "get", `${BUCKET}/${MANIFEST_KEY}`, "--remote", "--file", file]);
        const manifest = JSON.parse(await readFile(file, "utf8"));
        return manifest.files.map((f) => f.key);
      } catch {
        return [];
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async get(key, target) {
      await mkdir(path.dirname(target), { recursive: true });
      await wr(["r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--file", target]);
    },
    async put(key, file) {
      await wr([
        "r2", "object", "put", `${BUCKET}/${key}`,
        "--remote", "--file", file, "--content-type", contentTypeFor(file),
      ]);
    },
  };
}

export async function fileInfo(file) {
  return { size: (await stat(file)).size, sha256: await sha256File(file) };
}
