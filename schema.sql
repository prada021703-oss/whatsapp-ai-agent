-- ============================================================
-- WhatsApp AI Agent · Schema SQL PostgreSQL (Supabase)
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── EXTENSIONES ────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── TABLA: agent_config ─────────────────────────────────────
-- Configuración general del Agente
create table if not exists public.agent_config (
  id            uuid primary key default gen_random_uuid(),
  phone_number  text unique not null,
  system_prompt text not null default 'Eres un asistente útil.',
  model         text default 'claude-3-5-sonnet',
  temperature   numeric default 0.7,
  is_active     boolean default true,
  updated_at    timestamp with time zone default now()
);

comment on table public.agent_config is
  'Configuración general del Agente IA vinculada a un número de teléfono.';

-- ─── TABLA: whatsapp_sessions ────────────────────────────────
-- Sesiones por cliente de WhatsApp
create table if not exists public.whatsapp_sessions (
  id             uuid primary key default gen_random_uuid(),
  customer_phone text unique not null,
  customer_name  text,
  created_at     timestamp with time zone default now()
);

comment on table public.whatsapp_sessions is
  'Sesiones individuales por cada cliente de WhatsApp.';

-- ─── TABLA: messages ─────────────────────────────────────────
-- Historial de conversaciones
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.whatsapp_sessions(id) on delete cascade,
  role       text check (role in ('user', 'assistant', 'system')),
  content    text not null,
  created_at timestamp with time zone default now()
);

comment on table public.messages is
  'Historial de mensajes de cada conversación.';

-- ─── ÍNDICES DE RENDIMIENTO ──────────────────────────────────
create index if not exists idx_sessions_customer_phone on public.whatsapp_sessions(customer_phone);
create index if not exists idx_messages_session_created on public.messages(session_id, created_at desc);

-- ─── VALOR INICIAL DEFAULT EN agent_config ───────────────────
insert into public.agent_config (phone_number, system_prompt, model, temperature, is_active)
values (
  'default',
  'Eres un asistente de WhatsApp amigable y profesional. Responde de forma concisa y clara en el mismo idioma que el usuario.',
  'claude-3-5-sonnet',
  0.7,
  true
)
on conflict (phone_number) do nothing;

-- ─── TRIGGER: updated_at AUTOMÁTICO EN agent_config ───────────
create or replace function public.update_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_agent_config_updated_at
  before update on public.agent_config
  for each row execute function public.update_timestamp();

-- ─── ROW LEVEL SECURITY (RLS) ────────────────────────────────
alter table public.agent_config      enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.messages          enable row level security;

-- Políticas para Service Role (Backend Express)
create policy "service_role_all_agent_config"
  on public.agent_config for all
  using (true) with check (true);

create policy "service_role_all_whatsapp_sessions"
  on public.whatsapp_sessions for all
  using (true) with check (true);

create policy "service_role_all_messages"
  on public.messages for all
  using (true) with check (true);

-- Políticas por auth.uid() para dashboard multi-usuario
create policy "authenticated_user_read_agent_config"
  on public.agent_config for select
  to authenticated
  using (true);

create policy "authenticated_user_update_agent_config"
  on public.agent_config for update
  to authenticated
  using (true);

create policy "authenticated_user_read_sessions"
  on public.whatsapp_sessions for select
  to authenticated
  using (true);

create policy "authenticated_user_read_messages"
  on public.messages for select
  to authenticated
  using (true);

-- ─── HABILITAR SUPABASE REALTIME ──────────────────────────────
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.whatsapp_sessions;
