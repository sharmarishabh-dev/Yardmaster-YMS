import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import type { Database } from "@/integrations/supabase/types";

type CarrierCategory = Database["public"]["Enums"]["carrier_category"];
const ALL_CATEGORIES: CarrierCategory[] = ["standard", "refrigerated", "hazmat", "oversize", "express", "container"];
const CATEGORY_STYLE: Record<CarrierCategory, string> = {
  standard: "bg-ink/10 text-ink",
  refrigerated: "bg-blue-500/15 text-blue-700",
  hazmat: "bg-destructive/15 text-destructive",
  oversize: "bg-amber-500/15 text-amber-700",
  express: "bg-hazard/20 text-ink",
  container: "bg-emerald-500/15 text-emerald-700",
};

export const Route = createFileRoute("/dashboard/gate")({
  head: () => ({ meta: [{ title: "Gate Control — YardMaster" }] }),
  component: GatePage,
});

// ──────────────────────────────────────────────────────────
// Confidence thresholds (Standard mode)
// ──────────────────────────────────────────────────────────
const OCR_AUTO_APPROVE = 0.9;
const OCR_REVIEW_MIN = 0.7;

// Weight rules
const WEIGHT_DEVIATION_PCT = 5; // ±5%
const WEIGHT_OVERWEIGHT_KG = 40000; // legal max gross

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────
type TruckStatus = "pending" | "checked_in" | "rejected" | "departed";

interface Truck {
  id: string;
  carrier: string;
  plate: string;
  trailer_number: string | null;
  driver_name: string | null;
  appointment_at: string | null;
  status: TruckStatus;
  gate: string | null;
  checked_in_at: string | null;
  notes: string | null;
  expected_weight_kg: number | null;
  created_at: string;
}

interface GateEvent {
  id: string;
  truck_id: string;
  event_type: "ocr_scan" | "manual_approve" | "manual_override" | "reject" | "depart";
  ocr_confidence: number | null;
  notes: string | null;
  created_at: string;
}

interface OcrRead {
  id: string;
  truck_id: string;
  read_type: "plate" | "trailer";
  raw_value: string;
  normalized_value: string;
  expected_value: string | null;
  confidence: number;
  status: "auto_approved" | "needs_review" | "rejected" | "overridden";
  override_value: string | null;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
}

interface WeighReading {
  id: string;
  truck_id: string;
  direction: "inbound" | "outbound";
  gross_kg: number;
  tare_kg: number | null;
  net_kg: number | null;
  expected_kg: number | null;
  deviation_pct: number | null;
  overweight: boolean;
  flagged: boolean;
  flag_reason: string | null;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
}

interface QrToken {
  id: string;
  token: string;
  scope: "appointment" | "truck";
  appointment_id: string | null;
  truck_id: string | null;
  expires_at: string;
  used_at: string | null;
}

const STATUS_STYLES: Record<TruckStatus, string> = {
  pending: "bg-paper text-ink",
  checked_in: "bg-ink text-background",
  rejected: "bg-hazard text-ink",
  departed: "bg-background text-muted-foreground border border-ink/30",
};

// ──────────────────────────────────────────────────────────
function GatePage() {
  const { user, roles } = useAuth();
  const canAct = roles.includes("admin") || roles.includes("operator");
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [ocrReads, setOcrReads] = useState<OcrRead[]>([]);
  const [weighs, setWeighs] = useState<WeighReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [weighing, setWeighing] = useState(false);
  const [parkingQueueCount, setParkingQueueCount] = useState(0);

  // Form
  const [carrier, setCarrier] = useState("");
  const [plate, setPlate] = useState("");
  const [trailer, setTrailer] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [gate, setGate] = useState("G-01");
  const [expectedWeight, setExpectedWeight] = useState("");
  const [carrierCategory, setCarrierCategory] = useState<CarrierCategory>("standard");

  // QR modal
  const [qrTruck, setQrTruck] = useState<Truck | null>(null);
  const [qrPurpose, setQrPurpose] = useState<"checkin" | "checkout">("checkin");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState(false);

  // OCR decision modal — captures reason for approve / override / reject
  const [ocrDecision, setOcrDecision] = useState<{
    read: OcrRead;
    action: "approve" | "override" | "reject";
  } | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [decisionReason, setDecisionReason] = useState("");

  // Weight flag clear modal — captures reason
  const [weighDecision, setWeighDecision] = useState<WeighReading | null>(null);
  const [weighReason, setWeighReason] = useState("");

  const selected = useMemo(
    () => trucks.find((t) => t.id === selectedId) ?? null,
    [trucks, selectedId],
  );
  const selectedEvents = useMemo(
    () => events.filter((e) => e.truck_id === selectedId),
    [events, selectedId],
  );
  const selectedReads = useMemo(
    () => ocrReads.filter((r) => r.truck_id === selectedId),
    [ocrReads, selectedId],
  );
  const selectedWeighs = useMemo(
    () => weighs.filter((w) => w.truck_id === selectedId),
    [weighs, selectedId],
  );

  // Load + realtime
  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: t }, { data: e }, { data: o }, { data: w }] = await Promise.all([
        supabase.from("trucks").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("gate_events").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("ocr_reads").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("weighbridge_readings").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (!active) return;
      setTrucks((t ?? []) as Truck[]);
      setEvents((e ?? []) as GateEvent[]);
      setOcrReads((o ?? []) as OcrRead[]);
      setWeighs((w ?? []) as WeighReading[]);
      setLoading(false);
    })();

    const ch = supabase
      .channel("gate-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, (payload) => {
        setTrucks((prev) => {
          if (payload.eventType === "INSERT") return [payload.new as Truck, ...prev];
          if (payload.eventType === "UPDATE")
            return prev.map((t) => (t.id === (payload.new as Truck).id ? (payload.new as Truck) : t));
          if (payload.eventType === "DELETE")
            return prev.filter((t) => t.id !== (payload.old as Truck).id);
          return prev;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "gate_events" }, (payload) => {
        setEvents((prev) => [payload.new as GateEvent, ...prev]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ocr_reads" }, (payload) => {
        setOcrReads((prev) => {
          if (payload.eventType === "INSERT") return [payload.new as OcrRead, ...prev];
          if (payload.eventType === "UPDATE")
            return prev.map((r) => (r.id === (payload.new as OcrRead).id ? (payload.new as OcrRead) : r));
          return prev;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "weighbridge_readings" }, (payload) => {
        setWeighs((prev) => [payload.new as WeighReading, ...prev]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_queue" }, async () => {
        const { count } = await supabase
          .from("parking_queue").select("id", { count: "exact", head: true }).eq("status", "waiting");
        setParkingQueueCount(count ?? 0);
      })
      .subscribe();

    void supabase
      .from("parking_queue").select("id", { count: "exact", head: true }).eq("status", "waiting")
      .then(({ count }) => setParkingQueueCount(count ?? 0));

    return () => {
      active = false;
      void supabase.removeChannel(ch);
    };
  }, []);

  const queue = trucks.filter((t) => t.status === "pending");
  const onsite = trucks.filter((t) => t.status === "checked_in");
  const reviewQueue = ocrReads.filter((r) => r.status === "needs_review");
  const flaggedWeighs = weighs.filter((w) => w.flagged);

  async function logEvent(
    truckId: string,
    type: GateEvent["event_type"],
    notes?: string,
    confidence?: number,
  ) {
    await supabase.from("gate_events").insert({
      truck_id: truckId,
      event_type: type,
      actor_id: user?.id,
      notes: notes ?? null,
      ocr_confidence: confidence ?? null,
    });
  }

  async function addTruck(e: React.FormEvent) {
    e.preventDefault();
    if (!canAct) return toast.error("Operator or Admin role required");
    if (!carrier || !plate) return toast.error("Carrier and plate required");
    const expected = expectedWeight ? parseInt(expectedWeight, 10) : null;
    const { data, error } = await supabase
      .from("trucks")
      .insert({
        carrier,
        plate: plate.toUpperCase(),
        trailer_number: trailer ? trailer.toUpperCase() : null,
        driver_name: driver || null,
        driver_phone: driverPhone ? driverPhone.trim() : null,
        gate,
        expected_weight_kg: expected,
        carrier_category: carrierCategory,
        status: "pending",
        created_by: user?.id,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setCarrier(""); setPlate(""); setTrailer(""); setDriver(""); setDriverPhone(""); setExpectedWeight(""); setCarrierCategory("standard");
    toast.success(`Truck ${data.plate} added to queue`);
    setSelectedId(data.id);
  }

  // ── OCR (plate or trailer) with confidence thresholds ──
  async function runOcr(truck: Truck, type: "plate" | "trailer") {
    if (!canAct) return toast.error("Operator or Admin role required");
    const expected = type === "plate" ? truck.plate : truck.trailer_number;
    if (!expected) return toast.error(`No expected ${type} on file`);
    setScanning(true);
    await new Promise((r) => setTimeout(r, 1100));

    // Simulated OCR: 80% chance of correct read, confidence varies
    const confidence = Math.round((0.6 + Math.random() * 0.39) * 1000) / 1000;
    const correctChance = Math.random();
    let raw = expected;
    if (correctChance > 0.85) {
      // Slight misread — substitute one char
      const idx = Math.floor(Math.random() * expected.length);
      const subs: Record<string, string> = { O: "0", "0": "O", I: "1", "1": "I", B: "8", S: "5" };
      const ch = expected[idx];
      raw = expected.slice(0, idx) + (subs[ch] ?? ch) + expected.slice(idx + 1);
    }
    const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

    let status: OcrRead["status"];
    let toastMsg: string;
    const matches = normalized === expected.toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (confidence >= OCR_AUTO_APPROVE && matches) {
      status = "auto_approved";
      toastMsg = `${type.toUpperCase()} OCR auto-approved · ${(confidence * 100).toFixed(0)}%`;
    } else if (confidence >= OCR_REVIEW_MIN) {
      status = "needs_review";
      toastMsg = `${type.toUpperCase()} OCR needs review · ${(confidence * 100).toFixed(0)}%`;
    } else {
      status = "rejected";
      toastMsg = `${type.toUpperCase()} OCR rejected · ${(confidence * 100).toFixed(0)}%`;
    }

    await supabase.from("ocr_reads").insert({
      truck_id: truck.id,
      read_type: type,
      raw_value: raw,
      normalized_value: normalized,
      expected_value: expected,
      confidence,
      status,
    });
    await logEvent(
      truck.id,
      "ocr_scan",
      `${type} OCR: read=${raw} expected=${expected} status=${status}`,
      confidence,
    );

    if (status === "auto_approved" && type === "plate" && truck.status === "pending") {
      await supabase
        .from("trucks")
        .update({ status: "checked_in", checked_in_at: new Date().toISOString() })
        .eq("id", truck.id);
      await logEvent(truck.id, "manual_approve", "Auto-checked-in by plate OCR", confidence);
    }

    if (status === "auto_approved") toast.success(toastMsg);
    else if (status === "needs_review") toast.warning(toastMsg);
    else toast.error(toastMsg);
    setScanning(false);
  }

  // Apply an OCR decision (approve / override / reject) with audit reason
  async function applyOcrDecision() {
    if (!ocrDecision) return;
    if (!canAct) return toast.error("Operator or Admin role required");
    const { read, action } = ocrDecision;
    if (!decisionReason.trim()) return toast.error("Reason required for audit trail");
    if (action === "override" && !overrideValue.trim())
      return toast.error("Enter an override value");

    const finalValue =
      action === "override" ? overrideValue.toUpperCase() : read.normalized_value;
    const newStatus =
      action === "approve" ? "auto_approved" : action === "override" ? "overridden" : "rejected";

    await supabase
      .from("ocr_reads")
      .update({
        status: newStatus,
        override_value: action === "override" ? finalValue : null,
        override_reason: decisionReason.trim(),
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", read.id);

    const eventType: GateEvent["event_type"] =
      action === "reject" ? "reject" : "manual_override";
    await logEvent(
      read.truck_id,
      eventType,
      `${read.read_type} ${action} → ${finalValue} · reason: ${decisionReason.trim()}`,
    );

    toast.success(
      action === "approve" ? "Read approved" : action === "override" ? "Override saved" : "Read rejected",
    );
    setOcrDecision(null);
    setOverrideValue("");
    setDecisionReason("");
  }

  // ── Weighbridge ──
  async function runWeigh(truck: Truck, direction: "inbound" | "outbound") {
    if (!canAct) return toast.error("Operator or Admin role required");
    setWeighing(true);
    await new Promise((r) => setTimeout(r, 800));

    // Simulated weighbridge reading
    const expected = truck.expected_weight_kg;
    const baseGross =
      expected ?? (direction === "inbound" ? 32000 + Math.random() * 8000 : 14000 + Math.random() * 4000);
    // Add ±8% noise so we sometimes flag
    const noise = (Math.random() - 0.5) * 0.16;
    const gross = Math.round(baseGross * (1 + noise));
    const tare = direction === "outbound" ? 13500 + Math.round(Math.random() * 1000) : null;
    const net = tare ? gross - tare : null;

    const overweight = gross > WEIGHT_OVERWEIGHT_KG;
    let deviation: number | null = null;
    let deviationFlag = false;
    if (expected && expected > 0) {
      deviation = Math.round(((gross - expected) / expected) * 10000) / 100;
      deviationFlag = Math.abs(deviation) > WEIGHT_DEVIATION_PCT;
    }

    const flagged = overweight || deviationFlag;
    const reasons: string[] = [];
    if (overweight) reasons.push(`Overweight ${gross}kg > ${WEIGHT_OVERWEIGHT_KG}kg`);
    if (deviationFlag) reasons.push(`Deviation ${deviation}% exceeds ±${WEIGHT_DEVIATION_PCT}%`);

    await supabase.from("weighbridge_readings").insert({
      truck_id: truck.id,
      direction,
      gross_kg: gross,
      tare_kg: tare,
      net_kg: net,
      expected_kg: expected,
      deviation_pct: deviation,
      overweight,
      flagged,
      flag_reason: reasons.join(" · ") || null,
    });

    await logEvent(
      truck.id,
      "ocr_scan",
      `Weighbridge ${direction}: ${gross}kg${flagged ? " ⚠ FLAGGED: " + reasons.join("; ") : ""}`,
    );

    if (flagged) toast.error(`Weight flagged · ${reasons.join("; ")}`);
    else toast.success(`Weighbridge ${direction} OK · ${gross.toLocaleString()} kg`);
    setWeighing(false);
  }

  async function clearWeighFlagWithReason() {
    if (!weighDecision) return;
    if (!canAct) return toast.error("Operator or Admin role required");
    if (!weighReason.trim()) return toast.error("Reason required for audit trail");
    await supabase
      .from("weighbridge_readings")
      .update({
        flagged: false,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        override_reason: weighReason.trim(),
        notes: `Operator override — ${weighReason.trim()}`,
      })
      .eq("id", weighDecision.id);
    await logEvent(
      weighDecision.truck_id,
      "manual_override",
      `Weight flag cleared (${weighDecision.gross_kg}kg ${weighDecision.direction}) · reason: ${weighReason.trim()}`,
    );
    toast.success("Weight flag cleared");
    setWeighDecision(null);
    setWeighReason("");
  }

  // ── QR generation (check-in OR check-out) ──
  async function generateQr(truck: Truck, purpose: "checkin" | "checkout" = "checkin") {
    if (!canAct) return toast.error("Operator or Admin role required");
    setQrTruck(truck);
    setQrPurpose(purpose);
    setQrGenerating(true);
    setQrDataUrl(null);

    // Find next scheduled appointment for this truck (preferred), else create truck-scope token
    const { data: appt } = await supabase
      .from("dock_appointments")
      .select("id")
      .eq("truck_id", truck.id)
      .in("status", ["scheduled", "in_progress"])
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const token = randomToken(28);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(); // 12h

    const insertPayload: {
      token: string;
      scope: "appointment" | "truck";
      purpose: "checkin" | "checkout";
      appointment_id?: string;
      truck_id?: string;
      expires_at: string;
    } = appt
      ? { token, scope: "appointment", purpose, appointment_id: appt.id, expires_at: expiresAt }
      : { token, scope: "truck", purpose, truck_id: truck.id, expires_at: expiresAt };

    const { error } = await supabase.from("appointment_qr_tokens").insert(insertPayload);
    if (error) {
      toast.error(error.message);
      setQrGenerating(false);
      return;
    }

    const path = purpose === "checkout" ? "checkout" : "checkin";
    const url = `${window.location.origin}/${path}/${token}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    setQrUrl(url);
    setQrDataUrl(dataUrl);
    setQrGenerating(false);
    toast.success(`${purpose === "checkout" ? "Check-out" : "Check-in"} QR ready`);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="border-2 border-ink bg-background">
        <div className="hazard-stripe h-2" />
        <div className="grid gap-6 p-6 md:grid-cols-[2fr_1fr] md:items-end">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Gate Control · Live · OCR ≥{Math.round(OCR_AUTO_APPROVE * 100)}% auto · {Math.round(OCR_REVIEW_MIN * 100)}–{Math.round(OCR_AUTO_APPROVE * 100)}% review
            </div>
            <h1 className="font-display mt-3 text-4xl leading-[0.95] tracking-tighter md:text-5xl">
              Incoming queue & check-in.
            </h1>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Drivers self check-in via QR. Plates & trailers verified by OCR with confidence
              gating. Weighbridge enforces ±{WEIGHT_DEVIATION_PCT}% deviation and{" "}
              {WEIGHT_OVERWEIGHT_KG.toLocaleString()} kg max gross. Low-confidence reads route to
              manual review.
            </p>
          </div>
          <dl className="grid grid-cols-5 gap-px bg-ink">
            <Tile k={String(queue.length)} v="In queue" />
            <Tile k={String(onsite.length)} v="On site" tone="hazard" />
            <Tile k={String(reviewQueue.length)} v="Review" tone={reviewQueue.length > 0 ? "hazard" : undefined} />
            <Tile k={String(flaggedWeighs.length)} v="Wt flag" tone={flaggedWeighs.length > 0 ? "hazard" : undefined} />
            <Tile k={String(parkingQueueCount)} v="Park Q" tone={parkingQueueCount > 0 ? "hazard" : undefined} />
          </dl>
        </div>
        {parkingQueueCount > 0 && (
          <div className="border-t-2 border-ink bg-hazard/10 px-6 py-2 font-mono text-[11px] uppercase tracking-widest text-ink">
            ⚠ {parkingQueueCount} truck{parkingQueueCount === 1 ? "" : "s"} waiting in parking queue · open Yard Map → Parking queue tab to assign
          </div>
        )}
      </section>

      {/* Review queue band — always visible if any */}
      {(reviewQueue.length > 0 || flaggedWeighs.length > 0) && (
        <section className="border-2 border-hazard bg-hazard/15">
          <header className="flex items-center justify-between border-b-2 border-hazard px-5 py-3">
            <h2 className="font-display text-xl tracking-tight">Manual review queue</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink">
              ● {reviewQueue.length} OCR · {flaggedWeighs.length} weight
            </span>
          </header>
          <div className="grid gap-px bg-hazard md:grid-cols-2">
            <div className="space-y-px bg-hazard">
              {reviewQueue.length === 0 && (
                <div className="bg-background p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  No OCR reads pending review.
                </div>
              )}
              {reviewQueue.slice(0, 6).map((r) => {
                const truck = trucks.find((t) => t.id === r.truck_id);
                return (
                  <div key={r.id} className="bg-background p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                          {r.read_type} · {(r.confidence * 100).toFixed(0)}%
                        </div>
                        <div className="mt-1 font-display text-lg tracking-tight">
                          read <span className="font-mono">{r.normalized_value}</span> ·{" "}
                          expected{" "}
                          <span className="font-mono">{r.expected_value ?? "—"}</span>
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {truck?.plate ?? "—"} · {truck?.carrier ?? "—"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={!canAct}
                          onClick={() => {
                            setOcrDecision({ read: r, action: "approve" });
                            setDecisionReason("");
                          }}
                          className="border-2 border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          disabled={!canAct}
                          onClick={() => {
                            setOcrDecision({ read: r, action: "override" });
                            setOverrideValue(r.expected_value ?? r.normalized_value);
                            setDecisionReason("");
                          }}
                          className="border-2 border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink disabled:opacity-40"
                        >
                          Override
                        </button>
                        <button
                          disabled={!canAct}
                          onClick={() => {
                            setOcrDecision({ read: r, action: "reject" });
                            setDecisionReason("");
                          }}
                          className="border-2 border-hazard bg-hazard px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink hover:bg-ink hover:text-hazard disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-px bg-hazard">
              {flaggedWeighs.length === 0 && (
                <div className="bg-background p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  No weighbridge flags.
                </div>
              )}
              {flaggedWeighs.slice(0, 6).map((w) => {
                const truck = trucks.find((t) => t.id === w.truck_id);
                return (
                  <div key={w.id} className="bg-background p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                          {w.direction} · {w.gross_kg.toLocaleString()} kg
                          {w.deviation_pct != null && ` · ${w.deviation_pct > 0 ? "+" : ""}${w.deviation_pct}%`}
                        </div>
                        <div className="mt-1 font-display text-lg tracking-tight">
                          {truck?.plate ?? "—"}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {w.flag_reason}
                        </div>
                      </div>
                      <button
                        disabled={!canAct}
                        onClick={() => {
                          setWeighDecision(w);
                          setWeighReason("");
                        }}
                        className="border-2 border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                      >
                        Clear flag
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Queue */}
        <section className="border-2 border-ink bg-background">
          <header className="flex items-end justify-between border-b-2 border-ink px-5 py-4">
            <div>
              <h2 className="font-display text-2xl tracking-tight">Incoming queue</h2>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {loading ? "Loading…" : `${queue.length} waiting · ${onsite.length} checked in`}
              </p>
            </div>
          </header>
          <div className="divide-y-2 divide-ink/10">
            {[...queue, ...onsite].length === 0 && !loading && (
              <div className="p-8 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                No trucks at the gate. Add one →
              </div>
            )}
            {[...queue, ...onsite].map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-paper ${
                  selectedId === t.id ? "bg-paper" : ""
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t.gate ?? "—"}
                  </span>
                  <div>
                    <div className="font-display text-xl tracking-tight">{t.plate}</div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {t.carrier} {t.trailer_number ? `· TR ${t.trailer_number}` : ""}
                    </div>
                  </div>
                </div>
                <span
                  className={`px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${STATUS_STYLES[t.status]}`}
                >
                  {t.status.replace("_", " ")}
                </span>
              </button>
            ))}
          </div>

          {/* Add truck */}
          <form onSubmit={addTruck} className="border-t-2 border-ink bg-paper p-5">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Manual gate entry
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <Input value={carrier} onChange={setCarrier} placeholder="Carrier" />
              <Input value={plate} onChange={setPlate} placeholder="Plate" />
              <Input value={trailer} onChange={setTrailer} placeholder="Trailer #" />
              <Input value={driver} onChange={setDriver} placeholder="Driver" />
              <Input value={driverPhone} onChange={setDriverPhone} placeholder="Driver phone (+15551234567)" />
              <Input value={gate} onChange={setGate} placeholder="Gate" />
              <Input value={expectedWeight} onChange={setExpectedWeight} placeholder="Expected wt (kg)" />
            </div>
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Carrier category
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCarrierCategory(c)}
                    className={`border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${carrierCategory === c ? "bg-ink text-background" : CATEGORY_STYLE[c]}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={!canAct}
              className="mt-3 w-full border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-background transition hover:bg-hazard hover:text-ink disabled:opacity-40"
            >
              {canAct ? "Add to queue" : "Read-only · operator role required"}
            </button>
          </form>
        </section>

        {/* Detail */}
        <section className="border-2 border-ink bg-background">
          <header className="border-b-2 border-ink px-5 py-4">
            <h2 className="font-display text-2xl tracking-tight">Gate decision</h2>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {selected ? `Truck ${selected.plate}` : "Select a truck from the queue"}
            </p>
          </header>

          {!selected && (
            <div className="p-8 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ● No truck selected
            </div>
          )}

          {selected && (
            <div className="space-y-5 p-5">
              <dl className="grid grid-cols-2 gap-px bg-ink/10 text-sm">
                <Field label="Carrier" value={selected.carrier} />
                <Field label="Plate" value={selected.plate} mono />
                <Field label="Trailer" value={selected.trailer_number ?? "—"} mono />
                <Field label="Driver" value={selected.driver_name ?? "—"} />
                <Field label="Gate" value={selected.gate ?? "—"} mono />
                <Field
                  label="Expected wt"
                  value={selected.expected_weight_kg ? `${selected.expected_weight_kg.toLocaleString()} kg` : "—"}
                  mono
                />
              </dl>

              {/* Side-by-side verification: expected vs latest reading */}
              {(() => {
                const latestPlate = selectedReads.find((r) => r.read_type === "plate");
                const latestTrailer = selectedReads.find((r) => r.read_type === "trailer");
                const latestWeigh = selectedWeighs[0];
                return (
                  <div className="border-2 border-ink bg-paper">
                    <div className="border-b-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Verification · expected vs latest reading
                    </div>
                    <div className="divide-y-2 divide-ink/10">
                      <VerifyRow
                        label="Plate"
                        expected={selected.plate}
                        actual={latestPlate?.normalized_value ?? null}
                        confidence={latestPlate?.confidence ?? null}
                        status={latestPlate?.status ?? null}
                      />
                      <VerifyRow
                        label="Trailer"
                        expected={selected.trailer_number ?? "—"}
                        actual={latestTrailer?.normalized_value ?? null}
                        confidence={latestTrailer?.confidence ?? null}
                        status={latestTrailer?.status ?? null}
                      />
                      <VerifyRow
                        label="Weight"
                        expected={
                          selected.expected_weight_kg
                            ? `${selected.expected_weight_kg.toLocaleString()} kg`
                            : "—"
                        }
                        actual={
                          latestWeigh ? `${latestWeigh.gross_kg.toLocaleString()} kg` : null
                        }
                        deviation={latestWeigh?.deviation_pct ?? null}
                        flagged={latestWeigh?.flagged ?? false}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* QR self check-in / check-out */}
              <div className="space-y-2 border-2 border-ink bg-paper p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Driver QR · 12h validity
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={!canAct}
                    onClick={() => generateQr(selected, "checkin")}
                    className="border-2 border-ink bg-background px-4 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                  >
                    Check-in QR
                  </button>
                  <button
                    disabled={!canAct || selected.status !== "checked_in"}
                    onClick={() => generateQr(selected, "checkout")}
                    title={selected.status !== "checked_in" ? "Truck must be checked in first" : ""}
                    className="border-2 border-hazard bg-hazard px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-ink hover:bg-ink hover:text-hazard disabled:opacity-40"
                  >
                    Check-out QR
                  </button>
                </div>
              </div>

              {/* OCR */}
              <div className="space-y-2 border-2 border-ink bg-paper p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  OCR capture
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={!canAct || scanning}
                    onClick={() => runOcr(selected, "plate")}
                    className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink disabled:opacity-40"
                  >
                    {scanning ? "● Scanning…" : "Scan plate"}
                  </button>
                  <button
                    disabled={!canAct || scanning || !selected.trailer_number}
                    onClick={() => runOcr(selected, "trailer")}
                    className="border-2 border-ink bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                  >
                    Scan trailer
                  </button>
                </div>
              </div>

              {/* Weighbridge */}
              <div className="space-y-2 border-2 border-ink bg-paper p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Weighbridge · ±{WEIGHT_DEVIATION_PCT}% · max {WEIGHT_OVERWEIGHT_KG.toLocaleString()} kg
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={!canAct || weighing}
                    onClick={() => runWeigh(selected, "inbound")}
                    className="border-2 border-ink bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                  >
                    {weighing ? "● Weighing…" : "Weigh in"}
                  </button>
                  <button
                    disabled={!canAct || weighing}
                    onClick={() => runWeigh(selected, "outbound")}
                    className="border-2 border-ink bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
                  >
                    Weigh out
                  </button>
                </div>
                {selectedWeighs.length > 0 && (
                  <ol className="mt-2 space-y-1">
                    {selectedWeighs.slice(0, 3).map((w) => (
                      <li key={w.id} className="font-mono text-[10px] uppercase tracking-widest">
                        <span className={w.flagged ? "text-hazard" : "text-muted-foreground"}>
                          {w.direction} · {w.gross_kg.toLocaleString()} kg
                          {w.deviation_pct != null && ` · ${w.deviation_pct > 0 ? "+" : ""}${w.deviation_pct}%`}
                          {w.flagged ? " ⚠" : " ✓"}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Audit log */}
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Audit log
                </div>
                <ol className="space-y-1 border-l-2 border-ink pl-3 max-h-64 overflow-auto">
                  {selectedEvents.length === 0 && selectedReads.length === 0 && (
                    <li className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      No events yet.
                    </li>
                  )}
                  {selectedEvents.map((e) => (
                    <li key={e.id} className="text-xs">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                        {e.event_type.replace("_", " ")}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {new Date(e.created_at).toLocaleTimeString()}
                      </span>
                      {e.ocr_confidence != null && (
                        <span className="ml-1 text-muted-foreground">
                          · {(Number(e.ocr_confidence) * 100).toFixed(0)}%
                        </span>
                      )}
                      {e.notes && <div className="text-muted-foreground">{e.notes}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* QR modal */}
      {qrTruck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="w-full max-w-sm border-2 border-ink bg-background">
            <div className="hazard-stripe h-2" />
            <div className="p-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● Driver {qrPurpose === "checkout" ? "check-out" : "check-in"} QR · {qrTruck.plate}
              </div>
              <div className="mt-4 flex items-center justify-center bg-paper p-4">
                {qrGenerating && (
                  <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Generating…
                  </div>
                )}
                {qrDataUrl && <img src={qrDataUrl} alt={`Driver ${qrPurpose} QR`} className="h-72 w-72" />}
              </div>
              {qrUrl && (
                <div className="mt-3 break-all border-2 border-ink/30 bg-paper p-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {qrUrl}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {qrUrl && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(qrUrl);
                      toast.success("Link copied");
                    }}
                    className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
                  >
                    Copy link
                  </button>
                )}
                <button
                  onClick={() => {
                    setQrTruck(null);
                    setQrDataUrl(null);
                    setQrUrl(null);
                  }}
                  className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OCR decision modal — approve / override / reject with audit reason */}
      {ocrDecision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="w-full max-w-md border-2 border-ink bg-background">
            <div className="hazard-stripe h-2" />
            <div className="p-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● {ocrDecision.action} · {ocrDecision.read.read_type}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-px bg-ink/10">
                <div className="bg-paper p-3">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    OCR read
                  </div>
                  <div className="mt-1 font-mono text-base">
                    {ocrDecision.read.normalized_value}
                  </div>
                  <div className="font-mono text-[10px] text-hazard">
                    {(ocrDecision.read.confidence * 100).toFixed(0)}% confidence
                  </div>
                </div>
                <div className="bg-paper p-3">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Expected
                  </div>
                  <div className="mt-1 font-mono text-base">
                    {ocrDecision.read.expected_value ?? "—"}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {ocrDecision.read.normalized_value === ocrDecision.read.expected_value
                      ? "match ✓"
                      : "mismatch ⚠"}
                  </div>
                </div>
              </div>
              {ocrDecision.action === "override" && (
                <input
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value.toUpperCase())}
                  placeholder="Correct value"
                  maxLength={32}
                  className="mt-4 w-full border-2 border-ink bg-paper px-3 py-3 font-mono text-sm uppercase tracking-widest focus:bg-background focus:outline-none"
                />
              )}
              <textarea
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder="Reason for audit trail (required)"
                maxLength={240}
                rows={2}
                className="mt-3 w-full resize-none border-2 border-ink bg-paper px-3 py-2 font-mono text-xs focus:bg-background focus:outline-none"
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setOcrDecision(null);
                    setOverrideValue("");
                    setDecisionReason("");
                  }}
                  className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
                >
                  Cancel
                </button>
                <button
                  onClick={applyOcrDecision}
                  className={`border-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                    ocrDecision.action === "reject"
                      ? "border-hazard bg-hazard text-ink hover:bg-ink hover:text-hazard"
                      : "border-ink bg-ink text-background hover:bg-hazard hover:text-ink"
                  }`}
                >
                  Confirm {ocrDecision.action}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Weighbridge clear-flag modal — captures audit reason */}
      {weighDecision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="w-full max-w-md border-2 border-ink bg-background">
            <div className="hazard-stripe h-2" />
            <div className="p-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● Clear weight flag · {weighDecision.direction}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-px bg-ink/10">
                <Field
                  label="Gross"
                  value={`${weighDecision.gross_kg.toLocaleString()} kg`}
                  mono
                />
                <Field
                  label="Expected"
                  value={
                    weighDecision.expected_kg
                      ? `${weighDecision.expected_kg.toLocaleString()} kg`
                      : "—"
                  }
                  mono
                />
                <Field
                  label="Deviation"
                  value={
                    weighDecision.deviation_pct != null
                      ? `${weighDecision.deviation_pct > 0 ? "+" : ""}${weighDecision.deviation_pct}%`
                      : "—"
                  }
                  mono
                />
              </div>
              <div className="mt-3 border-2 border-hazard bg-hazard/10 p-3 font-mono text-[11px] text-ink">
                {weighDecision.flag_reason}
              </div>
              <textarea
                value={weighReason}
                onChange={(e) => setWeighReason(e.target.value)}
                placeholder="Reason for clearing flag (required)"
                maxLength={240}
                rows={2}
                className="mt-3 w-full resize-none border-2 border-ink bg-paper px-3 py-2 font-mono text-xs focus:bg-background focus:outline-none"
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setWeighDecision(null);
                    setWeighReason("");
                  }}
                  className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
                >
                  Cancel
                </button>
                <button
                  onClick={clearWeighFlagWithReason}
                  className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
                >
                  Confirm clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function randomToken(len: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

function Tile({ k, v, tone }: { k: string; v: string; tone?: "hazard" }) {
  return (
    <div className={`p-4 ${tone === "hazard" ? "bg-hazard text-ink" : "bg-background"}`}>
      <div className="font-display text-2xl tracking-tight">{k}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {v}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-background p-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 ${mono ? "font-mono" : "font-display tracking-tight"} text-sm`}>
        {value}
      </div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="border-2 border-ink bg-background px-3 py-2 font-mono text-xs uppercase tracking-widest placeholder:text-muted-foreground/60 focus:bg-paper focus:outline-none"
    />
  );
}

function VerifyRow({
  label,
  expected,
  actual,
  confidence,
  status,
  deviation,
  flagged,
}: {
  label: string;
  expected: string;
  actual: string | null;
  confidence?: number | null;
  status?: "auto_approved" | "needs_review" | "rejected" | "overridden" | null;
  deviation?: number | null;
  flagged?: boolean;
}) {
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hasReading = actual != null;
  const isWeight = deviation !== undefined;
  let tone: "ok" | "warn" | "bad" | "idle" = "idle";
  let badge = "no reading";
  if (hasReading) {
    if (isWeight) {
      tone = flagged ? "bad" : Math.abs(deviation ?? 0) > 2 ? "warn" : "ok";
      badge = deviation != null ? `${deviation > 0 ? "+" : ""}${deviation}%` : "—";
    } else {
      const match = normalize(expected) === normalize(actual!);
      if (status === "auto_approved" || (status === "overridden" && match)) tone = "ok";
      else if (status === "needs_review") tone = "warn";
      else if (status === "rejected") tone = "bad";
      else tone = match ? "ok" : "warn";
      badge = status?.replace("_", " ") ?? (match ? "match" : "mismatch");
    }
  }
  const toneClass =
    tone === "ok"
      ? "text-ink border-ink/30"
      : tone === "warn"
        ? "text-hazard border-hazard"
        : tone === "bad"
          ? "bg-hazard text-ink border-hazard"
          : "text-muted-foreground border-ink/20";
  return (
    <div className="grid grid-cols-[68px_1fr_1fr_auto] items-center gap-3 px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          expected
        </div>
        <div className="font-mono text-sm">{expected}</div>
      </div>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          actual{confidence != null ? ` · ${(confidence * 100).toFixed(0)}%` : ""}
        </div>
        <div className="font-mono text-sm">{actual ?? "—"}</div>
      </div>
      <div
        className={`border-2 px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${toneClass}`}
      >
        {badge}
      </div>
    </div>
  );
}
