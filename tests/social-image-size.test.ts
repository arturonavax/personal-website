import { describe, expect, it } from "bun:test";
import {
  SOCIAL_IMAGE_RECOMMENDED_BYTES,
  assessSocialImageSize,
} from "../src/lib/seo/social-image-size";

describe("social-image build size diagnostics", () => {
  it("marks the inclusive 300 kB local preview budget with a check and exact bytes", () => {
    expect(SOCIAL_IMAGE_RECOMMENDED_BYTES).toBe(300_000);
    expect(assessSocialImageSize("/og/index.png", 300_000)).toEqual({
      ok: true,
      line: "✓ /og/index.png — 300.0 kB (300000 bytes) — within 300 kB preview budget",
    });
  });
  it("marks oversized PNGs with a cross instead of claiming platform compatibility", () => {
    expect(assessSocialImageSize("/og-default.png", 300_001)).toEqual({
      ok: false,
      line: "✗ /og-default.png — 300.0 kB (300001 bytes) — exceeds 300 kB preview budget",
    });
  });
});
