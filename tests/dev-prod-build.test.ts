import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { wranglerBuildSteps } from "../scripts/wrangler-build.mjs";

describe("production-like local development", () => {
  it("builds existing content once without pull hooks in explicit local mode", () => {
    const steps = wranglerBuildSteps(true);
    expect(steps).toEqual([
      [process.execPath, "node_modules/astro/bin/astro.mjs", "build"],
      [process.execPath, "scripts/isolate-admin-build.mjs"],
    ]);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["dev-prod"]).toContain("--ip 0.0.0.0");
    expect(pkg.scripts["dev-prod"]).toContain("SITE_LOCAL_BUILD=1");
    expect(pkg.scripts["dev-prod"]).toContain("--env local --local");
    expect(pkg.scripts["dev-prod"]).not.toContain("pnpm build");
    expect(pkg.scripts["preview:local"]).toBeUndefined();
    const config = readFileSync("wrangler.jsonc", "utf8");
    const local = config.slice(config.indexOf('"env":'));
    expect(local).not.toContain('"ai":');
    expect(local).not.toContain('"vectorize":');
    expect(local).toContain('"remote": false');
    expect(local).toContain('"REQUIRE_ADMIN_AUTH": "true"');
  });
  it("retains content hydration and package build for deployment", () => {
    expect(wranglerBuildSteps(false)).toEqual([
      [process.execPath, "scripts/r2-pull.mjs"],
      ["pnpm", "run", "build"],
    ]);
    expect(readFileSync("wrangler.jsonc", "utf8")).toContain(
      '"command": "node scripts/wrangler-build.mjs"',
    );
  });
});
