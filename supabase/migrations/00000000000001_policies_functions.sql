-- =========================================================
-- RLS POLICIES
-- =========================================================

-- profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- trucks
CREATE POLICY "Authenticated can view trucks" ON public.trucks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert trucks" ON public.trucks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can update trucks" ON public.trucks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete trucks" ON public.trucks FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- gate_events
CREATE POLICY "Authenticated can view gate events" ON public.gate_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can log gate events" ON public.gate_events FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete gate events" ON public.gate_events FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- yard_slots
CREATE POLICY "Authenticated can view yard slots" ON public.yard_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert yard slots" ON public.yard_slots FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "Operators and admins can update yard slots" ON public.yard_slots FOR UPDATE TO authenticated USING (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can delete yard slots" ON public.yard_slots FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));

-- trailer_moves
CREATE POLICY "Authenticated can view trailer moves" ON public.trailer_moves FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can log trailer moves" ON public.trailer_moves FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can delete trailer moves" ON public.trailer_moves FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));

-- docks
CREATE POLICY "Authenticated can view docks" ON public.docks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert docks" ON public.docks FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can update docks" ON public.docks FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete docks" ON public.docks FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- dock_appointments
CREATE POLICY "Authenticated can view appointments" ON public.dock_appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert appointments" ON public.dock_appointments FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can update appointments" ON public.dock_appointments FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can delete appointments" ON public.dock_appointments FOR DELETE TO authenticated USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));

-- tasks
CREATE POLICY "Authenticated can view tasks" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert tasks" ON public.tasks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Operators, admins, or assignee can update tasks" ON public.tasks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin') OR assignee_id = auth.uid());
CREATE POLICY "Admins can delete tasks" ON public.tasks FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- task_events
CREATE POLICY "Authenticated can view task events" ON public.task_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators, admins, and assignees can log task events" ON public.task_events FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin') OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assignee_id = auth.uid()));
CREATE POLICY "Admins can delete task events" ON public.task_events FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- qr_tokens
CREATE POLICY "Operators and admins view qr tokens" ON public.appointment_qr_tokens FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can manage qr tokens" ON public.appointment_qr_tokens FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- ocr_reads
CREATE POLICY "Authenticated can view ocr reads" ON public.ocr_reads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert ocr reads" ON public.ocr_reads FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can update ocr reads" ON public.ocr_reads FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete ocr reads" ON public.ocr_reads FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- weighbridge_readings
CREATE POLICY "Authenticated can view weighbridge" ON public.weighbridge_readings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins can insert weighbridge" ON public.weighbridge_readings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators and admins can update weighbridge" ON public.weighbridge_readings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete weighbridge" ON public.weighbridge_readings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- parking_queue
CREATE POLICY "Authenticated can view parking queue" ON public.parking_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Operators and admins manage parking queue" ON public.parking_queue FOR ALL TO authenticated USING (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'operator') OR has_role(auth.uid(),'admin'));

-- weighbridge_audit
CREATE POLICY "Auth can view weighbridge audit" ON public.weighbridge_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Operators/admins insert weighbridge audit" ON public.weighbridge_audit FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- ocr_review_audit
CREATE POLICY "Auth view ocr audit" ON public.ocr_review_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Op/admin insert ocr audit" ON public.ocr_review_audit FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- ocr_review_locks
CREATE POLICY "Auth view ocr locks" ON public.ocr_review_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Op/admin manage ocr locks" ON public.ocr_review_locks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
