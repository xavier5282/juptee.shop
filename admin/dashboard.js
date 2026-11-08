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
let imagePaths = [];
let previewUrls = [];

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
    <img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/assets/juptee-favicon.png'">
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
    const path = imagePaths[index] || (image?.source === 'local' ? image.ref : '');
    const preview = previewUrls[index] || image?.url || '';
    const status = selectedFiles[index]
      ? `${selectedFiles[index].name} · ready to upload.`
      : image ? (image.source === 'local' ? 'Repository image kept.' : 'Current image kept unless replaced.') : 'No image selected.';
    return `<div class="image-slot" data-image-drop="${index}">
      <strong>${escapeHtml(label)} photo${index === 0 ? ' · Primary' : ''}</strong>
      <img src="${escapeHtml(preview)}" alt="${escapeHtml(image ? `${label} product photo` : `Preview for ${label} photo`)}" data-image-preview="${index}" onerror="this.onerror=null;this.src='/assets/juptee-favicon.png'">
      <label>Upload image <input type="file" accept="image/jpeg,image/png,image/webp" data-image-file="${index}"></label>
      <label>Repository image path
        <input type="text" data-image-path="${index}" value="${escapeHtml(path)}" placeholder="/assets/products/product-name.webp">
      </label>
      <div class="image-slot-controls">
        <button class="btn alt" type="button" data-primary-image="${index}" ${index === 0 ? 'disabled' : ''}>${index === 0 ? 'Primary image' : 'Set as primary'}</button>
        <button class="btn alt" type="button" data-remove-image="${index}">Remove</button>
      </div>
      <span class="hint">${escapeHtml(status)} Drop an image here to replace.</span>
    </div>`;
  }).join('');
}

function clearPreviewUrls() {
  previewUrls.forEach(url => { if (url) URL.revokeObjectURL(url); });
  previewUrls = [];
}

function imageFileError(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!file || (file.type && !allowedTypes.includes(file.type.toLowerCase()))) {
    return 'Use a JPG, PNG, or WebP image.';
  }
  if (file.size < 1 || file.size > 6 * 1024 * 1024) return 'Each image must be smaller than 6 MB.';
  return '';
}

function setImageFile(index, file) {
  const error = imageFileError(file);
  if (error) {
    productsFeedback.textContent = error;
    productsFeedback.className = 'admin-feedback error';
    return false;
  }
  if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]);
  selectedFiles[index] = file;
  imagePaths[index] = '';
  previewUrls[index] = URL.createObjectURL(file);
  const pathInput = imageSlots.querySelector(`[data-image-path="${index}"]`);
  if (pathInput) pathInput.value = '';
  const preview = imageSlots.querySelector(`[data-image-preview="${index}"]`);
  if (preview) preview.src = previewUrls[index];
  const hint = imageSlots.querySelector(`[data-image-drop="${index}"] .hint`);
  if (hint) hint.textContent = `${file.name} · ready to upload. Drop another image here to replace.`;
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
  return true;
}

function uploadProductImages(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/product-images');
    request.withCredentials = true;
    request.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let result = {};
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error('The image upload returned an invalid response.'));
        return;
      }
      if (request.status >= 200 && request.status < 300) resolve(result);
      else reject(new Error(result.error || `Image upload failed (${request.status}).`));
    });
    request.addEventListener('error', () => reject(new Error('The image upload could not reach the server.')));
    request.addEventListener('abort', () => reject(new Error('The image upload was cancelled.')));
    request.send(formData);
  });
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
  clearPreviewUrls();
  productForm.reset();
  productForm.hidden = true;
  currentImages = [];
  selectedFiles = [];
  imagePaths = [];
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
}

function createProduct() {
  clearPreviewUrls();
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
  imagePaths = [];
  $('#bulk-images').value = '';
  $('#product-form-title').textContent = 'Add a product';
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
  renderImageSlots();
  buildVariantRows();
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editProduct(product) {
  clearPreviewUrls();
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
  imagePaths = currentImages.map(image => image?.source === 'local' ? image.ref : '');
  $('#bulk-images').value = '';
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
      <div><h3>Delivery · ${escapeHtml(order.delivery_area)} · ${money(order.delivery_charge)}</h3><p>Division: ${escapeHtml(order.division_name || 'Not recorded')}</p><p>District: ${escapeHtml(order.district_name || order.district_area || 'Not recorded')}</p><p>Police station / Upazila: ${escapeHtml(order.upazila_name || 'Not recorded')}</p><p>Address: ${escapeHtml(order.full_address)}</p><p>Delivery instructions: ${escapeHtml(order.delivery_instructions || 'None')}</p><p>Order notes: ${escapeHtml(order.order_notes || 'None')}</p></div>
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
    const form = $('#settings-form');
    form.elements.whatsapp_recipient.value = settings.whatsapp_recipient || '';
    form.elements.notification_email.value = settings.notification_email || '';
    form.elements.chat_delivery_dhaka.value = settings.chat_delivery_dhaka;
    form.elements.chat_delivery_subcity.value = settings.chat_delivery_subcity;
    form.elements.chat_delivery_out.value = settings.chat_delivery_out;
    form.elements.chat_support_phone.value = settings.chat_support_phone || '';
    form.elements.chat_size_chart.value = settings.chat_size_chart || '';
    form.elements.chat_promotions.value = settings.chat_promotions || '';
    form.elements.chat_faqs.value = settings.chat_faqs || '';
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
  const fileInput = event.target.closest('[data-image-file]');
  if (fileInput) {
    const index = Number(fileInput.dataset.imageFile);
    if (!setImageFile(index, fileInput.files?.[0])) fileInput.value = '';
    return;
  }
  const pathInput = event.target.closest('[data-image-path]');
  if (!pathInput) return;
  const index = Number(pathInput.dataset.imagePath);
  const path = pathInput.value.trim();
  if (path && !/^\/assets\/products\/(?!.*(?:\.\.|[?#\\]))[A-Za-z0-9][A-Za-z0-9._ %()-]*\.(?:jpg|jpeg|png|webp)$/i.test(path)) {
    productsFeedback.textContent = 'Use a repository image path such as /assets/products/product-name.webp.';
    productsFeedback.className = 'admin-feedback error';
    return;
  }
  imagePaths[index] = path;
  if (path) {
    selectedFiles[index] = null;
    if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]);
    previewUrls[index] = '';
  }
  const preview = imageSlots.querySelector(`[data-image-preview="${index}"]`);
  if (preview) preview.src = path || currentImages[index]?.url || '';
  productsFeedback.textContent = '';
  productsFeedback.className = 'admin-feedback';
});

imageSlots.addEventListener('dragover', event => {
  if (event.target.closest('[data-image-drop]')) event.preventDefault();
});

imageSlots.addEventListener('drop', event => {
  const slot = event.target.closest('[data-image-drop]');
  if (!slot) return;
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) setImageFile(Number(slot.dataset.imageDrop), file);
});

imageSlots.addEventListener('click', event => {
  const primaryButton = event.target.closest('[data-primary-image]');
  if (primaryButton) {
    const index = Number(primaryButton.dataset.primaryImage);
    if (index > 0) {
      [currentImages[0], currentImages[index]] = [currentImages[index], currentImages[0]];
      [selectedFiles[0], selectedFiles[index]] = [selectedFiles[index], selectedFiles[0]];
      [imagePaths[0], imagePaths[index]] = [imagePaths[index], imagePaths[0]];
      [previewUrls[0], previewUrls[index]] = [previewUrls[index], previewUrls[0]];
      renderImageSlots();
    }
    return;
  }
  const removeButton = event.target.closest('[data-remove-image]');
  if (removeButton) {
    const index = Number(removeButton.dataset.removeImage);
    currentImages[index] = null;
    selectedFiles[index] = null;
    imagePaths[index] = '';
    if (previewUrls[index]) URL.revokeObjectURL(previewUrls[index]);
    previewUrls[index] = '';
    renderImageSlots();
  }
});

$('#bulk-images').addEventListener('change', event => {
  const files = [...event.target.files];
  if (files.length > 4) {
    event.target.value = '';
    productsFeedback.textContent = 'Choose no more than four images.';
    productsFeedback.className = 'admin-feedback error';
    return;
  }
  const invalidFile = files.find(file => imageFileError(file));
  if (invalidFile) {
    event.target.value = '';
    productsFeedback.textContent = imageFileError(invalidFile);
    productsFeedback.className = 'admin-feedback error';
    return;
  }
  clearPreviewUrls();
  currentImages = [];
  selectedFiles = [];
  imagePaths = [];
  files.forEach((file, index) => setImageFile(index, file));
  renderImageSlots();
});

productForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const button = productForm.querySelector('button[type="submit"]');
  button.disabled = true;
  productsFeedback.textContent = 'Saving product…';
  productsFeedback.className = 'admin-feedback';
  let uploadedPublicIds = [];
  let productId = productForm.elements.id.value;
  try {
    const formData = new FormData();
    formData.append('productId', productId);
    selectedFiles.forEach((file, slot) => {
      if (!file) return;
      formData.append('image', file, file.name);
      formData.append('slot', String(slot));
    });
    if (selectedFiles.some(Boolean)) {
      productsFeedback.textContent = 'Uploading images… 0%';
      const { images: uploaded } = await uploadProductImages(formData, progress => {
        productsFeedback.textContent = `Uploading images… ${progress}%`;
      });
      uploadedPublicIds = uploaded.map(image => image.publicId);
      uploaded.forEach(image => {
        currentImages[image.slot] = {
          ref: { source: image.source, publicId: image.publicId, url: image.url },
          source: image.source,
          publicId: image.publicId,
          url: image.url
        };
      });
    }
    const images = imageLabels.map((_, slot) => {
      const path = imageSlots.querySelector(`[data-image-path="${slot}"]`)?.value.trim();
      return path || currentImages[slot]?.ref || null;
    }).filter(Boolean);
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
    productsFeedback.textContent = 'Saving product details…';
    const { product, warnings = [] } = await api('/api/admin/products', { method: 'PUT', body: JSON.stringify(payload) });
    selectedFiles = [];
    await loadProducts();
    if (product) editProduct(product);
    productsFeedback.textContent = warnings.length
      ? `Product saved. ${warnings.join(' ')}`
      : 'Product saved successfully.';
    productsFeedback.className = warnings.length ? 'admin-feedback error' : 'admin-feedback success';
  } catch (error) {
    let message = error.message;
    if (uploadedPublicIds.length) {
      try {
        await api('/api/admin/product-images', {
          method: 'DELETE',
          body: JSON.stringify({ productId, publicIds: uploadedPublicIds })
        });
      } catch (cleanupError) {
        message = `${message} The newly uploaded images could not be cleaned up: ${cleanupError.message}`;
      }
    }
    productsFeedback.textContent = message;
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
        notification_email: form.elements.notification_email.value.trim(),
        chat_delivery_dhaka: Number(form.elements.chat_delivery_dhaka.value),
        chat_delivery_subcity: Number(form.elements.chat_delivery_subcity.value),
        chat_delivery_out: Number(form.elements.chat_delivery_out.value),
        chat_support_phone: form.elements.chat_support_phone.value.trim(),
        chat_size_chart: form.elements.chat_size_chart.value.trim(),
        chat_promotions: form.elements.chat_promotions.value.trim(),
        chat_faqs: form.elements.chat_faqs.value.trim()
      })
    });
    settingsFeedback.textContent = 'Store and assistant settings saved.';
    settingsFeedback.className = 'admin-feedback success';
  } catch (error) {
    settingsFeedback.textContent = error.message;
    settingsFeedback.className = 'admin-feedback error';
  } finally {
    button.disabled = false;
  }
});

loadOrders();
