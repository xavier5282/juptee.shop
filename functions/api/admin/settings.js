import { errorResponse, json } from '../../_lib/http.js';
import { DEFAULT_CHAT_FAQS, DEFAULT_SIZE_CHART, getChatSettings } from '../../_lib/shop-config.js';

function validPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      "SELECT key, value FROM notification_settings WHERE key IN ('whatsapp_recipient', 'notification_email')"
    ).all();
    const settings = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
    const chat = await getChatSettings(env.DB);
    return json({
      ...settings,
      chat_delivery_dhaka: chat.deliveryFees.dhaka,
      chat_delivery_subcity: chat.deliveryFees.subcity,
      chat_delivery_out: chat.deliveryFees.out,
      chat_size_chart: chat.sizeChart,
      chat_faqs: chat.faqs,
      chat_promotions: chat.promotions,
      chat_support_phone: chat.supportPhone
    });
  } catch (error) {
    console.error('Could not load notification settings:', error);
    return errorResponse('Could not load notification settings.', 503);
  }
}

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Settings must be sent as JSON.', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Settings must be a JSON object.', 400);
  }
  const phone = typeof body.whatsapp_recipient === 'string' ? body.whatsapp_recipient.trim() : '';
  const email = typeof body.notification_email === 'string' ? body.notification_email.trim().toLowerCase() : '';
  if (!validPhone(phone)) return errorResponse('Enter the WhatsApp recipient in international format, such as +8801XXXXXXXXX.', 400);
  if (!validEmail(email)) return errorResponse('Enter a valid notification email address.', 400);

  try {
    const chatValues = [
      ['chat_delivery_dhaka', body.chat_delivery_dhaka],
      ['chat_delivery_subcity', body.chat_delivery_subcity],
      ['chat_delivery_out', body.chat_delivery_out]
    ];
    const statements = [
      env.DB.prepare(
        `INSERT INTO notification_settings (key, value, updated_at)
         VALUES ('whatsapp_recipient', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(phone),
      env.DB.prepare(
        `INSERT INTO notification_settings (key, value, updated_at)
         VALUES ('notification_email', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(email)
    ];
    for (const [key, rawValue] of chatValues) {
      if (rawValue === undefined) continue;
      const value = Number(rawValue);
      if (!Number.isSafeInteger(value) || value < 0 || value > 2000) {
        return errorResponse('Delivery charges must be whole amounts between ৳0 and ৳2,000.', 400);
      }
      statements.push(env.DB.prepare(
        `INSERT INTO notification_settings (key, value, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, String(value)));
    }

    const textSettings = [
      ['chat_size_chart', body.chat_size_chart, DEFAULT_SIZE_CHART, 2000],
      ['chat_faqs', body.chat_faqs, DEFAULT_CHAT_FAQS, 6000],
      ['chat_promotions', body.chat_promotions, '', 2000]
    ];
    for (const [key, rawValue, fallback, maxLength] of textSettings) {
      if (rawValue === undefined) continue;
      if (typeof rawValue !== 'string' || rawValue.trim().length > maxLength) {
        return errorResponse(`The ${key.replace('chat_', '').replace('_', ' ')} setting is too long.`, 400);
      }
      statements.push(env.DB.prepare(
        `INSERT INTO notification_settings (key, value, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, rawValue.trim() || fallback));
    }
    if (body.chat_support_phone !== undefined) {
      const supportPhone = typeof body.chat_support_phone === 'string' ? body.chat_support_phone.trim() : '';
      if (!/^\+?[0-9][0-9 ()-]{6,30}$/.test(supportPhone)) {
        return errorResponse('Enter a valid human support phone number.', 400);
      }
      statements.push(env.DB.prepare(
        `INSERT INTO notification_settings (key, value, updated_at)
         VALUES ('chat_support_phone', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(supportPhone));
    }
    await env.DB.batch(statements);
    return json({ whatsapp_recipient: phone, notification_email: email });
  } catch (error) {
    console.error('Could not save notification settings:', error);
    return errorResponse('Could not save notification settings.', 503);
  }
}
