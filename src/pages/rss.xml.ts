import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getVisibleCollection } from "@/utils/visibility";

// Static base epoch to compute deterministic timestamps per 'order'.
// Prevents Cloudflare deployments from alerting RSS readers with duplicate items.
const BASE_EPOCH = new Date("2026-01-01T00:00:00Z").getTime();
const DAY_MS = 86_400_000;

export async function GET(context: APIContext) {
  // 1. Fetch all active blog posts (consolidated bilingual feed)
  let blogItems: any[] = [];
  try {
    const posts = await getVisibleCollection("posts");

    if (posts.length > 0) {
      blogItems = posts
        .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
        .map((post) => {
          const isEs = post.data.locale === "es";
          const slug = post.id
            .replace(/^(en|es)\//, "")
            .replace(/\.(md|mdx)$/, "");
          const link = isEs ? `/es/blog/${slug}/` : `/blog/${slug}/`;
          const prefix = isEs ? "[ES] " : "";
          const categories = [
            ...(post.data.category ? [post.data.category] : []),
            ...(Array.isArray(post.data.tags) ? post.data.tags : []),
          ];
          return {
            title: `${prefix}${post.data.title}`,
            pubDate: post.data.pubDate,
            description: post.data.description,
            link,
            categories,
            author: "Arturo Nava (arturo@arturonavax.dev)",
          };
        });
    }
  } catch {
    blogItems = [];
  }

  // 2. If no blog posts exist yet, populate feed with technical projects
  let projectItems: any[] = [];
  if (blogItems.length === 0) {
    try {
      const projects = await getVisibleCollection("projects");

      projectItems = projects
        .sort((a, b) => a.data.order - b.data.order)
        .map((project) => {
          const isEs = project.data.locale === "es";
          const slug = project.id
            .replace(/^(en|es)\//, "")
            .replace(/\.(md|mdx)$/, "");
          const stableDate = new Date(BASE_EPOCH - project.data.order * DAY_MS);

          const stackSuffix =
            project.data.techStack.length > 0
              ? ` [${project.data.techStack.slice(0, 4).join(", ")}]`
              : "";

          return {
            title: `${isEs ? "[ES] " : ""}${project.data.title} - ${project.data.role}`,
            pubDate: stableDate,
            description: `${project.data.description}${stackSuffix}`,
            link: isEs ? `/es/projects/${slug}/` : `/projects/${slug}/`,
            categories: Array.isArray(project.data.techStack)
              ? project.data.techStack
              : [],
            author: "Arturo Nava (arturo@arturonavax.dev)",
          };
        });
    } catch {
      projectItems = [];
    }
  }

  const items = blogItems.length > 0 ? blogItems : projectItems;

  const response = await rss({
    title: "Arturo Nava - Engineering Blog & Systems Notes",
    description:
      "Senior Software / AI Engineer specializing in Go, Rust, Distributed Systems, and Application Security.",
    site: context.site?.origin ?? "https://arturonavax.dev",
    items,
    xmlns: {
      atom: "http://www.w3.org/2005/Atom",
    },
    customData: `<language>en-us</language><atom:link href="https://arturonavax.dev/rss.xml" rel="self" type="application/rss+xml" />`,
  });

  const headers = new Headers(response.headers);
  headers.set(
    "Cache-Control",
    "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
  );

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
