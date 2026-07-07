const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const {
  createUser, findUserByEmail, findUserByUsername, findUserById,
  comparePassword, resetUsageIfNeeded, safeUser,
  updateUser, getPlanLimits
} = require('../db');
const { auth } = require('../middleware/auth');

const sign = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

    const role = email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase() ? 'admin' : 'user';
    const user = await createUser({ email, username, password, role });
    if (role === 'admin') user.plan = 'ultra';

    res.status(201).json({
      token: sign(user.id),
      user: { id: user.id, email: user.email, username: user.username, plan: user.plan, role: user.role }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;  // 'email' field accepts both email and username
    if (!email || !password) return res.status(400).json({ error: 'Email/usuario y contraseña requeridos' });

    // Try email first, then username
    const isEmailFormat = email.includes('@');
    const user = isEmailFormat ? findUserByEmail(email) : (findUserByUsername(email) || findUserByEmail(email));
    if (!user || !user.isActive) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const ok = await comparePassword(user, password);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

    user.lastLoginAt = new Date();

    res.json({
      token: sign(user.id),
      user: { id: user.id, email: user.email, username: user.username, plan: user.plan, role: user.role, usage: user.usage }
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  const user = req.user;
  resetUsageIfNeeded(user);
  res.json({ user: safeUser(user) });
});

// PUT /api/auth/profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const user = req.user;

    if (username && username !== user.username) {
      user.username = username;
    }

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Contraseña actual requerida' });
      const ok = await comparePassword(user, currentPassword);
      if (!ok) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
      user.password = await bcrypt.hash(newPassword, 12);
    }

    res.json({ message: 'Perfil actualizado' });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

module.exports = router;
