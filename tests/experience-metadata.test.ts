import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildExperienceMetadata } from "../src/lib/seo/experience-metadata";

const role = "Senior Software Engineer";
const company = "Example & Co.";

describe("experience current/former metadata", () => {
  it("expresses ended roles in the past in English and Spanish", () => {
    const en = buildExperienceMetadata({
      role,
      company,
      locale: "en",
      endDate: new Date("2024-06-01"),
    });
    const es = buildExperienceMetadata({
      role,
      company,
      locale: "es",
      endDate: new Date("2024-06-01"),
    });
    expect(en.title).toBe(`Ex-${role} at ${company} | Arturo Nava`);
    expect(en.description).toContain(
      `previously worked as ${role} at ${company}`,
    );
    expect(es.title).toBe(`Ex-${role} en ${company} | Arturo Nava`);
    expect(es.description).toContain(`trabajó como ${role} en ${company}`);
  });

  it("keeps roles without an endDate current without implying availability", () => {
    const en = buildExperienceMetadata({ role, company, locale: "en" });
    const es = buildExperienceMetadata({ role, company, locale: "es" });
    expect(en.title).toBe(`${role} at ${company} | Arturo Nava`);
    expect(en.description).toContain(
      `currently works as ${role} at ${company}`,
    );
    expect(es.title).toBe(`${role} en ${company} | Arturo Nava`);
    expect(es.description).toContain(`trabaja como ${role} en ${company}`);
    expect(en.description).not.toMatch(/available|open to/i);
    expect(es.description).not.toMatch(/disponible/i);
  });

  it("retains architecture and optional interactive-simulation discovery", () => {
    for (const locale of ["en", "es"] as const) {
      const common = { role, company, locale };
      const standard = buildExperienceMetadata(common);
      const simulated = buildExperienceMetadata({
        ...common,
        hasSimulations: true,
      });
      expect(standard.title).toBe(simulated.title);
      expect(standard.description).toMatch(/architecture|arquitectura/);
      expect(standard.description).not.toMatch(/interactive|interactivas/);
      expect(simulated.description).toMatch(
        /interactive system simulations|simulaciones interactivas/,
      );
    }
  });

  it("uses one helper for actual page and social metadata without touching navigation", async () => {
    const page = await readFile(
      "src/pages/[...lang]/experience/[slug].astro",
      "utf8",
    );
    expect(page).toMatch(
      /const \{ title: pageTitle, description: pageDescription \} =\s*buildExperienceMetadata\(/,
    );
    expect(page).toContain("endDate,");
    expect(page).toContain("hasSimulations: simulations.length > 0");
    expect(page).toContain("title={pageTitle}");
    expect(page).toContain("description={pageDescription}");
    expect(page).toContain("const pastUrl = pastSlug");
    expect(page).toContain("const futureUrl = futureSlug");
  });
});
