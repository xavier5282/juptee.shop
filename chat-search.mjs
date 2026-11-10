const SIZE_NAMES = ['3XL', 'XXXL', 'XXL', 'XL', 'L', 'M', 'S'];
const CATEGORY_TERMS = [
  [['hoodie', 'hoodies'], 'hoodies'],
  [['couple', 'matching'], 'couple'],
  [['oversized', 'oversize'], 'oversized'],
  [['drop shoulder', 'dropshoulder'], 'dropshoulder'],
  [['polo'], 'polo'],
  [['accessory', 'accessories', 'cap'], 'accessories'],
  [['custom', 'printed'], 'custom']
];

export function parseChatQuery(query, selected = {}) {
  const text = String(query || '').toLowerCase();
  const result = {
    size: Array.isArray(selected.size) ? [...selected.size] : [],
    color: selected.color || '',
    category: selected.category || '',
    minPrice: selected.minPrice !== null && selected.minPrice !== undefined && selected.minPrice !== ''
      && Number.isFinite(Number(selected.minPrice)) ? Number(selected.minPrice) : null,
    maxPrice: selected.maxPrice !== null && selected.maxPrice !== undefined && selected.maxPrice !== ''
      && Number.isFinite(Number(selected.maxPrice)) ? Number(selected.maxPrice) : null
  };

  for (const size of SIZE_NAMES) {
    if (new RegExp(`\\b(?:size\\s*)?${size}\\b`, 'i').test(text)) result.size = [...new Set([...result.size, size])];
  }
  const range = text.match(/(?:between|from)\s*৳?\s*(\d{2,6})\s*(?:and|to|-)\s*৳?\s*(\d{2,6})/i)
    || text.match(/৳?\s*(\d{2,6})\s*-\s*৳?\s*(\d{2,6})/i);
  if (range) {
    result.minPrice = Math.max(result.minPrice ?? 0, Number(range[1]));
    result.maxPrice = Math.min(result.maxPrice ?? Number(range[2]), Number(range[2]));
  } else {
    const upper = text.match(/(?:under|below|less than|up to|max(?:imum)?|within)\s*৳?\s*(\d{2,6})/i)
      || text.match(/৳\s*(\d{2,6})\s*(?:or less|and under)/i);
    const lower = text.match(/(?:over|above|more than|at least|from)\s*৳?\s*(\d{2,6})/i);
    if (upper) result.maxPrice = Math.min(result.maxPrice ?? Number(upper[1]), Number(upper[1]));
    if (lower) result.minPrice = Math.max(result.minPrice ?? 0, Number(lower[1]));
  }

  const colors = ['black', 'white', 'red', 'blue', 'green', 'navy', 'grey', 'gray', 'pink', 'yellow', 'brown', 'beige'];
  const color = colors.find(value => new RegExp(`\\b${value}\\b`, 'i').test(text));
  if (color) result.color = color === 'gray' ? 'grey' : color;

  for (const [terms, category] of CATEGORY_TERMS) {
    if (terms.some(term => text.includes(term))) {
      result.category = category;
      break;
    }
  }
  return { ...result, size: [...new Set(result.size)] };
}

function priceOf(product, filters) {
  const variantPrices = (product.variants || [])
    .filter(variant => Number(variant.stock) > 0
      && (!filters.size.length || filters.size.includes(String(variant.size).toUpperCase()))
      && (!filters.color || String(variant.color || '').toLowerCase().includes(filters.color)))
    .map(variant => Number(variant.unitPrice))
    .filter(Number.isFinite);
  if (variantPrices.length) return Math.min(...variantPrices);
  const sale = Number(product.salePrice);
  return Number.isFinite(sale) && sale > 0 ? sale : Number(product.price);
}

export function searchProducts(products, query, filters = {}) {
  const parsed = parseChatQuery(query, filters);
  const searchText = String(query || '').toLowerCase()
    .replace(/(?:under|below|less than|up to|max(?:imum)?|within|over|above|more than|at least)\s*৳?\s*\d{2,6}/gi, ' ')
    .replace(/(?:between|from)\s*৳?\s*\d{2,6}\s*(?:and|to|-)\s*৳?\s*\d{2,6}/gi, ' ')
    .replace(/\bsize\s*(?:3xl|xxxl|xxl|xl|l|m|s)\b/gi, ' ');
  const terms = searchText.split(/[^\p{L}\p{N}]+/u).filter(term =>
    term.length > 2 && !/^(?:under|below|less|than|size|with|for|and|the|from|show|find|want|have|under|please)$/.test(term)
  );
  return products
    .map(product => {
      const variants = product.variants || [];
      const available = variants.filter(variant => Number(variant.stock) > 0);
      if (parsed.size.length && !available.some(variant => parsed.size.includes(String(variant.size).toUpperCase()))) return null;
      if (parsed.color && !available.some(variant => String(variant.color || '').toLowerCase().includes(parsed.color))) return null;
      const categoryText = `${product.category || ''} ${product.name || ''} ${product.description || ''}`
        .toLowerCase().replace(/[\s_-]+/g, '');
      const categoryTerms = {
        hoodies: /hoodie/,
        couple: /couple|matching/,
        oversized: /oversiz/,
        dropshoulder: /dropshoulder/,
        polo: /polo/,
        accessories: /accessor|cap/,
        custom: /custom|print/
      };
      if (parsed.category && !categoryTerms[parsed.category]?.test(categoryText)) return null;
      const price = priceOf(product, parsed);
      if (parsed.minPrice !== null && price < parsed.minPrice) return null;
      if (parsed.maxPrice !== null && price > parsed.maxPrice) return null;
      const searchable = `${product.name || ''} ${product.category || ''} ${product.description || ''} ${variants.map(variant => variant.color).join(' ')}`.toLowerCase();
      const matchedTerms = terms.filter(term => searchable.includes(term));
      if (terms.length && !matchedTerms.length) return null;
      return { product, score: matchedTerms.length, price };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, 6)
    .map(entry => entry.product);
}
