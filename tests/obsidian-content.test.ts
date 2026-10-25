import { afterEach, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/obsidian-content.mjs", import.meta.url),
);
const devProd = fileURLToPath(
  new URL("../scripts/dev-prod.mjs", import.meta.url),
);
const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidian-stage-"));
  scratch.push(root);
  const vault = path.join(root, "vault");
  const site = path.join(root, "site");
  await mkdir(vault);
  await mkdir(site);
  return { root, vault, site };
}
async function put(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
function run(site: string, vault?: string) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script], {
    cwd: site,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      ...(vault ? { OBSIDIAN_VAULT_PATH: vault } : {}),
    },
  });
  return { status, stdout, stderr };
}

test("optional staging is offline, incremental, and maps only supported editorial inputs", async () => {
  const { site, vault } = await fixture();
  await put(vault, "content/posts/en/a.md", "---\ntitle: A\n---\nbody\n");
  await put(vault, "content/posts/es/a.mdx", "---\ntitle: A\n---\nbody\n");
  await put(vault, "assets/cover.png", "image");
  await put(vault, "downloads/CV.pdf", "pdf");
  await put(vault, "notes/private.md", "private");
  expect(run(site)).toEqual({
    status: 0,
    stdout: "[obsidian] No vault configured; skipping.\n",
    stderr: "",
  });
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 4 changed file(s), 0 unchanged, 0 unpublished; no remote operations.\n",
    stderr: "",
  });
  expect(
    await readFile(path.join(site, "src/content/posts/en/a.md"), "utf8"),
  ).toContain("body");
  expect(
    await readFile(path.join(site, "public/remote-assets/cover.png"), "utf8"),
  ).toBe("image");
  expect(
    await readFile(path.join(site, "public/downloads/CV.pdf"), "utf8"),
  ).toBe("pdf");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 0 changed file(s), 4 unchanged, 0 unpublished; no remote operations.\n",
    stderr: "",
  });
  await put(vault, "content/posts/en/a.md", "---\ntitle: A\n---\nupdated\n");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 1 changed file(s), 3 unchanged, 0 unpublished; no remote operations.\n",
    stderr: "",
  });
  expect(
    await readFile(path.join(site, "src/content/posts/en/a.md"), "utf8"),
  ).toContain("updated");
});

test("drafts and hidden files are not staged, existing local and remote-only files survive", async () => {
  const { site, vault } = await fixture();
  await put(
    vault,
    "content/posts/en/draft.md",
    "---\ndraft: true\n---\nsecret\n",
  );
  await put(
    vault,
    "content/posts/en/hidden.md",
    "---\nvisible: false\n---\nsecret\n",
  );
  await put(
    vault,
    "content/posts/en/quoted.md",
    "---\ndraft: 'true'\n---\nsecret\n",
  );
  await put(
    vault,
    "content/posts/en/commented.md",
    "---\nvisible: false # private\n---\nsecret\n",
  );
  await put(vault, "content/posts/en/_private.md", "secret");
  await put(
    vault,
    "content/posts/en/public.md",
    "---\ndraft: false\n---\npublic\n",
  );
  await put(site, "src/content/posts/en/remote-only.md", "keep");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 1 changed file(s), 0 unchanged, 5 unpublished; no remote operations.\n",
    stderr: "",
  });
  expect(
    await readFile(
      path.join(site, "src/content/posts/en/remote-only.md"),
      "utf8",
    ),
  ).toBe("keep");
  expect(
    await readFile(path.join(site, "src/content/posts/en/public.md"), "utf8"),
  ).toContain("public");
  await expect(
    readFile(path.join(site, "src/content/posts/en/draft.md")),
  ).rejects.toThrow();
});

test("commented YAML visibility retires only an unchanged owned copy after backup", async () => {
  const { site, vault } = await fixture();
  const rel = "content/posts/en/a.md";
  const local = path.join(site, "src/content/posts/en/a.md");
  await put(vault, rel, "---\ntitle: A\n---\npublic\n");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 1 changed file(s), 0 unchanged, 0 unpublished; no remote operations.\n",
    stderr: "",
  });
  await put(vault, rel, "---\ndraft: true # comment\n---\nprivate\n");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 0 changed file(s), 0 unchanged, 1 unpublished, 1 retired; no remote operations.\n",
    stderr: "",
  });
  await expect(readFile(local)).rejects.toThrow();
  const backups = await readdir(
    path.join(site, ".cache/obsidian-stage-backups"),
  );
  expect(backups).toHaveLength(1);
  expect(
    await readFile(
      path.join(site, ".cache/obsidian-stage-backups", backups[0]),
      "utf8",
    ),
  ).toBe("---\ntitle: A\n---\npublic\n");
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 0 changed file(s), 0 unchanged, 1 unpublished; no remote operations.\n",
    stderr: "",
  });
});

test("removal retires owned copy but leaves remote-only content intact", async () => {
  const { site, vault } = await fixture();
  await put(vault, "content/posts/en/a.md", "public");
  await put(site, "src/content/posts/en/remote.md", "remote");
  expect(run(site, vault).status).toBe(0);
  await unlink(path.join(vault, "content/posts/en/a.md"));
  expect(run(site, vault)).toEqual({
    status: 0,
    stdout:
      "[obsidian] Staged 0 changed file(s), 0 unchanged, 0 unpublished, 1 retired; no remote operations.\n",
    stderr: "",
  });
  await expect(
    readFile(path.join(site, "src/content/posts/en/a.md")),
  ).rejects.toThrow();
  expect(
    await readFile(path.join(site, "src/content/posts/en/remote.md"), "utf8"),
  ).toBe("remote");
  expect(
    (await readdir(path.join(site, ".cache/obsidian-stage-backups"))).length,
  ).toBe(1);
});

test("local edits conflict before any retirement, staging, backup or journal change", async () => {
  const { site, vault } = await fixture();
  await put(vault, "content/posts/en/a.md", "first");
  expect(run(site, vault).status).toBe(0);
  await put(site, "src/content/posts/en/a.md", "local edit");
  await unlink(path.join(vault, "content/posts/en/a.md"));
  await put(vault, "content/posts/en/b.md", "new");
  const journal = path.join(site, ".cache/obsidian-stage.json");
  const before = await readFile(journal, "utf8");
  expect(run(site, vault)).toEqual({
    status: 1,
    stdout: "",
    stderr: "[obsidian] Error: Local staging conflict: content/posts/en/a.md\n",
  });
  expect(await readFile(journal, "utf8")).toBe(before);
  expect(
    await readFile(path.join(site, "src/content/posts/en/a.md"), "utf8"),
  ).toBe("local edit");
  await expect(
    readFile(path.join(site, "src/content/posts/en/b.md")),
  ).rejects.toThrow();
  await expect(
    readdir(path.join(site, ".cache/obsidian-stage-backups")),
  ).rejects.toThrow();
});

test("changed vault source cannot overwrite a locally edited owned file", async () => {
  const { site, vault } = await fixture();
  await put(vault, "content/posts/en/a.md", "first");
  expect(run(site, vault).status).toBe(0);
  await put(site, "src/content/posts/en/a.md", "local edit");
  await put(vault, "content/posts/en/a.md", "vault edit");
  const journal = path.join(site, ".cache/obsidian-stage.json");
  const before = await readFile(journal, "utf8");
  expect(run(site, vault)).toEqual({
    status: 1,
    stdout: "",
    stderr: "[obsidian] Error: Local staging conflict: content/posts/en/a.md\n",
  });
  expect(await readFile(journal, "utf8")).toBe(before);
  expect(
    await readFile(path.join(site, "src/content/posts/en/a.md"), "utf8"),
  ).toBe("local edit");
});

test("symlinks in vault fail closed before copying any content", async () => {
  const { site, vault, root } = await fixture();
  await put(vault, "content/posts/en/a.md", "safe");
  await put(root, "outside.md", "secret");
  await symlink(
    path.join(root, "outside.md"),
    path.join(vault, "content/posts/en/z.md"),
  );
  expect(run(site, vault)).toEqual({
    status: 1,
    stdout: "",
    stderr: "[obsidian] Error: Symlink in vault: content/posts/en/z.md\n",
  });
  await expect(
    readFile(path.join(site, "src/content/posts/en/a.md")),
  ).rejects.toThrow();
});

test("dev-prod without vault retains its existing offline Wrangler invocation", async () => {
  const { site } = await fixture();
  const bin = path.join(site, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "pnpm"),
    "#!/bin/sh\nprintf 'pnpm:%s\\n' \"$*\"\nprintf 'local:%s\\n' \"$SITE_LOCAL_BUILD\"\n",
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [devProd, "--env", "local"], {
    cwd: site,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  expect({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }).toEqual({
    status: 0,
    stdout: "pnpm:exec wrangler dev -c wrangler.jsonc --env local\nlocal:1\n",
    stderr: "",
  });
});

test("missing configured vault fails without invoking R2 or modifying local content", async () => {
  const { site, root } = await fixture();
  await put(site, "src/content/posts/en/a.md", "keep");
  expect(run(site, path.join(root, "missing"))).toEqual({
    status: 1,
    stdout: "",
    stderr: "[obsidian] Error: Vault must be an existing directory.\n",
  });
  expect(
    await readFile(path.join(site, "src/content/posts/en/a.md"), "utf8"),
  ).toBe("keep");
});
