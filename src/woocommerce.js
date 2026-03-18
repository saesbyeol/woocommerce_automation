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

  const result = [];

  for (const p of data) {
    if (p.type === 'variable') {
      // Fetch variations for variable products
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

  return result;
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

  const product = data[0];

  // If variable product, search variations for the best match
  if (product.type === 'variable') {
    const { data: variations } = await getApi().get(`products/${product.id}/variations`, { per_page: 50 });
    const nameLower = name.toLowerCase();

    // Try to find a variation whose attributes match the search name
    const matched = variations.find((v) =>
      v.attributes.some((a) => nameLower.includes(a.option.toLowerCase()))
    );

    if (matched) {
      return { id: product.id, variation_id: matched.id };
    }

    // Fall back to first variation
    return { id: product.id, variation_id: variations[0]?.id || null };
  }

  return { id: product.id, variation_id: null };
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  // Resolve product names to real IDs + variation IDs
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
