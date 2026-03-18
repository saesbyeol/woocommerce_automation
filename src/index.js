'use strict';

require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const logger    = require('./logger');
const { getProducts, createOrder } = require('./woocommerce');
const { validateApiKey, validateOrderPayload } = require('./validation');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ──────────────────────────────────────────────────────

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ── Rate limiters ────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    logger.warn('Global rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ success: false, message: 'Too many requests' });
  },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    logger.warn('Order rate limit exceeded', { ip: req.ip });
    res.status(429).json({ success: false, message: 'Too many requests' });
  },
});

app.use(globalLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /products
app.get('/products', async (req, res) => {
  if (!validateApiKey(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const products = await getProducts();
    res.json({ success: true, products });
  } catch (err) {
    logger.error('Failed to fetch products', { message: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// POST /create-order
app.post('/create-order', orderLimiter, async (req, res) => {
  logger.info('Incoming request', {
    headers: req.headers,
    body: req.body,
    query: req.query,
  });

  if (!validateApiKey(req)) {
    logger.warn('Unauthorized request', { ip: req.ip });
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const validation = validateOrderPayload(req.body);
  if (!validation.valid) {
    logger.warn('Invalid order payload', { errors: validation.errors });
    return res.status(400).json({ success: false, errors: validation.errors });
  }

  try {
    const result = await createOrder(validation.parsed);
    logger.info('Order created', { order_id: result.order_id, order_number: result.order_number });
    res.status(201).json({ success: true, order_id: result.order_id, order_number: result.order_number });
  } catch (err) {
    if (err.message && err.message.includes('No product found matching')) {
      logger.warn('Product not found', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
    logger.error('Order creation failed', { message: err.message });
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// ── 404 fallback ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
});

module.exports = app;
