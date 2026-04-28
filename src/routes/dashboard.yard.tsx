import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { notifyQueuePromotion } from "@/server/notifications.functions";
import { emailQueuePromotion } from "@/server/email.functions";

type Slot = Database["public"]["Tables"]["yard_slots"]["Row"];
type Truck = Database["public"]["Tables"]["trucks"]["Row"];
type Move = Database["public"]["Tables"]["trailer_moves"]["Row"];
type QueueRow = Database["public"]["Tables"]["parking_queue"]["Row"];
type CarrierCategory = Database["public"]["Enums"]["carrier_category"];

export const Route = createFileRoute("/dashboard/yard")({
  head: () => ({ meta: [{ title: "Yard Map — YardMaster" }] }),
  component: YardMap,
});

const STATUS_STYLES: Record<Slot["status"], string> = {
  empty: "bg-background border-ink/40 text-ink/60",
  occupied: "bg-ink text-background border-ink",
  reserved: "bg-hazard/20 border-hazard text-ink",
  out_of_service: "bg-destructive/10 border-destructive text-destructive line-through",
};

const TYPE_LABEL: Record<Slot["slot_type"], string> = {
  dock: "DOCK",
  parking: "PARK",
  staging: "STAGE",
  repair: "REPAIR",
};

const CATEGORY_STYLE: Record<CarrierCategory, string> = {
  standard: "bg-ink/10 text-ink",
  refrigerated: "bg-blue-500/15 text-blue-700",
  hazmat: "bg-destructive/15 text-destructive",
  oversize: "bg-amber-500/15 text-amber-700",
  express: "bg-hazard/20 text-ink",
  container: "bg-emerald-500/15 text-emerald-700",
};
const CATEGORY_SHORT: Record<CarrierCategory, string> = {
  standard: "STD",
  refrigerated: "RFR",
  hazmat: "HAZ",
  oversize: "OVR",
  express: "EXP",
  container: "CTN",
};
const ALL_CATEGORIES: CarrierCategory[] = ["standard", "refrigerated", "hazmat", "oversize", "express", "container"];

type EtaStat = { meanMin: number; sdMin: number; n: number };
type EtaInfo = { etaMin: number; lowMin: number; highMin: number; n: number; kind: "depart" | "assign" };

function YardMap() {
  const { user, roles } = useAuth();
  const canEdit = roles.includes("admin") || roles.includes("operator");
  const sendSmsFn = useServerFn(notifyQueuePromotion);
  const sendEmailFn = useServerFn(emailQueuePromotion);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [draggingTrailer, setDraggingTrailer] = useState<string | null>(null);
  const [highlightCategory, setHighlightCategory] = useState<CarrierCategory | null>(null);
  const [smartCategory, setSmartCategory] = useState<CarrierCategory>("standard");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"map" | "smart" | "queue">("map");
  const [etaByCategory, setEtaByCategory] = useState<Record<string, EtaStat>>({});
  const [assignByCategory, setAssignByCategory] = useState<Record<string, EtaStat>>({});

  async function refreshQueue() {
    const { data } = await supabase
      .from("parking_queue")
      .select("*")
      .eq("status", "waiting")
      .order("position", { ascending: true });
    setQueue(data ?? []);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data: s }, { data: t }, { data: m }, { data: q }] = await Promise.all([
        supabase.from("yard_slots").select("*").order("zone").order("row_label").order("slot_number"),
        supabase.from("trucks").select("*").in("status", ["checked_in", "pending"]),
        supabase.from("trailer_moves").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("parking_queue").select("*").eq("status", "waiting").order("position", { ascending: true }),
      ]);
      if (!mounted) return;
      setSlots(s ?? []);
      setTrucks(t ?? []);
      setMoves(m ?? []);
      setQueue(q ?? []);
      setLoading(false);
    })();

    const ch = supabase
      .channel("yard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "yard_slots" }, (p) => {
        setSlots((prev) => {
          if (p.eventType === "INSERT") return [...prev, p.new as Slot];
          if (p.eventType === "DELETE") return prev.filter((x) => x.id !== (p.old as Slot).id);
          return prev.map((x) => (x.id === (p.new as Slot).id ? (p.new as Slot) : x));
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trailer_moves" }, (p) => {
        setMoves((prev) => [p.new as Move, ...prev].slice(0, 20));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, async () => {
        const { data } = await supabase
          .from("trucks").select("*").in("status", ["checked_in", "pending"]);
        setTrucks(data ?? []);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_queue" }, () => {
        void refreshQueue();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  // Predictive ETA model: derive avg dwell (check-in→depart) and avg wait-to-assign
  // per carrier_category from last 14 days of trucks + trailer_moves.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const sinceISO = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
      const [{ data: histTrucks }, { data: histMoves }] = await Promise.all([
        supabase
          .from("trucks")
          .select("id, carrier_category, checked_in_at, departed_at, created_at")
          .gte("created_at", sinceISO)
          .not("checked_in_at", "is", null)
          .not("departed_at", "is", null)
          .limit(5000),
        supabase
          .from("trailer_moves")
          .select("trailer_id, action, created_at")
          .eq("action", "assign")
          .gte("created_at", sinceISO)
          .limit(5000),
      ]);
      if (!mounted) return;

      // Dwell (depart) stats by category
      const dwellBuckets: Record<string, number[]> = {};
      (histTrucks ?? []).forEach((t) => {
        if (!t.checked_in_at || !t.departed_at) return;
        const m = (new Date(t.departed_at).getTime() - new Date(t.checked_in_at).getTime()) / 60000;
        if (m > 0 && m < 24 * 60) {
          (dwellBuckets[t.carrier_category] ??= []).push(m);
        }
      });

      // Time from check-in to first assign (proxy for dock-assignment ETA)
      const assignBuckets: Record<string, number[]> = {};
      const truckMap = new Map((histTrucks ?? []).map((t) => [t.id, t]));
      (histMoves ?? []).forEach((m) => {
        const tr = m.trailer_id ? truckMap.get(m.trailer_id) : null;
        if (!tr || !tr.checked_in_at) return;
        const mins = (new Date(m.created_at).getTime() - new Date(tr.checked_in_at).getTime()) / 60000;
        if (mins > 0 && mins < 6 * 60) {
          (assignBuckets[tr.carrier_category] ??= []).push(mins);
        }
      });

      const stat = (arr: number[]): EtaStat => {
        const n = arr.length;
        if (n === 0) return { meanMin: 0, sdMin: 0, n: 0 };
        const mean = arr.reduce((a, b) => a + b, 0) / n;
        const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n, 1);
        return { meanMin: mean, sdMin: Math.sqrt(variance), n };
      };
      const dwellStats: Record<string, EtaStat> = {};
      const assignStats: Record<string, EtaStat> = {};
      Object.entries(dwellBuckets).forEach(([k, v]) => (dwellStats[k] = stat(v)));
      Object.entries(assignBuckets).forEach(([k, v]) => (assignStats[k] = stat(v)));
      setEtaByCategory(dwellStats);
      setAssignByCategory(assignStats);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const computeEta = useCallback(
    (truck: Truck | undefined | null): EtaInfo | null => {
      if (!truck) return null;
      const cat = truck.carrier_category;
      // Departure ETA for checked_in trucks
      if (truck.status === "checked_in" && truck.checked_in_at) {
        const stats = etaByCategory[cat];
        if (!stats || stats.n === 0) return null;
        const elapsed = (Date.now() - new Date(truck.checked_in_at).getTime()) / 60000;
        const remaining = Math.max(2, stats.meanMin - elapsed);
        const sd = Math.max(stats.sdMin, 5);
        return {
          etaMin: remaining,
          lowMin: Math.max(1, remaining - sd),
          highMin: remaining + sd,
          n: stats.n,
          kind: "depart",
        };
      }
      // Assign ETA for pending trucks
      if (truck.status === "pending") {
        const stats = assignByCategory[cat];
        if (!stats || stats.n === 0) return null;
        const ref = truck.checked_in_at ?? truck.appointment_at ?? truck.created_at;
        const elapsed = ref ? (Date.now() - new Date(ref).getTime()) / 60000 : 0;
        const remaining = Math.max(1, stats.meanMin - elapsed);
        const sd = Math.max(stats.sdMin, 5);
        return {
          etaMin: remaining,
          lowMin: Math.max(1, remaining - sd),
          highMin: remaining + sd,
          n: stats.n,
          kind: "assign",
        };
      }
      return null;
    },
    [etaByCategory, assignByCategory],
  );

  const YARD_ZONES = ["A", "B", "C"] as const;
  const ZONE_COLS = 4;
  const ZONE_ROWS = 3;

  const zones = useMemo(() => {
    const map = new Map<string, Slot[]>();
    slots.forEach((s) => {
      if (!map.has(s.zone)) map.set(s.zone, []);
      map.get(s.zone)!.push(s);
    });
    // Sort each zone's slots sequentially by their slot number
    map.forEach((zSlots) => zSlots.sort((a, b) => a.slot_number - b.slot_number));
    
    // Only keep zones A, B, C and limit to 12 slots per zone
    return YARD_ZONES.map((z) => [z, (map.get(z) ?? []).slice(0, ZONE_COLS * ZONE_ROWS)] as [string, Slot[]]);
  }, [slots]);

  const counts = useMemo(() => {
    const total = slots.length;
    const occ = slots.filter((s) => s.status === "occupied").length;
    const res = slots.filter((s) => s.status === "reserved").length;
    const oos = slots.filter((s) => s.status === "out_of_service").length;
    const parking = slots.filter((s) => s.slot_type === "parking").length;
    const parkingFree = slots.filter((s) => s.slot_type === "parking" && s.status === "empty").length;
    return { total, occ, res, oos, free: total - occ - res - oos, parking, parkingFree };
  }, [slots]);

  const trucksOnYard = useMemo(() => {
    const assignedIds = new Set(slots.map((s) => s.trailer_id).filter(Boolean));
    return trucks.filter((t) => !assignedIds.has(t.id));
  }, [trucks, slots]);

  const truckById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);

  // Smart suggestions for current `smartCategory`
  const smartSuggestions = useMemo(() => {
    return slots
      .filter((s) => s.status === "empty" && s.slot_type !== "repair")
      .map((s) => {
        const match = (s.carrier_categories ?? []).includes(smartCategory);
        const typeWeight = s.slot_type === "parking" ? 10 : s.slot_type === "staging" ? 6 : s.slot_type === "dock" ? 4 : 0;
        const score = (match ? 40 : 0) + 50 + typeWeight;
        return { slot: s, match, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [slots, smartCategory]);

  async function logMove(action: Database["public"]["Enums"]["move_action"], trailerId: string | null, fromSlot: string | null, toSlot: string | null, notes?: string) {
    await supabase.from("trailer_moves").insert({
      trailer_id: trailerId, from_slot_id: fromSlot, to_slot_id: toSlot, action, actor_id: user?.id ?? null, notes: notes ?? null,
    });
  }

  async function assignTrailer(slot: Slot, trailerId: string) {
    if (!canEdit) return toast.error("Operator role required");
    const prevSlot = slots.find((s) => s.trailer_id === trailerId);
    if (prevSlot && prevSlot.id !== slot.id) {
      await supabase.from("yard_slots").update({ trailer_id: null, status: "empty" }).eq("id", prevSlot.id);
    }
    const { error } = await supabase.from("yard_slots")
      .update({ trailer_id: trailerId, status: "occupied" }).eq("id", slot.id);
    if (error) return toast.error(error.message);
    await logMove(prevSlot ? "relocate" : "assign", trailerId, prevSlot?.id ?? null, slot.id);
    // Mark queue entry assigned (if any)
    await supabase.from("parking_queue")
      .update({ status: "assigned", assigned_slot_id: slot.id, assigned_at: new Date().toISOString() })
      .eq("truck_id", trailerId).eq("status", "waiting");
    toast.success(`Trailer assigned to ${slot.code}`);
    setSelected({ ...slot, trailer_id: trailerId, status: "occupied" });
  }

  async function releaseSlot(slot: Slot) {
    if (!canEdit) return toast.error("Operator role required");
    const { error } = await supabase.from("yard_slots")
      .update({ trailer_id: null, status: "empty" }).eq("id", slot.id);
    if (error) return toast.error(error.message);
    await logMove("release", slot.trailer_id, slot.id, null);
    toast.success(`${slot.code} released`);
    setSelected({ ...slot, trailer_id: null, status: "empty" });
    // Try promoting next from queue
    const { data: prom } = await supabase.rpc("promote_parking_queue", { _actor: user?.id });
    const promRes = prom as { ok?: boolean; slot_id?: string; slot_code?: string } | null;
    if (promRes?.ok && promRes.slot_id && promRes.slot_code) {
      toast.success(`Promoted next waiting truck → ${promRes.slot_code}`);
      void sendPromotionSms(promRes.slot_id, promRes.slot_code);
    }
  }

  async function sendPromotionSms(slotId: string, slotCode: string) {
    const { data: slot } = await supabase
      .from("yard_slots").select("trailer_id").eq("id", slotId).maybeSingle();
    const truckId = slot?.trailer_id;
    if (!truckId) {
      console.warn("Cannot send SMS: No trailer_id found for slot", slotId);
      return;
    }

    console.log("Attempting SMS for truck:", truckId);

    // Get current session for auth
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    // SMS notification
    try {
      const res = await sendSmsFn({ 
        data: { truck_id: truckId, slot_code: slotCode },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (res.ok) toast.success(`SMS sent to driver`);
      else if (res.skipped && res.reason === "no_driver_phone") toast.info("No driver phone on file — SMS skipped");
      else if (res.skipped) toast.warning(`SMS skipped: ${res.reason}`);
      else toast.error(`SMS failed: ${res.reason}`);
    } catch (e) {
      toast.error(`SMS error: ${(e as Error).message}`);
    }

    // Email notification
    try {
      const emailRes = await sendEmailFn({ 
        data: { truck_id: truckId, slot_code: slotCode },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (emailRes.ok) toast.success("Email notification queued");
      else if (!emailRes.skipped) toast.message(`Email: ${emailRes.error ?? "unknown"}`);
    } catch (e) {
      toast.message(`Email error: ${(e as Error).message}`);
    }
  }

  async function setStatus(slot: Slot, status: Slot["status"]) {
    if (!canEdit) return toast.error("Operator role required");
    const { error } = await supabase.from("yard_slots").update({ status }).eq("id", slot.id);
    if (error) return toast.error(error.message);
    if (status === "reserved") await logMove("reserve", slot.trailer_id, slot.id, slot.id);
    if (status === "out_of_service") await logMove("out_of_service", null, slot.id, slot.id);
    setSelected({ ...slot, status });
  }

  async function smartAssignTruck(truckId: string) {
    if (!canEdit) return toast.error("Operator role required");
    const { data, error } = await supabase.rpc("auto_assign_yard_slot", { _truck_id: truckId, _actor: user?.id });
    if (error) return toast.error(error.message);
    const res = data as { ok?: boolean; reason?: string; slot_code?: string; slot_id?: string; queue_id?: string; category_match?: boolean };
    if (res?.ok) {
      toast.success(`Assigned to ${res.slot_code}${res.category_match ? " · category match" : " · fallback"}`);
      if (res.slot_id && res.slot_code) void sendPromotionSms(res.slot_id, res.slot_code);
    } else if (res?.reason === "queued") {
      toast.warning("No matching slot — added to parking queue");
      void refreshQueue();
    } else if (res?.reason === "truck_already_assigned") {
      toast.info("Truck is already on a slot");
    } else {
      toast.error(`Could not assign: ${res?.reason ?? "unknown"}`);
    }
  }

  async function removeFromQueue(qid: string) {
    if (!canEdit) return toast.error("Operator role required");
    const { error } = await supabase.from("parking_queue")
      .update({ status: "cancelled" }).eq("id", qid);
    if (error) return toast.error(error.message);
    toast.success("Removed from queue");
  }

  async function promoteQueue() {
    if (!canEdit) return toast.error("Operator role required");
    const { data, error } = await supabase.rpc("promote_parking_queue", { _actor: user?.id });
    if (error) return toast.error(error.message);
    const res = data as { ok?: boolean; reason?: string; slot_code?: string; slot_id?: string };
    if (res?.ok && res.slot_id && res.slot_code) {
      toast.success(`Promoted → ${res.slot_code}`);
      void sendPromotionSms(res.slot_id, res.slot_code);
    }
    else if (res?.reason === "queue_empty") toast.info("Queue is empty");
    else if (res?.reason === "queued") toast.warning("Still no slot available");
    else toast.error(res?.reason ?? "Could not promote");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-hazard">Module 02</div>
          <h1 className="font-display text-4xl tracking-tight">Yard Map</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live slot positions · drag to assign · smart-assign by carrier · parking queue.</p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest">
          <Stat label="Slots" value={counts.total} />
          <Stat label="Free" value={counts.free} tone="ok" />
          <Stat label="Occupied" value={counts.occ} tone="ink" />
          <Stat label="Park free" value={counts.parkingFree} tone="ok" />
          <Stat label="Queue" value={queue.length} tone={queue.length > 0 ? "warn" : "ok"} />
          <Stat label="OOS" value={counts.oos} tone="bad" />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="rounded-none border-2 border-ink bg-background p-0 h-auto">
          <TabsTrigger value="map" className="rounded-none border-r-2 border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-widest data-[state=active]:bg-ink data-[state=active]:text-background">Live map</TabsTrigger>
          <TabsTrigger value="smart" className="rounded-none border-r-2 border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-widest data-[state=active]:bg-ink data-[state=active]:text-background">Smart assign</TabsTrigger>
          <TabsTrigger value="queue" className="rounded-none px-4 py-2 font-mono text-[11px] uppercase tracking-widest data-[state=active]:bg-ink data-[state=active]:text-background">
            Parking queue {queue.length > 0 && <span className="ml-2 bg-hazard text-ink px-1.5 py-0.5 text-[9px]">{queue.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* MAP TAB */}
        <TabsContent value="map" className="mt-4">
          {/* Category legend / highlight filter */}
          <div className="mb-4 flex flex-wrap items-center gap-2 border-2 border-ink bg-paper px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Highlight best slots for:</span>
            <button
              onClick={() => setHighlightCategory(null)}
              className={`border border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${highlightCategory === null ? "bg-ink text-background" : "bg-background"}`}
            >All</button>
            {ALL_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setHighlightCategory(c === highlightCategory ? null : c)}
                className={`border border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${highlightCategory === c ? "bg-ink text-background" : CATEGORY_STYLE[c]}`}
              >{c}</button>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Left column — zones stacked vertically */}
            <div className="space-y-4">
            {loading ? (
              <div className="border-2 border-ink p-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">● Loading yard…</div>
            ) : (
              zones.map(([zone, zSlots]) => {
                // Build a 4×3 array of slots (fill empties if DB has fewer)
                const grid: (Slot | null)[][] = Array.from({ length: ZONE_ROWS }, () => Array(ZONE_COLS).fill(null));
                zSlots.forEach((s, i) => {
                  const r = Math.floor(i / ZONE_COLS);
                  const c = i % ZONE_COLS;
                  if (r < ZONE_ROWS && c < ZONE_COLS) grid[r][c] = s;
                });
                return (
                  <section key={zone} className="border-2 border-ink bg-background">
                    <header className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2 text-background">
                      <h2 className="font-display text-xl tracking-tight">ZONE {zone}</h2>
                      <span className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                        {zSlots.filter((s) => s.status === "occupied").length}/{zSlots.length} occupied
                      </span>
                    </header>
                    <div className="grid grid-cols-4 gap-3 p-3">
                      {grid.flat().map((slot, idx) => {
                        if (!slot) {
                          // Placeholder for missing DB slot
                          return (
                            <div
                              key={`${zone}-empty-${idx}`}
                              className="flex h-16 items-center justify-center border border-dashed border-ink/20 bg-background font-mono text-xs uppercase tracking-widest text-muted-foreground/40"
                            >
                              {zone}{Math.floor(idx / ZONE_COLS + 1)}-{(idx % ZONE_COLS) + 1}
                            </div>
                          );
                        }
                        const trailer = slot.trailer_id ? truckById.get(slot.trailer_id) : null;
                        const isSel = selected?.id === slot.id;
                        const cats = slot.carrier_categories ?? [];
                        const isBestFor = highlightCategory && cats.includes(highlightCategory) && slot.status === "empty";
                        const eta = trailer ? computeEta(trailer) : null;
                        return (
                          <button
                            key={slot.id}
                            onClick={() => setSelected(slot)}
                            onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const tid = draggingTrailer || e.dataTransfer.getData("text/trailer-id");
                              if (tid) assignTrailer(slot, tid);
                              setDraggingTrailer(null);
                            }}
                            className={`group relative flex h-16 flex-col border-2 p-2 text-left transition hover:scale-[1.02] ${STATUS_STYLES[slot.status]} ${isSel ? "ring-2 ring-hazard ring-offset-2 ring-offset-background" : ""} ${isBestFor ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-background" : ""}`}
                          >
                            <div className="flex items-start justify-between">
                              <span className="font-display text-base leading-none">{slot.code}</span>
                              <span className="font-mono text-[8px] uppercase tracking-widest opacity-70">{TYPE_LABEL[slot.slot_type]}</span>
                            </div>
                            {trailer && (
                              <div className="mt-1 font-mono text-[10px] leading-tight">
                                <div className="truncate font-bold">{trailer.plate}</div>
                                <div className="truncate opacity-60 text-[9px]">{trailer.carrier}</div>
                                {eta && (
                                  <div
                                    className="mt-0.5 inline-block bg-hazard/90 px-1 py-0 text-[8px] uppercase tracking-widest text-ink"
                                    title={`Predicted ${eta.kind === "depart" ? "departure" : "dock assignment"} based on ${eta.n} similar trips`}
                                  >
                                    {eta.kind === "depart" ? "↗" : "⚙"} {fmtMin(eta.etaMin)}
                                  </div>
                                )}
                              </div>
                            )}
                            {!trailer && slot.status === "empty" && (
                              <div className="mt-1 font-mono text-[9px] uppercase tracking-widest opacity-40">empty</div>
                            )}
                            {/* Category chips */}
                            <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5">
                              {cats.slice(0, 3).map((c) => (
                                <span key={c} className={`px-1 py-0 font-mono text-[8px] uppercase tracking-widest ${CATEGORY_STYLE[c]}`}>{CATEGORY_SHORT[c]}</span>
                              ))}
                            </div>
                            {isBestFor && (
                              <span className="absolute -top-2 -right-2 bg-emerald-500 text-background px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest">★ Best</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
            </div>

            {/* Right sidebar */}
            <aside className="space-y-4">

              {/* Unassigned trailers */}
              <div className="border-2 border-ink bg-background">
                <header className="border-b-2 border-ink bg-paper px-4 py-2">
                  <h3 className="font-display text-sm uppercase tracking-widest">On-site, unassigned</h3>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{trucksOnYard.length} trailer{trucksOnYard.length === 1 ? "" : "s"} · drag or smart-assign</p>
                </header>
                <div className="max-h-64 overflow-auto p-2">
                  {trucksOnYard.length === 0 && (
                    <div className="p-4 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">— none —</div>
                  )}
                  {trucksOnYard.map((t) => (
                    <div
                      key={t.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        setDraggingTrailer(t.id);
                        e.dataTransfer.setData("text/trailer-id", t.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDraggingTrailer(null)}
                      className={`mb-1 cursor-grab border border-ink/30 bg-paper p-2 active:cursor-grabbing ${draggingTrailer === t.id ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold">{t.plate}</span>
                        <span className={`px-1 py-0 font-mono text-[9px] uppercase tracking-widest ${CATEGORY_STYLE[t.carrier_category as CarrierCategory]}`}>{CATEGORY_SHORT[t.carrier_category as CarrierCategory]}</span>
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">{t.carrier} · {t.trailer_number ?? "—"}</div>
                      {canEdit && (
                        <button
                          onClick={() => smartAssignTruck(t.id)}
                          className="mt-1 w-full border border-ink bg-ink py-1 font-mono text-[9px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
                        >⚡ Smart assign</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Selected slot */}
              <div className="border-2 border-ink bg-background">
                <header className="border-b-2 border-ink bg-paper px-4 py-2">
                  <h3 className="font-display text-sm uppercase tracking-widest">Slot detail</h3>
                </header>
                {!selected ? (
                  <p className="p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Select a slot</p>
                ) : (
                  <div className="space-y-3 p-4 font-mono text-xs">
                    <div className="flex items-baseline justify-between">
                      <span className="font-display text-2xl">{selected.code}</span>
                      <span className="text-[10px] uppercase tracking-widest text-hazard">{selected.status}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {selected.zone} · {selected.row_label} #{selected.slot_number} · {TYPE_LABEL[selected.slot_type]}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(selected.carrier_categories ?? []).map((c) => (
                        <span key={c} className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${CATEGORY_STYLE[c]}`}>{c}</span>
                      ))}
                    </div>
                    {selected.trailer_id && truckById.get(selected.trailer_id) && (
                      <>
                        <div className="border border-ink/30 bg-paper p-2">
                          <div className="font-bold">{truckById.get(selected.trailer_id)!.plate}</div>
                          <div className="text-[10px] text-muted-foreground">{truckById.get(selected.trailer_id)!.carrier}</div>
                        </div>
                        {(() => {
                          const t = truckById.get(selected.trailer_id!)!;
                          const eta = computeEta(t);
                          if (!eta) {
                            return (
                              <div className="border border-ink/30 bg-paper p-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                                Predicted ETA · insufficient history
                              </div>
                            );
                          }
                          const conf = eta.n >= 30 ? "high" : eta.n >= 10 ? "medium" : "low";
                          return (
                            <div className="border-2 border-hazard bg-hazard/10 p-2">
                              <div className="flex items-baseline justify-between">
                                <span className="font-mono text-[10px] uppercase tracking-widest">
                                  Predicted {eta.kind === "depart" ? "departure" : "dock assignment"}
                                </span>
                                <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                                  conf · {conf} · n={eta.n}
                                </span>
                              </div>
                              <div className="font-display mt-1 text-2xl">{fmtMin(eta.etaMin)}</div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                range {fmtMin(eta.lowMin)} – {fmtMin(eta.highMin)}
                              </div>
                            </div>
                          );
                        })()}
                        <TrailerTimeline trailerId={selected.trailer_id} slots={slots} />
                      </>
                    )}
                    {canEdit && (
                      <div className="grid grid-cols-2 gap-1.5 pt-2">
                        {selected.trailer_id && (
                          <button onClick={() => releaseSlot(selected)} className="col-span-2 border-2 border-ink bg-ink py-2 text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink">Release slot</button>
                        )}
                        <button onClick={() => setStatus(selected, "empty")} className="border border-ink py-1.5 text-[10px] uppercase tracking-widest hover:bg-paper">Empty</button>
                        <button onClick={() => setStatus(selected, "reserved")} className="border border-ink py-1.5 text-[10px] uppercase tracking-widest hover:bg-hazard/20">Reserve</button>
                        <button onClick={() => setStatus(selected, "out_of_service")} className="col-span-2 border border-destructive py-1.5 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/10">Mark out of service</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Recent moves */}
              <div className="border-2 border-ink bg-background">
                <header className="border-b-2 border-ink bg-paper px-4 py-2">
                  <h3 className="font-display text-sm uppercase tracking-widest">Recent moves</h3>
                </header>
                <ul className="max-h-56 divide-y divide-ink/10 overflow-auto">
                  {moves.length === 0 && (
                    <li className="p-4 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">— no activity —</li>
                  )}
                  {moves.map((m) => {
                    const t = m.trailer_id ? truckById.get(m.trailer_id) : null;
                    return (
                      <li key={m.id} className="px-3 py-2 font-mono text-[10px]">
                        <div className="flex justify-between">
                          <span className="font-bold uppercase tracking-widest text-hazard">{m.action}</span>
                          <span className="text-muted-foreground">{new Date(m.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-muted-foreground">{t?.plate ?? "—"}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          </div>
        </TabsContent>

        {/* SMART ASSIGN TAB */}
        <TabsContent value="smart" className="mt-4 space-y-4">
          <div className="border-2 border-ink bg-background p-4">
            <h3 className="font-display text-lg uppercase tracking-tight">Auto-assign by carrier category</h3>
            <p className="mt-1 text-sm text-muted-foreground">Pick a category to preview the best free slots, or smart-assign any unassigned trailer in one click. If no matching slot is available, the truck is added to the parking waiting queue.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Preview category:</span>
              {ALL_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setSmartCategory(c)}
                  className={`border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${smartCategory === c ? "bg-ink text-background" : CATEGORY_STYLE[c]}`}
                >{c}</button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="border-2 border-ink bg-background">
              <header className="border-b-2 border-ink bg-paper px-4 py-2">
                <h3 className="font-display text-sm uppercase tracking-widest">Best free slots · {smartCategory}</h3>
              </header>
              <ul className="divide-y divide-ink/10">
                {smartSuggestions.length === 0 && (
                  <li className="p-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">— no free slot —</li>
                )}
                {smartSuggestions.map((sg, i) => (
                  <li key={sg.slot.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-display text-lg">{sg.slot.code}</span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{sg.slot.zone} · {TYPE_LABEL[sg.slot.slot_type]}</span>
                        {i === 0 && sg.match && <span className="bg-emerald-500 text-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest">★ Best</span>}
                        {!sg.match && <span className="bg-amber-500/20 text-amber-700 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest">fallback</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(sg.slot.carrier_categories ?? []).map((c) => (
                          <span key={c} className={`px-1 py-0 font-mono text-[8px] uppercase tracking-widest ${CATEGORY_STYLE[c]}`}>{CATEGORY_SHORT[c]}</span>
                        ))}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">score {sg.score}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-2 border-ink bg-background">
              <header className="border-b-2 border-ink bg-paper px-4 py-2">
                <h3 className="font-display text-sm uppercase tracking-widest">Unassigned trailers</h3>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Click ⚡ to auto-assign best slot</p>
              </header>
              <ul className="divide-y divide-ink/10 max-h-[420px] overflow-auto">
                {trucksOnYard.length === 0 && (
                  <li className="p-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">— all trailers assigned —</li>
                )}
                {trucksOnYard.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{t.plate}</span>
                        <span className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${CATEGORY_STYLE[t.carrier_category as CarrierCategory]}`}>{t.carrier_category}</span>
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">{t.carrier} · {t.trailer_number ?? "—"}</div>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => smartAssignTruck(t.id)}
                        className="border-2 border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
                      >⚡ Smart assign</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </TabsContent>

        {/* PARKING QUEUE TAB */}
        <TabsContent value="queue" className="mt-4 space-y-4">
          <div className="border-2 border-ink bg-background p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg uppercase tracking-tight">Parking waiting queue</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Trucks added here when no matching yard slot is available. They are auto-promoted as soon as a slot frees up.
                <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Parking slots free: {counts.parkingFree} / {counts.parking}</span>
              </p>
            </div>
            {canEdit && (
              <button onClick={promoteQueue} className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink">
                ⏵ Promote next
              </button>
            )}
          </div>

          <div className="border-2 border-ink bg-background">
            <header className="grid grid-cols-[40px_1fr_120px_120px_140px_100px] border-b-2 border-ink bg-paper px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>#</span><span>Truck</span><span>Category</span><span>Reason</span><span>Enqueued</span><span></span>
            </header>
            {queue.length === 0 ? (
              <div className="p-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">— queue empty —</div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {queue.map((q) => {
                  const t = truckById.get(q.truck_id);
                  return (
                    <li key={q.id} className="grid grid-cols-[40px_1fr_120px_120px_140px_100px] items-center px-4 py-3 font-mono text-xs">
                      <span className="font-display text-lg">{q.position}</span>
                      <div>
                        <div className="font-bold">{t?.plate ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{t?.carrier ?? ""} · {t?.trailer_number ?? ""}</div>
                      </div>
                      <span className={`inline-block w-fit px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${CATEGORY_STYLE[q.carrier_category]}`}>{q.carrier_category}</span>
                      <span className="text-[10px] text-muted-foreground">{q.reason ?? "—"}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(q.enqueued_at).toLocaleTimeString()}</span>
                      {canEdit && (
                        <button
                          onClick={() => removeFromQueue(q.id)}
                          className="border border-destructive px-2 py-1 text-[9px] uppercase tracking-widest text-destructive hover:bg-destructive/10"
                        >Remove</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone = "ink" }: { label: string; value: number; tone?: "ink" | "ok" | "warn" | "bad" }) {
  const styles = {
    ink: "border-ink bg-ink text-background",
    ok: "border-ink bg-background text-ink",
    warn: "border-hazard bg-hazard/20 text-ink",
    bad: "border-destructive bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div className={`flex min-w-[72px] flex-col items-center gap-0.5 border-2 px-3 py-1.5 ${styles}`}>
      <span className="font-display text-2xl leading-none">{value}</span>
      <span className="text-[9px]">{label}</span>
    </div>
  );
}

function fmtMin(m: number): string {
  if (!isFinite(m) || m < 0) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm === 0 ? `${h}h` : `${h}h${mm}m`;
}

function TrailerTimeline({ trailerId, slots }: { trailerId: string; slots: Slot[] }) {
  const [history, setHistory] = useState<Move[]>([]);
  const [loading, setLoading] = useState(true);
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("trailer_moves")
        .select("*")
        .eq("trailer_id", trailerId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (mounted) {
        setHistory(data ?? []);
        setLoading(false);
      }
    })();

    const ch = supabase
      .channel(`trailer-moves-${trailerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trailer_moves", filter: `trailer_id=eq.${trailerId}` },
        (p) => setHistory((prev) => [p.new as Move, ...prev].slice(0, 50)),
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [trailerId]);

  const actionColor: Record<string, string> = {
    assign: "bg-emerald-500 text-background",
    relocate: "bg-hazard text-ink",
    release: "bg-ink text-background",
    reserve: "bg-amber-500 text-background",
    out_of_service: "bg-destructive text-background",
  };

  return (
    <div className="border border-ink/30 bg-background">
      <header className="flex items-center justify-between border-b border-ink/30 bg-paper px-2 py-1">
        <h4 className="font-mono text-[10px] uppercase tracking-widest">◢ Move history</h4>
        <span className="font-mono text-[9px] text-muted-foreground">{history.length} events</span>
      </header>
      {loading ? (
        <div className="p-3 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">● loading…</div>
      ) : history.length === 0 ? (
        <div className="p-3 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">— no moves —</div>
      ) : (
        <ol className="max-h-64 overflow-auto">
          {history.map((m, idx) => {
            const fromS = m.from_slot_id ? slotById.get(m.from_slot_id) : null;
            const toS = m.to_slot_id ? slotById.get(m.to_slot_id) : null;
            const isLast = idx === history.length - 1;
            return (
              <li key={m.id} className="relative flex gap-2 px-2 py-2">
                <div className="flex flex-col items-center pt-0.5">
                  <span className={`h-2 w-2 rounded-full ${actionColor[m.action] ?? "bg-muted-foreground"}`} />
                  {!isLast && <span className="mt-0.5 w-px flex-1 bg-ink/20" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${actionColor[m.action] ?? "bg-muted text-foreground"}`}>
                      {m.action.replace("_", " ")}
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px]">
                    {fromS ? <span className="text-muted-foreground">{fromS.zone}·{fromS.code}</span> : <span className="text-muted-foreground">—</span>}
                    <span className="mx-1 text-hazard">→</span>
                    {toS ? <span className="font-bold">{toS.zone}·{toS.code}</span> : <span className="text-muted-foreground">gate</span>}
                  </div>
                  {m.notes && <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{m.notes}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
