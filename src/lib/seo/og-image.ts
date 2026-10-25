import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  SOCIAL_PROFILE,
  SOCIAL_THEME,
  SOCIAL_PNG_OPTIONS,
  createSocialBackground,
  createTechnicalFrame,
} from "../../../scripts/lib/social-style.mjs";

import boldGlyphs from "../../assets/fonts/Geist-Bold-OG.json";
import monoGlyphs from "../../assets/fonts/GeistMono-OG.json";
import twemojiGlyphs from "../../assets/emojis/twemoji.json";
import { availability } from "../../config/availability.mjs";

export const SOCIAL_IMAGE_WIDTH = 2400;
export const SOCIAL_IMAGE_HEIGHT = 1260;

export function defaultSocialImageMetadata(locale = "en"): SocialImageMetadata {
  return {
    title: locale.startsWith("es")
      ? "Ingeniero de Software Senior y Liderazgo Técnico"
      : "Senior Software Engineer & Technology Leadership",
    description: locale.startsWith("es")
      ? "Go, Rust, sistemas distribuidos e inteligencia artificial. Experiencia, arquitectura y proyectos de Arturo Nava."
      : "Go, Rust, distributed systems & artificial intelligence. Experience, architecture and selected projects by Arturo Nava.",
    locale,
    pathname: locale.startsWith("es") ? "/es/" : "/",
  };
}

export function socialAvailabilityBanner(locale: string, openToWork: boolean) {
  const es = locale.startsWith("es");
  return {
    available: openToWork,
    lines: openToWork
      ? es
        ? [
            "Disponible: ingeniería Senior / Staff",
            "Liderazgo tecnológico y proyectos independientes",
          ]
        : [
            "Available for Senior / Staff engineering",
            "Technology leadership & independent projects",
          ]
      : es
        ? [
            "Ingeniería, arquitectura y tecnología",
            "Experiencia, proyectos y artículos técnicos",
          ]
        : [
            "Engineering, architecture & technology",
            "Experience, selected work & technical writing",
          ],
  };
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
function textGraphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value.normalize("NFC"))].map(
    (part) => part.segment,
  );
}

/** Build-only social cards, derived from the metadata already rendered into HTML. */
export interface SocialImageMetadata {
  title: string;
  description: string;
  locale: string;
  pathname: string;
}

export function getSocialImagePath(pathname: string): string | undefined {
  if (!pathname.startsWith("/") || /[?#\\\u0000-\u001f]/u.test(pathname))
    return;
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return;
  }
  if (
    segments.some(
      (part) =>
        part === "." || part === ".." || /[/\\\u0000-\u001f]/u.test(part),
    )
  )
    return;
  const publicSegments = segments[0] === "es" ? segments.slice(1) : segments;
  const first = publicSegments[0] || "";
  if (
    ["admin", "api", "search", "__admin-vault", "_astro", "og"].includes(
      first,
    ) ||
    first.startsWith("__") ||
    /\.[a-z0-9]+$/i.test(segments.at(-1) || "")
  )
    return;
  return `/og/${segments.length ? segments.map(encodeURIComponent).join("/") + "/" : ""}index.png`;
}

export function resolveSocialImageUrl(options: {
  pathname: string;
  siteUrl: string;
  production: boolean;
  noindex?: boolean;
  explicitImage?: string | undefined;
}): string {
  if (options.explicitImage?.trim()) {
    try {
      const image = new URL(options.explicitImage, options.siteUrl);
      if (image.protocol === "https:" || image.protocol === "http:")
        return image.href;
    } catch {
      /* Invalid image values use the site's safe fallback. */
    }
  }
  const generated =
    options.production && !options.noindex
      ? getSocialImagePath(options.pathname)
      : undefined;
  return new URL(generated || "/og-default.png", options.siteUrl).href;
}

function decodeHtml(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (_, entity: string) => {
      if (entity[0] === "#") {
        const value =
          entity[1]?.toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return value > 0 && value <= 0x10ffff
          ? String.fromCodePoint(value)
          : "";
      }
      return (
        (
          {
            amp: "&",
            quot: '"',
            apos: "'",
            lt: "<",
            gt: ">",
            nbsp: " ",
          } as Record<string, string>
        )[entity.toLowerCase()] || ""
      );
    },
  );
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
      (match) => [
        match[1]!.toLowerCase(),
        decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""),
      ],
    ),
  );
}

const emojiStore: Record<string, string> = {
  ...(twemojiGlyphs as Record<string, string>),
};

const EMOJI_PIECE = String.raw`\p{Emoji}(?:\p{EMod}|[\u{E0020}-\u{E007E}]+\u{E007F}|\uFE0F?\u20E3?)`;
const EMOJI_GRAPHEME_REGEX = new RegExp(
  String.raw`^(?:\p{RI}{2}|(?![#*\d](?!\uFE0F?\u20E3))${EMOJI_PIECE}(?:\u200D${EMOJI_PIECE})*)$`,
  "u",
);

/**
 * Converts an emoji grapheme to the canonical Twemoji hex code point sequence.
 * Follows the official Twemoji U+200D rule: strips U+FE0F only when no ZWJ is present.
 */
export function toEmojiCode(char: string): string {
  const normalized = char.includes("\u200D")
    ? char.replace(/\uFE0E/gu, "")
    : char.replace(/[\uFE0E\uFE0F]/gu, "");
  return [...normalized].map((c) => c.codePointAt(0)!.toString(16)).join("-");
}

/** Looks up pre-compiled vector SVG paths for an emoji (checking both ZWJ-exact and FE0F-stripped keys). */
export function getEmojiSvg(char: string): string | undefined {
  const primary = toEmojiCode(char);
  if (emojiStore[primary]) return emojiStore[primary];
  const stripped = [...char.replace(/[\uFE0E\uFE0F]/gu, "")]
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("-");
  return emojiStore[stripped];
}

/** Detects if a grapheme represents a Unicode emoji (following Satori's Unicode segmentation rules). */
export function isEmojiChar(char: string): boolean {
  return (
    EMOJI_GRAPHEME_REGEX.test(char) ||
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(char)
  );
}

/**
 * Disambiguates UTS #51 emoji vs text presentation: characters that exist in the
 * local text font without an explicit U+FE0F selector render as crisp font outlines.
 */
function shouldRenderEmoji(char: string, face?: SocialImageFont): boolean {
  if (!isEmojiChar(char)) return false;
  if (char.includes("\uFE0E")) return false;
  if (char.includes("\uFE0F")) return true;
  if (face?.glyphs[char]) return false;
  return true;
}

function scopeEmojiSvgIds(svg: string, scopeId: string): string {
  if (!svg.includes("id=")) return svg;
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${scopeId}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${scopeId}-$1)`)
    .replace(/\b(?:xlink:)?href="#([^"]+)"/g, `href="#${scopeId}-$1"`);
}

/**
 * Ensures any new emoji introduced in content (e.g. via R2 pull) is resolved at build time
 * and persisted into the local Twemoji asset store without breaking offline determinism.
 */
export async function ensureEmojiGlyphsLoaded(
  text: string,
  face?: SocialImageFont,
): Promise<void> {
  const missing = new Set<string>();
  for (const char of textGraphemes(text)) {
    if (shouldRenderEmoji(char, face) && !getEmojiSvg(char)) {
      missing.add(char);
    }
  }
  if (missing.size === 0) return;

  let updated = false;
  for (const char of missing) {
    const primary = toEmojiCode(char);
    const stripped = [...char.replace(/[\uFE0E\uFE0F]/gu, "")]
      .map((c) => c.codePointAt(0)!.toString(16))
      .join("-");
    const candidates = [...new Set([primary, stripped])];

    for (const code of candidates) {
      const urls = [
        `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code}.svg`,
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`,
      ];
      let resolved = false;
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(2500),
          });
          if (!res.ok) continue;
          const rawSvg = await res.text();
          const match = rawSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
          if (match?.[1]) {
            emojiStore[code] = match[1].replace(/\s+/g, " ").trim();
            updated = true;
            resolved = true;
            break;
          }
        } catch {
          /* Offline or unreachable CDN falls back gracefully without failing build. */
        }
      }
      if (resolved) break;
    }
  }

  if (updated) {
    try {
      const storePath = fileURLToPath(
        new URL("../../assets/emojis/twemoji.json", import.meta.url),
      );
      const sorted = Object.keys(emojiStore)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = emojiStore[key]!;
          return acc;
        }, {});
      await writeFile(storePath, JSON.stringify(sorted, null, 2) + "\n");
    } catch {
      /* Read-only build environments retain in-memory glyphs. */
    }
  }
}

/** Strips all Unicode emojis, variation selectors, zero-width joiners and skin tones for clean, high-fidelity vector typography. */
export function stripEmojis(value: string): string {
  return value
    .replace(
      /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F\u200D\u200B\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enriches blog social card descriptions using opening article paragraphs from emitted HTML
 * so cards utilize their full vertical space with non-redundant, complete sentences.
 */
function extractBlogExtendedDescription(
  html: string,
  baseDescription: string,
  maxChars = 430,
): string {
  const articleMatch = html.match(
    /<div\b[^>]*class="[^"]*article-detail__content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<nav\b[\s\S]*?<\/nav>\s*)?<\/article>/i,
  );
  const mainHeaderMatch = !articleMatch
    ? html.match(/<main\b[^>]*>[\s\S]*?<header\b[^>]*>([\s\S]*?)<\/header>/i)
    : null;
  const container = (articleMatch?.[1] || mainHeaderMatch?.[1] || "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, " ")
    .replace(
      /<(?:pre|code|table|ul|ol|h[1-6]|nav)\b[^>]*>[\s\S]*?<\/(?:pre|code|table|ul|ol|h[1-6]|nav)>/gi,
      " ",
    );

  const paragraphs = [...container.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodeHtml(m[1]!.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  if (paragraphs.length === 0) return baseDescription;

  const significantWords = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
  const seenWords = new Set(significantWords(baseDescription));

  let result = baseDescription.trim();
  if (result && !/[.!?…]$/.test(result)) result += ".";

  const sentences = paragraphs.join(" ").split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) continue;
    const words = significantWords(cleanSentence);
    if (words.length > 0) {
      const overlapRatio =
        words.filter((w) => seenWords.has(w)).length / words.length;
      if (overlapRatio >= 0.6) continue;
    }
    const candidate = result ? `${result} ${cleanSentence}` : cleanSentence;
    if (textGraphemes(candidate).length <= maxChars) {
      result = candidate;
      for (const w of words) seenWords.add(w);
    } else if (textGraphemes(result).length < 220) {
      result = candidate;
      break;
    } else {
      break;
    }
  }
  return result;
}

export function extractSocialImageMetadata(
  html: string,
  pathname: string,
  siteUrl: string,
): SocialImageMetadata | undefined {
  const imagePath = getSocialImagePath(pathname);
  if (!imagePath) return;
  const metadata = new Map<string, string>();
  const head = html.split(/<\/head>/i)[0]!;
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attr = attributes(tag);
    const key = attr.property || attr.name;
    if (key) metadata.set(key.toLowerCase(), attr.content || "");
  }
  if (/\bnoindex\b/i.test(metadata.get("robots") || "")) return;
  const image = metadata.get("og:image");
  if (
    !image ||
    new URL(image, siteUrl).href !== new URL(imagePath, siteUrl).href
  )
    return;
  let title =
    metadata.get("og:title") ||
    decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");

  // Preserve leading branding emoji from page H1 when the head title omitted it
  const titleFirstChar = textGraphemes(title.trim())[0] || "";
  if (!isEmojiChar(titleFirstChar)) {
    const h1Text = decodeHtml(
      (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(
        /<[^>]+>/g,
        " ",
      ),
    )
      .replace(/\s+/g, " ")
      .trim();
    const h1FirstChar = textGraphemes(h1Text)[0] || "";
    if (isEmojiChar(h1FirstChar) && getEmojiSvg(h1FirstChar)) {
      title = `${h1FirstChar} ${title.trim()}`;
    }
  }

  const baseDescription =
    metadata.get("og:description") || metadata.get("description") || "";
  const isBlog = /^\/(?:es\/)?blog(?:\/|$)/.test(pathname);
  const description = isBlog
    ? extractBlogExtendedDescription(html, baseDescription, 430)
    : baseDescription;

  const clean = (value: string, limit: number) => {
    const parts = textGraphemes(value.replace(/\s+/g, " ").trim());
    return parts.length > limit
      ? parts.slice(0, limit - 1).join("") + "…"
      : parts.join("");
  };
  return {
    title: clean(title, 240) || "Arturo Nava",
    description: clean(description, isBlog ? 480 : 320),
    locale: attributes(html.match(/<html\b[^>]*>/i)?.[0] || "").lang || "en",
    pathname,
  };
}

export function wrapSocialText(
  text: string,
  maxChars: number,
  maxLines: number,
): string[] {
  return wrapMeasuredText(
    text,
    (value) => textGraphemes(value).length,
    maxChars,
    maxLines,
  );
}

export function wrapMeasuredText(
  text: string,
  measure: (value: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (!(maxWidth > 0) || !(maxLines >= 1)) return [];
  const words = text
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .flatMap((word) => {
      const chunks: string[] = [];
      let chunk = "";
      for (const char of textGraphemes(word)) {
        if (chunk && measure(chunk + char) > maxWidth) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += char;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (measure(`${line}${line ? " " : ""}${word}`) <= maxWidth)
      line += `${line ? " " : ""}${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const result = lines.slice(0, maxLines);
    let last = result[maxLines - 1]!;
    while (last && measure(last + "…") > maxWidth)
      last = textGraphemes(last).slice(0, -1).join("").trimEnd();
    result[maxLines - 1] = last + "…";
    return result;
  }
  return lines;
}

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
}

export interface SocialImageFont {
  unitsPerEm: number;
  glyphs: Record<string, { advance: number; path: string }>;
}

export function measureSocialText(
  text: string,
  font: SocialImageFont,
  size: number,
): number {
  return (
    (textGraphemes(text).reduce((width, char) => {
      if (shouldRenderEmoji(char, font) && getEmojiSvg(char)) {
        return width + font.unitsPerEm;
      }
      return width + (font.glyphs[char] || font.glyphs["?"])!.advance;
    }, 0) *
      size) /
    font.unitsPerEm
  );
}

export function fitSocialText(
  text: string,
  font: SocialImageFont,
  options: {
    maxWidth: number;
    maxHeight: number;
    maxLines: number;
    maxSize: number;
    minSize: number;
  },
): {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  truncated: boolean;
} {
  const { maxWidth, maxHeight, maxLines, maxSize, minSize } = options;
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lineHeight = Math.ceil(size * 1.2);
    const count = Math.min(maxLines, Math.floor(maxHeight / lineHeight));
    const measure = (value: string) => measureSocialText(value, font, size);
    const fullLines = wrapMeasuredText(
      text,
      measure,
      maxWidth,
      Number.MAX_SAFE_INTEGER,
    );
    if (fullLines.length <= count)
      return { lines: fullLines, fontSize: size, lineHeight, truncated: false };
  }
  const lineHeight = Math.ceil(minSize * 1.2);
  const count = Math.min(maxLines, Math.floor(maxHeight / lineHeight));
  return {
    lines: wrapMeasuredText(
      text,
      (value) => measureSocialText(value, font, minSize),
      maxWidth,
      count,
    ),
    fontSize: minSize,
    lineHeight,
    truncated: true,
  };
}

/** Font outlines keep the site's real weights portable across build hosts. */
export function renderSocialImageSvg(
  metadata: SocialImageMetadata,
  font: SocialImageFont,
  options: { openToWork?: boolean } = {},
): string {
  const heading: SocialImageFont = boldGlyphs;
  const detail: SocialImageFont = monoGlyphs;
  const { colors } = SOCIAL_THEME;
  const isBlog = /^\/(?:es\/)?blog(?:\/|$)/.test(metadata.pathname);
  const rawTitle = metadata.title
    .replace(/^Arturo Nava\s*[|—-]\s*/, "")
    .replace(/\s*[|—-]\s*Arturo Nava$/, "")
    .trim();
  const titleText =
    rawTitle === SOCIAL_PROFILE.name ? SOCIAL_PROFILE.role : rawTitle;
  const titleFit = fitSocialText(titleText, heading, {
    maxWidth: 1040,
    maxHeight: 116,
    maxLines: 2,
    maxSize: 48,
    minSize: 32,
  });

  const descriptionText = metadata.description.trim();

  const descStartY = isBlog
    ? 242 +
      (titleFit.lines.length - 1) * titleFit.lineHeight +
      (titleFit.lines.length > 1 ? 48 : 54)
    : 360;
  const descMaxHeight = isBlog ? Math.max(150, 522 - descStartY) : 54;
  const descriptionFit = fitSocialText(descriptionText, font, {
    maxWidth: 1040,
    maxHeight: descMaxHeight,
    maxLines: isBlog ? 6 : 2,
    maxSize: isBlog ? 28.5 : 20.5,
    minSize: isBlog ? 22 : 18,
  });

  let emojiCounter = 0;
  const outlines = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    face: SocialImageFont = font,
  ): string => {
    let cursor = x;
    return textGraphemes(value)
      .map((char) => {
        if (shouldRenderEmoji(char, face)) {
          const emojiSvg = getEmojiSvg(char);
          if (emojiSvg) {
            const emojiScale = size / 36;
            const emojiY = y - size * 0.855;
            const scopedSvg = scopeEmojiSvgIds(
              emojiSvg,
              `og-e${++emojiCounter}`,
            );
            const svg = `<g transform="translate(${cursor.toFixed(2)} ${emojiY.toFixed(2)}) scale(${emojiScale.toFixed(4)})">${scopedSvg}</g>`;
            cursor += size;
            return svg;
          }
          cursor += (face.glyphs["?"]!.advance * size) / face.unitsPerEm;
          return "";
        }
        const glyph = (face.glyphs[char] || face.glyphs["?"])!;
        const path = glyph.path
          ? `<path d="${escapeXml(glyph.path)}" transform="translate(${cursor} ${y}) scale(${size / face.unitsPerEm} ${-size / face.unitsPerEm})" fill="${color}"/>`
          : "";
        cursor += (glyph.advance * size) / face.unitsPerEm;
        return path;
      })
      .join("");
  };
  const lines = (
    fit: ReturnType<typeof fitSocialText>,
    y: number,
    color: string,
    face: SocialImageFont,
  ) =>
    fit.lines
      .map((line, i) =>
        outlines(line, 80, y + i * fit.lineHeight, fit.fontSize, color, face),
      )
      .join("");
  const banner = socialAvailabilityBanner(
    metadata.locale,
    options.openToWork ?? availability.openToWork,
  );
  const background = createSocialBackground(
    1200,
    630,
    isBlog
      ? [
          { x: 70, y: 76, w: 1060, h: 105 },
          { x: 70, y: 194, w: 1060, h: 328 },
          { x: 70, y: 542, w: 1060, h: 48 },
        ]
      : [
          { x: 70, y: 76, w: 1060, h: 105 },
          { x: 70, y: 194, w: 1060, h: 222 },
          { x: 70, y: 416, w: 1060, h: 100 },
          { x: 70, y: 542, w: 1060, h: 48 },
        ],
    28,
    (glyph) => {
      if (isBlog && glyph.filterAttr && glyph.y >= descStartY - 28) {
        return "";
      }
      const char = detail.glyphs[glyph.char]
        ? glyph.char
        : detail.glyphs["λ"]
          ? "λ"
          : "A";
      return `<g opacity="${glyph.opacity}" ${glyph.filterAttr}>${outlines(char, glyph.x - measureSocialText(char, detail, glyph.size) / 2, glyph.y, glyph.size, glyph.fill, detail)}</g>`;
    },
  );
  const role = metadata.locale.startsWith("es")
    ? "Senior Software / AI Engineer · Sistemas Distribuidos · Alto Rendimiento"
    : "Senior Software / AI Engineer · Distributed Systems · High Performance";
  const contact = `${SOCIAL_PROFILE.handle}  ·  ${SOCIAL_PROFILE.email}`;

  const companyMatch = !isBlog
    ? titleText.match(/^(.*?)(\s+(?:at|en)\s+.+)$/i)
    : null;
  const splitIndex = companyMatch ? companyMatch[1]!.length : -1;

  let titleOffset = 0;
  const renderedTitleLines = titleFit.lines
    .map((line, i) => {
      const y = 242 + i * titleFit.lineHeight;
      let cursor = 80;
      let lineSvg = "";
      for (const char of textGraphemes(line)) {
        const isCompany = splitIndex !== -1 && titleOffset >= splitIndex;
        const face = isCompany ? font : heading;
        if (shouldRenderEmoji(char, face)) {
          const emojiSvg = getEmojiSvg(char);
          if (emojiSvg) {
            const emojiScale = titleFit.fontSize / 36;
            const emojiY = y - titleFit.fontSize * 0.855;
            const scopedSvg = scopeEmojiSvgIds(
              emojiSvg,
              `og-e${++emojiCounter}`,
            );
            lineSvg += `<g transform="translate(${cursor.toFixed(2)} ${emojiY.toFixed(2)}) scale(${emojiScale.toFixed(4)})">${scopedSvg}</g>`;
            cursor += titleFit.fontSize;
          } else {
            cursor +=
              (face.glyphs["?"]!.advance * titleFit.fontSize) / face.unitsPerEm;
          }
          titleOffset += char.length;
          continue;
        }
        const color = isCompany ? colors.amberLead : colors.amberPrimary;
        const glyph = (face.glyphs[char] || face.glyphs["?"])!;
        const charWidth = (glyph.advance * titleFit.fontSize) / face.unitsPerEm;
        if (glyph.path) {
          const pathSvg = `<path d="${escapeXml(glyph.path)}" transform="translate(${cursor} ${y}) scale(${titleFit.fontSize / face.unitsPerEm} ${-titleFit.fontSize / face.unitsPerEm})" fill="${color}"/>`;
          lineSvg += isCompany
            ? `<g transform="translate(${cursor} ${y}) skewX(-11) translate(${-cursor} ${-y})">${pathSvg}</g>`
            : pathSvg;
        }
        cursor += charWidth;
        titleOffset += char.length;
      }
      titleOffset += 1;
      return lineSvg;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 1200 630" shape-rendering="geometricPrecision">
    ${background}
    ${createTechnicalFrame(1200, 630, 28)}
    <g data-og-identity="true" data-og-heading-font="Geist 700" aria-label="${SOCIAL_PROFILE.name}">${outlines(SOCIAL_PROFILE.name, 80, 140, 70, colors.textWhite, heading)}</g>
    <g data-og-detail-font="Geist Mono 600">${outlines(role, 82, 175, 16, colors.textDim, detail)}</g>
    <g data-og-title="true" aria-label="${escapeXml(titleText)}">${renderedTitleLines}</g>
    <g data-og-description="true">${lines(descriptionFit, descStartY, colors.textMuted, font)}</g>
    ${
      !isBlog
        ? `<g data-og-badge="true" data-og-available="${banner.available}" aria-label="${escapeXml(banner.lines.join(". "))}">
      <rect x="80" y="424" width="1040" height="88" rx="8" fill="${colors.bgLight}" stroke="${colors.amberPrimary}" stroke-opacity="0.55"/>
      <rect x="80" y="424" width="4" height="88" rx="2" fill="${colors.amberPrimary}"/>
      <circle cx="105" cy="450" r="5" fill="${banner.available ? colors.statusGreen : colors.amberPrimary}"/>
      ${outlines(banner.lines[0]!, 122, 456, 17, colors.textWhite, detail)}
      ${outlines(banner.lines[1]!, 102, 490, 17, colors.amberLead, detail)}
    </g>`
        : ""
    }
    <g data-og-detail-font="Geist Mono 600">${outlines(SOCIAL_PROFILE.domain, 80, 566, 23, colors.amberPrimary, detail)}
    ${outlines(contact, 1120 - measureSocialText(contact, detail, 16), 566, 16, colors.textMuted, detail)}</g>
  </svg>`;
}

let loadedFont: { path: string; data: SocialImageFont } | undefined;
export async function renderSocialImage(
  metadata: SocialImageMetadata,
  fontFile: string,
  options: { openToWork?: boolean } = {},
): Promise<Buffer> {
  if (loadedFont?.path !== fontFile) {
    const data = JSON.parse(
      await readFile(fontFile, "utf8"),
    ) as SocialImageFont;
    if (!(data.unitsPerEm > 0) || !data.glyphs?.["?"])
      throw new Error("Invalid local social-image glyph map");
    loadedFont = { path: fontFile, data };
  }
  await ensureEmojiGlyphsLoaded(
    `${metadata.title} ${metadata.description}`,
    loadedFont.data,
  );
  const renderer = new Resvg(
    renderSocialImageSvg(metadata, loadedFont.data, options),
    {
      dpi: 96,
      shapeRendering: 2,
      textRendering: 2,
      font: { loadSystemFonts: false },
    },
  );
  return sharp(renderer.render().asPng())
    .removeAlpha()
    .withMetadata({ density: 96 })
    .png(SOCIAL_PNG_OPTIONS)
    .toBuffer();
}
