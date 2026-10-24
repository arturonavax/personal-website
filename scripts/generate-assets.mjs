import {
  SOCIAL_PROFILE,
  SOCIAL_THEME,
  SOCIAL_MATRIX,
  SOCIAL_PNG_OPTIONS,
  createSocialBackground as getDefsAndStyles,
  createTechnicalFrame,
} from "./lib/social-style.mjs";
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
// ============================================================================
// CENTRALIZED CONFIGURATION (METADATA, PALETTE, FONTS, AND ENGINE SPECS)
// ============================================================================
const CONFIG = {
  paths: {
    outputDir: path.resolve("public"),
    faviconSvg: path.resolve("public", "favicon.svg"),
  },
  profile: SOCIAL_PROFILE,
  theme: SOCIAL_THEME,
  matrix: SOCIAL_MATRIX,
  rendering: {
    supersampleFactor: 2, // 2x density supersampling for pin-sharp anti-aliasing
    sharpPngOptions: SOCIAL_PNG_OPTIONS,
  },
};

// ============================================================================
// SPATIAL DETECTION UTILITIES
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
    ${createTechnicalFrame(width, height, frameInset)}

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
