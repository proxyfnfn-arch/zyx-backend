// =============================================
// ZYX AI — Base de datos en memoria (sin MongoDB)
// Los datos se guardan en RAM mientras el servidor está activo
// =============================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Almacenamiento en memoria
const users = new Map();   // id -> user object
const chats = new Map();   // id -> chat object

// Índices para búsqueda rápida
const usersByEmail    = new Map(); // email -> id
const usersByUsername = new Map(); // username -> id
const chatsByUser     = new Map(); // userId -> Set of chatIds

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// ── PLAN LIMITS ────────────────────────────────
const PLAN_LIMITS = {
  free: {
    messages: -1,          // ILIMITADO - el chat es siempre gratis
    imageGeneration: 0,    // No disponible
    imageAnalysis: 5,      // 5 analisis/mes gratis
    exportFormats: ['txt', 'md'],
    models: ['openai/gpt-oss-120b']
  },
  pro: {
    messages: -1,          // ILIMITADO
    imageGeneration: 50,
    imageAnalysis: 100,
    exportFormats: ['txt', 'md', 'html', 'json'],
    models: ['openai/gpt-oss-120b']
  },
  ultra: {
    messages: -1,          // ILIMITADO
    imageGeneration: -1,
    imageAnalysis: -1,
    exportFormats: ['txt', 'md', 'html', 'json'],
    models: ['openai/gpt-oss-120b']
  }
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function canDoAction(user, action) {
  const limits = getPlanLimits(user.plan);
  const usage  = user.usage;
  switch (action) {
    case 'message':
      return limits.messages === -1 || usage.messagesThisMonth < limits.messages;
    case 'generateImage':
      return limits.imageGeneration === -1 || (limits.imageGeneration > 0 && usage.imagesGeneratedThisMonth < limits.imageGeneration);
    case 'analyzeImage':
      return limits.imageAnalysis === -1 || (limits.imageAnalysis > 0 && usage.imagesAnalyzedThisMonth < limits.imageAnalysis);
    default: return false;
  }
}

// ── USER FUNCTIONS ─────────────────────────────
async function createUser({ email, username, password, role = 'user' }) {
  if (usersByEmail.has(email.toLowerCase()))    throw new Error('Este email ya está registrado');
  if (usersByUsername.has(username.toLowerCase())) throw new Error('Este nombre de usuario ya está en uso');

  const hash = await bcrypt.hash(password, 12);
  const id   = generateId();
  const user = {
    _id: id,
    id,
    email: email.toLowerCase(),
    username,
    password: hash,
    role,
    plan: 'free',
    planExpiresAt: null,
    usage: {
      messagesThisMonth: 0,
      imagesGeneratedThisMonth: 0,
      imagesAnalyzedThisMonth: 0,
      lastResetDate: new Date()
    },
    createdAt: new Date(),
    lastLoginAt: null,
    isActive: true
  };

  users.set(id, user);
  usersByEmail.set(email.toLowerCase(), id);
  usersByUsername.set(username.toLowerCase(), id);
  chatsByUser.set(id, new Set());
  return user;
}

function findUserByEmail(email) {
  const id = usersByEmail.get(email.toLowerCase());
  return id ? users.get(id) : null;
}

function findUserByUsername(username) {
  const id = usersByUsername.get(username.toLowerCase());
  return id ? users.get(id) : null;
}

// Busca por email o por nombre de usuario, lo que se le pase
function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  const value = identifier.trim();
  if (value.includes('@')) {
    return findUserByEmail(value) || findUserByUsername(value);
  }
  return findUserByUsername(value) || findUserByEmail(value);
}

function findUserById(id) {
  return users.get(id) || null;
}

function findAllUsers() {
  return Array.from(users.values());
}

async function comparePassword(user, password) {
  return bcrypt.compare(password, user.password);
}

function resetUsageIfNeeded(user) {
  const now  = new Date();
  const last = new Date(user.usage.lastResetDate);
  if (now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear()) {
    user.usage.messagesThisMonth = 0;
    user.usage.imagesGeneratedThisMonth = 0;
    user.usage.imagesAnalyzedThisMonth  = 0;
    user.usage.lastResetDate = now;
  }
}

function safeUser(user) {
  const { password, ...safe } = user;
  return { ...safe, limits: getPlanLimits(user.plan) };
}

function updateUser(id, updates) {
  const user = users.get(id);
  if (!user) return null;
  Object.assign(user, updates);
  return user;
}

// ── CHAT FUNCTIONS ─────────────────────────────
function createChat(userId, model = 'gpt-4o') {
  const id   = generateId();
  const chat = {
    _id: id,
    id,
    userId,
    title: 'Nueva conversación',
    messages: [],
    model,
    totalTokens: 0,
    isPinned: false,
    isArchived: false,
    lastMessageAt: new Date(),
    createdAt: new Date()
  };
  chats.set(id, chat);
  chatsByUser.get(userId)?.add(id);
  return chat;
}

function getChatsByUser(userId) {
  const ids = chatsByUser.get(userId) || new Set();
  return Array.from(ids)
    .map(id => chats.get(id))
    .filter(c => c && !c.isArchived)
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
      return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
    });
}

function getChatById(id) {
  return chats.get(id) || null;
}

function deleteChat(id, userId) {
  const chat = chats.get(id);
  if (!chat || chat.userId !== userId) return false;
  chats.delete(id);
  chatsByUser.get(userId)?.delete(id);
  return true;
}

function generateChatTitle(chat) {
  const first = chat.messages.find(m => m.role === 'user');
  if (first) {
    chat.title = first.content.substring(0, 60) + (first.content.length > 60 ? '...' : '');
  }
}

// Crear admin por defecto al arrancar
async function initAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const pass  = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return;
  if (findUserByEmail(email)) return;
  try {
    await createUser({ email, username: 'admin', password: pass, role: 'admin' });
    const admin = findUserByEmail(email);
    admin.plan = 'ultra';
    console.log('✅ Admin creado:', email);
  } catch (e) {
    console.log('Admin ya existe o error:', e.message);
  }
}

module.exports = {
  createUser, findUserByEmail, findUserByUsername, findUserByIdentifier, findUserById, findAllUsers,
  comparePassword, resetUsageIfNeeded, safeUser, updateUser,
  getPlanLimits, canDoAction,
  createChat, getChatsByUser, getChatById, deleteChat, generateChatTitle,
  initAdmin
};
