import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

// ============================================================================
// XML ESCAPING UTILITY
// ============================================================================
function escapeXml(unsafe) {
  if (typeof unsafe !== "string") return unsafe;
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

// ============================================================================
// HIGH-ENTROPY INTEGER HASH (NON-LINEAR PSEUDORANDOM SEEDING)
// ============================================================================
function hashGlyph(col, stream, step) {
  let h =
    (col * 374761393 + stream * 668265263 + step * 3628273133) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ============================================================================
// CENTRALIZED CONFIGURATION (METADATA, PALETTE, FONTS, AND ENGINE SPECS)
// ============================================================================
const CONFIG = {
  paths: {
    outputDir: path.resolve("public"),
    faviconSvg: path.resolve("public", "favicon.svg"),
  },
  profile: {
    name: "Arturo Nava",
    role: "Senior Software / AI Engineer",
    badgeText: "AVAILABLE FOR SENIOR / STAFF ROLES",
    techPillars: "Distributed Systems • High Concurrency • AppSec",
    coreStack: "Distributed Systems • High Performance • Web3 • AppSec",
    secondaryStack: "Specializing in Go, Rust & AI-Integrated Backend Systems",
    bannerSummary:
      "Distributed Systems • High Performance • AI • Web3 • AppSec",
    domain: "arturonavax.dev",
    handle: "@arturonavax",
    email: "arturo@arturonavax.dev",
  },
  theme: {
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
  },
  matrix: {
    // Exotic characters strictly reserved for the stream heads
    headChars: ["λ", "μ", "σ", "π", "θ", "§", "ø", "Δ", "Ψ", "Ω", "Ξ", "ζ"],
    // Monospace hex and alphanumeric set for descending trails
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
    columnWidth: 22, // High column density (~54 columns across 1200px)
    verticalStep: 18, // Snapped vertical step for clean rasterization
    glyphSize: 14.5, // Scaled glyph size for crisp high-contrast definition
  },
  rendering: {
    supersampleFactor: 2, // 2x density supersampling for pin-sharp anti-aliasing
    sharpPngOptions: {
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: true,
      palette: false, // Pure RGB lossless without quantization banding
    },
  },
};

// ============================================================================
// SPATIAL DETECTION UTILITIES
// ============================================================================
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
function generateMatrixGlyphs(width, height, textZones = [], frameInset = 28) {
  const { headChars, bodyChars, columnWidth, verticalStep, glyphSize } =
    CONFIG.matrix;

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

        svg += `<text x="${x}" y="${y}" opacity="${opacity}" fill="${fill}" font-size="${glyphSize}" font-weight="500" text-anchor="middle" ${filterAttr}>${char}</text>`;
      }
    }
  }

  svg += `</g>`;
  return svg;
}

// ============================================================================
// SVG STYLE DEFINITIONS AND FILTERS
// ============================================================================
function getDefsAndStyles(width, height, textZones = [], frameInset = 28) {
  const { colors, fonts } = CONFIG.theme;

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
  ${generateMatrixGlyphs(width, height, textZones, frameInset)}
  `;
}

// ============================================================================
// TEMPLATE 1: OPEN GRAPH CARD DEFAULT (1200 x 630 px)
// ============================================================================
function createOgDefaultSvg() {
  const width = 1200;
  const height = 630;
  const frameInset = 28;
  const { profile, theme } = CONFIG;
  const { colors } = theme;

  // Text bounding boxes for glyph-only bokeh blur
  const textZones = [
    { x: 74, y: 72, w: 332, h: 48 },
    { x: 74, y: 126, w: 870, h: 266 },
    { x: 74, y: 486, w: 1052, h: 54 },
  ];

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" xmlns="http://www.w3.org/2000/svg">
    ${getDefsAndStyles(width, height, textZones, frameInset)}

    <!-- Single outer technical frame with corner brackets -->
    <rect x="28" y="28" width="1144" height="574" stroke="${colors.amberPrimary}" stroke-width="1" stroke-opacity="0.22" fill="none" />
    <path d="M 24 54 L 24 24 L 54 24" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M 1176 54 L 1176 24 L 1146 24" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M 24 576 L 24 606 L 54 606" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M 1176 576 L 1176 606 L 1146 606" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />

    <!-- Availability badge -->
    <g transform="translate(80, 78)">
      <rect width="320" height="36" rx="18" fill="${colors.badgeBg}" stroke="${colors.badgeBorder}" stroke-width="1.2" />
      <circle cx="18" cy="18" r="5" fill="${colors.statusGreen}" filter="url(#glowGreen)" />
      <text x="34" y="22.5" class="font-mono" font-size="11.5" font-weight="700" fill="${colors.textWhite}" letter-spacing="1.1">
        ${escapeXml(profile.badgeText)}
      </text>
    </g>

    <!-- Main Headline -->
    <text x="80" y="200" class="font-sans" font-size="82" font-weight="800" fill="${colors.textWhite}" letter-spacing="-2">
      ${escapeXml(profile.name)}
    </text>

    <!-- Role and Core Specialty -->
    <text x="80" y="258" class="font-sans" font-size="34" font-weight="600" fill="${colors.amberPrimary}" letter-spacing="-0.4">
      ${escapeXml(profile.role)}
    </text>

    <!-- Structured Technical Highlights -->
    <text x="80" y="326" class="font-mono" font-size="20.5" font-weight="500" fill="${colors.textMuted}" letter-spacing="-0.2">
      ${escapeXml(profile.coreStack)}
    </text>
    <text x="80" y="366" class="font-mono" font-size="20.5" font-weight="400" fill="${colors.textDim}" letter-spacing="-0.2">
      ${escapeXml(profile.secondaryStack)}
    </text>

    <!-- Structural Divider -->
    <line x1="80" y1="440" x2="1120" y2="440" stroke="${colors.amberPrimary}" stroke-width="1" stroke-opacity="0.22" />

    <!-- Footer: Domain & Contact -->
    <text x="80" y="520" class="font-mono" font-size="25" font-weight="700" fill="${colors.amberPrimary}" letter-spacing="0.5">
      ${escapeXml(profile.domain)}
    </text>

    <text x="1120" y="520" text-anchor="end" class="font-mono" font-size="21" font-weight="500">
      <tspan fill="${colors.textWhite}">${escapeXml(profile.handle)}</tspan>
      <tspan fill="${colors.amberPrimary}" dx="14">•</tspan>
      <tspan fill="${colors.textMuted}" dx="14">${escapeXml(profile.email)}</tspan>
    </text>
  </svg>
  `;
}

// ============================================================================
// TEMPLATE 2: MULTI-PURPOSE BANNERS (PRISTINE BACKGROUND GRADIENT)
// ============================================================================
function createBannerSvg(width, height, align = "left") {
  const { profile, theme } = CONFIG;
  const { colors } = theme;
  const frameInset = 20;

  const isTall = height >= 500;
  const isSuperTall = height >= 700;

  const fontSizeName = isSuperTall ? 80 : isTall ? 72 : 62;
  const fontSizeSub = isSuperTall ? 40 : isTall ? 36 : 31;
  const fontSizeDesc = isSuperTall ? 23 : isTall ? 21 : 18.5;
  const fontSizeContact = isSuperTall ? 23.5 : isTall ? 21.5 : 19;

  const yName = Math.round(height * (isSuperTall ? 0.3 : isTall ? 0.31 : 0.3));
  const ySub = yName + (isSuperTall ? 66 : isTall ? 58 : 50);
  const yDesc = ySub + (isSuperTall ? 68 : isTall ? 60 : 52);
  const yContact = Math.round(
    height * (isSuperTall ? 0.84 : isTall ? 0.83 : 0.83),
  );

  let anchorAttr = "";
  let transX = 72;

  const contentWidthEst = Math.min(width * 0.7, 1100);
  let textZoneX = 72;

  if (align === "right") {
    transX = width - 72;
    textZoneX = width - 72 - contentWidthEst;
    anchorAttr = 'text-anchor="end"';
  } else if (align === "center") {
    transX = Math.round(width / 2);
    textZoneX = Math.round((width - contentWidthEst) / 2);
    anchorAttr = 'text-anchor="middle"';
  }

  const textZones = [
    {
      x: textZoneX - 16,
      y: Math.round(height * 0.18),
      w: contentWidthEst + 32,
      h: Math.round(height * 0.7),
    },
  ];

  const contentBlock = `
    <g transform="translate(${transX}, 0)">
      <text x="0" y="${yName}" ${anchorAttr} class="font-sans" font-size="${fontSizeName}" font-weight="800" fill="${colors.textWhite}" letter-spacing="-1.5">
        ${escapeXml(profile.name)}
      </text>
      <text x="0" y="${ySub}" ${anchorAttr} class="font-sans" font-size="${fontSizeSub}" font-weight="600" fill="${colors.amberPrimary}" letter-spacing="-0.3">
        ${escapeXml(profile.role)}
      </text>
      <text x="0" y="${yDesc}" ${anchorAttr} class="font-mono" font-size="${fontSizeDesc}" font-weight="400" fill="${colors.textMuted}">
        ${escapeXml(profile.bannerSummary)}
      </text>

      <text x="0" y="${yContact}" ${anchorAttr} class="font-mono" font-size="${fontSizeContact}" font-weight="600">
        <tspan fill="${colors.amberPrimary}" font-weight="700">${escapeXml(profile.domain)}</tspan>
        <tspan fill="${colors.amberPrimary}" dx="14">•</tspan>
        <tspan fill="${colors.textWhite}" dx="14">${escapeXml(profile.handle)}</tspan>
        <tspan fill="${colors.amberPrimary}" dx="14">•</tspan>
        <tspan fill="${colors.textMuted}" dx="14">${escapeXml(profile.email)}</tspan>
      </text>
    </g>
  `;

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" xmlns="http://www.w3.org/2000/svg">
    ${getDefsAndStyles(width, height, textZones, frameInset)}

    <!-- Outer technical frame with corner brackets -->
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" stroke="${colors.amberPrimary}" stroke-width="1" stroke-opacity="0.22" fill="none" />
    <path d="M 16 42 L 16 16 L 42 16" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M ${width - 16} 42 L ${width - 16} 16 L ${width - 42} 16" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M 16 ${height - 42} L 16 ${height - 16} L 42 ${height - 16}" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />
    <path d="M ${width - 16} ${height - 42} L ${width - 16} ${height - 16} L ${width - 42} ${height - 16}" stroke="${colors.amberPrimary}" stroke-width="2.5" fill="none" />

    ${contentBlock}
  </svg>
  `;
}

// ============================================================================
// SUPERSAMPLED RENDERING ENGINE + OPTIMIZED RGB LOSSLESS PIPELINE
// ============================================================================
async function renderOptimizedPng(
  svgString,
  outputPath,
  targetWidth,
  targetHeight,
  keepAlpha = false,
) {
  const { sharpPngOptions } = CONFIG.rendering;

  let rawPng;
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svgString, {
      fitTo: { mode: "width", value: targetWidth },
      dpi: 96,
      shapeRendering: 2,
      textRendering: 2,
      font: {
        loadSystemFonts: true,
        defaultFontFamily: "DejaVu Sans",
        sansSerifFamily: "DejaVu Sans",
        monospaceFamily: "DejaVu Sans Mono",
      },
    });
    const pngData = resvg.render();
    rawPng = Buffer.from(pngData.asPng());
  } catch {
    const buffer = Buffer.from(svgString);
    rawPng = await sharp(buffer, { density: 96 })
      .resize(targetWidth, targetHeight, { fit: "contain" })
      .toBuffer();
  }

  let pipeline = sharp(rawPng);

  // Strip redundant alpha channel on opaque assets to remove ~30% raw byte volume
  if (!keepAlpha) {
    pipeline = pipeline.removeAlpha();
  }

  await pipeline
    .withMetadata({ density: 96 })
    .png(sharpPngOptions)
    .toFile(outputPath);

  try {
    await execFileAsync("oxipng", ["-o", "4", "--strip", "safe", outputPath]);
  } catch {
    // Sharp effort 10 already provides exceptional lossless density
  }

  const stats = await fs.stat(outputPath);
  const kbSize = (stats.size / 1024).toFixed(1);
  console.log(
    `✓ Crisp render: ${path.basename(outputPath)} (${targetWidth}x${targetHeight}) -> ${kbSize} KB`,
  );
}

// ============================================================================
// FAVICON AND MULTI-RESOLUTION ICON GENERATION
// ============================================================================
async function generateFavicons() {
  const { outputDir, faviconSvg } = CONFIG.paths;
  const favicon48Path = path.join(outputDir, "favicon-48x48.png");
  const favicon180Path = path.join(outputDir, "apple-touch-icon.png");
  const icon192Path = path.join(outputDir, "icon-192.png");
  const icon512Path = path.join(outputDir, "icon-512.png");
  const faviconIcoPath = path.join(outputDir, "favicon.ico");

  try {
    const svgBuffer = await fs.readFile(faviconSvg);

    await sharp(svgBuffer, { density: 300 })
      .resize(48, 48, { kernel: sharp.kernel.lanczos3 })
      .png(CONFIG.rendering.sharpPngOptions)
      .toFile(favicon48Path);

    await sharp(svgBuffer, { density: 300 })
      .resize(180, 180, { kernel: sharp.kernel.lanczos3 })
      .png(CONFIG.rendering.sharpPngOptions)
      .toFile(favicon180Path);

    await sharp(svgBuffer, { density: 300 })
      .resize(192, 192, { kernel: sharp.kernel.lanczos3 })
      .png(CONFIG.rendering.sharpPngOptions)
      .toFile(icon192Path);

    await sharp(svgBuffer, { density: 300 })
      .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
      .png(CONFIG.rendering.sharpPngOptions)
      .toFile(icon512Path);

    console.log(
      "✓ Generated: favicon-48x48.png, apple-touch-icon.png, icon-192.png, icon-512.png (supersampled)",
    );

    const args = [
      favicon48Path,
      "-define",
      "icon:auto-resize=48,32,16",
      faviconIcoPath,
    ];

    try {
      await execFileAsync("magick", args);
      console.log("✓ Generated: favicon.ico (via ImageMagick magick)");
    } catch {
      try {
        await execFileAsync("convert", args);
        console.log("✓ Generated: favicon.ico (via ImageMagick convert)");
      } catch (err) {
        console.warn(
          "ℹ️ Note: ImageMagick not available. Multi-resolution favicon.ico compilation skipped.",
        );
      }
    }
  } catch (err) {
    console.warn(
      `ℹ️ File not found: ${faviconSvg}. Favicon generation skipped.`,
    );
  }
}

// ============================================================================
// SYSTEM COMMANDS AND DEPENDENCY VERIFICATION
// ============================================================================
async function checkCommand(cmd, args = ["--version"]) {
  try {
    await execFileAsync(cmd, args);
    return true;
  } catch {
    return false;
  }
}

async function verifyRequirements() {
  const missing = [];

  // 1. Check NPM packages
  try {
    await import("sharp");
  } catch {
    missing.push({
      item: "sharp (npm package)",
      fix: "npm install sharp",
    });
  }

  // 2. Check ImageMagick (magick or convert)
  const hasMagick = await checkCommand("magick", ["-version"]);
  const hasConvert =
    !hasMagick && (await checkCommand("convert", ["-version"]));

  if (!hasMagick && !hasConvert) {
    missing.push({
      item: "ImageMagick (magick / convert)",
      fix: "brew install imagemagick  # macOS\nsudo apt install imagemagick  # Debian/Ubuntu",
    });
  }

  // 3. Check lossless optimizer (oxipng)
  const hasOxipng = await checkCommand("oxipng", ["--version"]);
  if (!hasOxipng) {
    missing.push({
      item: "oxipng (CLI lossless optimizer)",
      fix: "brew install oxipng  # macOS\ncargo install oxipng  # Rust/Linux",
    });
  }

  // 4. Check base favicon template
  try {
    await fs.access(CONFIG.paths.faviconSvg);
  } catch {
    missing.push({
      item: `Required asset: ${CONFIG.paths.faviconSvg}`,
      fix: `Ensure 'favicon.svg' is placed in '${CONFIG.paths.outputDir}'`,
    });
  }

  if (missing.length > 0) {
    console.error(
      "\n❌ ERROR: Missing required dependencies or system tools:\n",
    );
    for (const [index, err] of missing.entries()) {
      console.error(`${index + 1}. [MISSING] ${err.item}`);
      console.error(
        `   👉 Solution:\n   ${err.fix.split("\n").join("\n   ")}\n`,
      );
    }
    process.exit(1);
  }

  console.log(
    "✓ Environment verified: all dependencies and tools are ready.\n",
  );
}

// ============================================================================
// ENTRYPOINT
// ============================================================================
async function main() {
  await verifyRequirements();

  const { outputDir } = CONFIG.paths;
  await fs.mkdir(outputDir, { recursive: true });

  console.log(
    "Starting high-fidelity asset generation with lossless compression...\n",
  );

  // 1. OG Default (1200 x 630) - RGB mode (no alpha)
  await renderOptimizedPng(
    createOgDefaultSvg(),
    path.join(outputDir, "og-default.png"),
    1200,
    630,
    false,
  );

  // 2. Adaptive Banners pruned per SPEC-002 REQ-01 (Asset Pruning & Hygiene)

  // 3. Favicon generation
  await generateFavicons();

  console.log(
    "\nProcess completed successfully. Assets exported to:",
    outputDir,
  );
}

main().catch((err) => {
  console.error("Critical error during asset generation:", err);
  process.exit(1);
});
