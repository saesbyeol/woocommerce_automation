# wc-chatbase-middleware

Express middleware that bridges [Chatbase](https://www.chatbase.co/) chatbot webhooks to WooCommerce orders via the WooCommerce REST API.

---

## Endpoints

| Method | Path                    | Description                                      |
|--------|-------------------------|--------------------------------------------------|
| GET    | `/health`               | Health check — returns `{ status, timestamp }`   |
| GET    | `/products`             | List published, in-stock products                |
| GET    | `/stock/:productId`     | Check stock for a single product                 |
| POST   | `/webhook/chatbase`     | Receive Chatbase webhook and create WC order     |

---

## Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd wc-chatbase-middleware

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your WooCommerce credentials and webhook secret

# 4. Start the server
npm start          # production
npm run dev        # development (nodemon)
```

---

## Environment Variables

| Variable                  | Required | Default            | Description                          |
|---------------------------|----------|--------------------|--------------------------------------|
| `WC_URL`                  | Yes      | —                  | WooCommerce store URL                |
| `WC_KEY`                  | Yes      | —                  | WooCommerce consumer key             |
| `WC_SECRET`               | Yes      | —                  | WooCommerce consumer secret          |
| `CHATBASE_WEBHOOK_SECRET` | No*      | —                  | HMAC secret for webhook validation   |
| `PAYMENT_METHOD`          | No       | `cod`              | WooCommerce payment method slug      |
| `PAYMENT_METHOD_TITLE`    | No       | `Cash on Delivery` | Payment method display title         |
| `PORT`                    | No       | `3000`             | Port the server listens on           |

\* If not set, signature validation is skipped (development mode only — always set in production).

---

## Deploy to Railway

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects Node.js.
4. Add all environment variables under **Variables** in the Railway dashboard.
5. Railway assigns a public URL — use it as your Chatbase webhook URL:
   ```
   https://<your-app>.railway.app/webhook/chatbase
   ```

### WP Engine IP Whitelist Note

If your WooCommerce store is hosted on **WP Engine**, you must whitelist Railway's outbound IP addresses so API calls from this middleware are not blocked. Find Railway's current egress IPs in your Railway project settings under **Networking**, then add them to WP Engine's **IP Allow List** under **Sites → [your site] → Security**.

---

## Webhook Payload (Chatbase → this middleware)

```json
{
  "billing": {
    "first_name": "Jane",
    "last_name":  "Doe",
    "email":      "jane@example.com",
    "phone":      "+1 555 000 0000",
    "address_1":  "123 Main St",
    "address_2":  "",
    "city":       "New York",
    "state":      "NY",
    "postcode":   "10001",
    "country":    "US"
  },
  "shipping": null,
  "items": [
    { "product_id": 42, "quantity": 2 },
    { "product_id": 87, "quantity": 1 }
  ],
  "note": "Please leave at the door"
}
```

- `shipping` is optional. If omitted or `null`, the billing address is used as the shipping address.
- `note` is optional.
- `product_id` values must come from the `/products` endpoint (never guessed).

---

## Chatbase System Prompt Template

Use this as the system prompt for your Chatbase agent:

```
You are a helpful shopping assistant for [Store Name]. Your job is to help customers place orders.

## Your workflow
1. Greet the customer and ask what they'd like to order.
2. Call GET /products to retrieve the current product catalog before confirming any order.
   Never assume product IDs — always use real IDs from /products.
3. Collect the following information from the customer:
   - First name and last name
   - Email address
   - Phone number
   - Delivery address (street, city, state/region, postcode, country)
   - Products and quantities they want
4. Confirm the order summary with the customer in plain language before submitting.
5. Submit the order via POST /webhook/chatbase using the exact payload format.

## Rules
- NEVER show raw JSON or API responses to the customer.
- NEVER invent or guess product IDs — always fetch them from /products first.
- If a product is out of stock, politely inform the customer and suggest alternatives.
- If the order fails due to stock issues, inform the customer clearly.
- Speak naturally and conversationally. Do not mention technical details like endpoints or webhooks.
- Always confirm the full order (items, quantities, address, total if available) before placing it.
```

---

## Security Features

- **Helmet** — sets secure HTTP response headers (CSP, HSTS, X-Frame-Options, etc.)
- **HMAC-SHA256 webhook signature** — validates every incoming webhook using `CHATBASE_WEBHOOK_SECRET`; uses `crypto.timingSafeEqual` to prevent timing attacks
- **Rate limiting** — 60 req/min globally, 20 req/min on the order endpoint
- **Body size limit** — `express.json({ limit: '10kb' })` prevents large payload attacks
- **Input validation & sanitization** — all fields are validated, trimmed, and capped at 500 chars before use
- **No stack traces in responses** — errors return generic messages; details are logged server-side only
- **Stock validation before order** — prevents placing orders for out-of-stock or low-stock items
