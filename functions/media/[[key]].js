import { errorResponse } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const rawKey = new URL(request.url).pathname.slice('/media/'.length);
  let key;
  try {
    key = rawKey.split('/').map(decodeURIComponent).join('/');
  } catch {
    return errorResponse('Image not found.', 404);
  }
  if (!/^products\/[A-Z0-9_-]{3,60}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(key)) {
    return errorResponse('Image not found.', 404);
  }
  try {
    const object = await env.PRODUCT_IMAGES.get(key);
    if (!object) return errorResponse('Image not found.', 404);
    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Could not read a product image from R2:', error);
    return errorResponse('Product images are temporarily unavailable.', 503);
  }
}
