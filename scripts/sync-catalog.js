'use strict';

/**
 * Run this script locally whenever your WooCommerce product catalog changes:
 *   node scripts/sync-catalog.js
 *
 * It fetches all published products + variations and writes them to
 * src/catalog.json, which is committed to git and used by the app at runtime.
 * This means zero WooCommerce API calls for product lookup in production.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const api = new WooCommerceRestApi({
  url:             process.env.WC_URL,
  consumerKey:     process.env.WC_KEY,
  consumerSecret:  process.env.WC_SECRET,
  version:         'wc/v3',
  queryStringAuth: true,
});

async function fetchAll() {
  let page = 1;
  let all  = [];
  while (true) {
    const { data } = await api.get('products', { status: 'publish', per_page: 100, page });
    if (!data || data.length === 0) break;
    all = all.concat(data);
    console.log(`  Fetched page ${page} (${data.length} products)`);
    if (data.length < 100) break;
    page++;
  }
  return all;
}

async function build() {
  console.log('Fetching product catalog from WooCommerce...');
  const all    = await fetchAll();
  const result = [];

  for (const p of all) {
    if (p.type === 'variable') {
      try {
        const { data: variations } = await api.get(`products/${p.id}/variations`, { per_page: 50 });
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
        console.log(`  Variable: ${p.name} (${variations.length} variations)`);
      } catch {
        result.push({ id: p.id, name: p.name, price: p.price, in_stock: p.stock_status === 'instock' });
      }
    } else {
      result.push({ id: p.id, name: p.name, price: p.price, in_stock: p.stock_status === 'instock' });
    }
  }

  const outPath = path.join(__dirname, '..', 'src', 'catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nDone. ${result.length} products/variations saved to src/catalog.json`);
  console.log('Now commit and push: git add src/catalog.json && git commit -m "Update product catalog" && git push');
}

build().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
