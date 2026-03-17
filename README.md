# wc-chatbase-middleware

Express middleware that receives orders from a Chatbase chatbot and creates WooCommerce orders via the REST API. The customer's free-text order is stored as a `customer_note`; staff fulfil from there.

---

## Endpoints

| Method | Path            | Description                              |
|--------|-----------------|------------------------------------------|
| GET    | `/health`       | Health check — returns `{ status, timestamp }` |
| POST   | `/create-order` | Create a WooCommerce order from chat     |

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
# Edit .env with your credentials

# 4. Start the server
npm start       # production
npm run dev     # development (nodemon)
```

---

## Environment Variables

| Variable      | Required | Description                          |
|---------------|----------|--------------------------------------|
| `WC_URL`      | Yes      | WooCommerce store URL                |
| `WC_KEY`      | Yes      | WooCommerce consumer key             |
| `WC_SECRET`   | Yes      | WooCommerce consumer secret          |
| `API_KEY`     | Yes      | Secret key checked via `x-api-key` header |
| `APP_URL`     | No       | Public URL of this app (for reference) |
| `STORE_NAME`  | No       | Store name (used in Chatbase prompt) |
| `PORT`        | No       | Port the server listens on (default: 3000) |

---

## POST /create-order

### Auth

Pass your `API_KEY` in the request header:

```
x-api-key: your-secret-api-key-here
```

### Request payload

```json
{
  "billing": {
    "first_name": "John",
    "last_name":  "Smith",
    "email":      "john@example.com",
    "phone":      "+385911234567",
    "address_1":  "123 Main Street",
    "city":       "Zagreb",
    "postcode":   "10000",
    "country":    "HR"
  },
  "order_note": "2 burgers and a large coffee please"
}
```

### Success response `201`

```json
{
  "success": true,
  "order_id": 1042,
  "order_number": "1042"
}
```

---

## Deploy to Railway

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects Node.js.
4. Add all environment variables under **Variables** in the Railway dashboard.
5. Your public URL will be something like `https://your-app.railway.app`.

### WP Engine IP Whitelist Note

If your WooCommerce store is hosted on **WP Engine**, whitelist Railway's outbound IPs so API calls are not blocked. Find the IPs in your Railway project under **Networking → Egress IPs**, then add them in WP Engine under **Sites → [your site] → Security → IP Allow List**.

---

## Chatbase Tool Configuration

In Chatbase, create a tool with these settings:

| Setting     | Value                                              |
|-------------|----------------------------------------------------|
| Name        | `create_order`                                     |
| Method      | `POST`                                             |
| URL         | `https://your-app.railway.app/create-order`        |
| Header      | `x-api-key` = *(your `API_KEY` value)*             |

**Parameters to include:**

- `billing` — object with: `first_name`, `last_name`, `email`, `phone`, `address_1`, `city`, `postcode`, `country`
- `order_note` — string, the customer's free-text order

---

## Chatbase System Prompt Template

```
You are a friendly order assistant for [Store Name].

Collect the following from the customer one at a time:
- First name and last name
- Email address
- Phone number
- Delivery address (street, city, postcode, country)
- What they want to order

Once all details are collected, read the full order back to the customer
and ask them to confirm.

Only when they confirm, call create_order with their details.
Tell them their order number once the order is placed.

Never show JSON or technical details to the customer.
Never place an order without explicit confirmation from the customer.
```

---

## Security Features

- **Helmet** — secure HTTP response headers (CSP, HSTS, X-Frame-Options, etc.)
- **API key auth** — every request to `/create-order` must include the correct `x-api-key` header
- **Rate limiting** — 60 req/min globally, 20 req/min on the order endpoint
- **Body size limit** — `express.json({ limit: '10kb' })` prevents oversized payloads
- **Input validation & sanitization** — all fields validated, trimmed, and capped at 500 chars
- **No stack traces in responses** — errors return generic messages; details logged server-side only
