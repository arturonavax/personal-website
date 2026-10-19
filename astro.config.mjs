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
      return new Date();
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
          walkDir(full, entry.name);
        } else if (entry.isFile() && /\.(?:md|mdx|json)$/i.test(entry.name)) {
          if (entry.name.startsWith(".")) continue;
          const date = parseDateFromFile(full);
          const rawSlug = entry.name.replace(/\.(?:md|mdx|json)$/i, "");

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
    },
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes("/admin/") &&
        !page.includes("/admin") &&
        !page.includes("/search") &&
        !page.includes("/404"),

      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en",
          es: "es",
        },
      },

      // 3. Serializador avanzado (x-default + lastmod dinámico)
      serialize(item) {
        // Asignar fecha de última modificación determinista desde el mapa de contenido
        try {
          const parsed = new URL(item.url);
          const p = parsed.pathname;
          const matched =
            routeLastmodMap.get(p) ||
            routeLastmodMap.get(p.replace(/\/+$/, "")) ||
            routeLastmodMap.get(`${p}/`);
          item.lastmod = matched ? new Date(matched) : new Date();
        } catch {
          item.lastmod = new Date();
        }

        // Asegurar que exista la directiva x-default apuntando a la versión en inglés
        if (item.links && item.links.length > 0) {
          const hasXDefault = item.links.some((l) => l.lang === "x-default");
          if (!hasXDefault) {
            const defaultLink =
              item.links.find((l) => l.lang === "en") || item.links[0];
            if (defaultLink) {
              item.links.push({
                lang: "x-default",
                url: defaultLink.url,
              });
            }
          }
        }

        return item;
      },
    }),
    minifyInlineScripts(),
  ],
});
