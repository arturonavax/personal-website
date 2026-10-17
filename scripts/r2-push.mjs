// Push locally authored editorial content (posts, assets, CV.pdf) to Cloudflare R2.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "personal-website-content";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("[sync:push] Missing Cloudflare R2 credentials in environment.");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const MIME_MAP = {
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/mdx; charset=utf-8",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

async function uploadFile(filePath, r2Key) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || "application/octet-stream";
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: r2Key,
      Body: await readFile(filePath),
      ContentType: contentType,
    }),
  );
  console.log(`[sync:push] Uploaded: ${r2Key} (${contentType})`);
}

async function walkAndUpload(dir, prefix) {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const remoteKey = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await walkAndUpload(fullPath, remoteKey);
    else await uploadFile(fullPath, remoteKey);
  }
}

async function pushAll() {
  console.log("[sync:push] Starting upload to Cloudflare R2...");
  await walkAndUpload(path.join(process.cwd(), "src/content/posts"), "posts");
  await walkAndUpload(
    path.join(process.cwd(), "public/remote-assets"),
    "assets",
  );
  const cvPath = path.join(process.cwd(), "public/CV.pdf");
  if (existsSync(cvPath)) await uploadFile(cvPath, "resume/CV.pdf");
  console.log("[sync:push] Content push completed successfully.");
}

pushAll().catch((err) => {
  console.error("[sync:push] Error pushing to R2:", err);
  process.exit(1);
});
