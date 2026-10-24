import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SOCIAL_IMAGE_WIDTH,
  SOCIAL_IMAGE_HEIGHT,
  socialAvailabilityBanner,
  defaultSocialImageMetadata,
  getSocialImagePath,
  resolveSocialImageUrl,
  extractSocialImageMetadata,
  renderSocialImage,
  wrapSocialText,
  measureSocialText,
  renderSocialImageSvg,
  wrapMeasuredText,
} from "../src/lib/seo/og-image";
import { generateSocialImages } from "../src/integrations/social-images";
import sharp from "sharp";
import { fitSocialText } from "../src/lib/seo/og-image";

const site = "https://arturonavax.dev";
const font = join(process.cwd(), "src/assets/fonts/Geist-OG.json");
const card = {
  title: "Ingeniería sénior & tecnología",
  description: "Sistemas seguros, rápidos y accesibles.",
  locale: "es",
  pathname: "/es/experience/",
};
const html = (path: string, extra = "") =>
  `<html lang="es"><head><title>Ingeniería &amp; tecnología</title><meta name="description" content="Sistemas &quot;seguros&quot;"><meta property="og:image" content="${site}${getSocialImagePath(path)}">${extra}</head></html>`;

describe("route-specific social images", () => {
  it("keeps generated route images in ignored output locations, not Git source assets", async () => {
    const ignore = await readFile(".gitignore", "utf8");
    expect(ignore.split(/\r?\n/)).toContain("dist/");
    expect(ignore.split(/\r?\n/)).toContain("/public/og/");
  });
  it("shares the principal technical frame, Matrix background and opaque lossless output", async () => {
    const glyphs = JSON.parse(await readFile(font, "utf8"));
    const svg = renderSocialImageSvg(card, glyphs);
    expect(svg).toContain('id="bgLinear"');
    expect(svg).toContain('id="glyphBlur"');
    expect(svg).toContain("M 24 54 L 24 24 L 54 24");
    expect(svg).toContain("data-og-identity");
    expect(svg).toContain("data-og-badge");
    const png = await renderSocialImage(card, font);
    const metadata = await sharp(png).metadata();
    expect(metadata.hasAlpha).toBe(false);
    expect(metadata.density).toBe(96);
    expect(metadata.isPalette).toBe(false);
    expect(png.byteLength).toBeLessThan(650 * 1024);
  });
  it("fits long titles, words, URLs and graphemes within measured width and height", async () => {
    const glyphs = JSON.parse(await readFile(font, "utf8"));
    for (const title of [
      "Short title",
      "W".repeat(500),
      "https://example.com/" + "long-path/".repeat(100),
      "Ingeniería y arquitectura ".repeat(60),
      "Cafe\u0301 👨‍👩‍👧‍👦 ".repeat(80),
    ]) {
      const fit = fitSocialText(title, glyphs, {
        maxWidth: 1040,
        maxHeight: 100,
        maxLines: 2,
        maxSize: 38,
        minSize: 26,
      });
      const heading = JSON.parse(
        await readFile("src/assets/fonts/Geist-Bold-OG.json", "utf8"),
      );
      const headingFit = fitSocialText(title, heading, {
        maxWidth: 1040,
        maxHeight: 116,
        maxLines: 2,
        maxSize: 48,
        minSize: 32,
      });
      expect(
        headingFit.lines.length * headingFit.lineHeight,
      ).toBeLessThanOrEqual(116);
      expect(
        headingFit.lines.every(
          (line) =>
            measureSocialText(line, heading, headingFit.fontSize) <= 1040,
        ),
      ).toBe(true);
      expect(fit.lines.length).toBeLessThanOrEqual(2);
      expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(100);
      expect(fit.fontSize).toBeGreaterThanOrEqual(26);
      expect(
        fit.lines.every(
          (line) => measureSocialText(line, glyphs, fit.fontSize) <= 1040,
        ),
      ).toBe(true);
    }
    expect(wrapSocialText("Cafe\u0301", 4, 1)).toEqual(["Café"]);
    expect(measureSocialText("👨‍👩‍👧‍👦", glyphs, 30)).toBe(
      measureSocialText("?", glyphs, 30),
    );
    expect(
      fitSocialText("Short title", glyphs, {
        maxWidth: 1040,
        maxHeight: 100,
        maxLines: 2,
        maxSize: 38,
        minSize: 26,
      }).truncated,
    ).toBe(false);
  });
  it("uses real branded weights and a full-scope visible availability banner", async () => {
    expect([SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT]).toEqual([2400, 1260]);
    const regular = JSON.parse(await readFile(font, "utf8"));
    const bold = JSON.parse(
      await readFile("src/assets/fonts/Geist-Bold-OG.json", "utf8"),
    );
    const mono = JSON.parse(
      await readFile("src/assets/fonts/GeistMono-OG.json", "utf8"),
    );
    expect(bold.family).toBe("Geist");
    expect(bold.weight).toBe(700);
    expect(mono.family).toBe("Geist Mono");
    expect(mono.weight).toBe(600);
    expect(mono.glyphs.W.advance).toBe(mono.glyphs.i.advance);
    expect(mono.glyphs.M.advance).toBe(mono.glyphs.i.advance);
    expect(bold.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bold.decoder).toBe("fontkitten 1.0.3");
    expect(bold.glyphs.A.path).not.toBe(regular.glyphs.A.path);
    const svg = renderSocialImageSvg(card, regular, { openToWork: true });
    expect(svg).toContain('data-og-heading-font="Geist 700"');
    expect(svg).toContain('data-og-detail-font="Geist Mono 600"');
    expect(svg).not.toContain('stroke-width="10"');
    for (const locale of ["en", "es"]) {
      const banner = socialAvailabilityBanner(locale, true);
      expect(banner.available).toBe(true);
      expect(banner.lines).toHaveLength(2);
      expect(banner.lines.join(" ")).toMatch(/Senior/);
      expect(banner.lines.join(" ")).toMatch(/Staff/);
      expect(banner.lines.join(" ")).toMatch(/leadership|liderazgo/i);
      expect(banner.lines.join(" ")).toMatch(/projects|proyectos/i);
      for (const line of banner.lines)
        expect(measureSocialText(line, mono, 17)).toBeLessThanOrEqual(980);
      const closed = socialAvailabilityBanner(locale, false);
      expect(closed.available).toBe(false);
      expect(closed.lines.join(" ")).not.toMatch(
        /available|disponible|open to/i,
      );
      expect(
        renderSocialImageSvg({ ...card, locale }, regular, {
          openToWork: false,
        }),
      ).toContain('data-og-available="false"');
    }
    expect(defaultSocialImageMetadata().pathname).toBe("/");
    expect(defaultSocialImageMetadata("es").locale).toBe("es");
    expect(
      await renderSocialImage(card, font, { openToWork: true }),
    ).not.toEqual(await renderSocialImage(card, font, { openToWork: false }));
  });
  it("maps document routes without collisions, preserving locale and Unicode", () => {
    expect(getSocialImagePath("/")).toBe("/og/index.png");
    expect(getSocialImagePath("/es/")).toBe("/og/es/index.png");
    expect(getSocialImagePath("/blog/niño y código/")).toBe(
      "/og/blog/ni%C3%B1o%20y%20c%C3%B3digo/index.png",
    );
    expect(getSocialImagePath("/index/")).toBe("/og/index/index.png");
    for (const path of [
      "/../secret/",
      "/blog/%2e%2e/",
      "/blog/%2fsecret/",
      "/blog/%5csecret/",
      "/api/x/",
      "/es/admin/",
      "/__admin-vault/",
      "/search/",
      "/404.html",
    ])
      expect(getSocialImagePath(path)).toBeUndefined();
  });
  it("preserves explicit image URLs and uses safe default behavior in dev/private pages", () => {
    const options = {
      pathname: "/es/experience/",
      siteUrl: site,
      production: true,
    };
    expect(resolveSocialImageUrl(options)).toBe(
      `${site}/og/es/experience/index.png`,
    );
    expect(resolveSocialImageUrl({ ...options, production: false })).toBe(
      `${site}/og-default.png`,
    );
    expect(resolveSocialImageUrl({ ...options, noindex: true })).toBe(
      `${site}/og-default.png`,
    );
    expect(
      resolveSocialImageUrl({ ...options, explicitImage: "/custom.png" }),
    ).toBe(`${site}/custom.png`);
    expect(
      resolveSocialImageUrl({
        ...options,
        explicitImage: "https://images.example/card.jpg",
      }),
    ).toBe("https://images.example/card.jpg");
    expect(
      resolveSocialImageUrl({
        ...options,
        explicitImage: "//images.example/card.png",
      }),
    ).toBe("https://images.example/card.png");
  });
  it("reads final HTML metadata and excludes explicit images and noindex documents", () => {
    expect(
      extractSocialImageMetadata(
        html("/es/experience/"),
        "/es/experience/",
        site,
      ),
    ).toEqual({
      title: "Ingeniería & tecnología",
      description: 'Sistemas "seguros"',
      locale: "es",
      pathname: "/es/experience/",
    });
    expect(
      extractSocialImageMetadata(
        html(
          "/es/experience/",
          '<meta name="robots" content="noindex, follow">',
        ),
        "/es/experience/",
        site,
      ),
    ).toBeUndefined();
    expect(
      extractSocialImageMetadata(
        html("/es/experience/").replace(
          `${site}/og/es/experience/index.png`,
          "https://images.example/custom.png",
        ),
        "/es/experience/",
        site,
      ),
    ).toBeUndefined();
  });
  it("wraps long words and only ellipsizes when content really overflows", () => {
    expect(wrapSocialText("one two three four", 8, 2)).toEqual([
      "one two",
      "three…",
    ]);
    expect(wrapSocialText("one two three", 8, 2)).toEqual(["one two", "three"]);
    expect(wrapSocialText("abcdefghij", 4, 3)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("renders deterministic 2400x1260 PNGs with visible local-font glyphs and escaped content", async () => {
    const png = await renderSocialImage(
      { ...card, title: '<script>& "Ingeniería"' },
      font,
    );
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(2400);
    expect(png.readUInt32BE(20)).toBe(1260);
    const glyphMap = JSON.parse(await readFile(font, "utf8"));
    for (const char of "Sénior Ingeniería Tecnología ÁÉÍÓÚÑñ¿¡—…")
      expect(glyphMap.glyphs[char]).toBeDefined();
    expect(measureSocialText("Sénior", glyphMap, 50)).toBeGreaterThan(100);
    const svg = renderSocialImageSvg(card, glyphMap);
    expect(svg).not.toContain("<text");
    expect(svg.match(/<path d=/g)!.length).toBeGreaterThan(30);
    const longLines = wrapMeasuredText(
      "W".repeat(100),
      (value) => measureSocialText(value, glyphMap, 54),
      1040,
      3,
    );
    expect(
      longLines.every((line) => measureSocialText(line, glyphMap, 54) <= 1040),
    ).toBe(true);
    expect(renderSocialImageSvg({ ...card, title: "🧭" }, glyphMap)).toContain(
      "<path",
    );
    expect(await renderSocialImage(card, font)).toEqual(
      await renderSocialImage(card, font),
    );
    expect(
      await renderSocialImage({ ...card, title: "Different title" }, font),
    ).not.toEqual(await renderSocialImage(card, font));
  });
  it("omits the available badge on blog cards and styles at-company title suffixes", async () => {
    const glyphMap = JSON.parse(await readFile(font, "utf8"));
    const blogCard = {
      title: "Building Deterministic Distributed State Machines",
      description:
        "An in-depth guide on first-principles distributed systems design, fault tolerance protocols, and low-latency replication in production Go environments with real-world architectural benchmarks.",
      locale: "en",
      pathname: "/blog/deterministic-state-machines/",
    };
    const blogSvg = renderSocialImageSvg(blogCard, glyphMap);
    expect(blogSvg).not.toContain("data-og-badge");

    const experienceCard = {
      title: "Former Senior Software Engineer at Mercado Libre",
      description: "Production architecture and distributed systems impact.",
      locale: "en",
      pathname: "/experience/mercado-libre/",
    };
    const expSvg = renderSocialImageSvg(experienceCard, glyphMap);
    expect(expSvg).toContain("data-og-badge");
    expect(expSvg).toContain("skewX(-11)");
  });
  it("generates only actual eligible HTML route cards, without replacing explicit images", async () => {
    const dir = await mkdtemp(join(tmpdir(), "social-images-"));
    for (const path of ["", "es", "blog/niño", "admin", "search"]) {
      await mkdir(join(dir, path), { recursive: true });
      const route = path ? `/${path}/` : "/";
      await writeFile(join(dir, path, "index.html"), html(route));
    }
    await mkdir(join(dir, "custom"));
    await writeFile(
      join(dir, "custom/index.html"),
      html("/custom/").replace(
        `${site}/og/custom/index.png`,
        `${site}/custom.png`,
      ),
    );
    const reports: { pathname: string; bytes: number }[] = [];
    const generated = await generateSocialImages(
      dir,
      site,
      font,
      (pathname, bytes) => reports.push({ pathname, bytes }),
    );
    expect(generated).toBe(3);
    expect(reports).toHaveLength(3);
    for (const report of reports) {
      const file = join(dir, decodeURI(report.pathname));
      expect(report.bytes).toBe((await readFile(file)).byteLength);
    }
    // Existing callers without diagnostics retain the same count and PNG bytes.
    const original = await readFile(join(dir, "og/index.png"));
    expect(await generateSocialImages(dir, site, font)).toBe(3);
    expect(await readFile(join(dir, "og/index.png"))).toEqual(original);
    expect(
      (await readFile(join(dir, "og/blog/niño/index.png"))).readUInt32BE(16),
    ).toBe(2400);
  });
});
