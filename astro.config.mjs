import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export default defineConfig({
  site: "https://arturonavax.dev",
  output: "static",
  trailingSlash: "never",
  build: {
    inlineStylesheets: "auto",
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en",
          es: "es",
        },
      },
    }),
    minifyInlineScripts(),
  ],
});
