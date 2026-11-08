import { errorResponse, json } from '../../_lib/http.js';

const STATUSES = new Set(['new', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled']);

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      `SELECT id, customer_name, customer_phone, customer_email, district_area,
        full_address, order_notes, delivery_area, delivery_charge, subtotal,
        discount_amount, total_amount, status, whatsapp_status, whatsapp_error,
        email_status, email_error, created_at
       FROM orders ORDER BY created_at DESC LIMIT 100`
    ).all();
    const orders = result.results || [];
    if (!orders.length) return json({ orders: [] });
    const placeholders = orders.map(() => '?').join(',');
    const itemsResult = await env.DB.prepare(
      `SELECT order_id, variant_id, product_title, category, color, size, quantity, unit_price, line_total
       FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`
    ).bind(...orders.map(order => order.id)).all();
    const itemsByOrder = new Map(orders.map(order => [order.id, []]));
    for (const item of itemsResult.results || []) itemsByOrder.get(item.order_id)?.push(item);
    return json({
      orders: orders.map(order => ({ ...order, items: itemsByOrder.get(order.id) }))
    });
  } catch (error) {
    console.error('Could not load admin orders:', error);
    return errorResponse('Could not load orders.', 503);
  }
}

export async function onRequestPatch({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Order update must be sent as JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.id !== 'string' || !STATUSES.has(body.status)) {
    return errorResponse('Choose a valid order and status.', 400);
  }
  try {
    const result = await env.DB.prepare(
      `UPDATE orders SET status = ? WHERE id = ?`
    ).bind(body.status, body.id).run();
    if (!result.meta?.changes) return errorResponse('Order not found.', 404);
    return json({ id: body.id, status: body.status });
  } catch (error) {
    if (String(error?.message || '').includes('Cancelled order cannot be reopened')) {
      return errorResponse('This cancelled order cannot be reopened because one or more items are no longer in stock.', 409);
    }
    console.error('Could not update order status:', error);
    return errorResponse('Could not update the order.', 503);
  }
}
