import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  parsePreviewArguments,
  localPreviewSettings,
  socialImageOrigin,
  removeLocalPrivatePages,
  assertPortAvailable,
} from "../scripts/lib/local-preview.mjs";
import { resolveSocialImageUrl } from "../src/lib/seo/og-image";
import { generateSocialImages } from "../src/integrations/social-images";

const site = "https://arturonavax.dev";
describe("isolated local social previews", () => {
  it("accepts only a bounded explicit port and documents the command", () => {
    expect(parsePreviewArguments(["--port", "4332"]).port).toBe(4332);
    expect(parsePreviewArguments(["--", "--port", "4332"]).port).toBe(4332);
    expect(parsePreviewArguments(["--help"]).help).toBe(true);
    for (const args of [
      ["--port", "0"],
      ["--port", "65536"],
      ["--port", "4.2"],
      ["--host", "example.com"],
      ["--port"],
      ["--port", "4332", "--port", "4333"],
    ])
      expect(() => parsePreviewArguments(args)).toThrow();
  });
  it("keeps normal configuration unchanged and rejects non-loopback or malformed origins", () => {
    expect(localPreviewSettings(undefined)).toBeUndefined();
    expect(localPreviewSettings("http://127.0.0.1:80")?.port).toBe(80);
    expect(localPreviewSettings("http://127.0.0.1:4332")).toEqual({
      origin: "http://127.0.0.1:4332",
      port: 4332,
      host: "127.0.0.1",
      outDir: "./dist-local",
    });
    for (const origin of [
      "",
      "https://example.com",
      "http://0.0.0.0:4332",
      "http://localhost:4332",
      "http://127.0.0.1:4332/path",
      "http://u:p@127.0.0.1:4332",
      "http://127.0.0.1:4332?x",
      "http://127.0.0.1:0",
      "https://127.0.0.1:4332",
    ])
      expect(() => localPreviewSettings(origin)).toThrow();
  });
  it("preserves production and authored images while supporting local generated and dev fallback URLs", () => {
    const options = {
      siteUrl: site,
      development: false,
      requestOrigin: "http://localhost:4321",
    };
    expect(socialImageOrigin(options)).toBe(site);
    expect(socialImageOrigin({ ...options, development: true })).toBe(
      "http://localhost:4321",
    );
    const origin = socialImageOrigin({
      ...options,
      localOrigin: "http://127.0.0.1:4332",
    });
    expect(
      resolveSocialImageUrl({
        pathname: "/es/",
        siteUrl: origin,
        production: true,
      }),
    ).toBe("http://127.0.0.1:4332/og/es/index.png");
    expect(
      resolveSocialImageUrl({
        pathname: "/es/",
        siteUrl: origin,
        production: false,
      }),
    ).toBe("http://127.0.0.1:4332/og-default.png");
    expect(
      resolveSocialImageUrl({ pathname: "/", siteUrl: site, production: true }),
    ).toBe(`${site}/og/index.png`);
    expect(
      resolveSocialImageUrl({
        pathname: "/",
        siteUrl: origin,
        production: true,
        explicitImage: "https://images.example/cover.png",
      }),
    ).toBe("https://images.example/cover.png");
  });
  it("generates actual localized PNGs using the same image-only local origin", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "local-og-generation-"));
    console.info(`scratch: ${scratch}`);
    const origin = "http://127.0.0.1:4332";
    for (const [directory, pathname] of [
      ["", "/"],
      ["es", "/es/"],
    ]) {
      await mkdir(join(scratch, directory), { recursive: true });
      await writeFile(
        join(scratch, directory, "index.html"),
        `<html lang="${directory || "en"}"><head><meta property="og:title" content="Local preview"><meta property="og:image" content="${origin}/og/${directory ? directory + "/" : ""}index.png"><link rel="canonical" href="${site}${pathname}"></head></html>`,
      );
    }
    expect(
      await generateSocialImages(
        scratch,
        origin,
        join(process.cwd(), "src/assets/fonts/Geist-OG.json"),
      ),
    ).toBe(2);
    for (const path of ["og/index.png", "og/es/index.png"])
      expect(
        (await readFile(join(scratch, path))).subarray(1, 4).toString(),
      ).toBe("PNG");
  });
  it("removes private copies only inside the disposable output, leaving production untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-og-isolation-"));
    console.info(`scratch: ${root}`);
    for (const dir of [
      "dist/admin",
      "dist-local/admin",
      "dist-local/es/admin",
      "dist-local/en/admin",
      "dist-local/__admin_vault__",
      "dist-local/__admin-vault",
      "dist-local/about",
    ]) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, "index.html"), "unchanged");
    }
    await removeLocalPrivatePages(root);
    expect(await readFile(join(root, "dist/admin/index.html"), "utf8")).toBe(
      "unchanged",
    );
    expect(
      await readFile(join(root, "dist-local/about/index.html"), "utf8"),
    ).toBe("unchanged");
    for (const dir of [
      "admin",
      "es/admin",
      "en/admin",
      "__admin_vault__",
      "__admin-vault",
    ])
      await expect(access(join(root, "dist-local", dir))).rejects.toThrow();
  });
  it("fails on a busy port rather than selecting another origin", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      await expect(assertPortAvailable(port)).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
