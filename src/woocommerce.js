'use strict';

require('dotenv').config();
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const api = new WooCommerceRestApi({
  url:            process.env.WC_URL,
  consumerKey:    process.env.WC_KEY,
  consumerSecret: process.env.WC_SECRET,
  version:        'wc/v3',
  queryStringAuth: true,
});

// ── getProducts ──────────────────────────────────────────────────────────────

async function getProducts() {
  const { data } = await api.get('products', {
    status:      'publish',
    stock_status: 'instock',
    per_page:    100,
  });

  return data.map((p) => ({
    id:             p.id,
    name:           p.name,
    price:          p.price,
    in_stock:       p.in_stock,
    stock_quantity: p.manage_stock ? p.stock_quantity : null,
    manage_stock:   p.manage_stock,
  }));
}

// ── checkStock ───────────────────────────────────────────────────────────────

async function checkStock(productId) {
  const { data: p } = await api.get(`products/${productId}`);

  return {
    product_id:     p.id,
    name:           p.name,
    in_stock:       p.in_stock,
    stock_quantity: p.manage_stock ? p.stock_quantity : null,
    manage_stock:   p.manage_stock,
  };
}

// ── validateStock ────────────────────────────────────────────────────────────

async function validateStock(items) {
  const stockResults = await Promise.all(
    items.map((item) => checkStock(item.product_id))
  );

  for (let i = 0; i < items.length; i++) {
    const stock = stockResults[i];
    const { quantity } = items[i];

    if (!stock.in_stock) {
      throw new Error(
        `Product "${stock.name}" (id: ${stock.product_id}) is out of stock (insufficient stock)`
      );
    }

    if (
      stock.manage_stock &&
      stock.stock_quantity !== null &&
      stock.stock_quantity < quantity
    ) {
      throw new Error(
        `Product "${stock.name}" (id: ${stock.product_id}) has only ${stock.stock_quantity} unit(s) available, but ${quantity} requested (insufficient stock)`
      );
    }
  }
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(payload) {
  const { billing, shipping, items, note } = payload;

  await validateStock(items);

  const orderData = {
    status:               'processing',
    billing,
    shipping:             shipping || billing,
    line_items:           items.map((item) => ({
      product_id: item.product_id,
      quantity:   item.quantity,
    })),
    payment_method:       process.env.PAYMENT_METHOD       || 'cod',
    payment_method_title: process.env.PAYMENT_METHOD_TITLE || 'Cash on Delivery',
    customer_note:        note || '',
  };

  const { data: order } = await api.post('orders', orderData);

  return {
    order_id:     order.id,
    order_number: order.number,
    total:        order.total,
    currency:     order.currency,
  };
}

module.exports = { getProducts, checkStock, validateStock, createOrder };
