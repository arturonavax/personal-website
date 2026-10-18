// Incremental pull of editorial content from Cloudflare R2 (build/dev time only).
//   node scripts/r2-pull.mjs                sync: download only files whose sha256 differs
//   node scripts/r2-pull.mjs --auto         sync if CONTENT_SOURCE=r2 or local content is missing
//   node scripts/r2-pull.mjs --prune        also delete local synced files that are not in R2
//   node scripts/r2-pull.mjs --force        re-download everything
// Many changed files (or a fresh machine) -> one bundle download instead of N requests.
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUCKET,
  BUNDLE_KEY,
  BUNDLE_THRESHOLD,
  CONCURRENCY,
  LOCAL_MANIFEST_CACHE_PATH,
  MANIFEST_V2_KEY,
  collectLocalFiles,
  computeRootHash,
  createDriver,
  extractBundle,
  isContentMissing,
  normalizeManifest,
  pool,
  readLocalManifestCache,
  readManifest,
  resolveLocalPath,
  sha256File,
  verifyContentHydration,
  writeLocalManifestCache,
} from "./lib/r2-content.mjs";

export { verifyContentHydration };

export async function runR2Pull(options = {}) {
  const args = new Set(process.argv.slice(2));
  const prune = options.prune ?? args.has("--prune");
  const force = options.force ?? args.has("--force");
  const auto = options.auto ?? args.has("--auto");
  const cachePath = options.cachePath || LOCAL_MANIFEST_CACHE_PATH;
  const shouldVerify = options.verifyHydration !== false;

  if (auto) {
    const isCI = Boolean(
      process.env.CI ||
      process.env.CF_PAGES ||
      process.env.CLOUDFLARE_BUILD ||
      process.env.GITHUB_ACTIONS,
    );
    const wantsR2 = process.env.CONTENT_SOURCE === "r2" || isCI;
    if (!wantsR2 && !(await isContentMissing())) {
      if (shouldVerify) {
        await verifyContentHydration(options);
      }
      console.log(
        "[sync:pull] Local content present (CONTENT_SOURCE != r2); skipping.",
      );
      return {
        skipped: true,
        reason: "local_content_present",
        getObjectCalls: 0,
        listObjectsCalls: 0,
        downloaded: 0,
      };
    }
    if (isCI) {
      console.log(
        "[sync:pull] CI/Cloudflare environment detected; pulling fresh content from R2.",
      );
    } else if (!wantsR2) {
      console.log("[sync:pull] Local content missing; pulling from R2.");
    }
  }

  const t0 = Date.now();
  const cached = await readLocalManifestCache(cachePath);
  const driver = options.driver ?? (await createDriver());
  let getObjectCalls = 0;
  const listObjectsCalls = 0;

  let manifest = null;
  const fetchManifestFn =
    typeof driver.getObject === "function"
      ? driver.getObject.bind(driver)
      : typeof driver.getJsonIfModified === "function"
        ? driver.getJsonIfModified.bind(driver)
        : null;
  if (fetchManifestFn) {
    getObjectCalls += 1;
    const res = await fetchManifestFn(MANIFEST_V2_KEY, {
      ifNoneMatch: cached?.etag || cached?.rootHash,
    });
    if (res?.status === 304 || res?.notModified === true) {
      console.log(
        "[sync:pull] 304 Not Modified on content/_manifest.v2.json (1 Class B op, 0 downloads).",
      );
      return {
        skipped: true,
        reason: "not_modified_304",
        getObjectCalls,
        listObjectsCalls,
        downloaded: 0,
        rootHash: cached?.rootHash,
      };
    }
    const payload = res?.data ?? res?.body;
    if (payload) {
      const parsed =
        typeof payload === "string"
          ? JSON.parse(payload)
          : Buffer.isBuffer(payload)
            ? JSON.parse(payload.toString("utf8"))
            : payload;
      manifest = normalizeManifest(parsed);
      if (res.etag && manifest) manifest.etag = res.etag;
    } else if (res && typeof res === "object" && (res.files || res.entries)) {
      manifest = normalizeManifest(res);
    }
  } else {
    getObjectCalls += 1;
    manifest = await readManifest(driver);
  }

  if (!manifest) {
    throw new Error(
      `No ${BUCKET}/${MANIFEST_V2_KEY} found. Run \`pnpm content:push\` from a machine that has the content.`,
    );
  }

  const remoteRootHash =
    manifest.rootHash || computeRootHash(manifest.files || manifest.entries);

  // Fast-path: if cached rootHash matches remote rootHash and local content exists (or trustCache is enabled),
  // exit immediately after the single GetObject(content/_manifest.v2.json) call (0 ListObjectsV2, 0 file downloads).
  if (
    !force &&
    cached &&
    cached.rootHash &&
    cached.rootHash === remoteRootHash &&
    (options.trustCache === true || !(await isContentMissing()))
  ) {
    console.log(
      `[sync:pull] rootHash=${remoteRootHash.slice(0, 12)} matches local cache (1 GetObject, 0 ListObjectsV2, 0 downloads).`,
    );
    return {
      skipped: true,
      reason: "root_hash_match",
      getObjectCalls,
      listObjectsCalls,
      downloaded: 0,
      rootHash: remoteRootHash,
    };
  }

  console.log(
    `[sync:pull] bucket=${BUCKET} transport=${driver.name ?? "custom"} files=${manifest.files.length} rootHash=${remoteRootHash.slice(0, 12)}`,
  );

  const outdated = async () => {
    const stale = [];
    await pool(
      manifest.files,
      async (f) => {
        const target = resolveLocalPath(f.key);
        if (!target) return;
        const same =
          !force &&
          existsSync(target) &&
          (await sha256File(target)) === f.sha256;
        if (!same) stale.push(f);
      },
      CONCURRENCY,
    );
    return stale;
  };

  let stale = await outdated();
  if (stale.length === 0) {
    await writeLocalManifestCache(manifest, cachePath);
    console.log("[sync:pull] Already up to date.");
    return {
      skipped: true,
      reason: "files_up_to_date",
      getObjectCalls,
      listObjectsCalls,
      downloaded: 0,
      rootHash: remoteRootHash,
    };
  }

  const bundleKeyToFetch =
    manifest.bundle?.key || manifest.bundleKey || BUNDLE_KEY;
  if (
    stale.length > BUNDLE_THRESHOLD &&
    (manifest.bundle || manifest.bundleKey)
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), "r2-bundle-"));
    const file = path.join(dir, "bundle.tar.gz");
    try {
      console.log(
        `[sync:pull] ${stale.length} files changed (> ${BUNDLE_THRESHOLD}) -> downloading bundle ${bundleKeyToFetch}`,
      );
      getObjectCalls += 1;
      try {
        await driver.getFile(bundleKeyToFetch, file);
      } catch {
        if (bundleKeyToFetch !== BUNDLE_KEY) {
          await driver.getFile(BUNDLE_KEY, file);
        } else {
          throw new Error("bundle download failed");
        }
      }
      if (
        manifest.bundle?.sha256 &&
        (await sha256File(file)) !== manifest.bundle.sha256
      ) {
        throw new Error("bundle checksum mismatch");
      }
      const n = await extractBundle(file);
      console.log(`[sync:pull] Extracted ${n} entries from bundle.`);
      stale = await outdated(); // anything the bundle did not cover
    } catch (err) {
      console.warn(
        `[sync:pull] Bundle unusable (${err.message}); falling back to per-file download.`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  let downloaded = 0;
  await pool(
    stale,
    async (f) => {
      const target = resolveLocalPath(f.key);
      getObjectCalls += 1;
      await driver.getFile(f.key, target);
      if ((await sha256File(target)) !== f.sha256)
        throw new Error(`Checksum mismatch for ${f.key}`);
      downloaded++;
      console.log(`[sync:pull] ${f.key}`);
    },
    CONCURRENCY,
  );

  if (prune) {
    const remote = new Set(manifest.files.map((f) => f.key));
    for (const { key, file } of await collectLocalFiles()) {
      if (!remote.has(key)) {
        await unlink(file);
        console.log(`[sync:pull] pruned local-only ${key}`);
      }
    }
  }
  await writeLocalManifestCache(manifest, cachePath);
  if (shouldVerify) {
    await verifyContentHydration(options);
  }
  console.log(
    `[sync:pull] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${downloaded} individual downloads).`,
  );
  return {
    skipped: false,
    getObjectCalls,
    listObjectsCalls,
    downloaded,
    rootHash: remoteRootHash,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runR2Pull().catch((err) => {
    console.error("[sync:pull] Error:", err.message ?? err);
    process.exit(1);
  });
}
