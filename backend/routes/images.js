const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { canDoAction, resetUsageIfNeeded } = require('../db');

router.post('/generate', auth, (req, res) => {
  const user = req.user;
  resetUsageIfNeeded(user);
  if (!canDoAction(user, 'generateImage')) {
    return res.status(403).json({
      error: user.plan === 'free' ? 'La generación de imágenes requiere plan Pro o Ultra. Canjea un código en Planes.' : 'Has alcanzado tu límite de imágenes este mes.',
      upgradeRequired: true
    });
  }
  res.status(503).json({ error: 'Generación de imágenes próximamente.' });
});

module.exports = router;
