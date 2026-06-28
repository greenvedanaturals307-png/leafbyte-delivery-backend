/* ─────────────────────────────────────────────────────────────
   LeafByte / GreenVeda Naturals — Delivery backend (Shiprocket)
   ─────────────────────────────────────────────────────────────
   This tiny server is the ONLY place your Shiprocket password lives.
   The website calls POST /api/create-order with the customer's cart +
   address; this server logs in to Shiprocket, creates the shipment,
   and returns the order id + AWB info back to the website.

   Run locally:   npm install  &&  npm start
   Config:        copy .env.example to .env and fill in your values.
   ───────────────────────────────────────────────────────────── */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());

// Only allow your own website to call this backend.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error('Origin not allowed: ' + origin));
  }
}));

const SR_BASE = 'https://apiv2.shiprocket.in/v1/external';

// ── Product catalog (keep prices in sync with the website) ──────
const PRODUCTS = {
  moringa:       { name: 'Moringa Leaf Powder',       price: 229, sku: 'LB-MOR-100',   weight: 0.12 }, // weight in kg
  morjee:        { name: 'Mor-Jee Powder',            price: 289, sku: 'LB-MJ-100',    weight: 0.12 },
  combo:         { name: 'Wellness Combo',            price: 499, sku: 'LB-COMBO',     weight: 0.25 },
  'moringa-combo': { name: 'Moringa Powder Combo (x2)', price: 399, sku: 'LB-MOR-2PK', weight: 0.25 },
  'morjee-combo':  { name: 'Mor-Jee Powder Combo (x2)', price: 499, sku: 'LB-MJ-2PK',  weight: 0.25 }
};
const FREE_SHIP_THRESHOLD = 499;
const SHIP_CHARGE = 59;

// ── Shiprocket auth token cache (token is valid for ~10 days) ───
let cachedToken = null;
let tokenExpiry = 0;

async function getShiprocketToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${SR_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD
    })
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error('Shiprocket login failed: ' + (data.message || JSON.stringify(data)));
  }
  cachedToken = data.token;
  tokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000; // refresh after 9 days
  return cachedToken;
}

// ── Helpers ─────────────────────────────────────────────────────
function isValidIndianPincode(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || '').trim());
}
function isValidPhone(p) {
  return /^[6-9]\d{9}$/.test(String(p || '').replace(/\D/g, '').slice(-10));
}

// ── Main endpoint: create a shipment ────────────────────────────
app.post('/api/create-order', async (req, res) => {
  try {
    const { customer = {}, items = [], paymentMethod = 'COD', firstTime = false } = req.body;

    // --- Validate customer ---
    const required = ['name', 'phone', 'address', 'city', 'state', 'pincode'];
    const missing = required.filter(f => !String(customer[f] || '').trim());
    if (missing.length) {
      return res.status(400).json({ error: 'Missing fields: ' + missing.join(', ') });
    }
    if (!isValidIndianPincode(customer.pincode)) {
      return res.status(400).json({ error: 'Invalid pincode.' });
    }
    if (!isValidPhone(customer.phone)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    // --- Build order items from the trusted server-side catalog ---
    // (We re-price on the server so a tampered cart can't change prices.)
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }
    let subTotal = 0;
    let totalWeight = 0;
    const orderItems = items.map(it => {
      const p = PRODUCTS[it.product];
      if (!p) throw new Error('Unknown product: ' + it.product);
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      subTotal += p.price * qty;
      totalWeight += p.weight * qty;
      return {
        name: p.name,
        sku: p.sku,
        units: qty,
        selling_price: p.price,
        discount: 0,
        tax: 0,
        hsn: 0
      };
    });

    const pm = paymentMethod === 'Prepaid' ? 'Prepaid' : 'COD';
    // First-time customers ship free; otherwise the normal free-over-₹499 rule applies.
    const shipping = (firstTime || subTotal >= FREE_SHIP_THRESHOLD) ? 0 : SHIP_CHARGE;
    const total = subTotal + shipping;

    // --- Build the Shiprocket "adhoc" order payload ---
    const nameParts = String(customer.name).trim().split(/\s+/);
    const orderPayload = {
      order_id: 'LB-' + Date.now(),
      order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
      channel_id: '',
      billing_customer_name: nameParts[0],
      billing_last_name: nameParts.slice(1).join(' ') || '.',
      billing_address: customer.address,
      billing_address_2: customer.address2 || '',
      billing_city: customer.city,
      billing_pincode: String(customer.pincode).trim(),
      billing_state: customer.state,
      billing_country: 'India',
      billing_email: customer.email || 'orders@leafbyte.com',
      billing_phone: String(customer.phone).replace(/\D/g, '').slice(-10),
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: pm,
      shipping_charges: shipping,
      total_discount: 0,
      sub_total: subTotal,
      length: 15,
      breadth: 12,
      height: 5,
      weight: Math.max(0.1, totalWeight) // kg
    };

    const token = await getShiprocketToken();
    const srRes = await fetch(`${SR_BASE}/orders/create/adhoc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });
    const srData = await srRes.json();

    if (!srRes.ok || srData.status_code === undefined && srData.order_id === undefined) {
      console.error('Shiprocket error:', srData);
      return res.status(502).json({ error: 'Courier rejected the order.', detail: srData });
    }

    return res.json({
      ok: true,
      orderId: orderPayload.order_id,
      shiprocketOrderId: srData.order_id,
      shipmentId: srData.shipment_id,
      status: srData.status,
      paymentMethod: pm,
      total
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ── Pincode serviceability check (optional, used by the website) ─
app.get('/api/check-pincode/:pincode', async (req, res) => {
  try {
    const pin = req.params.pincode;
    if (!isValidIndianPincode(pin)) {
      return res.status(400).json({ serviceable: false, error: 'Invalid pincode.' });
    }
    const token = await getShiprocketToken();
    const pickup = process.env.SHIPROCKET_PICKUP_PINCODE || '335063'; // Sangaria, Rajasthan
    const url = `${SR_BASE}/courier/serviceability/?pickup_postcode=${pickup}&delivery_postcode=${pin}&weight=0.2&cod=1`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    const couriers = d?.data?.available_courier_companies || [];
    if (!couriers.length) {
      return res.json({ serviceable: false, pincode: pin });
    }
    // pick the fastest estimated delivery
    const best = couriers.reduce((a, b) =>
      (parseFloat(a.estimated_delivery_days) || 99) <= (parseFloat(b.estimated_delivery_days) || 99) ? a : b
    );
    return res.json({
      serviceable: true,
      pincode: pin,
      etaDays: best.estimated_delivery_days,
      courier: best.courier_name,
      cod: best.cod === 1
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ serviceable: false, error: err.message });
  }
});

app.get('/', (_req, res) => res.send('LeafByte delivery backend is running ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LeafByte delivery backend listening on :${PORT}`));
