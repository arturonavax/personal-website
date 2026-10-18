// scripts/audit-codebase.ts
import fs from "node:fs";
import path from "node:path";
import { verifyContentHydration } from "./lib/r2-content.mjs";

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, "src");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const HEADERS_PATH = path.join(ROOT_DIR, "public", "_headers");

const BANNED_CSS_PROPERTIES = [
  "width",
  "height",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
  "top",
  "left",
  "bottom",
  "right",
  "border-width",
];

let totalViolations = 0;

function walk(directory: string): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const ext = path.extname(entry.name);
    if (![".astro", ".ts", ".tsx", ".css"].includes(ext)) continue;

    const source = fs.readFileSync(fullPath, "utf8");

    // Rule 1: Zero unmanaged <img> tags
    if (
      ext === ".astro" &&
      /<img\b(?![^>]*\brole=["']presentation["'])/i.test(source)
    ) {
      console.error(
        `[FAIL] Unmanaged <img> tag found in: ${fullPath}. Must use Astro's <Image/> or <Picture/>.`,
      );
      totalViolations++;
    }

    // Rule 2: Zero layout transitions
    for (const prop of BANNED_CSS_PROPERTIES) {
      const transitionRegex = new RegExp(
        `transition(?:-property)?\\s*:[^;]*\\b${prop}\\b`,
        "i",
      );
      if (transitionRegex.test(source)) {
        console.error(
          `[FAIL] Prohibited layout animation property "${prop}" found in: ${fullPath}`,
        );
        totalViolations++;
      }
    }

    // Rule 3: Zero static will-change in stylesheets
    if (ext === ".css" && /will-change\s*:\s*[a-z]+/i.test(source)) {
      console.error(
        `[FAIL] Static will-change detected in stylesheet: ${fullPath}. Must be dynamic via WAAPI/JS.`,
      );
      totalViolations++;
    }
  }
}

async function auditCodebase(): Promise<void> {
  console.log("Auditing codebase against SPEC-004 quality gates...");
  walk(SRC_DIR);

  // Rule 4: Verify absence of legacy Tailwind config
  if (
    fs.existsSync(path.join(ROOT_DIR, "tailwind.config.js")) ||
    fs.existsSync(path.join(ROOT_DIR, "tailwind.config.mjs"))
  ) {
    console.error(
      "[FAIL] Legacy tailwind.config.* detected. Tailwind v4 requires pure CSS-first @theme declaration.",
    );
    totalViolations++;
  }

  // Rule 5: Verify build-time content hydration (TASK SEO-1)
  try {
    const hydration = await verifyContentHydration();
    if (!hydration.valid) {
      console.error(
        `[FAIL] Content hydration incomplete: missing ${hydration.missing.join(", ")}`,
      );
      totalViolations++;
    }
  } catch (err: any) {
    console.error(`[FAIL] Content hydration error: ${err.message}`);
    totalViolations++;
  }

  // Rule 6: Verify Edge AEO headers in public/_headers (TASK SEO-4)
  if (fs.existsSync(HEADERS_PATH)) {
    const headersContent = fs.readFileSync(HEADERS_PATH, "utf8");
    if (
      !headersContent.includes(
        "X-Robots-Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      )
    ) {
      console.error(
        "[FAIL] public/_headers missing required X-Robots-Tag index directives.",
      );
      totalViolations++;
    }
    if (
      !headersContent.includes("X-Robots-Tag: noindex, nofollow, noarchive")
    ) {
      console.error(
        "[FAIL] public/_headers missing noindex protection for /admin and /api routes.",
      );
      totalViolations++;
    }
  } else {
    console.error("[FAIL] public/_headers not found.");
    totalViolations++;
  }

  // Rule 7: If dist/ exists, verify production HTML quality (TASK SEO-2 & SEO-3)
  if (fs.existsSync(DIST_DIR)) {
    function auditDistHtml(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          auditDistHtml(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".html")) continue;

        // Skip 404, search, and admin internal surfaces
        const rel = path.relative(DIST_DIR, full).replace(/\\/g, "/");
        if (
          rel === "404.html" ||
          rel.startsWith("admin/") ||
          rel.includes("/admin/") ||
          rel.startsWith("es/admin/")
        ) {
          continue;
        }

        const html = fs.readFileSync(full, "utf8");

        // Canonical link check
        if (!html.includes('<link rel="canonical"')) {
          console.error(`[FAIL] Missing <link rel="canonical"> in ${rel}`);
          totalViolations++;
        }

        // JSON-LD @graph check
        const jsonLdMatch = html.match(
          /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
        );
        if (!jsonLdMatch) {
          console.error(`[FAIL] Missing application/ld+json in ${rel}`);
          totalViolations++;
        } else {
          try {
            const parsed = JSON.parse(jsonLdMatch[1]!);
            const graph = parsed["@graph"];
            if (!Array.isArray(graph) || graph.length === 0) {
              console.error(`[FAIL] JSON-LD in ${rel} missing "@graph" array`);
              totalViolations++;
            }
          } catch {
            console.error(`[FAIL] Invalid JSON-LD syntax in ${rel}`);
            totalViolations++;
          }
        }

        // Hreflang + x-default check
        if (
          !html.includes('hreflang="x-default"') &&
          !rel.startsWith("404") &&
          !rel.includes("search")
        ) {
          console.error(`[FAIL] Missing hreflang="x-default" in ${rel}`);
          totalViolations++;
        }

        // Social Cards check
        if (!html.includes('property="og:image"')) {
          console.error(`[FAIL] Missing og:image in ${rel}`);
          totalViolations++;
        }
        if (!html.includes('name="twitter:card"')) {
          console.error(`[FAIL] Missing twitter:card in ${rel}`);
          totalViolations++;
        }

        // RSS autodiscovery check
        if (!html.includes('type="application/rss+xml"')) {
          console.error(`[FAIL] Missing RSS autodiscovery link in ${rel}`);
          totalViolations++;
        }
      }
    }
    auditDistHtml(DIST_DIR);
  }

  if (totalViolations > 0) {
    console.error(`\nAudit failed with ${totalViolations} fatal violations.`);
    process.exit(1);
  } else {
    console.log(
      "\n[PASS] All architectural static gates certified successfully.",
    );
  }
}

auditCodebase().catch((err) => {
  console.error("Fatal audit execution error:", err);
  process.exit(1);
});
