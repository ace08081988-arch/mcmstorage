ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS worker_portal_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The admin server function uses the caller's authenticated JWT, not service_role.
-- Keep writes restricted to this column; the existing admin-only UPDATE RLS
-- policy still decides which authenticated users may change the singleton row.
GRANT UPDATE (worker_portal_config) ON public.app_settings TO authenticated;
