// Offline build-source maintenance: use Astro's pinned decoder, never host fonts.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve("astro/package.json"));
const decoderUrl = pathToFileURL(astroRequire.resolve("fontkitten"));
const decoder = JSON.parse(
  await readFile(new URL("../package.json", decoderUrl), "utf8"),
);
if (decoder.version !== "1.0.3")
  throw new Error(
    "Revalidate WOFF2 variation extraction for the installed decoder before regenerating font resources.",
  );
const { create } = await import(decoderUrl);
const root = new URL("../", import.meta.url);
const alphabet = Object.keys(
  JSON.parse(
    await readFile(new URL("src/assets/fonts/Geist-OG.json", root), "utf8"),
  ).glyphs,
);
for (const [family, source, weight, output] of [
  ["Geist", "public/fonts/Geist-Variable.woff2", 700, "Geist-Bold-OG.json"],
  [
    "Geist Mono",
    "public/fonts/GeistMono-Variable.woff2",
    600,
    "GeistMono-OG.json",
  ],
]) {
  const sourceBytes = await readFile(new URL(source, root));
  const variable = create(sourceBytes);
  // fontkitten 1.0.3 getVariation() loses the WOFF2 subclass. Its inherited
  // constructor accepts design coordinates, retaining compressed-glyph decoding.
  // Keep this workaround offline and pinned; verify extracted weights in tests.
  const coordinates = Object.entries(variable.variationAxes).map(
    ([tag, axis]) => (tag === "wght" ? weight : axis.default),
  );
  // Decode WOFF2 composite records at default coordinates once. The decoder's
  // private composite method cannot run with a variation-enabled plain receiver.
  // Individual glyph outlines apply the selected variation afterward.
  variable.glyphForCodePoint(65).path.toSVG();
  const fresh = create(sourceBytes);
  fresh.stream.pos = 0;
  const font = new fresh.constructor(fresh.stream, coordinates);
  // WOFF2Glyph bypasses TTFFont's gvar application. Apply the decoder's own
  // variation processor to copied point/component records before path emission.
  const Point = variable._transformedGlyphs.find(
    (record) => record.points?.length,
  ).points[0].constructor;
  font._transformedGlyphs = variable._transformedGlyphs.map((record, id) => {
    const copy = { ...record };
    if (!record.points?.length && !record.components?.length) return copy;
    const glyph = variable.getGlyph(id);
    const bounds = glyph.bbox;
    const metrics = glyph._getMetrics();
    const points = record.points
      ? record.points.map((point) => point.copy())
      : record.components.map(
          (component) => new Point(true, true, component.dx, component.dy),
        );
    const origin = bounds.minX - metrics.leftBearing;
    points.push(
      new Point(false, true, origin, 0),
      new Point(false, true, origin + metrics.advanceWidth, 0),
      new Point(false, true, 0, bounds.maxY + metrics.topBearing),
      new Point(
        false,
        true,
        0,
        bounds.maxY + metrics.topBearing + metrics.advanceHeight,
      ),
    );
    font._variationProcessor.transformPoints(id, points);
    points.splice(-4);
    if (record.points) copy.points = points;
    else
      copy.components = record.components.map((component, index) => ({
        ...component,
        dx: points[index].x,
        dy: points[index].y,
      }));
    return copy;
  });
  const glyphs = {};
  for (const char of alphabet) {
    if (!font.hasGlyphForCodePoint(char.codePointAt(0))) continue;
    const glyph = font.glyphForCodePoint(char.codePointAt(0));
    const path = glyph.path.toSVG();
    if (!Number.isFinite(glyph.advanceWidth) || /NaN|Infinity/.test(path))
      throw new Error(`Invalid ${family} glyph: ${char}`);
    glyphs[char] = { advance: glyph.advanceWidth, path };
  }
  const destination = new URL(`src/assets/fonts/${output}`, root);
  await writeFile(
    destination,
    JSON.stringify({
      family,
      source,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      decoder: `fontkitten ${decoder.version}`,
      weight,
      unitsPerEm: font.unitsPerEm,
      ascent: font.ascent,
      descent: font.descent,
      glyphs,
    }) + "\n",
  );
  console.log(
    `${fileURLToPath(destination)}: ${Object.keys(glyphs).length} glyphs`,
  );
}
