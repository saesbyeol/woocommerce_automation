'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
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

// ── Static product catalog (loaded from committed catalog.json) ───────────────

const CATALOG_PATH = path.join(__dirname, 'catalog.json');

function loadCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const catalog = JSON.parse(raw);
    logger.info('Product catalog loaded', { count: catalog.length });
    return catalog;
  } catch (err) {
    logger.warn('catalog.json not found or invalid, falling back to empty catalog', { message: err.message });
    return [];
  }
}

// Load once at startup — no API calls needed
const catalog = loadCatalog();

// ── getProducts ──────────────────────────────────────────────────────────────

async function getProducts() {
  return catalog;
}

// ── findProductByName ─────────────────────────────────────────────────────────

async function findProductByName(name) {
  const needle = name.toLowerCase().trim();

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
