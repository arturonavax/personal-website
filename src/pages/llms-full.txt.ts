import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";

export const GET: APIRoute = async () => {
  // Ruta a tu CV original en Markdown
  const cvPath = path.resolve("./src/content/cv/ArturoNava-CV-en.md");
  const cvContent = fs.readFileSync(cvPath, "utf-8");

  return new Response(cvContent, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
