import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase';
import { AgentConfig, WhatsAppSession, MessageRecord } from '@/lib/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'demo-key',
});

// GET: Verificación del Webhook por parte de Meta WhatsApp Cloud API
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Token de verificación inválido' }, { status: 403 });
}

// POST: Procesamiento de mensajes entrantes de WhatsApp
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Extraer datos del payload de Meta Cloud API
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Ignorar si no es un mensaje de texto
    if (!message || message.type !== 'text') {
      return NextResponse.json({ status: 'ignored_non_text' }, { status: 200 });
    }

    const customerPhone = message.from;
    const userMessageContent = message.text.body;
    const businessPhoneNumberId = value.metadata?.phone_number_id;

    // 1. Obtener la configuración del Agente de IA para esta línea
    const { data: configData, error: configError } = await supabaseAdmin
      .from('agent_config')
      .select('*')
      .eq('is_active', true)
      .single();

    if (configError || !configData) {
      console.error('Agente no configurado o inactivo');
      return NextResponse.json({ status: 'agent_inactive' }, { status: 200 });
    }

    const config = configData as AgentConfig;

    // 2. Obtener o crear la sesión del cliente
    let { data: session } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('customer_phone', customerPhone)
      .single();

    if (!session) {
      const { data: newSession, error: createSessionError } = await supabaseAdmin
        .from('whatsapp_sessions')
        .insert({ customer_phone: customerPhone })
        .select()
        .single();

      if (createSessionError) throw createSessionError;
      session = newSession;
    }

    const currentSession = session as WhatsAppSession;

    // 3. Registrar el mensaje del usuario en Supabase
    await supabaseAdmin.from('messages').insert({
      session_id: currentSession.id,
      role: 'user',
      content: userMessageContent,
    });

    // 4. Recuperar los últimos 10 mensajes del historial para darle contexto a Claude
    const { data: historyMessages } = await supabaseAdmin
      .from('messages')
      .select('role, content')
      .eq('session_id', currentSession.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Formatear historial en orden cronológico (de más antiguo a más reciente)
    const formattedHistory = (historyMessages || [])
      .reverse()
      .map((msg) => ({
        role: msg.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: msg.content,
      }));

    // 5. Enviar a Anthropic (Claude)
    const response = await anthropic.messages.create({
      model: config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      temperature: Number(config.temperature) || 0.7,
      system: config.system_prompt,
      messages: formattedHistory,
    });

    const aiReplyText =
      response.content[0].type === 'text'
        ? response.content[0].text
        : 'Lo siento, no pude procesar la respuesta.';

    // 6. Registrar la respuesta de la IA en Supabase
    await supabaseAdmin.from('messages').insert({
      session_id: currentSession.id,
      role: 'assistant',
      content: aiReplyText,
    });

    // 7. Enviar la respuesta de regreso al cliente mediante Meta WhatsApp Graph API
    await sendWhatsAppMessage(businessPhoneNumberId, customerPhone, aiReplyText);

    return NextResponse.json({ status: 'success' }, { status: 200 });
  } catch (error) {
    console.error('Error en el Webhook de WhatsApp:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Función auxiliar para enviar mensaje mediante la API oficial de WhatsApp Meta
async function sendWhatsAppMessage(
  phoneNumberId: string,
  toPhone: string,
  text: string
) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });
}
