// Offline build-source maintenance: extracts Twemoji vector paths for self-hosted OG card rendering.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "src/assets/emojis/twemoji.json");

const emojiRegex =
  /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

const foundEmojis = new Set();

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (
        !full.includes("node_modules") &&
        !full.includes(".git") &&
        !full.includes("dist") &&
        !full.includes(".astro")
      ) {
        walk(full);
      }
    } else if (
      /\.(md|astro|ts|json|mjs)$/.test(full) &&
      !full.includes("-OG.json") &&
      !full.includes("twemoji.json")
    ) {
      const content = readFileSync(full, "utf8");
      const matches = content.match(emojiRegex);
      if (matches) {
        for (const m of matches) foundEmojis.add(m);
      }
    }
  }
}

walk(join(root, "src"));

// Common and branding emojis for tech, cloud, systems, and blog articles
const commonEmojis = [
  "🚀",
  "⚡",
  "✈️",
  "✍️",
  "🔬",
  "🎨",
  "💼",
  "📊",
  "🏢",
  "🤖",
  "🛠️",
  "🌐",
  "🔒",
  "🏛️",
  "⏱️",
  "⚙️",
  "⚠️",
  "💡",
  "🎯",
  "💻",
  "📡",
  "📦",
  "🔄",
  "🔍",
  "🛡️",
  "🛫",
  "🧭",
  "✨",
  "🔥",
  "🎉",
  "📈",
  "⭐",
  "🌟",
  "🏷️",
  "📌",
  "🏆",
  "🧠",
  "☕",
  "💬",
  "📍",
  "📐",
  "📝",
  "📞",
  "☁️",
];

for (const emoji of commonEmojis) {
  foundEmojis.add(emoji);
}

function toCode(char) {
  const normalized = char.replace(/[\uFE0E\uFE0F]/gu, "");
  return [...normalized].map((c) => c.codePointAt(0).toString(16)).join("-");
}

let existing = {};
try {
  existing = JSON.parse(await readFile(destination, "utf8"));
} catch {
  // File does not exist yet
}

const glyphs = { ...existing };
let fetched = 0;
let cached = 0;

for (const emoji of foundEmojis) {
  const code = toCode(emoji);
  if (glyphs[code]) {
    cached++;
    continue;
  }

  // Attempt fetch from cdnjs Twemoji
  const urls = [
    `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code}.svg`,
    `https://raw.githubusercontent.com/twitter/twemoji/v14.0.2/assets/svg/${code}.svg`,
  ];

  let svgText = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        svgText = await res.text();
        break;
      }
    } catch {
      // Try next url
    }
  }

  if (svgText) {
    const match = svgText.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (match) {
      glyphs[code] = match[1].replace(/\s+/g, " ").trim();
      fetched++;
      console.log(`Fetched ${emoji} (${code})`);
    }
  }
}

// Write sorted JSON
const sortedGlyphs = Object.keys(glyphs)
  .sort()
  .reduce((acc, key) => {
    acc[key] = glyphs[key];
    return acc;
  }, {});

const jsonString = JSON.stringify(sortedGlyphs, null, 2) + "\n";
await writeFile(destination, jsonString);

console.log(
  `\nTwemoji sync complete: ${Object.keys(sortedGlyphs).length} total emojis (${fetched} fetched, ${cached} cached). Size: ${(jsonString.length / 1024).toFixed(1)} KB.`,
);
