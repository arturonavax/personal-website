// Incremental push of local content to Cloudflare R2: uploads only files whose sha256 changed.
//   node scripts/r2-push.mjs             upload changes, refresh manifest + bundle
//   node scripts/r2-push.mjs --dry-run   show the plan only
//   node scripts/r2-push.mjs --prune     also delete R2 objects that no longer exist locally
// Without --prune, remote-only objects are preserved (safe from machines with partial content).
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUCKET,
  BUNDLE_KEY,
  CONCURRENCY,
  MANIFEST_KEY,
  REMOTE_MANIFEST_KEY,
  MANIFEST_V2_KEY,
  buildLocalManifestV2,
  collectLocalFiles,
  computeRemoteManifestDiff,
  createBundle,
  createDriver,
  gcObsoleteBundles,
  pool,
  pruneOrphanRemoteKeys,
  readManifest,
  sha256File,
  writeLocalManifestCache,
} from "./lib/r2-content.mjs";

export async function runR2Push(options = {}) {
  const args = new Set(process.argv.slice(2));
  const dryRun = options.dryRun ?? args.has("--dry-run");
  const prune = options.prune ?? args.has("--prune");
  const t0 = Date.now();
  const local = options.localFiles ?? (await collectLocalFiles());
  if (local.length === 0) throw new Error("No local content to push.");
  await pool(
    local,
    async (f) => {
      if (!f.sha256) f.sha256 = await sha256File(f.file);
      if (f.size === undefined) f.size = (await stat(f.file)).size;
    },
    CONCURRENCY,
  );

  const localManifest = buildLocalManifestV2(local);
  const driver = dryRun ? null : (options.driver ?? (await createDriver()));
  const remote = dryRun ? null : await readManifest(driver);
  const previousBundleKey = remote?.bundleKey || remote?.bundle?.key || null;
  const remoteMap = new Map((remote?.files ?? []).map((f) => [f.key, f]));
  const { toUpload: changed, orphanRemoteKeys: remoteOnly } =
    computeRemoteManifestDiff(local, remote);
  const toDelete = prune ? remoteOnly : [];

  console.log(
    `[sync:push] bucket=${BUCKET} transport=${driver?.name ?? "n/a"} local=${local.length} changed=${changed.length} remote-only=${remoteOnly.length}${prune ? " (will delete)" : ""}`,
  );
  if (dryRun) {
    for (const f of local)
      console.log(`[sync:push] (dry-run) ${f.key} ${f.size}B`);
    console.log(
      "[sync:push] Dry run: remote state not queried, nothing uploaded.",
    );
    return {
      skipped: true,
      dryRun: true,
      uploaded: 0,
      deleted: 0,
      rootHash: localManifest.rootHash,
    };
  }

  if (
    remote &&
    ((remote.rootHash === localManifest.rootHash && !prune) ||
      (changed.length === 0 && toDelete.length === 0))
  ) {
    await writeLocalManifestCache(remote);
    console.log(
      `[sync:push] All ${local.length} files match remote SHA-256 manifest rootHash=${localManifest.rootHash.slice(0, 12)} (0 Class A writes). Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`,
    );
    return {
      skipped: true,
      uploaded: 0,
      deleted: 0,
      rootHash: localManifest.rootHash,
    };
  }

  const mergedFiles = [
    ...local.map(({ key, size, sha256 }) => ({ key, size, sha256 })),
  ];
  if (!prune) for (const k of remoteOnly) mergedFiles.push(remoteMap.get(k));
  const manifest = buildLocalManifestV2(mergedFiles);

  await pool(
    changed,
    async (f) => {
      await driver.put(f.key, f.file);
      console.log(`[sync:push] uploaded ${f.key}`);
    },
    CONCURRENCY,
  );
  if (toDelete.length) {
    const pruneRes = await pruneOrphanRemoteKeys(toDelete, { driver, dryRun });
    console.log(`[sync:push] deleted ${pruneRes.deleted} remote objects`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), "r2-push-"));
  try {
    // The bundle must mirror the manifest exactly, so it is skipped when remote-only
    // entries (not present locally) are retained.
    const bundleComplete = remoteOnly.length === 0 || prune;
    const needsBundle =
      changed.length > 0 || toDelete.length > 0 || !remote?.bundle;
    if (bundleComplete && needsBundle) {
      const bundleFile = path.join(dir, "bundle.tar.gz");
      await createBundle(
        local.map((f) => f.rel),
        bundleFile,
      );
      await driver.put(manifest.bundleKey, bundleFile);
      await driver.put(BUNDLE_KEY, bundleFile);
      manifest.bundle = {
        key: manifest.bundleKey,
        legacyKey: BUNDLE_KEY,
        size: (await stat(bundleFile)).size,
        sha256: await sha256File(bundleFile),
      };
      console.log(
        `[sync:push] bundle refreshed (${(manifest.bundle.size / 1024).toFixed(0)} KB -> ${manifest.bundleKey})`,
      );
    } else if (bundleComplete && remote?.bundle) {
      manifest.bundle = remote.bundle;
    } else {
      console.warn(
        "[sync:push] Remote-only objects retained: bundle omitted (run pull, then push, to rebuild it).",
      );
    }
    const manifestFile = path.join(dir, MANIFEST_KEY);
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await driver.put(MANIFEST_V2_KEY, manifestFile);
    await driver.put(REMOTE_MANIFEST_KEY, manifestFile);
    await driver.put(MANIFEST_KEY, manifestFile);
    await writeLocalManifestCache(manifest);
    if (!dryRun && driver) {
      await gcObsoleteBundles(driver, manifest.bundleKey, previousBundleKey);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const notifyIndexNowFlag =
    args.has("--notify-indexnow") || options.notifyIndexNow === true;
  if ((changed.length > 0 || notifyIndexNowFlag) && !dryRun) {
    await notifyIndexNow(changed, options);
  }

  console.log(`[sync:push] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  return {
    skipped: false,
    uploaded: changed.length,
    deleted: toDelete.length,
    rootHash: manifest.rootHash,
  };
}

/**
 * Automatically notifies IndexNow (Bing, Yandex, Naver, Seznam, Copilot/ChatGPT Search)
 * of newly published or modified content routes (TASK SEO-5).
 */
export async function notifyIndexNow(changedKeys = [], options = {}) {
  const key =
    options.key ||
    process.env.INDEXNOW_KEY ||
    "e3b0c44298fc1c149afbf4c8996fb924";
  const host = options.host || "arturonavax.dev";
  const dryRun = options.dryRun === true;
  const fetchFn = options.fetchFn || globalThis.fetch;

  if (!key) {
    console.log(
      "[indexnow] INDEXNOW_KEY not set; skipping search engine push.",
    );
    return { skipped: true, reason: "missing_key" };
  }

  if (key === "e3b0c44298fc1c149afbf4c8996fb924") {
    console.warn(
      "[indexnow] WARNING: INDEXNOW_KEY is set to placeholder hash (e3b0c44298fc1c149afbf4c8996fb924); skipping search engine notification.",
    );
    return { ok: false, skipped: true, reason: "placeholder_key" };
  }

  const rawKeys = Array.isArray(changedKeys)
    ? changedKeys.map((k) =>
        typeof k === "string" ? k : k?.key || k?.rel || "",
      )
    : [];

  const urlSet = new Set();
  const baseUrl = `https://${host}`;

  // Always include canonical roots on indexnow push
  urlSet.add(`${baseUrl}/`);
  urlSet.add(`${baseUrl}/es/`);

  for (const raw of rawKeys) {
    const normalized = raw.replace(/^[./\\]+/, "");
    // Check for blog / posts
    const postMatch = normalized.match(
      /(?:content\/)?posts\/(en|es)\/([^/.]+)\.(?:md|mdx)/i,
    );
    if (postMatch) {
      const slug = postMatch[2];
      urlSet.add(`${baseUrl}/blog/${slug}/`);
      urlSet.add(`${baseUrl}/es/blog/${slug}/`);
      continue;
    }

    // Projects
    const projMatch = normalized.match(
      /(?:content\/)?projects\/(en|es)\/([^/.]+)\.md/i,
    );
    if (projMatch) {
      const slug = projMatch[2];
      urlSet.add(`${baseUrl}/projects/${slug}/`);
      urlSet.add(`${baseUrl}/es/projects/${slug}/`);
      continue;
    }

    // Services
    const servMatch = normalized.match(
      /(?:content\/)?services\/(en|es)\/([^/.]+)\.md/i,
    );
    if (servMatch) {
      const slug = servMatch[2];
      urlSet.add(`${baseUrl}/services/${slug}/`);
      urlSet.add(`${baseUrl}/es/services/${slug}/`);
      continue;
    }

    // Experience
    const expMatch = normalized.match(
      /(?:content\/)?experience\/(en|es)\/([^/.]+)\.md/i,
    );
    if (expMatch) {
      const slug = expMatch[2];
      urlSet.add(`${baseUrl}/experience/${slug}/`);
      urlSet.add(`${baseUrl}/es/experience/${slug}/`);
      continue;
    }

    // Resume
    if (/resume/i.test(normalized)) {
      urlSet.add(`${baseUrl}/resume/`);
      urlSet.add(`${baseUrl}/es/resume/`);
      continue;
    }
  }

  const urlList = Array.from(urlSet);
  const keyLocation = `${baseUrl}/indexnow-key.txt`;
  const payload = {
    host,
    key,
    keyLocation,
    urlList,
  };

  console.log(
    `[indexnow] Preparing push for ${urlList.length} canonical URLs on host=${host} (key=${key.slice(0, 8)}...)`,
  );

  if (dryRun) {
    console.log("[indexnow] Dry run enabled; skipping POST request.");
    return {
      skipped: false,
      dryRun: true,
      host,
      key,
      keyLocation,
      urlList,
      payload,
    };
  }

  try {
    const res = await fetchFn("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const status = res.status;
    console.log(
      `[indexnow] Response HTTP ${status} for ${urlList.length} URLs.`,
    );
    return {
      skipped: false,
      status,
      ok: status >= 200 && status < 300,
      urlCount: urlList.length,
      urlList,
    };
  } catch (err) {
    console.warn(`[indexnow] Push warning (${err.message}); continuing.`);
    return {
      skipped: false,
      error: err.message,
      urlCount: urlList.length,
      urlList,
    };
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runR2Push().catch((err) => {
    console.error("[sync:push] Error:", err.message ?? err);
    process.exit(1);
  });
}
