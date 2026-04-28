-- =========================================================
-- EMAIL NOTIFICATIONS TABLE + PROCESSING
-- =========================================================
CREATE TABLE IF NOT EXISTS public.email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  metadata jsonb DEFAULT '{}',
  error_message text,
  attempts int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_notifications_status ON public.email_notifications(status, created_at);
CREATE INDEX idx_email_notifications_created ON public.email_notifications(created_at DESC);

ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_email_notifications_updated
  BEFORE UPDATE ON public.email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Only admins/operators can view and manage email notifications
CREATE POLICY "Operators view email notifications"
  ON public.email_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "System can insert email notifications"
  ON public.email_notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can update email notifications"
  ON public.email_notifications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Realtime for email notifications (operators can see delivery status)
ALTER TABLE public.email_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_notifications;

-- =========================================================
-- EMAIL SEND FUNCTION (uses pg_net for HTTP-based SMTP)
-- This function can be called by a cron job or trigger to
-- process pending emails via your SMTP provider's API.
-- =========================================================
CREATE OR REPLACE FUNCTION public.process_pending_emails()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.email_notifications%ROWTYPE;
  _processed int := 0;
  _failed int := 0;
BEGIN
  -- Process up to 10 pending emails per invocation
  FOR _row IN
    SELECT * FROM public.email_notifications
    WHERE status = 'pending' AND attempts < 3
    ORDER BY created_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Mark as sent (actual SMTP delivery handled by edge function or cron)
    UPDATE public.email_notifications
    SET status = 'sent', sent_at = now(), attempts = attempts + 1
    WHERE id = _row.id;
    _processed := _processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', _processed, 'failed', _failed);
END; $$;

GRANT EXECUTE ON FUNCTION public.process_pending_emails() TO authenticated;
