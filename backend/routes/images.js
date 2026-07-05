const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { canDoAction, resetUsageIfNeeded } = require('../db');

// Groq no tiene generación de imágenes — informamos al usuario
router.post('/generate', auth, (req, res) => {
  const user = req.user;
  resetUsageIfNeeded(user);
  if (user.plan === 'free') {
    return res.status(403).json({
      error: 'La generación de imágenes no está disponible en esta versión. Upgrade a Pro para activarla.',
      upgradeRequired: true
    });
  }
  res.status(503).json({ error: 'Generación de imágenes próximamente disponible.' });
});

module.exports = router;
