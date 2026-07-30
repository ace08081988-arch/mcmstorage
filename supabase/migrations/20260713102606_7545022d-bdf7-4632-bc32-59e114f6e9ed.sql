-- Add pin_updated_at column to prep_tasks
ALTER TABLE public.prep_tasks
  ADD COLUMN IF NOT EXISTS pin_updated_at timestamptz;

-- Backfill: existing rows get created_at as their baseline pin timestamp
UPDATE public.prep_tasks
   SET pin_updated_at = created_at
 WHERE pin_updated_at IS NULL;

-- Enforce NOT NULL with default = now() for future inserts
ALTER TABLE public.prep_tasks
  ALTER COLUMN pin_updated_at SET DEFAULT now();
ALTER TABLE public.prep_tasks
  ALTER COLUMN pin_updated_at SET NOT NULL;

-- Trigger function: bump pin_updated_at whenever pin_hash actually changes
CREATE OR REPLACE FUNCTION public.prep_tasks_track_pin_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.pin_updated_at IS NULL THEN
      NEW.pin_updated_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
    NEW.pin_updated_at := now();
  ELSE
    -- Preserve prior value on unrelated updates
    NEW.pin_updated_at := OLD.pin_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prep_tasks_track_pin_change ON public.prep_tasks;
CREATE TRIGGER trg_prep_tasks_track_pin_change
BEFORE INSERT OR UPDATE ON public.prep_tasks
FOR EACH ROW
EXECUTE FUNCTION public.prep_tasks_track_pin_change();