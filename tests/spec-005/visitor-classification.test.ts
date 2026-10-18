import { describe, expect, it } from "bun:test";
import { classifyVisitor } from "../../cloudflare/worker";

describe("Edge Telemetry Visitor Classification Engine (Human vs Bot)", () => {
  describe("Human Browser Verification (Zero False-Positives)", () => {
    it("classifies Chrome on Windows with standard headers as Human", () => {
      const req = new Request("https://arturonavax.dev/blog/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,es;q=0.8",
          "sec-ch-ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("classifies Safari on macOS as Human", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "es-ES,es;q=0.9,en;q=0.8",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("classifies Firefox on Linux as Human", () => {
      const req = new Request("https://arturonavax.dev/experience/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.5",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("classifies Mobile Safari on iPhone as Human", () => {
      const req = new Request("https://arturonavax.dev/resume/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "sec-fetch-dest": "document",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("classifies Chrome on Android as Human", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "es-MX,es;q=0.9,en;q=0.8",
          "sec-ch-ua-mobile": "?1",
          "sec-fetch-dest": "document",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("NEVER classifies Yandex Browser (YaBrowser) as a bot", () => {
      // Yandex Browser User-Agent contains both 'YaBrowser' and 'Yandex/'
      const req = new Request("https://arturonavax.dev/blog/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.1.940 Yandex/24.1.1.940 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ru,en;q=0.9",
          "sec-fetch-dest": "document",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("NEVER classifies CUBOT mobile smartphones as a bot", () => {
      // CUBOT phone has 'CUBOT' in its model build string
      const req = new Request("https://arturonavax.dev/resume/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG POWER Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "es-ES,es;q=0.9",
          "sec-fetch-dest": "document",
        },
      });

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });

    it("classifies regional & alternative browsers (Opera, Samsung Internet, Vivaldi, Edge) as Human", () => {
      const reqOpera = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/113.0.0.0",
          accept: "text/html",
          "accept-language": "en-US",
        },
      });
      expect(classifyVisitor(reqOpera).isBot).toBe(false);

      const reqSamsung = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.6167.101 Mobile Safari/537.36",
          accept: "text/html",
          "accept-language": "en-GB",
        },
      });
      expect(classifyVisitor(reqSamsung).isBot).toBe(false);
    });

    it("classifies in-app WebViews (Facebook, Instagram, LinkedIn mobile apps) as Human", () => {
      const reqInApp = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      expect(classifyVisitor(reqInApp).isBot).toBe(false);
    });
  });

  describe("Search Engine Crawlers & Indexers", () => {
    it("identifies Googlebot", () => {
      const req = new Request("https://arturonavax.dev/blog/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        },
      });
      const res = classifyVisitor(req);
      expect(res.isBot).toBe(true);
      expect(res.classification).toBe("search_crawler");
    });

    it("identifies Bingbot", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        },
      });
      const res = classifyVisitor(req);
      expect(res.isBot).toBe(true);
      expect(res.classification).toBe("search_crawler");
    });

    it("identifies YandexBot search crawler (while keeping YaBrowser human)", () => {
      const req = new Request("https://arturonavax.dev/projects/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
        },
      });
      const res = classifyVisitor(req);
      expect(res.isBot).toBe(true);
      expect(res.classification).toBe("search_crawler");
    });

    it("identifies Baiduspider and DuckDuckBot", () => {
      const reqBaidu = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "Baiduspider+(+http://www.baidu.com/search/spider.htm)" },
      });
      expect(classifyVisitor(reqBaidu).isBot).toBe(true);

      const reqDdg = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)" },
      });
      expect(classifyVisitor(reqDdg).isBot).toBe(true);
    });
  });

  describe("AI Search Engines, Training Crawlers & Scrapers", () => {
    it("identifies GPTBot and ChatGPT-User", () => {
      const reqGpt = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
        },
      });
      expect(classifyVisitor(reqGpt).isBot).toBe(true);
      expect(classifyVisitor(reqGpt).classification).toBe("ai_scraper");

      const reqUser = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)" },
      });
      expect(classifyVisitor(reqUser).isBot).toBe(true);
      expect(classifyVisitor(reqUser).classification).toBe("ai_scraper");
    });

    it("identifies ClaudeBot and Anthropic AI", () => {
      const reqClaude = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
        },
      });
      expect(classifyVisitor(reqClaude).isBot).toBe(true);
      expect(classifyVisitor(reqClaude).classification).toBe("ai_scraper");
    });

    it("identifies PerplexityBot and Bytespider", () => {
      const reqPerp = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
        },
      });
      expect(classifyVisitor(reqPerp).isBot).toBe(true);
      expect(classifyVisitor(reqPerp).classification).toBe("ai_scraper");

      const reqByte = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Bytespider; https://zhanzhang.toutiao.com/)",
        },
      });
      expect(classifyVisitor(reqByte).isBot).toBe(true);
      expect(classifyVisitor(reqByte).classification).toBe("ai_scraper");
    });

    it("identifies Applebot, CCBot, and Cohere", () => {
      const reqApple = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
        },
      });
      expect(classifyVisitor(reqApple).isBot).toBe(true);
      expect(classifyVisitor(reqApple).classification).toBe("ai_scraper");

      const reqCc = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "CCBot/2.0 (https://commoncrawl.org/faq/)" },
      });
      expect(classifyVisitor(reqCc).isBot).toBe(true);
    });
  });

  describe("Social Platform & Link Preview Bots", () => {
    it("identifies facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, and WhatsApp", () => {
      const bots = [
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Twitterbot/1.0",
        "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
        "Slackbot 1.0 (+https://api.slack.com/robots)",
        "TelegramBot (like TwitterBot)",
        "WhatsApp/2.21.12.21 A",
        "Discordbot/2.0; +https://discordapp.com",
      ];

      for (const ua of bots) {
        const req = new Request("https://arturonavax.dev/", {
          headers: { "user-agent": ua },
        });
        const res = classifyVisitor(req);
        expect(res.isBot).toBe(true);
        expect(res.classification).toBe("social_bot");
      }
    });
  });

  describe("Automated CLI Tools, Scripting Libraries & Headless Browsers", () => {
    it("identifies CLI tools (curl, wget)", () => {
      const reqCurl = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "curl/7.88.1" },
      });
      expect(classifyVisitor(reqCurl).isBot).toBe(true);
      expect(classifyVisitor(reqCurl).classification).toBe("automated_client");

      const reqWget = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "Wget/1.21.3" },
      });
      expect(classifyVisitor(reqWget).isBot).toBe(true);
    });

    it("identifies HTTP client libraries (python, aiohttp, httpx, axios, node-fetch, go-http-client)", () => {
      const uas = [
        "python-requests/2.31.0",
        "python-urllib/3.10",
        "aiohttp/3.8.5",
        "httpx/0.24.1",
        "axios/1.6.0",
        "node-fetch/2.6.7",
        "Go-http-client/1.1",
        "PostmanRuntime/7.32.3",
        "Java/17.0.2",
        "Scrapy/2.11.0 (+https://scrapy.org)",
      ];

      for (const ua of uas) {
        const req = new Request("https://arturonavax.dev/", {
          headers: { "user-agent": ua },
        });
        const res = classifyVisitor(req);
        expect(res.isBot).toBe(true);
        expect(res.classification).toBe("automated_client");
      }
    });

    it("identifies headless test automation (HeadlessChrome, Playwright, Puppeteer, Selenium)", () => {
      const headlessUas = [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Playwright)",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Puppeteer",
      ];

      for (const ua of headlessUas) {
        const req = new Request("https://arturonavax.dev/", {
          headers: { "user-agent": ua },
        });
        const res = classifyVisitor(req);
        expect(res.isBot).toBe(true);
        expect(res.classification).toBe("automated_client");
      }
    });

    it("identifies missing or trivial User-Agent without browser headers", () => {
      const reqEmpty = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "" },
      });
      expect(classifyVisitor(reqEmpty).isBot).toBe(true);

      const reqDash = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "-" },
      });
      expect(classifyVisitor(reqDash).isBot).toBe(true);

      const reqNull = new Request("https://arturonavax.dev/", {
        headers: { "user-agent": "null" },
      });
      expect(classifyVisitor(reqNull).isBot).toBe(true);
    });

    it("detects spoofed browser headers lacking standard browser navigation stack", () => {
      // Scraper spoofing Chrome UA but sending Accept: */* and omitting Accept-Language & Sec-Fetch headers
      const reqSpoof = new Request("https://arturonavax.dev/blog/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "*/*",
        },
      });

      const res = classifyVisitor(reqSpoof);
      expect(res.isBot).toBe(true);
      expect(res.classification).toBe("automated_client");
      expect(res.reason).toBe("spoofed_browser_missing_headers");
    });
  });

  describe("Cloudflare Edge-Native Signals (request.cf)", () => {
    it("respects Cloudflare verifiedBot = true", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent": "Custom-Search-Crawler/1.0",
        },
      });
      (req as any).cf = { verifiedBot: true };

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(true);
      expect(res.classification).toBe("verified_bot");
    });

    it("respects Cloudflare Bot Management low score (< 30)", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      (req as any).cf = {
        botManagement: {
          score: 12, // Automated bot
        },
      };

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(true);
      expect(res.reason).toBe("cf_bot_score_low");
    });

    it("respects Cloudflare Bot Management high score (>= 80) as Human", () => {
      const req = new Request("https://arturonavax.dev/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
        },
      });
      (req as any).cf = {
        botManagement: {
          score: 95, // Verified human
        },
      };

      const res = classifyVisitor(req);
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });
  });

  describe("Vulnerability Scanner & Exploit Path Filtering", () => {
    it("classifies spoofed Chrome requests targeting /.env as Bot", () => {
      const req = new Request("https://arturonavax.dev/.env", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
        },
      });
      const res = classifyVisitor(req, "/.env");
      expect(res.isBot).toBe(true);
      expect(res.reason).toBe("vulnerability_scanner_path_probe");
    });

    it("classifies requests to WordPress administration probes as Bot", () => {
      const req = new Request("https://arturonavax.dev/wp-login.php", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 Safari/605.1.15",
        },
      });
      const res = classifyVisitor(req, "/wp-login.php");
      expect(res.isBot).toBe(true);
    });

    it("preserves legitimate human navigation on valid content paths", () => {
      const req = new Request("https://arturonavax.dev/blog/", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
          "accept-language": "en-US,en;q=0.9",
          "sec-fetch-dest": "document",
        },
      });
      const res = classifyVisitor(req, "/blog/");
      expect(res.isBot).toBe(false);
      expect(res.classification).toBe("human");
    });
  });
});
