'use client';
import { useState } from 'react';

export default function WhatsAppConnector() {
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Esperando acción...');

  const fetchQRCode = async () => {
    setStatus('Generando código QR...');
    setQrBase64(null);
    
    try {
      const res = await fetch('/api/whatsapp/qr');
      const data = await res.json();
      
      // Evolution API devuelve el QR en la propiedad 'base64'
      if (data?.base64) {
        setQrBase64(data.base64);
        setStatus('QR Generado. Escanea desde: WhatsApp > Dispositivos Vinculados');
      } else if (data?.state === 'open') {
        setStatus('La instancia ya está conectada y operativa.');
      } else {
        setStatus('Error al obtener QR. Verifica que la instancia exista.');
      }
    } catch (error) {
      setStatus('Error de conexión con el servidor.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-[#111b21] border border-zinc-800 rounded-xl max-w-sm text-zinc-200">
      <h2 className="text-lg font-bold mb-4">Vincular Dispositivo</h2>
      
      <button 
        onClick={fetchQRCode}
        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors mb-4"
      >
        Generar Código QR
      </button>

      <div className="text-sm text-zinc-400 mb-4 text-center">
        {status}
      </div>

      {qrBase64 && (
        <div className="bg-white p-4 rounded-lg shadow-xl">
          <img src={qrBase64} alt="Escanea este QR con WhatsApp" className="w-64 h-64" />
        </div>
      )}
    </div>
  );
}
