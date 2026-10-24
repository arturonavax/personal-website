import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Local dev consumes existing content; deployment retains its hydration steps. */
export function wranglerBuildSteps(local) {
  if (process.env.SKIP_BUILD === "1") return [];
  return local
    ? [
        [process.execPath, "node_modules/astro/bin/astro.mjs", "build"],
        [process.execPath, "scripts/isolate-admin-build.mjs"],
      ]
    : [
        [process.execPath, "scripts/r2-pull.mjs"],
        ["pnpm", "run", "build"],
      ];
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const [command, ...args] of wranglerBuildSteps(
    process.env.SITE_LOCAL_BUILD === "1",
  )) {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
