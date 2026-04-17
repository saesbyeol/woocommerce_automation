'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const logger = require('./logger');

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

// ── Static product catalog (loaded from committed catalog.json) ───────────────

const CATALOG_PATH = path.join(__dirname, 'catalog.json');

function loadCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const catalog = JSON.parse(raw);
    logger.info('Product catalog loaded', { count: catalog.length });
    return catalog;
  } catch (err) {
    logger.warn('catalog.json not found or invalid, falling back to empty catalog', { message: err.message });
    return [];
  }
}

// Load once at startup — no API calls needed
const catalog = loadCatalog();

// ── Aliases (wrong bot names → correct product names) ─────────────────────────
const ALIASES_PATH = path.join(__dirname, 'aliases.json');
const aliases = (() => {
  try { return JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8')); } catch { return {}; }
})();

// ── Serbian word stemmer ──────────────────────────────────────────────────────
// Strips common inflection endings so "sivi"/"siva"/"sive" all stem to "siv"
function stemWord(word) {
  if (word.length < 4) return word;
  return word.replace(/[aeio]$/i, '');
}

function wordsMatch(needleWord, hayWord) {
  if (hayWord.includes(needleWord)) return true;
  // Try stemmed comparison for words >= 4 chars
  if (needleWord.length >= 4 && hayWord.length >= 4) {
    return stemWord(hayWord).startsWith(stemWord(needleWord)) ||
           stemWord(needleWord).startsWith(stemWord(hayWord));
  }
  return false;
}

// Pick the color variation that best matches the needle.
// Scored by proportion of variation words matched — so "Siva" (1/1 = 100%)
// beats "Šareno sivi" (1/2 = 50%) when the needle only mentions "sivi".
function pickBestColorVariant(candidates, needle) {
  let best = candidates[0];
  let bestScore = -1;
  const needleWords = needle.split(/\s+/).filter(w => w.length > 1);
  for (const p of candidates) {
    const varPart = p.name.split('–').pop().toLowerCase().trim();
    const varWords = varPart.split(/\s+/).filter(w => w.length > 1);
    if (varWords.length === 0) continue;
    const matched = varWords.filter(vw => needleWords.some(nw => wordsMatch(vw, nw))).length;
    // Use proportion so a short exact match beats a long partial match
    const score = matched / varWords.length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// ── getProducts ──────────────────────────────────────────────────────────────

async function getProducts() {
  return catalog;
}

// ── findProductByName ─────────────────────────────────────────────────────────

async function findProductByName(name, context) {
  const needle = name.toLowerCase().trim();

  // 0. Check aliases — redirect known wrong names to correct product names
  // Check both exact key match and partial key match (needle contains the alias key)
  const aliasKey = Object.keys(aliases).find((k) => needle === k || needle.includes(k));
  if (aliasKey) {
    const alias = aliases[aliasKey];
    const ctx = (context || '').toLowerCase() + ' ' + needle;
    let resolved = alias.default;
    for (const [hint, target] of Object.entries(alias.hints || {})) {
      if (ctx.includes(hint)) { resolved = target; break; }
    }
    logger.info('Alias matched', { from: name, to: resolved });
    return findProductByName(resolved, context);
  }

  // 1. Exact match
  let match = catalog.find((p) => p.name.toLowerCase() === needle);

  // 2. One contains the other
  if (!match) {
    match = catalog.find((p) => {
      const hay = p.name.toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    });
  }

  // 3. All significant words present (with stemmed matching)
  if (!match) {
    const words = needle.split(/\s+/).filter((w) => w.length > 1);
    const tier3Matches = catalog.filter((p) => {
      const hay = p.name.toLowerCase();
      const hayWords = hay.split(/\s+/);
      return words.every((w) => hayWords.some((hw) => wordsMatch(w, hw)));
    });
    if (tier3Matches.length > 1) {
      const uniqueParentIds = new Set(tier3Matches.map((p) => p.id));
      if (uniqueParentIds.size === 1) {
        const options = tier3Matches.map((p) => p.name.split('–').pop().trim());
        const isSizeVariation = options.some((o) => /\d/.test(o));
        if (isSizeVariation) {
          throw new Error(`Multiple variations found for "${name}". Please specify which one: ${options.join(', ')}`);
        }
        // Color variations — pick the one whose color best matches the needle
        match = pickBestColorVariant(tier3Matches, needle);
      }
    }
    if (!match) match = tier3Matches[0] || null;
  }

  // 4. Most significant words present (≥60%) — handles mismatched names from system prompt
  if (!match) {
    const words = [...new Set(needle.split(/\s+/).filter((w) => w.length > 1))];
    if (words.length >= 2) {
      const threshold = Math.ceil(words.length * 0.7);
      let bestScore = 0;
      const bestMatches = [];
      for (const p of catalog) {
        const hay = p.name.toLowerCase();
        const score = words.filter((w) => hay.includes(w)).length;
        if (score >= threshold) {
          if (score > bestScore) {
            bestScore = score;
            bestMatches.length = 0;
            bestMatches.push(p);
          } else if (score === bestScore) {
            bestMatches.push(p);
          }
        }
      }
      // If multiple variations of the same product match equally, we can't determine
      // which variation the customer wants — force the bot to be more specific
      if (bestMatches.length > 1) {
        const uniqueParentIds = new Set(bestMatches.map((p) => p.id));
        if (uniqueParentIds.size === 1) {
          const options = bestMatches.map((p) => p.name.split('–').pop().trim());
          const isSizeVariation = options.some((o) => /\d/.test(o));
          if (isSizeVariation) {
            throw new Error(`Multiple variations found for "${name}". Please specify which one: ${options.join(', ')}`);
          }
        }
      }
      match = bestMatches[0] || null;
    }
  }

  if (!match) {
    throw new Error(`No product found matching "${name}"`);
  }

  return { id: match.id, variation_id: match.variation_id || null };
}

// ── Country name → ISO code ───────────────────────────────────────────────────
const COUNTRY_MAP = {
  'srbija': 'RS', 'serbia': 'RS',
  'bosna i hercegovina': 'BA', 'bosna': 'BA', 'bih': 'BA',
  'hrvatska': 'HR', 'croatia': 'HR',
  'slovenija': 'SI', 'slovenia': 'SI',
  'crna gora': 'ME', 'montenegro': 'ME',
  'makedonija': 'MK', 'severna makedonija': 'MK', 'north macedonia': 'MK',
  'nemačka': 'DE', 'germany': 'DE',
  'austrija': 'AT', 'austria': 'AT',
  'švajcarska': 'CH', 'switzerland': 'CH',
  'mađarska': 'HU', 'hungary': 'HU',
};

function resolveCountry(value) {
  if (!value) return value;
  const lower = value.trim().toLowerCase();
  return COUNTRY_MAP[lower] || value.trim().toUpperCase();
}

// ── Shipping ──────────────────────────────────────────────────────────────────
// Product IDs that incur 500 din shipping; all others are 450 din
const SHIPPING_500_IDS = new Set([
  20497, // Krevetac sa ljuljaškom, baldahinom i mrežom protiv komaraca za bebe
  15090, // Aku Trimer za Travu sa 2 Baterije
  15394, // Makita 2 u 1 aku set
  15364, // Njihalica - Automatska baby ležaljka (električna ljuljaška za bebe)
  31538, // Aku set za orezivanje 5u1
]);

function calcShipping(resolvedItems) {
  const needs500 = resolvedItems.some((item) => SHIPPING_500_IDS.has(item.product_id));
  return needs500 ? '500' : '450';
}

// ── createOrder ──────────────────────────────────────────────────────────────

async function createOrder(parsed) {
  const { billing, line_items, order_note } = parsed;

  const rawResolved = await Promise.all(line_items.map(async (item) => {
    const product = await findProductByName(item.product_name, order_note);
    return { product_id: product.id, variation_id: product.variation_id, quantity: item.quantity };
  }));

  // Merge duplicate product+variation entries to avoid double quantities
  const seen = new Map();
  for (const item of rawResolved) {
    const key = `${item.product_id}-${item.variation_id || 0}`;
    if (seen.has(key)) {
      seen.get(key).quantity += item.quantity;
    } else {
      seen.set(key, { ...item });
    }
  }
  const resolvedItems = Array.from(seen.values());

  const billingWithEmail = {
    ...billing,
    email:   billing.email || 'noemail@tradershop.rs',
    country: resolveCountry(billing.country),
  };

  const shippingTotal = calcShipping(resolvedItems);

  const { data: order } = await getApi().post('orders', {
    status:               'processing',
    billing:              billingWithEmail,
    shipping:             billingWithEmail,
    line_items:           resolvedItems.map((item) => {
      const li = { product_id: item.product_id, quantity: item.quantity };
      if (item.variation_id) li.variation_id = item.variation_id;
      return li;
    }),
    shipping_lines: [
      {
        method_id:    'flat_rate',
        method_title: 'PostExpress / SpeedyExpress',
        total:        shippingTotal,
      },
    ],
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
