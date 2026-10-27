import { coarseDeviceOs } from "./d1-telemetry.adapter";

// Raw dimensions can express uncertainty; legacy aggregate buckets cannot.
export function rawDeviceOs(ua: string, hintedDevice?: string) {
  const coarse = coarseDeviceOs(ua, hintedDevice);
  const knownOs = coarse.os !== "other";
  const knownDesktop = /windows|macintosh|mac os x|linux/i.test(ua);
  const knownMobile = /mobile|android|iphone|ipad|ipod/i.test(ua);
  return {
    device:
      hintedDevice === "desktop" || hintedDevice === "mobile"
        ? hintedDevice
        : knownMobile
          ? "mobile"
          : knownDesktop
            ? "desktop"
            : "unknown",
    os: knownOs ? coarse.os : "unknown",
  };
}

const languageTag =
  /^[a-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-[A-Za-z0-9]{5,8}){0,2}$/;
function languagePreference(value: string) {
  const first = value.split(",", 1)[0]?.trim() || "";
  const match =
    /^([^;]{2,35})(?:;\s*q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?$/i.exec(first);
  const tag = match?.[1] ?? "";
  return languageTag.test(tag) ? tag : "unknown";
}

/** Only allow fixed, bounded categories; never persist a raw UA or language header. */
export function visitDimensions(request: Request) {
  const cf = (
    request as Request & {
      cf?: { country?: unknown; region?: unknown; regionCode?: unknown };
    }
  ).cf;
  const country =
    typeof cf?.country === "string" && /^[A-Z]{2}$/.test(cf.country)
      ? cf.country
      : "XX";
  const regionCandidate = cf?.regionCode ?? cf?.region;
  const region =
    typeof regionCandidate === "string" &&
    /^[\p{L}\p{N} .'-]{1,64}$/u.test(regionCandidate)
      ? regionCandidate
      : "unknown";
  const ua = (request.headers.get("user-agent") || "").slice(0, 256);
  const { device, os } = rawDeviceOs(ua);
  const browser = /(?:Edg|EdgA|EdgiOS)\//i.test(ua)
    ? "edge"
    : /(?:Firefox|FxiOS)\//i.test(ua)
      ? "firefox"
      : /(?:Chrome|CriOS)\//i.test(ua)
        ? "chrome"
        : /Safari\//i.test(ua)
          ? "safari"
          : "unknown";
  const browserLanguage = languagePreference(
    request.headers.get("accept-language") || "",
  );
  return {
    country,
    region,
    osType: os,
    deviceType: device,
    browser,
    browserLanguage,
  };
}

/** Validate legacy WAL as well as new records before binding D1 parameters. */
export function storedVisitDimensions(value: Record<string, unknown>) {
  const country =
    typeof value.country === "string" && /^[A-Z]{2}$/.test(value.country)
      ? value.country
      : "XX";
  const region =
    typeof value.region === "string" &&
    /^[\p{L}\p{N} .'-]{1,64}$/u.test(value.region)
      ? value.region
      : "unknown";
  const osType =
    typeof value.os_type === "string" &&
    [
      "windows",
      "macos",
      "ios",
      "android",
      "linux",
      "other",
      "unknown",
    ].includes(value.os_type)
      ? value.os_type
      : "unknown";
  const deviceType =
    value.device_type === "mobile"
      ? "mobile"
      : value.device_type === "desktop"
        ? "desktop"
        : "unknown";
  const browser =
    typeof value.browser === "string" &&
    ["edge", "firefox", "chrome", "safari"].includes(value.browser)
      ? value.browser
      : "unknown";
  const browserLanguage =
    typeof value.browser_language === "string" &&
    languageTag.test(value.browser_language)
      ? value.browser_language
      : "unknown";
  return { country, region, osType, deviceType, browser, browserLanguage };
}
