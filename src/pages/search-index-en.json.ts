import type { APIRoute } from "astro";
import { getBilingualSearchDocuments } from "@/data/searchIndex";

export const prerender = true;

export const GET: APIRoute = async () => {
  const searchDocuments = await getBilingualSearchDocuments("en");

  return new Response(JSON.stringify(searchDocuments), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};
