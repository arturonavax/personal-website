import type { APIRoute, GetStaticPaths } from "astro";
import { Resvg } from "@resvg/resvg-js";

export const prerender = true;

function escapeXml(unsafe: string): string {
  if (typeof unsafe !== "string") return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

function wrapText(text: string, maxCharsPerLine = 38, maxLines = 3): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length === maxLines - 1) {
        break;
      }
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  if (lines.length === maxLines && words.length > 0) {
    const last = lines[lines.length - 1];
    if (last && !last.endsWith("...")) {
      lines[lines.length - 1] = last.replace(/\.?\s*$/, "...");
    }
  }

  return lines;
}

export const getStaticPaths: GetStaticPaths = async () => {
  // Desactivado temporalmente: se utiliza exclusivamente /og-default.png para todas las rutas
  return [];
};

export const GET: APIRoute = async ({ props }) => {
  const {
    title,
    description,
    section,
    tags = [],
  } = props as {
    title: string;
    description: string;
    section: string;
    tags?: string[];
  };

  const width = 1200;
  const height = 630;
  const safeTitleLines = wrapText(title, 34, 2);
  const safeDescLines = wrapText(description, 60, 2);

  const titleSvgTspans = safeTitleLines
    .map(
      (line, i) =>
        `<tspan x="80" dy="${i === 0 ? 0 : 68}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const descSvgTspans = safeDescLines
    .map(
      (line, i) =>
        `<tspan x="80" dy="${i === 0 ? 0 : 32}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const tagsSvg = tags
    .map(
      (tag, i) => `
      <g transform="translate(${80 + i * 180}, 534)">
        <rect width="165" height="36" rx="4" fill="#180406" stroke="#521317" stroke-width="1.2" />
        <text x="82.5" y="23" font-family="monospace, 'Geist Mono', sans-serif" font-size="13" font-weight="600" fill="#d48b38" text-anchor="middle">
          #${escapeXml(tag)}
        </text>
      </g>`,
    )
    .join("");

  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#180406" />
        <stop offset="45%" stop-color="#120305" />
        <stop offset="100%" stop-color="#0A0203" />
      </linearGradient>
      <radialGradient id="vignette" cx="20%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#3A0D10" stop-opacity="0.35" />
        <stop offset="60%" stop-color="#120305" stop-opacity="0.10" />
        <stop offset="100%" stop-color="#0A0203" stop-opacity="0.85" />
      </radialGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Canvas Background -->
    <rect width="${width}" height="${height}" fill="url(#bg)" />
    <rect width="${width}" height="${height}" fill="url(#vignette)" />

    <!-- Technical Outer Grid Frame -->
    <rect x="28" y="28" width="1144" height="574" stroke="#d48b38" stroke-width="1" stroke-opacity="0.25" fill="none" />
    <path d="M 24 54 L 24 24 L 54 24" stroke="#d48b38" stroke-width="2.5" fill="none" />
    <path d="M 1176 54 L 1176 24 L 1146 24" stroke="#d48b38" stroke-width="2.5" fill="none" />
    <path d="M 24 576 L 24 606 L 54 606" stroke="#d48b38" stroke-width="2.5" fill="none" />
    <path d="M 1176 576 L 1176 606 L 1146 606" stroke="#d48b38" stroke-width="2.5" fill="none" />

    <!-- Top Metadata Bar -->
    <g transform="translate(80, 78)">
      <rect width="260" height="34" rx="4" fill="#180406" stroke="#d48b38" stroke-width="1" stroke-opacity="0.6" />
      <circle cx="16" cy="17" r="4.5" fill="#10b981" filter="url(#glow)" />
      <text x="32" y="22" font-family="monospace, 'Geist Mono', sans-serif" font-size="11.5" font-weight="700" fill="#d48b38" letter-spacing="1">
        ${escapeXml(section)}
      </text>
    </g>

    <!-- Domain Watermark -->
    <text x="1120" y="100" font-family="monospace, 'Geist Mono', sans-serif" font-size="16" font-weight="600" fill="#a39292" text-anchor="end" opacity="0.75" letter-spacing="0.5">
      arturonavax.dev
    </text>

    <!-- Main Title -->
    <text x="80" y="220" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Geist', sans-serif" font-size="56" font-weight="800" fill="#ffffff" letter-spacing="-1.5">
      ${titleSvgTspans}
    </text>

    <!-- Description -->
    <text x="80" y="${220 + safeTitleLines.length * 68 + 15}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Geist', sans-serif" font-size="21" font-weight="400" fill="#e2d5d5" letter-spacing="-0.2">
      ${descSvgTspans}
    </text>

    <!-- Tags Row -->
    ${tagsSvg}

    <!-- Author & Badge Footer -->
    <text x="1120" y="556" font-family="monospace, 'Geist Mono', sans-serif" font-size="15" font-weight="600" fill="#d48b38" text-anchor="end">
      Arturo Nava • Senior Software / AI Engineer
    </text>
  </svg>
  `;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  return new Response(new Uint8Array(pngBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
