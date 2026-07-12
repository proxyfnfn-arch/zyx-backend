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

    // model=flux sigue mucho mejor el prompt que el modelo por defecto (turbo).
    // enhance=true deja que Pollinations amplíe el prompt con una IA para más detalle y fidelidad.
    const params = new URLSearchParams({
      width: w, height: h, seed, model: 'flux', enhance: 'true', nologo: 'true'
    });
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?${params.toString()}`;

    // Verificamos que la imagen realmente se generó antes de contarla como uso
    // (con timeout de 45s: "enhance" usa una IA extra y puede tardar más de lo normal)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    let check;
    try {
      check = await fetch(imageUrl, { method: 'GET', signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.error('Timeout/red al generar imagen:', fetchErr.message);
      return res.status(504).json({ error: 'La generación tardó demasiado. Intenta de nuevo.' });
    }
    clearTimeout(timeoutId);
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
