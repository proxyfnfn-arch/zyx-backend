const express = require('express');
const router  = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const { findUserById } = require('../db');

// Códigos en memoria: Map<code, { plan, used, usedBy, createdAt }>
const codes = new Map();

// Genera código aleatorio tipo ZYX-XXXX-XXXX-XXXX
function genCode(plan) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `${plan.toUpperCase()}-${seg()}-${seg()}-${seg()}`;
}

// Pre-genera 200 códigos de cada plan al arrancar
function initCodes() {
  if (codes.size > 0) return;
  for (let i = 0; i < 200; i++) {
    const c = genCode('pro');
    codes.set(c, { plan: 'pro', used: false, usedBy: null, createdAt: new Date() });
  }
  for (let i = 0; i < 200; i++) {
    const c = genCode('ultra');
    codes.set(c, { plan: 'ultra', used: false, usedBy: null, createdAt: new Date() });
  }
  console.log(`✅ ${codes.size} códigos de canje generados`);
}

// POST /api/redeem  { code }
router.post('/', auth, (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Código requerido' });

  const entry = codes.get(code);
  if (!entry)       return res.status(400).json({ error: 'Código inválido. Comprueba que está bien escrito.' });
  if (entry.used)   return res.status(400).json({ error: 'Este código ya ha sido canjeado.' });

  const user = findUserById(req.user.id);
  if (user.plan === entry.plan) return res.status(400).json({ error: `Ya tienes el plan ${entry.plan.toUpperCase()} activo.` });

  // Activar plan
  entry.used   = true;
  entry.usedBy = req.user.id;
  entry.usedAt = new Date();

  user.plan = entry.plan;
  const exp = new Date();
  exp.setDate(exp.getDate() + 30);
  user.planExpiresAt = exp;

  res.json({
    message: `✅ Plan ${entry.plan.toUpperCase()} activado correctamente. Válido 30 días.`,
    plan: entry.plan,
    expiresAt: user.planExpiresAt
  });
});

// GET /api/redeem/export  (solo admin — devuelve todos los códigos)
router.get('/export', auth, adminOnly, (req, res) => {
  const all = Array.from(codes.entries()).map(([code, v]) => ({
    code, plan: v.plan, used: v.used, usedBy: v.usedBy, usedAt: v.usedAt || null
  }));
  res.json({ codes: all, total: all.length });
});

module.exports = { router, initCodes, codes };
