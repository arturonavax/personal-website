import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildPostNavigation,
  postSeriesSchema,
  type PostNavigationEntry,
} from "../src/lib/content/post-series";

const visible = (entry: PostNavigationEntry) =>
  entry.data.draft !== true && entry.data.visible !== false;
function post(
  slug: string,
  part?: number,
  locale: "en" | "es" = "en",
): PostNavigationEntry {
  return {
    id: `${locale}/${slug}`,
    data: {
      title: slug,
      locale,
      translationKey: slug,
      ...(part === undefined
        ? {}
        : {
            series: { id: "systems", title: "Systems", part },
          }),
    },
  };
}

describe("published locale-local blog series", () => {
  it("resolves first, middle and last parts in authored order, regardless of input order", () => {
    const first = post("first", 1);
    const middle = post("middle", 2);
    const last = post("last", 3);
    const index = buildPostNavigation([last, first, middle], visible);
    expect(index.get(first.id)?.series).toMatchObject({
      id: "systems",
      title: "Systems",
      part: 1,
      next: { title: "middle", href: "/blog/middle/", part: 2 },
    });
    expect(index.get(first.id)?.series?.previous).toBeUndefined();
    expect(index.get(middle.id)?.series).toMatchObject({
      previous: { href: "/blog/first/" },
      next: { href: "/blog/last/" },
    });
    expect(index.get(last.id)?.series?.previous?.href).toBe("/blog/middle/");
    expect(index.get(last.id)?.series?.next).toBeUndefined();
  });

  it("skips unpublished siblings and gaps without leaking titles or renumbering parts", () => {
    const first = post("first", 1);
    const hidden = post("private", 2);
    hidden.data.visible = false;
    const draft = post("draft", 3);
    draft.data.draft = true;
    const last = post("last", 5);
    const index = buildPostNavigation([first, hidden, draft, last], visible);
    expect([...index.keys()]).toEqual([first.id, last.id]);
    expect(index.get(first.id)?.series?.next).toEqual({
      title: "last",
      href: "/blog/last/",
      part: 5,
    });
    expect(index.get(last.id)?.series?.part).toBe(5);
    expect(JSON.stringify([...index.values()])).not.toMatch(/private|draft/);
  });

  it("keeps standalone posts unchanged and never joins another locale or series", () => {
    const standalone = post("note");
    const en = post("one", 1);
    const es = post("uno", 2, "es");
    const other = post("other", 2);
    other.data.series!.id = "other";
    const index = buildPostNavigation([standalone, en, es, other], visible);
    expect(index.get(standalone.id)).toEqual({ availableLocales: ["en"] });
    expect(index.get(en.id)?.series?.next).toBeUndefined();
    expect(index.get(es.id)?.series?.previous).toBeUndefined();
  });

  it("uses localized route IDs for previous/next, including nested Markdown IDs", () => {
    const first = post("topic/uno.md", 1, "es");
    const last = post("topic/dos.mdx", 2, "es");
    const index = buildPostNavigation([first, last], visible);
    expect(index.get(first.id)?.series?.next?.href).toBe("/es/blog/topic/dos/");
    expect(index.get(last.id)?.series?.previous?.href).toBe(
      "/es/blog/topic/uno/",
    );
  });

  it("rejects ambiguous published part numbers, but not hidden duplicates or translated parts", () => {
    const first = post("one", 1);
    const duplicate = post("duplicate", 1);
    expect(() => buildPostNavigation([first, duplicate], visible)).toThrow(
      /systems.*en.*1/,
    );
    duplicate.data.draft = true;
    expect(() =>
      buildPostNavigation([first, duplicate, post("uno", 1, "es")], visible),
    ).not.toThrow();
  });
});

describe("blog locale availability and schema", () => {
  it("retains legacy same-slug translations without advertising unsupported different-slug canonical IDs", () => {
    const en = post("shared");
    const es = post("shared", undefined, "es");
    delete en.data.translationKey;
    delete es.data.translationKey;
    expect(
      buildPostNavigation([en, es], visible).get(en.id)?.availableLocales,
    ).toEqual(["en", "es"]);
    const different = post("otro", undefined, "es");
    delete different.data.translationKey;
    en.data.canonicalId = different.data.canonicalId = "same-entity";
    expect(
      buildPostNavigation([en, different], visible).get(en.id)
        ?.availableLocales,
    ).toEqual(["en"]);
  });
  it("matches visible translation identity rather than localized slugs", () => {
    const en = post("distributed-systems");
    const es = post("sistemas-distribuidos", undefined, "es");
    es.data.translationKey = en.data.translationKey;
    const unrelated = post("distributed-systems", undefined, "es");
    unrelated.data.translationKey = "unrelated";
    const index = buildPostNavigation([en, es, unrelated], visible);
    expect(index.get(en.id)?.availableLocales).toEqual(["en", "es"]);
    expect(index.get(es.id)?.availableLocales).toEqual(["en", "es"]);
    es.data.visible = false;
    expect(
      buildPostNavigation([en, es], visible).get(en.id)?.availableLocales,
    ).toEqual(["en"]);
    expect(index.get(unrelated.id)?.availableLocales).toEqual(["es"]);
  });

  it("accepts an optional series and rejects empty IDs/titles or non-positive/non-integer parts", () => {
    expect(postSeriesSchema.optional().parse(undefined)).toBeUndefined();
    expect(
      postSeriesSchema.parse({ id: " systems ", title: " Systems ", part: 2 }),
    ).toEqual({
      id: "systems",
      title: "Systems",
      part: 2,
    });
    for (const part of [0, -1, 1.5, "2"]) {
      expect(
        postSeriesSchema.safeParse({ id: "systems", title: "Systems", part })
          .success,
      ).toBe(false);
    }
    for (const value of [
      { id: " ", title: "Systems", part: 1 },
      { id: "systems", title: "", part: 1 },
    ]) {
      expect(postSeriesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("wires dual server-rendered pagination and existing article metadata without altering canonical policy", () => {
    const page = readFileSync("src/pages/[...lang]/blog/[slug].astro", "utf8");
    expect(page).toContain('getVisibleCollection("posts")');
    expect(page).toContain("buildPostNavigation(posts, isItemVisible)");
    expect(page.indexOf('position="start"')).toBeLessThan(
      page.indexOf("<Content />"),
    );
    expect(page.indexOf('position="end"')).toBeGreaterThan(
      page.indexOf("<Content />"),
    );
    expect(page).toContain(
      "updatedDate={post.data.updatedDate ?? post.data.updatedAt}",
    );
    expect(page).toContain(
      "const canonicalUrl = `${siteUrl}${normalizedPath}`",
    );
    expect(readFileSync("src/content.config.ts", "utf8")).toContain(
      "series: postSeriesSchema.optional()",
    );
  });
});
