import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getAIOps } from "@/server/ai.functions";

export const Route = createFileRoute("/dashboard/aiops")({
  head: () => ({ meta: [{ title: "AI Ops — YardMaster" }] }),
  component: AIOpsPage,
});

type ETA = {
  truck_id: string;
  carrier: string;
  plate: string;
  appointment_at: string | null;
  eta_minutes: number;
  confidence: number;
  status: "on_time" | "late" | "early" | "unknown";
  reasons: string[];
};
type Respot = {
  from_slot_id: string;
  from_code: string;
  to_slot_id: string;
  to_code: string;
  reason: string;
  score: number;
  move_cost: number;
};
type Alert = {
  zone: string;
  severity: "info" | "warn" | "critical";
  occupancy_pct: number;
  appointments_next_60m: number;
  trucks_in_yard: number;
  message: string;
};
type AIOps = {
  generated_at: string;
  briefing: string;
  briefing_source: "llm" | "fallback";
  etas: ETA[];
  respots: Respot[];
  congestion: Alert[];
  metrics: {
    active_trucks: number;
    yard_occupancy_pct: number;
    open_docks: number;
    upcoming_appointments_60m: number;
  };
};

type EtaFilter = "all" | "late" | "on_time" | "early";

function AIOpsPage() {
  const [data, setData] = useState<AIOps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveOn, setLiveOn] = useState(true);
  const [intervalSec, setIntervalSec] = useState<15 | 30 | 60>(60);
  const [applying, setApplying] = useState<string | null>(null);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [etaFilter, setEtaFilter] = useState<EtaFilter>("all");
  const [respotSearch, setRespotSearch] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAIOps = useServerFn(getAIOps);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated. Please sign in.");
      const json = await fetchAIOps({ data: { token } });
      setData(json as AIOps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI Ops");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (liveOn) timerRef.current = setInterval(() => load(false), intervalSec * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [liveOn, intervalSec, load]);

  const applyRespot = async (r: Respot) => {
    setApplying(r.from_slot_id);
    try {
      // Move trailer pointer between yard slots
      const { data: src } = await supabase
        .from("yard_slots")
        .select("trailer_id")
        .eq("id", r.from_slot_id)
        .maybeSingle();
      const trailerId = src?.trailer_id ?? null;

      const { error: e1 } = await supabase
        .from("yard_slots")
        .update({ trailer_id: null, status: "empty" })
        .eq("id", r.from_slot_id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("yard_slots")
        .update({ trailer_id: trailerId, status: "occupied" })
        .eq("id", r.to_slot_id);
      if (e2) throw e2;
      await supabase.from("trailer_moves").insert({
        action: "relocate",
        trailer_id: trailerId,
        from_slot_id: r.from_slot_id,
        to_slot_id: r.to_slot_id,
        notes: `AI re-spot: ${r.reason}`,
      });
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    } finally {
      setApplying(null);
    }
  };

  const ackAlert = (zone: string) => setAcked((s) => new Set(s).add(zone));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
            ▌ Module 07
          </div>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">AI OPS</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Predictive ETA · smart re-spotting · congestion alerts
            {data && <> · updated {new Date(data.generated_at).toLocaleTimeString()}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border-2 border-ink">
            <button
              onClick={() => setLiveOn((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition ${
                liveOn ? "bg-hazard text-hazard-foreground" : "hover:bg-paper"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  liveOn ? "animate-pulse bg-current" : "bg-muted-foreground"
                }`}
              />
              {liveOn ? "Live" : "Paused"}
            </button>
            <select
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value) as 15 | 30 | 60)}
              className="border-l-2 border-ink bg-background px-2 py-2 font-mono text-[10px] uppercase tracking-widest outline-none"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
            <button
              onClick={() => load(false)}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-2 border-hazard bg-hazard/10 p-3 font-mono text-xs text-hazard">
          ⚠ {error}
        </div>
      )}

      {/* Briefing */}
      <section className="border-2 border-ink bg-ink text-background">
        <div className="flex items-center justify-between border-b-2 border-background/20 px-4 py-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Shift briefing</h2>
          <span className="font-mono text-[10px] opacity-70">
            {data?.briefing_source === "llm" ? "AI-generated" : "Heuristic fallback"}
          </span>
        </div>
        <p className="p-4 font-mono text-sm leading-relaxed">
          {loading && !data ? "● Analyzing operations…" : data?.briefing || "—"}
        </p>
      </section>

      {/* Metrics strip */}
      {data && data.metrics && (
        <div className="grid grid-cols-2 gap-px bg-ink lg:grid-cols-6">
          <Mini label="Active trucks" value={data.metrics.active_trucks} unit="in yard" />
          <Mini label="Yard occupancy" value={data.metrics.yard_occupancy_pct} unit="%" />
          <Mini label="Open docks" value={data.metrics.open_docks} unit="bays" />
          <Mini label="Appts next 60m" value={data.metrics.upcoming_appointments_60m} unit="appts" />
          <Mini
            label="Late ETAs"
            value={data.etas.filter((e) => e.status === "late").length}
            unit="trucks"
            accent
          />
          <Mini
            label="Re-spots"
            value={data.respots.length}
            unit="suggested"
          />
        </div>
      )}

      {/* Severity summary */}
      {data && data.congestion.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-ink">
          {(["critical", "warn", "info"] as const).map((sev) => {
            const count = data.congestion.filter((c) => c.severity === sev).length;
            const cls =
              sev === "critical"
                ? "bg-hazard text-hazard-foreground"
                : sev === "warn"
                  ? "bg-paper"
                  : "bg-background";
            return (
              <div key={sev} className={`p-3 ${cls}`}>
                <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                  {sev}
                </div>
                <div className="font-display text-2xl tracking-tight">{count}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                  zones
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Congestion alerts */}
      <section className="border-2 border-ink bg-background">
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Congestion alerts</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {data?.congestion.length ?? 0} active
          </span>
        </div>
        <div className="divide-y-2 divide-ink">
          {data && data.congestion.length === 0 && !loading && (
            <div className="p-6 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              All zones nominal
            </div>
          )}
          {data?.congestion.map((c) => {
            const ackd = acked.has(c.zone);
            const sevColor =
              c.severity === "critical"
                ? "bg-hazard text-hazard-foreground"
                : c.severity === "warn"
                  ? "bg-paper"
                  : "bg-background";
            return (
              <div
                key={c.zone}
                className={`flex items-center justify-between gap-4 p-4 ${sevColor} ${
                  ackd ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest">
                    {c.severity === "critical" ? "■■■" : c.severity === "warn" ? "■■□" : "■□□"}
                  </span>
                  <div>
                    <div className="font-display text-xl tracking-tight">ZONE {c.zone}</div>
                    <div className="font-mono text-xs">{c.message}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right font-mono text-[10px] uppercase tracking-widest opacity-70">
                    occ {c.occupancy_pct}% · in60m {c.appointments_next_60m}
                  </div>
                  <button
                    onClick={() => ackAlert(c.zone)}
                    disabled={ackd}
                    className="border-2 border-current px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest disabled:opacity-50"
                  >
                    {ackd ? "Acked" : "Ack"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Predictive ETAs */}
        <section className="border-2 border-ink bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Predictive ETAs</h2>
            <div className="flex border-2 border-ink">
              {(["all", "late", "on_time", "early"] as EtaFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setEtaFilter(f)}
                  className={`px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${
                    etaFilter === f ? "bg-ink text-background" : "hover:bg-paper"
                  }`}
                >
                  {f.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[480px] overflow-auto">
            {data && data.etas.length === 0 && !loading && (
              <div className="p-6 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                No inbound trucks
              </div>
            )}
            <table className="w-full font-mono text-xs">
              <thead className="sticky top-0 bg-ink text-background">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest">Truck</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest">ETA</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-widest">Conf</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest">Why</th>
                </tr>
              </thead>
              <tbody>
                {data?.etas
                  .filter((e) => etaFilter === "all" || e.status === etaFilter)
                  .map((e) => {
                  const sign = e.eta_minutes >= 0 ? "+" : "";
                  const color =
                    e.status === "late"
                      ? "text-hazard"
                      : e.status === "early"
                        ? "text-muted-foreground"
                        : "";
                  return (
                    <tr key={e.truck_id} className="border-t border-ink/20 hover:bg-paper">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{e.carrier}</div>
                        <div className="text-[10px] text-muted-foreground">{e.plate}</div>
                      </td>
                      <td className={`px-3 py-2 text-right ${color}`}>
                        {sign}
                        {e.eta_minutes}m
                        <div className="text-[10px] uppercase opacity-70">{e.status}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{Math.round(e.confidence * 100)}%</td>
                      <td className="px-3 py-2 text-[10px] text-muted-foreground">
                        {e.reasons.join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Re-spotting */}
        <section className="border-2 border-ink bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Smart re-spotting</h2>
            <input
              value={respotSearch}
              onChange={(e) => setRespotSearch(e.target.value)}
              placeholder="Filter slot…"
              className="border-2 border-ink bg-background px-2 py-1 font-mono text-[10px] outline-none"
            />
          </div>
          <div className="max-h-[480px] divide-y-2 divide-ink overflow-auto">
            {data && data.respots.length === 0 && !loading && (
              <div className="p-6 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                No re-spots needed
              </div>
            )}
            {data?.respots
              .filter((r) => {
                const q = respotSearch.trim().toLowerCase();
                if (!q) return true;
                return (
                  r.from_code.toLowerCase().includes(q) ||
                  r.to_code.toLowerCase().includes(q)
                );
              })
              .map((r) => (
                <div key={r.from_slot_id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-mono text-sm">
                      <span className="font-semibold">{r.from_code}</span>
                      <span className="mx-2 text-hazard">→</span>
                      <span className="font-semibold">{r.to_code}</span>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {r.reason}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      score {r.score} · cost {r.move_cost}
                    </div>
                  </div>
                  <button
                    onClick={() => applyRespot(r)}
                    disabled={applying === r.from_slot_id}
                    className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-hazard-foreground disabled:opacity-50"
                  >
                    {applying === r.from_slot_id ? "Moving…" : "Apply"}
                  </button>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 p-4 ${accent && value > 0 ? "bg-hazard text-hazard-foreground" : "bg-background"}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-3xl tracking-tight">{value.toLocaleString()}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">{unit}</div>
      </div>
    </div>
  );
}
