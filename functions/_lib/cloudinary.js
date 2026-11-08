function settings(env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (!/^[a-z0-9-]+$/i.test(cloudName) || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured.');
  }
  return { cloudName, apiKey, apiSecret };
}

async function signature(params, secret) {
  const value = Object.entries(params)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${key}=${entry}`)
    .join('&');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${value}${secret}`)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function optimizedImageUrl(url, width = 1200) {
  return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width},c_limit/`);
}

export function isCloudinaryImage(image, productId, cloudName) {
  if (!image || typeof image !== 'object' || image.source !== 'cloudinary'
    || typeof image.publicId !== 'string' || typeof image.url !== 'string') return false;
  const publicId = `juptee/products/${productId}/[0-9a-f-]{36}`;
  if (!new RegExp(`^${publicId}$`).test(image.publicId)) return false;
  try {
    const url = new URL(image.url);
    return url.protocol === 'https:'
      && url.hostname === 'res.cloudinary.com'
      && new RegExp(`^/${cloudName}/image/upload/(?:v\\d+/)?${publicId}\\.(?:jpg|png|webp)$`).test(url.pathname);
  } catch {
    return false;
  }
}

export async function uploadCloudinaryImage(file, productId, extension, env) {
  const { cloudName, apiKey, apiSecret } = settings(env);
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `juptee/products/${productId}/${crypto.randomUUID()}`;
  const params = { overwrite: 'false', public_id: publicId, timestamp };
  const body = new FormData();
  body.append('file', file, `product-image.${extension}`);
  body.append('api_key', apiKey);
  body.append('timestamp', String(timestamp));
  body.append('public_id', publicId);
  body.append('overwrite', 'false');
  body.append('signature', await signature(params, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Cloudinary upload returned an invalid response (${response.status}).`);
  }
  if (!response.ok || result.public_id !== publicId || typeof result.secure_url !== 'string') {
    throw new Error(`Cloudinary upload failed (${response.status}).`);
  }
  return { source: 'cloudinary', publicId, url: result.secure_url };
}

export async function deleteCloudinaryImage(publicId, env) {
  const { cloudName, apiKey, apiSecret } = settings(env);
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { invalidate: 'true', public_id: publicId, timestamp };
  const body = new FormData();
  body.append('api_key', apiKey);
  body.append('timestamp', String(timestamp));
  body.append('public_id', publicId);
  body.append('invalidate', 'true');
  body.append('signature', await signature(params, apiSecret));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    body
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Cloudinary delete returned an invalid response (${response.status}).`);
  }
  if (!response.ok || (result.result !== 'ok' && result.result !== 'not found')) {
    throw new Error(`Cloudinary delete failed (${response.status}).`);
  }
}
