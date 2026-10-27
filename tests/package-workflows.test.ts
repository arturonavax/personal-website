import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// package.json is the public command inventory, not a package-manager log format.
const { scripts } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("public package workflow", () => {
  it("omits redundant and unsafe shortcut commands", () => {
    for (const name of [
      "typecheck",
      "format:check",
      "audit:mobile",
      "cf:disable-jsd",
      "db:reset:remote",
      "db:schema:remote",
    ]) {
      expect(Object.hasOwn(scripts, name)).toBe(false);
    }
  });

  it("retains the explicit build, offline development and publication paths", () => {
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
      expect(scripts[name]).toBe(command);
    }
    expect(scripts["dev-prod"]).toContain(
      "SITE_LOCAL_BUILD=1 node scripts/dev-prod.mjs --env local --local",
    );
  });
});
