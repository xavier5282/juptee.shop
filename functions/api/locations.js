import { bangladeshLocations } from '../_lib/bangladesh-locations.js';

export async function onRequestGet() {
  return new Response(JSON.stringify({ divisions: bangladeshLocations }), {
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
