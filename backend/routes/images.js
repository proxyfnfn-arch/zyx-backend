const express = require('express');
const router  = express.Router();
const { OpenAI } = require('openai');
const { auth } = require('../middleware/auth');
const { canDoAction, resetUsageIfNeeded } = require('../db');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/generate', auth, async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);

    if (!canDoAction(user, 'generateImage')) {
      return res.status(403).json({
        error: user.plan === 'free' ? 'Generación de imágenes requiere plan Pro o Ultra' : 'Límite de imágenes alcanzado',
        upgradeRequired: true
      });
    }

    const { prompt, size = '1024x1024', style = 'vivid', quality = 'standard' } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt requerido' });

    const validSizes = ['1024x1024','1792x1024','1024x1792'];
    const finalSize  = validSizes.includes(size) ? size : '1024x1024';
    const finalQuality = quality === 'hd' && user.plan === 'ultra' ? 'hd' : 'standard';

    const resp = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt.trim(),
      n: 1,
      size: finalSize,
      style: style === 'natural' ? 'natural' : 'vivid',
      quality: finalQuality
    });

    user.usage.imagesGeneratedThisMonth++;

    res.json({
      imageUrl: resp.data[0].url,
      revisedPrompt: resp.data[0].revised_prompt,
      size: finalSize
    });
  } catch (e) {
    console.error('Image gen error:', e.message);
    if (e.code === 'content_policy_violation') return res.status(400).json({ error: 'El prompt viola las políticas de contenido' });
    res.status(500).json({ error: 'Error al generar la imagen' });
  }
});

module.exports = router;
