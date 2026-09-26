import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = await getCollection(
    "posts",
    ({ data }) => data.locale === "es" && !data.draft,
  );
  const sortedPosts = posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  return rss({
    title: "Arturo Nava — Ensayos Técnicos & Notas de Sistemas",
    description:
      "Ingeniero de Software Senior / IA especializado en Go, Rust, Sistemas Distribuidos y Seguridad de Aplicaciones.",
    site: context.site?.origin ?? "https://arturonavax.com",
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/es/blog/${post.id.replace(/^es\//, "").replace(/\.(md|mdx)$/, "")}`,
    })),
    customData: `<language>es-es</language>`,
  });
}
