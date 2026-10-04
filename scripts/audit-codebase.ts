// scripts/audit-codebase.ts
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, "src");

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

if (totalViolations > 0) {
  console.error(`\nAudit failed with ${totalViolations} fatal violations.`);
  process.exit(1);
} else {
  console.log(
    "\n[PASS] All architectural static gates certified successfully.",
  );
}
