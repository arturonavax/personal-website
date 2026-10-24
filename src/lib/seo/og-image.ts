import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
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
  const title =
    metadata.get("og:title") ||
    decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description =
    metadata.get("og:description") || metadata.get("description") || "";
  const clean = (value: string, limit: number) => {
    const parts = textGraphemes(value.replace(/\s+/g, " ").trim());
    return parts.length > limit
      ? parts.slice(0, limit - 1).join("") + "…"
      : parts.join("");
  };
  return {
    title: clean(title, 240) || "Arturo Nava",
    description: clean(description, 320),
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
    (textGraphemes(text).reduce(
      (width, char) => width + (font.glyphs[char] || font.glyphs["?"])!.advance,
      0,
    ) *
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
  for (let size = maxSize; size >= minSize; size--) {
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
  const title = metadata.title
    .replace(/^Arturo Nava\s*[|—-]\s*/, "")
    .replace(/\s*[|—-]\s*Arturo Nava$/, "")
    .trim();
  const isBlog = /^\/(?:es\/)?blog(?:\/|$)/.test(metadata.pathname);
  const titleText = title === SOCIAL_PROFILE.name ? SOCIAL_PROFILE.role : title;
  const titleFit = fitSocialText(titleText, heading, {
    maxWidth: 1040,
    maxHeight: 116,
    maxLines: 2,
    maxSize: 48,
    minSize: 32,
  });
  const descriptionFit = fitSocialText(metadata.description, font, {
    maxWidth: 1040,
    maxHeight: isBlog ? 140 : 54,
    maxLines: isBlog ? 5 : 2,
    maxSize: isBlog ? 22 : 20.5,
    minSize: isBlog ? 19 : 18,
  });
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
          { x: 70, y: 194, w: 1060, h: 320 },
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

  const companyMatch = titleText.match(/^(.*?)(\s+(?:at|en)\s+.+)$/i);
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
    <g data-og-description="true">${lines(descriptionFit, 360, colors.textMuted, font)}</g>
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
