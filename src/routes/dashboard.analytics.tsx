import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/dashboard/analytics")({
  head: () => ({ meta: [{ title: "Analytics — YardMaster" }] }),
  component: AnalyticsPage,
});

type Truck = {
  id: string;
  carrier: string;
  plate: string;
  status: string;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
};
type GateEvent = {
  id: string;
  event_type: string;
  created_at: string;
  truck_id: string;
};
type DockAppt = {
  id: string;
  dock_id: string;
  carrier: string;
  reference: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
};
type Dock = { id: string; code: string; status: string; zone: string };
type YardSlot = {
  id: string;
  zone: string;
  code: string;
  status: string;
  trailer_id: string | null;
};
type TrailerMove = {
  id: string;
  trailer_id: string | null;
  to_slot_id: string | null;
  from_slot_id: string | null;
  action: string;
  created_at: string;
};
type Weigh = {
  id: string;
  truck_id: string;
  overweight: boolean;
  flagged: boolean;
  created_at: string;
};
type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type RangeKey = "24h" | "7d" | "30d";
const RANGE_HOURS: Record<RangeKey, number> = { "24h": 24, "7d": 168, "30d": 720 };

// Operating window assumed for dock utilization (06:00–22:00 = 16h/day)
const DOCK_OPEN_HOURS_PER_DAY = 16;

type DrillKey =
  | "checkIns"
  | "checkOuts"
  | "avgDwell"
  | "dockUtil"
  | "tasksTotal"
  | "tasksCompleted"
  | "sla"
  | "activeTrucks"
  | { kind: "zone"; zone: string }
  | null;

function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [gateEvents, setGateEvents] = useState<GateEvent[]>([]);
  const [appts, setAppts] = useState<DockAppt[]>([]);
  const [docks, setDocks] = useState<Dock[]>([]);
  const [slots, setSlots] = useState<YardSlot[]>([]);
  const [moves, setMoves] = useState<TrailerMove[]>([]);
  const [weighs, setWeighs] = useState<Weigh[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Live refresh
  const [liveOn, setLiveOn] = useState(false);
  const [intervalSec, setIntervalSec] = useState<10 | 30 | 60>(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drill-down
  const [drill, setDrill] = useState<DrillKey>(null);

  const sinceISO = useMemo(
    () => new Date(Date.now() - RANGE_HOURS[range] * 3600 * 1000).toISOString(),
    [range],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      const [t, ge, ap, dk, tk, sl, mv, wg] = await Promise.all([
        supabase
          .from("trucks")
          .select("id, carrier, plate, status, checked_in_at, created_at, updated_at")
          .gte("created_at", sinceISO)
          .limit(5000),
        supabase
          .from("gate_events")
          .select("id, event_type, created_at, truck_id")
          .gte("created_at", sinceISO)
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase
          .from("dock_appointments")
          .select("id, dock_id, carrier, reference, status, starts_at, ends_at")
          .gte("starts_at", sinceISO)
          .limit(5000),
        supabase.from("docks").select("id, code, zone, status").limit(200),
        supabase
          .from("tasks")
          .select("id, title, status, priority, due_at, completed_at, created_at")
          .gte("created_at", sinceISO)
          .limit(5000),
        supabase.from("yard_slots").select("id, zone, code, status, trailer_id").limit(2000),
        supabase
          .from("trailer_moves")
          .select("id, trailer_id, to_slot_id, from_slot_id, action, created_at")
          .gte("created_at", sinceISO)
          .limit(5000),
        supabase
          .from("weighbridge_readings")
          .select("id, truck_id, overweight, flagged, created_at")
          .gte("created_at", sinceISO)
          .limit(5000),
      ]);
      setTrucks((t.data ?? []) as Truck[]);
      setGateEvents((ge.data ?? []) as GateEvent[]);
      setAppts((ap.data ?? []) as DockAppt[]);
      setDocks((dk.data ?? []) as Dock[]);
      setTasks((tk.data ?? []) as Task[]);
      setSlots((sl.data ?? []) as YardSlot[]);
      setMoves((mv.data ?? []) as TrailerMove[]);
      setWeighs((wg.data ?? []) as Weigh[]);
      setLastRefresh(new Date());
      setLoading(false);
    },
    [sinceISO],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (liveOn) {
      timerRef.current = setInterval(() => load(false), intervalSec * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [liveOn, intervalSec, load]);

  // ========== KPIs (improved accuracy) ==========
  // Gate event types in this system: ocr_scan / manual_approve = check-in side; depart = check-out
  const isCheckIn = (t: string) => t === "check_in" || t === "manual_approve" || t === "ocr_scan";
  const isCheckOut = (t: string) => t === "check_out" || t === "depart";
  const checkInEvents = gateEvents.filter((e) => isCheckIn(e.event_type));
  const checkOutEvents = gateEvents.filter((e) => isCheckOut(e.event_type));
  const checkIns = checkInEvents.length;
  const checkOuts = checkOutEvents.length;

  // Accurate dwell: pair earliest check_in with latest check_out per truck (within window)
  const dwellPairs = useMemo(() => {
    const ins = new Map<string, number>();
    const outs = new Map<string, number>();
    for (const e of gateEvents) {
      const ts = new Date(e.created_at).getTime();
      if (isCheckIn(e.event_type)) {
        if (!ins.has(e.truck_id) || ts < (ins.get(e.truck_id) ?? Infinity))
          ins.set(e.truck_id, ts);
      } else if (isCheckOut(e.event_type)) {
        if (!outs.has(e.truck_id) || ts > (outs.get(e.truck_id) ?? -Infinity))
          outs.set(e.truck_id, ts);
      }
    }
    const truckById = new Map(trucks.map((tr) => [tr.id, tr]));
    const pairs: { truck_id: string; carrier: string; plate: string; minutes: number }[] = [];
    ins.forEach((inTs, truckId) => {
      const outTs = outs.get(truckId);
      if (outTs && outTs > inTs) {
        const tr = truckById.get(truckId);
        pairs.push({
          truck_id: truckId,
          carrier: tr?.carrier ?? "—",
          plate: tr?.plate ?? "—",
          minutes: Math.round((outTs - inTs) / 60000),
        });
      }
    });
    return pairs;
  }, [gateEvents, trucks]);

  const avgDwell = dwellPairs.length
    ? Math.round(dwellPairs.reduce((a, b) => a + b.minutes, 0) / dwellPairs.length)
    : 0;

  // Dock utilization: clip appointment time to window, ignore cancelled, divide by open hours
  const windowStartMs = Date.now() - RANGE_HOURS[range] * 3600 * 1000;
  const windowEndMs = Date.now();
  const usedDockMinutes = useMemo(() => {
    let total = 0;
    for (const a of appts) {
      if (a.status === "cancelled") continue;
      const s = Math.max(new Date(a.starts_at).getTime(), windowStartMs);
      const e = Math.min(new Date(a.ends_at).getTime(), windowEndMs);
      if (e > s) total += (e - s) / 60000;
    }
    return total;
  }, [appts, windowStartMs, windowEndMs]);

  const openDocks = docks.filter((d) => d.status !== "closed").length;
  const days = RANGE_HOURS[range] / 24;
  const totalDockMinutes = openDocks * DOCK_OPEN_HOURS_PER_DAY * 60 * days;
  const dockUtil =
    totalDockMinutes > 0
      ? Math.min(100, Math.round((usedDockMinutes / totalDockMinutes) * 100))
      : 0;

  // SLA: only tasks with due_at AND in terminal state (completed or overdue)
  const slaEligible = tasks.filter(
    (t) => t.due_at && (t.status === "completed" || new Date(t.due_at).getTime() < Date.now()),
  );
  const slaMet = slaEligible.filter(
    (t) => t.completed_at && new Date(t.completed_at) <= new Date(t.due_at!),
  ).length;
  const slaPct = slaEligible.length > 0 ? Math.round((slaMet / slaEligible.length) * 100) : 0;

  const activeTrucks = trucks.filter(
    (t) => t.status !== "departed" && t.status !== "completed",
  );
  const completedTasks = tasks.filter((t) => t.status === "completed");

  // ========== Throughput series (aligned to bucket boundaries) ==========
  const throughputData = useMemo(() => {
    const bucketHours = range === "24h" ? 1 : range === "7d" ? 6 : 24;
    const bucketMs = bucketHours * 3600 * 1000;
    const start = Math.floor(windowStartMs / bucketMs) * bucketMs;
    const buckets = Math.ceil((windowEndMs - start) / bucketMs);
    const arr = Array.from({ length: buckets }, (_, i) => ({
      t: new Date(start + i * bucketMs),
      in: 0,
      out: 0,
    }));
    for (const e of gateEvents) {
      const idx = Math.floor((new Date(e.created_at).getTime() - start) / bucketMs);
      if (idx >= 0 && idx < arr.length) {
        if (isCheckIn(e.event_type)) arr[idx].in += 1;
        else if (isCheckOut(e.event_type)) arr[idx].out += 1;
      }
    }
    return arr.map((b) => ({
      label:
        range === "24h"
          ? b.t.toLocaleTimeString([], { hour: "2-digit" })
          : b.t.toLocaleDateString([], { month: "numeric", day: "numeric" }),
      In: b.in,
      Out: b.out,
    }));
  }, [gateEvents, range, windowStartMs, windowEndMs]);

  // Per-dock util (filtered to A, B, C)
  const dockUtilData = useMemo(() => {
    const denom = DOCK_OPEN_HOURS_PER_DAY * 60 * days;
    const allowedZones = new Set(["A", "B", "C"]);
    return docks
      .filter((d) => allowedZones.has(d.zone))
      .map((d) => {
        const used = appts
          .filter((a) => a.dock_id === d.id && a.status !== "cancelled")
          .reduce((sum, a) => {
            const s = Math.max(new Date(a.starts_at).getTime(), windowStartMs);
            const e = Math.min(new Date(a.ends_at).getTime(), windowEndMs);
            return sum + Math.max(0, (e - s) / 60000);
          }, 0);
        return { dock: d.code.replace('-', ''), util: Math.min(100, Math.round((used / denom) * 100)) };
      });
  }, [docks, appts, days, windowStartMs, windowEndMs]);

  const taskBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [tasks]);

  // Carrier throughput
  const carrierData = useMemo(() => {
    const map = new Map<string, { in: number; out: number }>();
    const truckById = new Map(trucks.map((tr) => [tr.id, tr]));
    for (const e of gateEvents) {
      const tr = truckById.get(e.truck_id);
      if (!tr) continue;
      const row = map.get(tr.carrier) ?? { in: 0, out: 0 };
      if (isCheckIn(e.event_type)) row.in += 1;
      else if (isCheckOut(e.event_type)) row.out += 1;
      map.set(tr.carrier, row);
    }
    return Array.from(map.entries())
      .map(([carrier, v]) => ({ carrier, In: v.in, Out: v.out, total: v.in + v.out }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [gateEvents, trucks]);

  // Peak hour for check-ins
  const peakInsight = useMemo(() => {
    if (throughputData.length === 0) return null;
    const peak = throughputData.reduce(
      (best, b) => (b.In > best.In ? b : best),
      throughputData[0],
    );
    return peak.In > 0 ? peak : null;
  }, [throughputData]);

  // Dwell distribution buckets
  const dwellBuckets = useMemo(() => {
    const buckets = [
      { label: "<30m", min: 0, max: 30, count: 0 },
      { label: "30–60m", min: 30, max: 60, count: 0 },
      { label: "1–2h", min: 60, max: 120, count: 0 },
      { label: "2–4h", min: 120, max: 240, count: 0 },
      { label: "4h+", min: 240, max: Infinity, count: 0 },
    ];
    for (const d of dwellPairs) {
      const b = buckets.find((b) => d.minutes >= b.min && d.minutes < b.max);
      if (b) b.count += 1;
    }
    return buckets;
  }, [dwellPairs]);

  // ========== Zone congestion metrics ==========
  const zoneMetrics = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const truckById = new Map(trucks.map((t) => [t.id, t]));
    const zones = ["A", "B", "C"];

    return zones.map((zone) => {
      const zoneSlots = slots.filter((s) => s.zone === zone);
      const occupied = zoneSlots.filter((s) => s.status === "occupied").length;
      const total = 12; // Match the 4x3 grid layout of the Yard Map
      const occupancyPct = Math.round((occupied / total) * 100);

      // Trailers that touched this zone (from moves with to_slot in this zone)
      const trailerIds = new Set<string>();
      for (const m of moves) {
        const toSlot = m.to_slot_id ? slotById.get(m.to_slot_id) : null;
        if (toSlot?.zone === zone && m.trailer_id) trailerIds.add(m.trailer_id);
      }
      // Currently parked trailers
      for (const s of zoneSlots) {
        if (s.trailer_id) trailerIds.add(s.trailer_id);
      }

      // Throughput: gate events for those trailers
      let zoneIns = 0;
      let zoneOuts = 0;
      for (const e of gateEvents) {
        if (!trailerIds.has(e.truck_id)) continue;
        if (isCheckIn(e.event_type)) zoneIns += 1;
        else if (isCheckOut(e.event_type)) zoneOuts += 1;
      }

      // Dwell: subset of dwellPairs whose truck visited this zone
      const zoneDwell = dwellPairs.filter((d) => trailerIds.has(d.truck_id));
      const avgZoneDwell = zoneDwell.length
        ? Math.round(zoneDwell.reduce((a, b) => a + b.minutes, 0) / zoneDwell.length)
        : 0;

      // Incidents: weighbridge readings flagged/overweight for these trailers
      const incidents = weighs.filter(
        (w) => trailerIds.has(w.truck_id) && (w.overweight || w.flagged),
      ).length;

      return {
        zone,
        occupied,
        total,
        occupancyPct,
        ins: zoneIns,
        outs: zoneOuts,
        avgDwell: avgZoneDwell,
        incidents,
        trailerCount: trailerIds.size,
        carriersTop: topCarriers(trailerIds, truckById, 3),
      };
    });
  }, [slots, moves, gateEvents, dwellPairs, weighs, trucks]);


  const exportCSV = (filename: string, rows: Record<string, unknown>[]) => {
    if (rows.length === 0) {
      downloadCSV(filename, "no data\n");
      return;
    }
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\n");
    downloadCSV(filename, csv);
  };

  const exportSummary = () => {
    exportCSV(`yardmaster-summary-${range}-${stamp()}.csv`, [
      { metric: "Range", value: range },
      { metric: "Generated", value: new Date().toISOString() },
      { metric: "Gate check-ins", value: checkIns },
      { metric: "Gate check-outs", value: checkOuts },
      { metric: "Avg dwell (min)", value: avgDwell },
      { metric: "Dock utilization (%)", value: dockUtil },
      { metric: "Tasks created", value: tasks.length },
      { metric: "Tasks completed", value: completedTasks.length },
      { metric: "SLA met (%)", value: slaPct },
      { metric: "SLA eligible", value: slaEligible.length },
      { metric: "Active trucks", value: activeTrucks.length },
    ]);
  };

  const exportThroughput = () =>
    exportCSV(`yardmaster-throughput-${range}-${stamp()}.csv`, throughputData);
  const exportDockUtil = () =>
    exportCSV(`yardmaster-dock-util-${range}-${stamp()}.csv`, dockUtilData);
  const exportTasks = () =>
    exportCSV(
      `yardmaster-tasks-${range}-${stamp()}.csv`,
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        created_at: t.created_at,
        due_at: t.due_at ?? "",
        completed_at: t.completed_at ?? "",
      })),
    );

  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = margin;

    doc.setFillColor(10, 10, 10);
    doc.rect(0, 0, pageWidth, 70, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("YARDMASTER", margin, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Analytics report · ${range.toUpperCase()} · ${new Date().toLocaleString()}`, margin, 55);
    y = 95;

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Key metrics", margin, y);
    y += 10;
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value", "Unit"]],
      body: [
        ["Gate check-ins", String(checkIns), "trucks"],
        ["Gate check-outs", String(checkOuts), "trucks"],
        ["Avg dwell time", String(avgDwell), "min"],
        ["Dock utilization", String(dockUtil), "%"],
        ["Tasks created", String(tasks.length), "tasks"],
        ["Tasks completed", String(completedTasks.length), "tasks"],
        ["SLA met", String(slaPct), "%"],
        ["Active trucks", String(activeTrucks.length), "trucks"],
      ],
      theme: "grid",
      headStyles: { fillColor: [10, 10, 10], textColor: 255, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Insights", margin, y);
    y += 10;
    autoTable(doc, {
      startY: y,
      head: [["Insight", "Value"]],
      body: [
        ["Peak gate hour", peakInsight ? `${peakInsight.label} (${peakInsight.In} in / ${peakInsight.Out} out)` : "—"],
        ["Throughput balance", `${checkIns - checkOuts >= 0 ? "+" : ""}${checkIns - checkOuts} net trucks`],
        ["Top carrier", carrierData[0] ? `${carrierData[0].carrier} (${carrierData[0].total} events)` : "—"],
      ],
      theme: "striped",
      headStyles: { fillColor: [240, 130, 50], textColor: 0, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

    if (carrierData.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Top carriers", margin, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [["Carrier", "In", "Out", "Total"]],
        body: carrierData.map((c) => [c.carrier, String(c.In), String(c.Out), String(c.total)]),
        theme: "grid",
        headStyles: { fillColor: [10, 10, 10], textColor: 255, fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: margin, right: margin },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    }

    if (dockUtilData.length > 0) {
      if (y > 720) {
        doc.addPage();
        y = margin;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Dock utilization", margin, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [["Dock", "Utilization (%)"]],
        body: dockUtilData.map((d) => [d.dock, String(d.util)]),
        theme: "grid",
        headStyles: { fillColor: [10, 10, 10], textColor: 255, fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        margin: { left: margin, right: margin },
      });
    }

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `YardMaster Analytics · Page ${i} of ${pageCount}`,
        margin,
        doc.internal.pageSize.getHeight() - 20
      );
    }

    doc.save(`yardmaster-report-${range}-${stamp()}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
            ▌ Module 06
          </div>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">ANALYTICS</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Throughput · dwell · utilization · SLA
            {lastRefresh && (
              <> · updated {lastRefresh.toLocaleTimeString()}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Range */}
          <div className="flex border-2 border-ink">
            {(["24h", "7d", "30d"] as RangeKey[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-2 font-mono text-[10px] uppercase tracking-widest transition ${
                  range === r ? "bg-ink text-background" : "hover:bg-paper"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {/* Live */}
          <div className="flex border-2 border-ink">
            <button
              onClick={() => setLiveOn((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition ${
                liveOn ? "bg-hazard text-hazard-foreground" : "hover:bg-paper"
              }`}
              title="Toggle live refresh"
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
              onChange={(e) => setIntervalSec(Number(e.target.value) as 10 | 30 | 60)}
              className="border-l-2 border-ink bg-background px-2 py-2 font-mono text-[10px] uppercase tracking-widest outline-none"
              title="Refresh interval"
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
            <button
              onClick={() => load(false)}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
              title="Refresh now"
            >
              ↻
            </button>
          </div>
          {/* Export */}
          <div className="flex border-2 border-ink">
            <button
              onClick={exportPDF}
              className="bg-hazard px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink hover:bg-ink hover:text-background"
              title="Download branded PDF report"
            >
              ⇩ PDF Report
            </button>
            <button
              onClick={exportSummary}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
            >
              ↓ Summary CSV
            </button>
            <button
              onClick={exportThroughput}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
            >
              ↓ Throughput
            </button>
            <button
              onClick={exportDockUtil}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
            >
              ↓ Docks
            </button>
            <button
              onClick={exportTasks}
              className="border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
            >
              ↓ Tasks
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards (clickable) */}
      <div className="grid grid-cols-2 gap-px bg-ink lg:grid-cols-4">
        <KPI label="Gate check-ins" value={checkIns} unit="trucks" accent onClick={() => setDrill("checkIns")} />
        <KPI label="Gate check-outs" value={checkOuts} unit="trucks" onClick={() => setDrill("checkOuts")} />
        <KPI label="Avg dwell time" value={avgDwell} unit="min" onClick={() => setDrill("avgDwell")} />
        <KPI label="Dock utilization" value={dockUtil} unit="%" onClick={() => setDrill("dockUtil")} />
        <KPI label="Tasks created" value={tasks.length} unit="tasks" onClick={() => setDrill("tasksTotal")} />
        <KPI label="Tasks completed" value={completedTasks.length} unit="tasks" onClick={() => setDrill("tasksCompleted")} />
        <KPI label="SLA met" value={slaPct} unit="%" accent={slaPct >= 90} onClick={() => setDrill("sla")} />
        <KPI label="Active trucks" value={activeTrucks.length} unit="trucks" onClick={() => setDrill("activeTrucks")} />
      </div>

      {/* Throughput */}
      <section className="border-2 border-ink bg-background">
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Gate throughput</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            in vs out · bucketed
          </span>
        </div>
        <div className="h-72 p-4">
          {loading ? (
            <Loading />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={throughputData}>
                <CartesianGrid strokeDasharray="2 2" stroke="hsl(0 0% 85%)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "2px solid #0a0a0a",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                />
                <Line type="monotone" dataKey="In" stroke="oklch(0.70 0.20 45)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Out" stroke="oklch(0.10 0 0)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-2 border-ink bg-background">
          <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Dock utilization</h2>
            <span className="font-mono text-[10px] text-muted-foreground">% of open hours</span>
          </div>
          <div className="h-64 p-4">
            {loading ? (
              <Loading />
            ) : dockUtilData.length === 0 ? (
              <Empty>No docks configured</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dockUtilData}>
                  <CartesianGrid strokeDasharray="2 2" stroke="hsl(0 0% 85%)" />
                  <XAxis dataKey="dock" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="util" fill="oklch(0.10 0 0)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="border-2 border-ink bg-background">
          <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Task status</h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              SLA: {slaMet}/{slaEligible.length} met
            </span>
          </div>
          <div className="h-64 p-4">
            {loading ? (
              <Loading />
            ) : taskBreakdown.length === 0 ? (
              <Empty>No tasks in window</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={taskBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="2 2" stroke="hsl(0 0% 85%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
                  <YAxis dataKey="status" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} width={90} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="count" fill="oklch(0.70 0.20 45)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Carrier throughput */}
        <section className="border-2 border-ink bg-background">
          <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Top carriers</h2>
            <span className="font-mono text-[10px] text-muted-foreground">in / out events</span>
          </div>
          <div className="h-72 p-4">
            {loading ? (
              <Loading />
            ) : carrierData.length === 0 ? (
              <Empty>No carrier activity</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={carrierData} layout="vertical">
                  <CartesianGrid strokeDasharray="2 2" stroke="hsl(0 0% 85%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
                  <YAxis dataKey="carrier" type="category" tick={{ fontSize: 10, fontFamily: "monospace" }} width={110} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                    itemStyle={{ color: "#fff" }}
                  />
                  <Bar dataKey="In" stackId="a" fill="oklch(0.70 0.20 45)" />
                  <Bar dataKey="Out" stackId="a" fill="oklch(0.10 0 0)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Dwell distribution */}
        <section className="border-2 border-ink bg-background">
          <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Dwell distribution</h2>
            <span className="font-mono text-[10px] text-muted-foreground">{dwellPairs.length} trips</span>
          </div>
          <div className="h-72 p-4">
            {loading ? (
              <Loading />
            ) : dwellPairs.length === 0 ? (
              <Empty>No completed trips in window</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dwellBuckets}>
                  <CartesianGrid strokeDasharray="2 2" stroke="hsl(0 0% 85%)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="count" fill="oklch(0.10 0 0)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      {/* Zone congestion heatmap (clickable) */}
      <section className="border-2 border-ink bg-background">
        <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest">◢ Zone congestion heatmap</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            click a zone to drill down · occupancy · dwell · throughput · incidents
          </span>
        </div>
        {loading ? (
          <div className="h-40"><Loading /></div>
        ) : zoneMetrics.length === 0 ? (
          <div className="h-40"><Empty>No zones configured</Empty></div>
        ) : (
          <div className="grid gap-px bg-ink p-px sm:grid-cols-3">
            {zoneMetrics.map((z) => {
              const heat =
                z.occupancyPct >= 80
                  ? "bg-hazard text-hazard-foreground"
                  : z.occupancyPct >= 50
                  ? "bg-paper"
                  : "bg-background";
              return (
                <button
                  key={z.zone}
                  type="button"
                  onClick={() => setDrill({ kind: "zone", zone: z.zone })}
                  className={`group relative flex flex-col gap-3 p-4 text-left transition hover:opacity-90 ${heat}`}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="font-display text-3xl tracking-tight">ZONE {z.zone}</div>
                    <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                      {z.occupied}/{z.total} slots
                    </div>
                  </div>
                  <div className="h-2 w-full border border-current/30">
                    <div
                      className="h-full bg-current/70"
                      style={{ width: `${z.occupancyPct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-widest opacity-80">
                    <div>Occupancy <span className="font-display text-base normal-case opacity-100">{z.occupancyPct}%</span></div>
                    <div>Avg dwell <span className="font-display text-base normal-case opacity-100">{z.avgDwell}m</span></div>
                    <div>In/Out <span className="font-display text-base normal-case opacity-100">{z.ins}/{z.outs}</span></div>
                    <div>Incidents <span className={`font-display text-base normal-case opacity-100 ${z.incidents > 0 ? "text-hazard" : ""}`}>{z.incidents}</span></div>
                  </div>
                  {z.carriersTop.length > 0 && (
                    <div className="font-mono text-[10px] uppercase tracking-widest opacity-60">
                      Top: {z.carriersTop.join(" · ")}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Insights strip */}
      <section className="grid grid-cols-1 gap-px bg-ink md:grid-cols-3">
        <div className="bg-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Peak gate hour
          </div>
          <div className="font-display mt-1 text-2xl tracking-tight">
            {peakInsight ? peakInsight.label : "—"}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {peakInsight ? `${peakInsight.In} check-ins · ${peakInsight.Out} check-outs` : "No data"}
          </div>
        </div>
        <div className="bg-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Throughput balance
          </div>
          <div className="font-display mt-1 text-2xl tracking-tight">
            {checkIns - checkOuts >= 0 ? "+" : ""}
            {checkIns - checkOuts}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            net trucks in yard during window
          </div>
        </div>
        <div className="bg-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Top carrier
          </div>
          <div className="font-display mt-1 text-2xl tracking-tight">
            {carrierData[0]?.carrier ?? "—"}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {carrierData[0] ? `${carrierData[0].total} gate events` : "No data"}
          </div>
        </div>
      </section>

      {/* Drill-down dialog */}
      <DrillDialog
        drill={drill}
        onClose={() => setDrill(null)}
        gateEvents={gateEvents}
        trucks={trucks}
        appts={appts}
        docks={docks}
        tasks={tasks}
        dwellPairs={dwellPairs}
        slaEligible={slaEligible}
        activeTrucks={activeTrucks}
        completedTasks={completedTasks}
        zoneMetrics={zoneMetrics}
        slots={slots}
        moves={moves}
        weighs={weighs}
      />
    </div>
  );
}

function KPI({
  label,
  value,
  unit,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col justify-between gap-2 p-4 text-left transition hover:opacity-80 ${
        accent ? "bg-hazard text-hazard-foreground" : "bg-background"
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-4xl tracking-tight">{value.toLocaleString()}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">{unit}</div>
      </div>
    </button>
  );
}

function DrillDialog({
  drill,
  onClose,
  gateEvents,
  trucks,
  appts,
  docks,
  tasks,
  dwellPairs,
  slaEligible,
  activeTrucks,
  completedTasks,
  zoneMetrics,
  slots,
  moves,
  weighs,
}: {
  drill: DrillKey;
  onClose: () => void;
  gateEvents: GateEvent[];
  trucks: Truck[];
  appts: DockAppt[];
  docks: Dock[];
  tasks: Task[];
  dwellPairs: { truck_id: string; carrier: string; plate: string; minutes: number }[];
  slaEligible: Task[];
  activeTrucks: Truck[];
  completedTasks: Task[];
  zoneMetrics: {
    zone: string;
    occupied: number;
    total: number;
    occupancyPct: number;
    ins: number;
    outs: number;
    avgDwell: number;
    incidents: number;
    trailerCount: number;
    carriersTop: string[];
  }[];
  slots: YardSlot[];
  moves: TrailerMove[];
  weighs: Weigh[];
}) {
  const open = drill !== null;
  const truckById = new Map(trucks.map((t) => [t.id, t]));

  let title = "";
  let headers: string[] = [];
  let rows: (string | number)[][] = [];

  if (drill === "checkIns" || drill === "checkOuts") {
    title = drill === "checkIns" ? "Gate check-ins" : "Gate check-outs";
    headers = ["Time", "Carrier", "Plate"];
    const matchTypes =
      drill === "checkIns"
        ? new Set(["check_in", "manual_approve", "ocr_scan"])
        : new Set(["check_out", "depart"]);
    rows = gateEvents
      .filter((e) => matchTypes.has(e.event_type))
      .slice()
      .reverse()
      .map((e) => {
        const tr = truckById.get(e.truck_id);
        return [
          new Date(e.created_at).toLocaleString(),
          tr?.carrier ?? "—",
          tr?.plate ?? "—",
        ];
      });
  } else if (drill === "avgDwell") {
    title = "Dwell time per truck";
    headers = ["Carrier", "Plate", "Dwell (min)"];
    rows = dwellPairs
      .slice()
      .sort((a, b) => b.minutes - a.minutes)
      .map((d) => [d.carrier, d.plate, d.minutes]);
  } else if (drill === "dockUtil") {
    title = "Dock appointments";
    headers = ["Dock", "Carrier", "Reference", "Start", "End", "Status"];
    const dockById = new Map(docks.map((d) => [d.id, d]));
    rows = appts
      .slice()
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
      .map((a) => [
        dockById.get(a.dock_id)?.code ?? "—",
        a.carrier,
        a.reference ?? "",
        new Date(a.starts_at).toLocaleString(),
        new Date(a.ends_at).toLocaleString(),
        a.status,
      ]);
  } else if (drill === "tasksTotal") {
    title = "All tasks in range";
    headers = ["Title", "Status", "Priority", "Created"];
    rows = tasks.map((t) => [t.title, t.status, t.priority, new Date(t.created_at).toLocaleString()]);
  } else if (drill === "tasksCompleted") {
    title = "Completed tasks";
    headers = ["Title", "Priority", "Completed"];
    rows = completedTasks.map((t) => [
      t.title,
      t.priority,
      t.completed_at ? new Date(t.completed_at).toLocaleString() : "—",
    ]);
  } else if (drill === "sla") {
    title = "SLA-eligible tasks";
    headers = ["Title", "Due", "Completed", "Result"];
    rows = slaEligible.map((t) => {
      const met = t.completed_at && new Date(t.completed_at) <= new Date(t.due_at!);
      return [
        t.title,
        t.due_at ? new Date(t.due_at).toLocaleString() : "—",
        t.completed_at ? new Date(t.completed_at).toLocaleString() : "—",
        met ? "✓ Met" : "✗ Missed",
      ];
    });
  } else if (drill === "activeTrucks") {
    title = "Active trucks";
    headers = ["Carrier", "Plate", "Status", "Checked in"];
    rows = activeTrucks.map((t) => [
      t.carrier,
      t.plate,
      t.status,
      t.checked_in_at ? new Date(t.checked_in_at).toLocaleString() : "—",
    ]);
  } else if (drill && typeof drill === "object" && drill.kind === "zone") {
    const zone = drill.zone;
    const zm = zoneMetrics.find((z) => z.zone === zone);
    title = `Zone ${zone} · drilldown`;
    headers = ["Metric", "Value"];
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const trailerIds = new Set<string>();
    for (const m of moves) {
      const ts = m.to_slot_id ? slotById.get(m.to_slot_id) : null;
      if (ts?.zone === zone && m.trailer_id) trailerIds.add(m.trailer_id);
    }
    for (const s of slots) if (s.zone === zone && s.trailer_id) trailerIds.add(s.trailer_id);

    const incidentList = weighs.filter(
      (w) => trailerIds.has(w.truck_id) && (w.overweight || w.flagged),
    );

    rows = [
      ["Occupancy", `${zm?.occupied ?? 0}/${zm?.total ?? 0} (${zm?.occupancyPct ?? 0}%)`],
      ["Throughput in", String(zm?.ins ?? 0)],
      ["Throughput out", String(zm?.outs ?? 0)],
      ["Avg dwell (min)", String(zm?.avgDwell ?? 0)],
      ["Trailers touched", String(zm?.trailerCount ?? 0)],
      ["Incidents (overweight/flagged)", String(zm?.incidents ?? 0)],
      ["Top carriers", zm?.carriersTop.join(", ") || "—"],
      ["Moves into zone", String(moves.filter((m) => {
        const ts = m.to_slot_id ? slotById.get(m.to_slot_id) : null;
        return ts?.zone === zone;
      }).length)],
      ["Recent incidents", incidentList.slice(0, 5).map((w) => {
        const tr = trucks.find((t) => t.id === w.truck_id);
        return `${tr?.plate ?? "?"} @ ${new Date(w.created_at).toLocaleString()}`;
      }).join(" · ") || "None"],
    ];
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-mono text-xs uppercase tracking-widest">
            ◢ {title} <span className="text-muted-foreground">({rows.length})</span>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto border-2 border-ink">
          {rows.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              No records
            </div>
          ) : (
            <table className="w-full font-mono text-xs">
              <thead className="sticky top-0 bg-ink text-background">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-widest">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-ink/20 hover:bg-paper">
                    {r.map((c, j) => (
                      <td key={j} className="px-3 py-2">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function topCarriers(
  trailerIds: Set<string>,
  truckById: Map<string, { carrier: string }>,
  n: number,
): string[] {
  const counts = new Map<string, number>();
  trailerIds.forEach((id) => {
    const tr = truckById.get(id);
    if (!tr) return;
    counts.set(tr.carrier, (counts.get(tr.carrier) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
      ● Loading…
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}
