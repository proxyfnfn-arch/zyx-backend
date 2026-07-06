const express = require('express');
const router  = express.Router();
const { auth, adminOnly } = require('../middleware/auth');
const { findAllUsers, getChatsByUser, findUserById } = require('../db');

router.use(auth, adminOnly);

router.get('/stats', (req, res) => {
  const all = findAllUsers();
  res.json({ stats: {
    totalUsers:  all.length,
    activeUsers: all.filter(u => u.isActive).length,
    freeUsers:   all.filter(u => u.plan === 'free').length,
    proUsers:    all.filter(u => u.plan === 'pro').length,
    ultraUsers:  all.filter(u => u.plan === 'ultra').length,
    estimatedRevenue: (all.filter(u=>u.plan==='pro').length * 9.99 + all.filter(u=>u.plan==='ultra').length * 24.99).toFixed(2)
  }});
});

router.get('/users', (req, res) => {
  const { search, plan } = req.query;
  let list = findAllUsers();
  if (search) list = list.filter(u => u.email.includes(search) || u.username.includes(search));
  if (plan)   list = list.filter(u => u.plan === plan);
  res.json({ users: list.map(u => { const {password,...s}=u; return s; }), total: list.length });
});

router.patch('/users/:id/plan', (req, res) => {
  const { plan } = req.body;
  if (!['free','pro','ultra'].includes(plan)) return res.status(400).json({ error: 'Plan inválido' });
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.plan = plan;
  res.json({ message: `Plan cambiado a ${plan}` });
});

router.patch('/users/:id/status', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes modificarte a ti mismo' });
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  user.isActive = req.body.isActive;
  res.json({ message: user.isActive ? 'Activado' : 'Suspendido' });
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'No encontrado' });
  user.isActive = false; // soft delete en memoria
  res.json({ message: 'Usuario eliminado' });
});

module.exports = router;
