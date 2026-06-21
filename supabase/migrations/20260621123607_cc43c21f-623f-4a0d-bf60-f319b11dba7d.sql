
-- 1) Tabel pegawai
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  note text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner kelola pegawai sendiri"
  ON public.employees FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_employees_user ON public.employees(user_id, archived_at);

-- 2) Tautkan tugas ke pegawai (opsional/nullable agar tugas lama tetap valid)
ALTER TABLE public.prep_tasks
  ADD COLUMN employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX idx_prep_tasks_employee ON public.prep_tasks(employee_id);
