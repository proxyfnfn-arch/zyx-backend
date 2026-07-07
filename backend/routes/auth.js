const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const fetch    = require('node-fetch');
const {
  createUser, findUserByEmail, findUserByIdentifier, findUserById,
  comparePassword, resetUsageIfNeeded, safeUser,
  updateUser, getPlanLimits,
  findUserByGoogleId, createGoogleUser, linkGoogleAccount
} = require('../db');
const { auth } = require('../middleware/auth');

const sign = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ── CONFIG GOOGLE OAUTH ─────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL;
const FRONTEND_URL         = process.env.FRONTEND_URL || 'http://localhost:5500';

router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) {
    return res.status(500).send('Google OAuth no esta configurado en el servidor (faltan variables de entorno).');
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`${FRONTEND_URL}/login.html?error=${encodeURIComponent('No se pudo iniciar sesion con Google')}`);
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Error al obtener token de Google:', tokenData);
      return res.redirect(`${FRONTEND_URL}/login.html?error=${encodeURIComponent('Fallo la autenticacion con Google')}`);
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    if (!profile || !profile.sub || !profile.email) {
      return res.redirect(`${FRONTEND_URL}/login.html?error=${encodeURIComponent('No se pudo obtener el perfil de Google')}`);
    }

    const googleId = profile.sub;
    const email     = profile.email;
    const name      = profile.name || '';
    const avatar    = profile.picture || null;

    let user = findUserByGoogleId(googleId);

    if (!user) {
      const existingByEmail = findUserByEmail(email);
      if (existingByEmail) {
        user = linkGoogleAccount(existingByEmail, googleId, avatar);
      } else {
        user = await createGoogleUser({ email, name, googleId, avatar });
      }
    }

    if (!user.isActive) {
      return res.redirect(`${FRONTEND_URL}/login.html?error=${encodeURIComponent('Esta cuenta esta deshabilitada')}`);
    }

    user.lastLoginAt = new Date();

    const token = sign(user.id);
    const safePayload = {
      id: user.id,
      email: user.email,
      username: user.username,
      plan: user.plan,
      role: user.role,
      usage: user.usage
    };

    const redirectParams = new URLSearchParams({
      token,
      user: JSON.stringify(safePayload)
    });

    res.redirect(`${FRONTEND_URL}/auth-callback.html?${redirectParams.toString()}`);
  } catch (e) {
    console.error('Error en Google OAuth callback:', e);
    res.redirect(`${FRONTEND_URL}/login.html?error=${encodeURIComponent('Error interno al iniciar sesion con Google')}`);
  }
});

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
    // Aceptamos "identifier" (nuevo) o "email" (compatibilidad con versiones anteriores del frontend)
    const identifier = req.body.identifier || req.body.email || req.body.username;
    const { password } = req.body;
    if (!identifier || !password) return res.status(400).json({ error: 'Usuario/email y contraseña requeridos' });

    const user = findUserByIdentifier(identifier);
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
