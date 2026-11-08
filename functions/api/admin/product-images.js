import { errorResponse, json } from '../../_lib/http.js';
import { deleteCloudinaryImage, uploadCloudinaryImage } from '../../_lib/cloudinary.js';

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const PRODUCT_ID = /^[A-Z0-9][A-Z0-9_-]{2,59}$/;

async function imageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return errorResponse('Upload images using a multipart form.', 415);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_TOTAL_BYTES + 64 * 1024) {
    return errorResponse('The selected images exceed the total upload limit of 20 MB.', 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('The image upload could not be read.', 400);
  }
  const productId = String(form.get('productId') || '').trim();
  if (!PRODUCT_ID.test(productId)) return errorResponse('The product ID is invalid.', 400);

  const files = form.getAll('image');
  const slots = form.getAll('slot');
  if (!files.length || files.length > 4 || files.length !== slots.length) {
    return errorResponse('Choose between one and four product images.', 400);
  }
  let totalBytes = 0;
  const uploads = [];
  const usedSlots = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const slot = Number(slots[index]);
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_FILE_BYTES) {
      return errorResponse('Each image must be smaller than 6 MB.', 413);
    }
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || usedSlots.has(slot)) {
      return errorResponse('Each image must be assigned to a unique gallery position.', 400);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return errorResponse('The selected images exceed the total upload limit of 20 MB.', 413);
    }
    const type = await imageType(file);
    if (!type || (file.type && file.type.toLowerCase() !== type.contentType)) {
      return errorResponse('Use genuine JPEG, PNG, or WebP image files with a matching file type.', 415);
    }
    uploads.push({ file, slot, ...type });
  }

  const saved = [];
  try {
    for (const upload of uploads) {
      const image = await uploadCloudinaryImage(upload.file, productId, upload.extension, env);
      saved.push({ slot: upload.slot, ...image });
    }
    return json({ images: saved }, 201);
  } catch (error) {
    console.error(`Could not upload product images for ${productId}:`, error);
    await Promise.all(saved.map(async image => {
      try {
        await deleteCloudinaryImage(image.publicId, env);
      } catch (cleanupError) {
        console.error(`Could not clean up incomplete Cloudinary image ${image.publicId}:`, cleanupError);
      }
    }));
    return errorResponse('Cloudinary could not save the selected images. No product changes were made.', 503);
  }
}

export async function onRequestDelete({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Image deletion details must be sent as JSON.', 400);
  }
  const productId = String(body?.productId || '').trim();
  const publicIds = body?.publicIds;
  if (!PRODUCT_ID.test(productId) || !Array.isArray(publicIds) || !publicIds.length || publicIds.length > 4
    || publicIds.some(publicId => typeof publicId !== 'string'
      || !new RegExp(`^juptee/products/${productId}/[0-9a-f-]{36}$`).test(publicId))
    || new Set(publicIds).size !== publicIds.length) {
    return errorResponse('The requested product images are invalid.', 400);
  }
  try {
    const savedProduct = await env.DB.prepare(
      'SELECT images_json FROM products WHERE id = ?'
    ).bind(productId).first();
    let savedIds = [];
    try {
      savedIds = JSON.parse(savedProduct?.images_json || '[]')
        .filter(image => image && typeof image === 'object' && image.source === 'cloudinary')
        .map(image => image.publicId);
    } catch (error) {
      console.error(`Product ${productId} has invalid image metadata during image cleanup:`, error);
    }
    if (publicIds.some(publicId => savedIds.includes(publicId))) {
      return errorResponse('A saved product image cannot be deleted without removing it from the product first.', 409);
    }
    await Promise.all(publicIds.map(publicId => deleteCloudinaryImage(publicId, env)));
    return json({ deleted: publicIds });
  } catch (error) {
    console.error(`Could not delete unassigned Cloudinary images for ${productId}:`, error);
    return errorResponse('The unsaved product images could not be deleted.', 503);
  }
}
