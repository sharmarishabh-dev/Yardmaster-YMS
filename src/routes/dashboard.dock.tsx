import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/dock")({
  head: () => ({ meta: [{ title: "Dock Scheduler — YardMaster" }] }),
  component: DockScheduler,
});

type CarrierCategory =
  | "standard"
  | "refrigerated"
  | "hazmat"
  | "oversize"
  | "express"
  | "container";

type Dock = {
  id: string;
  code: string;
  name: string;
  zone: string;
  status: "available" | "maintenance" | "closed";
  display_order: number;
  carrier_categories: CarrierCategory[];
};

type Appointment = {
  id: string;
  dock_id: string;
  truck_id: string | null;
  carrier: string;
  reference: string | null;
  appointment_type: "inbound" | "outbound" | "cross_dock";
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show";
  starts_at: string;
  ends_at: string;
  notes: string | null;
  carrier_category: CarrierCategory;
};

type DockSuggestion = {
  dock_id: string;
  code: string;
  name: string;
  zone: string;
  status: string;
  carrier_categories: CarrierCategory[];
  category_match: boolean;
  upcoming_count: number;
  conflict: boolean;
  score: number;
};

const CATEGORY_META: Record<CarrierCategory, { label: string; color: string }> = {
  standard: { label: "Standard", color: "bg-slate-200 text-slate-900" },
  refrigerated: { label: "Reefer", color: "bg-cyan-200 text-cyan-900" },
  hazmat: { label: "Hazmat", color: "bg-red-200 text-red-900" },
  oversize: { label: "Oversize", color: "bg-orange-200 text-orange-900" },
  express: { label: "Express", color: "bg-yellow-200 text-yellow-900" },
  container: { label: "Container", color: "bg-violet-200 text-violet-900" },
};

const HOUR_START = 6; // 06:00
const HOUR_END = 22; // 22:00
const SLOT_MIN = 30;
const ROW_PX = 28; // px per 30-min slot
const SLOTS = ((HOUR_END - HOUR_START) * 60) / SLOT_MIN;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function isoForSlot(day: Date, slotIndex: number) {
  const d = new Date(day);
  d.setHours(HOUR_START, 0, 0, 0);
  d.setMinutes(d.getMinutes() + slotIndex * SLOT_MIN);
  return d.toISOString();
}
function slotIndexFromIso(day: Date, iso: string) {
  const d = new Date(iso);
  const base = new Date(day);
  base.setHours(HOUR_START, 0, 0, 0);
  return Math.round((d.getTime() - base.getTime()) / (SLOT_MIN * 60 * 1000));
}
function overlap(a: Appointment, b: Appointment) {
  if (a.id === b.id || a.dock_id !== b.dock_id) return false;
  return new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
}

const typeColor: Record<Appointment["appointment_type"], string> = {
  inbound: "bg-emerald-500/90 text-white",
  outbound: "bg-blue-500/90 text-white",
  cross_dock: "bg-amber-500/90 text-black",
};
const statusBadge: Record<Appointment["status"], string> = {
  scheduled: "border-ink",
  in_progress: "border-hazard bg-hazard/20",
  completed: "border-muted-foreground opacity-60",
  cancelled: "border-destructive line-through opacity-60",
  no_show: "border-destructive bg-destructive/10",
};

function DockScheduler() {
  const { roles } = useAuth();
  const canEdit = roles.includes("operator") || roles.includes("admin");
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [docks, setDocks] = useState<Dock[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [showNew, setShowNew] = useState(false);
  const dragRef = useRef<{ id: string; offsetSlots: number } | null>(null);

  const dayEnd = useMemo(() => {
    const d = new Date(day);
    d.setDate(d.getDate() + 1);
    return d;
  }, [day]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [d, a] = await Promise.all([
        supabase.from("docks").select("*").order("display_order"),
        supabase
          .from("dock_appointments")
          .select("*")
          .gte("starts_at", day.toISOString())
          .lt("starts_at", dayEnd.toISOString())
          .order("starts_at"),
      ]);
      if (cancelled) return;
      if (d.error) toast.error(d.error.message);
      if (a.error) toast.error(a.error.message);
      setDocks((d.data ?? []) as Dock[]);
      setAppts((a.data ?? []) as Appointment[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [day, dayEnd]);

  useEffect(() => {
    const ch = supabase
      .channel("dock-appts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dock_appointments" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<Appointment> | undefined;
            if (!old?.id) return;
            setAppts((prev) => prev.filter((p) => p.id !== old.id));
            return;
          }
          const row = payload.new as Appointment | undefined;
          if (!row?.starts_at) return;
          const ts = new Date(row.starts_at);
          if (ts < day || ts >= dayEnd) {
            // Row moved out of current day window
            setAppts((prev) => prev.filter((p) => p.id !== row.id));
            return;
          }
          setAppts((prev) => {
            const without = prev.filter((p) => p.id !== row.id);
            return [...without, row].sort((x, y) =>
              x.starts_at.localeCompare(y.starts_at),
            );
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [day, dayEnd]);

  const conflicts = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < appts.length; i++) {
      for (let j = i + 1; j < appts.length; j++) {
        if (overlap(appts[i], appts[j])) {
          set.add(appts[i].id);
          set.add(appts[j].id);
        }
      }
    }
    return set;
  }, [appts]);

  async function moveAppointment(id: string, dockId: string, newSlotIndex: number) {
    const a = appts.find((x) => x.id === id);
    if (!a) return;
    const durationMin =
      (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000;
    const newStart = isoForSlot(day, Math.max(0, Math.min(SLOTS - 1, newSlotIndex)));
    const newEnd = new Date(new Date(newStart).getTime() + durationMin * 60000).toISOString();

    setAppts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, dock_id: dockId, starts_at: newStart, ends_at: newEnd } : p,
      ),
    );
    const { error } = await supabase
      .from("dock_appointments")
      .update({ dock_id: dockId, starts_at: newStart, ends_at: newEnd })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      const { data } = await supabase
        .from("dock_appointments")
        .select("*")
        .gte("starts_at", day.toISOString())
        .lt("starts_at", dayEnd.toISOString());
      setAppts((data ?? []) as Appointment[]);
    } else {
      toast.success("Appointment rescheduled");
    }
  }

  async function updateStatus(id: string, status: Appointment["status"]) {
    const { error } = await supabase.from("dock_appointments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(`Marked ${status.replace("_", " ")}`);
  }

  async function deleteAppt(id: string) {
    const { error } = await supabase.from("dock_appointments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Appointment removed");
      setSelected(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
            ◆ Module 03
          </div>
          <h1 className="font-display text-3xl tracking-tight">Dock Scheduler</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag appointments to reschedule. Conflicts are auto-detected and outlined in red.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(day);
              d.setDate(d.getDate() - 1);
              setDay(startOfDay(d));
            }}
            className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
          >
            ‹ Prev
          </button>
          <input
            type="date"
            value={day.toISOString().slice(0, 10)}
            onChange={(e) => setDay(startOfDay(new Date(e.target.value)))}
            className="border-2 border-ink bg-background px-3 py-2 font-mono text-xs"
          />
          <button
            onClick={() => {
              const d = new Date(day);
              d.setDate(d.getDate() + 1);
              setDay(startOfDay(d));
            }}
            className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
          >
            Next ›
          </button>
          <button
            onClick={() => setDay(startOfDay(new Date()))}
            className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
          >
            Today
          </button>
          {canEdit && (
            <button
              onClick={() => setShowNew(true)}
              className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
            >
              + New appointment
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-2 border-ink bg-background p-3 font-mono text-[10px] uppercase tracking-widest">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 bg-emerald-500" /> Inbound
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 bg-blue-500" /> Outbound
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 bg-amber-500" /> Cross-dock
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 border-2 border-destructive" /> Conflict
        </span>
        <span className="ml-auto">
          {appts.length} appts · {conflicts.size} in conflict
        </span>
      </div>

      {loading ? (
        <div className="border-2 border-ink p-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Loading schedule…
        </div>
      ) : docks.length === 0 ? (
        <div className="border-2 border-ink p-12 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No docks configured
        </div>
      ) : (
        <div className="overflow-x-auto border-2 border-ink bg-background">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `64px repeat(${docks.length}, minmax(140px, 1fr))`,
            }}
          >
            <div className="sticky left-0 z-10 border-b-2 border-r-2 border-ink bg-paper p-2 font-mono text-[10px] uppercase tracking-widest">
              Time
            </div>
            {docks.map((d) => (
              <div
                key={d.id}
                className="border-b-2 border-r border-ink p-2 text-center font-mono text-[10px] uppercase tracking-widest"
              >
                <div className="font-display text-sm">{d.code}</div>
                <div className="text-muted-foreground">Zone {d.zone}</div>
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  {(d.carrier_categories ?? ["standard"]).map((c) => (
                    <span
                      key={c}
                      className={`px-1 py-px text-[8px] tracking-wide ${CATEGORY_META[c]?.color ?? "bg-slate-100"}`}
                      title={CATEGORY_META[c]?.label ?? c}
                    >
                      {CATEGORY_META[c]?.label ?? c}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {Array.from({ length: SLOTS }).map((_, slot) => {
              const minutes = HOUR_START * 60 + slot * SLOT_MIN;
              const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
              const mm = String(minutes % 60).padStart(2, "0");
              const isHour = minutes % 60 === 0;
              return (
                <div key={`row-${slot}`} className="contents">
                  <div
                    className={`sticky left-0 z-10 border-r-2 border-ink bg-paper px-2 font-mono text-[10px] ${
                      isHour ? "border-t border-ink" : "border-t border-ink/10"
                    }`}
                    style={{ height: ROW_PX, lineHeight: `${ROW_PX}px` }}
                  >
                    {isHour ? `${hh}:${mm}` : ""}
                  </div>
                  {docks.map((d) => (
                    <div
                      key={`${d.id}-${slot}`}
                      onDragOver={(e) => {
                        if (canEdit) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!canEdit || !dragRef.current) return;
                        const { id, offsetSlots } = dragRef.current;
                        void moveAppointment(id, d.id, slot - offsetSlots);
                        dragRef.current = null;
                      }}
                      className={`relative border-r border-ink/10 ${
                        isHour ? "border-t border-ink/40" : "border-t border-ink/10"
                      }`}
                      style={{ height: ROW_PX }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <div className="relative">
            <div
              className="pointer-events-none absolute inset-0 grid"
              style={{
                gridTemplateColumns: `64px repeat(${docks.length}, minmax(140px, 1fr))`,
                top: -SLOTS * ROW_PX,
                height: SLOTS * ROW_PX,
              }}
            >
              <div />
              {docks.map((d) => {
                const items = appts.filter((a) => a.dock_id === d.id);
                return (
                  <div key={d.id} className="relative">
                    {items.map((a) => {
                      const startSlot = slotIndexFromIso(day, a.starts_at);
                      const endSlot = slotIndexFromIso(day, a.ends_at);
                      const top = Math.max(0, startSlot) * ROW_PX;
                      const height = Math.max(ROW_PX, (endSlot - startSlot) * ROW_PX);
                      const isConflict = conflicts.has(a.id);
                      return (
                        <button
                          key={a.id}
                          draggable={canEdit}
                          onDragStart={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const offsetSlots = Math.floor(
                              (e.clientY - rect.top) / ROW_PX,
                            );
                            dragRef.current = { id: a.id, offsetSlots };
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onClick={() => setSelected(a)}
                          className={`pointer-events-auto absolute left-1 right-1 overflow-hidden rounded border-2 px-2 py-1 text-left font-mono text-[10px] shadow-sm transition hover:translate-x-[1px] hover:translate-y-[1px] ${
                            typeColor[a.appointment_type]
                          } ${
                            isConflict
                              ? "border-destructive ring-2 ring-destructive"
                              : statusBadge[a.status]
                          } ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={{ top, height }}
                          title={`${a.carrier} · ${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)}`}
                        >
                          <div className="truncate font-bold uppercase tracking-wider">
                            {a.carrier}
                          </div>
                          <div className="truncate opacity-90">
                            {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}
                          </div>
                          {a.reference && (
                            <div className="truncate opacity-80">{a.reference}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <DetailPanel
          appt={selected}
          dock={docks.find((d) => d.id === selected.dock_id)}
          canEdit={canEdit}
          inConflict={conflicts.has(selected.id)}
          onClose={() => setSelected(null)}
          onStatus={(s) => updateStatus(selected.id, s)}
          onDelete={() => deleteAppt(selected.id)}
        />
      )}

      {showNew && canEdit && (
        <NewAppointmentDialog
          docks={docks}
          day={day}
          onClose={() => setShowNew(false)}
          onCreated={(a) => {
            setAppts((prev) =>
              [...prev, a].sort((x, y) => x.starts_at.localeCompare(y.starts_at)),
            );
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function DetailPanel({
  appt,
  dock,
  canEdit,
  inConflict,
  onClose,
  onStatus,
  onDelete,
}: {
  appt: Appointment;
  dock?: Dock;
  canEdit: boolean;
  inConflict: boolean;
  onClose: () => void;
  onStatus: (s: Appointment["status"]) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-background p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              {appt.appointment_type.replace("_", " ")} · {dock?.code ?? "—"}
            </div>
            <h2 className="font-display text-2xl tracking-tight">{appt.carrier}</h2>
          </div>
          <button onClick={onClose} className="font-mono text-xs">
            ✕
          </button>
        </div>
        {inConflict && (
          <div className="mt-3 border-2 border-destructive bg-destructive/10 p-2 font-mono text-[10px] uppercase tracking-widest text-destructive">
            ● Conflict — overlaps another appointment on this dock
          </div>
        )}
        <dl className="mt-4 space-y-2 font-mono text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Window</dt>
            <dd>
              {fmtTime(appt.starts_at)} → {fmtTime(appt.ends_at)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Reference</dt>
            <dd>{appt.reference || "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="uppercase">{appt.status.replace("_", " ")}</dd>
          </div>
          {appt.notes && (
            <div>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap">{appt.notes}</dd>
            </div>
          )}
        </dl>
        {canEdit && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => onStatus("in_progress")}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-hazard"
            >
              Start
            </button>
            <button
              onClick={() => onStatus("completed")}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
            >
              Complete
            </button>
            <button
              onClick={() => onStatus("no_show")}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground"
            >
              No-show
            </button>
            <button
              onClick={() => onStatus("cancelled")}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              className="col-span-2 border-2 border-destructive px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              Delete appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAppointmentDialog({
  docks,
  day,
  onClose,
  onCreated,
}: {
  docks: Dock[];
  day: Date;
  onClose: () => void;
  onCreated: (a: Appointment) => void;
}) {
  const [carrier, setCarrier] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState<CarrierCategory>("standard");
  const [dockId, setDockId] = useState("");
  const [type, setType] = useState<Appointment["appointment_type"]>("inbound");
  const [start, setStart] = useState("09:00");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<DockSuggestion[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  const startsAtIso = useMemo(() => {
    const [hh, mm] = start.split(":").map(Number);
    const d = new Date(day);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  }, [day, start]);
  const endsAtIso = useMemo(
    () => new Date(new Date(startsAtIso).getTime() + duration * 60000).toISOString(),
    [startsAtIso, duration],
  );

  // Smart suggestions: refresh when category/time/duration changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSuggest(true);
      const { data, error } = await supabase.rpc("suggest_docks", {
        _category: category,
        _starts_at: startsAtIso,
        _ends_at: endsAtIso,
        _limit: 6,
      });
      if (cancelled) return;
      if (error) {
        setSuggestions([]);
      } else {
        setSuggestions((data ?? []) as DockSuggestion[]);
        // Auto-select top suggestion if user hasn't picked yet
        if (!dockId && data && data.length > 0) {
          setDockId((data[0] as DockSuggestion).dock_id);
        }
      }
      setLoadingSuggest(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, startsAtIso, endsAtIso]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!carrier || !dockId) {
      toast.error("Pick a dock first");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("dock_appointments")
      .insert({
        carrier,
        reference: reference || null,
        dock_id: dockId,
        appointment_type: type,
        carrier_category: category,
        starts_at: startsAtIso,
        ends_at: endsAtIso,
        notes: notes || null,
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Appointment created");
    onCreated(data as Appointment);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto border-2 border-ink bg-background p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl tracking-tight">New appointment</h2>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              ◢ Smart dock allotment by carrier category
            </p>
          </div>
          <button type="button" onClick={onClose} className="font-mono text-xs">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 font-mono text-[10px] uppercase tracking-widest">
            Carrier
            <input
              required
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm normal-case"
            />
          </label>
          <label className="font-mono text-[10px] uppercase tracking-widest">
            Reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm normal-case"
            />
          </label>
          <label className="font-mono text-[10px] uppercase tracking-widest">
            Carrier category
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as CarrierCategory);
                setDockId(""); // reset so suggestion auto-selects
              }}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm"
            >
              {(Object.keys(CATEGORY_META) as CarrierCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="font-mono text-[10px] uppercase tracking-widest">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Appointment["appointment_type"])}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm"
            >
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="cross_dock">Cross-dock</option>
            </select>
          </label>
          <label className="font-mono text-[10px] uppercase tracking-widest">
            Start time
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm"
            />
          </label>
          <label className="font-mono text-[10px] uppercase tracking-widest">
            Duration (min)
            <input
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm"
            />
          </label>
          <div className="col-span-2 font-mono text-[10px] uppercase tracking-widest">
            <div className="flex items-center justify-between">
              <span>Recommended docks</span>
              <span className="text-muted-foreground">
                {loadingSuggest ? "Calculating…" : `${suggestions.length} candidates`}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {suggestions.map((s, idx) => {
                const selected = dockId === s.dock_id;
                const top = idx === 0 && !s.conflict;
                return (
                  <button
                    key={s.dock_id}
                    type="button"
                    onClick={() => setDockId(s.dock_id)}
                    disabled={s.conflict}
                    className={`relative border-2 p-2 text-left transition ${
                      selected
                        ? "border-hazard bg-hazard/10"
                        : s.conflict
                          ? "border-destructive/30 bg-destructive/5 opacity-60"
                          : "border-ink hover:bg-paper"
                    }`}
                  >
                    {top && (
                      <span className="absolute right-1 top-1 bg-hazard px-1 py-px text-[8px] tracking-widest text-ink">
                        ★ Best
                      </span>
                    )}
                    <div className="font-display text-sm tracking-tight normal-case">
                      {s.code}{" "}
                      <span className="text-[10px] text-muted-foreground">Zone {s.zone}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(s.carrier_categories ?? []).map((c) => (
                        <span
                          key={c}
                          className={`px-1 py-px text-[8px] tracking-wide ${
                            c === category
                              ? "bg-hazard text-ink"
                              : (CATEGORY_META[c]?.color ?? "bg-slate-100")
                          }`}
                        >
                          {CATEGORY_META[c]?.label ?? c}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                      <span>
                        {s.category_match ? "✓ Match" : "✗ No match"} · score{" "}
                        {Math.round(Number(s.score))}
                      </span>
                      <span>
                        {s.conflict
                          ? "Conflict"
                          : s.upcoming_count > 0
                            ? `${s.upcoming_count} nearby`
                            : "Free"}
                      </span>
                    </div>
                  </button>
                );
              })}
              {!loadingSuggest && suggestions.length === 0 && (
                <div className="col-span-2 border-2 border-ink/30 p-3 text-center text-muted-foreground">
                  No docks available
                </div>
              )}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground hover:text-ink">
                Override · pick any dock manually
              </summary>
              <select
                value={dockId}
                onChange={(e) => setDockId(e.target.value)}
                className="mt-2 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm"
              >
                <option value="">— Select dock —</option>
                {docks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — Zone {d.zone} (
                    {(d.carrier_categories ?? []).join(", ")})
                  </option>
                ))}
              </select>
            </details>
          </div>
          <label className="col-span-2 font-mono text-[10px] uppercase tracking-widest">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full border-2 border-ink bg-background px-2 py-2 font-sans text-sm normal-case"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            type="submit"
            className="border-2 border-ink bg-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
