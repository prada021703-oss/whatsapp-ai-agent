/**
 * types.ts
 * Definición de tipos de TypeScript para el proyecto WhatsApp AI Agent.
 */

export interface AgentConfig {
  id: string;
  phone_number: string;
  system_prompt: string;
  model: string;
  temperature: number;
  is_active: boolean;
}

export interface WhatsAppSession {
  id: string;
  customer_phone: string;
  customer_name?: string;
}

export interface MessageRecord {
  id?: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}
