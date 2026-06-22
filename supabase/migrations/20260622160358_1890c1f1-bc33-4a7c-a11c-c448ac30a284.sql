
DROP TABLE IF EXISTS public.employees CASCADE;

-- staff_contacts: daftar kontak pegawai sederhana
CREATE TABLE public.staff_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  wa_phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_contacts TO authenticated;
GRANT ALL ON public.staff_contacts TO service_role;
ALTER TABLE public.staff_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manage staff_contacts" ON public.staff_contacts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER staff_contacts_set_updated
  BEFORE UPDATE ON public.staff_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX staff_contacts_user_idx ON public.staff_contacts(user_id, created_at DESC);

-- self_prep_items: hasil penyiapan mandiri
CREATE TABLE public.self_prep_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  photo_path text,
  location_url text,
  note text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','sent')),
  wa_target text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.self_prep_items TO authenticated;
GRANT ALL ON public.self_prep_items TO service_role;
ALTER TABLE public.self_prep_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manage self_prep_items" ON public.self_prep_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER self_prep_items_set_updated
  BEFORE UPDATE ON public.self_prep_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX self_prep_items_user_status_idx ON public.self_prep_items(user_id, status, created_at DESC);
