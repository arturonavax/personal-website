import { describe, expect, it } from "bun:test";
import {
  SOCIAL_PROFILE,
  SOCIAL_THEME,
  SOCIAL_PNG_OPTIONS,
  createSocialBackground,
  createTechnicalFrame,
} from "../scripts/lib/social-style.mjs";

describe("shared principal social style", () => {
  it("retains the principal palette and frame geometry", () => {
    expect(SOCIAL_PROFILE.name).toBe("Arturo Nava");
    expect(SOCIAL_THEME.colors.amberPrimary).toBe("#D48B38");
    const frame = createTechnicalFrame(1200, 630);
    expect(frame).toContain('x="28" y="28" width="1144" height="574"');
    expect(frame).toContain("M 24 54 L 24 24 L 54 24");
    expect(frame).toContain("M 1176 576 L 1176 606 L 1146 606");
  });
  it("keeps deterministic Matrix styling and glyph-only blur behind text", () => {
    const zones = [{ x: 70, y: 70, w: 1050, h: 450 }];
    const background = createSocialBackground(1200, 630, zones);
    expect(background).toContain('id="bgLinear"');
    expect(background).toContain('filter="url(#glyphBlur)"');
    expect(background).toContain('stdDeviation="1.6"');
    expect(background).toBe(createSocialBackground(1200, 630, zones));
  });
  it("shares the principal non-quantized lossless PNG options", () => {
    expect(SOCIAL_PNG_OPTIONS).toEqual({
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: true,
      palette: false,
    });
  });
});
