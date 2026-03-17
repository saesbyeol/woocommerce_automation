'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const logger     = require('./logger');
const { getProducts, checkStock, createOrder } = require('./woocommerce');
const { validateWebhookSignature, validateOrderPayload } = require('./validation');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ──────────────────────────────────────────────────────

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
  try {
    const products = await getProducts();
    logger.info('Products fetched', { count: products.length });
    res.json({ success: true, products });
  } catch (err) {
    logger.error('Failed to fetch products', { message: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// GET /stock/:productId
app.get('/stock/:productId', async (req, res) => {
  const productId = Number(req.params.productId);

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'productId must be a positive integer' });
  }

  try {
    const stock = await checkStock(productId);
    logger.info('Stock checked', { productId });
    res.json({ success: true, ...stock });
  } catch (err) {
    logger.error('Failed to check stock', { productId, message: err.message });
    res.status(500).json({ success: false, message: 'Failed to check stock' });
  }
});

// POST /webhook/chatbase
app.post('/webhook/chatbase', orderLimiter, async (req, res) => {
  // Signature validation
  if (!validateWebhookSignature(req)) {
    logger.warn('Invalid webhook signature', { ip: req.ip });
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  // Payload validation
  const validation = validateOrderPayload(req.body);
  if (!validation.valid) {
    logger.warn('Invalid order payload', { errors: validation.errors });
    return res.status(400).json({ success: false, errors: validation.errors });
  }

  // Create order
  try {
    const result = await createOrder(validation.parsed);
    logger.info('Order created', { order_id: result.order_id, order_number: result.order_number });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    if (err.message && err.message.includes('(insufficient stock)')) {
      logger.warn('Order failed — stock issue', { message: err.message });
      return res.status(409).json({ success: false, message: err.message });
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
