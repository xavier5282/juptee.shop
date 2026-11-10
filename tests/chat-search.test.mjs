import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChatQuery, searchProducts } from '../chat-search.mjs';

const products = [
  {
    id: 'black-hoodie',
    name: 'Classic Hoodie',
    category: 'hoodies',
    price: 1800,
    variants: [
      { color: 'Black', size: 'L', unitPrice: 1450, stock: 3 },
      { color: 'Black', size: 'M', unitPrice: 1450, stock: 0 }
    ]
  },
  {
    id: 'white-tee',
    name: 'Everyday T-shirt',
    category: 'tshirts',
    price: 700,
    variants: [{ color: 'White', size: 'L', unitPrice: 700, stock: 2 }]
  },
  {
    id: 'red-hoodie',
    name: 'Red Hoodie',
    category: 'hoodies',
    price: 1200,
    variants: [{ color: 'Red', size: 'XL', unitPrice: 1200, stock: 4 }]
  }
];

test('parses size, price cap, color and category from natural language', () => {
  assert.deepEqual(parseChatQuery('black hoodie size L under 1500').size, ['L']);
  assert.deepEqual(parseChatQuery('black hoodie size L under 1500'), {
    size: ['L'], color: 'black', category: 'hoodies', minPrice: null, maxPrice: 1500
  });
});

test('parses price ranges and explicit filter selections', () => {
  assert.deepEqual(parseChatQuery('hoodie between ৳500 and ৳1500').maxPrice, 1500);
  assert.deepEqual(parseChatQuery('hoodie between ৳500 and ৳1500').minPrice, 500);
  assert.deepEqual(parseChatQuery('', { size: ['XL'], minPrice: '500' }).size, ['XL']);
  assert.equal(parseChatQuery('under 1500', { maxPrice: 500 }).maxPrice, 500);
});

test('search returns only matching, in-stock product variants and respects sale prices', () => {
  assert.deepEqual(searchProducts(products, 'black hoodie size L under 1500').map(product => product.id), ['black-hoodie']);
  assert.deepEqual(searchProducts(products, 'white hoodie'), []);
});
