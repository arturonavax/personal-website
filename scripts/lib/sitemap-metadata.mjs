/** Keep sitemap language signals aligned with the HTML crawlers actually receive. */
export function isIndexableSitemapPath(pathname) {
  return !/^\/(?:es\/)?(?:admin|search|404|api|__admin-vault)(?:\/|$)/.test(
    pathname,
  );
}

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
      ([, key, double, single]) => [
        key.toLowerCase(),
        (double ?? single).replaceAll("&amp;", "&"),
      ],
    ),
  );
}

function validDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function serializeVerifiedSitemapItem(item, html, contentDate) {
  const url = new URL(item.url);
  if (!isIndexableSitemapPath(url.pathname)) return undefined;
  const head = html.split(/<\/head>/i)[0];
  const tags = [...head.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map(([tag]) =>
    attributes(tag),
  );
  if (
    tags.some(
      (tag) =>
        tag.name?.toLowerCase() === "robots" &&
        /\bnoindex\b/i.test(tag.content ?? ""),
    )
  )
    return undefined;
  const canonical = tags.find((tag) => tag.rel === "canonical")?.href;
  if (canonical && canonical !== item.url) return undefined;
  const links = tags
    .filter(
      (tag) =>
        tag.rel === "alternate" &&
        ["en", "es", "x-default"].includes(tag.hreflang) &&
        tag.href,
    )
    .map((tag) => ({ lang: tag.hreflang, url: tag.href }));
  const modified = tags.find(
    (tag) => tag.property === "article:modified_time",
  )?.content;
  const published = tags.find(
    (tag) => tag.property === "article:published_time",
  )?.content;
  return {
    ...item,
    links,
    lastmod:
      validDate(modified) ?? validDate(contentDate) ?? validDate(published),
  };
}
