-- =========================================================
-- YardMaster — Indian Subcontinent Seed Data
-- Run this in your Supabase SQL Editor after all migrations.
-- =========================================================

-- =========================================================
-- 1. DOCKS (Zones A, B, C)
-- =========================================================
INSERT INTO public.docks (id, code, name, zone, status, carrier_categories, display_order) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'A-01', 'Dock Alpha-01', 'A', 'available', ARRAY['standard','refrigerated']::public.carrier_category[], 1),
  ('d0000001-0000-0000-0000-000000000002', 'A-02', 'Dock Alpha-02', 'A', 'available', ARRAY['standard']::public.carrier_category[], 2),
  ('d0000001-0000-0000-0000-000000000003', 'A-03', 'Dock Alpha-03', 'A', 'maintenance', ARRAY['standard']::public.carrier_category[], 3),
  ('d0000001-0000-0000-0000-000000000004', 'B-01', 'Dock Bravo-01', 'B', 'available', ARRAY['hazmat']::public.carrier_category[], 4),
  ('d0000001-0000-0000-0000-000000000005', 'B-02', 'Dock Bravo-02', 'B', 'available', ARRAY['standard','express']::public.carrier_category[], 5),
  ('d0000001-0000-0000-0000-000000000006', 'B-03', 'Dock Bravo-03', 'B', 'available', ARRAY['container']::public.carrier_category[], 6),
  ('d0000001-0000-0000-0000-000000000007', 'C-01', 'Dock Charlie-01', 'C', 'available', ARRAY['standard','oversize']::public.carrier_category[], 7),
  ('d0000001-0000-0000-0000-000000000008', 'C-02', 'Dock Charlie-02', 'C', 'available', ARRAY['standard']::public.carrier_category[], 8),
  ('d0000001-0000-0000-0000-000000000009', 'C-03', 'Dock Charlie-03', 'C', 'closed',    ARRAY['standard']::public.carrier_category[], 9)
ON CONFLICT (code) DO NOTHING;

-- =========================================================
-- 2. YARD SLOTS (Zones A, B, C, D — 40 slots)
-- =========================================================
INSERT INTO public.yard_slots (id, code, zone, row_label, slot_number, slot_type, status, x, y) VALUES
  -- Zone A (dock-adjacent)
  ('50000001-0000-0000-0000-000000000001','A01','A','A',1,'parking','occupied',0,0),
  ('50000001-0000-0000-0000-000000000002','A02','A','A',2,'parking','occupied',0,1),
  ('50000001-0000-0000-0000-000000000003','A03','A','A',3,'parking','empty',0,2),
  ('50000001-0000-0000-0000-000000000004','A04','A','A',4,'parking','empty',0,3),
  ('50000001-0000-0000-0000-000000000005','A05','A','A',5,'staging','occupied',0,4),
  ('50000001-0000-0000-0000-000000000006','A06','A','A',6,'staging','empty',0,5),
  ('50000001-0000-0000-0000-000000000007','A07','A','A',7,'dock','occupied',0,6),
  ('50000001-0000-0000-0000-000000000008','A08','A','A',8,'dock','empty',0,7),
  -- Zone B
  ('50000001-0000-0000-0000-000000000009','B01','B','B',1,'parking','occupied',5,0),
  ('50000001-0000-0000-0000-000000000010','B02','B','B',2,'parking','occupied',5,1),
  ('50000001-0000-0000-0000-000000000011','B03','B','B',3,'parking','empty',5,2),
  ('50000001-0000-0000-0000-000000000012','B04','B','B',4,'parking','occupied',5,3),
  ('50000001-0000-0000-0000-000000000013','B05','B','B',5,'parking','empty',5,4),
  ('50000001-0000-0000-0000-000000000014','B06','B','B',6,'staging','occupied',5,5),
  ('50000001-0000-0000-0000-000000000015','B07','B','B',7,'dock','empty',5,6),
  ('50000001-0000-0000-0000-000000000016','B08','B','B',8,'dock','occupied',5,7),
  -- Zone C
  ('50000001-0000-0000-0000-000000000017','C01','C','C',1,'parking','occupied',10,0),
  ('50000001-0000-0000-0000-000000000018','C02','C','C',2,'parking','empty',10,1),
  ('50000001-0000-0000-0000-000000000019','C03','C','C',3,'parking','occupied',10,2),
  ('50000001-0000-0000-0000-000000000020','C04','C','C',4,'parking','empty',10,3),
  ('50000001-0000-0000-0000-000000000021','C05','C','C',5,'staging','occupied',10,4),
  ('50000001-0000-0000-0000-000000000022','C06','C','C',6,'repair','out_of_service',10,5),
  -- Zone D (far storage)
  ('50000001-0000-0000-0000-000000000023','D01','D','D',1,'parking','empty',15,0),
  ('50000001-0000-0000-0000-000000000024','D02','D','D',2,'parking','empty',15,1),
  ('50000001-0000-0000-0000-000000000025','D03','D','D',3,'parking','empty',15,2),
  ('50000001-0000-0000-0000-000000000026','D04','D','D',4,'parking','empty',15,3),
  ('50000001-0000-0000-0000-000000000027','D05','D','D',5,'parking','occupied',15,4),
  ('50000001-0000-0000-0000-000000000028','D06','D','D',6,'parking','empty',15,5)
ON CONFLICT (code) DO NOTHING;

-- =========================================================
-- 3. TRUCKS — Indian carriers & plates
-- =========================================================
INSERT INTO public.trucks (id, carrier, plate, trailer_number, driver_name, driver_phone, appointment_at, status, carrier_category, expected_weight_kg, gate, checked_in_at, notes, created_at) VALUES
  -- Checked-in trucks
  ('70000001-0000-0000-0000-000000000001','TATA Motors Logistics','MH-12-AB-1234','TML-TR-001','Ramesh Kumar','+91-98201-11111', now() - interval '3 hours', 'checked_in','standard',18000,'Gate-1', now() - interval '2h50m', 'Regular TATA consignment from Pune', now() - interval '3h'),
  ('70000001-0000-0000-0000-000000000002','Mahindra Logistics','GJ-18-BT-5678','MLL-TR-042','Suresh Patel','+91-94265-22222', now() - interval '2 hours', 'checked_in','refrigerated',12000,'Gate-2', now() - interval '1h55m', 'Cold chain — perishables from Ahmedabad', now() - interval '2h'),
  ('70000001-0000-0000-0000-000000000003','Delhivery','DL-01-CX-9012','DEL-TR-187','Vijay Singh','+91-99100-33333', now() - interval '90 minutes','checked_in','express',8500,'Gate-1', now() - interval '85m', 'Express parcels — Delhi hub', now() - interval '90m'),
  ('70000001-0000-0000-0000-000000000004','VRL Logistics','KA-09-ZP-3456','VRL-TR-023','Anil Nayak','+91-97441-44444', now() - interval '4 hours', 'checked_in','standard',22000,'Gate-3', now() - interval '3h50m', 'Heavy machinery parts from Bangalore', now() - interval '4h'),
  ('70000001-0000-0000-0000-000000000005','Blue Dart Express','TN-38-DF-7890','BDX-TR-009','Murugan Selvam','+91-90032-55555', now() - interval '1 hour',  'checked_in','express',4200,'Gate-2', now() - interval '58m', 'Priority air-road shipment', now() - interval '1h'),
  -- Pending trucks (awaiting check-in)
  ('70000001-0000-0000-0000-000000000006','Safexpress','HR-26-EA-2345','SFX-TR-064','Harpreet Gill','+91-98726-66666', now() + interval '30 minutes', 'pending','standard',15000, NULL, NULL, 'Scheduled from Gurgaon', now() - interval '30m'),
  ('70000001-0000-0000-0000-000000000007','Rivigo','RJ-14-GC-6789','RVG-TR-031','Deepak Sharma','+91-91500-77777', now() + interval '1 hour',  'pending','standard',19500, NULL, NULL, 'Relay trucking — Jaipur to hub', now() - interval '1h'),
  ('70000001-0000-0000-0000-000000000008','Gati KWE','WB-02-HX-1122','GKW-TR-078','Santosh Mondal','+91-96412-88888', now() + interval '45 minutes','pending','standard',11000, NULL, NULL, 'Surface freight from Kolkata', now() - interval '45m'),
  ('70000001-0000-0000-0000-000000000009','TCI Express','AP-28-JK-3344','TCI-TR-055','Raju Reddy','+91-98490-99999', now() + interval '2 hours', 'pending','container',28000, NULL, NULL, 'Container load from Visakhapatnam port', now() - interval '2h'),
  ('70000001-0000-0000-0000-000000000010','XpressBees','MH-14-LM-5566','XPB-TR-012','Prakash Jadhav','+91-99213-10101', now() + interval '3 hours', 'pending','express',6000,  NULL, NULL, 'E-commerce returns batch', now() - interval '3h'),
  -- Departed truck
  ('70000001-0000-0000-0000-000000000011','DTDC Logistics','PB-10-NP-7788','DTDC-TR-019','Gurpreet Singh','+91-97801-11211', now() - interval '6 hours', 'departed','standard',13000,'Gate-1', now() - interval '5h45m', 'Completed delivery', now() - interval '6h'),
  ('70000001-0000-0000-0000-000000000012','Spoton Logistics','MP-09-QR-9900','SPT-TR-047','Ravi Mishra','+91-88001-12312', now() - interval '8 hours', 'departed','hazmat',17500,'Gate-3', now() - interval '7h50m', 'Chemical consignment from Bhopal', now() - interval '8h')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 4. GATE EVENTS
-- =========================================================
INSERT INTO public.gate_events (truck_id, event_type, ocr_confidence, notes, created_at) VALUES
  ('70000001-0000-0000-0000-000000000001','ocr_scan',   0.97, 'Plate MH-12-AB-1234 auto-approved', now() - interval '2h52m'),
  ('70000001-0000-0000-0000-000000000001','manual_approve', NULL, 'Driver ID verified by gate staff', now() - interval '2h50m'),
  ('70000001-0000-0000-0000-000000000002','ocr_scan',   0.91, 'Plate GJ-18-BT-5678 — low confidence, sent for review', now() - interval '1h58m'),
  ('70000001-0000-0000-0000-000000000002','manual_approve', NULL, 'Overridden by operator Mehta', now() - interval '1h55m'),
  ('70000001-0000-0000-0000-000000000003','ocr_scan',   0.99, 'Plate DL-01-CX-9012 auto-approved', now() - interval '85m'),
  ('70000001-0000-0000-0000-000000000004','ocr_scan',   0.95, 'Plate KA-09-ZP-3456 auto-approved', now() - interval '3h52m'),
  ('70000001-0000-0000-0000-000000000004','manual_approve', NULL, 'Verified heavy cargo manifest', now() - interval '3h50m'),
  ('70000001-0000-0000-0000-000000000005','ocr_scan',   0.98, 'Plate TN-38-DF-7890 auto-approved', now() - interval '58m'),
  ('70000001-0000-0000-0000-000000000011','ocr_scan',   0.96, 'Plate PB-10-NP-7788 auto-approved', now() - interval '5h48m'),
  ('70000001-0000-0000-0000-000000000011','manual_approve', NULL, 'DTDC verified', now() - interval '5h45m'),
  ('70000001-0000-0000-0000-000000000011','depart',     NULL, 'Truck departed after unloading', now() - interval '3h'),
  ('70000001-0000-0000-0000-000000000012','ocr_scan',   0.88, 'Hazmat plate partially obscured', now() - interval '7h55m'),
  ('70000001-0000-0000-0000-000000000012','manual_override', NULL, 'Hazmat manifest checked — allowed', now() - interval '7h50m'),
  ('70000001-0000-0000-0000-000000000012','depart',     NULL, 'Chemical consignment cleared', now() - interval '5h')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 5. DOCK APPOINTMENTS
-- =========================================================
INSERT INTO public.dock_appointments (id, dock_id, truck_id, carrier, carrier_category, reference, appointment_type, status, starts_at, ends_at, notes) VALUES
  ('a0000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001','70000001-0000-0000-0000-000000000001','TATA Motors Logistics','standard','TML-2024-IN-001','inbound','in_progress', now() - interval '1h', now() + interval '30m', 'Priority unload — automotive parts'),
  ('a0000001-0000-0000-0000-000000000002','d0000001-0000-0000-0000-000000000002','70000001-0000-0000-0000-000000000002','Mahindra Logistics','refrigerated','MLL-2024-IN-042','inbound','scheduled',  now() + interval '15m', now() + interval '1h15m', 'Cold chain — pre-cool dock required'),
  ('a0000001-0000-0000-0000-000000000003','d0000001-0000-0000-0000-000000000005','70000001-0000-0000-0000-000000000003','Delhivery','express','DEL-2024-OUT-187','outbound','scheduled', now() + interval '30m', now() + interval '1h', 'Express parcel sortation — tight window'),
  ('a0000001-0000-0000-0000-000000000004','d0000001-0000-0000-0000-000000000007','70000001-0000-0000-0000-000000000004','VRL Logistics','standard','VRL-2024-IN-023','inbound','in_progress', now() - interval '2h', now() + interval '1h', 'Heavy machinery — crane assist needed'),
  ('a0000001-0000-0000-0000-000000000005','d0000001-0000-0000-0000-000000000008','70000001-0000-0000-0000-000000000005','Blue Dart Express','express','BDX-2024-OUT-009','outbound','scheduled', now() + interval '45m', now() + interval '1h30m', 'Air cargo handover to courier'),
  ('a0000001-0000-0000-0000-000000000006','d0000001-0000-0000-0000-000000000001','70000001-0000-0000-0000-000000000006','Safexpress','standard','SFX-2024-IN-064','inbound','scheduled', now() + interval '2h', now() + interval '3h', 'Pharma freight — temp monitoring'),
  ('a0000001-0000-0000-0000-000000000007','d0000001-0000-0000-0000-000000000002',NULL,'Rivigo','standard','RVG-2024-IN-031','inbound','scheduled', now() + interval '3h', now() + interval '4h', 'Relay handoff'),
  ('a0000001-0000-0000-0000-000000000008','d0000001-0000-0000-0000-000000000006','70000001-0000-0000-0000-000000000009','TCI Express','container','TCI-2024-IN-055','inbound','scheduled', now() + interval '4h', now() + interval '5h30m', 'Port container — customs cleared'),
  ('a0000001-0000-0000-0000-000000000009','d0000001-0000-0000-0000-000000000005',NULL,'DTDC Logistics','standard','DTDC-2024-OUT-101','outbound','completed', now() - interval '5h', now() - interval '3h30m', 'Completed on time'),
  ('a0000001-0000-0000-0000-000000000010','d0000001-0000-0000-0000-000000000004','70000001-0000-0000-0000-000000000012','Spoton Logistics','hazmat','SPT-2024-IN-047','inbound','completed', now() - interval '7h', now() - interval '5h', 'Hazmat unload completed safely')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 6. TASKS
-- =========================================================
INSERT INTO public.tasks (id, title, instructions, task_type, priority, status, truck_id, dock_id, slot_id, trailer_number, due_at) VALUES
  ('f0000001-0000-0000-0000-000000000001','Move TML-TR-001 to Dock A-01','Drive TATA trailer from A01 to Dock A-01 for unloading. Check tyre pressure before move.','move_trailer','high','in_progress','70000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001','50000001-0000-0000-0000-000000000001','TML-TR-001', now() + interval '30m'),
  ('f0000001-0000-0000-0000-000000000002','Inspect MLL-TR-042 refrigeration unit','Check reefer temperature log and seal integrity before Mahindra cold chain unload.','inspect','urgent','pending','70000001-0000-0000-0000-000000000002',NULL,NULL,'MLL-TR-042', now() + interval '10m'),
  ('f0000001-0000-0000-0000-000000000003','Fuel VRL-TR-023 before departure','Refuel VRL heavy truck at pump station 2 after unloading is complete.','fuel','normal','pending','70000001-0000-0000-0000-000000000004',NULL,NULL,'VRL-TR-023', now() + interval '2h'),
  ('f0000001-0000-0000-0000-000000000004','Wash Blue Dart truck BDX-TR-009','Exterior wash required after TN-38-DF-7890 completes. Bay 3 wash station.','wash','low','pending','70000001-0000-0000-0000-000000000005',NULL,NULL,'BDX-TR-009', now() + interval '3h'),
  ('f0000001-0000-0000-0000-000000000005','Deliver paperwork for DEL-TR-187','Hand Delhivery outbound manifest to gate security post before truck departs.','deliver_paperwork','high','assigned','70000001-0000-0000-0000-000000000003',NULL,NULL,'DEL-TR-187', now() + interval '25m'),
  ('f0000001-0000-0000-0000-000000000006','Relocate XPB-TR-012 to D01','Move XpressBees trailer from staging to far storage zone D — dock A needed.','move_trailer','normal','pending','70000001-0000-0000-0000-000000000010',NULL,'50000001-0000-0000-0000-000000000023','XPB-TR-012', now() + interval '1h'),
  ('f0000001-0000-0000-0000-000000000007','Reserve B07 for Safexpress','Clear and reserve Dock B-01 slot for incoming Safexpress pharma load.','other','high','pending',NULL,'d0000001-0000-0000-0000-000000000005',NULL,NULL, now() + interval '1h45m'),
  ('f0000001-0000-0000-0000-000000000008','Inspect GKW-TR-078 on arrival','Pre-arrival inspection checklist for Gati KWE truck — check seals and docs.','inspect','normal','pending','70000001-0000-0000-0000-000000000008',NULL,NULL,'GKW-TR-078', now() + interval '40m')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 7. OCR READS
-- =========================================================
INSERT INTO public.ocr_reads (truck_id, read_type, raw_value, normalized_value, expected_value, confidence, status, notes) VALUES
  ('70000001-0000-0000-0000-000000000001','plate','MH 12 AB 1234','MH-12-AB-1234','MH-12-AB-1234',0.970,'auto_approved','High confidence — clean plate'),
  ('70000001-0000-0000-0000-000000000002','plate','GJ18 BT5678','GJ-18-BT-5678','GJ-18-BT-5678',0.910,'approved','Low confidence — approved after manual review'),
  ('70000001-0000-0000-0000-000000000003','plate','DL01CX9012','DL-01-CX-9012','DL-01-CX-9012',0.990,'auto_approved','Clean read'),
  ('70000001-0000-0000-0000-000000000004','plate','KA 09 ZP 3456','KA-09-ZP-3456','KA-09-ZP-3456',0.950,'auto_approved','Standard read'),
  ('70000001-0000-0000-0000-000000000005','plate','TN38DF7890','TN-38-DF-7890','TN-38-DF-7890',0.980,'auto_approved','Tamil Nadu plate read OK'),
  ('70000001-0000-0000-0000-000000000012','plate','MP0 9QR990O','MP-09-QR-9900','MP-09-QR-9900',0.880,'overridden','Character O/0 ambiguity — manually corrected'),
  ('70000001-0000-0000-0000-000000000001','trailer','TMLTR001','TML-TR-001','TML-TR-001',0.920,'auto_approved','Trailer number confirmed'),
  ('70000001-0000-0000-0000-000000000004','trailer','VRLTR023','VRL-TR-023','VRL-TR-023',0.880,'approved','Partial occlusion — approved after check')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 8. WEIGHBRIDGE READINGS
-- =========================================================
INSERT INTO public.weighbridge_readings (truck_id, direction, gross_kg, tare_kg, net_kg, expected_kg, deviation_pct, overweight, flagged, notes) VALUES
  ('70000001-0000-0000-0000-000000000001','inbound',26500,8200,18300,18000, 1.67,false,false,'Within tolerance — TATA automotive parts'),
  ('70000001-0000-0000-0000-000000000002','inbound',19800,7600,12200,12000, 1.67,false,false,'Mahindra cold chain — normal'),
  ('70000001-0000-0000-0000-000000000003','inbound',14200,5700,8500, 8500, 0.00,false,false,'Delhivery express — exact match'),
  ('70000001-0000-0000-0000-000000000004','inbound',31000,8800,22200,22000, 0.91,false,false,'VRL heavy machinery — acceptable'),
  ('70000001-0000-0000-0000-000000000005','inbound',11900,7700,4200, 4200, 0.00,false,false,'Blue Dart — correct weight'),
  ('70000001-0000-0000-0000-000000000012','inbound',26300,8600,17700,17500, 1.14,false,false,'Spoton hazmat — within limit'),
  ('70000001-0000-0000-0000-000000000011','outbound',9500,8800,700,  NULL,  NULL,false,false,'DTDC departed — tare only after unload')
ON CONFLICT DO NOTHING;

-- =========================================================
-- 9. PARKING QUEUE
-- =========================================================
INSERT INTO public.parking_queue (truck_id, carrier_category, zone, position, status, reason) VALUES
  ('70000001-0000-0000-0000-000000000006','standard','A',1,'waiting','Awaiting dock A-01 clearance for Safexpress'),
  ('70000001-0000-0000-0000-000000000007','standard','A',2,'waiting','Rivigo relay — queue behind Safexpress'),
  ('70000001-0000-0000-0000-000000000008','standard','B',1,'waiting','Gati KWE — Dock B-02 targeted'),
  ('70000001-0000-0000-0000-000000000009','container','C',1,'waiting','TCI container — Dock C-01 targeted'),
  ('70000001-0000-0000-0000-000000000010','express','A',3,'waiting','XpressBees — express lane priority')
ON CONFLICT DO NOTHING;
