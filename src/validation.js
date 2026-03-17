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

  // ── billing ───────────────────────────────────────────────────────────────
  const b = body.billing || {};

  const requiredBilling = ['first_name', 'last_name', 'phone', 'address_1', 'city', 'country'];
  for (const field of requiredBilling) {
    if (!b[field] || String(b[field]).trim() === '') {
      errors.push(`billing.${field} is required`);
    }
  }

  if (!b.email || String(b.email).trim() === '') {
    errors.push('billing.email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) {
    errors.push('billing.email is not a valid email address');
  }

  // ── order_note ────────────────────────────────────────────────────────────
  if (!body.order_note || String(body.order_note).trim() === '') {
    errors.push('order_note is required');
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
    address_2:  sanitize(b.address_2),
    city:       sanitize(b.city),
    state:      sanitize(b.state),
    postcode:   sanitize(b.postcode),
    country:    sanitize(b.country),
  };

  const order_note = sanitize(body.order_note);

  return { valid: true, errors: [], parsed: { billing, order_note } };
}

module.exports = { validateApiKey, validateOrderPayload };
