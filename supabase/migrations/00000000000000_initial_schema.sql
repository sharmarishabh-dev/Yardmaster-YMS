-- YardMaster consolidated schema migration
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'driver');
CREATE TYPE public.truck_status AS ENUM ('pending', 'checked_in', 'rejected', 'departed');
CREATE TYPE public.gate_event_type AS ENUM ('ocr_scan', 'manual_approve', 'manual_override', 'reject', 'depart');
CREATE TYPE public.slot_type AS ENUM ('dock', 'parking', 'staging', 'repair');
CREATE TYPE public.slot_status AS ENUM ('empty', 'occupied', 'reserved', 'out_of_service');
CREATE TYPE public.move_action AS ENUM ('assign','release','relocate','reserve','out_of_service');
CREATE TYPE public.dock_status AS ENUM ('available', 'maintenance', 'closed');
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE public.appointment_type AS ENUM ('inbound', 'outbound', 'cross_dock');
CREATE TYPE public.task_type AS ENUM ('move_trailer','inspect','fuel','wash','deliver_paperwork','other');
CREATE TYPE public.task_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.task_status AS ENUM ('pending','assigned','in_progress','completed','cancelled');
CREATE TYPE public.task_event_type AS ENUM ('created','assigned','started','completed','cancelled','note','reassigned');
CREATE TYPE public.qr_token_scope AS ENUM ('appointment', 'truck');
CREATE TYPE public.qr_token_purpose AS ENUM ('checkin', 'checkout');
CREATE TYPE public.ocr_read_type AS ENUM ('plate', 'trailer');
CREATE TYPE public.ocr_read_status AS ENUM ('auto_approved', 'needs_review', 'rejected', 'overridden', 'approved');
CREATE TYPE public.weigh_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.carrier_category AS ENUM ('standard', 'refrigerated', 'hazmat', 'oversize', 'express', 'container');

-- =========================================================
-- HELPER FUNCTIONS (no table dependencies)
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN new.updated_at = now(); RETURN new; END; $$;

-- =========================================================
-- PROFILES & USER_ROLES
-- =========================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, company_name text, phone text, avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role depends on user_roles table existing
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- =========================================================
-- TRUCKS
-- =========================================================
CREATE TABLE public.trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL, plate text NOT NULL, trailer_number text,
  driver_name text, driver_phone text, appointment_at timestamptz,
  status public.truck_status NOT NULL DEFAULT 'pending',
  carrier_category public.carrier_category NOT NULL DEFAULT 'standard',
  expected_weight_kg integer, gate text, checked_in_at timestamptz,
  departed_at timestamptz, notes text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trucks_status ON public.trucks(status);
CREATE INDEX idx_trucks_created_at ON public.trucks(created_at DESC);
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_trucks_updated_at BEFORE UPDATE ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- GATE EVENTS
-- =========================================================
CREATE TABLE public.gate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id uuid NOT NULL, event_type public.gate_event_type NOT NULL,
  actor_id uuid, ocr_confidence numeric, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gate_events_truck ON public.gate_events(truck_id, created_at DESC);
CREATE INDEX idx_gate_events_created_at ON public.gate_events(created_at DESC);
ALTER TABLE public.gate_events ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- YARD SLOTS
-- =========================================================
CREATE TABLE public.yard_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE, zone text NOT NULL, row_label text NOT NULL,
  slot_number int NOT NULL, slot_type public.slot_type NOT NULL DEFAULT 'parking',
  status public.slot_status NOT NULL DEFAULT 'empty',
  carrier_categories public.carrier_category[] NOT NULL DEFAULT ARRAY['standard']::public.carrier_category[],
  x int NOT NULL DEFAULT 0, y int NOT NULL DEFAULT 0,
  trailer_id uuid, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.yard_slots ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_yard_slots_updated_at BEFORE UPDATE ON public.yard_slots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TRAILER MOVES
-- =========================================================
CREATE TABLE public.trailer_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trailer_id uuid, from_slot_id uuid, to_slot_id uuid,
  action public.move_action NOT NULL, actor_id uuid, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trailer_moves_trailer ON public.trailer_moves(trailer_id, created_at DESC);
ALTER TABLE public.trailer_moves ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- DOCKS
-- =========================================================
CREATE TABLE public.docks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE, name text NOT NULL, zone text NOT NULL DEFAULT 'A',
  status public.dock_status NOT NULL DEFAULT 'available',
  carrier_categories public.carrier_category[] NOT NULL DEFAULT ARRAY['standard']::public.carrier_category[],
  notes text, display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.docks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_docks_updated_at BEFORE UPDATE ON public.docks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- DOCK APPOINTMENTS
-- =========================================================
CREATE TABLE public.dock_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dock_id uuid NOT NULL REFERENCES public.docks(id) ON DELETE CASCADE,
  truck_id uuid, carrier text NOT NULL,
  carrier_category public.carrier_category NOT NULL DEFAULT 'standard',
  reference text, appointment_type public.appointment_type NOT NULL DEFAULT 'inbound',
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  notes text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_window CHECK (ends_at > starts_at)
);
CREATE INDEX idx_dock_appts_dock_time ON public.dock_appointments(dock_id, starts_at, ends_at);
CREATE INDEX idx_dock_appts_starts ON public.dock_appointments(starts_at);
ALTER TABLE public.dock_appointments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_appts_updated_at BEFORE UPDATE ON public.dock_appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TASKS
-- =========================================================
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, instructions text,
  task_type public.task_type NOT NULL DEFAULT 'other',
  priority public.task_priority NOT NULL DEFAULT 'normal',
  status public.task_status NOT NULL DEFAULT 'pending',
  assignee_id uuid, truck_id uuid, dock_id uuid, slot_id uuid,
  trailer_number text, due_at timestamptz, started_at timestamptz,
  completed_at timestamptz, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_assignee ON public.tasks(assignee_id);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_assignee_status ON public.tasks(assignee_id, status);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TASK EVENTS
-- =========================================================
CREATE TABLE public.task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL, event_type public.task_event_type NOT NULL,
  actor_id uuid, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_events_task ON public.task_events(task_id);
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- QR TOKENS
-- =========================================================
CREATE TABLE public.appointment_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  scope public.qr_token_scope NOT NULL DEFAULT 'appointment',
  purpose public.qr_token_purpose NOT NULL DEFAULT 'checkin',
  appointment_id uuid, truck_id uuid,
  single_use boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL, used_at timestamptz,
  used_by_driver text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_token_target_check CHECK (
    (scope = 'appointment' AND appointment_id IS NOT NULL) OR
    (scope = 'truck' AND truck_id IS NOT NULL)
  )
);
CREATE INDEX idx_qr_tokens_token ON public.appointment_qr_tokens(token);
CREATE INDEX idx_qr_tokens_appointment ON public.appointment_qr_tokens(appointment_id);
CREATE INDEX idx_qr_tokens_truck ON public.appointment_qr_tokens(truck_id);
ALTER TABLE public.appointment_qr_tokens ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- OCR READS
-- =========================================================
CREATE TABLE public.ocr_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id uuid NOT NULL, read_type public.ocr_read_type NOT NULL,
  raw_value text NOT NULL, normalized_value text NOT NULL, expected_value text,
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status public.ocr_read_status NOT NULL DEFAULT 'needs_review',
  override_value text, override_reason text,
  reviewed_by uuid, reviewed_at timestamptz, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ocr_reads_truck ON public.ocr_reads(truck_id);
CREATE INDEX idx_ocr_reads_status ON public.ocr_reads(status, created_at DESC);
ALTER TABLE public.ocr_reads ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- WEIGHBRIDGE READINGS
-- =========================================================
CREATE TABLE public.weighbridge_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id uuid NOT NULL, direction public.weigh_direction NOT NULL,
  gross_kg integer NOT NULL CHECK (gross_kg >= 0),
  tare_kg integer CHECK (tare_kg IS NULL OR tare_kg >= 0),
  net_kg integer, expected_kg integer,
  deviation_pct numeric(6,2), overweight boolean NOT NULL DEFAULT false,
  flagged boolean NOT NULL DEFAULT false, flag_reason text,
  override_reason text, reviewed_by uuid, reviewed_at timestamptz, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_weigh_truck ON public.weighbridge_readings(truck_id);
CREATE INDEX idx_weigh_flagged ON public.weighbridge_readings(flagged, created_at DESC);
ALTER TABLE public.weighbridge_readings ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- PARKING QUEUE
-- =========================================================
CREATE TABLE public.parking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id uuid NOT NULL, carrier_category public.carrier_category NOT NULL DEFAULT 'standard',
  zone text, position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting', reason text,
  enqueued_by uuid, enqueued_at timestamptz NOT NULL DEFAULT now(),
  assigned_slot_id uuid, assigned_at timestamptz, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_parking_queue_status ON public.parking_queue(status);
CREATE INDEX idx_parking_queue_truck ON public.parking_queue(truck_id);
ALTER TABLE public.parking_queue ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_parking_queue_updated BEFORE UPDATE ON public.parking_queue FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- WEIGHBRIDGE AUDIT
-- =========================================================
CREATE TABLE public.weighbridge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reading_id uuid NOT NULL REFERENCES public.weighbridge_readings(id) ON DELETE CASCADE,
  actor_id uuid, action text NOT NULL,
  before_state jsonb, after_state jsonb, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_weighbridge_audit_reading ON public.weighbridge_audit(reading_id, created_at DESC);
ALTER TABLE public.weighbridge_audit ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- OCR REVIEW AUDIT
-- =========================================================
CREATE TABLE public.ocr_review_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocr_read_id uuid NOT NULL REFERENCES public.ocr_reads(id) ON DELETE CASCADE,
  actor_id uuid, action text NOT NULL,
  before_status public.ocr_read_status, after_status public.ocr_read_status,
  before_value text, after_value text, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ocr_audit_read ON public.ocr_review_audit(ocr_read_id, created_at DESC);
ALTER TABLE public.ocr_review_audit ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- OCR REVIEW LOCKS
-- =========================================================
CREATE TABLE public.ocr_review_locks (
  ocr_read_id uuid PRIMARY KEY REFERENCES public.ocr_reads(id) ON DELETE CASCADE,
  locked_by uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX idx_ocr_locks_expires ON public.ocr_review_locks(expires_at);
ALTER TABLE public.ocr_review_locks ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- FOREIGN KEYS (deferred, NOT VALID)
-- =========================================================
ALTER TABLE public.trucks ADD CONSTRAINT trucks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT tasks_assignee_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT tasks_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT tasks_dock_fkey FOREIGN KEY (dock_id) REFERENCES public.docks(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT tasks_slot_fkey FOREIGN KEY (slot_id) REFERENCES public.yard_slots(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_task_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT task_events_actor_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.gate_events
  ADD CONSTRAINT gate_events_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT gate_events_actor_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.trailer_moves
  ADD CONSTRAINT trailer_moves_trailer_fkey FOREIGN KEY (trailer_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT trailer_moves_from_slot_fkey FOREIGN KEY (from_slot_id) REFERENCES public.yard_slots(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT trailer_moves_to_slot_fkey FOREIGN KEY (to_slot_id) REFERENCES public.yard_slots(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT trailer_moves_actor_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.dock_appointments
  ADD CONSTRAINT dock_appointments_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT dock_appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.appointment_qr_tokens
  ADD CONSTRAINT qr_tokens_appointment_fkey FOREIGN KEY (appointment_id) REFERENCES public.dock_appointments(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT qr_tokens_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.ocr_reads
  ADD CONSTRAINT ocr_reads_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT ocr_reads_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.weighbridge_readings
  ADD CONSTRAINT weighbridge_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT weighbridge_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.parking_queue
  ADD CONSTRAINT parking_queue_truck_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT parking_queue_slot_fkey FOREIGN KEY (assigned_slot_id) REFERENCES public.yard_slots(id) ON DELETE SET NULL NOT VALID,
  ADD CONSTRAINT parking_queue_actor_fkey FOREIGN KEY (enqueued_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.yard_slots ADD CONSTRAINT yard_slots_trailer_fkey FOREIGN KEY (trailer_id) REFERENCES public.trucks(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.weighbridge_audit ADD CONSTRAINT weighbridge_audit_actor_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.ocr_review_audit ADD CONSTRAINT ocr_audit_actor_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.ocr_review_locks ADD CONSTRAINT ocr_locks_user_fkey FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
