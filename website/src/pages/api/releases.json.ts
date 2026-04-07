import type { APIRoute } from "astro";
import { releases } from "../../data/releases";

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(releases), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
