import { errorResponse, json } from '../../_lib/http.js';
import { deleteCloudinaryImage, isCloudinaryImage, optimizedImageUrl } from '../../_lib/cloudinary.js';

const CATEGORIES = new Set(['regular', 'oversized', 'dropshoulder', 'couple', 'hoodies', 'accessories']);
const PRODUCT_ID = /^[A-Z0-9][A-Z0-9_-]{2,59}$/;
const COLORS = { Black: 'BLK', White: 'WHT', Sage: 'SGE', Beige: 'BGE', Navy: 'NVY' };
const VARIANT_LABEL = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function codePart(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
}

function variantId(productId, color, size) {
  const colorCode = COLORS[color] || codePart(color);
  const sizeCode = size === 'One size' ? 'OS' : codePart(size);
  return `${productId}-${colorCode}-${sizeCode}`;
}

function publicImage(image, width = 600) {
  if (image && typeof image === 'object' && image.source === 'cloudinary') {
    return optimizedImageUrl(image.url, width);
  }
  if (typeof image === 'string' && image.startsWith('/')) return image;
  return `/media/${image.split('/').map(encodeURIComponent).join('/')}`;
}

function validLocalImagePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/assets/products/') || /[?#\\]/.test(path)) return false;
  try {
    const parts = decodeURIComponent(path).split('/');
    return parts.length === 4
      && parts[1] === 'assets'
      && parts[2] === 'products'
      && /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(?:jpg|jpeg|png|webp)$/i.test(parts[3])
      && !parts[3].includes('..');
  } catch {
    return false;
  }
}

function validLegacyImageKey(key, productId) {
  return typeof key === 'string'
    && key.startsWith(`products/${productId}/`)
    && /^products\/[A-Z0-9_-]{3,60}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(key);
}

function imageIdentity(image) {
  return image && typeof image === 'object' ? image.publicId : image;
}

async function productRows(env) {
  const result = await env.DB.prepare(
    `SELECT id, title, category, description, price, sale_price, badge, images_json, active, sort_order
     FROM products ORDER BY sort_order, title`
  ).all();
  const products = result.results || [];
  if (!products.length) return [];

  const variants = await env.DB.prepare(
    `SELECT id, product_id, color, size, unit_price, stock, active
     FROM catalog_variants WHERE product_id IN (${products.map(() => '?').join(',')})
     ORDER BY color, size`
  ).bind(...products.map(product => product.id)).all();
  const byProduct = new Map(products.map(product => [product.id, []]));
  for (const variant of variants.results || []) byProduct.get(variant.product_id)?.push({
    id: variant.id,
    color: variant.color,
    size: variant.size,
    unitPrice: variant.unit_price,
    stock: variant.stock,
    active: Boolean(variant.active)
  });
  return products.map(product => {
    let images = [];
    try {
      images = JSON.parse(product.images_json);
    } catch (error) {
      console.error(`Product ${product.id} has invalid image metadata:`, error);
    }
    return {
      id: product.id,
      title: product.title,
      category: product.category,
      description: product.description,
      price: product.price,
      salePrice: product.sale_price,
      badge: product.badge,
      active: Boolean(product.active),
      sortOrder: product.sort_order,
      images: (Array.isArray(images) ? images : []).map(image => ({
        ref: image,
        source: typeof image === 'string' ? (image.startsWith('/') ? 'local' : 'legacy') : image.source,
        publicId: typeof image === 'object' ? image.publicId : '',
        url: publicImage(image)
      })),
      variants: byProduct.get(product.id)
    };
  });
}

export async function onRequestGet({ env }) {
  try {
    return json({ products: await productRows(env) });
  } catch (error) {
    console.error('Could not load admin products:', error);
    return errorResponse('Could not load products. Check the D1 products migration and required image storage settings.', 503);
  }
}

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Product details must be sent as JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Product details must be a JSON object.', 400);
  }

  const id = clean(body.id, 60);
  const title = clean(body.title, 120);
  const category = clean(body.category, 30);
  const description = clean(body.description, 2000);
  const price = Number(body.price);
  const salePrice = body.salePrice === '' || body.salePrice === null ? 0 : Number(body.salePrice);
  const badge = clean(body.badge, 30);
  const active = body.active === true;
  const sortOrder = Number(body.sortOrder || 0);
  const images = body.images;
  const variants = body.variants;

  if (!PRODUCT_ID.test(id) || !title || !CATEGORIES.has(category)
    || !Number.isSafeInteger(price) || price < 1
    || !Number.isSafeInteger(salePrice) || salePrice < 0 || salePrice >= price
    || !Number.isSafeInteger(sortOrder) || sortOrder < 0
    || typeof body.active !== 'boolean') {
    return errorResponse('Check the product ID, title, category, regular price, sale price, and publication status.', 400);
  }
  if (!Array.isArray(images) || images.length > 4
    || new Set(images.map(imageIdentity)).size !== images.length
    || images.some(image => typeof image === 'string'
      ? !(validLocalImagePath(image) || validLegacyImageKey(image, id))
      : !isCloudinaryImage(image, id, String(env.CLOUDINARY_CLOUD_NAME || '')))) {
    return errorResponse('Use a valid local product image path, an existing image, or a Cloudinary image uploaded for this product.', 400);
  }
  if (active && images.length !== 4) {
    return errorResponse('Upload all four product images before publishing this product.', 400);
  }
  if (!Array.isArray(variants) || variants.length < 1 || variants.length > 100) {
    return errorResponse('A product must have between one and 100 size and color variants.', 400);
  }

  const normalizedVariants = [];
  const seenVariants = new Set();
  const seenVariantIds = new Set();
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
      return errorResponse('Check each variation color, size, stock, and active status.', 400);
    }
    const color = clean(variant.color, 32);
    const size = clean(variant.size, 24);
    const stock = Number(variant.stock);
    if (!VARIANT_LABEL.test(color) || color.length > 32
      || !VARIANT_LABEL.test(size) || size.length > 24
      || !Number.isInteger(stock) || stock < 0 || stock > 10000
      || typeof variant.active !== 'boolean') {
      return errorResponse('Check each variation color, size, stock, and active status.', 400);
    }
    const variantKey = `${color.toLowerCase()}\u0000${size.toLowerCase()}`;
    const idForVariant = variantId(id, color, size);
    if (seenVariants.has(variantKey) || seenVariantIds.has(idForVariant) || idForVariant.length > 120) {
      return errorResponse('Variations must have unique color and size combinations with a valid ID.', 400);
    }
    seenVariants.add(variantKey);
    seenVariantIds.add(idForVariant);
    normalizedVariants.push({ id: idForVariant, color, size, stock, active: variant.active });
  }
  if (active && !normalizedVariants.some(variant => variant.active)) {
    return errorResponse('Enable at least one product variation before publishing.', 400);
  }

  try {
    for (const image of images) {
      if (typeof image === 'string' && !image.startsWith('/') && !await env.PRODUCT_IMAGES.head(image)) {
        return errorResponse('One of the selected product images could not be found in storage.', 400);
      }
    }
    const existingProduct = await env.DB.prepare(
      'SELECT images_json FROM products WHERE id = ?'
    ).bind(id).first();
    let previousImages = [];
    try {
      previousImages = existingProduct ? JSON.parse(existingProduct.images_json) : [];
    } catch (error) {
      console.error(`Product ${id} has invalid image metadata before save:`, error);
    }
    const existingVariants = await env.DB.prepare(
      `SELECT id, product_id FROM catalog_variants
       WHERE id IN (${normalizedVariants.map(() => '?').join(',')})`
    ).bind(...normalizedVariants.map(variant => variant.id)).all();
    if ((existingVariants.results || []).some(variant => variant.product_id !== id)) {
      return errorResponse('A variation ID is already assigned to a different product. Choose a different product ID.', 409);
    }
    const statements = [
      env.DB.prepare(
        `INSERT INTO products
           (id, title, category, description, price, sale_price, badge, images_json, active, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, category = excluded.category, description = excluded.description,
           price = excluded.price, sale_price = excluded.sale_price, badge = excluded.badge,
           images_json = excluded.images_json, active = excluded.active, sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`
      ).bind(id, title, category, description, price, salePrice, badge, JSON.stringify(images), active ? 1 : 0, sortOrder),
      env.DB.prepare(
        `UPDATE catalog_variants SET active = 0
         WHERE product_id = ? AND id NOT IN (${normalizedVariants.map(() => '?').join(',')})`
      ).bind(id, ...normalizedVariants.map(variant => variant.id)),
      ...normalizedVariants.map(variant => env.DB.prepare(
        `INSERT INTO catalog_variants
           (id, product_id, title, category, color, size, unit_price, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, category = excluded.category,
           color = excluded.color, size = excluded.size, unit_price = excluded.unit_price,
           stock = excluded.stock, active = excluded.active, updated_at = excluded.updated_at
         WHERE catalog_variants.product_id = excluded.product_id`
      ).bind(variant.id, id, title, category, variant.color, variant.size, salePrice || price, variant.stock, variant.active ? 1 : 0))
    ];
    await env.DB.batch(statements);
    const product = (await productRows(env)).find(item => item.id === id);
    const retainedCloudinaryIds = new Set(images
      .filter(image => image && typeof image === 'object')
      .map(image => image.publicId));
    const removedCloudinaryImages = (Array.isArray(previousImages) ? previousImages : [])
      .filter(image => image && typeof image === 'object'
        && image.source === 'cloudinary' && !retainedCloudinaryIds.has(image.publicId));
    const warnings = [];
    for (const image of removedCloudinaryImages) {
      try {
        await deleteCloudinaryImage(image.publicId, env);
      } catch (error) {
        console.error(`Could not delete replaced Cloudinary image ${image.publicId}:`, error);
        warnings.push('The product was saved, but a replaced Cloudinary image could not be deleted.');
      }
    }
    return json({ product, warnings }, 200);
  } catch (error) {
    console.error(`Could not save product ${id}:`, error);
    return errorResponse('Could not save this product. Check that the product ID and variant IDs are unique.', 503);
  }
}
