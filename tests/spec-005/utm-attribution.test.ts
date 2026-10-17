import { describe, expect, it } from "bun:test";
import { parseAttribution } from "../../cloudflare/worker";

describe("Telemetry Attribution Engine & UTM Hardening (SPEC-005)", () => {
  describe("Standard UTMs and Case-Insensitive Parsing", () => {
    it("correctly parses canonical UTM parameters", () => {
      const url =
        "https://arturonavax.dev/blog/?utm_source=twitter&utm_medium=social&utm_campaign=launch_2026&utm_content=hero_cta&utm_term=developer";
      const result = parseAttribution(url, "https://t.co/xyz123");

      expect(result.source).toBe("twitter");
      expect(result.medium).toBe("social");
      expect(result.campaign).toBe("launch_2026");
      expect(result.content).toBe("hero_cta");
      expect(result.term).toBe("developer");
      expect(result.referrer).toBe("t.co");
    });

    it("handles uppercase and mixed-case query parameters seamlessly", () => {
      const url =
        "https://arturonavax.dev/?UTM_SOURCE=LinkedIn&UTM_MEDIUM=POST&UTM_CAMPAIGN=HIRING";
      const result = parseAttribution(url, null);

      expect(result.source).toBe("linkedin");
      expect(result.medium).toBe("post");
      expect(result.campaign).toBe("HIRING");
    });

    it("resolves parameter aliases when standard UTMs are absent", () => {
      const url1 = "https://arturonavax.dev/?source=newsletter&medium=email";
      expect(parseAttribution(url1, null).source).toBe("newsletter");
      expect(parseAttribution(url1, null).medium).toBe("email");

      const url2 = "https://arturonavax.dev/?ref=producthunt";
      expect(parseAttribution(url2, null).source).toBe("producthunt");

      const url3 = "https://arturonavax.dev/?origin=telegram";
      expect(parseAttribution(url3, null).source).toBe("telegram");

      const url4 = "https://arturonavax.dev/?channel=whatsapp";
      expect(parseAttribution(url4, null).source).toBe("whatsapp");
    });
  });

  describe("Advertising Click IDs Detection", () => {
    it("recognizes Google Ad Click IDs (gclid, gbraid, wbraid, dclid)", () => {
      const resGclid = parseAttribution(
        "https://arturonavax.dev/?gclid=CjwKCAjwsA6_BhBCEiwA5Vv_5g",
        null
      );
      expect(resGclid.source).toBe("google");
      expect(resGclid.medium).toBe("cpc");
      expect(resGclid.content).toBe("CjwKCAjwsA6_BhBCEiwA5Vv_5g");

      const resGbraid = parseAttribution(
        "https://arturonavax.dev/?gbraid=test-gbraid-123",
        null
      );
      expect(resGbraid.source).toBe("google");
      expect(resGbraid.medium).toBe("cpc");

      const resWbraid = parseAttribution(
        "https://arturonavax.dev/?wbraid=test-wbraid-456",
        null
      );
      expect(resWbraid.source).toBe("google");
      expect(resWbraid.medium).toBe("cpc");
    });

    it("recognizes Meta/Facebook click ID (fbclid)", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/?fbclid=IwAR2V8d43_fb",
        null
      );
      expect(res.source).toBe("facebook");
      expect(res.medium).toBe("social");
      expect(res.content).toBe("IwAR2V8d43_fb");
    });

    it("recognizes Bing click ID (msclkid)", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/?msclkid=bing_click_token",
        null
      );
      expect(res.source).toBe("bing");
      expect(res.medium).toBe("cpc");
      expect(res.content).toBe("bing_click_token");
    });

    it("recognizes other ad/platform click IDs", () => {
      expect(parseAttribution("https://arturonavax.dev/?ttclid=tik123", null).source).toBe("tiktok");
      expect(parseAttribution("https://arturonavax.dev/?twclid=tw123", null).source).toBe("x");
      expect(parseAttribution("https://arturonavax.dev/?li_fat_id=li123", null).source).toBe("linkedin");
      expect(parseAttribution("https://arturonavax.dev/?igshid=ig123", null).source).toBe("instagram");
      expect(parseAttribution("https://arturonavax.dev/?mc_cid=mc123", null).source).toBe("mailchimp");
      expect(parseAttribution("https://arturonavax.dev/?mc_cid=mc123", null).medium).toBe("email");
    });
  });

  describe("Mobile Android App Schemes (android-app://)", () => {
    it("maps Google Quick Search Box app to google.com organic", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/",
        "android-app://com.google.android.googlequicksearchbox/https/www.google.com"
      );
      expect(res.referrer).toBe("google.com");
      expect(res.source).toBe("google");
      expect(res.medium).toBe("organic");
    });

    it("maps LinkedIn Android app to linkedin.com social", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/resume/",
        "android-app://com.linkedin.android/"
      );
      expect(res.referrer).toBe("linkedin.com");
      expect(res.source).toBe("linkedin");
      expect(res.medium).toBe("social");
    });

    it("maps Twitter/X, Facebook, and WhatsApp Android apps", () => {
      const resTw = parseAttribution(
        "https://arturonavax.dev/",
        "android-app://com.twitter.android"
      );
      expect(resTw.referrer).toBe("x.com");
      expect(resTw.source).toBe("x");

      const resFb = parseAttribution(
        "https://arturonavax.dev/",
        "android-app://com.facebook.katana"
      );
      expect(resFb.referrer).toBe("facebook.com");
      expect(resFb.source).toBe("facebook");

      const resWa = parseAttribution(
        "https://arturonavax.dev/",
        "android-app://com.whatsapp"
      );
      expect(resWa.referrer).toBe("whatsapp.com");
      expect(resWa.source).toBe("whatsapp");
      expect(resWa.medium).toBe("chat");
    });

    it("handles generic package names cleanly", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/",
        "android-app://com.example.customreader/news/item"
      );
      expect(res.referrer).toBe("com.example.customreader");
      expect(res.source).toBe("com.example.customreader");
    });
  });

  describe("Search Engines, AI Scrapers and Social Referrers", () => {
    it("categorizes organic search engines", () => {
      const resGoogle = parseAttribution(
        "https://arturonavax.dev/",
        "https://www.google.com.mx/"
      );
      expect(resGoogle.referrer).toBe("google.com.mx");
      expect(resGoogle.source).toBe("google");
      expect(resGoogle.medium).toBe("organic");

      const resDdg = parseAttribution(
        "https://arturonavax.dev/",
        "https://duckduckgo.com/"
      );
      expect(resDdg.referrer).toBe("duckduckgo.com");
      expect(resDdg.source).toBe("duckduckgo");
      expect(resDdg.medium).toBe("organic");
    });

    it("categorizes AI search bots and platforms", () => {
      const resPerplexity = parseAttribution(
        "https://arturonavax.dev/",
        "https://www.perplexity.ai/"
      );
      expect(resPerplexity.referrer).toBe("perplexity.ai");
      expect(resPerplexity.source).toBe("perplexity");
      expect(resPerplexity.medium).toBe("ai-search");

      const resChatGpt = parseAttribution(
        "https://arturonavax.dev/",
        "https://chatgpt.com/"
      );
      expect(resChatGpt.referrer).toBe("chatgpt.com");
      expect(resChatGpt.source).toBe("chatgpt");
      expect(resChatGpt.medium).toBe("ai-search");
    });

    it("categorizes developer communities and portals", () => {
      const resGh = parseAttribution(
        "https://arturonavax.dev/",
        "https://github.com/arturonavax"
      );
      expect(resGh.referrer).toBe("github.com");
      expect(resGh.source).toBe("github");
      expect(resGh.medium).toBe("social");

      const resHn = parseAttribution(
        "https://arturonavax.dev/",
        "https://news.ycombinator.com/item?id=4321"
      );
      expect(resHn.referrer).toBe("news.ycombinator.com");
      expect(resHn.source).toBe("hackernews");
      expect(resHn.medium).toBe("community");
    });
  });

  describe("Self-Referrals & Internal Navigation Normalization", () => {
    it("normalizes same-origin and subdomain referrers to Direct", () => {
      const resSame = parseAttribution(
        "https://arturonavax.dev/blog/",
        "https://arturonavax.dev/resume/"
      );
      expect(resSame.referrer).toBe("Direct");
      expect(resSame.source).toBe("direct");

      const resAdmin = parseAttribution(
        "https://arturonavax.dev/",
        "https://admin.arturonavax.dev/"
      );
      expect(resAdmin.referrer).toBe("Direct");
      expect(resAdmin.source).toBe("direct");

      const resLocal = parseAttribution(
        "http://localhost:4321/resume/",
        "http://localhost:4321/experience/"
      );
      expect(resLocal.referrer).toBe("Direct");
      expect(resLocal.source).toBe("direct");
    });
  });

  describe("Fail-Open Invariant: Absolute Ban on 'Invalid' Output", () => {
    it("never returns 'Invalid' when referrer header explicitly contains 'Invalid' or malformed strings", () => {
      const badHeaders = [
        "Invalid",
        "invalid",
        "INVALID",
        "null",
        "undefined",
        "none",
        "Direct",
        "http://",
        "://malformed",
        "ht tp://broken-url",
        "javascript:void(0)",
      ];

      for (const hdr of badHeaders) {
        const res = parseAttribution("https://arturonavax.dev/", hdr);
        expect(res.referrer.toLowerCase()).not.toBe("invalid");
        expect(res.source.toLowerCase()).not.toBe("invalid");
        expect(["direct", hdr.toLowerCase()].includes(res.source.toLowerCase()) || res.source.length > 0).toBe(true);
      }
    });

    it("sanitizes queries explicitly passing utm_source=invalid", () => {
      const res = parseAttribution(
        "https://arturonavax.dev/?utm_source=invalid",
        null
      );
      expect(res.source).toBe("direct");
      expect(res.referrer).toBe("Direct");
    });

    it("handles completely broken URL strings safely without throwing", () => {
      const res = parseAttribution("not a valid url", "not a valid referrer");
      expect(res.referrer.toLowerCase()).not.toBe("invalid");
      expect(res.source.toLowerCase()).not.toBe("invalid");
    });
  });
});
