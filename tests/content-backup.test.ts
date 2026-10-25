import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/content-backup.mjs", import.meta.url),
);
const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function site() {
  const root = await mkdtemp(path.join(tmpdir(), "website-backup-test-"));
  scratch.push(root);
  return root;
}
async function put(root: string, rel: string, bytes: string) {
  const target = path.join(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
function run(root: string, args: string[] = []) {
  const result = spawnSync("node", [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
const sha = (data: string) => createHash("sha256").update(data).digest("hex");

test("backs up only mapped files with portable paths, content hashes and private permissions", async () => {
  const root = await site();
  const inputs = [
    ["src/content/posts/en/a.md", "post"],
    ["public/remote-assets/cover.png", "image"],
    ["public/downloads/cv.pdf", "pdf"],
  ];
  for (const [rel, bytes] of inputs) await put(root, rel, bytes);
  await put(root, "src/content/posts/en/_draft.md", "private");
  await put(root, "src/content/posts/en/.hidden.md", "hidden");
  await put(root, "notes.md", "unmapped");
  await put(root, ".env", "secret");
  const result = run(root);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const archives = await readdir(path.join(root, ".cache/backups"));
  expect(archives).toHaveLength(1);
  const archive = path.join(root, ".cache/backups", archives[0]);
  expect(archives[0]).toMatch(/^website-content-[a-f0-9]{16}\.tar\.gz$/);
  expect(result.stdout).toBe(
    `[backup] Created .cache/backups/${archives[0]} (3 files); local only.\n`,
  );
  expect((await stat(archive)).mode & 0o777).toBe(0o600);
  expect((await stat(path.dirname(archive))).mode & 0o777).toBe(0o700);
  const entries = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  expect({
    status: entries.status,
    stderr: entries.stderr,
    stdout: entries.stdout,
  }).toEqual({
    status: 0,
    stderr: "",
    stdout:
      [
        "public/remote-assets/cover.png",
        "src/content/posts/en/a.md",
        "public/downloads/cv.pdf",
        "backup-manifest.json",
      ].join("\n") + "\n",
  });
  for (const [rel, bytes] of inputs) {
    const data = spawnSync("tar", ["-xOzf", archive, rel], {
      encoding: "utf8",
    });
    expect({
      status: data.status,
      stdout: data.stdout,
      stderr: data.stderr,
    }).toEqual({ status: 0, stdout: bytes, stderr: "" });
  }
  const manifestResult = spawnSync(
    "tar",
    ["-xOzf", archive, "backup-manifest.json"],
    { encoding: "utf8" },
  );
  expect(manifestResult.status).toBe(0);
  const manifest = JSON.parse(manifestResult.stdout);
  expect(manifest.version).toBe(1);
  expect(manifest.files).toEqual([
    {
      key: "assets/cover.png",
      path: "public/remote-assets/cover.png",
      size: 5,
      sha256: sha("image"),
    },
    {
      key: "content/posts/en/a.md",
      path: "src/content/posts/en/a.md",
      size: 4,
      sha256: sha("post"),
    },
    {
      key: "downloads/cv.pdf",
      path: "public/downloads/cv.pdf",
      size: 3,
      sha256: sha("pdf"),
    },
  ]);
  expect(manifest.rootHash).toBe(
    sha(
      manifest.files
        .map((f: { key: string; sha256: string }) => `${f.key}:${f.sha256}`)
        .sort()
        .join("\n"),
    ),
  );
});

test("empty input and invalid arguments fail without creating an archive directory", async () => {
  const root = await site();
  expect(run(root)).toEqual({
    status: 1,
    stdout: "",
    stderr: "[backup] Error: No mapped local files to back up.\n",
  });
  expect(run(root, ["--upload"])).toEqual({
    status: 1,
    stdout: "",
    stderr:
      "[backup] Error: Usage: node scripts/content-backup.mjs (no arguments)\n",
  });
  await expect(readdir(path.join(root, ".cache"))).rejects.toThrow();
});

test("never clobbers a previous backup or changes its bytes", async () => {
  const root = await site();
  await put(root, "src/content/posts/en/a.md", "post");
  expect(run(root).status).toBe(0);
  const [name] = await readdir(path.join(root, ".cache/backups"));
  const archive = path.join(root, ".cache/backups", name);
  const original = await readFile(archive);
  expect(run(root)).toEqual({
    status: 1,
    stdout: "",
    stderr: `[backup] Error: Backup already exists: .cache/backups/${name}\n`,
  });
  expect(await readFile(archive)).toEqual(original);
  expect(await readdir(path.dirname(archive))).toEqual([name]);
});

test("rejects mapped directory symlinks before writing any output", async () => {
  const root = await site();
  await put(root, "outside/a.md", "private");
  await mkdir(path.join(root, "src"));
  await symlink(path.join(root, "outside"), path.join(root, "src/content"));
  await put(root, "public/downloads/cv.pdf", "pdf");
  const result = run(root);
  expect(result).toEqual({
    status: 1,
    stdout: "",
    stderr: "[backup] Error: Unsafe mapped path: src/content\n",
  });
  expect(await readFile(path.join(root, "outside/a.md"), "utf8")).toBe(
    "private",
  );
  expect(
    await readFile(path.join(root, "public/downloads/cv.pdf"), "utf8"),
  ).toBe("pdf");
  await expect(readdir(path.join(root, ".cache"))).rejects.toThrow();
});

test("rejects a nested mapped directory symlink skipped by the collector", async () => {
  const root = await site();
  await put(root, "outside/a.md", "private");
  await put(root, "src/content/posts/en/a.md", "post");
  await symlink(
    path.join(root, "outside"),
    path.join(root, "src/content/posts/linked"),
  );
  expect(run(root)).toEqual({
    status: 1,
    stdout: "",
    stderr: "[backup] Error: Unsafe mapped path: src/content/posts/linked\n",
  });
  expect(await readFile(path.join(root, "outside/a.md"), "utf8")).toBe(
    "private",
  );
  expect(
    await readFile(path.join(root, "src/content/posts/en/a.md"), "utf8"),
  ).toBe("post");
  await expect(readdir(path.join(root, ".cache"))).rejects.toThrow();
});

test("rejects an existing non-private backup directory without altering it", async () => {
  const root = await site();
  await put(root, "src/content/posts/en/a.md", "post");
  await put(root, ".cache/backups/keep.txt", "existing");
  const output = path.join(root, ".cache/backups");
  await chmod(output, 0o755);
  expect(run(root)).toEqual({
    status: 1,
    stdout: "",
    stderr:
      "[backup] Error: Unsafe backup directory permissions: .cache/backups (expected 0700)\n",
  });
  expect((await stat(output)).mode & 0o777).toBe(0o755);
  expect(await readdir(output)).toEqual(["keep.txt"]);
  expect(await readFile(path.join(output, "keep.txt"), "utf8")).toBe(
    "existing",
  );
  expect(
    await readFile(path.join(root, "src/content/posts/en/a.md"), "utf8"),
  ).toBe("post");
});
