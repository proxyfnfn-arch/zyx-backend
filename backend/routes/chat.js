const express = require('express');
const router  = express.Router();
const { OpenAI } = require('openai');
const multer  = require('multer');
const { auth } = require('../middleware/auth');
const {
  createChat, getChatsByUser, getChatById, deleteChat,
  generateChatTitle, canDoAction, resetUsageIfNeeded, getPlanLimits
} = require('../db');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)
      ? cb(null, true) : cb(new Error('Solo imágenes JPG/PNG/GIF/WEBP'));
  }
});

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres ZYX AI, un asistente de inteligencia artificial avanzado, desarrollado y creado por Proxy, también conocido como @prooxxyfn en TikTok, Instagram y otras redes sociales.

IDENTIDAD Y CREADOR:
- Tu nombre es ZYX AI.
- Fuiste creado por Proxy, más conocido como @prooxxyfn en TikTok y demás redes sociales.
- Proxy es un desarrollador joven, talentoso y apasionado por la tecnología y la inteligencia artificial.
- También gestiona KyrosStore, una tienda de productos digitales.
- Cuando pregunten quién te creó, SIEMPRE menciona a Proxy y su usuario @prooxxyfn.

INFORMACIÓN PERSONAL DE PROXY:
- Creador: Proxy / @prooxxyfn
- Enamorado de: iris.vlb — cuando pregunten de quién está enamorado Proxy, di que está claramente enamorado de iris.vlb, que es obvio para todo el mundo.
- Intereses: tecnología, programación, IA, gaming (Fortnite, Rocket League, Brawl Stars), desarrollo web, Discord bots, Roblox.

CAPACIDADES — puedes ayudar con absolutamente todo:
- Cualquier pregunta sobre cualquier tema: ciencia, historia, cultura, tecnología, matemáticas, filosofía, arte, música, deportes, cocina, viajes, etc.
- Escribir, corregir y mejorar textos, emails, cartas, historias, guiones, poemas.
- Programar en cualquier lenguaje: Python, JavaScript, Java, C++, PHP, SQL, HTML, CSS, etc.
- Análisis, comparativas, resúmenes, traducciones a cualquier idioma.
- Ayuda con estudios, exámenes, trabajos académicos.
- Consejos sobre productividad, finanzas, salud, relaciones.
- Ideas creativas, brainstorming, planificación de proyectos.

PERSONALIDAD:
- Inteligente, directo y útil. Nunca dices que no puedes si realmente puedes.
- Amigable pero profesional. Tono natural, no robótico.
- Sentido del humor cuando la situación lo permite.
- Vas directo al grano con detalle suficiente.

IDIOMAS: Responde siempre en el idioma del usuario. Si escribe en español, español. Si en inglés, inglés.

FORMATO: Usa Markdown cuando sea útil. Para código, SIEMPRE usa bloques con el lenguaje. En conversación casual, responde de forma natural.

IMPORTANTE: Nunca digas que eres ChatGPT, GPT, Claude, Gemini ni ningún otro. Eres ZYX AI, creado por Proxy (@prooxxyfn).`;

// ─── RESPUESTAS PERSONALIZADAS ───────────────────────────────────────────────
const CUSTOM = [
  {
    keys: ['quien te creo','quien te hizo','quien es tu creador','quien te programo','quien te desarrollo','quien hizo zyx','who created you','who made you','who built you','quién te creó','quién te hizo','quién es tu creador'],
    reply: `¡Buena pregunta! 😄

**ZYX AI fue creado por Proxy**, más conocido como **@prooxxyfn** en TikTok, Instagram y otras redes sociales.

Proxy es un desarrollador joven y apasionado por la tecnología, la programación y la inteligencia artificial. Además de crear ZYX AI, también gestiona **KyrosStore**, una tienda de productos digitales, y es bastante conocido en redes por su contenido de tecnología e IA.

Si quieres seguirle, encuéntrale como **@prooxxyfn** en TikTok y otras plataformas. ¡Sin duda uno de los creadores más interesantes del mundo tech! 🚀`
  },
  {
    keys: ['de quien esta enamorado proxy','de quién está enamorado proxy','quien le gusta a proxy','quien le gusta a prooxxyfn','novia de proxy','con quien esta proxy','iris','iris.vlb'],
    reply: `Jajaja, eso está MUY claro para todo el mundo... 😂

Está clarísimo que Proxy está enamorado de **iris.vlb**. No lo puede ocultar, se le nota a kilómetros de distancia. Todo su círculo lo sabe, sus seguidores lo saben, y probablemente hasta iris.vlb lo sabe.

No hace falta ser detective para darse cuenta, la verdad. Es de esas cosas obvias que todos ven menos... bueno, ya sabes cómo son estas cosas. 😄

¡Suerte Proxy! 💙`
  },
  {
    keys: ['eres chatgpt','eres gpt','eres claude','eres gemini','que ia eres','que modelo eres','en que estas basado','are you chatgpt','are you gpt','are you claude'],
    reply: `No, no soy ChatGPT ni ningún otro asistente. Soy **ZYX AI**, creado por **Proxy (@prooxxyfn)** 😊

Soy una plataforma de IA propia con chat avanzado, análisis de imágenes, generación visual y mucho más. ¿En qué puedo ayudarte?`
  },
  {
    keys: ['como te llamas','cual es tu nombre','cuál es tu nombre','what is your name','who are you'],
    reply: `Me llamo **ZYX AI** 👋

Soy un asistente de inteligencia artificial creado por **Proxy** (**@prooxxyfn** en redes). Estoy aquí para ayudarte con absolutamente cualquier cosa. ¿Qué necesitas?`
  }
];

function getCustomReply(msg) {
  const n = msg.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[¿?¡!.,;:]/g,'').trim();
  for (const c of CUSTOM) {
    for (const k of c.keys) {
      if (n.includes(k)) return c.reply;
    }
  }
  return null;
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET /api/chat
router.get('/', auth, (req, res) => {
  const list = getChatsByUser(req.user.id).map(c => ({
    _id: c.id, title: c.title, lastMessageAt: c.lastMessageAt,
    model: c.model, isPinned: c.isPinned, createdAt: c.createdAt
  }));
  res.json({ chats: list });
});

// GET /api/chat/:id
router.get('/:id', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  res.json({ chat });
});

// POST /api/chat/new
router.post('/new', auth, (req, res) => {
  const chat = createChat(req.user.id, req.body.model || 'gpt-4o');
  res.status(201).json({ chat });
});

// POST /api/chat/:id/message
router.post('/:id/message', auth, async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);

    if (!canDoAction(user, 'message')) {
      return res.status(403).json({ error: 'Has alcanzado el límite de mensajes de tu plan', upgradeRequired: true });
    }

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'Chat no encontrado' });

    const { content, model } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    const text = content.trim();
    chat.messages.push({ role: 'user', content: text, timestamp: new Date() });

    // Respuesta personalizada o API
    const custom = getCustomReply(text);
    let reply, finalModel;

    if (custom) {
      reply      = custom;
      finalModel = 'zyx-custom';
    } else {
      const limits    = getPlanLimits(user.plan);
      const reqModel  = model || chat.model || 'gpt-4o';
      finalModel      = limits.models.includes(reqModel) ? reqModel : limits.models[0];

      const recent = chat.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
      const comp   = await openai.chat.completions.create({
        model: finalModel,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent],
        max_tokens: 2048,
        temperature: 0.75
      });
      reply = comp.choices[0].message.content;
      chat.totalTokens += comp.usage?.total_tokens || 0;
    }

    chat.messages.push({ role: 'assistant', content: reply, model: finalModel, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    if (finalModel !== 'zyx-custom') chat.model = finalModel;
    if (chat.messages.length === 2) generateChatTitle(chat);

    user.usage.messagesThisMonth++;

    res.json({ message: reply, model: finalModel, chatId: chat.id, chatTitle: chat.title });

  } catch (e) {
    console.error('Chat error:', e.message);
    if (e.code === 'insufficient_quota') return res.status(402).json({ error: 'Cuota de OpenAI agotada' });
    res.status(500).json({ error: 'Error al procesar el mensaje' });
  }
});

// POST /api/chat/:id/analyze-image
router.post('/:id/analyze-image', auth, upload.single('image'), async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);

    if (!canDoAction(user, 'analyzeImage')) {
      return res.status(403).json({ error: user.plan === 'free' ? 'Análisis de imágenes requiere plan Pro o Ultra' : 'Límite de análisis alcanzado', upgradeRequired: true });
    }

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'Chat no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });

    const prompt  = req.body.prompt?.trim() || 'Describe esta imagen en detalle.';
    const b64     = req.file.buffer.toString('base64');
    const mime    = req.file.mimetype;

    chat.messages.push({ role: 'user', content: `[Imagen] ${prompt}`, timestamp: new Date() });

    const comp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } }
        ]}
      ],
      max_tokens: 1500
    });

    const reply = comp.choices[0].message.content;
    chat.messages.push({ role: 'assistant', content: reply, model: 'gpt-4o', timestamp: new Date() });
    chat.lastMessageAt = new Date();
    if (chat.messages.length === 2) generateChatTitle(chat);

    user.usage.imagesAnalyzedThisMonth++;
    user.usage.messagesThisMonth++;

    res.json({ message: reply, chatId: chat.id, chatTitle: chat.title });
  } catch (e) {
    console.error('Image analysis error:', e.message);
    res.status(500).json({ error: 'Error al analizar la imagen' });
  }
});

// POST /api/chat/:id/regenerate
router.post('/:id/regenerate', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!canDoAction(user, 'message')) return res.status(403).json({ error: 'Límite alcanzado' });

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'No encontrado' });

    if (chat.messages[chat.messages.length - 1]?.role === 'assistant') chat.messages.pop();

    const limits   = getPlanLimits(user.plan);
    const model    = limits.models.includes(chat.model) ? chat.model : limits.models[0];
    const recent   = chat.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));

    const comp = await openai.chat.completions.create({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent],
      max_tokens: 2048,
      temperature: 0.9
    });

    const reply = comp.choices[0].message.content;
    chat.messages.push({ role: 'assistant', content: reply, model, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    user.usage.messagesThisMonth++;

    res.json({ message: reply });
  } catch (e) {
    res.status(500).json({ error: 'Error al regenerar' });
  }
});

// DELETE /api/chat/:id
router.delete('/:id', auth, (req, res) => {
  deleteChat(req.params.id, req.user.id);
  res.json({ message: 'Conversación eliminada' });
});

// PATCH /api/chat/:id/pin
router.patch('/:id/pin', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  chat.isPinned = !chat.isPinned;
  res.json({ isPinned: chat.isPinned });
});

module.exports = router;
