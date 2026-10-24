import { z } from "astro/zod";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/locales";

export const postSeriesSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  part: z.number().int().positive(),
});

export type PostSeries = z.infer<typeof postSeriesSchema>;

export interface PostNavigationEntry {
  readonly id: string;
  readonly data: {
    title: string;
    locale: Locale;
    translationKey?: string | undefined;
    canonicalId?: string | undefined;
    series?: PostSeries | undefined;
    draft?: boolean | undefined;
    visible?: boolean | undefined;
  };
}

export interface SeriesLink {
  readonly title: string;
  readonly href: string;
  readonly part: number;
}

export interface SeriesNavigation extends PostSeries {
  readonly previous?: SeriesLink | undefined;
  readonly next?: SeriesLink | undefined;
}

export interface PostNavigation {
  readonly availableLocales: Locale[];
  series?: SeriesNavigation | undefined;
}

/** Build once from collection entries, reusing the caller's visibility policy. */
export function buildPostNavigation<T extends PostNavigationEntry>(
  entries: readonly T[],
  isVisible: (entry: T) => boolean,
): Map<string, PostNavigation> {
  const posts = entries.filter(isVisible);
  const translations = new Map<string, Set<Locale>>();
  const groups = new Map<string, T[]>();
  // Match the existing counterpart resolver: explicit translation keys can
  // connect different slugs; its legacy fallback only maps identical slugs.
  const identity = (post: T) =>
    post.data.translationKey
      ? `translation:${post.data.translationKey}`
      : `route:${post.id.replace(new RegExp(`^${post.data.locale}/`), "").replace(/\.(md|mdx)$/, "")}`;

  for (const post of posts) {
    const locales = translations.get(identity(post)) ?? new Set<Locale>();
    locales.add(post.data.locale);
    translations.set(identity(post), locales);
    if (!post.data.series) continue;
    const groupKey = JSON.stringify([post.data.locale, post.data.series.id]);
    const members = groups.get(groupKey) ?? [];
    members.push(post);
    groups.set(groupKey, members);
  }

  const navigation = new Map<string, PostNavigation>();
  for (const post of posts) {
    navigation.set(post.id, {
      availableLocales: SUPPORTED_LOCALES.filter((locale) =>
        translations.get(identity(post))?.has(locale),
      ),
    });
  }

  const link = (post: T | undefined): SeriesLink | undefined => {
    if (!post?.data.series) return undefined;
    const locale = post.data.locale;
    const slug = post.id
      .replace(new RegExp(`^${locale}/`), "")
      .replace(/\.(md|mdx)$/, "");
    return {
      title: post.data.title,
      href: `${locale === "en" ? "" : `/${locale}`}/blog/${slug}/`,
      part: post.data.series.part,
    };
  };

  for (const members of groups.values()) {
    members.sort((a, b) => a.data.series!.part - b.data.series!.part);
    for (let index = 0; index < members.length; index++) {
      const current = members[index]!;
      const series = current.data.series!;
      if (members[index - 1]?.data.series?.part === series.part) {
        throw new Error(
          `Duplicate blog series part: ${series.id}, ${current.data.locale}, ${series.part}`,
        );
      }
      navigation.get(current.id)!.series = {
        ...series,
        previous: link(members[index - 1]),
        next: link(members[index + 1]),
      };
    }
  }
  return navigation;
}
