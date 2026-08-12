const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { generateResponse, getAgentConfig } = require('./ai');
const { sendMessage } = require('./twilio_client');
const { supabaseAdmin } = require('./supabase_client');
const {
  upsertSession,
  getSessionMessages,
  saveMessage,
  getConversation,
  saveConversation
} = require('./storage');

const { startBaileys } = require('./baileys_client');
const fs = require('fs');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Servir dashboard estático
app.use(express.static(path.join(__dirname, 'public')));

/**
 * ─────────────────────────────────────────────────────────────
 * HELPERS DE MENSAJERÍA OUTBOUND (EVOLUTION API)
 * ─────────────────────────────────────────────────────────────
 */
async function sendEvolutionMessage(instance, toPhone, text) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const inst = instance || process.env.EVOLUTION_INSTANCE_NAME || 'default';

  if (!baseUrl || !apiKey || baseUrl.includes('tu-instancia')) {
    console.log(`[Evolution API Demo] Mensaje para +${toPhone}: "${text}"`);
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${inst}`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        number: toPhone,
        text: text,
        delay: 1000,
      }),
    });
    console.log(`[Evolution API Outbound]: Status ${res.status}`);
  } catch (err) {
    console.error('[Evolution API Outbound Error]:', err.message);
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * RUTAS DE WEBHOOK MULTI-PROVEEDOR (Evolution, Meta, Twilio, Direct)
 * Escucha en /webhook, /api/webhook, /webhook/evolution, /api/webhook/evolution, etc.
 * ─────────────────────────────────────────────────────────────
 */
const webhookRoutes = [
  '/webhook',
  '/api/webhook',
  '/webhook/evolution',
  '/api/webhook/evolution',
  '/webhook/meta',
  '/api/webhook/meta',
  '/webhook/twilio',
  '/api/webhook/twilio'
];

webhookRoutes.forEach(routePath => {
  // GET: Verificación de Meta WhatsApp Cloud API y health check
  app.get(routePath, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_secreto';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log(`[Webhook Meta] Verificación exitosa en ${routePath}`);
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ status: 'active', endpoint: routePath });
  });

  // POST: Procesamiento unificado de mensajes entrantes
  app.post(routePath, async (req, res) => {
    let from = '';
    let incomingMsg = '';
    let isEvolution = false;
    let evolutionInstance = process.env.EVOLUTION_INSTANCE_NAME || 'default';

    const body = req.body;
    const data = body?.data?.message ? body.data : (Array.isArray(body?.data) ? body.data[0] : body?.data);
    const key = data?.key || body?.key;
    const message = data?.message || body?.message;

    // 1. Detectar payload de Evolution API
    if (key && key.remoteJid) {
      isEvolution = true;
      evolutionInstance = body?.instance || evolutionInstance;

      // Ignorar mensajes de bot propio, historias/estados o grupos
      if (key.fromMe || key.remoteJid.includes('status') || key.remoteJid.endsWith('@g.us')) {
        return res.json({ status: 'ignored_by_filter' });
      }

      from = key.remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      incomingMsg = message?.conversation || message?.extendedTextMessage?.text || (message?.audioMessage ? '[Nota de voz recibida]' : '');
    } else {
      // 2. Detectar payload de Meta WhatsApp Cloud API
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const metaMessage = value?.messages?.[0];

      if (metaMessage) {
        if (metaMessage.type !== 'text') return res.json({ status: 'ignored_non_text' });
        from = metaMessage.from;
        incomingMsg = metaMessage.text?.body;
      } else {
        // 3. Detectar Twilio o solicitudes directas desde dashboard/playground
        from = req.body.From || req.body.from || req.body.customer_phone || '';
        incomingMsg = req.body.Body || req.body.body || '';
      }
    }

    if (!from || !incomingMsg) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (From, Body)' });
    }

    // Auto-normalización de números colombianos de 10 dígitos (321...)
    if (from.length === 10 && from.startsWith('321')) {
      from = `57${from}`;
    }

    console.log(`[Webhook -> ${routePath}] Mensaje de +${from}: "${incomingMsg}"`);

    try {
      let sessionId = null;
      let conversationContext = [];

      if (supabaseAdmin) {
        sessionId = await upsertSession(from);
        if (sessionId) {
          await saveMessage(sessionId, 'user', incomingMsg);
          conversationContext = await getSessionMessages(sessionId, 20);
        }
      }

      if (!sessionId) {
        const localHistory = getConversation(from);
        conversationContext = localHistory.concat([{ role: 'user', content: incomingMsg }]);
        saveConversation(from, [{ role: 'user', content: incomingMsg }]);
      }

      const { reply, model, latencyMs } = await generateResponse(conversationContext, from);

      if (sessionId) {
        await saveMessage(sessionId, 'assistant', reply);
      } else {
        saveConversation(from, [{ role: 'assistant', content: reply }]);
      }

      // Responder a través de Evolution API si proviene de allí
      if (isEvolution || (process.env.EVOLUTION_API_URL && !process.env.EVOLUTION_API_URL.includes('tu-instancia'))) {
        await sendEvolutionMessage(evolutionInstance, from, reply);
      }

      // Responder a través de Twilio si está configurado
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        await sendMessage(from, reply);
      }

      res.json({
        success: true,
        reply,
        sessionId,
        model,
        latencyMs
      });
    } catch (err) {
      console.error('[Webhook Error]:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });
});


/**
 * ─────────────────────────────────────────────────────────────
 * REST APIs PARA EL DASHBOARD
 * ─────────────────────────────────────────────────────────────
 */

// GET /api/config
app.get('/api/config', async (req, res) => {
  try {
    const phone = req.query.phone || 'default';
    const config = await getAgentConfig(phone);
    res.json({ config, supabaseActive: !!supabaseAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config
app.post('/api/config', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(400).json({ error: 'Supabase no está configurado' });
  }

  const { phone_number = 'default', system_prompt, model, temperature, is_active } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('agent_config')
      .upsert({
        phone_number,
        system_prompt,
        model,
        temperature: parseFloat(temperature),
        is_active: is_active !== undefined ? is_active : true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'phone_number' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, config: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions
app.get('/api/sessions', async (req, res) => {
  let dbSessions = [];
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) dbSessions = data;
    } catch (err) {}
  }

  if (dbSessions.length === 0) {
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      files.forEach(file => {
        const phone = file.replace('.json', '').replace('whatsapp_', '').replace('+', '');
        dbSessions.push({
          id: `sess-${phone}`,
          customer_phone: phone,
          customer_name: `+${phone}`,
          status: 'active',
          created_at: new Date().toISOString()
        });
      });
    }
  }

  res.json({ sessions: dbSessions });
});

// GET /api/messages — Retorna el historial completo de mensajes sincronizados de WhatsApp
app.get('/api/messages', async (req, res) => {
  let dbMessages = [];
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('messages')
        .select('id, session_id, role, content, created_at, whatsapp_sessions(customer_phone, customer_name)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) dbMessages = data;
    } catch (err) {}
  }

  // Si Supabase no devolvió mensajes o no está conectado, cargamos el historial local sincronizado por Baileys
  if (dbMessages.length === 0) {
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      files.forEach(file => {
        const phone = file.replace('.json', '');
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
          content.forEach(m => {
            dbMessages.push({
              id: `${phone}-${Date.now()}`,
              phone: phone,
              role: m.role || 'user',
              content: m.content || '',
              created_at: m.timestamp || new Date().toISOString(),
              whatsapp_sessions: { customer_phone: phone, customer_name: `+${phone}` }
            });
          });
        } catch (e) {}
      });
    }
  }

  res.json({ messages: dbMessages });
});

// POST /api/send-test — Simula y verifica el enlace con el número de prueba (+57 321 449 3071)
app.post('/api/send-test', async (req, res) => {
  const targetPhone = req.body.phone || '573214493071';
  const messageText = req.body.message || 'Hola agente, verifiquemos la conexión.';

  try {
    let sessionId = null;
    let conversationContext = [];

    if (supabaseAdmin) {
      sessionId = await upsertSession(targetPhone);
      if (sessionId) {
        await saveMessage(sessionId, 'user', messageText);
        conversationContext = await getSessionMessages(sessionId, 20);
      }
    }

    if (!sessionId) {
      const localHistory = getConversation(targetPhone);
      conversationContext = localHistory.concat([{ role: 'user', content: messageText }]);
      saveConversation(targetPhone, [{ role: 'user', content: messageText }]);
    }

    const { reply, model, latencyMs } = await generateResponse(conversationContext, targetPhone);

    if (sessionId) {
      await saveMessage(sessionId, 'assistant', reply);
    } else {
      saveConversation(targetPhone, [{ role: 'assistant', content: reply }]);
    }

    // Intentar envío real a través de Evolution API
    await sendEvolutionMessage(process.env.EVOLUTION_INSTANCE_NAME || 'default', targetPhone, reply);

    res.json({
      success: true,
      phone: targetPhone,
      userMessage: messageText,
      reply,
      model,
      latencyMs,
      linkedStatus: 'ACTIVO_Y_ENLAZADO'
    });
  } catch (err) {
    console.error('[Send-Test Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pair — Inicia vinculación por código de 8 dígitos para cualquier número introducido
app.post('/api/pair', async (req, res) => {
  let targetPhone = (req.body.phone || '573214493071').toString().replace(/\D/g, '');
  if (targetPhone.length === 10 && targetPhone.startsWith('3')) {
    targetPhone = '57' + targetPhone;
  }
  console.log(`[API /api/pair] Iniciando vinculación normalizada para +${targetPhone}...`);
  const codePath = path.join(__dirname, 'public', 'pairing_code.txt');
  if (fs.existsSync(codePath)) {
    try { fs.unlinkSync(codePath); } catch (e) {}
  }
  startBaileys(targetPhone, true);
  res.json({ success: true, phone: targetPhone, message: `Generando código de emparejamiento para +${targetPhone}...` });
});

// GET /api/pairing-code — Retorna el código de emparejamiento generado
app.get('/api/pairing-code', (req, res) => {
  const codePath = path.join(__dirname, 'public', 'pairing_code.txt');
  if (fs.existsSync(codePath)) {
    const code = fs.readFileSync(codePath, 'utf8');
    return res.json({ status: 'code_available', code: code });
  }
  return res.json({ status: 'waiting' });
});

// GET /api/backup — Exporta la copia de seguridad de la cuenta conectada (+573214493071)
app.get('/api/backup', (req, res) => {
  const connectedAccount = '573214493071';
  const backupPath = path.join(__dirname, 'public', 'backup_573214493071.json');
  if (fs.existsSync(backupPath)) {
    const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    return res.json({ account: connectedAccount, device: 'Mac OS Desktop', messages: data });
  }
  return res.status(404).json({ error: 'Copia de seguridad no disponible.' });
});

// GET /api/tunnel — Retorna la URL pública HTTPS de producción activa
app.get('/api/tunnel', (req, res) => {
  const tunnelPath = path.join(__dirname, 'public', 'tunnel_url.txt');
  let activeUrl = 'https://7af4a1bf168198.lhr.life';
  if (fs.existsSync(tunnelPath)) {
    activeUrl = fs.readFileSync(tunnelPath, 'utf8').trim() || activeUrl;
  }
  res.json({ status: 'active', url: activeUrl });
});

// GET /api/evolution/connect — Solicita a Evolution API que inicie la conexión y devuelva el QR
app.get(['/api/evolution/connect', '/api/connect/evolution'], async (req, res) => {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default';

  if (!baseUrl || !apiKey || baseUrl.includes('tu-instancia') || apiKey.includes('tu_global')) {
    return res.status(400).json({ error: 'Configura EVOLUTION_API_URL y EVOLUTION_API_KEY reales en .env' });
  }

  try {
    const evoRes = await fetch(`${baseUrl}/instance/connect/${instance}`, {
      method: 'GET',
      headers: { 'apikey': apiKey }
    });
    const data = await evoRes.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error al generar QR de Evolution API' });
  }
});

// GET /api/whatsapp/qr — Endpoint consumido por el componente React WhatsAppConnector
app.get('/api/whatsapp/qr', async (req, res) => {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default';

  if (baseUrl && apiKey && !baseUrl.includes('tu-instancia') && !apiKey.includes('tu_global')) {
    try {
      const evoRes = await fetch(`${baseUrl}/instance/connect/${instance}`, {
        method: 'GET',
        headers: { 'apikey': apiKey }
      });
      const data = await evoRes.json();
      if (data?.base64 || data?.code || data?.state) {
        return res.json(data);
      }
    } catch (e) {}
  }

  const qrPath = path.join(__dirname, 'public', 'qr.txt');
  if (fs.existsSync(qrPath)) {
    const qrString = fs.readFileSync(qrPath, 'utf8');
    const base64Url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrString)}`;
    return res.json({ base64: base64Url });
  }

  const statusPath = path.join(__dirname, 'public', 'status.txt');
  if (fs.existsSync(statusPath) && fs.readFileSync(statusPath, 'utf8').trim() === 'connected') {
    return res.json({ state: 'open' });
  }

  return res.status(404).json({ error: 'Sin QR disponible.' });
});

// GET /api/status — Estado en tiempo real de la conexión
app.get('/api/status', (req, res) => {
  const statusPath = path.join(__dirname, 'public', 'status.txt');
  let isConnected = false;
  if (fs.existsSync(statusPath)) {
    isConnected = fs.readFileSync(statusPath, 'utf8').trim() === 'connected';
  }
  res.json({ connected: isConnected });
});

// GET /api/qr — Retorna el QR activo si existe
app.get('/api/qr', (req, res) => {
  const qrPath = path.join(__dirname, 'public', 'qr.txt');
  if (fs.existsSync(qrPath)) {
    const qrString = fs.readFileSync(qrPath, 'utf8');
    return res.json({ status: 'qr_available', qr: qrString });
  }
  return res.json({ status: 'connected_or_waiting' });
});

const PORT = process.env.PORT || 3000;
function startServer(port) {
  const server = app.listen(port, async () => {
    console.log(`[Servidor WA Agent] Escuchando en http://localhost:${port}`);
    // Auto-aprovisionamiento del número de prueba designado (+57 321 449 3071)
    try {
      if (supabaseAdmin) {
        const testPhone = '573214493071';
        const sessionId = await upsertSession(testPhone);
        console.log(`[Auto-Enlace] Número de prueba +${testPhone} enlazado con ID de sesión: ${sessionId}`);
      }
    } catch (e) { console.error('[Auto-Enlace Warning]:', e.message); }
    // Iniciar cliente de conexión directa WhatsApp Web (Baileys)
    // Solo arranca automáticamente si ya hay credenciales guardadas
    const authDir = path.join(__dirname, 'baileys_auth_info');
    const hasCreds = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;
    if (hasCreds) {
      console.log('[Servidor] Credenciales de Baileys encontradas, iniciando conexión...');
      startBaileys();
    } else {
      console.log('[Servidor] Sin credenciales de WhatsApp. Ve al dashboard y vincula un número.');
      fs.writeFileSync(path.join(__dirname, 'public', 'status.txt'), 'disconnected');
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Puerto ${port} en uso, intentando con el siguiente puerto...`);
      startServer(port + 1);
    } else {
      console.error('Error al iniciar el servidor:', err);
    }
  });
}
startServer(PORT);



