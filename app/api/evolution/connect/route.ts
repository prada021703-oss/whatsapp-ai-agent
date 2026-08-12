import { NextResponse } from 'next/server';

export async function GET() {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'default';

  if (!baseUrl || !apiKey || baseUrl.includes('tu-instancia') || apiKey.includes('tu_global')) {
    return NextResponse.json(
      { error: 'Configura EVOLUTION_API_URL y EVOLUTION_API_KEY reales en .env' },
      { status: 400 }
    );
  }

  try {
    // Solicita a Evolution API que inicie la conexión y devuelva el QR
    const res = await fetch(`${baseUrl}/instance/connect/${instance}`, {
      method: 'GET',
      headers: { 'apikey': apiKey as string }
    });
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Error al generar QR de Evolution API' }, { status: 500 });
  }
}
