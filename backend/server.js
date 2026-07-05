require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const { initAdmin } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    /\.neocities\.org$/
  ],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'Demasiadas solicitudes' } }));
app.use('/api/chat', rateLimit({ windowMs: 60*1000, max: 30, message: { error: 'Demasiados mensajes por minuto' } }));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/chat',     require('./routes/chat'));
app.use('/api/images',   require('./routes/images'));
app.use('/api/export',   require('./routes/export'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'ZYX AI', version: '1.0.0' }));
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor (sin esperar MongoDB)
initAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 ZYX AI corriendo en puerto ${PORT}`);
    console.log(`📦 Modo: memoria RAM (sin base de datos externa)`);
    console.log(`🌐 Frontend: ${process.env.FRONTEND_URL}`);
  });
});
