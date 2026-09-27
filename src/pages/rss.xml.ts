import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

// Fecha base estática para calcular timestamps consistentes según 'order'.
// Evita que cada despliegue en Cloudflare alerte a los lectores RSS con artículos duplicados.
const BASE_EPOCH = new Date("2026-01-01T00:00:00Z").getTime();
const DAY_MS = 86_400_000;

export async function GET(context: APIContext) {
  // 1. Intentar obtener artículos de blog reales si existen
  let blogItems: any[] = [];
  try {
    const posts = await getCollection(
      "posts",
      ({ data }) => data.locale === "en" && !data.draft,
    );

    if (posts.length > 0) {
      blogItems = posts
        .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
        .map((post) => ({
          title: post.data.title,
          pubDate: post.data.pubDate,
          description: post.data.description,
          link: `/blog/${post.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "")}/`,
        }));
    }
  } catch {
    blogItems = [];
  }

  // 2. Si no hay posts aún, poblar el feed con los proyectos técnicos
  let projectItems: any[] = [];
  if (blogItems.length === 0) {
    try {
      const projects = await getCollection(
        "projects",
        ({ data }) => data.locale === "en",
      );

      projectItems = projects
        .sort((a, b) => a.data.order - b.data.order)
        .map((project) => {
          // Genera una fecha fija decreciente: order 1 = más reciente
          const stableDate = new Date(BASE_EPOCH - project.data.order * DAY_MS);

          const stackSuffix =
            project.data.techStack.length > 0
              ? ` [${project.data.techStack.slice(0, 4).join(", ")}]`
              : "";

          return {
            title: `${project.data.title} — ${project.data.role}`,
            pubDate: stableDate,
            description: `${project.data.description}${stackSuffix}`,
            link: `/projects/${project.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "")}/`,
          };
        });
    } catch {
      projectItems = [];
    }
  }

  const items = blogItems.length > 0 ? blogItems : projectItems;

  return rss({
    title: "Arturo Nava — Technical Essays & Systems Notes",
    description:
      "Senior Software / AI Engineer specializing in Go, Rust, Distributed Systems, and Application Security.",
    site: context.site?.origin ?? "https://arturonavax.dev",
    items,
    customData: `<language>en-us</language>`,
  });
}
