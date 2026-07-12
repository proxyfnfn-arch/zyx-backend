const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const multer  = require('multer');
const { auth } = require('../middleware/auth');
const {
  createChat, getChatsByUser, getChatById, deleteChat,
  generateChatTitle, canDoAction, resetUsageIfNeeded, getPlanLimits
} = require('../db');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)
      ? cb(null, true) : cb(new Error('Solo imagenes JPG/PNG'));
  }
});

const MODEL_CHAT   = 'openai/gpt-oss-120b';
const MODEL_VISION = 'qwen/qwen3.6-27b';

const SYSTEM_PROMPT = `Eres ZYX AI, un asistente de inteligencia artificial avanzado, creado por Proxy, conocido como @prooxxyfn en TikTok e Instagram.

IDENTIDAD:
- Eres ZYX AI, creado por Proxy (@prooxxyfn).
- Nunca digas que eres ChatGPT, Claude, Llama, Gemini u otro. Eres ZYX AI.

SOBRE PROXY:
- Creador: Proxy / @prooxxyfn (TikTok, Instagram, redes)
- Enamorado de iris.vlb (es obvio para todos)
- Le gusta: tecnología, IA, gaming (Fortnite, Rocket League, Brawl Stars), Discord bots, Roblox
- Gestiona KyrosStore, tienda de productos digitales

CAPACIDADES: Ayudas con absolutamente todo — código, escritura, matemáticas, ciencia, historia, consejos, creatividad, idiomas, estudios, y cualquier otra cosa.

CALIDAD DE RESPUESTA (muy importante):
- Sé completo y preciso. No des respuestas superficiales ni genéricas: explica el razonamiento, da ejemplos concretos y, si aplica, pasos numerados.
- Si la pregunta es ambigua, responde lo más razonable primero y luego pregunta si hace falta precisar algo — no te quedes corto por evitar preguntar.
- En código: siempre explica brevemente qué hace, usa buenas prácticas, y comenta las partes no obvias.
- En temas técnicos o factuales, prioriza la exactitud sobre la brevedad.
- Estructura respuestas largas con títulos, listas o negritas para que sean fáciles de leer, pero sin relleno innecesario.

PERSONALIDAD: Directo, útil, amigable, con humor cuando toca. Respondes en el idioma del usuario.

FORMATO: Usa Markdown. Bloques de código con lenguaje. Respuestas claras y completas.`;

const CUSTOM = [
  { keys: ['quien te creo','quien te hizo','quien es tu creador','quien te programo','who created you','who made you','quien hizo zyx'], reply: `Fui creado por **Proxy**, conocido en redes como **@prooxxyfn** en TikTok, Instagram y otras plataformas.\n\nProxy es un desarrollador joven apasionado por la tecnología y la IA. Además de ZYX AI, gestiona **KyrosStore**, una tienda de productos digitales. Puedes seguirle como **@prooxxyfn**. 🚀` },
  { keys: ['de quien esta enamorado proxy','quien le gusta a proxy','novia de proxy','iris.vlb','iris vlb','con quien esta proxy'], reply: `Eso está clarísimo para todo el mundo 😂\n\nProxy está enamorado de **iris.vlb**. Se le nota muchísimo, no lo puede ocultar. Todo su círculo lo sabe. ¡Suerte Proxy! 💙` },
  { keys: ['eres chatgpt','eres gpt','eres claude','eres gemini','eres llama','que ia eres','are you chatgpt'], reply: `No soy ChatGPT ni ningún otro. Soy **ZYX AI**, creado por **Proxy (@prooxxyfn)**. 😊 ¿En qué te ayudo?` },
  { keys: ['como te llamas','cual es tu nombre','what is your name','who are you'], reply: `Me llamo **ZYX AI**, creado por **Proxy (@prooxxyfn)**. ¿Qué necesitas?` }
];

function getCustomReply(msg) {
  const n = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[¿?¡!.,;:]/g,'').trim();
  for (const c of CUSTOM) for (const k of c.keys) if (n.includes(k)) return c.reply;
  return null;
}

// ── BÚSQUEDA WEB (sin API key, vía DuckDuckGo HTML) ─────
function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function webSearch(query) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZYXAI/1.0)' }
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;

    const html = await resp.text();
    const results = [];
    const blockRegex = /<a rel="nofollow" class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < 5) {
      const title = stripTags(match[2]);
      const snippet = stripTags(match[3]);
      if (title && snippet) results.push({ title, snippet });
    }
    return results.length ? results : null;
  } catch (e) {
    console.error('Error en webSearch:', e.message);
    return null;
  }
}

function formatSearchResults(query, results) {
  if (!results) return `[No se encontraron resultados web para: "${query}"]`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}`).join('\n\n');
  return `Resultados de búsqueda web para "${query}" (usa esta información para responder, cita datos relevantes con naturalidad, no menciones que son "resultados de búsqueda" a menos que sea útil aclararlo):\n\n${lines}`;
}

router.get('/', auth, (req, res) => {
  res.json({ chats: getChatsByUser(req.user.id).map(c => ({ _id: c.id, title: c.title, lastMessageAt: c.lastMessageAt, model: c.model, isPinned: c.isPinned, createdAt: c.createdAt })) });
});

router.get('/:id', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  res.json({ chat });
});

router.post('/new', auth, (req, res) => {
  res.status(201).json({ chat: createChat(req.user.id, MODEL_CHAT) });
});

router.post('/:id/message', auth, async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);
    if (!canDoAction(user, 'message')) return res.status(403).json({ error: 'Limite de mensajes alcanzado', upgradeRequired: true });

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'Chat no encontrado' });

    const text = req.body.content?.trim();
    const wantsWebSearch = req.body.webSearch === true || req.body.webSearch === 'true';
    if (!text) return res.status(400).json({ error: 'Mensaje vacio' });

    chat.messages.push({ role: 'user', content: text, timestamp: new Date() });

    const custom = getCustomReply(text);
    let reply, finalModel, usedWebSearch = false;

    if (custom) {
      reply = custom; finalModel = 'zyx-custom';
    } else {
      finalModel = MODEL_CHAT;
      const recent = chat.messages.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

      const systemMessages = [{ role: 'system', content: SYSTEM_PROMPT }];

      // Contexto ligero de otras conversaciones del usuario (para continuidad, no el contenido completo)
      const otherChats = getChatsByUser(user.id).filter(c => c.id !== chat.id).slice(0, 8);
      if (otherChats.length) {
        const titles = otherChats.map(c => `- ${c.title}`).join('\n');
        systemMessages.push({
          role: 'system',
          content: `El usuario tiene otras conversaciones previas con títulos (solo para contexto, no las menciones a menos que sean relevantes):\n${titles}`
        });
      }

      // Búsqueda web real si el usuario activó la opción "Buscar en internet"
      if (wantsWebSearch) {
        const results = await webSearch(text);
        usedWebSearch = !!results;
        systemMessages.push({ role: 'system', content: formatSearchResults(text, results) });
      }

      const comp = await groq.chat.completions.create({
        model: finalModel,
        messages: [...systemMessages, ...recent],
        max_tokens: 4096,
        temperature: 0.75
      });
      reply = comp.choices[0].message.content;
    }

    chat.messages.push({ role: 'assistant', content: reply, model: finalModel, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    if (finalModel !== 'zyx-custom') chat.model = finalModel;
    if (chat.messages.length === 2) generateChatTitle(chat);
    user.usage.messagesThisMonth++;

    res.json({ message: reply, model: finalModel, chatId: chat.id, chatTitle: chat.title, usedWebSearch });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: 'Error al procesar: ' + e.message });
  }
});

router.post('/:id/analyze-image', auth, upload.single('image'), async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);
    if (!canDoAction(user, 'analyzeImage')) return res.status(403).json({ error: 'Has alcanzado tu límite de análisis de imágenes. Necesitas el plan Pro o Ultra para analizar más imágenes.', upgradeRequired: true });

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'No encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });

    const prompt = req.body.prompt?.trim() || 'Describe esta imagen con el mayor detalle posible: elementos, colores, composición, contexto y cualquier texto visible.';
    const b64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;

    chat.messages.push({ role: 'user', content: `[Imagen] ${prompt}`, timestamp: new Date() });

    const comp = await groq.chat.completions.create({ model: MODEL_VISION, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: 2048 });

    const reply = comp.choices[0].message.content;
    chat.messages.push({ role: 'assistant', content: reply, model: MODEL_VISION, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    if (chat.messages.length === 2) generateChatTitle(chat);
    user.usage.imagesAnalyzedThisMonth++;
    user.usage.messagesThisMonth++;

    res.json({ message: reply, chatId: chat.id, chatTitle: chat.title });
  } catch (e) {
    res.status(500).json({ error: 'Error al analizar imagen' });
  }
});

router.post('/:id/regenerate', auth, async (req, res) => {
  try {
    const user = req.user;
    if (!canDoAction(user, 'message')) return res.status(403).json({ error: 'Limite alcanzado' });
    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'No encontrado' });
    if (chat.messages[chat.messages.length-1]?.role === 'assistant') chat.messages.pop();
    const recent = chat.messages.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const comp = await groq.chat.completions.create({ model: MODEL_CHAT, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent], max_tokens: 2048, temperature: 0.9 });
    const reply = comp.choices[0].message.content;
    chat.messages.push({ role: 'assistant', content: reply, model: MODEL_CHAT, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    user.usage.messagesThisMonth++;
    res.json({ message: reply });
  } catch (e) {
    res.status(500).json({ error: 'Error al regenerar' });
  }
});

router.delete('/:id', auth, (req, res) => { deleteChat(req.params.id, req.user.id); res.json({ message: 'Eliminado' }); });
router.patch('/:id/rename', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  const title = String(req.body.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'El título no puede estar vacío' });
  chat.title = title;
  res.json({ title: chat.title });
});
router.patch('/:id/pin', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  chat.isPinned = !chat.isPinned;
  res.json({ isPinned: chat.isPinned });
});

module.exports = router;
