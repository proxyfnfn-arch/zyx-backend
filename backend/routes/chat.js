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

const MODEL_CHAT   = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'llama-3.2-11b-vision-preview';

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
    if (!text) return res.status(400).json({ error: 'Mensaje vacio' });

    chat.messages.push({ role: 'user', content: text, timestamp: new Date() });

    const custom = getCustomReply(text);
    let reply, finalModel;

    if (custom) {
      reply = custom; finalModel = 'zyx-custom';
    } else {
      finalModel = MODEL_CHAT;
      const recent = chat.messages.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
      const comp = await groq.chat.completions.create({ model: finalModel, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent], max_tokens: 2048, temperature: 0.75 });
      reply = comp.choices[0].message.content;
    }

    chat.messages.push({ role: 'assistant', content: reply, model: finalModel, timestamp: new Date() });
    chat.lastMessageAt = new Date();
    if (finalModel !== 'zyx-custom') chat.model = finalModel;
    if (chat.messages.length === 2) generateChatTitle(chat);
    user.usage.messagesThisMonth++;

    res.json({ message: reply, model: finalModel, chatId: chat.id, chatTitle: chat.title });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: 'Error al procesar: ' + e.message });
  }
});

router.post('/:id/analyze-image', auth, upload.single('image'), async (req, res) => {
  try {
    const user = req.user;
    resetUsageIfNeeded(user);
    if (!canDoAction(user, 'analyzeImage')) return res.status(403).json({ error: 'Analisis requiere plan Pro o Ultra', upgradeRequired: true });

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'No encontrado' });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });

    const prompt = req.body.prompt?.trim() || 'Describe esta imagen en detalle.';
    const b64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype;

    chat.messages.push({ role: 'user', content: `[Imagen] ${prompt}`, timestamp: new Date() });

    const comp = await groq.chat.completions.create({ model: MODEL_VISION, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: 1024 });

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
router.patch('/:id/pin', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat || chat.userId !== req.user.id) return res.status(404).json({ error: 'No encontrado' });
  chat.isPinned = !chat.isPinned;
  res.json({ isPinned: chat.isPinned });
});

module.exports = router;
