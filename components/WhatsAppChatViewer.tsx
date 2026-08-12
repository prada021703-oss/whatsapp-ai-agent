'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  User, 
  Mic, 
  MessageSquare, 
  Search, 
  Phone, 
  MoreVertical, 
  CheckCheck, 
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Inicializar cliente Supabase público (Anon Key — solo lectura en RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface WhatsAppSession {
  id: string;
  customer_phone: string;
  customer_name?: string;
  created_at?: string;
}

interface MessageRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export default function WhatsAppChatViewer() {
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<WhatsAppSession | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Cargar lista de sesiones/chats
  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setSessions(data);
      if (data.length > 0 && !selectedSession) {
        setSelectedSession(data[0]);
      }
    }
  };

  // 2. Cargar mensajes cuando se selecciona un chat
  useEffect(() => {
    if (!selectedSession) return;

    const fetchMessages = async () => {
      setLoadingMessages(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', selectedSession.id)
        .order('created_at', { ascending: true });

      if (data) setMessages(data);
      setLoadingMessages(false);
      scrollToBottom();
    };

    fetchMessages();

    // Suscripción Realtime a nuevos mensajes en esta sesión
    const channel = supabase
      .channel(`realtime-chat-${selectedSession.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${selectedSession.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRecord]);
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSession]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const filteredSessions = sessions.filter(
    (s) =>
      s.customer_phone.includes(searchTerm) ||
      (s.customer_name && s.customer_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="flex h-[calc(100vh-2rem)] w-full max-w-7xl mx-auto overflow-hidden rounded-xl border border-zinc-800 bg-[#111b21] text-zinc-100 shadow-2xl">
      
      {/* ------------------------------------------------------------------ */}
      {/* PANEL IZQUIERDO: LISTA DE SESIONES (30% ANCHO)                    */}
      {/* ------------------------------------------------------------------ */}
      <div className={`w-full md:w-[30%] flex-col border-r border-zinc-800 bg-[#111b21] ${selectedSession ? 'hidden md:flex' : 'flex'}`}>

        {/* Cabecera Sidebar */}
        <div className="flex items-center justify-between bg-[#202c33] p-4 text-zinc-200">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white font-bold">
              WA
            </div>
            <h2 className="font-semibold text-lg">Sesiones</h2>
          </div>
        </div>

        {/* Búsqueda */}
        <div className="p-2 bg-[#111b21]">
          <div className="flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-1.5 text-sm text-zinc-400">
            <Search className="h-4 w-4" />
            <input
              type="text"
              placeholder="Buscar teléfono o nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-zinc-200 outline-none placeholder:text-zinc-500"
            />
          </div>
        </div>

        {/* Lista de Sesiones */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
          {filteredSessions.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">
              No se encontraron conversaciones.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isSelected = selectedSession?.id === session.id;
              return (
                <div
                  key={session.id}
                  onClick={() => setSelectedSession(session)}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors ${
                    isSelected ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]'
                  }`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-zinc-300">
                    <User className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm text-zinc-100 truncate">
                        {session.customer_name || session.customer_phone}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-400 truncate">
                      +{session.customer_phone}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* PANEL DERECHO: DETALLE DE CONVERSACIÓN (70% ANCHO)                 */}
      {/* ------------------------------------------------------------------ */}
      <div className={`w-full md:w-[70%] flex-col bg-[#0b141a] relative ${!selectedSession ? 'hidden md:flex' : 'flex'}`}>

        {selectedSession ? (
          <>
            {/* Cabecera del Chat Activo */}
            <div className="flex items-center justify-between bg-[#202c33] px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedSession(null)}
                  className="md:hidden text-zinc-400 hover:text-zinc-100"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-700 text-white font-semibold">
                  {selectedSession.customer_name?.[0] || 'U'}
                </div>
                <div>
                  <h3 className="font-medium text-sm text-zinc-100">
                    {selectedSession.customer_name || selectedSession.customer_phone}
                  </h3>
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Atendido por Agente IA
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-zinc-400">
                <Phone className="h-5 w-5 cursor-not-allowed opacity-50" />
                <MoreVertical className="h-5 w-5 cursor-pointer hover:text-zinc-200" />
              </div>
            </div>

            {/* Contenedor de Mensajes (WhatsApp Wall/Pattern background) */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(#1f2c34_1px,transparent_1px)] [background-size:16px_16px]"
            >
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  Cargando mensajes...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  No hay mensajes registrados en esta conversación.
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  const timeString = new Date(msg.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={msg.id}
                      className={`flex w-full ${isUser ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`relative max-w-[80%] md:max-w-[65%] rounded-lg px-3 py-2 text-sm shadow ${
                          isUser
                            ? 'bg-[#202c33] text-zinc-100 rounded-tl-none'
                            : 'bg-[#005c4b] text-white rounded-tr-none'
                        }`}
                      >
                        {/* Etiqueta del remitente */}
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-semibold tracking-wide opacity-80">
                          {isUser ? (
                            <>
                              <User className="h-3 w-3 text-zinc-400" />
                              <span className="text-zinc-400">Cliente</span>
                            </>
                          ) : (
                            <>
                              <Bot className="h-3 w-3 text-emerald-300" />
                              <span className="text-emerald-200">Claude Agent</span>
                            </>
                          )}
                        </div>

                        {/* Texto del mensaje */}
                        <p className="whitespace-pre-wrap leading-relaxed text-sm break-words">
                          {msg.content}
                        </p>

                        {/* Hora y Visto */}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60">
                          <span>{timeString}</span>
                          {!isUser && <CheckCheck className="h-3.5 w-3.5 text-sky-300" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Banner Inferior Informativo */}
            <div className="bg-[#202c33] p-3 border-t border-zinc-800 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-500" />
              <span>Modo lectura habilitado. Todas las respuestas son gestionadas automáticamente por el bot.</span>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-zinc-500 gap-3">
            <MessageSquare className="h-12 w-12 text-zinc-600" />
            <p className="text-sm">Selecciona una conversación del panel izquierdo para ver los detalles.</p>
          </div>
        )}
      </div>

    </div>
  );
}
