const $ = selector => document.querySelector(selector);
const orderList = $('#order-list');
const ordersFeedback = $('#orders-feedback');
const settingsFeedback = $('#settings-feedback');
const productsFeedback = $('#product-feedback');
const productForm = $('#product-form');
const productList = $('#product-list');
const imageSlots = $('#image-slots');
const variantRows = $('#variant-rows');
const statuses = ['new', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled'];
const imageLabels = ['Front', 'Back', 'Side', 'Detail'];
let products = [];
let currentImages = [];
let selectedFiles = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function money(value) {
  return '৳' + Number(value).toLocaleString('en-US');
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function productCard(product) {
  const image = product.images?.[0]?.url || '';
  const variants = product.variants || [];
  const stock = variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
  return `<article class="product-admin-card">
    <img src="${escapeHtml(image)}" alt="" loading="lazy">
    <div><strong>${escapeHtml(product.title)}</strong><p>${escapeHtml(product.id)} · ${money(product.salePrice || product.price)}</p><p>${product.active ? 'Published' : 'Draft'} · ${variants.length} variations · ${stock} stock</p></div>
    <button class="btn alt" type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
  </article>`;
}

async function loadProducts() {
  productList.innerHTML = '<div class="admin-empty">Loading products…</div>';
  try {
    const result = await api('/api/admin/products');
    products = result.products || [];
    productList.innerHTML = products.length
      ? products.map(productCard).join('')
      : '<div class="admin-empty">No products yet. Add your first product to start building the catalog.</div>';
  } catch (error) {
    productList.innerHTML = `<div class="admin-empty">Products could not be loaded: ${escapeHtml(error.message)}</div>`;
  }
}

function renderImageSlots() {
  imageSlots.innerHTML = imageLabels.map((label, index) => {
    const image = currentImages[index];
    return `<label class="image-slot">${escapeHtml(label)} photo
      <img src="${escapeHtml(image?.url || '')}" alt="${escapeHtml(image ? `${label} product photo` : `Preview for ${label} photo`)}" data-image-preview="${index}">
      <input type="file" name="image${index}" accept="image/jpeg,image/png,image/webp" data-image-file="${index}">
      <span class="hint">${image ? 'Current photo kept unless replaced.' : 'No photo uploaded yet.'}</span>
    </label>`;
  }).join('');
}

function readColorsAndSizes() {
  const colors = productForm.elements.colors.value.split(',').map(value => value.trim()).filter(Boolean);
  const sizes = productForm.elements.sizes.value.split(',').map(value => value.trim()).filter(Boolean);
  return { colors: [...new Set(colors)], sizes: [...new Set(sizes)] };
}

function buildVariantRows(previous = []) {
  const { colors, sizes } = readColorsAndSizes();
  if (!colors.length || !sizes.length) {
    variantRows.innerHTML = '<tr><td colspan="4">Enter at least one color and size.</td></tr>';
    return;
  }
  const old = new Map(previous.map(variant => [`${variant.color.toLowerCase()}\u0000${variant.size.toLowerCase()}`, variant]));
  variantRows.innerHTML = colors.flatMap(color => sizes.map(size => {
    const variant = old.get(`${color.toLowerCase()}\u0000${size.toLowerCase()}`);
    return `<tr>
      <td>${escapeHtml(color)}<input type="hidden" name="variantColor" value="${escapeHtml(color)}"></td>
      <td>${escapeHtml(size)}<input type="hidden" name="variantSize" value="${escapeHtml(size)}"></td>
      <td><input type="number" name="variantStock" min="0" max="10000" step="1" value="${Number(variant?.stock || 0)}" aria-label="${escapeHtml(`${color} ${size} stock`)}"></td>
      <td><input type="checkbox" name="variantActive" ${variant ? (variant.active ? 'checked' : '') : 'checked'} aria-label="${escapeHtml(`${color} ${size} active`)}"></td>
    </tr>`;
  })).join('');
}

function resetProductEditor() {
  productForm.reset();
  productForm.hidden = true;
  currentImages = [];
  selectedFiles = [];
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
}

function createProduct() {
  productForm.reset();
  productForm.hidden = false;
  productForm.elements.id.value = `JUP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  productForm.elements.colors.value = 'Black, White';
  productForm.elements.sizes.value = 'M, L, XL, XXL, 3XL';
  productForm.elements.price.value = '0';
  productForm.elements.sortOrder.value = '0';
  productForm.elements.active.checked = false;
  currentImages = [];
  selectedFiles = [];
  $('#product-form-title').textContent = 'Add a product';
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
  renderImageSlots();
  buildVariantRows();
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editProduct(product) {
  productForm.reset();
  productForm.hidden = false;
  productForm.elements.id.value = product.id;
  productForm.elements.title.value = product.title;
  productForm.elements.category.value = product.category;
  productForm.elements.badge.value = product.badge || '';
  productForm.elements.price.value = product.price;
  productForm.elements.salePrice.value = product.salePrice || '';
  productForm.elements.description.value = product.description || '';
  productForm.elements.colors.value = [...new Set(product.variants.map(variant => variant.color))].join(', ');
  productForm.elements.sizes.value = [...new Set(product.variants.map(variant => variant.size))].join(', ');
  productForm.elements.sortOrder.value = product.sortOrder || 0;
  productForm.elements.active.checked = product.active;
  currentImages = (product.images || []).map(image => ({ ...image }));
  selectedFiles = [];
  $('#product-form-title').textContent = `Edit ${product.title}`;
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
  renderImageSlots();
  buildVariantRows(product.variants);
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function collectVariants() {
  const colors = [...productForm.querySelectorAll('[name="variantColor"]')];
  const sizes = [...productForm.querySelectorAll('[name="variantSize"]')];
  const stocks = [...productForm.querySelectorAll('[name="variantStock"]')];
  const active = [...productForm.querySelectorAll('[name="variantActive"]')];
  return colors.map((input, index) => ({
    color: input.value,
    size: sizes[index].value,
    stock: Number(stocks[index].value),
    active: active[index].checked
  }));
}

function orderCard(order) {
  const lines = order.items.map(item => `<div class="order-item">
    <span>${escapeHtml(item.product_title)} · ${escapeHtml(item.color)} / ${escapeHtml(item.size)} × ${item.quantity}</span>
    <b>${money(item.line_total)}</b>
  </div>`).join('');
  const options = statuses.map(status => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('');
  const date = new Date(order.created_at).toLocaleString();
  return `<details class="order-card">
    <summary>
      <span><span class="order-id">${escapeHtml(order.id)}</span><span class="order-meta">${escapeHtml(order.customer_name)} · ${escapeHtml(date)}</span></span>
      <span class="order-total">${money(order.total_amount)}</span>
      <span class="order-meta">${escapeHtml(order.status)}</span>
    </summary>
    <div class="order-content">
      <div><h3>Customer</h3><p>${escapeHtml(order.customer_name)}</p><p><a href="tel:${escapeHtml(order.customer_phone)}">${escapeHtml(order.customer_phone)}</a></p><p>${order.customer_email ? `<a href="mailto:${escapeHtml(order.customer_email)}">${escapeHtml(order.customer_email)}</a>` : 'No email provided'}</p></div>
      <div><h3>Delivery · ${escapeHtml(order.delivery_area)} · ${money(order.delivery_charge)}</h3><p>${escapeHtml(order.district_area)}</p><p>${escapeHtml(order.full_address)}</p><p>Notes: ${escapeHtml(order.order_notes || 'None')}</p></div>
      <div class="order-items"><h3>Products</h3>${lines}<div class="order-item"><span>Subtotal</span><b>${money(order.subtotal)}</b></div><div class="order-item"><span>Discount</span><b>${money(order.discount_amount)}</b></div><div class="order-item"><strong>Final payable</strong><strong>${money(order.total_amount)}</strong></div></div>
      <div><h3>Notification delivery</h3>
        <p class="notification-state ${order.whatsapp_status === 'failed' ? 'failed' : ''}">WhatsApp: ${escapeHtml(order.whatsapp_status)}${order.whatsapp_error ? ` · ${escapeHtml(order.whatsapp_error)}` : ''}</p>
        <p class="notification-state ${order.email_status === 'failed' ? 'failed' : ''}">Email: ${escapeHtml(order.email_status)}${order.email_error ? ` · ${escapeHtml(order.email_error)}` : ''}</p>
      </div>
      <div class="order-actions"><label>Status <select data-order-id="${escapeHtml(order.id)}">${options}</select></label></div>
    </div>
  </details>`;
}

async function loadOrders() {
  ordersFeedback.textContent = '';
  orderList.innerHTML = '';
  $('#orders-count').textContent = 'Loading orders…';
  try {
    const { orders } = await api('/api/admin/orders');
    $('#orders-count').textContent = `${orders.length} recent ${orders.length === 1 ? 'order' : 'orders'}`;
    orderList.innerHTML = orders.length ? orders.map(orderCard).join('') : '<div class="empty-orders">No orders have been saved yet.</div>';
  } catch (error) {
    $('#orders-count').textContent = 'Orders could not be loaded.';
    ordersFeedback.textContent = error.message;
    ordersFeedback.className = 'admin-feedback error';
  }
}

async function loadSettings() {
  settingsFeedback.textContent = '';
  try {
    const settings = await api('/api/admin/settings');
    $('#settings-form').elements.whatsapp_recipient.value = settings.whatsapp_recipient || '';
    $('#settings-form').elements.notification_email.value = settings.notification_email || '';
  } catch (error) {
    settingsFeedback.textContent = error.message;
    settingsFeedback.className = 'admin-feedback error';
  }
}

$('#orders-tab').addEventListener('click', () => {
  $('#orders-tab').setAttribute('aria-selected', 'true');
  $('#products-tab').setAttribute('aria-selected', 'false');
  $('#settings-tab').setAttribute('aria-selected', 'false');
  $('#orders-panel').hidden = false;
  $('#products-panel').hidden = true;
  $('#settings-panel').hidden = true;
});

$('#products-tab').addEventListener('click', () => {
  $('#orders-tab').setAttribute('aria-selected', 'false');
  $('#products-tab').setAttribute('aria-selected', 'true');
  $('#settings-tab').setAttribute('aria-selected', 'false');
  $('#orders-panel').hidden = true;
  $('#products-panel').hidden = false;
  $('#settings-panel').hidden = true;
  loadProducts();
});

$('#settings-tab').addEventListener('click', () => {
  $('#orders-tab').setAttribute('aria-selected', 'false');
  $('#products-tab').setAttribute('aria-selected', 'false');
  $('#settings-tab').setAttribute('aria-selected', 'true');
  $('#orders-panel').hidden = true;
  $('#products-panel').hidden = true;
  $('#settings-panel').hidden = false;
  loadSettings();
});

$('#refresh-orders').addEventListener('click', loadOrders);
$('#new-product').addEventListener('click', createProduct);
$('#cancel-product').addEventListener('click', resetProductEditor);
$('#build-variants').addEventListener('click', () => buildVariantRows(collectVariants()));

productList.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-product]');
  if (!button) return;
  const product = products.find(item => item.id === button.dataset.editProduct);
  if (product) editProduct(product);
});

imageSlots.addEventListener('change', event => {
  const input = event.target.closest('[data-image-file]');
  if (!input) return;
  const index = Number(input.dataset.imageFile);
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) {
    input.value = '';
    productsFeedback.textContent = 'Each image must be smaller than 6 MB.';
    productsFeedback.className = 'admin-feedback error';
    return;
  }
  selectedFiles[index] = file;
  const preview = $(`[data-image-preview="${index}"]`);
  preview.src = URL.createObjectURL(file);
  input.nextElementSibling.textContent = `${file.name} · will upload when saved.`;
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
});

productForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const button = productForm.querySelector('button[type="submit"]');
  button.disabled = true;
  productsFeedback.textContent = 'Saving product…';
  productsFeedback.className = 'admin-feedback';
  try {
    const productId = productForm.elements.id.value;
    const imagesBySlot = new Map(currentImages.map((image, slot) => [slot, image.key]));
    const formData = new FormData();
    formData.append('productId', productId);
    selectedFiles.forEach((file, slot) => {
      if (!file) return;
      formData.append('image', file, file.name);
      formData.append('slot', String(slot));
    });
    if (selectedFiles.some(Boolean)) {
      const { images: uploaded } = await api('/api/admin/product-images', { method: 'POST', body: formData });
      uploaded.forEach(image => { imagesBySlot.set(image.slot, image.key); });
    }
    const images = [...imagesBySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, key]) => key);
    const payload = {
      id: productId,
      title: productForm.elements.title.value.trim(),
      category: productForm.elements.category.value,
      description: productForm.elements.description.value.trim(),
      price: Number(productForm.elements.price.value),
      salePrice: productForm.elements.salePrice.value ? Number(productForm.elements.salePrice.value) : 0,
      badge: productForm.elements.badge.value,
      sortOrder: Number(productForm.elements.sortOrder.value),
      active: productForm.elements.active.checked,
      images,
      variants: collectVariants()
    };
    const { product } = await api('/api/admin/products', { method: 'PUT', body: JSON.stringify(payload) });
    selectedFiles = [];
    await loadProducts();
    if (product) editProduct(product);
    productsFeedback.textContent = 'Product saved successfully.';
    productsFeedback.className = 'admin-feedback success';
  } catch (error) {
    productsFeedback.textContent = error.message;
    productsFeedback.className = 'admin-feedback error';
  } finally {
    button.disabled = false;
  }
});

orderList.addEventListener('change', async event => {
  const select = event.target.closest('select[data-order-id]');
  if (!select) return;
  select.disabled = true;
  try {
    await api('/api/admin/orders', {
      method: 'PATCH',
      body: JSON.stringify({ id: select.dataset.orderId, status: select.value })
    });
    ordersFeedback.textContent = 'Order status updated.';
    ordersFeedback.className = 'admin-feedback success';
  } catch (error) {
    await loadOrders();
    ordersFeedback.textContent = error.message;
    ordersFeedback.className = 'admin-feedback error';
  } finally {
    select.disabled = false;
  }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  settingsFeedback.textContent = '';
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        whatsapp_recipient: form.elements.whatsapp_recipient.value.trim(),
        notification_email: form.elements.notification_email.value.trim()
      })
    });
    settingsFeedback.textContent = 'Notification contacts saved for future orders.';
    settingsFeedback.className = 'admin-feedback success';
  } catch (error) {
    settingsFeedback.textContent = error.message;
    settingsFeedback.className = 'admin-feedback error';
  } finally {
    button.disabled = false;
  }
});

loadOrders();
