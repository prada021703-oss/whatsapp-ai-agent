const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { generateResponse } = require('./ai');
const { supabaseAdmin } = require('./supabase_client');
const { upsertSession, saveMessage, getSessionMessages, saveConversation } = require('./storage');

let sock = null;
let _retryCount = 0;
const MAX_RETRIES = 20;

async function startBaileys(phoneNumberToPair = null, resetAuth = false, _retryDelay = 5000) {
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');

    const authDir = path.join(__dirname, 'baileys_auth_info');

    if (resetAuth || phoneNumberToPair) {
      if (sock) {
        try { sock.end(); } catch (e) {}
        sock = null;
      }
      if (fs.existsSync(authDir)) {
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
      }
      try {
        if (fs.existsSync(path.join(__dirname, 'public', 'pairing_code.txt'))) {
          fs.unlinkSync(path.join(__dirname, 'public', 'pairing_code.txt'));
        }
        if (fs.existsSync(path.join(__dirname, 'public', 'qr.txt'))) {
          fs.unlinkSync(path.join(__dirname, 'public', 'qr.txt'));
        }
        fs.writeFileSync(path.join(__dirname, 'public', 'status.txt'), 'pairing');
      } catch (e) {}
    }

    let { state, saveCreds } = await useMultiFileAuthState(authDir);

    if (!state.creds || !state.creds.me) {
      if (fs.existsSync(authDir)) {
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
      }
      const freshState = await useMultiFileAuthState(authDir);
      state = freshState.state;
      saveCreds = freshState.saveCreds;
    }

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      syncFullHistory: true
    });

    sock.ev.on('creds.update', saveCreds);

    // Evento de sincronización de historial de chats existentes al conectar WhatsApp Web
    sock.ev.on('messaging-history.set', async ({ chats, messages }) => {
      console.log(`[Baileys Sincronización] Historial recibido: ${chats?.length || 0} chats, ${messages?.length || 0} mensajes.`);
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          try {
            const remoteJid = msg.key?.remoteJid;
            if (!remoteJid || remoteJid.includes('status') || remoteJid.endsWith('@g.us')) continue;
            let fromPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
            if (!fromPhone) continue;
            if (fromPhone.length === 10 && fromPhone.startsWith('3')) {
              fromPhone = `57${fromPhone}`;
            }
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!text) continue;
            const role = msg.key.fromMe ? 'assistant' : 'user';

            if (supabaseAdmin) {
              const sessionId = await upsertSession(fromPhone);
              if (sessionId) {
                await saveMessage(sessionId, role, text);
              }
            }
            saveConversation(fromPhone, [{ role, content: text, timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString() }]);
          } catch (e) {}
        }
      }
    });

    let cleanPhone = null;
    if (phoneNumberToPair) {
      cleanPhone = phoneNumberToPair.replace(/\D/g, '');
      if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) {
        cleanPhone = '57' + cleanPhone;
      }
    }

    if (cleanPhone && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          console.log(`[Baileys Pairing] Solicitando Código de Emparejamiento a WhatsApp para +${cleanPhone}...`);
          const code = await sock.requestPairingCode(cleanPhone);
          const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log(`\n======================================================`);
          console.log(`🔑 CÓDIGO VÁLIDO DE EMPAREJAMIENTO DE WHATSAPP: ${formattedCode}`);
          console.log(`======================================================\n`);
          fs.writeFileSync(path.join(__dirname, 'public', 'pairing_code.txt'), formattedCode);
        } catch (err) {
          console.error('[Pairing Error]:', err.message || err);
        }
      }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n======================================================');
        console.log('📱 CÓDIGO QR GENERADO (OFICIAL MAC OS)');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
        try {
          fs.writeFileSync(path.join(__dirname, 'public', 'qr.txt'), qr);
        } catch (e) {}
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        console.log(`[Baileys] Conexión cerrada (status ${statusCode}). LoggedOut: ${isLoggedOut}`);
        
        if (isLoggedOut || statusCode === 401) {
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
          _retryCount = 0;
        }

        try {
          fs.writeFileSync(path.join(__dirname, 'public', 'status.txt'), 'disconnected');
        } catch (e) {}

        if (!isLoggedOut && !phoneNumberToPair) {
          _retryCount++;
          if (_retryCount > MAX_RETRIES) {
            console.warn(`[Baileys] Máximo de reintentos (${MAX_RETRIES}) alcanzado. Pausando reconexión.`);
            console.warn('[Baileys] Ve al dashboard y usa el botón de vincular para reconectar.');
            _retryCount = 0;
            return;
          }
          // Exponential backoff: 5s, 10s, 20s, ... max 300s
          const delay = Math.min(_retryDelay * Math.pow(1.5, _retryCount - 1), 300000);
          console.log(`[Baileys] Reintentando en ${Math.round(delay / 1000)}s... (intento ${_retryCount}/${MAX_RETRIES})`);
          setTimeout(() => startBaileys(null, false, _retryDelay), delay);
        }
      } else if (connection === 'open') {
        console.log('\n======================================================');
        console.log('✅ ¡CONECTADO A WHATSAPP WEB CON ÉXITO VÍA BAILEYS!');
        console.log('======================================================\n');
        try {
          fs.writeFileSync(path.join(__dirname, 'public', 'status.txt'), 'connected');
          if (fs.existsSync(path.join(__dirname, 'public', 'pairing_code.txt'))) {
            fs.unlinkSync(path.join(__dirname, 'public', 'pairing_code.txt'));
          }
          if (fs.existsSync(path.join(__dirname, 'public', 'qr.txt'))) {
            fs.unlinkSync(path.join(__dirname, 'public', 'qr.txt'));
          }
        } catch (e) {}
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages?.[0];
        if (!msg || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes('status') || remoteJid.endsWith('@g.us')) return;

        let fromPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        if (fromPhone.length === 10 && fromPhone.startsWith('3')) {
          fromPhone = `57${fromPhone}`;
        }

        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        if (!messageText) return;

        console.log(`[Baileys Recibido] De +${fromPhone}: "${messageText}"`);

        let sessionId = null;
        let conversationContext = [];

        if (supabaseAdmin) {
          sessionId = await upsertSession(fromPhone);
          if (sessionId) {
            await saveMessage(sessionId, 'user', messageText);
            conversationContext = await getSessionMessages(sessionId, 20);
          }
        }

        // Guardar mensaje entrante localmente
        saveConversation(fromPhone, [{ role: 'user', content: messageText, timestamp: new Date().toISOString() }]);

        const { reply } = await generateResponse(conversationContext, fromPhone);

        if (sessionId) {
          await saveMessage(sessionId, 'assistant', reply);
        }

        // Guardar respuesta del asistente localmente
        saveConversation(fromPhone, [{ role: 'assistant', content: reply, timestamp: new Date().toISOString() }]);

        // Enviar respuesta directa por WhatsApp Web
        await sock.sendMessage(remoteJid, { text: reply });
        console.log(`[Baileys Enviado -> WhatsApp] A +${fromPhone}: "${reply}"`);
      } catch (err) {
        console.error('[Baileys Message Handler Error]:', err);
      }
    });
  } catch (err) {
    console.error('[Baileys Init Error]:', err.message || err);
  }
}

module.exports = { startBaileys, getSocket: () => sock };
