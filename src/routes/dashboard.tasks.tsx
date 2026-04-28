import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/auth/AuthProvider";
import { sendDriverSms } from "@/server/sms.functions";
import { emailTaskAssignment } from "@/server/email.functions";
import { toast } from "sonner";

type EventType = Database["public"]["Enums"]["task_event_type"];

export const Route = createFileRoute("/dashboard/tasks")({
  head: () => ({ meta: [{ title: "Tasks — YardMaster" }] }),
  component: TasksPage,
});

type TaskStatus = "pending" | "assigned" | "in_progress" | "completed" | "cancelled";
type TaskPriority = "low" | "normal" | "high" | "urgent";
type TaskType = "move_trailer" | "inspect" | "fuel" | "wash" | "deliver_paperwork" | "other";

interface Task {
  id: string;
  title: string;
  instructions: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  assignee_id: string | null;
  trailer_number: string | null;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface TaskEvent {
  id: string;
  task_id: string;
  event_type: string;
  notes: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone?: string | null;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: "bg-hazard text-ink",
  high: "bg-orange-500 text-ink",
  normal: "bg-ink text-background",
  low: "border-2 border-ink text-ink",
};

const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: "border-2 border-ink text-ink",
  assigned: "bg-blue-500 text-background",
  in_progress: "bg-hazard text-ink",
  completed: "bg-green-600 text-background",
  cancelled: "bg-muted text-muted-foreground line-through",
};

function TasksPage() {
  const { user, roles } = useAuth();
  const isOperator = roles.includes("operator") || roles.includes("admin");
  const isDriver = roles.includes("driver");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [drivers, setDrivers] = useState<ProfileRow[]>([]);
  const [view, setView] = useState<"dispatcher" | "worker">(isDriver && !isOperator ? "worker" : "dispatcher");
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Load tasks + events + profile names
  useEffect(() => {
    const load = async () => {
      const { data: t } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
      setTasks((t ?? []) as Task[]);
      const { data: e } = await supabase
        .from("task_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setEvents((e ?? []) as TaskEvent[]);

      const ids = Array.from(new Set((t ?? []).map((x) => x.assignee_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: pr } = await supabase.from("profiles").select("id,full_name").in("id", ids);
        const map: Record<string, string> = {};
        (pr ?? []).forEach((p: ProfileRow) => {
          map[p.id] = p.full_name || "Unnamed";
        });
        setProfiles(map);
      }
    };
    void load();
  }, []);

  // Load drivers list (for assignment dropdown) — operators only
  useEffect(() => {
    if (!isOperator) return;
    const load = async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "driver");
      const ids = (roleRows ?? []).map((r) => r.user_id);
      if (!ids.length) return;
      const { data: pr } = await supabase.from("profiles").select("id,full_name,phone").in("id", ids);
      setDrivers((pr ?? []) as ProfileRow[]);
    };
    void load();
  }, [isOperator]);

  const sendSms = useServerFn(sendDriverSms);
  const sendEmail = useServerFn(emailTaskAssignment);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("tasks-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        setTasks((prev) => {
          if (payload.eventType === "INSERT") return [payload.new as Task, ...prev];
          if (payload.eventType === "UPDATE")
            return prev.map((t) => (t.id === (payload.new as Task).id ? (payload.new as Task) : t));
          if (payload.eventType === "DELETE") return prev.filter((t) => t.id !== (payload.old as Task).id);
          return prev;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_events" }, (payload) => {
        setEvents((prev) => [payload.new as TaskEvent, ...prev].slice(0, 200));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (view === "worker") {
      list = list.filter(
        (t) => t.assignee_id === user?.id && t.status !== "completed" && t.status !== "cancelled",
      );
    }
    if (filter !== "all") list = list.filter((t) => t.status === filter);
    return [...list].sort((a, b) => {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [tasks, view, filter, user?.id]);

  const counts = useMemo(() => {
    const c = { pending: 0, assigned: 0, in_progress: 0, completed: 0, cancelled: 0 };
    tasks.forEach((t) => {
      c[t.status]++;
    });
    return c;
  }, [tasks]);

  const selected = visibleTasks.find((t) => t.id === selectedId) ?? null;

  const updateStatus = async (task: Task, status: TaskStatus, eventType: EventType, note?: string) => {
    const patch: Partial<Task> = { status };
    if (status === "in_progress" && !task.started_at) patch.started_at = new Date().toISOString();
    if (status === "completed") patch.completed_at = new Date().toISOString();

    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("task_events").insert({
      task_id: task.id,
      event_type: eventType,
      actor_id: user?.id,
      notes: note ?? null,
    });
    toast.success(`Task ${eventType}`);
  };

  const assignTask = async (task: Task, assigneeId: string) => {
    const { error } = await supabase
      .from("tasks")
      .update({ assignee_id: assigneeId, status: "assigned" })
      .eq("id", task.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("task_events").insert({
      task_id: task.id,
      event_type: "assigned",
      actor_id: user?.id,
      notes: profiles[assigneeId] ? `→ ${profiles[assigneeId]}` : null,
    });
    if (!profiles[assigneeId]) {
      const d = drivers.find((x) => x.id === assigneeId);
      if (d) setProfiles((p) => ({ ...p, [assigneeId]: d.full_name || "Unnamed" }));
    }
    toast.success("Assigned");

    // Notify driver via SMS if we have a phone on file
    const driver = drivers.find((x) => x.id === assigneeId);
    const phone = driver?.phone?.trim();
    if (phone) {
      const trailer = task.trailer_number ? ` (Trailer ${task.trailer_number})` : "";
      const due = task.due_at ? ` Due ${new Date(task.due_at).toLocaleString()}` : "";
      const body = `YardMaster: New task assigned — ${task.title}${trailer}.${due}`;
      try {
        const res = await sendSms({ data: { to: phone, body } });
        if (res.ok) toast.success("SMS sent to driver");
        else toast.message(`SMS not sent: ${res.error ?? "unknown"}`);
      } catch (e) {
        toast.message(`SMS error: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    // Also notify via email
    try {
      const emailRes = await sendEmail({
        data: {
          assignee_id: assigneeId,
          task_title: task.title,
          task_instructions: task.instructions,
          trailer_number: task.trailer_number,
          due_at: task.due_at,
        },
      });
      if (emailRes.ok) toast.success("Email notification queued");
      else if (!emailRes.skipped) toast.message(`Email not sent: ${emailRes.error ?? "unknown"}`);
    } catch (e) {
      toast.message(`Email error: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">Module 04</div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">Tasks</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Driver instructions, assignments, and worker handoff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(isOperator && isDriver) || (isOperator && !isDriver) ? (
            <div className="flex border-2 border-ink">
              <button
                onClick={() => setView("dispatcher")}
                className={`px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                  view === "dispatcher" ? "bg-ink text-background" : "hover:bg-paper"
                }`}
              >
                Dispatcher
              </button>
              <button
                onClick={() => setView("worker")}
                className={`border-l-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                  view === "worker" ? "bg-ink text-background" : "hover:bg-paper"
                }`}
              >
                Worker
              </button>
            </div>
          ) : null}
          {isOperator && view === "dispatcher" && (
            <button
              onClick={() => setShowNew(true)}
              className="border-2 border-ink bg-hazard px-4 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
            >
              + New task
            </button>
          )}
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(["pending", "assigned", "in_progress", "completed", "cancelled"] as TaskStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? "all" : s)}
            className={`border-2 border-ink p-3 text-left transition ${
              filter === s ? "bg-ink text-background" : "bg-background hover:bg-paper"
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-widest">{s.replace("_", " ")}</div>
            <div className="font-display text-2xl">{counts[s]}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Task list */}
        <div className="space-y-2">
          {visibleTasks.length === 0 && (
            <div className="border-2 border-dashed border-ink p-12 text-center">
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {view === "worker" ? "No active tasks assigned to you" : "No tasks match this filter"}
              </div>
            </div>
          )}
          {visibleTasks.map((t) => {
            const overdue =
              t.due_at && t.status !== "completed" && t.status !== "cancelled" && new Date(t.due_at) < new Date();
            return (
              <div
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`cursor-pointer border-2 border-ink bg-background p-4 transition ${
                  selectedId === t.id ? "shadow-[6px_6px_0_0] shadow-ink" : "hover:bg-paper"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${PRIORITY_STYLE[t.priority]}`}>
                        {t.priority}
                      </span>
                      <span className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_STYLE[t.status]}`}>
                        {t.status.replace("_", " ")}
                      </span>
                      <span className="border-2 border-ink px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest">
                        {t.task_type.replace("_", " ")}
                      </span>
                      {overdue && (
                        <span className="bg-hazard px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ink">
                          ● Overdue
                        </span>
                      )}
                    </div>
                    <div className="font-display text-lg leading-tight">{t.title}</div>
                    {t.instructions && (
                      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.instructions}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {t.trailer_number && <span>Trailer · {t.trailer_number}</span>}
                      {t.assignee_id && <span>Assignee · {profiles[t.assignee_id] ?? "—"}</span>}
                      {t.due_at && <span>Due · {new Date(t.due_at).toLocaleString()}</span>}
                    </div>
                  </div>
                  {/* Worker quick actions */}
                  {view === "worker" && t.assignee_id === user?.id && (
                    <div className="flex flex-col gap-1.5">
                      {t.status === "assigned" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateStatus(t, "in_progress", "started");
                          }}
                          className="border-2 border-ink bg-hazard px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
                        >
                          ▶ Start
                        </button>
                      )}
                      {t.status === "in_progress" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateStatus(t, "completed", "completed");
                          }}
                          className="border-2 border-ink bg-green-600 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-ink"
                        >
                          ✓ Complete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <aside className="space-y-4">
          {selected ? (
            <TaskDetail
              task={selected}
              events={events.filter((e) => e.task_id === selected.id)}
              profiles={profiles}
              drivers={drivers}
              isOperator={isOperator}
              isAssignee={selected.assignee_id === user?.id}
              onStatus={(s, ev, n) => updateStatus(selected, s, ev, n)}
              onAssign={(id) => assignTask(selected, id)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="border-2 border-dashed border-ink p-6 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Select a task to view details
            </div>
          )}

          <LiveActivityFeed tasks={tasks} taskEvents={events} profiles={profiles} />
        </aside>
      </div>

      {showNew && isOperator && (
        <NewTaskDialog
          drivers={drivers}
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
          actorId={user?.id}
        />
      )}
    </div>
  );
}

function TaskDetail({
  task,
  events,
  profiles,
  drivers,
  isOperator,
  isAssignee,
  onStatus,
  onAssign,
  onClose,
}: {
  task: Task;
  events: TaskEvent[];
  profiles: Record<string, string>;
  drivers: ProfileRow[];
  isOperator: boolean;
  isAssignee: boolean;
  onStatus: (s: TaskStatus, ev: EventType, note?: string) => void;
  onAssign: (assigneeId: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="border-2 border-ink bg-background">
      <div className="flex items-center justify-between border-b-2 border-ink bg-paper px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest">Task detail</span>
        <button onClick={onClose} className="font-mono text-xs hover:text-hazard">
          ✕
        </button>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="font-display text-lg leading-tight">{task.title}</div>
          {task.instructions && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.instructions}</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-widest">
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{task.task_type.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Priority</dt>
            <dd>{task.priority}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{task.status.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Trailer</dt>
            <dd>{task.trailer_number ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assignee</dt>
            <dd>{task.assignee_id ? (profiles[task.assignee_id] ?? "—") : "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{task.due_at ? new Date(task.due_at).toLocaleString() : "—"}</dd>
          </div>
        </dl>

        {isOperator && (
          <div className="space-y-1.5 border-t-2 border-ink pt-3">
            <label className="font-mono text-[10px] uppercase tracking-widest">Assign to driver</label>
            <select
              value={task.assignee_id ?? ""}
              onChange={(e) => e.target.value && onAssign(e.target.value)}
              className="w-full border-2 border-ink bg-background p-2 font-mono text-xs"
            >
              <option value="">— Choose driver —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name || "Unnamed"}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-3">
          {(isAssignee || isOperator) && task.status === "assigned" && (
            <button
              onClick={() => onStatus("in_progress", "started")}
              className="border-2 border-ink bg-hazard px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
            >
              ▶ Start
            </button>
          )}
          {(isAssignee || isOperator) && task.status === "in_progress" && (
            <button
              onClick={() => onStatus("completed", "completed")}
              className="border-2 border-ink bg-green-600 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-background hover:bg-ink"
            >
              ✓ Complete
            </button>
          )}
          {isOperator && task.status !== "cancelled" && task.status !== "completed" && (
            <button
              onClick={() => onStatus("cancelled", "cancelled")}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-hazard"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="space-y-2 border-t-2 border-ink pt-3">
          <label className="font-mono text-[10px] uppercase tracking-widest">Add note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full border-2 border-ink bg-background p-2 text-sm"
            placeholder="Update or comment…"
          />
          <button
            onClick={() => {
              if (!note.trim()) return;
              onStatus(task.status, "note", note.trim());
              setNote("");
            }}
            disabled={!note.trim()}
            className="w-full border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
          >
            Log note
          </button>
        </div>

        {events.length > 0 && (
          <div className="border-t-2 border-ink pt-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest">History</div>
            <div className="max-h-48 space-y-1 overflow-auto">
              {events.map((e) => (
                <div key={e.id} className="border-l-2 border-ink py-0.5 pl-2 text-xs">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-hazard">
                    {e.event_type} · {new Date(e.created_at).toLocaleTimeString()}
                  </div>
                  {e.notes && <div className="text-muted-foreground">{e.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewTaskDialog({
  drivers,
  onClose,
  onCreated,
  actorId,
}: {
  drivers: ProfileRow[];
  onClose: () => void;
  onCreated: () => void;
  actorId: string | undefined;
}) {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("move_trailer");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [trailer, setTrailer] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    setBusy(true);
    const status: TaskStatus = assigneeId ? "assigned" : "pending";
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: title.trim(),
        instructions: instructions.trim() || null,
        task_type: taskType,
        priority,
        trailer_number: trailer.trim() || null,
        assignee_id: assigneeId || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        status,
        created_by: actorId,
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }
    await supabase.from("task_events").insert({
      task_id: data.id,
      event_type: "created",
      actor_id: actorId,
    });
    if (assigneeId) {
      await supabase.from("task_events").insert({
        task_id: data.id,
        event_type: "assigned",
        actor_id: actorId,
      });
    }
    toast.success("Task created");
    setBusy(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg border-2 border-ink bg-background shadow-[8px_8px_0_0] shadow-hazard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-3">
          <span className="font-display text-lg">New task</span>
          <button onClick={onClose} className="font-mono text-sm hover:text-hazard">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border-2 border-ink bg-background p-2 text-sm"
              placeholder="Move trailer 4421 to dock D-3"
            />
          </Field>
          <Field label="Instructions">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full border-2 border-ink bg-background p-2 text-sm"
              placeholder="Notes for the driver…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
                className="w-full border-2 border-ink bg-background p-2 font-mono text-xs"
              >
                <option value="move_trailer">Move trailer</option>
                <option value="inspect">Inspect</option>
                <option value="fuel">Fuel</option>
                <option value="wash">Wash</option>
                <option value="deliver_paperwork">Deliver paperwork</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full border-2 border-ink bg-background p-2 font-mono text-xs"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Trailer #">
              <input
                value={trailer}
                onChange={(e) => setTrailer(e.target.value)}
                className="w-full border-2 border-ink bg-background p-2 text-sm"
              />
            </Field>
            <Field label="Due">
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full border-2 border-ink bg-background p-2 font-mono text-xs"
              />
            </Field>
          </div>
          <Field label="Assign driver (optional)">
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full border-2 border-ink bg-background p-2 font-mono text-xs"
            >
              <option value="">— Unassigned —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name || "Unnamed"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t-2 border-ink bg-paper px-4 py-3">
          <button
            onClick={onClose}
            className="border-2 border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="border-2 border-ink bg-hazard px-4 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

type FeedItem = {
  id: string;
  kind: "task" | "move";
  action: string;
  at: string;
  title: string;
  subtitle?: string;
  driver?: string;
  sla?: "ok" | "at_risk" | "breached" | null;
  route?: string;
};

function LiveActivityFeed({
  tasks,
  taskEvents,
  profiles,
}: {
  tasks: Task[];
  taskEvents: TaskEvent[];
  profiles: Record<string, string>;
}) {
  const [moves, setMoves] = useState<
    Array<{ id: string; action: string; created_at: string; trailer_id: string | null; from_slot_id: string | null; to_slot_id: string | null; notes: string | null }>
  >([]);
  const [trailerMap, setTrailerMap] = useState<Record<string, { plate: string; carrier: string; driver_name: string | null }>>({});
  const [slotMap, setSlotMap] = useState<Record<string, { code: string; zone: string }>>({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data: m }, { data: t }, { data: s }] = await Promise.all([
        supabase.from("trailer_moves").select("id, action, created_at, trailer_id, from_slot_id, to_slot_id, notes").order("created_at", { ascending: false }).limit(60),
        supabase.from("trucks").select("id, plate, carrier, driver_name"),
        supabase.from("yard_slots").select("id, code, zone"),
      ]);
      if (!mounted) return;
      setMoves(m ?? []);
      const tm: Record<string, { plate: string; carrier: string; driver_name: string | null }> = {};
      (t ?? []).forEach((x) => { tm[x.id] = { plate: x.plate, carrier: x.carrier, driver_name: x.driver_name }; });
      setTrailerMap(tm);
      const sm: Record<string, { code: string; zone: string }> = {};
      (s ?? []).forEach((x) => { sm[x.id] = { code: x.code, zone: x.zone }; });
      setSlotMap(sm);
    })();

    const ch = supabase
      .channel("live-feed-moves")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trailer_moves" }, (p) => {
        setMoves((prev) => [p.new as typeof prev[number], ...prev].slice(0, 60));
      })
      .subscribe();
    return () => { mounted = false; void supabase.removeChannel(ch); };
  }, []);

  const items = useMemo<FeedItem[]>(() => {
    const taskItems: FeedItem[] = taskEvents.slice(0, 40).map((e) => {
      const tk = tasks.find((x) => x.id === e.task_id);
      let sla: FeedItem["sla"] = null;
      if (tk?.due_at) {
        const due = new Date(tk.due_at).getTime();
        const ts = new Date(e.created_at).getTime();
        if (e.event_type === "completed") sla = ts <= due ? "ok" : "breached";
        else if (due < Date.now()) sla = "breached";
        else if (due - Date.now() < 30 * 60_000) sla = "at_risk";
        else sla = "ok";
      }
      return {
        id: `t-${e.id}`,
        kind: "task",
        action: e.event_type,
        at: e.created_at,
        title: tk?.title ?? "Task",
        subtitle: tk?.trailer_number ? `Trailer ${tk.trailer_number}` : undefined,
        driver: tk?.assignee_id ? profiles[tk.assignee_id] : undefined,
        sla,
      };
    });
    const moveItems: FeedItem[] = moves.slice(0, 40).map((m) => {
      const tr = m.trailer_id ? trailerMap[m.trailer_id] : null;
      const from = m.from_slot_id ? slotMap[m.from_slot_id] : null;
      const to = m.to_slot_id ? slotMap[m.to_slot_id] : null;
      return {
        id: `m-${m.id}`,
        kind: "move",
        action: m.action,
        at: m.created_at,
        title: tr ? `${tr.plate} · ${tr.carrier}` : "Trailer move",
        driver: tr?.driver_name ?? undefined,
        route: `${from ? `${from.zone}·${from.code}` : "Gate"} → ${to ? `${to.zone}·${to.code}` : "Gate"}`,
        sla: m.action === "assign" ? "ok" : m.action === "out_of_service" ? "breached" : null,
      };
    });
    return [...taskItems, ...moveItems].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 50);
  }, [tasks, taskEvents, moves, trailerMap, slotMap, profiles]);

  const slaStyle = (s: FeedItem["sla"]) =>
    s === "breached" ? "bg-destructive text-background"
    : s === "at_risk" ? "bg-hazard text-ink"
    : s === "ok" ? "bg-emerald-600 text-background"
    : "bg-muted text-foreground";

  return (
    <div className="border-2 border-ink bg-background">
      <div className="flex items-center justify-between border-b-2 border-ink bg-paper px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest">● Live activity feed</span>
        <span className="font-mono text-[9px] text-muted-foreground">{items.length} events</span>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        {items.length === 0 && (
          <div className="p-4 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">No activity yet</div>
        )}
        {items.map((it) => (
          <div key={it.id} className="border-b border-ink/10 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${it.kind === "move" ? "bg-ink text-background" : "bg-hazard text-ink"}`}>
                {it.kind === "move" ? "MOVE" : "TASK"} · {it.action.replace("_", " ")}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">{new Date(it.at).toLocaleTimeString()}</span>
            </div>
            <div className="mt-1 truncate font-medium">{it.title}</div>
            {it.route && <div className="font-mono text-[10px] text-muted-foreground">↪ {it.route}</div>}
            {it.subtitle && <div className="font-mono text-[10px] text-muted-foreground">{it.subtitle}</div>}
            <div className="mt-1 flex items-center gap-2">
              {it.driver && (
                <span className="border border-ink/30 px-1 py-0 font-mono text-[9px] uppercase tracking-widest">
                  ◉ {it.driver}
                </span>
              )}
              {it.sla && (
                <span className={`px-1 py-0 font-mono text-[9px] uppercase tracking-widest ${slaStyle(it.sla)}`}>
                  SLA · {it.sla.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
