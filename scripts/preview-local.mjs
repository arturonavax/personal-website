import { fileURLToPath } from "node:url";
import { lstat } from "node:fs/promises";
import {
  LOCAL_PREVIEW_ENV,
  parsePreviewArguments,
  localPreviewSettings,
  assertPortAvailable,
  removeLocalPrivatePages,
} from "./lib/local-preview.mjs";

async function main() {
  const args = parsePreviewArguments(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: pnpm preview:local [--port <1–65535>]

Build existing local content into ignored dist-local/ and serve it on loopback.
Default port: 4332. Example: pnpm preview:local --port 4332
No R2 pull, deployment, or production dist/ modification. Re-run after edits.
This static preview does not emulate Worker auth, routing, or telemetry.`);
    return;
  }
  const settings = localPreviewSettings(`http://127.0.0.1:${args.port}`);
  const root = fileURLToPath(new URL("../", import.meta.url));
  process.chdir(root);
  const output = await lstat(new URL("../dist-local", import.meta.url)).catch(
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  if (output?.isSymbolicLink())
    throw new Error("Refusing symlinked dist-local output.");
  await assertPortAvailable(settings.port);
  process.env[LOCAL_PREVIEW_ENV] = `http://127.0.0.1:${settings.port}`;
  const { build, preview } = await import("astro");
  await build({ root });
  await removeLocalPrivatePages(root);
  const server = await preview({ root });
  console.log(
    `[local-preview] Ready: ${settings.origin}/ (generated cards under /og/)`,
  );
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error) => {
  console.error(`[local-preview] ${error.message}`);
  process.exitCode = 1;
});
