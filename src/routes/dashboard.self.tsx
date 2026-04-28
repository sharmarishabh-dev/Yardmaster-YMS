import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/AuthProvider";
import { QrCode, ListChecks, User as UserIcon, LogOut, Truck, Clock, MapPin } from "lucide-react";

export const Route = createFileRoute("/dashboard/self")({
  head: () => ({ meta: [{ title: "Driver — YardMaster" }] }),
  component: DriverMobilePage,
});

type Tab = "scan" | "tasks" | "profile";

interface DriverTruck {
  id: string;
  plate: string;
  carrier: string;
  trailer_number: string | null;
  status: string;
  checked_in_at: string | null;
  departed_at: string | null;
  gate: string | null;
}

interface DriverTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  trailer_number: string | null;
  task_type: string;
}

function DriverMobilePage() {
  const { user, signOut, roles } = useAuth();
  const [tab, setTab] = useState<Tab>("scan");
  const [trucks, setTrucks] = useState<DriverTruck[]>([]);
  const [tasks, setTasks] = useState<DriverTask[]>([]);
  const [profile, setProfile] = useState<{ full_name: string | null; phone: string | null; company_name: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, phone, company_name")
        .eq("id", user.id)
        .maybeSingle();
      setProfile(prof ?? null);
      const fullName = prof?.full_name?.trim();

      let q = supabase
        .from("trucks")
        .select("id, plate, carrier, trailer_number, status, checked_in_at, departed_at, gate")
        .order("updated_at", { ascending: false })
        .limit(10);
      if (fullName) q = q.eq("driver_name", fullName);
      const { data: t } = await q;
      setTrucks(t ?? []);

      const tq = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_at, trailer_number, task_type")
        .eq("assignee_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setTasks((tq.data ?? []) as DriverTask[]);
      setLoading(false);
    })();
  }, [user]);

  const activeTruck = useMemo(
    () => trucks.find((t) => t.status === "checked_in") ?? trucks[0] ?? null,
    [trucks]
  );

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled"),
    [tasks]
  );

  return (
    <div className="-mx-6 -my-8 min-h-[calc(100vh-65px)] bg-paper pb-24">
      {/* Mobile header */}
      <div className="sticky top-[65px] z-40 border-b-2 border-ink bg-background">
        <div className="hazard-stripe h-1.5" />
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Driver
            </div>
            <h1 className="font-display text-2xl leading-none tracking-tighter">
              {tab === "scan" && "Check in / out"}
              {tab === "tasks" && "My tasks"}
              {tab === "profile" && "Profile"}
            </h1>
          </div>
          {activeTruck && (
            <span
              className={`px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${
                activeTruck.status === "checked_in"
                  ? "bg-ink text-background"
                  : activeTruck.status === "departed"
                    ? "bg-paper border-2 border-ink text-muted-foreground"
                    : "bg-hazard text-ink"
              }`}
            >
              ● {activeTruck.status.replace("_", " ")}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        {tab === "scan" && (
          <ScanTab loading={loading} activeTruck={activeTruck} trucks={trucks} />
        )}
        {tab === "tasks" && <TasksTab loading={loading} openTasks={openTasks} allTasks={tasks} />}
        {tab === "profile" && (
          <ProfileTab
            email={user?.email ?? ""}
            profile={profile}
            roles={roles.join(" · ")}
            onSignOut={() => void signOut()}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-ink bg-background">
        <div className="mx-auto grid max-w-md grid-cols-3">
          <TabBtn icon={<QrCode className="h-5 w-5" />} label="Scan" active={tab === "scan"} onClick={() => setTab("scan")} />
          <TabBtn
            icon={<ListChecks className="h-5 w-5" />}
            label="Tasks"
            badge={openTasks.length || undefined}
            active={tab === "tasks"}
            onClick={() => setTab("tasks")}
          />
          <TabBtn icon={<UserIcon className="h-5 w-5" />} label="Profile" active={tab === "profile"} onClick={() => setTab("profile")} />
        </div>
      </nav>
    </div>
  );
}

function TabBtn({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1 py-3 font-mono text-[10px] uppercase tracking-widest transition ${
        active ? "bg-ink text-background" : "hover:bg-paper"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-1/2 top-1.5 ml-4 translate-x-5 bg-hazard px-1.5 py-0.5 text-[9px] text-ink">
          {badge}
        </span>
      )}
    </button>
  );
}

function ScanTab({
  loading,
  activeTruck,
  trucks,
}: {
  loading: boolean;
  activeTruck: DriverTruck | null;
  trucks: DriverTruck[];
}) {
  const isCheckedIn = activeTruck?.status === "checked_in";
  const primary = isCheckedIn ? "checkout" : "checkin";

  return (
    <div className="space-y-5">
      {/* Big primary action */}
      <article
        className={`border-2 border-ink ${
          primary === "checkin" ? "bg-ink text-background" : "bg-hazard text-ink"
        }`}
      >
        <div className="p-6">
          <div
            className={`font-mono text-[10px] uppercase tracking-widest ${
              primary === "checkin" ? "text-hazard" : "text-ink/70"
            }`}
          >
            ● {primary === "checkin" ? "Step 01" : "Step 02"}
          </div>
          <h2 className="font-display mt-2 text-3xl leading-tight tracking-tight">
            {primary === "checkin" ? "Scan check-in QR" : "Scan check-out QR"}
          </h2>
          <p
            className={`mt-2 text-sm ${
              primary === "checkin" ? "text-background/70" : "text-ink/80"
            }`}
          >
            {primary === "checkin"
              ? "Open your phone camera and scan the QR shown by the gate operator."
              : "Loading complete? Scan the check-out QR to release the gate."}
          </p>
          <div
            className={`mt-5 flex h-40 items-center justify-center border-2 ${
              primary === "checkin" ? "border-background/40" : "border-ink/40"
            }`}
          >
            <QrCode className="h-20 w-20 opacity-60" />
          </div>
          <p
            className={`mt-3 text-center font-mono text-[10px] uppercase tracking-widest ${
              primary === "checkin" ? "text-background/60" : "text-ink/60"
            }`}
          >
            Aim camera at gate operator's QR
          </p>
        </div>
      </article>

      {/* Secondary action */}
      <article className="border-2 border-ink bg-background p-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {primary === "checkin" ? "● When done" : "● First time today?"}
        </div>
        <h3 className="font-display mt-1 text-lg tracking-tight">
          {primary === "checkin" ? "Scan check-out QR" : "Scan check-in QR"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {primary === "checkin"
            ? "Available once your truck is loaded and ready to depart."
            : "Use this if you have not checked in yet."}
        </p>
      </article>

      {/* Status card */}
      <section className="border-2 border-ink bg-background">
        <div className="border-b-2 border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest">
          ◢ Current truck
        </div>
        <div className="p-5">
          {loading ? (
            <div className="font-mono text-xs text-muted-foreground">● Loading…</div>
          ) : !activeTruck ? (
            <div className="text-sm text-muted-foreground">
              No truck linked yet. Ask the gate operator to assign you.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Truck className="h-6 w-6 text-hazard" />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {activeTruck.carrier}
                  </div>
                  <div className="font-display text-2xl tracking-tight">{activeTruck.plate}</div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 border-t border-ink/10 pt-3 text-xs">
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Trailer
                  </dt>
                  <dd className="mt-0.5 font-mono">{activeTruck.trailer_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Gate
                  </dt>
                  <dd className="mt-0.5 font-mono flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {activeTruck.gate ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Checked in
                  </dt>
                  <dd className="mt-0.5 font-mono">
                    {activeTruck.checked_in_at ? formatTime(activeTruck.checked_in_at) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    Departed
                  </dt>
                  <dd className="mt-0.5 font-mono">
                    {activeTruck.departed_at ? formatTime(activeTruck.departed_at) : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </section>

      {trucks.length > 1 && (
        <section className="border-2 border-ink bg-background">
          <div className="border-b-2 border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest">
            ◢ Recent trucks ({trucks.length - 1})
          </div>
          <div className="divide-y divide-ink/10">
            {trucks.slice(1).map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-display text-base tracking-tight">{t.plate}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t.carrier} · {formatTime(t.checked_in_at ?? "")}
                  </div>
                </div>
                <span
                  className={`px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${
                    t.status === "checked_in"
                      ? "bg-ink text-background"
                      : t.status === "departed"
                        ? "bg-paper text-muted-foreground border border-ink/20"
                        : "bg-hazard text-ink"
                  }`}
                >
                  {t.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TasksTab({
  loading,
  openTasks,
  allTasks,
}: {
  loading: boolean;
  openTasks: DriverTask[];
  allTasks: DriverTask[];
}) {
  const completed = allTasks.filter((t) => t.status === "completed");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px bg-ink">
        <div className="bg-hazard p-4 text-ink">
          <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">Open</div>
          <div className="font-display text-3xl tracking-tight">{openTasks.length}</div>
        </div>
        <div className="bg-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Completed
          </div>
          <div className="font-display text-3xl tracking-tight">{completed.length}</div>
        </div>
      </div>

      <Link
        to="/dashboard/tasks"
        className="block w-full border-2 border-ink bg-ink py-3 text-center font-mono text-[10px] uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
      >
        Open full task board →
      </Link>

      <section className="border-2 border-ink bg-background">
        <div className="border-b-2 border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest">
          ◢ Open tasks
        </div>
        {loading ? (
          <div className="p-5 font-mono text-xs text-muted-foreground">● Loading…</div>
        ) : openTasks.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">No open tasks. You're all clear.</div>
        ) : (
          <ul className="divide-y divide-ink/10">
            {openTasks.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-base leading-tight tracking-tight">
                      {t.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-widest">
                      <span className="text-muted-foreground">{t.task_type}</span>
                      {t.trailer_number && <span className="text-hazard">▸ {t.trailer_number}</span>}
                      {t.due_at && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatTime(t.due_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-1 font-mono text-[9px] uppercase tracking-widest ${
                      t.priority === "urgent"
                        ? "bg-hazard text-ink"
                        : t.priority === "high"
                          ? "bg-orange-500 text-ink"
                          : "border border-ink/30 text-ink"
                    }`}
                  >
                    {t.priority}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProfileTab({
  email,
  profile,
  roles,
  onSignOut,
}: {
  email: string;
  profile: { full_name: string | null; phone: string | null; company_name: string | null } | null;
  roles: string;
  onSignOut: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="border-2 border-ink bg-background p-5">
        <div className="flex h-16 w-16 items-center justify-center bg-ink text-background">
          <UserIcon className="h-8 w-8" />
        </div>
        <h2 className="font-display mt-4 text-2xl tracking-tight">
          {profile?.full_name || "Driver"}
        </h2>
        <p className="font-mono text-xs text-muted-foreground">{email}</p>
        <div className="mt-2 inline-block bg-hazard px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink">
          {roles || "driver"}
        </div>
      </section>

      <section className="border-2 border-ink bg-background">
        <div className="border-b-2 border-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest">
          ◢ Details
        </div>
        <dl className="divide-y divide-ink/10">
          <Row label="Company" value={profile?.company_name || "—"} />
          <Row label="Phone" value={profile?.phone || "—"} />
          <Row label="Email" value={email} />
        </dl>
      </section>

      <button
        onClick={onSignOut}
        className="flex w-full items-center justify-center gap-2 border-2 border-ink bg-background py-3 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
