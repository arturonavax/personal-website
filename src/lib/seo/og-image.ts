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

/** Outlines avoid system-font differences and unsupported native WOFF2 loading. */
export function renderSocialImageSvg(
  metadata: SocialImageMetadata,
  font: SocialImageFont,
): string {
  const { colors } = SOCIAL_THEME;
  const title = metadata.title
    .replace(/^Arturo Nava\s*[|—-]\s*/, "")
    .replace(/\s*[|—-]\s*Arturo Nava$/, "")
    .trim();
  const titleFit = fitSocialText(
    title === SOCIAL_PROFILE.name ? SOCIAL_PROFILE.role : title,
    font,
    {
      maxWidth: 1040,
      maxHeight: 100,
      maxLines: 2,
      maxSize: 38,
      minSize: 26,
    },
  );
  const descriptionFit = fitSocialText(metadata.description, font, {
    maxWidth: 1040,
    maxHeight: 60,
    maxLines: 2,
    maxSize: 20.5,
    minSize: 18.5,
  });
  const outlines = (
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    emphasis = false,
  ): string => {
    let cursor = x;
    return textGraphemes(value)
      .map((char) => {
        const glyph = (font.glyphs[char] || font.glyphs["?"])!;
        const path = glyph.path
          ? `<path d="${escapeXml(glyph.path)}" transform="translate(${cursor} ${y}) scale(${size / font.unitsPerEm} ${-size / font.unitsPerEm})" fill="${color}" ${emphasis ? `stroke="${color}" stroke-width="10" stroke-linejoin="round"` : ""}/>`
          : "";
        cursor += (glyph.advance * size) / font.unitsPerEm;
        return path;
      })
      .join("");
  };
  const lines = (
    fit: ReturnType<typeof fitSocialText>,
    y: number,
    color: string,
  ) =>
    fit.lines
      .map((line, i) =>
        outlines(line, 80, y + i * fit.lineHeight, fit.fontSize, color),
      )
      .join("");
  const badge = metadata.locale.startsWith("es")
    ? "DISPONIBLE PARA ROLES Y PROYECTOS"
    : SOCIAL_PROFILE.badgeText;
  const badgeWidth = Math.max(320, measureSocialText(badge, font, 11.5) + 64);
  const titleWidth = Math.max(
    0,
    ...titleFit.lines.map((line) =>
      measureSocialText(line, font, titleFit.fontSize),
    ),
  );
  const descWidth = Math.max(
    0,
    ...descriptionFit.lines.map((line) =>
      measureSocialText(line, font, descriptionFit.fontSize),
    ),
  );
  const textZones = [
    { x: 74, y: 72, w: badgeWidth + 12, h: 48 },
    {
      x: 74,
      y: 120,
      w:
        Math.max(titleWidth, measureSocialText(SOCIAL_PROFILE.name, font, 80)) +
        12,
      h: 100 + titleFit.lines.length * titleFit.lineHeight,
    },
    {
      x: 74,
      y: 320,
      w: descWidth + 12,
      h: descriptionFit.lines.length * descriptionFit.lineHeight + 20,
    },
    { x: 74, y: 486, w: 1052, h: 54 },
  ];
  const background = createSocialBackground(
    1200,
    630,
    textZones,
    28,
    (glyph) => {
      // Decorative heads stay in the available Matrix alphabet, rather than
      // rendering unsupported characters as visible question-mark trails.
      const char = font.glyphs[glyph.char]
        ? glyph.char
        : font.glyphs["λ"]
          ? "λ"
          : "A";
      return `<g opacity="${glyph.opacity}" ${glyph.filterAttr}>${outlines(char, glyph.x - measureSocialText(char, font, glyph.size) / 2, glyph.y, glyph.size, glyph.fill)}</g>`;
    },
  );
  const contact = [
    { text: SOCIAL_PROFILE.handle, color: colors.textWhite },
    { text: "   •   ", color: colors.amberPrimary },
    { text: SOCIAL_PROFILE.email, color: colors.textMuted },
  ];
  let contactX =
    1120 -
    contact.reduce(
      (width, part) => width + measureSocialText(part.text, font, 21),
      0,
    );
  const footerContact = contact
    .map((part) => {
      const svg = outlines(part.text, contactX, 520, 21, part.color);
      contactX += measureSocialText(part.text, font, 21);
      return svg;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" shape-rendering="geometricPrecision">
    ${background}
    ${createTechnicalFrame(1200, 630, 28)}
    <g data-og-badge="true" transform="translate(80 78)">
      <rect width="${badgeWidth}" height="36" rx="18" fill="${colors.badgeBg}" stroke="${colors.badgeBorder}" stroke-width="1.2"/>
      <circle cx="18" cy="18" r="5" fill="${colors.statusGreen}" filter="url(#glowGreen)"/>
      ${outlines(badge, 34, 22.5, 11.5, colors.textWhite, true)}
    </g>
    <g data-og-identity="true">${outlines(SOCIAL_PROFILE.name, 80, 200, 80, colors.textWhite, true)}</g>
    <g data-og-title="true">${lines(titleFit, 258, colors.amberPrimary)}</g>
    <g data-og-description="true">${lines(descriptionFit, 346, colors.textMuted)}</g>
    <line x1="80" y1="440" x2="1120" y2="440" stroke="${colors.amberPrimary}" stroke-width="1" stroke-opacity="0.22"/>
    ${outlines(SOCIAL_PROFILE.domain, 80, 520, 25, colors.amberPrimary, true)}
    ${footerContact}
  </svg>`;
}

let loadedFont: { path: string; data: SocialImageFont } | undefined;
export async function renderSocialImage(
  metadata: SocialImageMetadata,
  fontFile: string,
): Promise<Buffer> {
  if (loadedFont?.path !== fontFile) {
    const data = JSON.parse(
      await readFile(fontFile, "utf8"),
    ) as SocialImageFont;
    if (!(data.unitsPerEm > 0) || !data.glyphs?.["?"])
      throw new Error("Invalid local social-image glyph map");
    loadedFont = { path: fontFile, data };
  }
  const renderer = new Resvg(renderSocialImageSvg(metadata, loadedFont.data), {
    dpi: 96,
    shapeRendering: 2,
    textRendering: 2,
    font: { loadSystemFonts: false },
  });
  return sharp(renderer.render().asPng())
    .removeAlpha()
    .withMetadata({ density: 96 })
    .png(SOCIAL_PNG_OPTIONS)
    .toBuffer();
}
