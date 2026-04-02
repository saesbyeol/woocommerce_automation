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

  // 4. Most significant words present (≥60%) — handles mismatched names from system prompt
  if (!match) {
    const words = needle.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 2) {
      const threshold = Math.ceil(words.length * 0.6);
      let bestMatch = null;
      let bestScore = 0;
      for (const p of catalog) {
        const hay = p.name.toLowerCase();
        const score = words.filter((w) => hay.includes(w)).length;
        if (score >= threshold && score > bestScore) {
          bestScore = score;
          bestMatch = p;
        }
      }
      match = bestMatch;
    }
  }

  if (!match) {
    throw new Error(`No product found matching "${name}"`);
  }

  return { id: match.id, variation_id: match.variation_id || null };
}

// ── Shipping ──────────────────────────────────────────────────────────────────
// Product IDs that incur 500 din shipping; all others are 450 din
const SHIPPING_500_IDS = new Set([
  20497, // Krevetac sa ljuljaškom, baldahinom i mrežom protiv komaraca za bebe
  15090, // Aku Trimer za Travu sa 2 Baterije
  15394, // Makita 2 u 1 aku set
  15364, // Njihalica - Automatska baby ležaljka (električna ljuljaška za bebe)
  31538, // Aku set za orezivanje 5u1
]);

function calcShipping(resolvedItems) {
  const needs500 = resolvedItems.some((item) => SHIPPING_500_IDS.has(item.product_id));
  return needs500 ? '500' : '450';
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  const resolvedItems = await Promise.all(line_items.map(async (item) => {
    const product = await findProductByName(item.product_name);
    return { product_id: product.id, variation_id: product.variation_id, quantity: item.quantity };
  }));

  const billingWithEmail = {
    ...billing,
    email: billing.email || 'noemail@tradershop.rs',
  };

  const shippingTotal = calcShipping(resolvedItems);

  const { data: order } = await getApi().post('orders', {
    status:               'processing',
    billing:              billingWithEmail,
    shipping:             billingWithEmail,
    line_items:           resolvedItems.map((item) => {
      const li = { product_id: item.product_id, quantity: item.quantity };
      if (item.variation_id) li.variation_id = item.variation_id;
      return li;
    }),
    shipping_lines: [
      {
        method_id:    'flat_rate',
        method_title: 'PostExpress / SpeedyExpress',
        total:        shippingTotal,
      },
    ],
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
