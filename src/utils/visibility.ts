import {
  getCollection,
  type CollectionKey,
  type CollectionEntry,
} from "astro:content";

export interface VisibilityConfig {
  draft?: boolean | undefined;
  visible?: boolean | undefined;
}

/**
 * Universal visibility predicate.
 *
 * An item is visible at Astro compile time IF AND ONLY IF:
 * - `draft` is NOT true
 * - `visible` is NOT false
 *
 * If either `draft: true` or `visible: false` is set on the item (or on `item.data`),
 * it is considered hidden and will be completely excluded from public exposure.
 */
export function isItemVisible(
  item: VisibilityConfig | { data: VisibilityConfig } | null | undefined,
): boolean {
  if (!item) return false;
  const target: VisibilityConfig =
    "data" in item && typeof item.data === "object" && item.data !== null
      ? (item.data as VisibilityConfig)
      : (item as VisibilityConfig);

  if (target.draft === true) return false;
  if (target.visible === false) return false;
  return true;
}

/**
 * Astro Content Layer helper: queries a collection and automatically filters out
 * all draft or non-visible entries at the SSG compilation level.
 *
 * Guarantees that static routes, index pages, RSS feeds, search documents, and
 * metadata schemas never generate or link to unpublished content.
 */
export async function getVisibleCollection<C extends CollectionKey>(
  collection: C,
  filter?: (entry: CollectionEntry<C>) => boolean,
): Promise<CollectionEntry<C>[]> {
  return getCollection(collection, (entry) => {
    if (!isItemVisible(entry)) return false;
    return filter ? filter(entry) : true;
  });
}
