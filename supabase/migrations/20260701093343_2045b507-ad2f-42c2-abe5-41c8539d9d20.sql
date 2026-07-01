ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_check CHECK (
  deleted_at IS NOT NULL OR body IS NOT NULL OR attachment_path IS NOT NULL
);