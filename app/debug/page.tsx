'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function DebuggerPage() {
  const [data, setData] = useState<any>({ sessions: [], messages: [], error: null });

  useEffect(() => {
    async function checkDB() {
      try {
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Faltan variables de entorno .env.local");

        const { data: sessions, error: err1 } = await supabase.from('whatsapp_sessions').select('*');
        const { data: messages, error: err2 } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(20);

        setData({ sessions, messages, error: err1 || err2 });
      } catch (err: any) {
        setData({ ...data, error: err.message });
      }
    }
    checkDB();
  }, []);

  return (
    <div className="p-10 bg-black text-green-400 font-mono text-sm min-h-screen">
      <h1 className="text-xl font-bold mb-4">🔧 DIAGNÓSTICO DE SUPABASE</h1>

      {data.error && (
        <div className="text-red-500 bg-red-900/20 p-4 rounded mb-4">
          ERROR: {JSON.stringify(data.error)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-green-800 p-4">
          <h2 className="font-bold mb-2">SESIONES ({data.sessions?.length || 0})</h2>
          <pre className="overflow-auto max-h-96 text-xs">{JSON.stringify(data.sessions, null, 2)}</pre>
        </div>
        <div className="border border-green-800 p-4">
          <h2 className="font-bold mb-2">ÚLTIMOS MENSAJES ({data.messages?.length || 0})</h2>
          <pre className="overflow-auto max-h-96 text-xs">{JSON.stringify(data.messages, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
