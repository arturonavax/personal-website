import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { getCollection } from "astro:content";
import { hasResume, resolveResumePath } from "@/data/resume";

export const prerender = true;

export const GET: APIRoute = async () => {
  let content = "";

  // 1. Core Profile & Extended Resume
  if (hasResume) {
    const resumePath =
      resolveResumePath("en") ||
      path.resolve("./src/content/resume/ArturoNava-Resume-en.md");
    if (fs.existsSync(resumePath)) {
      content += fs.readFileSync(resumePath, "utf-8");
      content += "\n\n---\n\n";
    }
  }

  // 2. Published Projects Catalog
  try {
    const projects = await getCollection("projects");
    const enProjects = projects.filter(
      (p) =>
        !p.data.draft && p.data.visible !== false && p.id.startsWith("en/"),
    );

    if (enProjects.length > 0) {
      content += "# Production Architecture & Systems Projects\n\n";
      for (const proj of enProjects) {
        const slug = proj.id.replace(/^en\//, "").replace(/\.md$/, "");
        content += `## ${proj.data.title}\n`;
        content += `- URL: https://arturonavax.dev/projects/${slug}/\n`;
        if (proj.data.company)
          content += `- Organization: ${proj.data.company}\n`;
        if (proj.data.role) content += `- Role: ${proj.data.role}\n`;
        if (proj.data.techStack?.length) {
          content += `- Technologies: ${proj.data.techStack.join(", ")}\n`;
        }
        content += `- Summary: ${proj.data.description}\n\n`;
      }
      content += "---\n\n";
    }
  } catch (err) {
    console.error("[llms-full.txt:projects error]", err);
  }

  // 3. Engineering Deep Dives & Systems Notes
  try {
    const posts = await getCollection("posts");
    const enPosts = posts.filter(
      (p) =>
        !p.data.draft && p.data.visible !== false && p.id.startsWith("en/"),
    );

    if (enPosts.length > 0) {
      content += "# Engineering Blog & Deep-Dive Essays\n\n";
      for (const post of enPosts) {
        const slug = post.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "");
        content += `## ${post.data.title}\n`;
        content += `- URL: https://arturonavax.dev/blog/${slug}/\n`;
        content += `- Published: ${post.data.pubDate.toISOString().split("T")[0]}\n`;
        content += `- Category: ${post.data.category}\n`;
        if (post.data.tags?.length) {
          content += `- Tags: ${post.data.tags.join(", ")}\n`;
        }
        content += `- Summary: ${post.data.description}\n\n`;
      }
      content += "---\n\n";
    }
  } catch (err) {
    console.error("[llms-full.txt:posts error]", err);
  }

  // 4. Engineering Consultation Services
  try {
    const services = await getCollection("services");
    const enServices = services.filter(
      (s) =>
        !s.data.draft && s.data.visible !== false && s.id.startsWith("en/"),
    );

    if (enServices.length > 0) {
      content += "# Engineering Services & Consulting\n\n";
      for (const serv of enServices) {
        const slug = serv.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "");
        content += `## ${serv.data.title}\n`;
        content += `- URL: https://arturonavax.dev/services/${slug}/\n`;
        content += `- Summary: ${serv.data.description}\n`;
        if (serv.data.deliverables?.length) {
          content += `- Deliverables: ${serv.data.deliverables.join(", ")}\n`;
        }
        content += "\n";
      }
      content += "---\n\n";
    }
  } catch (err) {
    console.error("[llms-full.txt:services error]", err);
  }

  // 5. Verified Career Milestones & Experience
  try {
    const experiences = await getCollection("experience");
    const enExp = experiences
      .filter(
        (e) =>
          !e.data.draft && e.data.visible !== false && e.id.startsWith("en/"),
      )
      .sort(
        (a, b) =>
          new Date(b.data.startDate).getTime() -
          new Date(a.data.startDate).getTime(),
      );

    if (enExp.length > 0) {
      content += "# Verified Career Milestones & Systems Architecture\n\n";
      for (const exp of enExp) {
        const slug = exp.id.replace(/^en\//, "").replace(/\.md$/, "");
        content += `## ${exp.data.role} @ ${exp.data.company}\n`;
        content += `- URL: https://arturonavax.dev/experience/${slug}/\n`;
        content += `- Organization: ${exp.data.company}\n`;
        content += `- Role: ${exp.data.role}\n`;
        if (exp.data.location) content += `- Location: ${exp.data.location}\n`;
        if (exp.data.skills?.length) {
          content += `- Core Skills: ${exp.data.skills.join(", ")}\n`;
        }
        if (exp.data.keyAchievements?.length) {
          content += `- Key Architecture Highlights:\n`;
          for (const ach of exp.data.keyAchievements.slice(0, 3)) {
            content += `  * ${ach}\n`;
          }
        }
        content += "\n";
      }
    }
  } catch (err) {
    console.error("[llms-full.txt:experience error]", err);
  }

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
};
