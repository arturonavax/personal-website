import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUTPUT_DIR = path.resolve("public");

// Caracteres seguros con entidades XML
const MATRIX_CHARS = [
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
  "λ",
  "μ",
  "σ",
  "π",
  "&lt;",
  "&gt;",
  "/",
  "{",
  "}",
  "=",
  "+",
  "*",
  "#",
  "_",
  ":",
  ";",
];

// Generador de lluvia Matrix dispersa con gotas de código y cabezales brillantes
function generateMatrixGlyphs(width, height, density = 30) {
  let svg = `<g class="font-mono" font-size="11.5">`;
  const colWidth = width / density;

  for (let i = 0; i < density; i++) {
    // Dispersión: saltar columnas para generar espacios negativos y evitar saturación
    if ((i * 7 + 3) % 4 === 0) continue;

    const x = Math.round(i * colWidth + ((i * 17) % 20));
    const streamLength = 4 + ((i * 11) % 8); // Longitud de la gota: 4 a 11 glifos
    const startY = 32 + ((i * 53) % (height - 190));
    // Opacidad incrementada y calibrada (0.038 - 0.085)
    const baseOpacity = 0.038 + ((i * 19) % 5) * 0.012;

    let col = "";
    for (let j = 0; j < streamLength; j++) {
      const y = startY + j * 21;
      if (y > height - 38) break;
      const char = MATRIX_CHARS[(i * 13 + j * 7) % MATRIX_CHARS.length];

      // El último glifo actúa como "lead droplet" con mayor brillo
      const isLead = j === streamLength - 1;
      const op = isLead
        ? Math.min(0.14, baseOpacity * 1.9).toFixed(3)
        : baseOpacity.toFixed(3);
      const fill = isLead ? "#FDE68A" : "#E5A93C";

      col += `<text x="${x}" y="${y}" opacity="${op}" fill="${fill}">${char}</text>`;
    }
    svg += col;
  }
  svg += `</g>`;
  return svg;
}

function getDefsAndStyles(width, height) {
  return `
  <style>
    .font-sans {
      font-family: "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .font-mono {
      font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
  </style>
  <defs>
    <linearGradient id="bgLinear" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#260205" />
      <stop offset="55%" stop-color="#160103" />
      <stop offset="100%" stop-color="#0E0102" />
    </linearGradient>

    <radialGradient id="vignette" cx="24%" cy="38%" r="78%">
      <stop offset="0%" stop-color="#42060C" stop-opacity="0.45" />
      <stop offset="60%" stop-color="#160103" stop-opacity="0.10" />
      <stop offset="100%" stop-color="#0E0102" stop-opacity="0.88" />
    </radialGradient>

    <filter id="glowGreen" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bgLinear)" />
  <rect width="${width}" height="${height}" fill="url(#vignette)" />
  ${generateMatrixGlyphs(width, height, width > 1300 ? 38 : 28)}
  `;
}

/**
 * 1. OG-DEFAULT (1200 x 630)
 */
function createOgDefaultSvg() {
  const width = 1200;
  const height = 630;

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${getDefsAndStyles(width, height)}

    <rect x="42" y="42" width="1116" height="546" stroke="#E5A93C" stroke-width="1" stroke-opacity="0.22" fill="none" />
    <path d="M 38 66 L 38 38 L 66 38" stroke="#E5A93C" stroke-width="3.5" fill="none" />
    <path d="M 1162 66 L 1162 38 L 1134 38" stroke="#E5A93C" stroke-width="3.5" fill="none" />
    <path d="M 38 564 L 38 592 L 66 592" stroke="#E5A93C" stroke-width="3.5" fill="none" />
    <path d="M 1162 564 L 1162 592 L 1134 592" stroke="#E5A93C" stroke-width="3.5" fill="none" />

    <g transform="translate(84, 88)">
      <rect width="365" height="42" rx="21" fill="#38060B" stroke="#6F151E" stroke-width="1.5" />
      <circle cx="23" cy="21" r="6" fill="#22C55E" filter="url(#glowGreen)" />
      <text x="42" y="26.5" class="font-mono" font-size="12.5" font-weight="700" fill="#F3F4F6" letter-spacing="1.4">
        AVAILABLE FOR SENIOR / STAFF ROLES
      </text>
    </g>

    <text x="84" y="218" class="font-sans" font-size="82" font-weight="800" fill="#FFFFFF" letter-spacing="-2">
      Arturo Nava
    </text>

    <text x="84" y="278" class="font-sans" font-size="34" font-weight="600" fill="#E5A93C" letter-spacing="-0.4">
      Senior Software / AI Engineer
    </text>

    <text x="84" y="342" class="font-mono" font-size="20.5" font-weight="500" fill="#E5E7EB" letter-spacing="-0.2">
      High-Concurrency Distributed Systems • Low-Latency Backends • Go &amp; Rust
    </text>
    <text x="84" y="380" class="font-mono" font-size="20.5" font-weight="400" fill="#9CA3AF" letter-spacing="-0.2">
      Enterprise AI Agents • Autonomous RAG • Zero-Trust • Edge Architecture
    </text>

    <line x1="84" y1="450" x2="1116" y2="450" stroke="#E5A93C" stroke-width="1" stroke-opacity="0.22" />

    <text x="84" y="522" class="font-mono" font-size="25" font-weight="700" fill="#E5A93C" letter-spacing="0.5">
      arturonavax.dev
    </text>

    <text x="1116" y="522" text-anchor="end" class="font-mono" font-size="21" font-weight="500">
      <tspan fill="#F3F4F6">@arturonavax</tspan>
      <tspan fill="#E5A93C" dx="14">•</tspan>
      <tspan fill="#F3F4F6" dx="14">arturonavax@gmail.com</tspan>
    </text>
  </svg>
  `;
}

/**
 * 2. BANNERS MULTIPROPÓSITO (1584 x 396 — Ratio 4:1)
 */
function createBannerSvg(align = "left") {
  const width = 1584;
  const height = 396;

  let contentBlock = "";

  if (align === "left") {
    contentBlock = `
      <g transform="translate(84, 0)">
        <text x="0" y="132" class="font-sans" font-size="58" font-weight="800" fill="#FFFFFF" letter-spacing="-1.5">Arturo Nava</text>
        <text x="0" y="180" class="font-sans" font-size="28" font-weight="600" fill="#E5A93C" letter-spacing="-0.3">Senior Software / AI Engineer</text>
        <text x="0" y="230" class="font-mono" font-size="17" font-weight="500" fill="#D1D5DB">High-Concurrency Distributed Systems • AI Agents • Zero-Trust • Go, Rust &amp; Python</text>

        <text x="0" y="318" class="font-mono" font-size="20" font-weight="600">
          <tspan fill="#E5A93C" font-weight="700">arturonavax.dev</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#FFFFFF" dx="14">@arturonavax</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#F3F4F6" dx="14">arturonavax@gmail.com</tspan>
        </text>
      </g>
    `;
  } else if (align === "right") {
    contentBlock = `
      <g transform="translate(1500, 0)">
        <text x="0" y="132" text-anchor="end" class="font-sans" font-size="58" font-weight="800" fill="#FFFFFF" letter-spacing="-1.5">Arturo Nava</text>
        <text x="0" y="180" text-anchor="end" class="font-sans" font-size="28" font-weight="600" fill="#E5A93C" letter-spacing="-0.3">Senior Software / AI Engineer</text>
        <text x="0" y="230" text-anchor="end" class="font-mono" font-size="17" font-weight="500" fill="#D1D5DB">High-Concurrency Distributed Systems • AI Agents • Zero-Trust • Go, Rust &amp; Python</text>
        
        <text x="0" y="318" text-anchor="end" class="font-mono" font-size="20" font-weight="600">
          <tspan fill="#E5A93C" font-weight="700">arturonavax.dev</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#FFFFFF" dx="14">@arturonavax</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#F3F4F6" dx="14">arturonavax@gmail.com</tspan>
        </text>
      </g>
    `;
  } else {
    contentBlock = `
      <g transform="translate(792, 0)">
        <text x="0" y="132" text-anchor="middle" class="font-sans" font-size="58" font-weight="800" fill="#FFFFFF" letter-spacing="-1.5">Arturo Nava</text>
        <text x="0" y="180" text-anchor="middle" class="font-sans" font-size="28" font-weight="600" fill="#E5A93C" letter-spacing="-0.3">Senior Software / AI Engineer</text>
        <text x="0" y="230" text-anchor="middle" class="font-mono" font-size="17" font-weight="500" fill="#D1D5DB">High-Concurrency Distributed Systems • AI Agents • Zero-Trust • Go, Rust &amp; Python</text>
        
        <text x="0" y="318" text-anchor="middle" class="font-mono" font-size="20" font-weight="600">
          <tspan fill="#E5A93C" font-weight="700">arturonavax.dev</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#FFFFFF" dx="14">@arturonavax</tspan>
          <tspan fill="#E5A93C" dx="14">•</tspan>
          <tspan fill="#F3F4F6" dx="14">arturonavax@gmail.com</tspan>
        </text>
      </g>
    `;
  }

  return `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${getDefsAndStyles(width, height)}

    <rect x="24" y="24" width="1536" height="348" stroke="#E5A93C" stroke-width="1" stroke-opacity="0.22" fill="none" />
    <path d="M 20 46 L 20 20 L 46 20" stroke="#E5A93C" stroke-width="3" fill="none" />
    <path d="M 1564 46 L 1564 20 L 1538 20" stroke="#E5A93C" stroke-width="3" fill="none" />
    <path d="M 20 350 L 20 376 L 46 376" stroke="#E5A93C" stroke-width="3" fill="none" />
    <path d="M 1564 350 L 1564 376 L 1538 376" stroke="#E5A93C" stroke-width="3" fill="none" />

    ${contentBlock}
  </svg>
  `;
}

// Renderizador con cuantización por paleta indexada (PNG-8) para peso mínimo
async function renderOptimizedPng(
  svgString,
  outputPath,
  width,
  height,
  isUltraLight = false,
) {
  const buffer = Buffer.from(svgString);

  const pngOptions = isUltraLight
    ? {
        palette: true, // Cuantización a 8-bit indexado vía libimagequant (~65% menos peso)
        colors: 128, // Suficiente para la paleta oscuro-dorado sin banding perceptible
        effort: 10, // Nivel exhaustivo de compresión Deflate
        compressionLevel: 9,
        adaptiveFiltering: true,
        dither: 0.6,
      }
    : {
        compressionLevel: 9,
        effort: 8,
        adaptiveFiltering: true,
      };

  await sharp(buffer).resize(width, height).png(pngOptions).toFile(outputPath);

  const stats = await fs.stat(outputPath);
  const kbSize = (stats.size / 1024).toFixed(1);
  console.log(
    `✓ Generado: ${path.basename(outputPath)} (${width}x${height}) -> ${kbSize} KB`,
  );
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log("Generando assets gráficos optimizados...");

  // 1. OG Default (1200 x 630) con compresión ultra-ligera (< 50 KB)
  await renderOptimizedPng(
    createOgDefaultSvg(),
    path.join(OUTPUT_DIR, "og-default.png"),
    1200,
    630,
    true,
  );

  // 2. Banners con sufijo de relación de aspecto 4:1 (1584 x 396)
  await renderOptimizedPng(
    createBannerSvg("left"),
    path.join(OUTPUT_DIR, "banner-4x1-left.png"),
    1584,
    396,
  );

  await renderOptimizedPng(
    createBannerSvg("center"),
    path.join(OUTPUT_DIR, "banner-4x1-center.png"),
    1584,
    396,
  );

  await renderOptimizedPng(
    createBannerSvg("right"),
    path.join(OUTPUT_DIR, "banner-4x1-right.png"),
    1584,
    396,
  );

  console.log("\nGeneración completada.");
}

main().catch((err) => {
  console.error("Error al generar imágenes:", err);
  process.exit(1);
});
