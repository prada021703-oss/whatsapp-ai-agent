import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { toFile } from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { AgentConfig, WhatsAppSession } from '@/lib/types';

// Número de teléfono de prueba designado
const TEST_PHONE_NUMBER = '573214493071';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'demo-key',
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'demo-key',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ------------------------------------------------------------------
    // 1. EXTRACCIÓN SEGURA (Soporta múltiples versiones de Evolution API)
    // ------------------------------------------------------------------
    const event = body?.event || body?.type;
    // Ajuste por si data viene como objeto o como Array (v1 vs v2 de Evolution)
    const data = body?.data?.message ? body.data : (Array.isArray(body?.data) ? body.data[0] : body?.data);
    const key = data?.key || body?.key;
    const message = data?.message || body?.message;

    // ------------------------------------------------------------------
    // 2. FILTRO DE BLOQUEO ABSOLUTO
    // ------------------------------------------------------------------
    if (!event || !event.toLowerCase().includes('upsert')) {
      return NextResponse.json({ status: 'not_upsert' });
    }
    if (!key || key.fromMe === true) {
      return NextResponse.json({ status: 'from_me' });
    }
    if (key.remoteJid?.includes('@g.us') || key.remoteJid === 'status@broadcast') {
      return NextResponse.json({ status: 'ignored_jid' });
    }

    // ------------------------------------------------------------------
    // 3. EXTRACCIÓN ESTRICTA DE CONTENIDO
    // Si no hay texto ni audio procesable, terminar aquí sin responder
    // ------------------------------------------------------------------
    const textContent = message?.conversation || message?.extendedTextMessage?.text;
    const hasAudio = !!message?.audioMessage;

    if (!textContent && !hasAudio) {
      return NextResponse.json({ status: 'no_processable_content' });
    }

    // ------------------------------------------------------------------
    // 4. DEDUPLICACIÓN POR ID DE MENSAJE DE WHATSAPP
    // Evita procesar el mismo mensaje dos veces si Evolution API reintenta
    // ------------------------------------------------------------------
    const messageId = key?.id;
    if (messageId) {
      const { data: existingMsg } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('whatsapp_message_id', messageId)
        .maybeSingle();

      if (existingMsg) {
        return NextResponse.json({ status: 'duplicate_message' });
      }
    }

    // ------------------------------------------------------------------
    // 1. SANEAMIENTO ESTRICTO DE NÚMERO (Soporta el formato +57...)
    // ------------------------------------------------------------------
    let rawPhone = (key?.remoteJid as string).replace('@s.whatsapp.net', '').replace(/\D/g, '');

    const IS_TEST_NUMBER = rawPhone === '573214493071';
    const customerPhone = rawPhone;
    const instanceName = body?.instance || process.env.EVOLUTION_INSTANCE_NAME || 'default';

    let userMessageContent = '';

    // Procesamiento del Contenido (Texto o Voz)
    const isAudio = Boolean(message?.audioMessage);
    const isText = Boolean(message?.conversation || message?.extendedTextMessage?.text);

    if (isText) {
      userMessageContent = message?.conversation || message?.extendedTextMessage?.text;
    } else if (isAudio) {
      const audioBuffer = await getAudioBufferFromEvolution(instanceName, data);

      if (!audioBuffer) {
        await sendEvolutionMessage(
          instanceName, 
          customerPhone, 
          'He recibido tu nota de voz, pero no pude procesarla. ¿Podrías escribir tu mensaje?'
        );
        return NextResponse.json({ status: 'handled_audio_error' }, { status: 200 });
      }

      userMessageContent = await transcribeAudioWithWhisper(audioBuffer);

      if (!userMessageContent) {
        await sendEvolutionMessage(
          instanceName, 
          customerPhone, 
          'No logré transcribir el audio enviado. Por favor, escríbeme para poder ayudarte.'
        );
        return NextResponse.json({ status: 'handled_transcription_error' }, { status: 200 });
      }
    } else {
      await sendEvolutionMessage(
        instanceName, 
        customerPhone, 
        'Hola, por el momento solo puedo procesar mensajes de texto y notas de voz.'
      );
      return NextResponse.json({ status: 'handled_unsupported_format' }, { status: 200 });
    }

    // ------------------------------------------------------------------
    // 2. CAPACIDAD "ZERO-CONFIG" (Auto-Aprovisionamiento)
    // ------------------------------------------------------------------
    let { data: configData } = await supabaseAdmin
      .from('agent_config')
      .select('*')
      .eq('is_active', true)
      .single();

    // Si la base de datos está vacía, la IA asume el control usando datos en memoria
    if (!configData) {
      console.log(`[Auto-Config] Base de datos vacía. Forzando conexión para: ${customerPhone}`);
      configData = {
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
        system_prompt: 'Eres un agente de IA en fase de pruebas. Confírmale al usuario de manera muy breve que has recibido su mensaje y que la conexión entre Evolution API, Supabase y Claude está operativa.'
      };
    }
    const config = configData;

    // ------------------------------------------------------------------
    // 3. AUTO-CREACIÓN DE SESIÓN INVISIBLE
    // ------------------------------------------------------------------
    let { data: session } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('*')
      .eq('customer_phone', customerPhone)
      .single();

    if (!session) {
      const { data: newSession, error: sessionErr } = await supabaseAdmin
        .from('whatsapp_sessions')
        .insert({ 
          customer_phone: customerPhone,
          customer_name: IS_TEST_NUMBER ? 'Admin Pruebas (+57)' : (body?.data?.pushName || 'Usuario')
        })
        .select()
        .single();

      if (sessionErr) return NextResponse.json({ error: 'DB_SESSION_ERROR' });
      session = newSession;
    }
    const currentSession = session;


    // 5. Registrar mensaje de entrada en la BD
    await supabaseAdmin.from('messages').insert({
      session_id: currentSession.id,
      role: 'user',
      content: userMessageContent,
    });

    // 6. Cargar el contexto histórico automatizado
    const { data: historyMessages } = await supabaseAdmin
      .from('messages')
      .select('role, content')
      .eq('session_id', currentSession.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const formattedHistory = (historyMessages || [])
      .reverse()
      .map((msg) => ({
        role: msg.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: msg.content,
      }));

    // 7. Inferencia del modelo Claude (con fallback seguro)
    let aiReplyText = '';
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    if (anthropicApiKey && !anthropicApiKey.includes('...')) {
      try {
        const response = await anthropic.messages.create({
          model: config.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          temperature: Number(config.temperature) || 0.7,
          system: config.system_prompt,
          messages: formattedHistory,
        });

        if (response.content?.[0]?.type === 'text') {
          aiReplyText = response.content[0].text;
        }
      } catch (err: any) {
        console.error('[Anthropic Error]:', err?.message || err);
      }
    }

    if (!aiReplyText) {
      aiReplyText = `[Agente IA Operativo] Recibí tu mensaje: "${userMessageContent}". Conexión activa entre Evolution API y Supabase.`;
    }

    // 8. Guardar la respuesta de la IA
    await supabaseAdmin.from('messages').insert({
      session_id: currentSession.id,
      role: 'assistant',
      content: aiReplyText,
    });

    // 9. Envío automático por la API de Evolution
    await sendEvolutionMessage(instanceName, customerPhone, aiReplyText);

    return NextResponse.json({ status: 'success', phone: customerPhone, reply: aiReplyText }, { status: 200 });

  } catch (error) {
    console.error('Error automatizado en el Webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// HELPERS DE AUDIO Y MENSAJERÍA
// ------------------------------------------------------------------

async function getAudioBufferFromEvolution(instance: string, messageData: any): Promise<Buffer | null> {
  try {
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    if (!baseUrl || !apiKey) return null;

    const response = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instance}`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: messageData,
        convertToMp3: true,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.base64) return null;

    const base64Data = data.base64.replace(/^data:audio\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  } catch (error) {
    console.error('Error descargando audio:', error);
    return null;
  }
}

async function transcribeAudioWithWhisper(audioBuffer: Buffer): Promise<string> {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'demo-key') {
      return '[Transcripción de prueba]';
    }

    const audioFile = await toFile(audioBuffer, 'voice_note.mp3', { type: 'audio/mp3' });
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'es',
    });
    return transcription.text;
  } catch (error) {
    console.error('Error en Whisper:', error);
    return '';
  }
}

async function sendEvolutionMessage(instance: string, toPhone: string, text: string) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!baseUrl || !apiKey) {
    console.log(`[Evolution API sin credenciales] Mensaje automatizado para ${toPhone}: ${text}`);
    return;
  }

  await fetch(`${baseUrl}/message/sendText/${instance}`, {
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
}
