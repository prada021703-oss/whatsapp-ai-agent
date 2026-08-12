'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ChatLite() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('whatsapp_sessions').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setSessions(data);
      });
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const loadMsgs = async () => {
      const { data } = await supabase.from('messages').select('*').eq('session_id', activeId).order('created_at');
      if (data) setMessages(data);
    };
    loadMsgs();

    const channel = supabase.channel('chat').on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${activeId}`
    }, (payload) => setMessages((prev) => [...prev, payload.new])).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeId]);

  return (
    <div className="flex h-[80vh] w-full border border-gray-700 bg-gray-900 text-white rounded-lg overflow-hidden">
      {/* Panel Izquierdo */}
      <div className="w-1/3 border-r border-gray-700 overflow-y-auto">
        <div className="bg-gray-800 p-4 font-bold">Chats</div>
        {sessions.map(s => (
          <div key={s.id} onClick={() => setActiveId(s.id)} className={`p-4 cursor-pointer border-b border-gray-800 ${activeId === s.id ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
            {s.customer_phone}
          </div>
        ))}
      </div>

      {/* Panel Derecho */}
      <div className="w-2/3 flex flex-col bg-gray-950">
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {!activeId ? <p className="text-gray-500 text-center mt-10">Selecciona un chat</p> :
            messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`p-3 max-w-[70%] rounded-lg ${m.role === 'user' ? 'bg-gray-700' : 'bg-emerald-700'}`}>
                  <span className="text-xs text-gray-300 block mb-1">{m.role === 'user' ? 'Cliente' : 'IA'}</span>
                  {m.content}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
