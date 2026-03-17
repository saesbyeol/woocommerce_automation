'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// ── Webhook signature ────────────────────────────────────────────────────────

function validateWebhookSignature(req) {
  const secret = process.env.CHATBASE_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('CHATBASE_WEBHOOK_SECRET is not set — skipping signature check (dev mode)');
    return true;
  }

  const signature =
    req.headers['x-chatbase-signature'] ||
    req.headers['x-webhook-signature'];

  if (!signature) {
    return false;
  }

  try {
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const sigBuffer      = Buffer.from(signature, 'hex');
    const hmacBuffer     = Buffer.from(hmac, 'hex');

    if (sigBuffer.length !== hmacBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, hmacBuffer);
  } catch {
    return false;
  }
}

// ── Order payload ────────────────────────────────────────────────────────────

const sanitize = (val) =>
  typeof val === 'string' ? val.trim().slice(0, 500) : '';

function validateOrderPayload(body) {
  const errors = [];

  // ── billing ──────────────────────────────────────────────────────────────
  const b = body.billing || {};

  const requiredBilling = ['first_name', 'last_name', 'address_1', 'city', 'country'];
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

  // ── items ─────────────────────────────────────────────────────────────────
  const rawItems = body.items;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push('items must be a non-empty array');
  } else {
    rawItems.forEach((item, idx) => {
      const pid = Number(item.product_id);
      const qty = Number(item.quantity);

      if (!Number.isInteger(pid) || pid <= 0) {
        errors.push(`items[${idx}].product_id must be a positive integer`);
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        errors.push(`items[${idx}].quantity must be a positive integer`);
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
    address_2:  sanitize(b.address_2),
    city:       sanitize(b.city),
    state:      sanitize(b.state),
    postcode:   sanitize(b.postcode),
    country:    sanitize(b.country),
  };

  const rawShipping = body.shipping;
  const shipping = rawShipping
    ? {
        first_name: sanitize(rawShipping.first_name),
        last_name:  sanitize(rawShipping.last_name),
        address_1:  sanitize(rawShipping.address_1),
        address_2:  sanitize(rawShipping.address_2),
        city:       sanitize(rawShipping.city),
        state:      sanitize(rawShipping.state),
        postcode:   sanitize(rawShipping.postcode),
        country:    sanitize(rawShipping.country),
      }
    : null;

  const items = rawItems.map((item) => ({
    product_id: Number(item.product_id),
    quantity:   Number(item.quantity),
  }));

  const note = body.note ? sanitize(body.note) : '';

  return { valid: true, errors: [], parsed: { billing, shipping, items, note } };
}

module.exports = { validateWebhookSignature, validateOrderPayload };
