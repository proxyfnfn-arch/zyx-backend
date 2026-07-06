const jwt = require('jsonwebtoken');
const { findUserById } = require('../db');

const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = findUserById(decoded.userId);
    if (!user || !user.isActive) return res.status(401).json({ error: 'Usuario no válido' });

    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

module.exports = { auth, adminOnly };
