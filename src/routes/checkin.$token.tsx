import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/checkin/$token")({
  head: () => ({
    meta: [
      { title: "Driver Check-In — YardMaster" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckinPage,
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

function CheckinPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [driverName, setDriverName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("validate_qr_token", {
        _token: token,
      });
      if (rpcError) {
        setError(rpcError.message);
      } else {
        const r = data as unknown as ValidationResult;
        setResult(r);
        if (r.truck?.driver_name) setDriverName(r.truck.driver_name);
      }
      setLoading(false);
    })();
  }, [token]);

  async function handleCheckIn() {
    if (!driverName.trim()) {
      setError("Please enter the driver name");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("consume_qr_checkin", {
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
            ● YardMaster · Driver Check-In
          </div>
          <h1 className="font-display mt-2 text-3xl leading-[0.95] tracking-tighter">
            Self check-in
          </h1>
        </header>

        {loading && (
          <div className="border-2 border-ink bg-background p-8 text-center">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              ● Validating QR…
            </div>
          </div>
        )}

        {!loading && result && !result.valid && (
          <div className="border-2 border-hazard bg-background p-6">
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Check-in failed
            </div>
            <div className="mt-3 font-display text-2xl tracking-tight">
              {humanReason(result.reason)}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Please proceed to the gate office for manual processing.
            </p>
          </div>
        )}

        {!loading && result?.valid && success && (
          <div className="border-2 border-ink bg-ink p-6 text-background">
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Checked in
            </div>
            <div className="mt-3 font-display text-3xl leading-tight tracking-tighter">
              Welcome, {driverName.split(" ")[0]}.
            </div>
            <p className="mt-3 text-sm text-background/70">
              Proceed to dock{" "}
              <span className="font-mono text-background">
                {result.appointment?.dock_code ?? "—"}
              </span>
              . Wait for an operator to direct you.
            </p>
          </div>
        )}

        {!loading && result?.valid && !success && (
          <div className="space-y-4">
            <section className="border-2 border-ink bg-background">
              <div className="border-b-2 border-ink px-5 py-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Appointment
                </div>
                <div className="mt-1 font-display text-2xl tracking-tight">
                  {result.appointment?.dock_name ?? "Walk-in"}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-ink/10">
                <Field label="Plate" value={result.truck?.plate ?? "—"} mono />
                <Field label="Carrier" value={result.truck?.carrier ?? result.appointment?.carrier ?? "—"} />
                <Field label="Trailer" value={result.truck?.trailer_number ?? "—"} mono />
                <Field label="Dock" value={result.appointment?.dock_code ?? "—"} mono />
                <Field
                  label="Window"
                  value={
                    result.appointment
                      ? `${formatTime(result.appointment.starts_at)}–${formatTime(result.appointment.ends_at)}`
                      : "—"
                  }
                  mono
                />
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
                <div className="mt-3 border-2 border-hazard bg-hazard/20 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink">
                  {error}
                </div>
              )}
              <button
                onClick={handleCheckIn}
                disabled={submitting}
                className="mt-4 flex w-full items-center justify-between border-2 border-ink bg-ink px-4 py-4 font-mono text-xs uppercase tracking-widest text-background transition hover:bg-hazard hover:text-ink disabled:opacity-50"
              >
                <span>{submitting ? "● Checking in…" : "Check in"}</span>
                <span className="text-hazard">↳</span>
              </button>
            </section>

            <p className="px-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              By checking in you confirm the truck details above are correct.
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
      return "This QR is for check-out, not check-in";
    case "truck_already_checked_in":
      return "Truck is already checked in";
    case "truck_already_departed":
      return "Truck has already departed — cannot re-enter with this QR";
    case "truck_not_found":
      return "Truck record not found";
    default:
      return reason ?? "Unable to check in";
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
