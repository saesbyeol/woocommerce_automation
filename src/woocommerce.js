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

// ── findProductByName ─────────────────────────────────────────────────────────

async function findProductByName(name) {
  const { data } = await getApi().get('products', {
    search:   name,
    status:   'publish',
    per_page: 10,
  });

  if (!data || data.length === 0) {
    throw new Error(`No product found matching "${name}"`);
  }

  // Return the closest match (first result from WooCommerce search)
  return data[0];
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  // Resolve product names to real IDs
  const resolvedItems = await Promise.all(line_items.map(async (item) => {
    const product = await findProductByName(item.product_name);
    return { product_id: product.id, quantity: item.quantity };
  }));

  const { data: order } = await getApi().post('orders', {
    status:               'pending',
    billing,
    shipping:             billing,
    line_items:           resolvedItems.map((item) => ({
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
