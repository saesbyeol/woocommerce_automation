'use strict';

require('dotenv').config();
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

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

// ── getProducts ──────────────────────────────────────────────────────────────

async function getProducts() {
  const { data } = await getApi().get('products', {
    status:   'publish',
    per_page: 100,
  });

  return data.map((p) => ({
    id:    p.id,
    name:  p.name,
    price: p.price,
    in_stock: p.stock_status === 'instock',
  }));
}

// ── validateProducts ─────────────────────────────────────────────────────────

async function validateProducts(line_items) {
  await Promise.all(line_items.map(async (item) => {
    try {
      await getApi().get(`products/${item.product_id}`);
    } catch {
      throw new Error(`Product ID ${item.product_id} does not exist in the store`);
    }
  }));
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  await validateProducts(line_items);

  const { data: order } = await getApi().post('orders', {
    status:               'pending',
    billing,
    shipping:             billing,
    line_items:           line_items.map((item) => ({
      product_id: item.product_id,
      quantity:   item.quantity,
    })),
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
