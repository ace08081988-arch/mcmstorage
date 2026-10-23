-- Existing installations do not rerun the column-creation migration.
-- saveWorkerPortalConfig keeps the caller's authenticated JWT, so a policy
-- alone is insufficient once public-schema default DML grants are removed.
-- Do not grant table-wide UPDATE, INSERT, DELETE, or access to anon.
GRANT UPDATE (worker_portal_config) ON public.app_settings TO authenticated;
