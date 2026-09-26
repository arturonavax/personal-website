import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = await getCollection(
    "posts",
    ({ data }) => data.locale === "en" && !data.draft,
  );
  const sortedPosts = posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  return rss({
    title: "Arturo Nava — Technical Essays & Systems Notes",
    description:
      "Senior Software / AI Engineer specializing in Go, Rust, Distributed Systems, and Application Security.",
    site: context.site?.origin ?? "https://arturonavax.com",
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blog/${post.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "")}`,
    })),
    customData: `<language>en-us</language>`,
  });
}
