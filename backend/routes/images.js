const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { canDoAction, resetUsageIfNeeded } = require('../db');

// Genera imágenes con Pollinations.ai (gratis, sin API key necesaria)
router.post('/generate', auth, async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);

    if (!canDoAction(user, 'generateImage')) {
      return res.status(403).json({
        error: user.plan === 'free' ? 'La generación de imágenes requiere plan Pro o Ultra. Canjea un código en Planes.' : 'Has alcanzado tu límite de imágenes este mes.',
        upgradeRequired: true
      });
    }

    let { prompt, width, height } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Describe la imagen que quieres generar (mínimo 3 caracteres)' });
    }

    const cleanPrompt = prompt.trim().slice(0, 500);

    // Limitamos ancho/alto a valores razonables para evitar abuso
    const w = Math.min(Math.max(parseInt(width) || 1024, 256), 1440);
    const h = Math.min(Math.max(parseInt(height) || 1024, 256), 1440);

    // Seed aleatorio para que cada generación sea distinta aunque el prompt se repita
    const seed = Math.floor(Math.random() * 1_000_000_000);

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

    // Verificamos que la imagen realmente se generó antes de contarla como uso
    const check = await fetch(imageUrl, { method: 'GET' });
    if (!check.ok) {
      console.error('Pollinations respondió con error:', check.status);
      return res.status(502).json({ error: 'No se pudo generar la imagen. Intenta de nuevo.' });
    }

    user.usage.imagesGeneratedThisMonth = (user.usage.imagesGeneratedThisMonth || 0) + 1;

    res.json({
      imageUrl,
      prompt: cleanPrompt,
      remaining: user.usage.imagesGeneratedThisMonth
    });
  } catch (e) {
    console.error('Error generando imagen:', e.message);
    res.status(500).json({ error: 'Error interno al generar la imagen' });
  }
});

module.exports = router;
