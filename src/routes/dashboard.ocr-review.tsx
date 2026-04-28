import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/ocr-review")({
  head: () => ({ meta: [{ title: "OCR Review — YardMaster" }] }),
  component: OcrReviewPage,
});

type ReadType = "plate" | "container" | "trailer";
type Status = "auto_approved" | "needs_review" | "approved" | "rejected" | "overridden";

interface OcrRead {
  id: string;
  truck_id: string;
  read_type: ReadType;
  raw_value: string;
  normalized_value: string;
  expected_value: string | null;
  override_value: string | null;
  override_reason: string | null;
  confidence: number;
  status: Status;
  notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

interface TruckLite {
  id: string;
  plate: string;
  carrier: string;
  trailer_number: string | null;
}

interface AuditEntry {
  id: string;
  ocr_read_id: string;
  actor_id: string | null;
  action: string;
  before_status: Status | null;
  after_status: Status | null;
  before_value: string | null;
  after_value: string | null;
  reason: string | null;
  created_at: string;
}

interface LockRow {
  ocr_read_id: string;
  locked_by: string;
  expires_at: string;
}

const STATUS_STYLE: Record<Status, string> = {
  auto_approved: "bg-green-600 text-background",
  needs_review: "bg-hazard text-ink",
  approved: "bg-green-600 text-background",
  rejected: "bg-destructive text-background",
  overridden: "bg-blue-500 text-background",
};

// Workflow definition: which transitions are allowed
const NEXT_STATES: Record<Status, Status[]> = {
  needs_review: ["approved", "overridden", "rejected"],
  auto_approved: ["overridden", "rejected"],
  approved: ["overridden", "rejected", "needs_review"],
  overridden: ["approved", "rejected", "needs_review"],
  rejected: ["needs_review"],
};

function OcrReviewPage() {
  const { user, roles } = useAuth();
  const canAct = roles.includes("admin") || roles.includes("operator");

  const [reads, setReads] = useState<OcrRead[]>([]);
  const [trucks, setTrucks] = useState<TruckLite[]>([]);
  const [filter, setFilter] = useState<"needs_review" | "all" | Status>("needs_review");
  const [locks, setLocks] = useState<Record<string, LockRow>>({});
  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  // detail drawer state
  const [openId, setOpenId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [acquiring, setAcquiring] = useState(false);
  const open = useMemo(() => reads.find((r) => r.id === openId) ?? null, [reads, openId]);

  // Load main data + realtime
  useEffect(() => {
    const load = async () => {
      const { data: r } = await supabase
        .from("ocr_reads")
        .select(
          "id, truck_id, read_type, raw_value, normalized_value, expected_value, override_value, override_reason, confidence, status, notes, reviewed_at, reviewed_by, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(300);
      setReads((r ?? []) as OcrRead[]);
      const ids = Array.from(new Set((r ?? []).map((x) => x.truck_id))) as string[];
      if (ids.length) {
        const { data: t } = await supabase
          .from("trucks")
          .select("id, plate, carrier, trailer_number")
          .in("id", ids);
        setTrucks((t ?? []) as TruckLite[]);
      }
      const { data: lk } = await supabase
        .from("ocr_review_locks")
        .select("ocr_read_id, locked_by, expires_at")
        .gt("expires_at", new Date().toISOString());
      const lkMap: Record<string, LockRow> = {};
      (lk ?? []).forEach((l) => (lkMap[l.ocr_read_id] = l as LockRow));
      setLocks(lkMap);
    };
    void load();
    const ch = supabase
      .channel("ocr-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ocr_reads" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ocr_review_locks" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  // Resolve actor names for audit + locks
  useEffect(() => {
    const ids = new Set<string>();
    reads.forEach((r) => r.reviewed_by && ids.add(r.reviewed_by));
    Object.values(locks).forEach((l) => ids.add(l.locked_by));
    audit.forEach((a) => a.actor_id && ids.add(a.actor_id));
    const missing = Array.from(ids).filter((id) => !(id in actorNames));
    if (!missing.length) return;
    void supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", missing)
      .then(({ data }) => {
        const next = { ...actorNames };
        (data ?? []).forEach((p) => {
          next[p.id] = p.full_name || p.id.slice(0, 8);
        });
        setActorNames(next);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads, locks, audit]);

  const truckById = useMemo(() => {
    const m = new Map<string, TruckLite>();
    trucks.forEach((t) => m.set(t.id, t));
    return m;
  }, [trucks]);

  const visible = useMemo(() => {
    if (filter === "all") return reads;
    return reads.filter((r) => r.status === filter);
  }, [reads, filter]);

  const counts = useMemo(
    () => ({
      needs_review: reads.filter((r) => r.status === "needs_review").length,
      auto: reads.filter((r) => r.status === "auto_approved").length,
      approved: reads.filter((r) => r.status === "approved").length,
      rejected: reads.filter((r) => r.status === "rejected").length,
      overridden: reads.filter((r) => r.status === "overridden").length,
    }),
    [reads],
  );

  const loadAudit = async (id: string) => {
    const { data } = await supabase
      .from("ocr_review_audit")
      .select(
        "id, ocr_read_id, actor_id, action, before_status, after_status, before_value, after_value, reason, created_at",
      )
      .eq("ocr_read_id", id)
      .order("created_at", { ascending: true });
    setAudit((data ?? []) as AuditEntry[]);
  };

  const openDetail = async (r: OcrRead) => {
    setOpenId(r.id);
    setAudit([]);
    await loadAudit(r.id);
    if (canAct && r.status === "needs_review") {
      setAcquiring(true);
      const { data, error } = await supabase.rpc("acquire_ocr_lock", { _ocr_read_id: r.id });
      setAcquiring(false);
      if (error) toast.error(error.message);
      else if (data && typeof data === "object" && "ok" in data && !(data as { ok: boolean }).ok) {
        const reason = (data as { reason?: string }).reason;
        if (reason === "locked_by_other") {
          toast.error("Another reviewer is currently working on this read.");
        }
      }
    }
  };

  const closeDetail = async () => {
    const id = openId;
    setOpenId(null);
    setAudit([]);
    if (id && canAct) {
      await supabase.rpc("release_ocr_lock", { _ocr_read_id: id });
    }
  };

  const lockedByOther = (r: OcrRead) => {
    const lk = locks[r.id];
    return !!lk && lk.locked_by !== user?.id && new Date(lk.expires_at) > new Date();
  };

  const transition = async (r: OcrRead, target: Status) => {
    if (!canAct) return;
    if (lockedByOther(r)) {
      toast.error("Locked by another reviewer.");
      return;
    }
    // Re-acquire lock as a guard; RLS + lock will reject if stolen
    const { data: lockRes } = await supabase.rpc("acquire_ocr_lock", { _ocr_read_id: r.id });
    if (lockRes && typeof lockRes === "object" && "ok" in lockRes && !(lockRes as { ok: boolean }).ok) {
      toast.error("Could not acquire lock — refresh and retry.");
      return;
    }

    const update: {
      status: Status;
      reviewed_at: string | null;
      reviewed_by: string | null;
      override_value?: string;
      override_reason?: string;
    } = {
      status: target,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    };

    if (target === "overridden") {
      const value = window.prompt("Override value:", r.normalized_value);
      if (!value || !value.trim()) return;
      const reason = window.prompt("Reason for override:");
      if (!reason || !reason.trim()) return;
      update.override_value = value.trim().toUpperCase();
      update.override_reason = reason.trim();
    } else if (target === "rejected") {
      const reason = window.prompt("Reason for rejection:");
      if (!reason || !reason.trim()) return;
      update.override_reason = reason.trim();
    } else if (target === "needs_review") {
      update.reviewed_at = null;
      update.reviewed_by = null;
    }

    const { error } = await supabase.from("ocr_reads").update(update).eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Status → ${target.replace("_", " ")}`);
    await loadAudit(r.id);
    if (target !== "needs_review") {
      await supabase.rpc("release_ocr_lock", { _ocr_read_id: r.id });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">Module 08</div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">OCR Review</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Triage low-confidence reads. Opening a record locks it for 5 minutes so two
            reviewers cannot apply conflicting decisions.
          </p>
        </div>
        <dl className="grid grid-cols-5 gap-px bg-ink">
          <Stat k={counts.needs_review} v="Need review" tone={counts.needs_review > 0 ? "hazard" : undefined} />
          <Stat k={counts.auto} v="Auto" />
          <Stat k={counts.approved} v="Approved" />
          <Stat k={counts.overridden} v="Overridden" />
          <Stat k={counts.rejected} v="Rejected" />
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["needs_review", "auto_approved", "approved", "overridden", "rejected", "all"] as const).map(
          (f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                filter === f ? "bg-ink text-background" : "hover:bg-paper"
              }`}
            >
              {f.replace("_", " ")}
            </button>
          ),
        )}
      </div>

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-paper">
            <tr className="text-left">
              <Th>Time</Th>
              <Th>Type</Th>
              <Th>Truck</Th>
              <Th>Raw</Th>
              <Th>Normalized</Th>
              <Th>Expected</Th>
              <Th className="text-right">Conf.</Th>
              <Th>Status / Lock</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                  No reads match this filter.
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const t = truckById.get(r.truck_id);
                const conf = Math.round(r.confidence * 100);
                const mismatch = r.expected_value && r.normalized_value !== r.expected_value;
                const lk = locks[r.id];
                const otherLock = lk && lk.locked_by !== user?.id && new Date(lk.expires_at) > new Date();
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
                    <td className="p-3 font-mono text-xs uppercase">{r.read_type}</td>
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
                    <td className="p-3 font-mono text-xs">{r.raw_value}</td>
                    <td className={`p-3 font-mono text-sm ${mismatch ? "text-hazard" : ""}`}>
                      {r.override_value ?? r.normalized_value}
                    </td>
                    <td className="p-3 font-mono text-xs">{r.expected_value ?? "—"}</td>
                    <td
                      className={`p-3 text-right font-mono ${
                        conf < 70 ? "text-hazard" : conf < 90 ? "" : "text-green-700"
                      }`}
                    >
                      {conf}%
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_STYLE[r.status]}`}
                      >
                        {r.status.replace("_", " ")}
                      </span>
                      {otherLock && (
                        <div className="mt-1 inline-block bg-blue-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-background">
                          Locked · {actorNames[lk.locked_by] ?? lk.locked_by.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => void openDetail(r)}
                        className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/40"
          onClick={() => void closeDetail()}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l-2 border-ink bg-background p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b-2 border-ink pb-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                  OCR Review
                </div>
                <div className="font-display text-xl uppercase">{open.read_type}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {new Date(open.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => void closeDetail()}
                className="border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-paper"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-2 border-ink p-3">
              <Field label="Raw" value={open.raw_value} mono />
              <Field
                label="Normalized"
                value={open.override_value ?? open.normalized_value}
                mono
              />
              <Field label="Expected" value={open.expected_value ?? "—"} mono />
              <Field label="Confidence" value={`${Math.round(open.confidence * 100)}%`} mono />
              <Field label="Current status" value={open.status.replace("_", " ")} />
              <Field
                label="Reviewed by"
                value={
                  open.reviewed_by
                    ? `${actorNames[open.reviewed_by] ?? open.reviewed_by.slice(0, 8)} · ${
                        open.reviewed_at ? new Date(open.reviewed_at).toLocaleString() : ""
                      }`
                    : "—"
                }
              />
              {open.override_reason && (
                <div className="col-span-2">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Override reason
                  </div>
                  <div className="text-sm italic">{open.override_reason}</div>
                </div>
              )}
            </div>

            {/* Lock status banner */}
            {(() => {
              const lk = locks[open.id];
              if (!lk) return null;
              const isMine = lk.locked_by === user?.id;
              const expired = new Date(lk.expires_at) <= new Date();
              if (expired) return null;
              return (
                <div
                  className={`mt-3 border-2 border-ink p-2 font-mono text-[10px] uppercase tracking-widest ${
                    isMine ? "bg-green-600 text-background" : "bg-blue-500 text-background"
                  }`}
                >
                  {isMine
                    ? `You hold the lock until ${new Date(lk.expires_at).toLocaleTimeString()}`
                    : `Locked by ${actorNames[lk.locked_by] ?? lk.locked_by.slice(0, 8)} until ${new Date(lk.expires_at).toLocaleTimeString()}`}
                </div>
              );
            })()}
            {acquiring && (
              <div className="mt-3 border-2 border-ink p-2 font-mono text-[10px] uppercase tracking-widest">
                Acquiring lock…
              </div>
            )}

            {/* Workflow actions */}
            <div className="mt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Allowed transitions from <strong>{open.status.replace("_", " ")}</strong>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {NEXT_STATES[open.status].map((s) => {
                  const disabled =
                    !canAct || (lockedByOther(open) && (s === "approved" || s === "overridden" || s === "rejected"));
                  return (
                    <button
                      key={s}
                      disabled={disabled}
                      onClick={() => void transition(open, s)}
                      className={`border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest disabled:opacity-40 ${
                        s === "approved"
                          ? "hover:bg-green-600 hover:text-background"
                          : s === "overridden"
                            ? "hover:bg-blue-500 hover:text-background"
                            : s === "rejected"
                              ? "hover:bg-destructive hover:text-background"
                              : "hover:bg-paper"
                      }`}
                    >
                      → {s.replace("_", " ")}
                    </button>
                  );
                })}
              </div>
              {!canAct && (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Read-only — operator/admin role required.
                </div>
              )}
            </div>

            {/* Audit trail */}
            <div className="mt-6 border-t-2 border-ink pt-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                Audit timeline
              </div>
              <ol className="mt-3 space-y-3">
                {audit.length === 0 ? (
                  <li className="font-mono text-xs text-muted-foreground">
                    No transitions yet.
                  </li>
                ) : (
                  audit.map((e) => (
                    <li key={e.id} className="border-l-4 border-ink pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">
                          {e.before_status?.replace("_", " ") ?? "—"}
                        </span>
                        <span className="font-mono text-xs">→</span>
                        <span
                          className={`inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                            STATUS_STYLE[(e.after_status ?? "needs_review") as Status]
                          }`}
                        >
                          {e.after_status?.replace("_", " ") ?? e.action}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          by {e.actor_id ? actorNames[e.actor_id] ?? e.actor_id.slice(0, 8) : "system"}
                        </span>
                      </div>
                      {e.before_value !== e.after_value && (
                        <div className="mt-1 font-mono text-xs">
                          <span className="text-muted-foreground line-through">{e.before_value}</span>{" "}
                          → <strong>{e.after_value}</strong>
                        </div>
                      )}
                      {e.reason && <div className="mt-1 text-sm italic">{e.reason}</div>}
                    </li>
                  ))
                )}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
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
