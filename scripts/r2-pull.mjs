// Pull editorial content from Cloudflare R2 into the local (git-ignored) tree.
// Runs at build/dev time only. R2 is never queried at request time.
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "personal-website-content";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.warn(
    "[sync:pull] Cloudflare R2 credentials not found. Skipping remote fetch.",
  );
  process.exit(0);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const ROOT = process.cwd();

/** Maps an R2 object key to its local target path (or null if unmapped). */
function resolveLocalPath(key) {
  if (key === "resume/CV.pdf" || key === "CV.pdf") {
    return path.join(ROOT, "public/CV.pdf");
  }
  const mappings = [
    ["posts/", "src/content/posts"],
    ["assets/", "public/remote-assets"],
  ];
  for (const [prefix, dir] of mappings) {
    if (key.startsWith(prefix)) {
      const base = path.join(ROOT, dir);
      const target = path.resolve(base, key.slice(prefix.length));
      // Guard against path traversal through crafted keys.
      if (target !== base && target.startsWith(base + path.sep)) return target;
      return null;
    }
  }
  return null;
}

async function downloadKey(key, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
  );
  await pipeline(response.Body, createWriteStream(targetPath));
}

async function pullContent() {
  console.log("[sync:pull] Fetching remote content from R2...");
  let count = 0;
  let continuationToken;

  do {
    const { Contents = [], NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of Contents) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      const localPath = resolveLocalPath(item.Key);
      if (!localPath) continue;
      console.log(`[sync:pull] Downloading: ${item.Key} -> ${localPath}`);
      await downloadKey(item.Key, localPath);
      count++;
    }
    continuationToken = NextContinuationToken;
  } while (continuationToken);

  console.log(`[sync:pull] Synchronized ${count} files successfully.`);
}

pullContent().catch((err) => {
  console.error("[sync:pull] Error:", err);
  process.exit(1);
});
