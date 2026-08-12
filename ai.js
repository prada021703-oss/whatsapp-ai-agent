require('dotenv').config();
const { supabaseAdmin } = require('./supabase_client');

let OpenAI;
try {
  OpenAI = require('openai');
} catch (e) {
  OpenAI = null;
}

/**
 * Obtiene la configuración del agente desde la tabla agent_config usando supabaseAdmin.
 * @param {string} phoneNumber - Número de teléfono asociado o 'default'
 * @returns {Promise<import('./types').AgentConfig>}
 */
async function getAgentConfig(phoneNumber = 'default') {
  const defaultConfig = {
    id: 'default-id',
    phone_number: phoneNumber,
    system_prompt: process.env.SYSTEM_PROMPT || 'Eres un asistente útil.',
    model: process.env.OPENAI_MODEL || 'claude-3-5-sonnet',
    temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    is_active: true,
  };

  if (!supabaseAdmin) return defaultConfig;

  try {
    let { data, error } = await supabaseAdmin
      .from('agent_config')
      .select('id, phone_number, system_prompt, model, temperature, is_active')
      .eq('phone_number', phoneNumber)
      .maybeSingle();

    if (!data && phoneNumber !== 'default') {
      const res = await supabaseAdmin
        .from('agent_config')
        .select('id, phone_number, system_prompt, model, temperature, is_active')
        .eq('phone_number', 'default')
        .maybeSingle();
      data = res.data;
    }

    if (error || !data) return defaultConfig;

    return {
      id: data.id || defaultConfig.id,
      phone_number: data.phone_number || phoneNumber,
      system_prompt: data.system_prompt || defaultConfig.system_prompt,
      model: data.model || defaultConfig.model,
      temperature: data.temperature !== null ? parseFloat(data.temperature) : defaultConfig.temperature,
      is_active: data.is_active !== undefined ? data.is_active : true,
    };
  } catch (err) {
    console.error('[ai.js] Error al consultar agent_config:', err.message);
    return defaultConfig;
  }
}

/**
 * Genera la respuesta del asistente según la conversación y la configuración activa.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} phoneNumber
 */
async function generateResponse(messages, phoneNumber = 'default') {
  const apiKey = process.env.OPENAI_API_KEY;
  const config = await getAgentConfig(phoneNumber);
  const startTime = Date.now();

  if (!config.is_active) {
    return {
      reply: 'El agente se encuentra actualmente inactivo.',
      model: config.model,
      latencyMs: Date.now() - startTime
    };
  }

  let formattedMessages = [...messages];
  // Limit historial a últimos N mensajes (incluido system)
  const MAX_HISTORY = 30; // ajustar según necesidad
  let recent = formattedMessages.slice(-MAX_HISTORY);
  if (config.system_prompt && (!recent[0] || recent[0].role !== 'system')) {
    recent.unshift({ role: 'system', content: config.system_prompt });
  }
  formattedMessages = recent;

  const lastUserMsg = messages[messages.length - 1]?.content || '';

  if (!apiKey || apiKey === 'YOUR_OPENAI_API_KEY' || apiKey.includes('...') || !OpenAI) {
    let mockReply = '';
    const cleanMsg = lastUserMsg.trim().toLowerCase();
    if (cleanMsg === '/help') {
      mockReply = '🤖 *Comandos disponibles:*\n- `/help`: Muestra esta ayuda.\n- Escribe cualquier mensaje para chatear con el agente.';
    } else if (cleanMsg.includes('hola') || cleanMsg.includes('buenas') || cleanMsg.includes('buenos')) {
      mockReply = '¡Hola! 👋 Bienvenido. Soy tu asistente virtual inteligente de WhatsApp. ¿En qué te puedo colaborar hoy?';
    } else if (cleanMsg.includes('precio') || cleanMsg.includes('costo') || cleanMsg.includes('cuanto')) {
      mockReply = 'Con gusto te comparto la información de precios. Nuestros planes y servicios están diseñados a tu medida. ¿De qué producto te gustaría recibir cotización?';
    } else {
      mockReply = `¡Excelente mensaje! Entendí perfectamente: "${lastUserMsg}". Como asistente de WhatsApp conectado en tiempo real, estoy listo para atender todas las solicitudes de tus clientes.`;
    }
    return {
      reply: mockReply,
      model: `${config.model} (demo)`,
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const client = new OpenAI({ apiKey });
    let openAiModel = config.model;
    if (openAiModel.includes('claude')) {
      openAiModel = 'gpt-4o-mini';
    }

    const completion = await client.chat.completions.create({
      model: openAiModel,
      messages: formattedMessages,
      temperature: config.temperature,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || 'Sin respuesta.';
    const latencyMs = Date.now() - startTime;

    return {
      reply,
      model: config.model,
      latencyMs,
      tokens: completion.usage?.total_tokens ?? null
    };
  } catch (err) {
    console.error('Error OpenAI:', err.message);
    return {
      reply: `[Error de IA]: ${err.message}`,
      model: config.model,
      latencyMs: Date.now() - startTime
    };
  }
}

module.exports = { generateResponse, getAgentConfig };
