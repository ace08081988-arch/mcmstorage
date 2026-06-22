
CREATE TABLE public.security_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  finding_count int NOT NULL DEFAULT 0,
  new_count int NOT NULL DEFAULT 0,
  resolved_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running'
);
GRANT SELECT ON public.security_scan_runs TO authenticated;
GRANT ALL ON public.security_scan_runs TO service_role;
ALTER TABLE public.security_scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssr_admin_read" ON public.security_scan_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.security_scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  severity text NOT NULL DEFAULT 'warn',
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_run_id uuid REFERENCES public.security_scan_runs(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  notified_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX security_findings_open_idx ON public.security_scan_findings (last_seen_at DESC) WHERE resolved_at IS NULL;
GRANT SELECT ON public.security_scan_findings TO authenticated;
GRANT ALL ON public.security_scan_findings TO service_role;
ALTER TABLE public.security_scan_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssf_admin_read" ON public.security_scan_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.run_internal_security_scan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_run_id uuid;
  v_rec record;
  v_total int := 0;
  v_new int := 0;
  v_resolved int := 0;
  v_role text := auth.jwt() ->> 'role';
  v_started timestamptz := now();
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.security_scan_runs(status, started_at)
    VALUES ('running', v_started) RETURNING id INTO v_run_id;

  -- Check 1: tabel public tanpa RLS
  FOR v_rec IN
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    INSERT INTO public.security_scan_findings(code, severity, title, detail, last_run_id)
      VALUES ('rls_disabled:'||v_rec.name, 'critical',
              'RLS dimatikan: '||v_rec.name,
              jsonb_build_object('table', v_rec.name), v_run_id)
    ON CONFLICT (code) DO UPDATE
      SET last_seen_at=now(), last_run_id=v_run_id,
          resolved_at=NULL,
          notified_at = CASE WHEN security_scan_findings.resolved_at IS NOT NULL THEN NULL ELSE security_scan_findings.notified_at END;
  END LOOP;

  -- Check 2: policy permisif (USING true / WITH CHECK true) yang menyasar role bukan service_role saja
  FOR v_rec IN
    SELECT tablename, policyname, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual = 'true' OR with_check = 'true')
      AND NOT (roles::text[] <@ ARRAY['service_role'])
  LOOP
    INSERT INTO public.security_scan_findings(code, severity, title, detail, last_run_id)
      VALUES ('policy_permissive:'||v_rec.tablename||'/'||v_rec.policyname, 'warn',
              'Policy permisif '||v_rec.tablename||'.'||v_rec.policyname,
              jsonb_build_object('table',v_rec.tablename,'policy',v_rec.policyname,
                                 'qual',v_rec.qual,'with_check',v_rec.with_check,'roles',v_rec.roles),
              v_run_id)
    ON CONFLICT (code) DO UPDATE
      SET last_seen_at=now(), last_run_id=v_run_id,
          resolved_at=NULL,
          notified_at = CASE WHEN security_scan_findings.resolved_at IS NOT NULL THEN NULL ELSE security_scan_findings.notified_at END;
  END LOOP;

  -- Check 3: bucket storage publik
  FOR v_rec IN SELECT id FROM storage.buckets WHERE public=true LOOP
    INSERT INTO public.security_scan_findings(code, severity, title, detail, last_run_id)
      VALUES ('public_bucket:'||v_rec.id, 'warn',
              'Bucket storage publik: '||v_rec.id,
              jsonb_build_object('bucket', v_rec.id), v_run_id)
    ON CONFLICT (code) DO UPDATE
      SET last_seen_at=now(), last_run_id=v_run_id, resolved_at=NULL,
          notified_at = CASE WHEN security_scan_findings.resolved_at IS NOT NULL THEN NULL ELSE security_scan_findings.notified_at END;
  END LOOP;

  -- Check 4: lonjakan percobaan PIN tugas (24 jam terakhir, belum di-acknowledge)
  FOR v_rec IN
    SELECT task_id, count(*) AS n, max(failure_count) AS max_fail, max(owner_user_id) AS owner_id
    FROM public.prep_pin_alerts
    WHERE created_at > now() - interval '24 hours' AND acknowledged_at IS NULL
    GROUP BY task_id
  LOOP
    INSERT INTO public.security_scan_findings(code, severity, title, detail, last_run_id)
      VALUES ('prep_pin_brute:'||v_rec.task_id, 'warn',
              'Percobaan PIN tugas mencurigakan',
              jsonb_build_object('task_id', v_rec.task_id, 'alerts_24h', v_rec.n,
                                 'max_failures', v_rec.max_fail, 'owner_user_id', v_rec.owner_id),
              v_run_id)
    ON CONFLICT (code) DO UPDATE
      SET last_seen_at=now(), last_run_id=v_run_id, resolved_at=NULL,
          detail = EXCLUDED.detail,
          notified_at = CASE WHEN security_scan_findings.resolved_at IS NOT NULL THEN NULL ELSE security_scan_findings.notified_at END;
  END LOOP;

  -- Tandai temuan yang tidak terlihat di run ini sebagai resolved
  WITH resolved AS (
    UPDATE public.security_scan_findings
      SET resolved_at = now()
      WHERE resolved_at IS NULL AND (last_run_id IS DISTINCT FROM v_run_id)
      RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM resolved;

  SELECT count(*),
         count(*) FILTER (WHERE first_seen_at >= v_started)
    INTO v_total, v_new
    FROM public.security_scan_findings
    WHERE last_run_id = v_run_id;

  UPDATE public.security_scan_runs
    SET finished_at = now(), status = 'done',
        finding_count = v_total, new_count = v_new, resolved_count = v_resolved
    WHERE id = v_run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id,
                            'total', v_total, 'new', v_new, 'resolved', v_resolved);
END $$;

GRANT EXECUTE ON FUNCTION public.run_internal_security_scan() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_internal_security_scan() TO authenticated;

CREATE OR REPLACE FUNCTION public.security_findings_acknowledge(_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.security_scan_findings
    SET acknowledged_at = now(), acknowledged_by = auth.uid()
    WHERE id = ANY(_ids) AND acknowledged_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public.security_findings_acknowledge(uuid[]) TO authenticated;
