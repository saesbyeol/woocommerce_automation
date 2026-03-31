'use strict';

// ── API key auth ─────────────────────────────────────────────────────────────

function validateApiKey(req) {
  const secret = process.env.CHATBASE_WEBHOOK_SECRET;
  return req.headers['x-chatbase-secret'] === secret;
}

// ── Order payload ────────────────────────────────────────────────────────────

const sanitize = (val) =>
  typeof val === 'string' ? val.trim().slice(0, 500) : '';

function validateOrderPayload(body) {
  const errors = [];

  // Support both flat top-level fields (from Chatbase) and nested billing object
  const b = (body.billing && typeof body.billing === 'object')
    ? body.billing
    : body;

  // ── billing ───────────────────────────────────────────────────────────────
  const requiredBilling = ['first_name', 'last_name', 'phone', 'address_1', 'city', 'country'];
  for (const field of requiredBilling) {
    if (!b[field] || String(b[field]).trim() === '') {
      errors.push(`${field} is required`);
    }
  }

  // email is optional — validate format only if provided
  if (b.email && String(b.email).trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) {
      errors.push('email is not a valid email address');
    }
  }

  // ── line_items ────────────────────────────────────────────────────────────
  // Accept flat product_name + quantity fields or line_items array
  let rawItems = body.line_items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const name = body.product_name ? String(body.product_name).trim() : '';
    const qty  = Number(body.quantity) || 1;
    if (name) {
      rawItems = [{ product_name: name, quantity: qty }];
    } else {
      errors.push('product_name is required');
    }
  } else {
    rawItems.forEach((item, idx) => {
      const name = item.product_name ? String(item.product_name).trim() : '';
      const qty  = Number(item.quantity);
      if (!name) {
        errors.push(`line_items[${idx}].product_name is required`);
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        errors.push(`line_items[${idx}].quantity must be a positive integer`);
      }
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // ── sanitize & parse ──────────────────────────────────────────────────────
  const billing = {
    first_name: sanitize(b.first_name),
    last_name:  sanitize(b.last_name),
    email:      sanitize(b.email),
    phone:      sanitize(b.phone),
    address_1:  sanitize(b.address_1),
    address_2:  sanitize(b.address_2 || ''),
    city:       sanitize(b.city),
    state:      sanitize(b.state || ''),
    postcode:   sanitize(b.postcode || ''),
    country:    sanitize(b.country),
  };

  const line_items = rawItems.map((item) => ({
    product_name: String(item.product_name).trim().slice(0, 500),
    quantity:     Number(item.quantity) || 1,
  }));

  const order_note = body.order_note ? sanitize(body.order_note) : '';

  return { valid: true, errors: [], parsed: { billing, line_items, order_note } };
}

module.exports = { validateApiKey, validateOrderPayload };
