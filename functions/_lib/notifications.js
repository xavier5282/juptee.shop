import { escapeHtml } from './http.js';

function formatOrder(order) {
  const lines = [
    `JUPTEE order ${order.id}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.customer_phone}`,
    `Email: ${order.customer_email || 'Not provided'}`,
    `Delivery area: ${order.delivery_area}`,
    `Division: ${order.division_name || 'Not recorded'}`,
    `District: ${order.district_name || order.district_area}`,
    `Police station / Upazila: ${order.upazila_name || 'Not recorded'}`,
    `Address: ${order.full_address}`,
    `Delivery instructions: ${order.delivery_instructions || 'None'}`,
    'Items:'
  ];
  for (const item of order.items) {
    lines.push(`${item.product_title} / ${item.color} / ${item.size} x ${item.quantity} — ৳${item.line_total.toLocaleString('en-US')}`);
  }
  lines.push(
    `Subtotal: ৳${order.subtotal.toLocaleString('en-US')}`,
    `Delivery: ৳${order.delivery_charge.toLocaleString('en-US')}`,
    `Discount: ৳${order.discount_amount.toLocaleString('en-US')}`,
    `Final payable: ৳${order.total_amount.toLocaleString('en-US')}`,
    `Notes: ${order.order_notes || 'None'}`,
    `Manage order: ${order.admin_url}`
  );
  return lines.join('\n');
}

function splitTemplateText(message) {
  const maxLength = 820;
  const chunks = [];
  let current = '';
  for (const line of message.split('\n')) {
    const segments = line.match(/[\s\S]{1,400}/gu) || [''];
    for (const segment of segments) {
      if (current && current.length + segment.length + 1 > maxLength) {
        chunks.push(current);
        current = segment;
      } else {
        current = current ? `${current}\n${segment}` : segment;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => chunks.length > 1
    ? `Part ${index + 1}/${chunks.length}\n${chunk}`
    : chunk);
}

async function sendWhatsApp(order, settings, env) {
  const version = env.META_GRAPH_API_VERSION;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const template = env.WHATSAPP_TEMPLATE_NAME;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
  const recipient = settings.whatsapp_recipient;
  if (!version || !/^v\d+\.\d+$/.test(version) || !phoneNumberId || !token || !template || !recipient) {
    throw new Error('WhatsApp is not configured. Set the Graph API version, phone number ID, access token, approved template, and recipient.');
  }

  const parts = splitTemplateText(formatOrder(order));
  for (const part of parts) {
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: part }]
          }]
        }
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('WhatsApp order notification failed:', response.status, detail.slice(0, 500));
      throw new Error(`WhatsApp Cloud API returned HTTP ${response.status}.`);
    }
  }
}

async function sendEmail(order, settings, env) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM || !settings.notification_email) {
    throw new Error('Email is not configured. Set the Resend API key, verified sender address, and notification recipient.');
  }

  const rows = order.items.map(item => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e5e5e5">${escapeHtml(item.product_title)} · ${escapeHtml(item.color)} / ${escapeHtml(item.size)}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e5e5">${item.quantity}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e5e5">৳${item.line_total.toLocaleString('en-US')}</td>
  </tr>`).join('');
  const address = [
    order.division_name,
    order.district_name || order.district_area,
    order.upazila_name,
    order.full_address
  ].filter(Boolean).map(escapeHtml).join('<br>');
  const html = `<div style="font:15px/1.6 Arial,sans-serif;color:#242424;max-width:680px;margin:auto">
    <h1>New JUPTEE order ${escapeHtml(order.id)}</h1>
    <p><a href="${escapeHtml(order.admin_url)}">Manage this order in the admin dashboard</a></p>
    <h2>Customer</h2>
    <p>${escapeHtml(order.customer_name)}<br>${escapeHtml(order.customer_phone)}<br>${escapeHtml(order.customer_email || 'Email not provided')}</p>
    <h2>Delivery</h2><p>${escapeHtml(order.delivery_area)}<br>${address}</p>
    <p>Delivery instructions: ${escapeHtml(order.delivery_instructions || 'None')}</p>
    <h2>Items</h2>
    <table style="width:100%;border-collapse:collapse;text-align:left">
      <thead><tr><th style="padding:8px">Product / variation</th><th style="padding:8px">Qty</th><th style="padding:8px">Line total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Subtotal: ৳${order.subtotal.toLocaleString('en-US')}<br>
      Delivery: ৳${order.delivery_charge.toLocaleString('en-US')}<br>
      Discount: ৳${order.discount_amount.toLocaleString('en-US')}<br>
      <strong>Final payable: ৳${order.total_amount.toLocaleString('en-US')}</strong>
    </p>
    <h2>Order notes</h2><p>${escapeHtml(order.order_notes || 'None')}</p>
  </div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.ORDER_EMAIL_FROM,
      to: [settings.notification_email],
      subject: `New JUPTEE order ${order.id}`,
      html,
      text: formatOrder(order)
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Order notification email failed:', response.status, detail.slice(0, 500));
    throw new Error(`Email provider returned HTTP ${response.status}.`);
  }
}

async function saveNotificationResult(db, orderId, channel, error) {
  const status = error ? 'failed' : 'sent';
  const errorText = error ? String(error.message || error).slice(0, 300) : '';
  await db.prepare(
    `UPDATE orders SET ${channel}_status = ?, ${channel}_error = ? WHERE id = ?`
  ).bind(status, errorText, orderId).run();
}

async function sendAndRecord(db, order, settings, env, channel) {
  try {
    if (channel === 'whatsapp') await sendWhatsApp(order, settings, env);
    else await sendEmail(order, settings, env);
    await saveNotificationResult(db, order.id, channel, null);
  } catch (error) {
    console.error(`Order ${channel} notification failed for ${order.id}:`, error);
    try {
      await saveNotificationResult(db, order.id, channel, error);
    } catch (recordError) {
      console.error(`Could not record ${channel} notification failure for ${order.id}:`, recordError);
    }
  }
}

export async function dispatchOrderNotifications(context, order, settings, env) {
  const notifications = Promise.all([
    sendAndRecord(env.DB, order, settings, env, 'whatsapp'),
    sendAndRecord(env.DB, order, settings, env, 'email')
  ]);
  try {
    context.waitUntil(notifications);
  } catch (error) {
    console.error(`Could not schedule notifications for saved order ${order.id}:`, error);
    await Promise.all(['whatsapp', 'email'].map(async channel => {
      try {
        await saveNotificationResult(env.DB, order.id, channel, error);
      } catch (recordError) {
        console.error(`Could not record ${channel} notification failure for ${order.id}:`, recordError);
      }
    }));
  }
}
