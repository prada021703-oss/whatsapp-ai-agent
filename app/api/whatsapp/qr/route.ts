import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default';

  // Si existen credenciales de Evolution API reales, consultamos el servidor de Evolution API
  if (baseUrl && apiKey && !baseUrl.includes('tu-instancia') && !apiKey.includes('tu_global')) {
    try {
      const res = await fetch(`${baseUrl}/instance/connect/${instance}`, {
        method: 'GET',
        headers: { 'apikey': apiKey }
      });
      const data = await res.json();
      if (data?.base64 || data?.code || data?.state) {
        return NextResponse.json(data);
      }
    } catch (e) {}
  }

  // Fallback: Si se está utilizando la conexión local Baileys
  const qrPath = path.join(process.cwd(), 'public', 'qr.txt');
  if (fs.existsSync(qrPath)) {
    const qrString = fs.readFileSync(qrPath, 'utf8');
    const base64Url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrString)}`;
    return NextResponse.json({ base64: base64Url });
  }

  const statusPath = path.join(process.cwd(), 'public', 'status.txt');
  if (fs.existsSync(statusPath) && fs.readFileSync(statusPath, 'utf8').trim() === 'connected') {
    return NextResponse.json({ state: 'open' });
  }

  return NextResponse.json({ error: 'Sin QR disponible. Inicia la conexión.' }, { status: 404 });
}
