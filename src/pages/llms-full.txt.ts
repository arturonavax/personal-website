import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { hasResume, resolveResumePath } from "@/data/resume";

export const GET: APIRoute = async () => {
  if (!hasResume) {
    return new Response("Not found", { status: 404 });
  }

  const resumePath =
    resolveResumePath("en") ||
    path.resolve("./src/content/resume/ArturoNava-Resume-en.md");
  if (!fs.existsSync(resumePath)) {
    return new Response("Not found", { status: 404 });
  }
  const content = fs.readFileSync(resumePath, "utf-8");

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
