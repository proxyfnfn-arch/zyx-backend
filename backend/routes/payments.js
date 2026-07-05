const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');
const { auth } = require('../middleware/auth');
const { findUserById } = require('../db');

const PLANS = {
  pro:   { name: 'ZYX AI Pro',   price: '9.99',  currency: 'EUR', days: 30 },
  ultra: { name: 'ZYX AI Ultra', price: '24.99', currency: 'EUR', days: 30 }
};

const BASE = () => process.env.PAYPAL_MODE === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getToken() {
  const r = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  return (await r.json()).access_token;
}

router.get('/plans', (_, res) => res.json({ plans: PLANS }));

router.post('/create-order', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Plan inválido' });
    const p = PLANS[plan];
    const token = await getToken();
    const r = await fetch(`${BASE()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: p.currency, value: p.price },
          custom_id: `${req.user.id}:${plan}`,
          soft_descriptor: 'ZYX AI'
        }],
        application_context: {
          brand_name: 'ZYX AI',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${process.env.FRONTEND_URL}/payment-success.html`,
          cancel_url:  `${process.env.FRONTEND_URL}/pricing.html`
        }
      })
    });
    const order = await r.json();
    res.json({ orderId: order.id, approvalUrl: order.links?.find(l => l.rel === 'approve')?.href });
  } catch (e) {
    res.status(500).json({ error: 'Error creando orden PayPal' });
  }
});

router.post('/capture-order', auth, async (req, res) => {
  try {
    const { orderId } = req.body;
    const token = await getToken();
    const r = await fetch(`${BASE()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const cap = await r.json();
    if (cap.status !== 'COMPLETED') return res.status(400).json({ error: 'Pago no completado' });

    const customId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id || '';
    const [userId, plan] = customId.split(':');
    if (userId !== req.user.id) return res.status(403).json({ error: 'Error de verificación' });

    const user = findUserById(req.user.id);
    user.plan = plan;
    const exp = new Date(); exp.setDate(exp.getDate() + PLANS[plan].days);
    user.planExpiresAt = exp;

    res.json({ message: `Plan ${plan.toUpperCase()} activado`, plan, expiresAt: exp });
  } catch (e) {
    res.status(500).json({ error: 'Error capturando pago' });
  }
});

module.exports = router;
