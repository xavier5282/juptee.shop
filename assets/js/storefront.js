async function fetchProducts() {
  const response = await fetch('./data/products.json');
  if (!response.ok) throw new Error('Unable to load products.');
  const data = await response.json();
  if (!data || !Array.isArray(data.products)) {
    throw new Error('The product catalog must contain a products array.');
  }
  return data.products.filter(product => product.status === 'published');
}

const money = value => new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 0
}).format(value);

const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const productPrice = product => product.discount_price > 0 && product.discount_price < product.price
  ? product.discount_price
  : product.price;

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

function productCard(product, promotion = false) {
  const discount = productPrice(product) < product.price;
  const image = product.images && product.images[0] ? product.images[0] : './assets/juptee-favicon.png';
  const savings = product.price - productPrice(product);
  const tag = promotion && discount ? `Save ${money(savings)}` : product.featured ? 'Featured' : product.category;
  return `
    <article class="product-card">
      <a class="product-figure" href="./product-details.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.name)}">
        <span class="product-tag${promotion && discount ? ' product-tag-promo' : ''}">${escapeHtml(tag)}</span>
        <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
      </a>
      <div class="product-body">
        <span class="product-category">${escapeHtml(product.category)}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="product-price">
          <span>${money(productPrice(product))}</span>
          ${discount ? `<span class="old">${money(product.price)}</span>` : ''}
        </div>
        <div class="card-footer">
          <a href="./product-details.html?id=${encodeURIComponent(product.id)}" class="cta-button">View Details</a>
        </div>
      </div>
    </article>
  `;
}

function renderFeaturedProducts(products) {
  const target = document.getElementById('featured-products');
  if (!target) return;
  target.innerHTML = products.filter(product => product.featured).slice(0, 4).map(product => productCard(product)).join('');
}

function renderLatestProducts(products) {
  const target = document.getElementById('latest-products');
  if (!target) return;
  target.innerHTML = [...products].reverse().slice(0, 4).map(product => productCard(product)).join('');
}

function renderPromotions(products) {
  const target = document.getElementById('promotion-products');
  const section = document.getElementById('promotions');
  if (!target || !section) return;

  const offers = products
    .filter(product => product.price > 0 && productPrice(product) < product.price)
    .sort((first, second) => {
      const firstRate = (first.price - productPrice(first)) / first.price;
      const secondRate = (second.price - productPrice(second)) / second.price;
      return secondRate - firstRate;
    })
    .slice(0, 3);

  if (!offers.length) return;

  const topSaving = Math.max(...offers.map(product => product.price - productPrice(product)));
  const savingsLabel = money(topSaving);
  section.hidden = false;
  target.innerHTML = offers.map(product => productCard(product, true)).join('');
  document.getElementById('promotion-savings').textContent = savingsLabel;
  document.getElementById('promotion-stamp').textContent = savingsLabel;
}

function renderCollectionPage(products) {
  const target = document.getElementById('catalog-grid');
  const categoryButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const searchInput = document.getElementById('catalog-search');
  const sortSelect = document.getElementById('catalog-sort');
  if (!target || !searchInput || !sortSelect) return;

  const categoryParam = getQueryParam('category');
  const validCategories = categoryButtons.map(button => button.dataset.filter);
  let activeCategory = validCategories.includes(categoryParam) ? categoryParam : 'All Products';

  const applyFilters = () => {
    const query = searchInput.value.trim().toLowerCase();
    const sortValue = sortSelect.value;
    const filtered = products.filter(product => {
      const matchesCategory = activeCategory === 'All Products' || product.category === activeCategory;
      const searchable = `${product.id} ${product.name} ${product.category} ${product.description || ''}`.toLowerCase();
      return matchesCategory && (!query || searchable.includes(query));
    });
    const sorted = [...filtered].sort((first, second) => {
      if (sortValue === 'low-to-high') return productPrice(first) - productPrice(second);
      if (sortValue === 'high-to-low') return productPrice(second) - productPrice(first);
      return Number(Boolean(second.featured)) - Number(Boolean(first.featured));
    });

    categoryButtons.forEach(button => {
      const isActive = button.dataset.filter === activeCategory;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    target.innerHTML = sorted.length
      ? sorted.map(product => productCard(product)).join('')
      : activeCategory === 'Hoodies'
        ? '<div class="not-found"><h3>New hoodies are coming soon.</h3><p>Check back when the next collection is ready.</p></div>'
        : '<div class="not-found"><h3>No products match your filters.</h3><p>Try another search or category.</p></div>';
  };

  categoryButtons.forEach(button => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.filter;
      applyFilters();
    });
  });
  searchInput.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  applyFilters();
}

function renderProductDetails(products) {
  const target = document.getElementById('product-details');
  if (!target) return;

  const product = products.find(item => item.id === getQueryParam('id'));
  if (!product) {
    target.innerHTML = `
      <div class="not-found">
        <h3>Product not found</h3>
        <p>The product you requested is unavailable or has been removed.</p>
        <a href="./products.html" class="cta-button">Browse all products</a>
      </div>
    `;
    return;
  }

  const images = product.images && product.images.length ? product.images : ['./assets/juptee-favicon.png'];
  const colors = Array.isArray(product.colors) && product.colors.length ? product.colors : ['Default'];
  const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['One Size'];
  const discount = productPrice(product) < product.price;
  const currentPrice = productPrice(product);

  target.innerHTML = `
    <div class="details-layout">
      <div>
        <div class="gallery-main">
          <img id="main-image" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.name)}" />
        </div>
        <div class="gallery-thumbs">
          ${images.map((image, index) => `
            <button type="button" class="gallery-thumb ${index === 0 ? 'is-selected' : ''}" data-image="${escapeHtml(image)}" aria-label="View image ${index + 1}" aria-pressed="${index === 0}">
              <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)} view ${index + 1}" loading="lazy" />
            </button>
          `).join('')}
        </div>
      </div>
      <aside class="product-summary">
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h1>${escapeHtml(product.name)}</h1>
        <div class="price-row">
          <span class="current">${money(currentPrice)}</span>
          ${discount ? `<span class="was">${money(product.price)}</span>` : ''}
        </div>
        <p>${escapeHtml(product.description || '')}</p>

        <div class="option-group">
          <span class="option-label">Color</span>
          <div class="swatches">
            ${colors.map((color, index) => `<button type="button" class="swatch ${index === 0 ? 'is-active' : ''}" aria-pressed="${index === 0}">${escapeHtml(color)}</button>`).join('')}
          </div>
        </div>

        <div class="option-group">
          <span class="option-label">Size</span>
          <div class="size-list">
            ${sizes.map((size, index) => `<button type="button" class="size-pill ${index === 0 ? 'is-active' : ''}" aria-pressed="${index === 0}">${escapeHtml(size)}</button>`).join('')}
          </div>
        </div>

        <div class="summary-actions">
          <a id="whatsapp-order" href="#" class="cta-button" target="_blank" rel="noopener noreferrer">Order on WhatsApp</a>
          <a href="./products.html" class="secondary-button">Continue Shopping</a>
        </div>

        <div class="summary-meta">
          <div class="summary-meta-row"><span>Product ID</span><strong>${escapeHtml(product.id)}</strong></div>
        </div>
      </aside>
    </div>
  `;

  document.title = `${product.name} | JUPTEE`;
  const mainImage = document.getElementById('main-image');
  const galleryButtons = Array.from(target.querySelectorAll('.gallery-thumb'));
  galleryButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (mainImage) mainImage.src = button.dataset.image;
      galleryButtons.forEach(item => {
        const selected = item === button;
        item.classList.toggle('is-selected', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  const orderButton = document.getElementById('whatsapp-order');
  const updateOrderLink = () => {
    const selectedColor = target.querySelector('.swatch.is-active').textContent.trim();
    const selectedSize = target.querySelector('.size-pill.is-active').textContent.trim();
    const message = [
      'Hi JUPTEE, I would like to order:',
      `Product: ${product.name}`,
      `ID: ${product.id}`,
      `Category: ${product.category}`,
      `Price: ${money(currentPrice)}`,
      `Color: ${selectedColor}`,
      `Size: ${selectedSize}`,
      `Product link: ${window.location.href}`
    ].join('\n');
    orderButton.href = `https://wa.me/8801601103327?text=${encodeURIComponent(message)}`;
  };

  target.querySelectorAll('.swatch, .size-pill').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.parentElement;
      group.querySelectorAll('button').forEach(option => {
        const selected = option === button;
        option.classList.toggle('is-active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      updateOrderLink();
    });
  });
  updateOrderLink();
}

async function initializeStorefront() {
  try {
    const products = await fetchProducts();
    if (document.getElementById('featured-products')) renderFeaturedProducts(products);
    if (document.getElementById('latest-products')) renderLatestProducts(products);
    if (document.getElementById('promotion-products')) renderPromotions(products);
    if (document.getElementById('catalog-grid')) renderCollectionPage(products);
    if (document.getElementById('product-details')) renderProductDetails(products);
  } catch (error) {
    console.error(error);
    const target = document.getElementById('featured-products')
      || document.getElementById('catalog-grid')
      || document.getElementById('product-details');
    if (target) {
      target.innerHTML = '<div class="not-found"><h3>Catalog unavailable</h3><p>Please reload the page or try again later.</p></div>';
    }
  }
}

document.addEventListener('error', event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && !image.dataset.fallback) {
    image.dataset.fallback = 'true';
    image.src = './assets/juptee-favicon.png';
  }
}, true);

document.addEventListener('DOMContentLoaded', initializeStorefront);
