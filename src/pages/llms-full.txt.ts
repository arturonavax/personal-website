import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import { hasResume } from "@/data/cv";

export const GET: APIRoute = async () => {
  if (!hasResume) {
    return new Response("Not found", { status: 404 });
  }

  const cvPath = path.resolve("./src/content/cv/ArturoNava-CV-en.md");
  if (!fs.existsSync(cvPath)) {
    return new Response("Not found", { status: 404 });
  }
  const cvContent = fs.readFileSync(cvPath, "utf-8");

  return new Response(cvContent, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
