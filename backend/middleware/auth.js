const jwt = require('jsonwebtoken');
const { findUserById } = require('../db');
async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = findUserById(payload.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: 'No autenticado' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso solo para administradores' });
  }
  next();
}
module.exports = { auth, adminOnly };
