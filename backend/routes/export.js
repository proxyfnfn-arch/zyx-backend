const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { getChatById, getPlanLimits } = require('../db');

router.post('/chat/:id', auth, (req, res) => {
  try {
    const { format } = req.body;
    const user  = req.user;
    const limits = getPlanLimits(user.plan);

    if (!limits.exportFormats.includes(format)) {
      return res.status(403).json({ error: `Formato ${format.toUpperCase()} no disponible en tu plan`, upgradeRequired: true });
    }

    const chat = getChatById(req.params.id);
    if (!chat || chat.userId !== user.id) return res.status(404).json({ error: 'Chat no encontrado' });

    const msgs = chat.messages.filter(m => m.role !== 'system');

    if (format === 'txt') {
      let out = `ZYX AI — ${chat.title}\n${'='.repeat(50)}\n\n`;
      msgs.forEach(m => { out += `[${m.role === 'user' ? 'Tú' : 'ZYX AI'}]\n${m.content}\n\n`; });
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="chat.txt"`);
      return res.send(out);
    }

    if (format === 'md') {
      let out = `# ${chat.title}\n\n`;
      msgs.forEach(m => { out += `### ${m.role === 'user' ? '**Tú**' : '**ZYX AI**'}\n\n${m.content}\n\n---\n\n`; });
      res.setHeader('Content-Type','text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="chat.md"`);
      return res.send(out);
    }

    if (format === 'json') {
      res.setHeader('Content-Type','application/json');
      res.setHeader('Content-Disposition',`attachment; filename="chat.json"`);
      return res.send(JSON.stringify({ title: chat.title, messages: msgs }, null, 2));
    }

    if (format === 'html') {
      const body = msgs.map(m => {
        const cls = m.role === 'user' ? 'user' : 'ai';
        const label = m.role === 'user' ? 'Tú' : 'ZYX AI';
        const text = m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
        return `<div class="msg ${cls}"><strong>${label}</strong><p>${text}</p></div>`;
      }).join('\n');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${chat.title}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;background:#0a0a0f;color:#eee;padding:20px}
.msg{margin:16px 0;padding:16px;border-radius:10px}.user{background:#1a2744;border-left:3px solid #3b82f6}
.ai{background:#12121a;border-left:3px solid #7c3aed}strong{font-size:12px;opacity:.7;text-transform:uppercase}p{margin:8px 0 0}</style>
</head><body><h1>${chat.title}</h1>${body}</body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="chat.html"`);
      return res.send(html);
    }

    res.status(400).json({ error: 'Formato inválido' });
  } catch (e) {
    res.status(500).json({ error: 'Error al exportar' });
  }
});

module.exports = router;
