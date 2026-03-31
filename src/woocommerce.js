'use strict';

require('dotenv').config();
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const logger = require('./logger');

let _api = null;
const getApi = () => {
  if (!_api) {
    _api = new WooCommerceRestApi({
      url:             process.env.WC_URL,
      consumerKey:     process.env.WC_KEY,
      consumerSecret:  process.env.WC_SECRET,
      version:         'wc/v3',
      queryStringAuth: true,
    });
  }
  return _api;
};

// ── Product catalog cache (10 min TTL) ────────────────────────────────────────

let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function buildCatalog() {
  // Fetch all published products (paginated)
  let page = 1;
  let all  = [];
  while (true) {
    const { data } = await getApi().get('products', {
      status:   'publish',
      per_page: 100,
      page,
    });
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 100) break;
    page++;
  }

  const result = [];

  for (const p of all) {
    if (p.type === 'variable') {
      try {
        const { data: variations } = await getApi().get(`products/${p.id}/variations`, { per_page: 50 });
        for (const v of variations) {
          const varName = v.attributes.map((a) => a.option).join(' – ');
          result.push({
            id:           p.id,
            variation_id: v.id,
            name:         `${p.name} – ${varName}`,
            price:        v.price,
            in_stock:     v.stock_status === 'instock',
          });
        }
      } catch {
        result.push({ id: p.id, name: p.name, price: p.price, in_stock: p.stock_status === 'instock' });
      }
    } else {
      result.push({ id: p.id, name: p.name, price: p.price, in_stock: p.stock_status === 'instock' });
    }
  }

  logger.info('Product catalog cached', { count: result.length });
  return result;
}

async function getCatalog() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) {
    return _cache;
  }
  _cache     = await buildCatalog();
  _cacheTime = Date.now();
  return _cache;
}

// ── getProducts ──────────────────────────────────────────────────────────────

async function getProducts() {
  return getCatalog();
}

// ── findProductByName ─────────────────────────────────────────────────────────

async function findProductByName(name) {
  const catalog = await getCatalog();
  const needle  = name.toLowerCase().trim();

  // 1. Exact match
  let match = catalog.find((p) => p.name.toLowerCase() === needle);

  // 2. One contains the other
  if (!match) {
    match = catalog.find((p) => {
      const hay = p.name.toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    });
  }

  // 3. All significant words present
  if (!match) {
    const words = needle.split(/\s+/).filter((w) => w.length > 2);
    match = catalog.find((p) => {
      const hay = p.name.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  if (!match) {
    throw new Error(`No product found matching "${name}"`);
  }

  return { id: match.id, variation_id: match.variation_id || null };
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  const resolvedItems = await Promise.all(line_items.map(async (item) => {
    const product = await findProductByName(item.product_name);
    return { product_id: product.id, variation_id: product.variation_id, quantity: item.quantity };
  }));

  const { data: order } = await getApi().post('orders', {
    status:               'pending',
    billing,
    shipping:             billing,
    line_items:           resolvedItems.map((item) => {
      const li = { product_id: item.product_id, quantity: item.quantity };
      if (item.variation_id) li.variation_id = item.variation_id;
      return li;
    }),
    payment_method:       'cod',
    payment_method_title: 'Cash on Delivery',
    customer_note:        order_note || '',
  });

  return {
    order_id:     order.id,
    order_number: order.number,
  };
}

module.exports = { getProducts, createOrder };
