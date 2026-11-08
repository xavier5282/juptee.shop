export const DEFAULT_DELIVERY_FEES = Object.freeze({ dhaka: 80, subcity: 100, out: 130 });

export const DEFAULT_SIZE_CHART = [
  'M — 38 inches chest',
  'L — 40 inches chest',
  'XL — 42 inches chest',
  'XXL — 44 inches chest',
  '3XL — 46 inches chest'
].join('\n');

export const DEFAULT_CHAT_FAQS = [
  'JUPTEE sells Christian-themed apparel, including T-shirts and hoodies.',
  'Custom apparel requests can be discussed with JUPTEE support.',
  'Payment currently supported at checkout: Cash on delivery.'
].join('\n');

const CHAT_SETTING_KEYS = [
  'chat_delivery_dhaka',
  'chat_delivery_subcity',
  'chat_delivery_out',
  'chat_size_chart',
  'chat_faqs',
  'chat_promotions',
  'chat_support_phone'
];

export async function getChatSettings(db) {
  const result = await db.prepare(
    `SELECT key, value FROM notification_settings
     WHERE key IN (${CHAT_SETTING_KEYS.map(() => '?').join(',')})`
  ).bind(...CHAT_SETTING_KEYS).all();
  const settings = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
  const fee = (key, fallback) => {
    const value = Number(settings[key]);
    return Number.isSafeInteger(value) && value >= 0 && value <= 2000 ? value : fallback;
  };
  return {
    deliveryFees: {
      dhaka: fee('chat_delivery_dhaka', DEFAULT_DELIVERY_FEES.dhaka),
      subcity: fee('chat_delivery_subcity', DEFAULT_DELIVERY_FEES.subcity),
      out: fee('chat_delivery_out', DEFAULT_DELIVERY_FEES.out)
    },
    sizeChart: String(settings.chat_size_chart || DEFAULT_SIZE_CHART).slice(0, 2000),
    faqs: String(settings.chat_faqs || DEFAULT_CHAT_FAQS).slice(0, 6000),
    promotions: String(settings.chat_promotions || '').slice(0, 2000),
    supportPhone: String(settings.chat_support_phone || '+8801061103327').slice(0, 32),
    paymentMethods: ['Cash on delivery']
  };
}
