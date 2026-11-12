import { parseChatQuery, searchProducts } from './chat-search.mjs';
import { answerSmallTalk } from './chat-replies.mjs';

const root = document.querySelector('#jt-chat-root');
const brandImage = window.jupteeAssetUrl ? window.jupteeAssetUrl('/assets/juptee-favicon.png') : '/assets/juptee-favicon.png';
const chatHistoryKey = 'jt_chat_history';
const state = {
  open: false, seen: false, ready: false, loadedAt: 0, loading: false, products: [], settings: null,
  history: [], pendingOrder: null, lastUserMessage: '', followLatest: true,
  filters: { size: [], minPrice: null, maxPrice: null }
};
const sizeDefault = 'M — 38 inches chest\nL — 40 inches chest\nXL — 42 inches chest\nXXL — 44 inches chest\n3XL — 46 inches chest';
let orderFormSequence = 0;
try {
  const savedHistory = JSON.parse(sessionStorage.getItem(chatHistoryKey) || '[]');
  if (Array.isArray(savedHistory)) {
    state.history = savedHistory.filter(item => item && ['user', 'assistant'].includes(item.role)
      && typeof item.content === 'string' && item.content.length <= 1200).slice(-10);
    state.lastUserMessage = [...state.history].reverse().find(item => item.role === 'user')?.content || '';
  }
} catch (error) {
  console.error('Could not restore the shopping assistant conversation.', error);
}

function messageLanguage(value) {
  if (/[\u0980-\u09FF]/.test(value)) return 'bn';
  if (/\b(koto|dam|baire|chai|kinbo|amar|ache|pabo|size ta)\b/i.test(value)) return 'banglish';
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

function markUnread() {
  if (state.open) return;
  state.seen = false;
  const launch = root.querySelector('.jt-chat-launch');
  if (!launch) return;
  launch.querySelector('.jt-chat-unread').hidden = false;
  launch.setAttribute('aria-label', 'Open JUPTEE shopping assistant, new message');
}

function formatAssistantText(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];

  const inline = value => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const closeParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listItems.length) blocks.push(`<${listType}>${listItems.map(item => `<li>${inline(item)}</li>`).join('')}</${listType}>`);
    listItems = [];
    listType = '';
  };

  for (const line of lines) {
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const heading = line.match(/^\s*#{1,3}\s+(.+)$/);
    if (unordered || ordered) {
      closeParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) closeList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
    } else {
      closeList();
      if (heading) {
        closeParagraph();
        blocks.push(`<h4>${inline(heading[1])}</h4>`);
      } else if (line.trim()) paragraph.push(line);
      else closeParagraph();
    }
  }
  closeList();
  closeParagraph();
  return blocks.join('');
}

function addMessage(role, text, history = true) {
  if (role === 'user') {
    removeSuggestions();
    root.classList.add('jt-chat-has-history');
    state.lastUserMessage = text;
    state.followLatest = true;
  }
  const row = document.createElement('div');
  row.className = `jt-chat-msg ${role}`;
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.className = 'jt-chat-avatar';
    avatar.src = brandImage;
    avatar.alt = '';
    row.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'jt-chat-bubble';
  if (role === 'assistant') bubble.innerHTML = formatAssistantText(text);
  else bubble.textContent = text;
  const timestamp = new Date();
  const time = document.createElement('time');
  time.className = 'jt-chat-time';
  time.dateTime = timestamp.toISOString();
  time.textContent = timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  row.append(bubble, time);
  root.querySelector('.jt-chat-stream').append(row);
  scrollToBottom();
  if (history && (role === 'user' || role === 'assistant')) {
    state.history.push({ role, content: text });
    state.history = state.history.slice(-10);
    try {
      sessionStorage.setItem(chatHistoryKey, JSON.stringify(state.history));
    } catch (error) {
      console.error('Could not save the shopping assistant conversation.', error);
    }
  }
  if (role === 'assistant' && history) addSuggestions(state.lastUserMessage, text);
  if (role === 'assistant') markUnread();
  return row;
}

function addHtmlMessage(html) {
  const row = document.createElement('div');
  row.className = 'jt-chat-msg assistant';
  const avatar = document.createElement('img');
  avatar.className = 'jt-chat-avatar';
  avatar.src = brandImage;
  avatar.alt = '';
  const bubble = document.createElement('div');
  bubble.className = 'jt-chat-bubble';
  bubble.innerHTML = html;
  const timestamp = new Date();
  const time = document.createElement('time');
  time.className = 'jt-chat-time';
  time.dateTime = timestamp.toISOString();
  time.textContent = timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  row.append(avatar, bubble, time);
  root.querySelector('.jt-chat-stream').append(row);
  markUnread();
  addSuggestions(state.lastUserMessage, bubble.textContent || '');
  scrollToBottom();
}

function scrollToBottom() {
  const stream = root.querySelector('.jt-chat-stream');
  if (!stream || !state.followLatest) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; }));
}

function removeSuggestions() {
  root.querySelectorAll('.jt-chat-suggestions').forEach(suggestions => suggestions.remove());
}

function addSuggestions(question, answer) {
  const language = messageLanguage(question || '');
  const context = `${question || ''} ${answer || ''}`.toLowerCase();
  const prompt = (question || '').toLowerCase();
  const browseQuestion = /(what products are available|available products|browse products|what do you sell|your collections|product collection|latest designs|colours are available|colors are available|couple t-?shirts|customize my own t-?shirt)/i.test(prompt);
  const sizeQuestion = /(size guide|size chart|choose.*size|t-?shirt size|measure.*chest|sizing|garment.*measurement|xl and xxl|oversized sizes)/i.test(prompt);
  const priceQuestion = /(price|pricing|cost|how much|custom printing|discount|দাম|দাম কত|\bkoto\b|\bdam\b)/i.test(prompt);
  const deliveryQuestion = /(delivery|deliver|shipping|cash on delivery|track my order|delivery take|ঢাকা|ডেলিভারি)/i.test(prompt);
  const orderQuestion = /(order|buy|purchase|checkout|অর্ডার|কিনব)/i.test(prompt);
  const bulk = /\b(bulk|wholesale|wholesaler)\b|পাইকারি/.test(context);
  const delivery = /\b(delivery|deliver|shipping|ঢাকা|ডেলিভারি)\b/.test(context);
  const sizing = /\b(size|sizing|fit|measurement|chest)\b/.test(context);
  const ordering = /\b(order|buy|purchase|checkout|অর্ডার|কিনব)\b/.test(context);
  const pricing = /\b(price|pricing|cost|৳|t-?shirt|tee|দাম|koto|dam)\b/.test(context);
  let suggestions;

  if (language === 'bn') {
    suggestions = bulk
      ? ['বাল্ক অর্ডারের কোটেশন কীভাবে পাব?', 'কোন ডিজাইন কাস্টমাইজ করা যাবে?', 'কোন সাইজ ও রং আছে?', 'ডেলিভারি চার্জ কত?']
      : delivery
        ? ['টি-শার্টের দাম কত?', 'কোন সাইজ পাওয়া যাবে?', 'আমি অর্ডার করতে চাই।']
        : sizing
          ? ['কোন কোন টি-শার্ট স্টাইল আছে?', 'প্রতিটি স্টাইলের দাম কত?', 'ডেলিভারি চার্জ কত?']
          : ordering
            ? ['কোন সাইজ ও রং আছে?', 'ডেলিভারি চার্জ কত?', 'বাল্ক কোটেশন কীভাবে পাব?']
            : pricing
              ? ['কোন সাইজ পাওয়া যাবে?', 'ডেলিভারি চার্জ কত?', 'বাল্ক কোটেশন কীভাবে পাব?', 'আমি অর্ডার করতে চাই।']
              : ['কোন সাইজ ও রং পাওয়া যাবে?', 'ডেলিভারি চার্জ কত?', 'টি-শার্টের দাম কত?', 'আমি অর্ডার করতে চাই।'];
  } else if (language === 'banglish') {
    suggestions = bulk
      ? ['Bulk quotation kivabe pabo?', 'Kon design customize kora jabe?', 'Kon size ar color ache?', 'Delivery charge koto?']
      : delivery
        ? ['T-shirt-er dam koto?', 'Kon size pawa jabe?', 'Ami order korte chai.']
        : sizing
          ? ['Ki ki T-shirt style ache?', 'Prottek style-er dam koto?', 'Delivery charge koto?']
          : ordering
            ? ['Kon size ar color ache?', 'Delivery charge koto?', 'Bulk quotation kivabe pabo?']
            : pricing
              ? ['Kon size pawa jabe?', 'Delivery charge koto?', 'Bulk quotation kivabe pabo?', 'Ami order korte chai.']
              : ['Kon size ar color pawa jabe?', 'Delivery charge koto?', 'T-shirt-er dam koto?', 'Ami order korte chai.'];
  } else {
    suggestions = browseQuestion
      ? ['What are your latest designs?', 'What colours are available?', 'Do you have couple T-shirts?', 'Can I customize my own T-shirt?']
      : sizeQuestion
        ? ['Can I see the size chart?', 'Do you have XL and XXL?', 'Do you have oversized sizes?', 'How do I measure my chest?']
        : priceQuestion
          ? ['What is your bulk order price?', 'Can I order 10 pieces?', 'How much does custom printing cost?', 'Do you offer discounts?']
          : deliveryQuestion
            ? ['Is Cash on Delivery available?', 'How many days does delivery take?', 'Do you deliver outside Dhaka?', 'Can I track my order?']
            : orderQuestion
              ? ['Can I order through WhatsApp?', 'Can I customize a T-shirt?', 'Can I order multiple pieces?', 'What information is required to order?']
              : bulk
      ? ['How can I get a bulk quotation?', 'Which designs can I customize?', 'What sizes and colors are available?', 'How much is delivery?']
      : delivery
        ? ['What are the T-shirt prices?', 'What sizes are available?', "I'd like to place an order."]
        : sizing
          ? ['What T-shirt styles are available?', 'How much does each style cost?', 'How much is delivery?']
          : ordering
            ? ['What sizes and colors are available?', 'How much is delivery?', 'Can I get a bulk quotation?']
            : pricing
              ? ['What sizes are available?', 'How much is delivery?', 'Can I get a bulk quotation?', "I'd like to place an order."]
              : ['What sizes and colors are available?', 'How much is delivery?', 'What T-shirt styles are available?', "I'd like to place an order."];
  }

  const list = document.createElement('div');
  list.className = 'jt-chat-suggestions';
  list.setAttribute('aria-label', 'Suggested questions');
  const heading = document.createElement('span');
  heading.className = 'jt-chat-suggestions-label';
  heading.textContent = language === 'bn' ? 'আপনি আরও জানতে পারেন' : language === 'banglish' ? 'Apni aro jante paren' : 'Suggested for you';
  const choices = document.createElement('div');
  choices.className = 'jt-chat-suggestion-list';
  list.append(heading);
  for (const suggestion of new Set(suggestions)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jt-chat-suggestion';
    button.dataset.suggestion = '';
    button.dataset.question = suggestion;
    const icon = /bulk|quotation|piece|order/i.test(suggestion) ? '📦'
      : /size|chest|fit|measurement|sizing/i.test(suggestion) ? '📏'
        : /delivery|shipping|track/i.test(suggestion) ? '🚚'
          : /color|colour|custom|design|printing/i.test(suggestion) ? '🎨'
            : /discount|cash|payment/i.test(suggestion) ? '💳'
              : /product|style|t-shirt|tee|collection|available/i.test(suggestion) ? '🛍️' : '✨';
    const iconElement = document.createElement('span');
    iconElement.className = 'jt-chat-suggestion-icon';
    iconElement.setAttribute('aria-hidden', 'true');
    iconElement.textContent = icon;
    const label = document.createElement('span');
    label.textContent = suggestion;
    button.append(iconElement, label);
    choices.append(button);
  }
  list.append(choices);
  root.querySelector('.jt-chat-stream').append(list);
  scrollToBottom();
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
  row.innerHTML = `<img class="jt-chat-avatar" src="${escapeHtml(brandImage)}" alt=""><div class="jt-chat-bubble jt-chat-typing"><i></i><i></i><i></i></div><div class="jt-chat-product-skeletons" aria-label="Finding products"><i></i><i></i></div>`;
  root.querySelector('.jt-chat-stream').append(row);
  scrollToBottom();
}

function showSizeDialog(contents, title) {
  const previous = root.querySelector('.jt-chat-size-dialog');
  previous?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'jt-chat-size-dialog';
  dialog.setAttribute('aria-labelledby', 'jt-chat-size-title');
  dialog.innerHTML = `<form method="dialog" class="jt-chat-size-dialog-card"><button class="jt-chat-dialog-close" aria-label="Close size guide">×</button><h2 id="jt-chat-size-title">${escapeHtml(title)}</h2>${contents}</form>`;
  root.querySelector('.jt-chat-panel').append(dialog);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  dialog.querySelector('input,button')?.focus();
}

function openSizeChart() {
  const chart = state.settings?.sizeChart || sizeDefault;
  showSizeDialog(
    `<p>Compare these garment chest measurements with a T-shirt that fits you well. They are not body measurements.</p><pre>${escapeHtml(chart)}</pre>`,
    'JUPTEE size chart'
  );
}

function openSizeHelper() {
  showSizeDialog(
    `<p>Height and weight help us understand your fit preference, but they cannot determine a shirt size reliably. We’ll show the verified garment chart so you can compare with a tee you already own. These details are not saved or sent to the assistant.</p>
      <label>Height (cm)<input name="height" type="number" min="80" max="240" required inputmode="numeric"></label>
      <label>Weight (kg)<input name="weight" type="number" min="20" max="300" required inputmode="numeric"></label>
      <button class="jt-chat-size-submit" type="submit" value="continue">Show size chart</button>`,
    'Find your size'
  );
  const dialog = root.querySelector('.jt-chat-size-dialog');
  dialog.addEventListener('submit', event => {
    if (event.submitter?.value !== 'continue') return;
    event.preventDefault();
    if (!dialog.querySelector('[name="height"]').reportValidity()
      || !dialog.querySelector('[name="weight"]').reportValidity()) return;
    dialog.close();
    addMessage('assistant', 'Thanks for sharing. Height and weight alone can’t reliably determine your JUPTEE size, so please compare a well-fitting T-shirt’s chest measurement with the chart. If you’re between sizes, consider the larger one.');
    openSizeChart();
  });
}

function addProductCards(products, bubble) {
  if (!Array.isArray(products) || !products.length || !bubble) return;
  const carousel = document.createElement('div');
  carousel.className = 'jt-chat-product-carousel';
  for (const product of products.slice(0, 6)) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const available = variants.filter(variant => Number(variant.stock) > 0);
    const sizeOptions = ['S', 'M', 'L', 'XL', 'XXL'];
    const defaultVariant = available.find(variant => sizeOptions.includes(String(variant.size).toUpperCase()));
    const image = product.images?.[0] || brandImage;
    const imageUrl = window.jupteeAssetUrl ? window.jupteeAssetUrl(image) : image;
    const regular = Number(product.price);
    const sale = Number(product.salePrice);
    const current = sale > 0 && sale < regular ? sale : (Number(defaultVariant?.unitPrice) || regular);
    const card = document.createElement('article');
    card.className = 'jt-chat-product-card';
    card.dataset.chatProduct = '';
    const sizeMarkup = sizeOptions.map(size => {
      const variant = available.find(item => String(item.size).toUpperCase() === size);
      return `<button type="button" data-chat-size data-variant-id="${escapeHtml(variant?.id || '')}" aria-pressed="false" ${variant ? '' : 'disabled'}>${size}</button>`;
    }).join('');
    card.innerHTML = `<a class="jt-chat-product-image" href="#product-${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.name)}"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async"></a>
      <div class="jt-chat-product-info"><strong>${escapeHtml(product.name)}</strong><span class="jt-chat-product-price">${sale > 0 && sale < regular ? `<b>৳${sale.toLocaleString('en-US')}</b> <s>৳${regular.toLocaleString('en-US')}</s>` : `৳${current.toLocaleString('en-US')}`}</span></div>
      <div class="jt-chat-product-sizes" aria-label="Available sizes">${sizeMarkup}</div>
      <div class="jt-chat-product-actions"><button type="button" data-add-chat data-product-id="${escapeHtml(product.id)}" data-variant-id="${escapeHtml(defaultVariant?.id || '')}" ${defaultVariant ? '' : 'disabled'}>Add to bag</button><a href="#product-${encodeURIComponent(product.id)}">View</a></div>`;
    if (defaultVariant) {
      const defaultSizeButton = [...card.querySelectorAll('[data-chat-size]')]
        .find(button => button.dataset.variantId === String(defaultVariant.id));
      defaultSizeButton?.classList.add('selected');
      defaultSizeButton?.setAttribute('aria-pressed', 'true');
    }
    const colorLabel = document.createElement('span');
    colorLabel.className = 'jt-chat-product-color';
    colorLabel.dataset.selectedColor = '';
    colorLabel.textContent = defaultVariant ? `Color: ${defaultVariant.color}` : '';
    card.querySelector('.jt-chat-product-info').append(colorLabel);
    card.querySelectorAll('[data-chat-size]').forEach(button => {
      button.addEventListener('click', () => {
        const selected = variants.find(variant => String(variant.id) === button.dataset.variantId);
        if (selected) colorLabel.textContent = `Color: ${selected.color}`;
      });
    });
    const imageElement = card.querySelector('img');
    imageElement.addEventListener('error', () => { imageElement.src = brandImage; }, { once: true });
    carousel.append(card);
  }
  bubble.append(carousel);
}

function renderWidget() {
  root.innerHTML = `
    <button class="jt-chat-launch" type="button" aria-label="${state.open ? 'Close' : 'Open'} JUPTEE shopping assistant${state.seen ? '' : ', new message'}" aria-expanded="${state.open}">✦<span class="jt-chat-unread" ${state.seen ? 'hidden' : ''}>1</span></button>
    <section class="jt-chat-panel" role="dialog" aria-modal="true" aria-label="Juptee Assistant" ${state.open ? '' : 'hidden'}>
      <header class="jt-chat-head">
        <button class="jt-chat-handle" type="button" aria-label="Drag down to minimize chat"><span></span></button>
        <img class="jt-chat-brandmark" src="${escapeHtml(brandImage)}" alt="">
        <div class="jt-chat-headcopy"><strong>Juptee Assistant</strong><span><i class="jt-chat-online"></i> Online · here to help</span></div>
        <button class="jt-chat-header-action jt-chat-clear" type="button" aria-label="Clear chat">Clear</button>
        <button class="jt-chat-header-action jt-chat-minimize" type="button" aria-label="Minimize chat">−</button>
        <button class="jt-chat-header-action jt-chat-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="jt-chat-stream" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
        <div class="jt-chat-msg assistant jt-chat-welcome-row"><img class="jt-chat-avatar" src="${escapeHtml(brandImage)}" alt=""><div class="jt-chat-bubble jt-chat-welcome"><strong>👋 Welcome to JUPTEE!</strong><p class="jt-chat-welcome-tagline">Your Style, Your Choice.</p><p>I'm your JUPTEE shopping assistant. I can help you find a style, compare verified prices, and check sizes.</p></div></div>
        <div class="jt-chat-quick" aria-label="Quick questions">
          <button type="button" data-query="Help me find my size"><span>📏</span>Find my size</button>
          <button type="button" data-query="Show products under ৳500"><span>৳</span>Under ৳500</button>
          <button type="button" data-query="Show new arrivals">New arrivals</button>
          <button type="button" data-query="Show best sellers">Best sellers</button>
          <button type="button" data-query="How can I track my order?">Track order</button>
        </div>
        <details class="jt-chat-filters">
          <summary>Refine by size and price</summary>
          <div class="jt-chat-filter-content">
            <span class="jt-chat-filter-label">Size</span>
            <div class="jt-chat-filter-sizes">${['S', 'M', 'L', 'XL', 'XXL'].map(size => `<button type="button" data-filter-size="${size}" aria-pressed="false">${size}</button>`).join('')}</div>
            <label>Min price <input data-filter-min type="number" min="0" max="100000" inputmode="numeric" placeholder="৳0"></label>
            <label>Max price <input data-filter-max type="number" min="0" max="100000" inputmode="numeric" placeholder="No limit"></label>
            <label class="jt-chat-range-label">Maximum <span data-filter-label>Any price</span><input data-filter-range type="range" min="0" max="20000" step="100" value="20000"></label>
            <div class="jt-chat-size-tools"><button type="button" data-size-helper>Find my size</button><button type="button" data-size-chart>View size chart</button></div>
          </div>
        </details>
      </div>
      <form class="jt-chat-composer">
        <textarea name="message" rows="1" maxlength="1200" aria-label="Write a message" placeholder="Ask about styles, sizes or prices…"></textarea>
        <button class="jt-chat-send" type="submit" aria-label="Send message">↑</button>
      </form>
      <div class="jt-chat-privacy">Please don’t share private or payment information in chat.</div>
    </section>`;
  const stream = root.querySelector('.jt-chat-stream');
  if (state.history.length) {
    root.classList.add('jt-chat-has-history');
    for (const message of state.history) addMessage(message.role, message.content, false);
  }
  root.querySelector('.jt-chat-launch').addEventListener('click', () => toggleChat());
  root.querySelector('.jt-chat-close').addEventListener('click', () => toggleChat(false));
  root.querySelector('.jt-chat-minimize').addEventListener('click', () => toggleChat(false));
  root.querySelector('.jt-chat-clear').addEventListener('click', clearChat);
  const composer = root.querySelector('.jt-chat-composer');
  composer.addEventListener('submit', sendMessage);
  composer.elements.message.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  root.querySelector('.jt-chat-quick').addEventListener('click', quickAction);
  stream.addEventListener('scroll', () => {
    state.followLatest = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
  }, { passive: true });
  stream.addEventListener('click', event => {
    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) {
      const composer = root.querySelector('.jt-chat-composer');
      composer.elements.message.value = suggestion.dataset.question;
      composer.requestSubmit();
      return;
    }
    const filterSize = event.target.closest('[data-filter-size]');
    if (filterSize) {
      const size = filterSize.dataset.filterSize;
      state.filters.size = state.filters.size.includes(size)
        ? state.filters.size.filter(value => value !== size)
        : [...state.filters.size, size];
      filterSize.setAttribute('aria-pressed', String(state.filters.size.includes(size)));
      filterSize.classList.toggle('selected', state.filters.size.includes(size));
      return;
    }
    const minFilter = event.target.closest('[data-filter-min]');
    const maxFilter = event.target.closest('[data-filter-max]');
    const rangeFilter = event.target.closest('[data-filter-range]');
    if (minFilter || maxFilter || rangeFilter) {
      updatePriceFilters(event.target);
      return;
    }
    const productSize = event.target.closest('[data-chat-size]');
    if (productSize) {
      const card = productSize.closest('[data-chat-product]');
      card.querySelectorAll('[data-chat-size]').forEach(button => {
        const selected = button === productSize;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      card.querySelector('[data-add-chat]').dataset.variantId = productSize.dataset.variantId;
      card.querySelector('[data-add-chat]').disabled = false;
      return;
    }
    const addButton = event.target.closest('[data-add-chat]');
    if (addButton) {
      const addToCart = window.jupteeChatAddToCart;
      if (typeof addToCart !== 'function') {
        console.error('The storefront cart integration is unavailable.');
        addMessage('assistant', 'The bag is unavailable right now. Please open the product page to add this item.');
        return;
      }
      if (!addToCart(addButton.dataset.productId, addButton.dataset.variantId)) {
        addMessage('assistant', 'This option is no longer available. Please refresh the product list and try again.');
      }
      return;
    }
    if (event.target.closest('[data-retry-chat]')) {
      const form = root.querySelector('.jt-chat-composer');
      sendMessage({ preventDefault() {}, currentTarget: form, retry: true });
      return;
    }
    if (event.target.closest('[data-size-helper]')) {
      openSizeHelper();
      return;
    }
    if (event.target.closest('[data-size-chart]')) {
      openSizeChart();
      return;
    }
    orderAction(event);
  });
  stream.addEventListener('input', event => {
    if (event.target.matches('[data-filter-min],[data-filter-max],[data-filter-range]')) updatePriceFilters(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open && !root.querySelector('.jt-chat-size-dialog[open]')) toggleChat(false);
    if (event.key === 'Tab' && state.open) trapFocus(event);
  });
  let dragStart;
  root.querySelector('.jt-chat-handle').addEventListener('pointerdown', event => { dragStart = event.clientY; });
  root.querySelector('.jt-chat-handle').addEventListener('pointerup', event => {
    if (dragStart !== undefined && event.clientY - dragStart > 50) toggleChat(false);
    dragStart = undefined;
  });
  updateVisualViewport();
  window.visualViewport?.addEventListener('resize', updateVisualViewport);
  window.visualViewport?.addEventListener('scroll', updateVisualViewport);
}

function trapFocus(event) {
  const panel = root.querySelector('.jt-chat-panel');
  if (!panel) return;
  const focusable = [...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function clearChat() {
  state.history = [];
  state.lastUserMessage = '';
  state.pendingOrder = null;
  state.filters = { size: [], minPrice: null, maxPrice: null };
  try {
    sessionStorage.removeItem(chatHistoryKey);
  } catch (error) {
    console.error('Could not clear the saved shopping assistant conversation.', error);
  }
  root.querySelectorAll('.jt-chat-msg:not(.jt-chat-welcome-row), .jt-chat-suggestions, .jt-chat-order, .jt-chat-review')
    .forEach(element => element.remove());
  root.querySelectorAll('[data-filter-size]').forEach(button => {
    button.classList.remove('selected');
    button.setAttribute('aria-pressed', 'false');
  });
  root.querySelector('[data-filter-min]').value = '';
  root.querySelector('[data-filter-max]').value = '';
  root.querySelector('[data-filter-range]').value = '20000';
  root.querySelector('[data-filter-label]').textContent = 'Any price';
  root.classList.remove('jt-chat-has-history');
}

function updatePriceFilters(input) {
  const minField = root.querySelector('[data-filter-min]');
  const maxField = root.querySelector('[data-filter-max]');
  const range = root.querySelector('[data-filter-range]');
  if (input.matches('[data-filter-min]')) {
    state.filters.minPrice = minField.value ? Math.min(100000, Math.max(0, Number(minField.value))) : null;
    if (state.filters.minPrice !== null) minField.value = String(state.filters.minPrice);
  }
  if (input.matches('[data-filter-max]')) {
    state.filters.maxPrice = maxField.value ? Math.min(100000, Math.max(0, Number(maxField.value))) : null;
    if (state.filters.maxPrice !== null) maxField.value = String(state.filters.maxPrice);
    range.value = String(Math.min(Number(range.max), state.filters.maxPrice ?? Number(range.max)));
  }
  if (input.matches('[data-filter-range]')) {
    const max = Number(range.value);
    state.filters.maxPrice = max >= Number(range.max) ? null : max;
    maxField.value = state.filters.maxPrice ?? '';
  }
  root.querySelector('[data-filter-label]').textContent = state.filters.maxPrice === null
    ? 'Any price'
    : `Up to ৳${state.filters.maxPrice.toLocaleString('en-US')}`;
}

function updateVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  root.style.setProperty('--jt-visual-height', `${viewport.height}px`);
  root.style.setProperty('--jt-visual-top', `${viewport.offsetTop}px`);
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
    const message = location.protocol === 'file:'
      ? 'This local file preview cannot connect to JUPTEE’s Cloudflare services. Open https://juptee.shop in your browser to use the live catalog and AI assistant.'
      : error.message.includes('(522)')
        ? 'Cloudflare cannot reach the JUPTEE site server right now (522). The live catalog is unavailable until the site server responds again.'
        : 'I can still help with general questions, but the live catalog is temporarily unavailable. Please try again or contact JUPTEE support.';
    addMessage('assistant', message, false);
    return false;
  }
}

async function toggleChat(force) {
  state.open = typeof force === 'boolean' ? force : !state.open;
  if (state.open) state.seen = true;
  const panel = root.querySelector('.jt-chat-panel');
  const launch = root.querySelector('.jt-chat-launch');
  panel.hidden = !state.open;
  launch.hidden = state.open;
  launch.querySelector('.jt-chat-unread').hidden = state.seen;
  launch.setAttribute('aria-expanded', String(state.open));
  launch.setAttribute('aria-label', `${state.open ? 'Close' : 'Open'} JUPTEE shopping assistant${state.seen ? '' : ', new message'}`);
  if (state.open) {
    await loadStoreData();
    root.querySelector('textarea[name="message"]')?.focus();
  } else {
    launch.focus();
  }
}

export function openChat() {
  return toggleChat(true);
}

function configuredFees() {
  return state.settings?.deliveryFees || { dhaka: 80, subcity: 100, out: 130 };
}

function quickAction(event) {
  const button = event.target.closest('[data-action]');
  const queryButton = event.target.closest('[data-query]');
  if (queryButton) {
    const query = queryButton.dataset.query;
    if (query === 'Help me find my size') {
      openSizeHelper();
      return;
    }
    if (query === 'How can I track my order?') {
      addMessage('user', query);
      addMessage('assistant', state.settings?.supportPhone
        ? `Order tracking is not connected yet. Please contact JUPTEE at ${state.settings.supportPhone} with your order ID.`
        : 'Order tracking is not connected yet. Please contact JUPTEE support with your order ID.');
      return;
    }
    const input = root.querySelector('.jt-chat-composer').elements.message;
    input.value = query;
    root.querySelector('.jt-chat-composer').requestSubmit();
    return;
  }
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'browse') {
    addMessage('user', 'What products are available at JUPTEE?');
    addBrowseReply();
    return;
  }
  if (action === 'order') {
    addMessage('user', 'How can I place an order?');
    addOrderReply();
    if (state.ready && state.products.length) startOrder();
    return;
  }
  if (action === 'size') {
    addMessage('user', 'How can I choose my T-shirt size?');
    addSizeGuideReply();
    return;
  }
  if (action === 'delivery') {
    addMessage('user', 'What are your delivery charges?');
    addDeliveryReply('en');
    return;
  }
  if (action === 'prices') {
    addMessage('user', 'What are your T-shirt prices?');
    addPricingReply();
  }
}

function addBrowseReply() {
  const row = addMessage('assistant', `👋 **Welcome to JUPTEE! ❤️**

Explore our stylish clothing collections, designed to make your everyday look more special.

Our collection includes:
- 👕 Regular T-shirts
- ✨ Drop Shoulder T-shirts
- 🔥 Oversized T-shirts
- ❤️ Couple T-shirts
- 🎨 Custom Printed T-shirts
- 🧥 Hoodies
- 👔 Polo T-shirts

Discover your favourite style and make it yours! Visit our online store to explore the collection.`);
  addProductCards(state.products, row.querySelector('.jt-chat-bubble'));
}

function addSizeGuideReply() {
  const chart = state.settings?.sizeChart || sizeDefault;
  const chartLines = chart.split(/\r?\n/).map(line => `- ${line}`).join('\n');
  addMessage('assistant', `📏 **Find Your Perfect JUPTEE Fit!**

Finding your perfect fit is easy. JUPTEE offers different sizes depending on the product and design. Before ordering, compare the measurements below with a T-shirt you already own:

${chartLines}

**Important size information:**
- These are garment chest measurements, not body measurements.
- If you're between sizes, compare with a well-fitting T-shirt.
- Fit may vary by product style and design; we can't guarantee an exact fit.

Need help choosing? Tell us your preferred fit and the product you're interested in. Our team can help you find a suitable size.`);
}

function addPricingReply() {
  addMessage('assistant', `Here is our current JUPTEE pricing! 💰

- 👕 **Regular T-shirt:** **৳350** per piece
- ✨ **Drop Shoulder T-shirt:** **৳500** per piece

📦 **Bulk orders**
- Minimum quantity: approximately **10–15 pieces**
- Pricing starts around **৳300 per piece**
- Final pricing depends on design, quantity, printing, and customization requirements.

For a customized quotation, contact JUPTEE with the quantity and design you have in mind.`);
}

function answerKnownQuestion(message, language) {
  const smallTalkReply = answerSmallTalk(message);
  if (smallTalkReply) {
    addMessage('assistant', smallTalkReply);
    return true;
  }
  const lower = message.toLowerCase();
  if (/(customi[sz](?:e|ation)|personalized|print my own|my own t-?shirt)/i.test(lower)) {
    const contact = state.settings?.supportPhone || '+8801061103327';
    addMessage('assistant', `Yes, you can ask JUPTEE about a custom T-shirt. The design, printing, and quantity determine what is possible and the price, so please contact our team at ${contact} for a confirmed quote.`);
    return true;
  }
  if (/(couple t-?shirts?|matching (?:t-?shirts?|tees?))/i.test(lower)) {
    const coupleProducts = state.products.filter(product =>
      product.category === 'couple' || product.cat === 'couple' || /couple/i.test(product.name)
    );
    if (coupleProducts.length) {
      addMessage('assistant', `Yes, the live catalog currently has ${coupleProducts.length} couple T-shirt ${coupleProducts.length === 1 ? 'design' : 'designs'}. Use Browse Products to check current prices, sizes, and stock.`);
    } else {
      addMessage('assistant', 'Couple T-shirts are part of JUPTEE’s collection, but I can’t confirm currently published designs or stock right now. Please check the shop or contact JUPTEE support before ordering.');
    }
    return true;
  }
  if (/cash on delivery/i.test(lower)) {
    addMessage('assistant', `Yes, **Cash on Delivery** is available. Current delivery charges are **${money(configuredFees().dhaka)}** inside Dhaka and **${money(configuredFees().out)}** outside Dhaka.`);
    return true;
  }
  if (/deliver outside dhaka/i.test(lower)) {
    addMessage('assistant', `Yes, JUPTEE has an outside-Dhaka delivery charge of **${money(configuredFees().out)}**. The delivery fee is added to the product subtotal at checkout.`);
    return true;
  }
  if (/(how many days does delivery take|track my order)/i.test(lower)) {
    const contact = state.settings?.supportPhone ? ` Please contact JUPTEE at ${state.settings.supportPhone} for an update.` : ' Please contact JUPTEE support for an update.';
    addMessage('assistant', `JUPTEE's current delivery charges are **${money(configuredFees().dhaka)}** inside Dhaka and **${money(configuredFees().out)}** outside Dhaka. We don't have a confirmed delivery timeframe or tracking service in the current information.${contact}`);
    return true;
  }
  if (/(delivery|deliver|shipping|ঢাকা|ডেলিভারি)/i.test(lower)) {
    addDeliveryReply(language);
    return true;
  }
  const asksPrice = /(price|pricing|cost|how much|দাম|দাম কত|\bkoto\b|\bdam\b)/i.test(lower);
  const mentionsBulk = /\b(bulk|wholesale|wholesaler)\b|পাইকারি/i.test(lower);
  const asksAboutBulkQuantity = /\b(?:10|11|12|13|14|15|ten|eleven|twelve|thirteen|fourteen|fifteen)(?:\s*(?:-|–|to)\s*(?:10|11|12|13|14|15|ten|eleven|twelve|thirteen|fourteen|fifteen))?\s*(?:pieces?|pcs?|t-?shirts?|tees?|ta)\b/i.test(lower);
  if (mentionsBulk && asksPrice) {
    addMessage('assistant', 'For bulk orders, our minimum quantity is approximately **10–15 pieces**. Pricing starts from around **৳300 per piece** and depends on the design, quantity, printing requirements, and customization. Contact JUPTEE for a quotation.');
    return true;
  }
  if (asksAboutBulkQuantity && /\b(can|could|may|order|buy|get| নিতে|nibo|nite)\b/i.test(lower)) {
    addMessage('assistant', 'Yes! JUPTEE accepts bulk orders starting from approximately **10–15 pieces**. Pricing depends on your selected design and customization.');
    return true;
  }
  if (asksPrice && /\b(drop[\s-]*shoulder|dropshoulder)\b/i.test(lower)) {
    addMessage('assistant', 'Drop Shoulder T-shirts are **৳500 per piece**.');
    return true;
  }
  if (asksPrice && /\b(t-?shirts?|tees?)\b/i.test(lower)) {
    addPricingReply();
    return true;
  }
  if (/(what products are available|available products|browse products|what do you sell|your collections|product collection)/i.test(lower)) {
    addBrowseReply();
    return true;
  }
  if (/(size guide|size chart|choose.*size|t-?shirt size|measure.*chest|sizing|garment.*measurement)/i.test(lower)) {
    addSizeGuideReply();
    return true;
  }
  if (/(how (?:can|do) i (?:place|make) (?:an? )?order|place an order|how to order)/i.test(lower)) {
    addOrderReply();
    return true;
  }
  if (/(bulk order price|bulk quotation|custom printing cost|offer discounts)/i.test(lower)) {
    if (/bulk order price|bulk quotation/i.test(lower)) {
      addMessage('assistant', 'Bulk orders start at approximately **10–15 pieces**, with pricing from around **৳300 per piece**. Final pricing depends on design, quantity, printing, and customization. Contact JUPTEE for a quotation.');
    } else if (/custom printing cost/i.test(lower)) {
      addMessage('assistant', 'Custom printing costs depend on the design, quantity, and printing requirements. Contact JUPTEE with your requirements for a quotation.');
    } else {
      addMessage('assistant', 'I can’t confirm an additional discount from the current store information. Bulk pricing starts around **৳300 per piece** for approximately 10–15 pieces and depends on design and customization. Contact JUPTEE for a quotation.');
    }
    return true;
  }
  return false;
}

function addOrderReply() {
  addMessage('assistant', `Ordering your favourite JUPTEE product is simple! ❤️

1. Browse the collection and choose a published product.
2. Select an available colour and size.
3. Choose your quantity.
4. Complete your details and delivery address in the **secure order form**.
5. Review and submit your order through the form.

Ready to order? Use the secure form below when a live product is available. Please don't send personal or payment information in chat.`);
}

function addDeliveryReply(language) {
  const fees = configuredFees();
  if (language === 'bn') {
    addMessage('assistant', `🚚 **বর্তমান ডেলিভারি চার্জ**\n\n- ঢাকা জেলায়: **${money(fees.dhaka)}**\n- ঢাকার বাইরে: **${money(fees.out)}**\n- পেমেন্ট: ক্যাশ অন ডেলিভারি\n\nচেকআউটে পণ্যের সাবটোটালের সঙ্গে ডেলিভারি যোগ হবে।`);
  } else if (language === 'banglish') {
    addMessage('assistant', `🚚 **Ekhon delivery charge**\n\n- Dhaka district-e: **${money(fees.dhaka)}**\n- Dhakar baire: **${money(fees.out)}**\n- Payment: Cash on Delivery\n\nCheckout-e product subtotal-er sathe delivery jog hobe.`);
  } else {
    addMessage('assistant', `Good news! JUPTEE offers delivery with the configured charges. 🚚

- 📍 **Inside Dhaka:** ${money(fees.dhaka)}
- 📍 **Outside Dhaka:** ${money(fees.out)}
- 💳 **Payment:** Cash on Delivery is available.

Delivery is added to the product subtotal at checkout. Our current settings do not specify a delivery timeframe or tracking service.`);
  }
}

function showCatalog(language = 'en') {
  if (!state.products.length) {
    addMessage('assistant', 'There are no products in the currently published catalog. Please check back soon or contact JUPTEE support.', false);
    return;
  }
  const row = addMessage('assistant', language === 'bn' ? 'প্রকাশিত পণ্য ও বর্তমান দাম' : language === 'banglish' ? 'Published product ar current price' : 'Published products and current prices');
  addProductCards(state.products, row.querySelector('.jt-chat-bubble'));
}

async function readAssistantStream(response) {
  const row = document.createElement('div');
  row.className = 'jt-chat-msg assistant';
  const avatar = document.createElement('img');
  avatar.className = 'jt-chat-avatar';
  avatar.src = brandImage;
  avatar.alt = '';
  const bubble = document.createElement('div');
  bubble.className = 'jt-chat-bubble';
  row.append(avatar, bubble);
  root.querySelector('.jt-chat-stream').append(row);
  let reply = '';
  let result;
  let eventName = '';
  let dataLines = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  const dispatch = () => {
    if (!dataLines.length) {
      eventName = '';
      return;
    }
    const data = JSON.parse(dataLines.join('\n'));
    if (eventName === 'delta') {
      reply += data.text;
      bubble.textContent = reply;
    } else if (eventName === 'done' || eventName === 'fallback') {
      result = data;
      reply = data.reply;
      bubble.textContent = reply;
    }
    eventName = '';
    dataLines = [];
    scrollToBottom();
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) dispatch();
        else if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (chunk.done) break;
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trim());
    dispatch();
    if (!result || typeof result.reply !== 'string' || !Array.isArray(result.products)) {
      throw new Error('The streaming shopping assistant returned an incomplete response.');
    }
    bubble.innerHTML = formatAssistantText(result.reply);
    state.history.push({ role: 'assistant', content: result.reply });
    state.history = state.history.slice(-10);
    try {
      sessionStorage.setItem(chatHistoryKey, JSON.stringify(state.history));
    } catch (error) {
      console.error('Could not save the shopping assistant conversation.', error);
    }
    const timestamp = new Date();
    const time = document.createElement('time');
    time.className = 'jt-chat-time';
    time.dateTime = timestamp.toISOString();
    time.textContent = timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    row.append(time);
    addSuggestions(state.lastUserMessage, result.reply);
    addProductCards(result.products, bubble);
    markUnread();
  } catch (error) {
    row.remove();
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.loading) return;
  const form = event.currentTarget;
  const input = form.elements.message;
  const retry = event.retry === true;
  const message = retry ? state.lastUserMessage : input.value.trim();
  if (!message) return;
  if (!retry) input.value = '';
  const language = messageLanguage(message);
  if (!retry) addMessage('user', message);
  const lower = message.toLowerCase();
  if (!retry && answerKnownQuestion(message, language)) return;
  state.loading = true;
  root.querySelector('.jt-chat-send').disabled = true;
  showTyping(true);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.history.slice(-10), filters: state.filters, stream: true })
    });
    const streamed = response.headers.get('content-type')?.includes('text/event-stream');
    const result = streamed ? {} : await response.json().catch(() => ({}));
    if (response.status === 429) {
      addMessage('assistant', result.error || 'Please wait a moment before sending another chat message.');
      return;
    }
    if (!response.ok) {
      const message = response.status === 522
        ? 'Cloudflare cannot reach the JUPTEE site server right now (522). Please try again later.'
        : result.error || `The assistant could not respond (${response.status}).`;
      throw new Error(message);
    }
    if (streamed) {
      await readAssistantStream(response);
      return;
    }
    if (typeof result.reply !== 'string' || !Array.isArray(result.products)) throw new Error('The shopping assistant returned an invalid response.');
    const row = addMessage('assistant', result.reply);
    addProductCards(result.products, row.querySelector('.jt-chat-bubble'));
  } catch (error) {
    console.error('Shopping assistant request failed:', error);
    const filters = parseChatQuery(message, state.filters);
    const localMatches = searchProducts(state.products, message, filters);
    if (localMatches.length) {
      const row = addMessage('assistant', 'The assistant is temporarily unavailable, but I found these matching items in the published JUPTEE catalog.');
      addProductCards(localMatches, row.querySelector('.jt-chat-bubble'));
    } else {
      addHtmlMessage(`<p class="jt-chat-error">I’m having trouble responding right now. Please try again or browse the collection.</p><div class="jt-chat-error-actions"><button type="button" data-retry-chat>Retry</button><a href="#shop">Browse collection</a></div>`);
    }
  } finally {
    state.loading = false;
    showTyping(false);
    const sendButton = root.querySelector('.jt-chat-send');
    if (sendButton) sendButton.disabled = false;
    scrollToBottom();
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
