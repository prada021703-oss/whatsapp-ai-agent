/**
 * storage.js
 * Capa de persistencia para PostgreSQL / Supabase y fallback local.
 * Usa supabaseAdmin (Service Role) para bypass de RLS desde el servidor/webhook.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { supabaseAdmin } = require('./supabase_client');

// ─── Fallback: almacenamiento local ──────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function localGet(phone) {
  const fp = path.join(DATA_DIR, `${phone.replace(/[^a-zA-Z0-9+]/g, '_')}.json`);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return []; }
}

function localSave(phone, messages) {
  const fp = path.join(DATA_DIR, `${phone.replace(/[^a-zA-Z0-9+]/g, '_')}.json`);
  const existing = localGet(phone);
  fs.writeFileSync(fp, JSON.stringify(existing.concat(messages), null, 2), 'utf-8');
}

// ─── Supabase: obtener o crear sesión ────────────────────────
/**
 * Verifica/crea una sesión en whatsapp_sessions usando supabaseAdmin.
 * @param {string} customerPhone - Número de teléfono del cliente
 * @param {string} [customerName] - Nombre opcional del cliente
 * @returns {Promise<string|null>} session_id (UUID)
 */
async function upsertSession(customerPhone, customerName = undefined) {
  if (!supabaseAdmin) return null;

  try {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('id, customer_phone, customer_name')
      .eq('customer_phone', customerPhone)
      .maybeSingle();

    if (selErr) {
      console.error('[Supabase] Error al consultar whatsapp_sessions:', selErr.message);
      return null;
    }

    if (existing) {
      return existing.id;
    }

    const newSession = {
      customer_phone: customerPhone,
      ...(customerName ? { customer_name: customerName } : {})
    };

    const { data: created, error: insErr } = await supabaseAdmin
      .from('whatsapp_sessions')
      .insert(newSession)
      .select('id, customer_phone, customer_name')
      .single();

    if (insErr) {
      console.error('[Supabase] Error al crear whatsapp_session:', insErr.message);
      return null;
    }

    console.log(`[Supabase] Nueva sesión creada para ${customerPhone} -> ${created.id}`);
    return created.id;
  } catch (err) {
    console.error('[Supabase] Excepción en upsertSession:', err.message);
    return null;
  }
}

// ─── Supabase: obtener historial de mensajes ──────────────────
/**
 * Obtiene el historial de mensajes de la sesión usando supabaseAdmin.
 * @param {string} sessionId - UUID de la sesión
 * @param {number} limit - Límite de mensajes
 * @returns {Promise<Array<{role:'user'|'assistant'|'system', content:string}>>}
 */
async function getSessionMessages(sessionId, limit = 20) {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, session_id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[Supabase] Error al obtener messages:', error.message);
    return [];
  }

  return (data || []).map(m => ({ role: m.role, content: m.content }));
}

// ─── Supabase: guardar mensaje ────────────────────────────────
/**
 * Inserta un registro en la tabla messages usando supabaseAdmin.
 * @param {string} sessionId - UUID de la sesión
 * @param {'user'|'assistant'|'system'} role - Rol del emisor
 * @param {string} content - Contenido del mensaje
 */
async function saveMessage(sessionId, role, content) {
  if (!supabaseAdmin) return;

  /** @type {import('./types').MessageRecord} */
  const record = {
    session_id: sessionId,
    role,
    content,
  };

  const { error } = await supabaseAdmin.from('messages').insert(record);

  if (error) {
    console.error('[Supabase] Error al guardar mensaje:', error.message);
  }
}

// ─── API pública Híbrida ──────────────────────────────────────
async function getConversationFromDB(phone) {
  const sessionId = await upsertSession(phone);
  if (!sessionId) {
    return { sessionId: null, history: localGet(phone) };
  }
  const history = await getSessionMessages(sessionId);
  return { sessionId, history };
}

module.exports = {
  upsertSession,
  getSessionMessages,
  saveMessage,
  getConversationFromDB,
  getConversation: localGet,
  saveConversation: localSave,
};
