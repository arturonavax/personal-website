import type { AstroIntegration } from "astro";
import { assessSocialImageSize } from "../lib/seo/social-image-size";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractSocialImageMetadata,
  getSocialImagePath,
  renderSocialImage,
  defaultSocialImageMetadata,
} from "../lib/seo/og-image";

/** Sequential rendering bounds native renderer memory to one card at a time. */
export async function generateSocialImages(
  directory: string,
  siteUrl: string,
  fontFile: string,
  onGenerated?: (pathname: string, bytes: number) => void,
): Promise<number> {
  let generated = 0;
  const outputUrl = pathToFileURL(
    directory.endsWith(sep) ? directory : directory + sep,
  );
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["_astro", "og", "admin", "__admin-vault"].includes(entry.name))
          await visit(file);
      } else if (entry.isFile() && entry.name === "index.html") {
        const htmlPath = relative(directory, file).split(sep).join("/");
        const pathname = "/" + htmlPath.slice(0, -"index.html".length);
        const metadata = extractSocialImageMetadata(
          await readFile(file, "utf8"),
          pathname,
          siteUrl,
        );
        const imagePath = getSocialImagePath(pathname);
        if (!metadata || !imagePath) continue;
        const outputFile = fileURLToPath(new URL("." + imagePath, outputUrl));
        await mkdir(dirname(outputFile), { recursive: true });
        const png = await renderSocialImage(metadata, fontFile);
        await writeFile(outputFile, png);
        onGenerated?.(imagePath, png.byteLength);
        generated++;
      }
    }
  }
  await visit(directory);
  return generated;
}

export default function socialImages(): AstroIntegration {
  let root = new URL("../../", import.meta.url);
  let siteUrl = "https://arturonavax.dev";
  return {
    name: "route-social-images",
    hooks: {
      "astro:config:done": ({ config }) => {
        root = config.root;
        siteUrl = config.site || siteUrl;
      },
      "astro:build:generated": async ({ dir, logger }) => {
        const fontFile = fileURLToPath(
          new URL("src/assets/fonts/Geist-OG.json", root),
        );
        let checked = 0;
        let withinBudget = 0;
        const report = (pathname: string, bytes: number) => {
          const result = assessSocialImageSize(pathname, bytes);
          checked++;
          if (result.ok) withinBudget++;
          if (result.ok) logger.info(result.line);
          else logger.warn(result.line);
        };
        const count = await generateSocialImages(
          fileURLToPath(dir),
          siteUrl,
          fontFile,
          report,
        );
        // The shipped fallback shares the same branding and availability owner.
        const fallback = await renderSocialImage(
          defaultSocialImageMetadata(),
          fontFile,
        );
        await writeFile(new URL("og-default.png", dir), fallback);
        report("/og-default.png", fallback.byteLength);
        logger.info(
          `Generated ${count} localized social cards + fallback. Size checks: ${withinBudget}/${checked} ✓, ${checked - withinBudget} ✗.`,
        );
        logger.info(
          "Size checks use a conservative site budget, not a guarantee of previews on every platform (crawler access, metadata, caches and timeouts also matter).",
        );
      },
    },
  };
}
