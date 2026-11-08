import { errorResponse, json } from '../_lib/http.js';
import { optimizedImageUrl } from '../_lib/cloudinary.js';

function publicImage(image) {
  if (image && typeof image === 'object' && image.source === 'cloudinary') {
    return optimizedImageUrl(image.url);
  }
  if (typeof image === 'string' && image.startsWith('/')) return image;
  return `/media/${image.split('/').map(encodeURIComponent).join('/')}`;
}

export async function onRequestGet({ env }) {
  try {
    const [productsResult, variantsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT id, title, category, description, price, sale_price, badge, images_json
         FROM products WHERE active = 1 ORDER BY sort_order, title`
      ).all(),
      env.DB.prepare(
        `SELECT id, product_id, color, size, unit_price, stock, active
         FROM catalog_variants WHERE active = 1 ORDER BY color, size`
      ).all()
    ]);
    const variantsByProduct = new Map();
    for (const variant of variantsResult.results || []) {
      if (!variantsByProduct.has(variant.product_id)) variantsByProduct.set(variant.product_id, []);
      variantsByProduct.get(variant.product_id).push({
        id: variant.id,
        color: variant.color,
        size: variant.size,
        unitPrice: variant.unit_price,
        stock: variant.stock
      });
    }

    const products = (productsResult.results || []).flatMap(product => {
      const variants = variantsByProduct.get(product.id) || [];
      let images;
      try {
        images = JSON.parse(product.images_json);
      } catch {
        console.error(`Product ${product.id} has invalid image metadata.`);
        return [];
      }
      if (!variants.length || !Array.isArray(images) || images.length !== 4) return [];
      return [{
        id: product.id,
        code: product.id,
        name: product.title,
        cat: product.category,
        description: product.description,
        price: product.price,
        sale: product.sale_price,
        badge: product.badge,
        colors: [...new Set(variants.map(variant => variant.color))],
        sizes: [...new Set(variants.map(variant => variant.size))],
        stock: variants.reduce((total, variant) => total + variant.stock, 0),
        variants,
        images: images.map(publicImage)
      }];
    });

    return new Response(JSON.stringify({ products }), {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Could not load the published JUPTEE catalog:', error);
    return errorResponse('The product catalog is temporarily unavailable.', 503);
  }
}
