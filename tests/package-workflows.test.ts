import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function listedScripts() {
  const result = spawnSync("pnpm", ["run"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

describe("public package workflow", () => {
  it("omits redundant and unsafe shortcut commands", () => {
    const listing = listedScripts();
    for (const name of [
      "typecheck",
      "format:check",
      "audit:mobile",
      "cf:disable-jsd",
      "db:reset:remote",
      "db:schema:remote",
    ]) {
      expect(listing).not.toContain(`\n  ${name}\n`);
    }
  });

  it("retains the explicit build, offline development and publication paths", () => {
    const listing = listedScripts();
    for (const [name, command] of [
      ["format", "prettier --write ."],
      ["check", "astro check"],
      ["prebuild", "node scripts/r2-pull.mjs --auto"],
      ["build", "astro build && node scripts/isolate-admin-build.mjs"],
      ["predeploy", "node scripts/r2-pull.mjs && pnpm run build"],
      ["deploy", "wrangler deploy -c wrangler.jsonc"],
      ["content:push", "node scripts/r2-push.mjs"],
      ["content:push:dry", "node scripts/r2-push.mjs --dry-run"],
      ["content:backup", "node scripts/content-backup.mjs"],
      [
        "db:schema:local",
        "wrangler d1 execute personal-website-analytics --local --file=./cloudflare/d1/schema.sql",
      ],
    ]) {
      expect(listing).toContain(`\n  ${name}\n    ${command}\n`);
    }
    expect(listing).toContain(
      "SITE_LOCAL_BUILD=1 node scripts/dev-prod.mjs --env local --local",
    );
  });
});
