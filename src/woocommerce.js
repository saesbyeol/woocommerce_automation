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

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, order_note } = parsed;

  const { data: order } = await getApi().post('orders', {
    status:               'pending',
    billing,
    shipping:             billing,
    line_items:           [],
    payment_method:       'cod',
    payment_method_title: 'Cash on Delivery',
    customer_note:        order_note,
  });

  return {
    order_id:     order.id,
    order_number: order.number,
  };
}

module.exports = { createOrder };
