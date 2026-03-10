import type { APIRoute } from 'astro';
import directoryData from '../data/directory.json';

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(directoryData), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
};
