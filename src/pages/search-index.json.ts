import type { APIRoute } from "astro";
import { getSegmentedSearchDocuments } from "@/data/searchIndex";

export const prerender = true;

export const GET: APIRoute = async () => {
  const searchDocuments = await getSegmentedSearchDocuments();

  return new Response(JSON.stringify(searchDocuments), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
};
