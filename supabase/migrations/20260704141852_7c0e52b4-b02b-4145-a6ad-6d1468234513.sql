ALTER TABLE public.self_prep_items
  ADD COLUMN IF NOT EXISTS sent_channel text CHECK (sent_channel IN ('wa','chat')),
  ADD COLUMN IF NOT EXISTS sent_to text,
  ADD COLUMN IF NOT EXISTS sent_summary text;