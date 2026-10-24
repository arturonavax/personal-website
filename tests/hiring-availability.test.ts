import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { availability } from "../src/config/availability.mjs";
import {
  createHiringPositioning,
  hiringPositioning,
} from "../src/lib/seo/hiring";

describe("build-time hiring availability", () => {
  it("uses one boolean for the published default and retains hiring positioning", () => {
    expect(typeof availability.openToWork).toBe("boolean");
    expect(Object.isFrozen(availability)).toBe(true);
    expect(hiringPositioning).toEqual(
      createHiringPositioning(availability.openToWork),
    );
    expect(hiringPositioning.en.title).toContain("Senior Software Engineer");
    expect(hiringPositioning.es.title).toContain(
      "Ingeniería de Software Senior",
    );
  });

  it("covers senior/staff roles, technology leadership and independent work when open", () => {
    const copy = createHiringPositioning(true);
    expect(copy.en.availability).toContain("Senior / Staff Software Engineer");
    expect(copy.en.availability).toContain("Director of Technology");
    expect(copy.en.availability).toContain("independent");
    expect(copy.es.availability).toContain("Senior / Staff");
    expect(copy.es.availability).toContain("dirección de tecnología");
    expect(copy.es.availability).toContain("independientes");
    for (const locale of ["en", "es"] as const) {
      expect(copy[locale].isAvailable).toBe(true);
      expect(copy[locale].status).toMatch(/AVAILABLE|DISPONIBLE/);
    }
  });

  it("removes open-to-work claims and pulse state in both locales when closed", () => {
    const copy = createHiringPositioning(false);
    for (const locale of ["en", "es"] as const) {
      expect(copy[locale].isAvailable).toBe(false);
      expect(copy[locale].availability).not.toMatch(
        /open to|disponible|opportunities|oportunidades/i,
      );
      expect(copy[locale].description).not.toMatch(
        /opportunities|oportunidades/i,
      );
      expect(copy[locale].title).toBe(
        createHiringPositioning(true)[locale].title,
      );
    }
    expect(copy.en.status).toBe("STATUS: ACTIVE // NOT SEEKING WORK");
    expect(copy.es.status).toBe("ESTADO: ACTIVO // SIN BÚSQUEDA LABORAL");
  });

  it("wires About copy, status and pulse to the same resolved state without hiding contact", async () => {
    const hero = await readFile(
      "src/components/ui/HeroHeaderBanner.astro",
      "utf8",
    );
    expect(hero).toContain("const hiring = hiringPositioning[locale]");
    expect(hero).toContain("{hiring.availability}");
    expect(hero).toContain("{hiring.status}");
    expect(hero).toContain("hiring.isAvailable &&");
    expect(hero).not.toContain('"STATUS: ACTIVE // AVAILABLE"');
    expect(hero).toContain("<ScheduleButton");
    expect(hero).toContain('href="#contact"');
  });
});
