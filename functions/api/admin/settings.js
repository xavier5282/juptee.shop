import { errorResponse, json } from '../../_lib/http.js';

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
    return json(settings);
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
    await env.DB.batch([
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
    ]);
    return json({ whatsapp_recipient: phone, notification_email: email });
  } catch (error) {
    console.error('Could not save notification settings:', error);
    return errorResponse('Could not save notification settings.', 503);
  }
}
