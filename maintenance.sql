-- ============================================================
-- WhatsApp AI Agent · Scripts de Mantenimiento SQL
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── Eliminar sesiones y mensajes de prueba erróneos ─────────
-- Conserva únicamente la sesión del número de teléfono de prueba.
-- Los mensajes se eliminan automáticamente por CASCADE.
DELETE FROM public.whatsapp_sessions
WHERE customer_phone != '573214493071';

-- ─── Verificar sesiones restantes ────────────────────────────
SELECT id, customer_phone, customer_name, created_at
FROM public.whatsapp_sessions
ORDER BY created_at DESC;

-- ─── Verificar mensajes restantes ────────────────────────────
SELECT m.id, ws.customer_phone, m.role, LEFT(m.content, 60) AS preview, m.created_at
FROM public.messages m
JOIN public.whatsapp_sessions ws ON ws.id = m.session_id
ORDER BY m.created_at DESC
LIMIT 20;

-- ─── Reset completo (CUIDADO: borra TODO) ────────────────────
-- Descomentar solo si se desea limpiar completamente la BD de pruebas.
-- TRUNCATE public.messages, public.whatsapp_sessions RESTART IDENTITY CASCADE;

-- ─── RLS (Row Level Security) ─────────────────────────────────
-- El backend usa SUPABASE_SERVICE_ROLE_KEY → siempre saltea RLS.
-- El dashboard usa NEXT_PUBLIC_SUPABASE_ANON_KEY → necesita políticas RLS
-- o bien RLS desactivado (válido en proyectos de un solo tenant).

-- Desactivar RLS (acceso público total desde el Anon Key):
ALTER TABLE public.whatsapp_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

-- Reactivar RLS (cuando se agreguen políticas explícitas):
-- ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
