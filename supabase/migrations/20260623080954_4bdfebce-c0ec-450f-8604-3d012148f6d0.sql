-- Lock immutable columns on messages: sender can edit body but not move
-- the message into a different conversation or change the sender_id.
CREATE OR REPLACE FUNCTION public.messages_lock_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'conversation_id is immutable on messages'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'sender_id is immutable on messages'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_lock_immutable_columns ON public.messages;
CREATE TRIGGER messages_lock_immutable_columns
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_lock_immutable_columns();

-- Lock immutable columns on conversation_members: a row can only update
-- soft state (last_read_at, role transitions handled elsewhere). The
-- membership "identity" (which conversation + which user) is fixed.
CREATE OR REPLACE FUNCTION public.conversation_members_lock_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'conversation_id is immutable on conversation_members'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable on conversation_members'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conversation_members_lock_immutable_columns ON public.conversation_members;
CREATE TRIGGER conversation_members_lock_immutable_columns
  BEFORE UPDATE ON public.conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.conversation_members_lock_immutable_columns();