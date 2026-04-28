import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/weighbridge")({
  head: () => ({ meta: [{ title: "Weighbridge — YardMaster" }] }),
  component: WeighbridgePage,
});

const LEGAL_MAX_KG = 40000;
const DEVIATION_PCT = 5;

type Direction = "inbound" | "outbound";

interface Reading {
  id: string;
  truck_id: string;
  direction: Direction;
  gross_kg: number;
  tare_kg: number | null;
  net_kg: number | null;
  expected_kg: number | null;
  deviation_pct: number | null;
  overweight: boolean;
  flagged: boolean;
  flag_reason: string | null;
  override_reason: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface TruckLite {
  id: string;
  plate: string;
  carrier: string;
  trailer_number: string | null;
  expected_weight_kg: number | null;
  status: string;
}

interface AuditEntry {
  id: string;
  reading_id: string;
  actor_id: string | null;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

function WeighbridgePage() {
  const { user, roles } = useAuth();
  const canAct = roles.includes("admin") || roles.includes("operator");

  const [trucks, setTrucks] = useState<TruckLite[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [filter, setFilter] = useState<"all" | "flagged" | "overweight" | "today">("today");
  const [auditOpen, setAuditOpen] = useState<Reading | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditActors, setAuditActors] = useState<Record<string, string>>({});

  // form state
  const [truckId, setTruckId] = useState("");
  const [direction, setDirection] = useState<Direction>("inbound");
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [tQ, rQ] = await Promise.all([
        supabase
          .from("trucks")
          .select("id, plate, carrier, trailer_number, expected_weight_kg, status")
          .neq("status", "departed")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("weighbridge_readings")
          .select(
            "id, truck_id, direction, gross_kg, tare_kg, net_kg, expected_kg, deviation_pct, overweight, flagged, flag_reason, override_reason, reviewed_at, notes, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      setTrucks((tQ.data ?? []) as TruckLite[]);
      setReadings((rQ.data ?? []) as Reading[]);
    };
    void load();
    const ch = supabase
      .channel("weigh-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weighbridge_readings" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  const truckById = useMemo(() => {
    const m = new Map<string, TruckLite>();
    trucks.forEach((t) => m.set(t.id, t));
    return m;
  }, [trucks]);

  const visible = useMemo(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    return readings.filter((r) => {
      if (filter === "flagged") return r.flagged && !r.reviewed_at;
      if (filter === "overweight") return r.overweight;
      if (filter === "today") return new Date(r.created_at) >= startToday;
      return true;
    });
  }, [readings, filter]);

  const counts = useMemo(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const today = readings.filter((r) => new Date(r.created_at) >= startToday);
    return {
      total: readings.length,
      today: today.length,
      flagged: readings.filter((r) => r.flagged && !r.reviewed_at).length,
      overweight: readings.filter((r) => r.overweight).length,
    };
  }, [readings]);

  const submit = async () => {
    if (!truckId) {
      toast.error("Select a truck");
      return;
    }
    const grossN = Number(gross);
    if (!Number.isFinite(grossN) || grossN <= 0) {
      toast.error("Enter a valid gross weight");
      return;
    }
    const tareN = tare.trim() ? Number(tare) : null;
    if (tareN !== null && (!Number.isFinite(tareN) || tareN < 0)) {
      toast.error("Invalid tare");
      return;
    }
    const truck = truckById.get(truckId);
    const expected = truck?.expected_weight_kg ?? null;
    const net = tareN !== null ? grossN - tareN : null;
    const deviation =
      expected && expected > 0 ? Math.round(((grossN - expected) / expected) * 1000) / 10 : null;
    const overweight = grossN > LEGAL_MAX_KG;
    const flagDeviation = deviation !== null && Math.abs(deviation) > DEVIATION_PCT;
    const flagged = overweight || flagDeviation;
    const flag_reason = overweight
      ? `Over legal max (${grossN} kg)`
      : flagDeviation
        ? `Deviation ${deviation}% from expected ${expected} kg`
        : null;

    setSubmitting(true);
    const { error } = await supabase.from("weighbridge_readings").insert({
      truck_id: truckId,
      direction,
      gross_kg: grossN,
      tare_kg: tareN,
      net_kg: net,
      expected_kg: expected,
      deviation_pct: deviation,
      overweight,
      flagged,
      flag_reason,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(flagged ? `Recorded · ${flag_reason}` : "Reading recorded");
    setGross("");
    setTare("");
    setNotes("");
  };

  const overrideFlag = async (r: Reading) => {
    if (!canAct) return;
    const reason = window.prompt("Override reason (required):");
    if (!reason || !reason.trim()) return;
    const { error } = await supabase
      .from("weighbridge_readings")
      .update({
        flagged: false,
        override_reason: reason.trim(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
      })
      .eq("id", r.id);
    if (error) toast.error(error.message);
    else toast.success("Override recorded");
  };

  const openAudit = async (r: Reading) => {
    setAuditOpen(r);
    const { data } = await supabase
      .from("weighbridge_audit")
      .select("id, reading_id, actor_id, action, before_state, after_state, reason, created_at")
      .eq("reading_id", r.id)
      .order("created_at", { ascending: true });
    const entries = (data ?? []) as AuditEntry[];
    setAuditEntries(entries);
    const actorIds = Array.from(
      new Set(entries.map((e) => e.actor_id).filter((x): x is string => !!x)),
    );
    if (actorIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      const m: Record<string, string> = {};
      (profs ?? []).forEach((p) => {
        m[p.id] = p.full_name || p.id.slice(0, 8);
      });
      setAuditActors(m);
    } else {
      setAuditActors({});
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">Module 07</div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">Weighbridge</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Capture inbound / outbound axle weights. Flags overweight ({">"}
            {LEGAL_MAX_KG.toLocaleString()} kg) and deviations beyond ±{DEVIATION_PCT}% of expected.
          </p>
        </div>
        <dl className="grid grid-cols-4 gap-px bg-ink">
          <Stat k={counts.total} v="Total" />
          <Stat k={counts.today} v="Today" />
          <Stat k={counts.flagged} v="Open flags" tone={counts.flagged > 0 ? "hazard" : undefined} />
          <Stat k={counts.overweight} v="Overweight" tone={counts.overweight > 0 ? "hazard" : undefined} />
        </dl>
      </div>

      {canAct && (
        <div className="border-2 border-ink p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            New reading
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
            <select
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
              className="border-2 border-ink bg-background px-2 py-2 text-sm"
            >
              <option value="">Select truck…</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.plate} · {t.carrier}
                  {t.trailer_number ? ` · ${t.trailer_number}` : ""}
                </option>
              ))}
            </select>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              className="border-2 border-ink bg-background px-2 py-2 text-sm"
            >
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Gross kg"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              className="border-2 border-ink bg-background px-2 py-2 text-sm"
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="Tare kg (opt)"
              value={tare}
              onChange={(e) => setTare(e.target.value)}
              className="border-2 border-ink bg-background px-2 py-2 text-sm"
            />
            <input
              placeholder="Notes (opt)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border-2 border-ink bg-background px-2 py-2 text-sm"
            />
            <button
              disabled={submitting || !truckId || !gross}
              onClick={() => void submit()}
              className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Record"}
            </button>
          </div>
          {truckId && truckById.get(truckId)?.expected_weight_kg && (
            <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Expected: {truckById.get(truckId)?.expected_weight_kg?.toLocaleString()} kg
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["today", "flagged", "overweight", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
              filter === f ? "bg-ink text-background" : "hover:bg-paper"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-paper">
            <tr className="text-left">
              <Th>Time</Th>
              <Th>Truck</Th>
              <Th>Dir</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">Tare</Th>
              <Th className="text-right">Net</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Δ%</Th>
              <Th>Status</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-6 text-center text-sm text-muted-foreground">
                  No readings match this filter.
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const t = truckById.get(r.truck_id);
                return (
                  <tr key={r.id} className="border-t-2 border-ink align-top">
                    <td className="p-3 font-mono text-xs">
                      {new Date(r.created_at).toLocaleString([], {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3">
                      {t ? (
                        <>
                          <div className="font-medium">{t.plate}</div>
                          <div className="text-xs text-muted-foreground">{t.carrier}</div>
                        </>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs uppercase">{r.direction}</td>
                    <td className="p-3 text-right font-mono">{r.gross_kg.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">
                      {r.tare_kg != null ? r.tare_kg.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {r.net_kg != null ? r.net_kg.toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {r.expected_kg != null ? r.expected_kg.toLocaleString() : "—"}
                    </td>
                    <td
                      className={`p-3 text-right font-mono ${
                        r.deviation_pct != null && Math.abs(r.deviation_pct) > DEVIATION_PCT
                          ? "text-hazard"
                          : ""
                      }`}
                    >
                      {r.deviation_pct != null ? `${r.deviation_pct > 0 ? "+" : ""}${r.deviation_pct}%` : "—"}
                    </td>
                    <td className="p-3">
                      {r.overweight && (
                        <span className="mr-1 inline-block bg-hazard px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ink">
                          Overweight
                        </span>
                      )}
                      {r.flagged && (
                        <span className="mr-1 inline-block border-2 border-hazard px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ink">
                          Flagged
                        </span>
                      )}
                      {r.reviewed_at && (
                        <span className="inline-block bg-green-600 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-background">
                          Reviewed
                        </span>
                      )}
                      {r.flag_reason && (
                        <div className="mt-1 text-xs text-muted-foreground">{r.flag_reason}</div>
                      )}
                      {r.override_reason && (
                        <div className="mt-1 text-xs italic text-muted-foreground">
                          override: {r.override_reason}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.flagged && !r.reviewed_at && canAct && (
                          <button
                            onClick={() => void overrideFlag(r)}
                            className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
                          >
                            Override
                          </button>
                        )}
                        <button
                          onClick={() => void openAudit(r)}
                          className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
                        >
                          Audit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {auditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-ink/40 sm:items-center sm:justify-center"
          onClick={() => setAuditOpen(null)}
        >
          <div
            className="max-h-[85vh] w-full overflow-y-auto border-2 border-ink bg-background p-5 sm:max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b-2 border-ink pb-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                  Audit trail
                </div>
                <div className="font-display text-xl">
                  Reading · {auditOpen.gross_kg.toLocaleString()} kg ·{" "}
                  <span className="uppercase">{auditOpen.direction}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  Captured {new Date(auditOpen.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => setAuditOpen(null)}
                className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
              >
                Close
              </button>
            </div>
            <ol className="mt-4 space-y-3">
              {auditEntries.length === 0 ? (
                <li className="font-mono text-xs text-muted-foreground">
                  No audit entries — no changes since capture.
                </li>
              ) : (
                auditEntries.map((e) => (
                  <li key={e.id} className="border-l-4 border-ink pl-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                          e.action === "approved"
                            ? "bg-green-600 text-background"
                            : e.action === "overridden"
                              ? "bg-blue-500 text-background"
                              : e.action === "flagged"
                                ? "bg-hazard text-ink"
                                : "bg-paper"
                        }`}
                      >
                        {e.action}
                      </span>
                      <span className="font-mono text-xs">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        by {e.actor_id ? auditActors[e.actor_id] ?? e.actor_id.slice(0, 8) : "system"}
                      </span>
                    </div>
                    {e.reason && <div className="mt-1 text-sm italic">{e.reason}</div>}
                    {(e.before_state || e.after_state) && (
                      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[10px]">
                        <div>
                          <div className="uppercase tracking-widest text-muted-foreground">Before</div>
                          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.before_state ?? {}, null, 0)}</pre>
                        </div>
                        <div>
                          <div className="uppercase tracking-widest text-muted-foreground">After</div>
                          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.after_state ?? {}, null, 0)}</pre>
                        </div>
                      </div>
                    )}
                  </li>
                ))
              )}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, tone }: { k: number | string; v: string; tone?: "hazard" }) {
  return (
    <div className={`p-3 ${tone === "hazard" ? "bg-hazard text-ink" : "bg-background"}`}>
      <div className="font-display text-2xl tracking-tight">{k}</div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {v}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`p-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}
