const root = document.querySelector('#jt-chat-root');
const state = { open: false, ready: false, loadedAt: 0, loading: false, products: [], settings: null, history: [], pendingOrder: null };
const sizeDefault = 'M — 38 inches chest\nL — 40 inches chest\nXL — 42 inches chest\nXXL — 44 inches chest\n3XL — 46 inches chest';
let orderFormSequence = 0;

function messageLanguage(value) {
  if (/[\u0980-\u09FF]/.test(value)) return 'bn';
  if (/\b(koto|dam|dhaka|baire|chai|kinbo|amar|ache|pabo|delivery|size ta)\b/i.test(value)) return 'banglish';
  return 'en';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function money(value) {
  return `৳${Number(value).toLocaleString('en-US')}`;
}

function addMessage(role, text, history = true) {
  const row = document.createElement('div');
  row.className = `jt-chat-msg ${role}`;
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.className = 'jt-chat-avatar';
    avatar.src = '/assets/juptee-favicon.png';
    avatar.alt = '';
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'jt-chat-bubble';
  bubble.textContent = text;
  row.append(bubble);
  root.querySelector('.jt-chat-stream').append(row);
  scrollToBottom();
  if (history && (role === 'user' || role === 'assistant')) {
    state.history.push({ role, content: text });
    state.history = state.history.slice(-10);
  }
}

function addHtmlMessage(html) {
  const row = document.createElement('div');
  row.className = 'jt-chat-msg assistant';
  const avatar = document.createElement('img');
  avatar.className = 'jt-chat-avatar';
  avatar.src = '/assets/juptee-favicon.png';
  avatar.alt = '';
  const bubble = document.createElement('div');
  bubble.className = 'jt-chat-bubble';
  bubble.innerHTML = html;
  row.append(avatar, bubble);
  root.querySelector('.jt-chat-stream').append(row);
  scrollToBottom();
}

function scrollToBottom() {
  const stream = root.querySelector('.jt-chat-stream');
  requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
}

function showTyping(visible) {
  const existing = root.querySelector('.jt-chat-typing-row');
  if (!visible) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const row = document.createElement('div');
  row.className = 'jt-chat-msg assistant jt-chat-typing-row';
  row.setAttribute('aria-label', 'Assistant is typing');
  row.innerHTML = '<img class="jt-chat-avatar" src="/assets/juptee-favicon.png" alt=""><div class="jt-chat-bubble jt-chat-typing"><i></i><i></i><i></i></div>';
  root.querySelector('.jt-chat-stream').append(row);
  scrollToBottom();
}

function renderWidget() {
  root.innerHTML = `
    <button class="jt-chat-launch" type="button" aria-label="${state.open ? 'Close' : 'Open'} JUPTEE shopping assistant" aria-expanded="${state.open}">✦</button>
    <section class="jt-chat-panel" role="dialog" aria-modal="false" aria-label="JUPTEE AI shopping assistant" ${state.open ? '' : 'hidden'}>
      <header class="jt-chat-head">
        <img class="jt-chat-brandmark" src="/assets/juptee-favicon.png" alt="">
        <div class="jt-chat-headcopy"><strong>JUPTEE</strong><span>AI Shopping Assistant</span></div>
        <button class="jt-chat-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="jt-chat-stream" role="log" aria-live="polite">
        <div class="jt-chat-msg assistant"><img class="jt-chat-avatar" src="/assets/juptee-favicon.png" alt=""><div class="jt-chat-bubble jt-chat-welcome">Hey! Welcome to Juptee! 👋 I'm your AI Shopping Assistant. I can help you find products, choose sizes, check prices, calculate delivery charges, and place orders. How can I help you today?</div></div>
        <div class="jt-chat-quick">
          <button type="button" data-action="browse">🛍️ Browse Products</button>
          <button type="button" data-action="size">📏 Size Guide</button>
          <button type="button" data-action="prices">💰 Check Prices</button>
          <button type="button" data-action="delivery">🚚 Delivery Information</button>
          <button type="button" data-action="order">📦 Place an Order</button>
        </div>
      </div>
      <form class="jt-chat-composer">
        <textarea name="message" rows="1" maxlength="1200" aria-label="Write a message" placeholder="Ask in English, বাংলা or Banglish…"></textarea>
        <button class="jt-chat-send" type="submit" aria-label="Send message">↑</button>
      </form>
      <div class="jt-chat-privacy">Order details stay in the secure order form, not the AI conversation.</div>
    </section>`;
  root.querySelector('.jt-chat-launch').addEventListener('click', () => toggleChat());
  root.querySelector('.jt-chat-close').addEventListener('click', () => toggleChat(false));
  const composer = root.querySelector('.jt-chat-composer');
  composer.addEventListener('submit', sendMessage);
  composer.elements.message.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  root.querySelector('.jt-chat-quick').addEventListener('click', quickAction);
  root.querySelector('.jt-chat-stream').addEventListener('click', orderAction);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) toggleChat(false);
  });
}

async function loadStoreData() {
  if (state.ready && Date.now() - state.loadedAt < 60_000) return true;
  try {
    const response = await fetch('/api/chatbot', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    const result = await response.json();
    state.products = Array.isArray(result.products) ? result.products : [];
    state.settings = result.settings || { deliveryFees: { dhaka: 80, subcity: 100, out: 130 }, sizeChart: sizeDefault, paymentMethods: ['Cash on delivery'], supportPhone: '+8801061103327', promotions: '' };
    state.ready = true;
    state.loadedAt = Date.now();
    return true;
  } catch (error) {
    console.error('Could not load shopping assistant catalog:', error);
    addMessage('assistant', 'I can still help with general questions, but the live catalog is temporarily unavailable. Please try again or contact JUPTEE support.', false);
    return false;
  }
}

async function toggleChat(force) {
  state.open = typeof force === 'boolean' ? force : !state.open;
  const panel = root.querySelector('.jt-chat-panel');
  const launch = root.querySelector('.jt-chat-launch');
  panel.hidden = !state.open;
  launch.hidden = state.open;
  launch.setAttribute('aria-expanded', String(state.open));
  launch.setAttribute('aria-label', `${state.open ? 'Close' : 'Open'} JUPTEE shopping assistant`);
  if (state.open) {
    await loadStoreData();
    root.querySelector('textarea[name="message"]')?.focus();
  } else {
    launch.focus();
  }
}

function configuredFees() {
  return state.settings?.deliveryFees || { dhaka: 80, subcity: 100, out: 130 };
}

function quickAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'browse') {
    location.hash = '#shop';
    toggleChat(false);
    return;
  }
  if (action === 'order') {
    addMessage('user', 'I would like to place an order.', false);
    startOrder();
    return;
  }
  if (action === 'size') {
    const chart = state.settings?.sizeChart || sizeDefault;
    addMessage('user', 'Please help me choose a size.', false);
    addMessage('assistant', `Here is the JUPTEE garment chest chart:\n${chart}\n\nThese are garment chest measurements, not body measurements. If you are between sizes, compare a well-fitting shirt or share your chest measurement. Fit can vary by style; I can’t guarantee an exact fit.`);
    return;
  }
  if (action === 'delivery') {
    addMessage('user', 'How much is delivery?', false);
    addDeliveryReply('en');
    return;
  }
  if (action === 'prices') {
    addMessage('user', 'Please show me current product prices.', false);
    showCatalog();
  }
}

function addDeliveryReply(language) {
  const fees = configuredFees();
  if (language === 'bn') {
    addMessage('assistant', `বর্তমান ডেলিভারি চার্জ:\n• ঢাকা জেলায়: ${money(fees.dhaka)}\n• ঢাকার বাইরে: ${money(fees.out)}\n\nচেকআউটে পণ্যের সাবটোটালের সঙ্গে ডেলিভারি যোগ হবে।`);
  } else if (language === 'banglish') {
    addMessage('assistant', `Ekhon delivery charge:\n• Dhaka district-e: ${money(fees.dhaka)}\n• Dhakar baire: ${money(fees.out)}\n\nCheckout-e product subtotal-er sathe delivery jog hobe.`);
  } else {
    addMessage('assistant', `Current delivery charges:\n• Dhaka district: ${money(fees.dhaka)}\n• Outside Dhaka: ${money(fees.out)}\n\nDelivery is added to the product subtotal at checkout.`);
  }
}

function showCatalog(language = 'en') {
  if (!state.products.length) {
    addMessage('assistant', 'There are no products in the currently published catalog. Please check back soon or contact JUPTEE support.', false);
    return;
  }
  const items = state.products.slice(0, 8).map(product => {
    const available = product.variants.filter(variant => variant.stock > 0);
    const minPrice = available.length ? Math.min(...available.map(variant => variant.unitPrice)) : null;
    const stockText = language === 'bn'
      ? available.length ? `${available.length}টি রং/সাইজের অপশন আছে` : 'এখন স্টকে নেই'
      : language === 'banglish'
        ? available.length ? `${available.length} ta color/size option ache` : 'Ekhon stock-e nei'
        : available.length ? `${available.length} available color/size option${available.length === 1 ? '' : 's'}` : 'Currently out of stock';
    const priceText = minPrice === null
      ? language === 'bn' ? 'কোনো স্টকে থাকা ভ্যারিয়েন্ট নেই' : language === 'banglish' ? 'Stock-e variant nei' : 'No available variants'
      : `${language === 'bn' ? 'শুরু' : language === 'banglish' ? 'Shuru' : 'From'} ${money(minPrice)}`;
    return `<article class="jt-chat-product"><img src="${escapeHtml(product.images?.[0] || '/assets/juptee-favicon.png')}" alt="" onerror="this.onerror=null;this.src='/assets/juptee-favicon.png'"><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(priceText)} · ${escapeHtml(stockText)}</span></div></article>`;
  }).join('');
  const title = language === 'bn' ? 'প্রকাশিত পণ্য ও বর্তমান দাম' : language === 'banglish' ? 'Published product ar current price' : 'Published products &amp; current prices';
  const promotion = state.settings?.promotions
    ? `<p>${escapeHtml(language === 'bn' ? 'বর্তমান অফার (তথ্য)' : language === 'banglish' ? 'Current offer (informational)' : 'Current offer (informational only)')}: ${escapeHtml(state.settings.promotions)}</p>`
    : '';
  addHtmlMessage(`<b>${title}</b>${promotion}${items}<p><a class="jt-chat-support" href="#shop">${language === 'bn' ? 'সব পণ্য দেখুন' : language === 'banglish' ? 'Shob product dekhun' : 'Browse the collection'}</a></p>`);
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.loading) return;
  const form = event.currentTarget;
  const input = form.elements.message;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  const language = messageLanguage(message);
  addMessage('user', message);
  const lower = message.toLowerCase();
  if (/(delivery|deliver|shipping|delivery charge|ঢাকা|ডেলিভারি)/i.test(lower)) {
    addDeliveryReply(language);
    return;
  }
  if (/(price|cost|দাম|দাম কত|\bkoto\b|\bdam\b)/i.test(lower) && state.products.length) {
    showCatalog(language);
    return;
  }
  state.loading = true;
  root.querySelector('.jt-chat-send').disabled = true;
  showTyping(true);
  try {
    const response = await fetch('/api/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.history.slice(-10) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The assistant could not respond.');
    addMessage('assistant', result.reply);
  } catch (error) {
    console.error('Shopping assistant request failed:', error);
    addMessage('assistant', state.settings?.supportPhone
      ? `I’m having trouble responding right now. Please try again, or call JUPTEE support at ${state.settings.supportPhone}.`
      : 'I’m having trouble responding right now. Please try again or browse the collection.');
  } finally {
    state.loading = false;
    showTyping(false);
    const sendButton = root.querySelector('.jt-chat-send');
    if (sendButton) sendButton.disabled = false;
    input.focus();
  }
}

function startOrder(prefill = {}) {
  if (!state.ready || !state.products.length) {
    addMessage('assistant', 'I can only take orders for published products with active variants. The live catalog is unavailable or empty right now. Please try again later.');
    return;
  }
  const availableProducts = state.products.filter(product => product.variants.some(variant => variant.stock > 0));
  if (!availableProducts.length) {
    addMessage('assistant', 'There are no in-stock products available to order right now.');
    return;
  }
  state.pendingOrder = null;
  const productOptions = availableProducts.map(product => `<option value="${escapeHtml(product.id)}" ${product.id === prefill.product?.id ? 'selected' : ''}>${escapeHtml(product.name)}</option>`).join('');
  const row = document.createElement('form');
  row.className = 'jt-chat-order';
  row.addEventListener('submit', event => event.preventDefault());
  row.innerHTML = `
    <label>Product<select name="product">${productOptions}</select></label>
    <label>Color / size<select name="variant"></select></label>
    <label>Quantity<input name="quantity" type="number" min="1" max="20" value="${escapeHtml(prefill.quantity || 1)}" required></label>
    <label>Your name<input name="name" maxlength="120" autocomplete="name" value="${escapeHtml(prefill.name || '')}" required></label>
    <label>Mobile number<input name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="tel" value="${escapeHtml(prefill.phone || '')}" required></label>
    <label>Email (optional)<input name="email" type="email" maxlength="254" autocomplete="email" value="${escapeHtml(prefill.email || '')}"></label>
    ${window.locationSelectorMarkup(`chat-order-locations-${++orderFormSequence}`, prefill)}
    <label>House / Building / Road<input name="houseAddress" maxlength="240" autocomplete="address-line1" value="${escapeHtml(prefill.houseAddress || '')}" required></label>
    <label>Area / Village / Local Address<input name="localAddress" maxlength="240" autocomplete="address-line2" value="${escapeHtml(prefill.localAddress || '')}" required></label>
    <label>Delivery instructions (optional)<textarea name="deliveryInstructions" rows="2" maxlength="500">${escapeHtml(prefill.deliveryInstructions || '')}</textarea></label>
    <label>Order notes (optional)<textarea name="notes" rows="2" maxlength="500">${escapeHtml(prefill.notes || '')}</textarea></label>
    <div><small>Payment: Cash on delivery</small></div>
    <div class="jt-chat-order-actions"><button type="button" data-order-preview>Review order</button><button type="button" class="secondary" data-order-cancel>Cancel</button></div>`;
  root.querySelector('.jt-chat-stream').append(row);
  const locationFields = row.querySelector('[data-location-selector]');
  window.initializeLocationSelectors(locationFields);
  const productSelect = row.querySelector('[name="product"]');
  productSelect.addEventListener('change', () => updateVariants(row));
  updateVariants(row);
  if (prefill.variant?.id) row.elements.variant.value = prefill.variant.id;
  if (prefill.quantity) row.elements.quantity.max = String(Math.min(20, prefill.variant?.stock || 20));
  scrollToBottom();
}

function updateVariants(form) {
  const product = state.products.find(item => item.id === form.elements.product.value);
  const variants = (product?.variants || []).filter(variant => variant.stock > 0);
  form.elements.variant.innerHTML = variants.map(variant =>
    `<option value="${escapeHtml(variant.id)}">${escapeHtml(`${variant.color} / ${variant.size} · ${money(variant.unitPrice)} · ${variant.stock} in stock`)}</option>`
  ).join('');
  form.elements.quantity.max = String(Math.min(20, variants.find(variant => variant.id === form.elements.variant.value)?.stock || 20));
}

function orderAction(event) {
  const cancel = event.target.closest('[data-order-cancel]');
  if (cancel) {
    cancel.closest('.jt-chat-order, .jt-chat-review')?.remove();
    state.pendingOrder = null;
    return;
  }
  const review = event.target.closest('[data-order-preview]');
  if (review) {
    const form = review.closest('.jt-chat-order');
    const product = state.products.find(item => item.id === form.elements.product.value);
    const variant = product?.variants.find(item => item.id === form.elements.variant.value);
    const quantity = Number(form.elements.quantity.value);
    if (!form.reportValidity() || !product || !variant || variant.stock < quantity) {
      if (variant && variant.stock < quantity) addMessage('assistant', `Only ${variant.stock} of that color and size are currently available. Please adjust the quantity.`);
      return;
    }
    const phone = form.elements.phone.value.replace(/[\s-]/g, '').replace(/^\+?88/, '');
    if (!/^01[3-9]\d{8}$/.test(phone)) {
      form.elements.phone.setCustomValidity('Enter a valid Bangladeshi mobile number.');
      form.elements.phone.reportValidity();
      form.elements.phone.setCustomValidity('');
      return;
    }
    const locationFields = form.querySelector('[data-location-selector]');
    const division = locationFields.locationData?.find(item => String(item.id) === form.elements.division.value);
    const district = division?.districts.find(item => String(item.id) === form.elements.district.value);
    const upazila = district?.upazilas.find(item => String(item.id) === form.elements.upazila.value);
    if (!division || !district || !upazila) {
      addMessage('assistant', 'Please select a valid division, district, and police station / upazila before reviewing your order.');
      return;
    }
    const details = {
      product,
      variant,
      quantity,
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      divisionId: String(division.id),
      districtId: String(district.id),
      upazilaId: String(upazila.id),
      division: division.name,
      district: district.name,
      upazila: upazila.name,
      deliveryArea: district.name.toLocaleLowerCase() === 'dhaka' ? 'dhaka' : 'out',
      houseAddress: form.elements.houseAddress.value.trim(),
      localAddress: form.elements.localAddress.value.trim(),
      address: [form.elements.houseAddress.value.trim(), form.elements.localAddress.value.trim()].join(', '),
      deliveryInstructions: form.elements.deliveryInstructions.value.trim(),
      notes: form.elements.notes.value.trim()
    };
    const delivery = configuredFees()[details.deliveryArea];
    const subtotal = variant.unitPrice * quantity;
    const summary = document.createElement('div');
    summary.className = 'jt-chat-review';
    summary.innerHTML = `
      <strong>Your order summary</strong>
      <p>Product: ${escapeHtml(product.name)}</p>
      <p>Color / size: ${escapeHtml(variant.color)} / ${escapeHtml(variant.size)}</p>
      <p>Quantity: ${quantity}</p>
      <p>Product subtotal: ${money(subtotal)}</p>
      <p>Delivery: ${money(delivery)}</p>
      <p><b>Estimated total: ${money(subtotal + delivery)}</b></p>
      <p>Customer: ${escapeHtml(details.name)}</p>
      <p>Phone: ${escapeHtml(details.phone)}</p>
      <p>Division: ${escapeHtml(details.division)}</p>
      <p>District: ${escapeHtml(details.district)}</p>
      <p>Police station / Upazila: ${escapeHtml(details.upazila)}</p>
      <p>Address: ${escapeHtml(details.address)}</p>
      <p>Delivery instructions: ${escapeHtml(details.deliveryInstructions || 'None')}</p>
      <p>Payment: Cash on delivery</p>
      <p>Would you like to confirm this order?</p>
      <div class="jt-chat-order-actions"><button type="button" data-order-confirm>Confirm order</button><button type="button" class="secondary" data-order-edit>Edit</button><button type="button" class="secondary" data-order-cancel>Cancel</button></div>`;
    state.pendingOrder = { details, summary: { subtotal, delivery, total: subtotal + delivery } };
    form.replaceWith(summary);
    scrollToBottom();
    return;
  }
  const edit = event.target.closest('[data-order-edit]');
  if (edit) {
    const details = state.pendingOrder?.details;
    state.pendingOrder = null;
    edit.closest('.jt-chat-review')?.remove();
    startOrder(details || {});
    return;
  }
  const confirm = event.target.closest('[data-order-confirm]');
  if (confirm) submitOrder(confirm);
}

async function submitOrder(button) {
  if (!state.pendingOrder || button.disabled) return;
  const { details } = state.pendingOrder;
  if (!state.pendingOrder.request) {
    const phone = details.phone.replace(/[\s-]/g, '');
    state.pendingOrder.request = {
      key: crypto.randomUUID ? crypto.randomUUID() : `JT-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      body: JSON.stringify({
        name: details.name,
        phone,
        email: details.email,
        divisionId: details.divisionId,
        districtId: details.districtId,
        upazilaId: details.upazilaId,
        houseAddress: details.houseAddress,
        localAddress: details.localAddress,
        deliveryInstructions: details.deliveryInstructions,
        notes: details.notes,
        items: [{ variantId: details.variant.id, quantity: details.quantity }]
      })
    };
  }
  button.disabled = true;
  button.textContent = 'Submitting…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': state.pendingOrder.request.key },
      body: state.pendingOrder.request.body,
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'We could not save the order. Please retry.');
    if (typeof result.orderId !== 'string' || !result.orderId || !Number.isSafeInteger(result.total)) throw new Error('The server did not return a complete order confirmation. Retry safely or contact JUPTEE.');
    const review = button.closest('.jt-chat-review');
    review.innerHTML = `<p><strong>🎉 Thank you for shopping with Juptee!</strong></p><p>Your order has been successfully received. Your Order ID is:</p><p><b>${escapeHtml(result.orderId)}</b></p><p>Final payable: <b>${money(result.total)}</b></p><p>Delivery: ${escapeHtml([result.division, result.district, result.upazila, result.address].filter(Boolean).join(' · '))}</p><p>Phone: ${escapeHtml(result.phone || '')}</p><p>Our team will contact you shortly.</p>`;
    state.pendingOrder = null;
    state.products = [];
    state.ready = false;
    loadStoreData();
  } catch (error) {
    console.error('Chat order submission failed:', error);
    button.disabled = false;
    button.textContent = 'Retry order submission';
    const review = button.closest('.jt-chat-review');
    const failure = document.createElement('p');
    failure.className = 'jt-chat-error';
    failure.textContent = `${error.message} Your order details are retained here; retry uses the same safe submission key.`;
    review.querySelector('.jt-chat-error')?.remove();
    review.append(failure);
  } finally {
    clearTimeout(timeout);
  }
}

renderWidget();
