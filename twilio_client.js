const twilio = require('twilio');
require('dotenv').config();

let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const fromNumber = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || ''}`;

/**
 * Sends a WhatsApp message using Twilio.
 * @param {string} to   - The destination phone number.
 * @param {string} body - Text to send.
 */
async function sendMessage(to, body) {
  if (!client) {
    console.log(`[Twilio deshabilitado] Mensaje para ${to}: ${body}`);
    return;
  }
  return client.messages.create({
    from: fromNumber,
    to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    body,
  });
}

module.exports = { sendMessage };
