# LeafByte Delivery Backend (Shiprocket)

This little server connects your website to **Shiprocket** so that when a
customer checks out, a shipment is created automatically. It exists because a
courier API password can **never** live inside your public `simple2.html` /
`index.html` file — anyone could view the page source and steal it.

```
Website (checkout form)  ──POST address+cart──▶  THIS backend  ──▶  Shiprocket API
        ◀────────────── order id / status ───────────────────────
```

---

## 1. One-time setup

### a) Create a Shiprocket account (free)
1. Sign up at <https://www.shiprocket.in>.
2. Add your **pickup address** under **Settings → Pickup Addresses**. Note the
   nickname (Shiprocket calls the first one `Primary`).
3. Go to **Settings → API → Configure** and create an **API user**
   (a dedicated email + password just for this integration). Use those
   credentials below — not your main login.

### b) Install Node.js
Download the LTS version from <https://nodejs.org> (Windows installer).

### c) Configure
1. In this `delivery-backend` folder, copy `.env.example` to `.env`.
2. Fill in `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, your pickup location
   nickname and pickup PIN code.

### d) Install & run
Open a terminal in this folder:
```bash
npm install
npm start
```
You should see `LeafByte delivery backend listening on :3000`.
Visit <http://localhost:3000> — it should say the backend is running.

---

## 2. Point the website at the backend

In `simple2.html` (and `index.html`), near the top of the `<script>` there is:
```js
const DELIVERY_API = 'http://localhost:3000';
```
- While testing locally, leave it as `http://localhost:3000`.
- Once you deploy the backend (step 3), change it to your live backend URL,
  e.g. `https://leafbyte-delivery.onrender.com`.

---

## 3. Deploy the backend (so it works on the live site)

`localhost` only works on your own computer. To make checkout work for real
customers, host this folder on any Node host. Easiest free options:

| Host | How |
|------|-----|
| **Render.com** | New → Web Service → connect repo/folder → Build `npm install`, Start `npm start`. Add the `.env` values under *Environment*. |
| **Railway.app** | New Project → Deploy → add env vars. |
| **Vercel** | Works too, but needs the code adapted to a serverless function — ask and I'll convert it. |

After deploying:
1. Set `ALLOWED_ORIGINS` to your real website origin (e.g. `https://leafbyte.com`).
2. Update `DELIVERY_API` in the HTML to the deployed URL.

---

## 4. Test the whole flow
1. Backend running (local or deployed).
2. Open the website, add items, click **Proceed to Checkout**.
3. Fill the address form, choose COD or Prepaid, submit.
4. A new order appears in your **Shiprocket dashboard → Orders**, ready to
   assign a courier and print the label.

---

## Endpoints (for reference)
- `POST /api/create-order` — body `{ customer, items, paymentMethod }`. Creates the shipment.
- `GET  /api/check-pincode/:pincode` — returns serviceability + delivery ETA (used by the pincode checker).

## Notes
- Prices and weights live in `server.js` (`PRODUCTS`). Keep them in sync with the
  website so a tampered cart can't change prices — the server always re-prices.
- This handles **order creation**. Assigning the courier + generating the AWB can
  be done in the Shiprocket dashboard, or automated later — ask if you want that.
