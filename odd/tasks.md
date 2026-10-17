# Tareas del Proyecto (ODD)

[] (Human) Rediseño total de el banner de About y Contact con Impecable skill.

[] (Human) Subir el PDF de mi CV a R2 y agregar boton de descarga a la pagina de /resume/

[x] El "Available for Senior" de el contenedor de Contact no se ajusta con responsive a pantallas pequeñas, arreglalo.

[x] Los botones flotantes como Index y Scroll Top deberian flotar por encima de la linea ocupada por el toast "Contenido disponible en", y cuando se cierre o ese toast ya no este... bajar a la posicion original.

[x] Migrar /resume/maker/ a /tools/resume-maker/, ya que /tools/ sera una pagina con todas las herramientas como /links y el creador de CV.

[x] Realiza toda esta tarea:

# PROMPT FOR AI CODING AGENT

## Objective

Implement a bidirectional Cloudflare R2 synchronization system for an Astro SSG site (astro:content, .md, .mdx) and integrate a static CV download in `/resume/`. All editorial content and assets must reside in Cloudflare R2 while remaining decoupled from Git.

---

## Architectural Requirements

1. **Zero Runtime Edge Overhead:** The site runs in static SSG mode (`output: 'static'`). Cloudflare R2 must NEVER be queried on incoming HTTP requests. Content is fetched strictly at build time and served as pre-rendered static assets via Cloudflare Pages / Workers Static Assets.
2. **Native .md and .mdx Support:** Astro compiles MDX through Vite. Content fetched from R2 must be placed directly into the local filesystem before `astro build` executes, allowing native Content Collections (`astro:content`) to parse frontmatter, components, and Markdown trees without memory compilation hacks.
3. **Git Isolation:** Synchronized directories must be ignored by Git so the repository contains only presentation logic and code.
4. **Bidirectional Workflow:**

* **Pull (R2 -> Local/CI):** Fetches posts, assets, and `CV.pdf` prior to building or developing locally.
* **Push (Local -> R2):** Uploads local additions or modifications from the ignored directory up to the Cloudflare R2 bucket.

1. **Static Resume Asset:** `CV.pdf` downloaded from R2 must be placed in `public/` so it is served statically at `/CV.pdf` with immediate TTFB and zero CLS.

---

## Step 1: Install AWS S3 SDK for Cloudflare R2

Add the lightweight AWS S3 client to `devDependencies`:

```

pnpm add -D @aws-sdk/client-s3

```

---

## Step 2: Environment Configuration

Ensure `.env` and Cloudflare build environment variables support R2 API access:

```

# Cloudflare R2 Credentials

CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"
R2_ACCESS_KEY_ID="your_r2_token_access_key"
R2_SECRET_ACCESS_KEY="your_r2_token_secret_key"
R2_BUCKET_NAME="personal-website-content"

```

---

## Step 3: Git Isolation Configuration

Update `.gitignore` to prevent synchronized content and downloaded binaries from being committed to the repository, while preserving directory placeholders if needed:

```

# Ignored remote content synced from R2

src/content/posts/**
!src/content/posts/.gitkeep
public/CV.pdf
public/remote-assets/**
!public/remote-assets/.gitkeep

```

---

## Step 4: R2 Synchronization Scripts

### A. Download Script: `scripts/r2-pull.mjs`

Create `scripts/r2-pull.mjs` to fetch files from R2 and map them to their local target paths:

* Keys starting with `posts/` -> `src/content/posts/`
* Key `resume/CV.pdf` or `CV.pdf` -> `public/CV.pdf`
* Keys starting with `assets/` -> `public/remote-assets/`
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'personal-website-content';
if (!accountId || !accessKeyId || !secretAccessKey) {
console.warn('[sync:pull] Cloudflare R2 credentials not found. Skipping remote fetch.');
process.exit(0);
}
const s3 = new S3Client({
region: 'auto',
endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
credentials: { accessKeyId, secretAccessKey },
});
async function downloadKey(key, targetPath) {
await mkdir(path.dirname(targetPath), { recursive: true });
const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
const response = await s3.send(command);
await pipeline(response.Body, createWriteStream(targetPath));
}
async function pullContent() {
console.log('[sync:pull] Fetching remote content from R2...');
const listCommand = new ListObjectsV2Command({ Bucket: bucketName });
const { Contents = [] } = await s3.send(listCommand);

```

let count = 0;
for (const item of Contents) {
  if (!item.Key || item.Key.endsWith('/')) continue;

  let localPath = null;
  if (item.Key.startsWith('posts/')) {
    localPath = path.join(process.cwd(), 'src/content/posts', item.Key.replace('posts/', ''));
  } else if (item.Key === 'resume/CV.pdf' || item.Key === 'CV.pdf') {
    localPath = path.join(process.cwd(), 'public/CV.pdf');
  } else if (item.Key.startsWith('assets/')) {
    localPath = path.join(process.cwd(), 'public/remote-assets', item.Key.replace('assets/', ''));
  }

  if (localPath) {
    console.log(`[sync:pull] Downloading: ${item.Key} -> ${localPath}`);
    await downloadKey(item.Key, localPath);
    count++;
  }
}
console.log(`[sync:pull] Synchronized ${count} files successfully.`);

```

}
pullContent().catch((err) => {
console.error('[sync:pull] Error:', err);
process.exit(1);
});

---

### B. Upload Script: `scripts/r2-push.mjs`

Create `scripts/r2-push.mjs` to upload locally authored `.md`, `.mdx`, images, and `CV.pdf` to the R2 bucket:

```

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'personal-website-content';

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('[sync:push] Missing Cloudflare R2 credentials in environment.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const MIME_MAP = {
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/mdx; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function uploadFile(filePath, r2Key) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  const fileBuffer = await readFile(filePath);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: r2Key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3.send(command);
  console.log(`[sync:push] Uploaded: ${r2Key} (${contentType})`);
}

async function walkAndUpload(dir, prefix) {
  if (!existsSync(dir)) return;
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '.gitkeep') continue;
    const fullPath = path.join(dir, entry.name);
    const remoteKey = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      await walkAndUpload(fullPath, remoteKey);
    } else {
      await uploadFile(fullPath, remoteKey);
    }
  }
}

async function pushAll() {
  console.log('[sync:push] Starting upload to Cloudflare R2...');
  
  // Upload Posts
  await walkAndUpload(path.join(process.cwd(), 'src/content/posts'), 'posts');
  
  // Upload Remote Assets
  await walkAndUpload(path.join(process.cwd(), 'public/remote-assets'), 'assets');

  // Upload CV.pdf if present locally in public
  const cvPath = path.join(process.cwd(), 'public/CV.pdf');
  if (existsSync(cvPath)) {
    await uploadFile(cvPath, 'resume/CV.pdf');
  }

  console.log('[sync:push] Content push completed successfully.');
}

pushAll().catch((err) => {
  console.error('[sync:push] Error pushing to R2:', err);
  process.exit(1);
});

```

---

## Step 5: `package.json` Integration

Update the `scripts` section in `package.json` to ensure automated synchronization before every build and local development session:

```

"scripts": {
  "dev": "node scripts/r2-pull.mjs && astro dev",
  "prebuild": "node scripts/r2-pull.mjs",
  "build": "astro build",
  "preview": "astro preview",
  "content:pull": "node scripts/r2-pull.mjs",
  "content:push": "node scripts/r2-push.mjs"
}

```

---

## Step 6: Resume Download Button in `/resume/`

In `src/pages/[...lang]/resume/index.astro` (or the existing `ResumeExportBar.astro` component), locate the download action and bind it directly to `/CV.pdf`:

```

<a
  href="/CV.pdf"
  download="ArturoNava-CV.pdf"
  target="_blank"
  rel="noopener noreferrer"
  class="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider text-neutral-200 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-neutral-400"
  aria-label="Download Arturo Nava Resume PDF"
>
  <svg
    class="w-4 h-4 shrink-0"
    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
  <span>Download CV (PDF)</span>
</a>

```

---

## Step 7: Cache Headers in `public/_headers`

Ensure `public/_headers` includes optimal caching and disposition rules for the static PDF:

```

/CV.pdf
  Cache-Control: public, max-age=3600, must-revalidate
  Content-Type: application/pdf
  X-Content-Type-Options: nosniff

```

---

## Verification Checklist

1. Running `pnpm content:pull` populates `src/content/posts/` and downloads `public/CV.pdf`.
2. Running `git status` shows no uncommitted Markdown, MDX, or PDF files.
3. Running `pnpm build` completes with zero errors, validating all schemas via Astro Content Collections.
4. Visiting `/resume/` and clicking the download button immediately serves `/CV.pdf` directly from the edge cache without hitting R2 runtime bindings.
5. Running `pnpm content:push` syncs any local edits back to R2.
