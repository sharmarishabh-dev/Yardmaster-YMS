-- =========================================================
-- SIGNUP TRIGGER
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, company_name, phone)
  VALUES (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          coalesce(new.raw_user_meta_data ->> 'company_name', ''),
          coalesce(new.raw_user_meta_data ->> 'phone', new.phone));
  BEGIN
    _role := coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'driver'::public.app_role);
  EXCEPTION WHEN others THEN _role := 'driver'::public.app_role;
  END;
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, _role);
  RETURN new;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- QR FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_qr_token(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tok public.appointment_qr_tokens%ROWTYPE; _truck public.trucks%ROWTYPE;
  _appt public.dock_appointments%ROWTYPE; _dock public.docks%ROWTYPE;
BEGIN
  SELECT * INTO _tok FROM public.appointment_qr_tokens WHERE token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_not_found'); END IF;
  IF _tok.purpose <> 'checkin' THEN RETURN jsonb_build_object('valid', false, 'reason', 'wrong_purpose'); END IF;
  IF _tok.expires_at < now() THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_expired'); END IF;
  IF _tok.single_use AND _tok.used_at IS NOT NULL THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_already_used', 'used_at', _tok.used_at); END IF;
  IF _tok.scope = 'appointment' THEN
    SELECT * INTO _appt FROM public.dock_appointments WHERE id = _tok.appointment_id;
    SELECT * INTO _dock FROM public.docks WHERE id = _appt.dock_id;
    IF _appt.truck_id IS NOT NULL THEN SELECT * INTO _truck FROM public.trucks WHERE id = _appt.truck_id; END IF;
  ELSE
    SELECT * INTO _truck FROM public.trucks WHERE id = _tok.truck_id;
    SELECT * INTO _appt FROM public.dock_appointments WHERE truck_id = _truck.id AND status IN ('scheduled', 'in_progress') ORDER BY starts_at ASC LIMIT 1;
    IF FOUND THEN SELECT * INTO _dock FROM public.docks WHERE id = _appt.dock_id; END IF;
  END IF;
  RETURN jsonb_build_object('valid', true, 'token_id', _tok.id, 'scope', _tok.scope,
    'truck', CASE WHEN _truck.id IS NOT NULL THEN jsonb_build_object('id', _truck.id, 'plate', _truck.plate, 'carrier', _truck.carrier, 'trailer_number', _truck.trailer_number, 'driver_name', _truck.driver_name, 'status', _truck.status, 'gate', _truck.gate) ELSE NULL END,
    'appointment', CASE WHEN _appt.id IS NOT NULL THEN jsonb_build_object('id', _appt.id, 'carrier', _appt.carrier, 'reference', _appt.reference, 'starts_at', _appt.starts_at, 'ends_at', _appt.ends_at, 'type', _appt.appointment_type, 'status', _appt.status, 'dock_code', _dock.code, 'dock_name', _dock.name) ELSE NULL END);
END; $function$;

CREATE OR REPLACE FUNCTION public.validate_qr_checkout(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tok public.appointment_qr_tokens%ROWTYPE; _truck public.trucks%ROWTYPE;
  _appt public.dock_appointments%ROWTYPE; _dock public.docks%ROWTYPE;
BEGIN
  SELECT * INTO _tok FROM public.appointment_qr_tokens WHERE token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_not_found'); END IF;
  IF _tok.purpose <> 'checkout' THEN RETURN jsonb_build_object('valid', false, 'reason', 'wrong_purpose'); END IF;
  IF _tok.expires_at < now() THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_expired'); END IF;
  IF _tok.single_use AND _tok.used_at IS NOT NULL THEN RETURN jsonb_build_object('valid', false, 'reason', 'token_already_used', 'used_at', _tok.used_at); END IF;
  IF _tok.scope = 'appointment' THEN
    SELECT * INTO _appt FROM public.dock_appointments WHERE id = _tok.appointment_id;
    SELECT * INTO _dock FROM public.docks WHERE id = _appt.dock_id;
    IF _appt.truck_id IS NOT NULL THEN SELECT * INTO _truck FROM public.trucks WHERE id = _appt.truck_id; END IF;
  ELSE
    SELECT * INTO _truck FROM public.trucks WHERE id = _tok.truck_id;
    SELECT * INTO _appt FROM public.dock_appointments WHERE truck_id = _truck.id AND status IN ('scheduled', 'in_progress') ORDER BY starts_at ASC LIMIT 1;
    IF FOUND THEN SELECT * INTO _dock FROM public.docks WHERE id = _appt.dock_id; END IF;
  END IF;
  RETURN jsonb_build_object('valid', true, 'token_id', _tok.id, 'scope', _tok.scope,
    'truck', CASE WHEN _truck.id IS NOT NULL THEN jsonb_build_object('id', _truck.id, 'plate', _truck.plate, 'carrier', _truck.carrier, 'trailer_number', _truck.trailer_number, 'driver_name', _truck.driver_name, 'status', _truck.status, 'gate', _truck.gate) ELSE NULL END,
    'appointment', CASE WHEN _appt.id IS NOT NULL THEN jsonb_build_object('id', _appt.id, 'carrier', _appt.carrier, 'reference', _appt.reference, 'starts_at', _appt.starts_at, 'ends_at', _appt.ends_at, 'type', _appt.appointment_type, 'status', _appt.status, 'dock_code', _dock.code, 'dock_name', _dock.name) ELSE NULL END);
END; $function$;

CREATE OR REPLACE FUNCTION public.consume_qr_checkin(_token text, _driver_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tok public.appointment_qr_tokens%ROWTYPE; _truck_id uuid; _truck public.trucks%ROWTYPE;
BEGIN
  SELECT * INTO _tok FROM public.appointment_qr_tokens WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_not_found'); END IF;
  IF _tok.purpose <> 'checkin' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_purpose'); END IF;
  IF _tok.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_expired'); END IF;
  IF _tok.single_use AND _tok.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_already_used'); END IF;
  IF _tok.scope = 'appointment' THEN SELECT truck_id INTO _truck_id FROM public.dock_appointments WHERE id = _tok.appointment_id;
  ELSE _truck_id := _tok.truck_id; END IF;
  IF _truck_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_truck_linked'); END IF;
  SELECT * INTO _truck FROM public.trucks WHERE id = _truck_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_not_found'); END IF;
  IF _truck.status = 'checked_in' THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_already_checked_in', 'checked_in_at', _truck.checked_in_at); END IF;
  IF _truck.status = 'departed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_already_departed', 'departed_at', _truck.departed_at); END IF;
  UPDATE public.trucks SET status = 'checked_in', checked_in_at = now(), driver_name = COALESCE(NULLIF(_driver_name, ''), driver_name), updated_at = now() WHERE id = _truck_id;
  IF _tok.appointment_id IS NOT NULL THEN UPDATE public.dock_appointments SET status = 'in_progress', updated_at = now() WHERE id = _tok.appointment_id AND status = 'scheduled'; END IF;
  UPDATE public.appointment_qr_tokens SET used_at = now(), used_by_driver = _driver_name WHERE id = _tok.id;
  INSERT INTO public.gate_events (truck_id, event_type, notes) VALUES (_truck_id, 'manual_approve', 'QR self check-in by ' || COALESCE(_driver_name, 'driver'));
  RETURN jsonb_build_object('ok', true, 'truck_id', _truck_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.consume_qr_checkout(_token text, _driver_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _tok public.appointment_qr_tokens%ROWTYPE; _truck_id uuid; _truck public.trucks%ROWTYPE;
BEGIN
  SELECT * INTO _tok FROM public.appointment_qr_tokens WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_not_found'); END IF;
  IF _tok.purpose <> 'checkout' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_purpose'); END IF;
  IF _tok.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_expired'); END IF;
  IF _tok.single_use AND _tok.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'token_already_used'); END IF;
  IF _tok.scope = 'appointment' THEN SELECT truck_id INTO _truck_id FROM public.dock_appointments WHERE id = _tok.appointment_id;
  ELSE _truck_id := _tok.truck_id; END IF;
  IF _truck_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_truck_linked'); END IF;
  SELECT * INTO _truck FROM public.trucks WHERE id = _truck_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_not_found'); END IF;
  IF _truck.status = 'departed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_already_departed', 'departed_at', _truck.departed_at); END IF;
  IF _truck.status <> 'checked_in' THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_not_checked_in', 'current_status', _truck.status); END IF;
  UPDATE public.trucks SET status = 'departed', departed_at = now(), driver_name = COALESCE(NULLIF(_driver_name, ''), driver_name), updated_at = now() WHERE id = _truck_id;
  IF _tok.appointment_id IS NOT NULL THEN UPDATE public.dock_appointments SET status = 'completed', updated_at = now() WHERE id = _tok.appointment_id AND status IN ('scheduled', 'in_progress'); END IF;
  UPDATE public.appointment_qr_tokens SET used_at = now(), used_by_driver = _driver_name WHERE id = _tok.id;
  INSERT INTO public.gate_events (truck_id, event_type, notes) VALUES (_truck_id, 'depart', 'QR self check-out by ' || COALESCE(_driver_name, 'driver'));
  RETURN jsonb_build_object('ok', true, 'truck_id', _truck_id);
END; $function$;

-- =========================================================
-- YARD FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.suggest_yard_slots(_category carrier_category, _slot_types slot_type[] DEFAULT ARRAY['parking','staging','dock']::slot_type[], _limit int DEFAULT 5)
RETURNS TABLE (slot_id uuid, code text, zone text, row_label text, slot_number int, slot_type slot_type, status slot_status, carrier_categories carrier_category[], category_match boolean, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.code, s.zone, s.row_label, s.slot_number, s.slot_type, s.status, s.carrier_categories,
    (_category = ANY(s.carrier_categories)) AS category_match,
    (CASE WHEN s.status = 'empty' THEN 50 ELSE -100 END + CASE WHEN _category = ANY(s.carrier_categories) THEN 40 ELSE 0 END + CASE WHEN s.slot_type = 'parking' THEN 10 WHEN s.slot_type = 'staging' THEN 6 WHEN s.slot_type = 'dock' THEN 4 ELSE 0 END)::numeric AS score
  FROM public.yard_slots s WHERE s.slot_type = ANY(_slot_types) AND s.status <> 'out_of_service'
  ORDER BY score DESC, s.zone ASC, s.row_label ASC, s.slot_number ASC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.suggest_docks(_category carrier_category, _starts_at timestamptz, _ends_at timestamptz, _limit int DEFAULT 5)
RETURNS TABLE(dock_id uuid, code text, name text, zone text, status text, carrier_categories carrier_category[], category_match boolean, upcoming_count int, conflict boolean, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT d.id AS dock_id, d.code, d.name, d.zone, d.status::text AS status, d.carrier_categories,
      (_category = ANY(d.carrier_categories)) AS category_match,
      COALESCE((SELECT count(*)::int FROM public.dock_appointments a WHERE a.dock_id = d.id AND a.status IN ('scheduled', 'in_progress') AND a.starts_at >= _starts_at - interval '4 hours' AND a.starts_at <= _starts_at + interval '4 hours'), 0) AS upcoming_count,
      EXISTS (SELECT 1 FROM public.dock_appointments a WHERE a.dock_id = d.id AND a.status IN ('scheduled', 'in_progress') AND a.starts_at < _ends_at AND a.ends_at > _starts_at) AS conflict
    FROM public.docks d)
  SELECT b.dock_id, b.code, b.name, b.zone, b.status, b.carrier_categories, b.category_match, b.upcoming_count, b.conflict,
    (CASE WHEN b.conflict THEN -100 ELSE 0 END + CASE WHEN b.category_match THEN 50 ELSE 0 END + CASE WHEN b.status = 'available' THEN 20 ELSE -30 END - (b.upcoming_count * 3))::numeric AS score
  FROM base b ORDER BY score DESC, b.code ASC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_yard_slot(_truck_id uuid, _actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _truck public.trucks%ROWTYPE; _slot public.yard_slots%ROWTYPE; _existing_slot uuid; _next_pos int; _qid uuid;
BEGIN
  SELECT * INTO _truck FROM public.trucks WHERE id = _truck_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_not_found'); END IF;
  SELECT id INTO _existing_slot FROM public.yard_slots WHERE trailer_id = _truck_id LIMIT 1;
  IF _existing_slot IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'truck_already_assigned', 'slot_id', _existing_slot); END IF;
  SELECT s.* INTO _slot FROM public.yard_slots s WHERE s.status = 'empty' AND _truck.carrier_category = ANY(s.carrier_categories) AND s.slot_type IN ('parking','staging','dock') ORDER BY CASE s.slot_type WHEN 'parking' THEN 1 WHEN 'staging' THEN 2 WHEN 'dock' THEN 3 ELSE 4 END, s.zone, s.row_label, s.slot_number LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT s.* INTO _slot FROM public.yard_slots s WHERE s.status = 'empty' AND s.slot_type IN ('parking','staging','dock') ORDER BY CASE s.slot_type WHEN 'parking' THEN 1 WHEN 'staging' THEN 2 WHEN 'dock' THEN 3 ELSE 4 END, s.zone, s.row_label, s.slot_number LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    SELECT id INTO _qid FROM public.parking_queue WHERE truck_id = _truck_id AND status = 'waiting' LIMIT 1;
    IF _qid IS NULL THEN
      SELECT COALESCE(MAX(position), 0) + 1 INTO _next_pos FROM public.parking_queue WHERE status = 'waiting';
      INSERT INTO public.parking_queue (truck_id, carrier_category, position, status, reason, enqueued_by) VALUES (_truck_id, _truck.carrier_category, _next_pos, 'waiting', 'no_slot_available', _actor) RETURNING id INTO _qid;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'queued', 'queue_id', _qid);
  END IF;
  UPDATE public.yard_slots SET trailer_id = _truck_id, status = 'occupied', updated_at = now() WHERE id = _slot.id;
  INSERT INTO public.trailer_moves (trailer_id, from_slot_id, to_slot_id, action, actor_id, notes) VALUES (_truck_id, NULL, _slot.id, 'assign', _actor, 'auto smart-assign');
  UPDATE public.parking_queue SET status = 'assigned', assigned_slot_id = _slot.id, assigned_at = now() WHERE truck_id = _truck_id AND status = 'waiting';
  RETURN jsonb_build_object('ok', true, 'slot_id', _slot.id, 'slot_code', _slot.code, 'category_match', (_truck.carrier_category = ANY(_slot.carrier_categories)));
END; $$;

CREATE OR REPLACE FUNCTION public.promote_parking_queue(_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q public.parking_queue%ROWTYPE; _result jsonb;
BEGIN
  SELECT * INTO _q FROM public.parking_queue WHERE status = 'waiting' ORDER BY position ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'queue_empty'); END IF;
  _result := public.auto_assign_yard_slot(_q.truck_id, _actor);
  RETURN _result;
END; $$;

-- =========================================================
-- OCR LOCK FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.acquire_ocr_lock(_ocr_read_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing public.ocr_review_locks%ROWTYPE;
BEGIN
  DELETE FROM public.ocr_review_locks WHERE expires_at < now();
  SELECT * INTO _existing FROM public.ocr_review_locks WHERE ocr_read_id = _ocr_read_id FOR UPDATE;
  IF FOUND AND _existing.locked_by <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked_by_other', 'locked_by', _existing.locked_by, 'expires_at', _existing.expires_at);
  END IF;
  INSERT INTO public.ocr_review_locks (ocr_read_id, locked_by, locked_at, expires_at) VALUES (_ocr_read_id, auth.uid(), now(), now() + interval '5 minutes')
  ON CONFLICT (ocr_read_id) DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_at = now(), expires_at = now() + interval '5 minutes';
  RETURN jsonb_build_object('ok', true, 'expires_at', now() + interval '5 minutes');
END; $$;

CREATE OR REPLACE FUNCTION public.release_ocr_lock(_ocr_read_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.ocr_review_locks WHERE ocr_read_id = _ocr_read_id AND locked_by = auth.uid();
$$;

-- =========================================================
-- AUDIT TRIGGERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.weighbridge_audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.flagged THEN
    INSERT INTO public.weighbridge_audit (reading_id, actor_id, action, after_state, reason) VALUES (NEW.id, auth.uid(), 'flagged', jsonb_build_object('flagged', NEW.flagged, 'gross_kg', NEW.gross_kg, 'overweight', NEW.overweight, 'deviation_pct', NEW.deviation_pct), NEW.flag_reason);
  ELSIF TG_OP = 'UPDATE' AND (OLD.flagged IS DISTINCT FROM NEW.flagged OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by OR OLD.override_reason IS DISTINCT FROM NEW.override_reason) THEN
    INSERT INTO public.weighbridge_audit (reading_id, actor_id, action, before_state, after_state, reason) VALUES (NEW.id, COALESCE(NEW.reviewed_by, auth.uid()),
      CASE WHEN NEW.override_reason IS NOT NULL AND OLD.override_reason IS DISTINCT FROM NEW.override_reason THEN 'overridden' WHEN OLD.flagged AND NOT NEW.flagged THEN 'approved' ELSE 'reviewed' END,
      jsonb_build_object('flagged', OLD.flagged, 'reviewed_by', OLD.reviewed_by, 'override_reason', OLD.override_reason),
      jsonb_build_object('flagged', NEW.flagged, 'reviewed_by', NEW.reviewed_by, 'override_reason', NEW.override_reason), NEW.override_reason);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_weighbridge_audit AFTER INSERT OR UPDATE ON public.weighbridge_readings FOR EACH ROW EXECUTE FUNCTION public.weighbridge_audit_trigger();

CREATE OR REPLACE FUNCTION public.ocr_audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.ocr_review_audit (ocr_read_id, actor_id, action, before_status, after_status, before_value, after_value, reason) VALUES (NEW.id, COALESCE(NEW.reviewed_by, auth.uid()),
      CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' WHEN 'overridden' THEN 'overridden' WHEN 'needs_review' THEN 'reopened' ELSE NEW.status::text END,
      OLD.status, NEW.status, COALESCE(OLD.override_value, OLD.normalized_value), COALESCE(NEW.override_value, NEW.normalized_value), NEW.override_reason);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_ocr_audit AFTER UPDATE ON public.ocr_reads FOR EACH ROW EXECUTE FUNCTION public.ocr_audit_trigger();

-- =========================================================
-- GRANTS
-- =========================================================
GRANT EXECUTE ON FUNCTION public.validate_qr_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_qr_checkin(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_qr_checkout(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_qr_checkout(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.suggest_yard_slots(carrier_category, slot_type[], int) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_assign_yard_slot(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.promote_parking_queue(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.suggest_yard_slots(carrier_category, slot_type[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_yard_slot(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_parking_queue(uuid) TO authenticated;

-- =========================================================
-- REALTIME
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.trucks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_events;
ALTER TABLE public.yard_slots REPLICA IDENTITY FULL;
ALTER TABLE public.trailer_moves REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.yard_slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trailer_moves;
ALTER TABLE public.docks REPLICA IDENTITY FULL;
ALTER TABLE public.dock_appointments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.docks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dock_appointments;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.task_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_events;
ALTER TABLE public.parking_queue REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_queue;

-- =========================================================
-- SEED DATA
-- =========================================================
INSERT INTO public.yard_slots (code, zone, row_label, slot_number, slot_type, carrier_categories, x, y) VALUES
('A-D1','A','Dock',1,'dock',ARRAY['refrigerated','standard']::carrier_category[],0,0),
('A-D2','A','Dock',2,'dock',ARRAY['hazmat']::carrier_category[],1,0),
('A-D3','A','Dock',3,'dock',ARRAY['oversize','container']::carrier_category[],2,0),
('A-P1','A','Park',1,'parking',ARRAY['standard']::carrier_category[],0,1),
('A-P2','A','Park',2,'parking',ARRAY['standard']::carrier_category[],1,1),
('A-P3','A','Park',3,'parking',ARRAY['standard']::carrier_category[],2,1),
('B-D1','B','Dock',1,'dock',ARRAY['express','standard']::carrier_category[],4,0),
('B-D2','B','Dock',2,'dock',ARRAY['standard','express']::carrier_category[],5,0),
('B-S1','B','Stage',1,'staging',ARRAY['standard','refrigerated','container']::carrier_category[],4,1),
('B-S2','B','Stage',2,'staging',ARRAY['standard','refrigerated','container']::carrier_category[],5,1),
('B-R1','B','Repair',1,'repair',ARRAY['standard','oversize']::carrier_category[],4,2),
('B-R2','B','Repair',2,'repair',ARRAY['standard','oversize']::carrier_category[],5,2);

INSERT INTO public.docks (code, name, zone, carrier_categories, display_order) VALUES
('D-01', 'Dock 01', 'A', ARRAY['refrigerated','standard']::carrier_category[], 1),
('D-02', 'Dock 02', 'A', ARRAY['hazmat']::carrier_category[], 2),
('D-03', 'Dock 03', 'A', ARRAY['oversize','container']::carrier_category[], 3),
('D-04', 'Dock 04', 'B', ARRAY['express','standard']::carrier_category[], 4),
('D-05', 'Dock 05', 'B', ARRAY['standard']::carrier_category[], 5),
('D-06', 'Dock 06', 'B', ARRAY['standard']::carrier_category[], 6),
('D-07', 'Dock 07', 'C', ARRAY['standard']::carrier_category[], 7),
('D-08', 'Dock 08', 'C', ARRAY['standard']::carrier_category[], 8);
