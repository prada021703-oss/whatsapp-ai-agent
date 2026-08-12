# WhatsApp AI Agent

Este repositorio contiene un **bot de IA para WhatsApp** basado en Node.js, Express, Twilio y OpenAI.

> **Mejora:** Esta versiÃ³n incluye una limitaciÃ³n del historial de conversaciÃ³n a los Ãºltimos 30 mensajes y registro del uso total de tokens por respuesta, para evitar fugas de consumo.


## ðŸ“ Estructura del proyecto
```
whatsapp_ai_agent/
â”œâ”€ .env.example            # Plantilla de variables de entorno (cÃ³piala a .env)
â”œâ”€ Dockerfile              # Imagen Docker para despliegue
â”œâ”€ package.json            # Dependencias y scripts
â”œâ”€ server.js               # Servidor Express + webhook de Twilio
â”œâ”€ ai.js                   # Wrapper para la API de OpenAI
â”œâ”€ twilio_client.js        # Cliente que envÃ­a mensajes vÃ­a Twilio
â”œâ”€ storage.js (opcional)   # Persistencia simple en JSON (no incluido aquÃ­)
â””â”€ README.md (este archivo)
```

## âš™ï¸ Requisitos
- **Node.js (v20+)** con npm **o** Docker instalado.
- Cuenta de **Twilio** con acceso al *WhatsApp Sandbox*.
- **Clave API de OpenAI** (u otro modelo compatible).
- (Opcional) **ngrok** para exponer el servidor local a internet.

## ðŸš€ Opciones de despliegue
### 1. Ejecutar localmente (recomendado para pruebas rÃ¡pidas)
1. Instala Node.js desde https://nodejs.org/en/download/ (marca *Add to PATH*).
2. ```powershell
   cd "C:/Users/prada/Desktop/kalsita 2/whatsapp_ai_agent"
   npm install
   ```
3. Copia `.env.example` a `.env` y rellena tus credenciales:
   ```
   TWILIO_ACCOUNT_SID=xxxx
   TWILIO_AUTH_TOKEN=xxxx
   TWILIO_WHATSAPP_NUMBER=+14155238886   # nÃºmero sandbox
   OPENAI_API_KEY=sk-xxxx
   OPENAI_MODEL=gpt-3.5-turbo
   PORT=3000
   ```
4. Inicia el servidor en modo desarrollo:
   ```powershell
   npm run dev
   ```
5. Exponlo con ngrok (descarga desde https://ngrok.com/download):
   ```powershell
   ngrok http 3000
   ```
   Copia la URL pÃºblica (p.ej. `https://abcd1234.ngrok.io`) y configÃºrala en la consola de Twilio â†’ *WhatsApp Sandbox â†’ When a message comes in*.
6. EnvÃ­a un mensaje al nÃºmero sandbox de WhatsApp y deberÃ­as recibir una respuesta generada por la IA.

### 2. Despliegue con Docker (si Docker estÃ¡ disponible)
1. **Construir la imagen**
   ```bash
   cd "C:/Users/prada/Desktop/kalsita 2/whatsapp_ai_agent"
   docker build -t whatsapp-ai-agent .
   ```
2. **Crear un archivo `.env`** con tus credenciales (ver arriba).
3. **Ejecutar el contenedor**
   ```bash
   docker run -p 3000:3000 --env-file .env whatsapp-ai-agent
   ```
4. Usa ngrok (o cualquier tÃºnel) para exponer el puerto 3000 y conecta Twilio al webhook.

### 3. Deploy en una plataforma cloud (Render, Railway, Vercel, etc.)
- Sube el contenido a un repositorio Git.
- Configura las variables de entorno en la plataforma.
- Define el *build command*: `npm install` y el *start command*: `npm start` o `node server.js`.
- La plataforma te proporcionarÃ¡ una URL pÃºblica que puedes usar como webhook.

## ðŸ› ï¸ Extensiones opcionales
- **Persistencia**: Implementa `storage.js` con un simple objeto JSON por nÃºmero de telÃ©fono (ya estÃ¡ esqueleto en el plan, pero no es necesario para el flujo bÃ¡sico).
- **Comando `/help`**: AÃ±ade lÃ³gica en `server.js` para responder a `msg.trim().toLowerCase() === '/help'` con un mensaje de ayuda.
- **Manejo de medios**: Usa la API de Twilio para descargar y reenviar imÃ¡genes, documentos, etc.

## ðŸ“‹ VerificaciÃ³n
1. **Prueba automÃ¡tica** (opcional):
   ```bash
   npm test
   ```
   (El proyecto incluye un test bÃ¡sico con Jest y Supertest que simula una peticiÃ³n al webhook.)
2. **Prueba manual**:
   - EnvÃ­a `Hola` al nÃºmero sandbox.
   - DeberÃ­as recibir una respuesta como `Â¡Hola! Soy tu asistente IAâ€¦`.

---
**Â¡Listo!** Con estos pasos deberÃ­as tener tu agente IA operando en WhatsApp. Si prefieres que empaquete todo en un archivo ZIP para que lo descargues y lo ejecutes directamente, avÃ­same y lo generarÃ©.
