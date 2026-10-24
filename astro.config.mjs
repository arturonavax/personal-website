import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import socialImages from "./src/integrations/social-images.ts";
import {
  serializeVerifiedSitemapItem,
  isIndexableSitemapPath,
} from "./scripts/lib/sitemap-metadata.mjs";

function minifyInlineScripts() {
  return {
    name: "minify-inline-scripts",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        function walk(current) {
          const entries = fs.readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".html")) {
              const html = fs.readFileSync(fullPath, "utf8");
              const minified = html.replace(
                /<script([^>]*)>([\s\S]*?)<\/script>/gi,
                (match, attrs, body) => {
                  if (
                    attrs.includes("json") ||
                    attrs.includes("src") ||
                    !body.trim()
                  )
                    return match;
                  try {
                    const res = esbuild.transformSync(body, {
                      minify: true,
                      target: "es2020",
                    });
                    return `<script${attrs}>${res.code.trim()}</script>`;
                  } catch {
                    return match;
                  }
                },
              );
              if (minified !== html) {
                fs.writeFileSync(fullPath, minified, "utf8");
              }
            }
          }
        }
        walk(outDir);
      },
    },
  };
}

function buildRouteLastmodMap() {
  const map = new Map();
  const contentRoot = path.join(process.cwd(), "src", "content");
  if (!fs.existsSync(contentRoot)) return map;

  function parseDateFromFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const match = content.match(/^---\s*([\s\S]*?)\s*---/);
      if (match) {
        const fm = match[1];
        const updatedMatch =
          fm.match(/updatedDate:\s*["']?([^"'\n]+)/i) ||
          fm.match(/updatedAt:\s*["']?([^"'\n]+)/i);
        if (updatedMatch) return new Date(updatedMatch[1].trim());

        const pubMatch =
          fm.match(/pubDate:\s*["']?([^"'\n]+)/i) ||
          fm.match(/publishedAt:\s*["']?([^"'\n]+)/i) ||
          fm.match(/startDate:\s*["']?([^"'\n]+)/i);
        if (pubMatch) return new Date(pubMatch[1].trim());
      }
      return fs.statSync(filePath).mtime;
    } catch {
      return undefined;
    }
  }

  const collections = ["posts", "projects", "experience", "services", "resume"];
  for (const collection of collections) {
    const colDir = path.join(contentRoot, collection);
    if (!fs.existsSync(colDir)) continue;

    const walkDir = (dir, localePrefix = "") => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full, localePrefix || entry.name);
        } else if (entry.isFile() && /\.(?:md|mdx|json)$/i.test(entry.name)) {
          if (entry.name.startsWith(".")) continue;
          const date = parseDateFromFile(full);
          const rawSlug = path
            .relative(colDir, full)
            .replaceAll(path.sep, "/")
            .replace(/^(?:en|es)\//, "")
            .replace(/\.(?:md|mdx|json)$/i, "");

          if (collection === "resume") {
            const isEs = rawSlug.toLowerCase().endsWith("-es");
            map.set(isEs ? "/es/resume" : "/resume", date);
            map.set(isEs ? "/es/resume/" : "/resume/", date);
          } else {
            const section = collection === "posts" ? "blog" : collection;
            const locale = localePrefix === "es" ? "es" : "en";
            if (locale === "es") {
              map.set(`/es/${section}/${rawSlug}`, date);
              map.set(`/es/${section}/${rawSlug}/`, date);
            } else {
              map.set(`/${section}/${rawSlug}`, date);
              map.set(`/${section}/${rawSlug}/`, date);
              map.set(`/en/${section}/${rawSlug}`, date);
              map.set(`/en/${section}/${rawSlug}/`, date);
            }
          }
        }
      }
    };
    walkDir(colDir);
  }
  return map;
}

const routeLastmodMap = buildRouteLastmodMap();

export default defineConfig({
  site: "https://arturonavax.dev",
  output: "static",
  trailingSlash: "always",
  // Expose dev/preview servers on the LAN (0.0.0.0) for multi-device testing.
  server: { host: true },
  build: {
    inlineStylesheets: "auto",
    format: "directory",
  },
  compressHTML: true,
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssCodeSplit: true,
      cssMinify: "lightningcss",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/astro") ||
              id.includes("node_modules/nanostores") ||
              id.includes("src/utils/") ||
              id.includes("src/stores/") ||
              id.includes("src/lib/navigation/")
            ) {
              return "core-client";
            }
          },
        },
      },
    },
  },
  integrations: [
    socialImages(),
    sitemap({
      filter: (page) => isIndexableSitemapPath(new URL(page).pathname),

      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en",
          es: "es",
        },
      },

      // Reuse the emitted page's verified locale relationships; translated
      // slugs need not match. Omit unknown lastmod instead of using build time.
      serialize(item) {
        const pathname = new URL(item.url).pathname;
        const out = path.resolve(
          fileURLToPath(new URL("./dist/", import.meta.url)),
        );
        const file = path.resolve(
          out,
          `.${decodeURIComponent(pathname)}`,
          "index.html",
        );
        if (
          !file.startsWith(`${out}${path.sep}`) &&
          file !== path.join(out, "index.html")
        )
          return undefined;
        if (!fs.existsSync(file)) return undefined;
        return serializeVerifiedSitemapItem(
          item,
          fs.readFileSync(file, "utf8"),
          routeLastmodMap.get(pathname),
        );
      },
    }),
    minifyInlineScripts(),
  ],
});
