import { errorResponse, json } from '../_lib/http.js';
import { getChatSettings } from '../_lib/shop-config.js';

export async function onRequestGet({ env }) {
  try {
    const settings = await getChatSettings(env.DB);
    return json({ deliveryFees: settings.deliveryFees });
  } catch (error) {
    console.error('Could not load public store delivery settings:', error);
    return errorResponse('Store settings are temporarily unavailable.', 503);
  }
}
