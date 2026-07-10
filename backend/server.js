require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { initAdmin } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// Render (y la mayoría de PaaS) están detrás de un proxy inverso que añade el
// header X-Forwarded-For. Sin esto, express-rate-limit no puede identificar
// correctamente las IPs de los usuarios y lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(cors({
  origin: 'https://zyxai.neocities.org', // Solo tu frontend puede llamar a la API
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Límite general para toda la API
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 500, message: { error: 'Demasiadas solicitudes' } }));

// Límite estricto para rutas de autenticación (previene fuerza bruta / spam de emails)
app.use('/api/auth/login',           rateLimit({ windowMs: 15*60*1000, max: 15, message: { error: 'Demasiados intentos de inicio de sesión. Intenta más tarde.' } }));
app.use('/api/auth/register',        rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Demasiados registros desde esta IP. Intenta más tarde.' } }));
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 60*60*1000, max: 5,  message: { error: 'Demasiadas solicitudes de recuperación. Intenta más tarde.' } }));
app.use('/api/auth/reset-password',  rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Demasiados intentos. Intenta más tarde.' } }));

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/chat',    require('./routes/chat'));
app.use('/api/images',  require('./routes/images'));
app.use('/api/export',  require('./routes/export'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/redeem',  require('./routes/redeem').router);

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'ZYX AI v4' }));
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: 'Error interno' }); });

initAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 ZYX AI v4 — puerto ${PORT}`);
    console.log(`🌐 Frontend: ${process.env.FRONTEND_URL}`);
    console.log(`📦 Sin base de datos — RAM`);
    console.log(`🎟️ 400 códigos de canje cargados (200 Pro + 200 Ultra)`);
  });
});
