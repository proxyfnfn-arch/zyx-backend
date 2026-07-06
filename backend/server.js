require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { initAdmin } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(cors({
  origin: (origin, cb) => cb(null, true), // allow all origins
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 500, message: { error: 'Demasiadas solicitudes' } }));

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
