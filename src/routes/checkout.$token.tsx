import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/checkout/$token")({
  head: () => ({
    meta: [
      { title: "Driver Check-Out — YardMaster" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckoutPage,
});

interface ValidationResult {
  valid: boolean;
  reason?: string;
  scope?: "appointment" | "truck";
  used_at?: string;
  truck?: {
    id: string;
    plate: string;
    carrier: string;
    trailer_number: string | null;
    driver_name: string | null;
    status: string;
    gate: string | null;
  } | null;
  appointment?: {
    id: string;
    carrier: string;
    reference: string | null;
    starts_at: string;
    ends_at: string;
    type: string;
    status: string;
    dock_code: string;
    dock_name: string;
  } | null;
}

interface GateLogEntry {
  id: string;
  event_type: string;
  notes: string | null;
  ocr_confidence: number | null;
  created_at: string;
}

interface OcrSummary {
  id: string;
  read_type: string;
  raw_value: string;
  normalized_value: string;
  confidence: number;
  status: string;
  created_at: string;
}

function CheckoutPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [driverName, setDriverName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateLog, setGateLog] = useState<GateLogEntry | null>(null);
  const [ocrReads, setOcrReads] = useState<OcrSummary[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setResult(null);
    setGateLog(null);
    setOcrReads([]);
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("validate_qr_checkout", {
        _token: token,
      });
      if (rpcError) {
        setError(rpcError.message);
      } else {
        const r = data as unknown as ValidationResult;
        setResult(r);
        if (r.truck?.driver_name) setDriverName(r.truck.driver_name);
        if (r.truck?.id) {
          const [{ data: gateRows }, { data: ocrRows }] = await Promise.all([
            supabase
              .from("gate_events")
              .select("id, event_type, notes, ocr_confidence, created_at")
              .eq("truck_id", r.truck.id)
              .order("created_at", { ascending: false })
              .limit(1),
            supabase
              .from("ocr_reads")
              .select("id, read_type, raw_value, normalized_value, confidence, status, created_at")
              .eq("truck_id", r.truck.id)
              .order("created_at", { ascending: false })
              .limit(2),
          ]);
          setGateLog((gateRows?.[0] as GateLogEntry) ?? null);
          setOcrReads((ocrRows as OcrSummary[]) ?? []);
        }
      }
      setLoading(false);
    })();
  }, [token, retryNonce]);

  function handleRetry() {
    setSuccess(false);
    setRetryNonce((n) => n + 1);
  }

  async function handleCheckOut() {
    if (!driverName.trim()) {
      setError("Please enter the driver name");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("consume_qr_checkout", {
      _token: token,
      _driver_name: driverName.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const r = data as unknown as { ok: boolean; reason?: string };
    if (r.ok) {
      setSuccess(true);
    } else {
      setError(humanReason(r.reason));
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="hazard-stripe h-3" />
      <div className="mx-auto max-w-lg px-5 py-8">
        <header className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
            ● YardMaster · Driver Check-Out
          </div>
          <h1 className="font-display mt-2 text-3xl leading-[0.95] tracking-tighter">
            Self check-out
          </h1>
        </header>

        {loading && (
          <div className="border-2 border-ink bg-background p-8 text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Scan your check-out QR
            </div>
            <div className="mt-3 font-display text-2xl tracking-tight">
              Validating QR…
            </div>
          </div>
        )}

        {!loading && result && !result.valid && (
          <div className="space-y-4">
            <div className="border-2 border-hazard bg-background p-6">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● Check-out rejected
              </div>
              <div className="mt-3 font-display text-2xl tracking-tight">
                {humanReason(result.reason)}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Re-scan the check-out QR shown by the gate operator. If it keeps
                failing, proceed to the gate office for manual processing.
              </p>
              <button
                onClick={handleRetry}
                className="mt-4 flex w-full items-center justify-between border-2 border-ink bg-hazard px-4 py-3 font-mono text-xs uppercase tracking-widest text-ink transition hover:bg-ink hover:text-hazard"
              >
                <span>● Rescan check-out QR</span>
                <span>↻</span>
              </button>
            </div>
            <GateLogPanel gateLog={gateLog} ocrReads={ocrReads} truckPlate={result.truck?.plate ?? null} />
          </div>
        )}

        {!loading && result?.valid && success && (
          <div className="space-y-4">
            <div className="border-2 border-ink bg-ink p-6 text-background">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● Check-out accepted · Departed
              </div>
              <div className="mt-3 font-display text-3xl leading-tight tracking-tighter">
                Drive safe, {driverName.split(" ")[0]}.
              </div>
              <p className="mt-3 text-sm text-background/70">
                Truck{" "}
                <span className="font-mono text-background">
                  {result.truck?.plate ?? "—"}
                </span>{" "}
                marked as departed. Gate is clear.
              </p>
            </div>
            <GateLogPanel gateLog={gateLog} ocrReads={ocrReads} truckPlate={result.truck?.plate ?? null} />
          </div>
        )}

        {!loading && result?.valid && !success && (
          <div className="space-y-4">
            <section className="border-2 border-ink bg-ink p-5 text-background">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                ● Last successful check-in
              </div>
              <div className="font-display mt-2 text-2xl leading-tight tracking-tight">
                {result.truck?.status === "checked_in"
                  ? "On-yard · cleared to depart"
                  : result.truck?.status === "departed"
                    ? "Already departed"
                    : `Status: ${result.truck?.status ?? "unknown"}`}
              </div>
              <p className="mt-2 text-sm text-background/70">
                Truck{" "}
                <span className="font-mono text-background">
                  {result.truck?.plate ?? "—"}
                </span>{" "}
                · Gate{" "}
                <span className="font-mono text-background">
                  {result.truck?.gate ?? "—"}
                </span>
              </p>
            </section>

            <section className="border-2 border-ink bg-background">
              <div className="border-b-2 border-ink px-5 py-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Departure
                </div>
                <div className="mt-1 font-display text-2xl tracking-tight">
                  {result.appointment?.dock_name ?? "Walk-out"}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-ink/10">
                <Field label="Plate" value={result.truck?.plate ?? "—"} mono />
                <Field
                  label="Carrier"
                  value={result.truck?.carrier ?? result.appointment?.carrier ?? "—"}
                />
                <Field label="Trailer" value={result.truck?.trailer_number ?? "—"} mono />
                <Field label="Dock" value={result.appointment?.dock_code ?? "—"} mono />
                <Field label="Status" value={result.truck?.status ?? "—"} mono />
                <Field label="Type" value={result.appointment?.type ?? "—"} />
              </dl>
            </section>

            <section className="border-2 border-ink bg-background p-5">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Driver name
                </span>
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  maxLength={120}
                  placeholder="Enter your full name"
                  className="mt-2 w-full border-2 border-ink bg-paper px-3 py-3 font-mono text-sm uppercase tracking-widest placeholder:text-muted-foreground/60 focus:bg-background focus:outline-none"
                />
              </label>
              {error && (
                <div className="mt-3 space-y-2">
                  <div className="border-2 border-hazard bg-hazard/20 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink">
                    ● Rejected: {error}
                  </div>
                  <button
                    onClick={handleRetry}
                    className="flex w-full items-center justify-between border-2 border-ink bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink transition hover:bg-ink hover:text-background"
                  >
                    <span>● Rescan check-out QR</span>
                    <span>↻</span>
                  </button>
                </div>
              )}
              <button
                onClick={handleCheckOut}
                disabled={submitting || result.truck?.status !== "checked_in"}
                className="mt-4 flex w-full items-center justify-between border-2 border-ink bg-hazard px-4 py-4 font-mono text-xs uppercase tracking-widest text-ink transition hover:bg-ink hover:text-hazard disabled:opacity-50"
              >
                <span>
                  {submitting
                    ? "● Checking out…"
                    : result.truck?.status === "checked_in"
                      ? "Check out & depart"
                      : "Not eligible to check out"}
                </span>
                <span>↳</span>
              </button>
            </section>

            <GateLogPanel gateLog={gateLog} ocrReads={ocrReads} truckPlate={result.truck?.plate ?? null} />

            <p className="px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              By checking out you confirm the truck has left the yard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function humanReason(reason?: string): string {
  switch (reason) {
    case "token_not_found":
      return "QR code not recognised";
    case "token_expired":
      return "QR code has expired";
    case "token_already_used":
      return "QR code already used";
    case "no_truck_linked":
      return "No truck linked to this QR";
    case "wrong_purpose":
      return "This QR is for check-in, not check-out";
    case "truck_not_checked_in":
      return "Truck is not checked in — cannot check out";
    case "truck_already_departed":
      return "Truck has already departed the yard";
    case "truck_not_found":
      return "Truck record not found";
    default:
      return reason ?? "Unable to check out";
  }
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

function GateLogPanel({
  gateLog,
  ocrReads,
  truckPlate,
}: {
  gateLog: GateLogEntry | null;
  ocrReads: OcrSummary[];
  truckPlate: string | null;
}) {
  if (!gateLog && ocrReads.length === 0) {
    return (
      <section className="border-2 border-dashed border-ink/40 bg-background p-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          ● Last gate log
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No gate activity recorded for this truck yet.
        </p>
      </section>
    );
  }

  const plateRead = ocrReads.find((r) => r.read_type === "plate");
  const trailerRead = ocrReads.find((r) => r.read_type === "trailer");

  return (
    <section className="border-2 border-ink bg-background">
      <div className="flex items-center justify-between border-b-2 border-ink px-5 py-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          ● Last gate log
        </div>
        {truckPlate && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {truckPlate}
          </div>
        )}
      </div>
      {gateLog && (
        <div className="border-b-2 border-ink/10 px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-display text-xl tracking-tight">
              {humanEvent(gateLog.event_type)}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {formatTimestamp(gateLog.created_at)}
            </div>
          </div>
          {gateLog.notes && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {gateLog.notes}
            </p>
          )}
          {gateLog.ocr_confidence !== null && (
            <div className="mt-3 inline-block border border-ink bg-paper px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
              OCR confidence · {(gateLog.ocr_confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
      {(plateRead || trailerRead) && (
        <div className="grid grid-cols-2 gap-px bg-ink/10">
          <OcrCell label="Plate OCR" read={plateRead} />
          <OcrCell label="Trailer OCR" read={trailerRead} />
        </div>
      )}
    </section>
  );
}

function OcrCell({ label, read }: { label: string; read: OcrSummary | undefined }) {
  if (!read) {
    return (
      <div className="bg-background p-3">
        <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 font-mono text-sm text-muted-foreground">—</div>
      </div>
    );
  }
  const pct = (read.confidence * 100).toFixed(0);
  const tone =
    read.status === "auto_approved"
      ? "bg-ink text-background"
      : read.status === "rejected"
        ? "bg-hazard text-ink"
        : "bg-paper text-ink border border-ink";
  return (
    <div className="bg-background p-3">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm">{read.normalized_value}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${tone}`}>
          ● {read.status.replace("_", " ")}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {pct}%
        </span>
      </div>
    </div>
  );
}

function humanEvent(eventType: string): string {
  switch (eventType) {
    case "ocr_scan":
      return "OCR scan";
    case "manual_approve":
      return "Manual approve";
    case "manual_override":
      return "Manual override";
    case "reject":
      return "Rejected";
    case "depart":
      return "Departed";
    default:
      return eventType.replace("_", " ");
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
