import { errorResponse, json } from '../_lib/http.js';
import { dispatchOrderNotifications } from '../_lib/notifications.js';
import { getChatSettings } from '../_lib/shop-config.js';

const MAX_DISTINCT_ITEMS = 8;

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  let national = digits;
  if (national.startsWith('+880')) national = `0${national.slice(4)}`;
  else if (national.startsWith('880')) national = `0${national.slice(3)}`;
  return /^01[3-9]\d{8}$/.test(national) ? `+88${national}` : '';
}

function validEmail(value) {
  return value === '' || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function settingsFromDb(db) {
  const result = await db.prepare(
    "SELECT key, value FROM notification_settings WHERE key IN ('whatsapp_recipient', 'notification_email')"
  ).all();
  return Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
}

async function existingOrder(db, key) {
  return db.prepare('SELECT id, total_amount, request_fingerprint FROM orders WHERE idempotency_key = ?')
    .bind(key).first();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return errorResponse('Send the order as JSON.', 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20_000) return errorResponse('Order details are too large.', 413);

  const idempotencyKey = request.headers.get('Idempotency-Key') || '';
  if (!/^[\w-]{16,80}$/.test(idempotencyKey)) {
    return errorResponse('The order submission key is missing or invalid.', 400);
  }

  let rawBody;
  let body;
  try {
    rawBody = await request.text();
    if (rawBody.length > 20_000) return errorResponse('Order details are too large.', 413);
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Order details are not valid JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Order details must be a JSON object.', 400);
  }
  const requestFingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)))
  ).map(byte => byte.toString(16).padStart(2, '0')).join('');

  const name = clean(body.name, 120);
  const phone = normalizedPhone(body.phone);
  const email = clean(body.email, 254).toLowerCase();
  const district = clean(body.district, 120);
  const address = clean(body.address, 500);
  const notes = clean(body.notes, 500);
  const area = clean(body.deliveryArea, 20);
  const items = body.items;
  if (!name || !phone || !district || !address || !validEmail(email)) {
    return errorResponse('Check your name, Bangladeshi phone number, email, district, and delivery address.', 400);
  }
  if (!Object.hasOwn(DELIVERY_FEES, area)) return errorResponse('Choose a valid delivery area.', 400);
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_DISTINCT_ITEMS) {
    return errorResponse(`An order must contain between 1 and ${MAX_DISTINCT_ITEMS} different items.`, 400);
  }

  const normalizedItems = [];
  for (const item of items) {
    const variantId = clean(item?.variantId, 100);
    const quantity = Number(item?.quantity);
    if (!variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return errorResponse('One or more product variations or quantities are invalid.', 400);
    }
    normalizedItems.push({ variantId, quantity });
  }
  if (new Set(normalizedItems.map(item => item.variantId)).size !== normalizedItems.length) {
    return errorResponse('Remove duplicate product variations and try again.', 400);
  }

  try {
    const prior = await existingOrder(env.DB, idempotencyKey);
    if (prior) {
      if (prior.request_fingerprint !== requestFingerprint) {
        return errorResponse('This submission key was already used for different order details. Please submit again.', 409);
      }
      return json({ orderId: prior.id, total: prior.total_amount, notifications: 'already submitted' }, 200);
    }

    const placeholders = normalizedItems.map(() => '?').join(',');
    const catalog = await env.DB.prepare(
      `SELECT id, title, category, color, size, unit_price, stock
       FROM catalog_variants WHERE active = 1 AND id IN (${placeholders})`
    ).bind(...normalizedItems.map(item => item.variantId)).all();
    const variants = new Map((catalog.results || []).map(variant => [variant.id, variant]));
    if (variants.size !== normalizedItems.length) {
      return errorResponse('A selected item is unavailable. Refresh the collection and try again.', 409);
    }

    const orderItems = normalizedItems.map(item => {
      const variant = variants.get(item.variantId);
      if (!Number.isSafeInteger(variant.unit_price) || variant.unit_price < 0
        || !Number.isSafeInteger(variant.stock) || variant.stock < item.quantity) {
        throw new RangeError(`Insufficient stock for ${variant.title} (${variant.color} / ${variant.size}).`);
      }
      return {
        ...variant,
        quantity: item.quantity,
        line_total: variant.unit_price * item.quantity
      };
    });
    const subtotal = orderItems.reduce((sum, item) => sum + item.line_total, 0);
    if (!Number.isSafeInteger(subtotal)) {
      return errorResponse('The product catalogue contains an invalid order total. Please contact JUPTEE.', 503);
    }
    const { deliveryFees } = await getChatSettings(env.DB);
    const deliveryCharge = deliveryFees[area];
    const discount = 0;
    const total = subtotal + deliveryCharge - discount;
    if (!Number.isSafeInteger(total)) {
      return errorResponse('The product catalogue contains an invalid order total. Please contact JUPTEE.', 503);
    }
    const orderId = `JT-${crypto.randomUUID().toUpperCase()}`;
    const createdAt = new Date().toISOString();
    const order = {
      id: orderId,
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      district_area: district,
      full_address: address,
      order_notes: notes,
      delivery_area: area === 'dhaka' ? 'Dhaka' : area === 'subcity' ? 'Sub-City' : 'Outside City',
      delivery_charge: deliveryCharge,
      subtotal,
      discount_amount: discount,
      total_amount: total,
      items: orderItems,
      created_at: createdAt,
      admin_url: new URL('/admin/', env.PUBLIC_SITE_URL || 'https://juptee.shop').href
    };

    const statements = [
      env.DB.prepare(
        `INSERT INTO orders (
          id, idempotency_key, request_fingerprint, customer_name, customer_phone, customer_email,
          district_area, full_address, order_notes, delivery_area, delivery_charge,
          subtotal, discount_amount, total_amount, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        order.id, idempotencyKey, requestFingerprint, order.customer_name, order.customer_phone,
        order.customer_email, order.district_area, order.full_address, order.order_notes,
        order.delivery_area, order.delivery_charge, order.subtotal, order.discount_amount,
        order.total_amount, order.created_at
      ),
      ...order.items.map(item => env.DB.prepare(
        `INSERT INTO order_items (
          order_id, variant_id, product_title, category, color, size,
          quantity, unit_price, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        order.id, item.id, item.title, item.category, item.color, item.size,
        item.quantity, item.unit_price, item.line_total
      ))
    ];

    await env.DB.batch(statements);
    let settings = {};
    try {
      settings = await settingsFromDb(env.DB);
    } catch (error) {
      console.error(`Order ${order.id} was saved, but notification contacts could not be loaded:`, error);
    }
    await dispatchOrderNotifications(context, order, settings, env);
    return json({
      orderId: order.id,
      total: order.total_amount,
      notifications: { whatsapp: 'queued', email: 'queued' }
    }, 201);
  } catch (error) {
    if (error instanceof RangeError) return errorResponse(error.message, 409);
    if (String(error?.message || '').includes('Product variant unavailable or insufficient stock')) {
      return errorResponse('A selected item just sold out. Refresh the collection and try again.', 409);
    }
    console.error('Could not save JUPTEE order:', error);
    return errorResponse('We could not save your order. Your bag is unchanged; please try again or contact JUPTEE.', 503);
  }
}
