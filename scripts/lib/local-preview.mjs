import { createServer } from "node:net";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";

export const LOCAL_PREVIEW_ENV = "LOCAL_SOCIAL_PREVIEW_ORIGIN";

/** A fixed origin prevents metadata from drifting from the actual preview port. */
export function localPreviewSettings(value) {
  if (value === undefined) return undefined;
  const url = new URL(value);
  const port = /^http:\/\/127\.0\.0\.1:([1-9]\d*)$/.exec(value)?.[1];
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !port ||
    Number(port) > 65535
  )
    throw new Error(
      "Local social preview requires http://127.0.0.1:<port> with port 1–65535 and no path, credentials, query or fragment.",
    );
  return {
    origin: url.origin,
    host: "127.0.0.1",
    port: Number(port),
    outDir: "./dist-local",
  };
}

export function parsePreviewArguments(args) {
  const tokens = args[0] === "--" ? args.slice(1) : args;
  if (tokens.length === 1 && ["--help", "-h"].includes(tokens[0]))
    return { help: true };
  if (tokens.length === 0) return { port: 4332, help: false };
  if (
    tokens.length !== 2 ||
    tokens[0] !== "--port" ||
    !/^[1-9]\d*$/.test(tokens[1]) ||
    Number(tokens[1]) > 65535
  )
    throw new Error("Use pnpm preview:local [--port <1–65535>] or --help.");
  return { port: Number(tokens[1]), help: false };
}

/** Used only by server-rendered metadata; never installed as client code. */
export function socialImageOrigin({
  siteUrl,
  development,
  requestOrigin,
  localOrigin,
}) {
  return localOrigin || (development ? requestOrigin : siteUrl);
}

export async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** Never move private HTML into a vault that a plain static server can expose. */
export async function removeLocalPrivatePages(root) {
  const directory = path.join(root, "dist-local");
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Local output must be a real dist-local directory.");
  for (const relative of [
    "admin",
    "es/admin",
    "en/admin",
    "__admin_vault__",
    "__admin-vault",
  ]) {
    // Reject symlinked locale directories before traversing them.
    const locale = relative.split("/")[0];
    const parent = await lstat(path.join(directory, locale)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (parent?.isSymbolicLink())
      throw new Error(
        "Local output cannot contain symlinked private directories.",
      );
    await rm(path.join(directory, relative), { recursive: true, force: true });
  }
}
