// Shared principal and route-card appearance. Importing this module writes no files.
export const SOCIAL_THEME = {
  colors: {
    bgDark: "#0A0203",
    bgMid: "#120305",
    bgLight: "#180406",
    amberPrimary: "#D48B38",
    amberLead: "#E5A352",
    amberTail: "#8E5E1C",
    textWhite: "#FFFFFF",
    textMuted: "#E2D5D5",
    textDim: "#A39292",
    statusGreen: "#10B981",
    badgeBg: "#180406",
    badgeBorder: "#521317",
  },
  fonts: {
    sans: '"DejaVu Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Geist Sans", sans-serif',
    mono: '"DejaVu Sans Mono", "BlexMono Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "Geist Mono", monospace',
  },
};

export const SOCIAL_PROFILE = {
  name: "Arturo Nava",
  role: "Senior Software / AI Engineer",
  badgeText: "AVAILABLE FOR SENIOR / STAFF ROLES",
  techPillars: "Distributed Systems • High Concurrency • AppSec",
  coreStack: "Distributed Systems • High Performance • Web3 • AppSec",
  secondaryStack: "Specializing in Go, Rust & AI-Integrated Backend Systems",
  bannerSummary: "Distributed Systems • High Performance • AI • Web3 • AppSec",
  domain: "arturonavax.dev",
  handle: "@arturonavax",
  email: "arturo@arturonavax.dev",
};

export const SOCIAL_MATRIX = {
  headChars: ["λ", "μ", "σ", "π", "θ", "§", "ø", "Δ", "Ψ", "Ω", "Ξ", "ζ"],
  bodyChars: [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "X",
    "Y",
    "Z",
    "V",
    "R",
    "K",
    "T",
    "n",
    "t",
    "s",
    "p",
  ],
  columnWidth: 22,
  verticalStep: 18,
  glyphSize: 14.5,
};

export const SOCIAL_PNG_OPTIONS = {
  compressionLevel: 9,
  effort: 10,
  adaptiveFiltering: true,
  palette: false,
};

function hashGlyph(col, stream, step) {
  let h =
    (col * 374761393 + stream * 668265263 + step * 3628273133) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function isPointInZones(x, y, zones, padding = 16) {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (
      x >= z.x - padding &&
      x <= z.x + z.w + padding &&
      y >= z.y - padding &&
      y <= z.y + z.h + padding
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// MATRIX BACKGROUND GENERATOR (ZERO COLOR SHIFT + GLYPH-ONLY BOKEH BLUR)
// ============================================================================
/** @param {((glyph: {char: string, x: number, y: number, size: number, fill: string, opacity: string, filterAttr: string}) => string) | undefined} [renderGlyph] */
export function generateMatrixGlyphs(
  width,
  height,
  textZones = [],
  frameInset = 28,
  renderGlyph,
) {
  const { headChars, bodyChars, columnWidth, verticalStep, glyphSize } =
    SOCIAL_MATRIX;

  const TONE_HEAD = "#D48B38";
  const TONE_BODY = "#9E471E";
  const TONE_TAIL = "#521317";

  // RIGID MARGIN BOUNDS: Matrix never touches or crosses the outer frame
  const safeMinX = frameInset + 20;
  const safeMaxX = width - frameInset - 20;
  const safeMinY = frameInset + 24;
  const safeMaxY = height - frameInset - 20;

  let svg = `<g class="font-mono">`;
  const numCols = Math.floor(width / columnWidth);

  for (let col = 0; col < numCols; col++) {
    const x = Math.round(col * columnWidth + columnWidth / 2);

    // Hard boundary clip against outer technical frames
    if (x < safeMinX || x > safeMaxX) continue;

    const colSeed = (col * 1973 + 41) % 100;
    // High sustained density (~84% activation across all areas)
    if (colSeed < 16) continue;

    const streamCount = colSeed % 3 === 0 ? 2 : 1;

    for (let s = 0; s < streamCount; s++) {
      const streamLength = 8 + ((col * 11 + s * 37) % 9);
      const startY =
        safeMinY +
        ((col * 47 + s * 311) %
          Math.max(20, safeMaxY - safeMinY - streamLength * verticalStep));

      const depthTier = (colSeed + s * 17) % 3;

      for (let j = 0; j < streamLength; j++) {
        const y = Math.round(startY + j * verticalStep);
        if (y < safeMinY || y > safeMaxY) continue;

        // Detect if this specific glyph is positioned in the text area
        const insideTextZone = isPointInZones(x, y, textZones, 16);

        // Distance from lead head (0 is head, increasing upward)
        const distFromLead = streamLength - 1 - j;

        let opacity;
        let fill;
        let filterAttr = "";

        if (insideTextZone) {
          // BOKEH BLUR: ONLY the glyph itself is blurred; zero backdrop tinting
          filterAttr = 'filter="url(#glyphBlur)"';

          if (distFromLead === 0) {
            opacity = "0.22";
            fill = TONE_HEAD;
          } else if (distFromLead <= 2) {
            opacity = "0.14";
            fill = TONE_BODY;
          } else if (distFromLead <= 5) {
            opacity = "0.07";
            fill = TONE_TAIL;
          } else {
            continue;
          }
        } else {
          // FOREGROUND: Razor-sharp glyphs
          if (distFromLead === 0) {
            opacity =
              depthTier === 2 ? "0.50" : depthTier === 1 ? "0.36" : "0.24";
            fill = TONE_HEAD;
          } else if (distFromLead === 1) {
            opacity =
              depthTier === 2 ? "0.34" : depthTier === 1 ? "0.24" : "0.16";
            fill = TONE_BODY;
          } else if (distFromLead <= 3) {
            opacity =
              depthTier === 2 ? "0.20" : depthTier === 1 ? "0.14" : "0.09";
            fill = TONE_BODY;
          } else if (distFromLead <= 5) {
            opacity = depthTier === 2 ? "0.11" : "0.06";
            fill = TONE_TAIL;
          } else if (distFromLead <= 7 && depthTier === 2) {
            opacity = "0.05";
            fill = TONE_TAIL;
          } else {
            continue;
          }
        }

        const char =
          distFromLead === 0
            ? headChars[hashGlyph(col, s, 0) % headChars.length]
            : bodyChars[hashGlyph(col, s, j) % bodyChars.length];

        svg += renderGlyph
          ? renderGlyph({
              char,
              x,
              y,
              size: glyphSize,
              fill,
              opacity,
              filterAttr,
            })
          : `<text x="${x}" y="${y}" opacity="${opacity}" fill="${fill}" font-size="${glyphSize}" font-weight="500" text-anchor="middle" ${filterAttr}>${char}</text>`;
      }
    }
  }

  svg += `</g>`;
  return svg;
}

// ============================================================================
// SVG STYLE DEFINITIONS AND FILTERS
// ============================================================================
/** @param {((glyph: {char: string, x: number, y: number, size: number, fill: string, opacity: string, filterAttr: string}) => string) | undefined} [renderGlyph] */
export function createSocialBackground(
  width,
  height,
  textZones = [],
  frameInset = 28,
  renderGlyph,
) {
  const { colors, fonts } = SOCIAL_THEME;

  return `
  <style>
    .font-sans { font-family: ${fonts.sans}; text-rendering: geometricPrecision; }
    .font-mono { font-family: ${fonts.mono}; text-rendering: geometricPrecision; }
  </style>
  <defs>
    <!-- Seamless background gradient -->
    <linearGradient id="bgLinear" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.bgLight}" />
      <stop offset="45%" stop-color="${colors.bgMid}" />
      <stop offset="100%" stop-color="${colors.bgDark}" />
    </linearGradient>

    <!-- Radial vignette focused on top-left quadrant -->
    <radialGradient id="vignette" cx="28%" cy="38%" r="80%">
      <stop offset="0%" stop-color="#3A0D10" stop-opacity="0.30" />
      <stop offset="55%" stop-color="${colors.bgMid}" stop-opacity="0.10" />
      <stop offset="100%" stop-color="${colors.bgDark}" stop-opacity="0.90" />
    </radialGradient>

    <!-- Status indicator green glow -->
    <filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Optical bokeh blur applied exclusively to text glyphs behind typography -->
    <filter id="glyphBlur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" />
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgLinear)" />
  <rect width="${width}" height="${height}" fill="url(#vignette)" />
  ${generateMatrixGlyphs(width, height, textZones, frameInset, renderGlyph)}
  `;
}

export function createTechnicalFrame(width, height, inset = 28) {
  const gold = SOCIAL_THEME.colors.amberPrimary;
  const outer = inset - 4;
  return `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" stroke="${gold}" stroke-width="1" stroke-opacity="0.22" fill="none" />
    <path d="M ${outer} ${outer + 30} L ${outer} ${outer} L ${outer + 30} ${outer}" stroke="${gold}" stroke-width="2.5" fill="none" />
    <path d="M ${width - outer} ${outer + 30} L ${width - outer} ${outer} L ${width - outer - 30} ${outer}" stroke="${gold}" stroke-width="2.5" fill="none" />
    <path d="M ${outer} ${height - outer - 30} L ${outer} ${height - outer} L ${outer + 30} ${height - outer}" stroke="${gold}" stroke-width="2.5" fill="none" />
    <path d="M ${width - outer} ${height - outer - 30} L ${width - outer} ${height - outer} L ${width - outer - 30} ${height - outer}" stroke="${gold}" stroke-width="2.5" fill="none" />`;
}
