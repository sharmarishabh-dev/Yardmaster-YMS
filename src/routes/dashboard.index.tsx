import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/auth/AuthProvider";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardHome,
});

interface Profile {
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
}

function DashboardHome() {
  const { user, roles } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState({ inYard: 0, docksActive: 0, docksTotal: 0, openTasks: 0, queueWaiting: 0, parkingFree: 0, parkingTotal: 0 });

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("full_name, company_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data));
  }, [user]);

  useEffect(() => {
    async function load() {
      const [inYardRes, docksRes, tasksRes, queueRes, slotsRes] = await Promise.all([
        supabase.from("trucks").select("id", { count: "exact", head: true }).eq("status", "checked_in"),
        supabase.from("docks").select("status"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["pending", "in_progress"]),
        supabase.from("parking_queue").select("id", { count: "exact", head: true }).eq("status", "waiting"),
        supabase.from("yard_slots").select("status, slot_type").eq("slot_type", "parking"),
      ]);
      const docks = docksRes.data ?? [];
      const slots = slotsRes.data ?? [];
      setStats({
        inYard: inYardRes.count ?? 0,
        docksActive: docks.filter((d) => d.status === "available").length,
        docksTotal: docks.length,
        openTasks: tasksRes.count ?? 0,
        queueWaiting: queueRes.count ?? 0,
        parkingFree: slots.filter((s) => s.status === "empty").length,
        parkingTotal: slots.length,
      });
    }
    void load();
    const ch = supabase
      .channel("dash-home-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_queue" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "trucks" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "yard_slots" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const greeting = profile?.full_name?.split(" ")[0] ?? "Operator";

  const tiles = [
    { k: String(stats.inYard), v: "Trailers in yard", c: "ink" },
    { k: `${stats.parkingFree} / ${stats.parkingTotal}`, v: "Parking slots free", c: "ink" },
    { k: String(stats.openTasks), v: "Open tasks", c: "ink" },
    { k: String(stats.queueWaiting), v: "Parking queue", c: stats.queueWaiting > 0 ? "hazard" : "ink" },
  ];

  type ModuleLink = "/dashboard/gate" | "/dashboard/yard" | "/dashboard/dock" | "/dashboard/tasks" | "/dashboard/analytics" | "/dashboard/aiops";
  const modules: { n: string; t: string; d: string; to: ModuleLink; allow: AppRole[] }[] = [
    { n: "01", t: "Gate", d: "OCR check-in, appointment validation, decision engine.", to: "/dashboard/gate", allow: ["admin", "operator"] },
    { n: "02", t: "Yard map", d: "Slot-level live trailer positions and heatmaps.", to: "/dashboard/yard", allow: ["admin", "operator"] },
    { n: "03", t: "Dock scheduler", d: "AI dock allocation with SLA prioritization.", to: "/dashboard/dock", allow: ["admin", "operator"] },
    { n: "04", t: "Tasks", d: "Yard moves with dynamic driver assignment.", to: "/dashboard/tasks", allow: ["admin", "operator", "driver"] },
    { n: "05", t: "Analytics", d: "Throughput, dwell, utilization. Filter by yard.", to: "/dashboard/analytics", allow: ["admin"] },
    { n: "06", t: "AI ops", d: "Predictive ETA, smart re-spotting, congestion alerts.", to: "/dashboard/aiops", allow: ["admin"] },
  ];

  return (
    <div className="space-y-10">
      <section className="border-2 border-ink bg-background">
        <div className="hazard-stripe h-2" />
        <div className="grid gap-6 p-8 md:grid-cols-[2fr_1fr] md:items-end">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Control Tower · Live
            </div>
            <h1 className="font-display mt-3 text-5xl leading-[0.95] tracking-tighter">
              Welcome back, {greeting}.
            </h1>
            <p className="mt-3 max-w-xl text-muted-foreground">
              {profile?.company_name ? `${profile.company_name} · ` : ""}
              You're signed in as <span className="text-ink">{roles.join(", ") || "no role"}</span>.
              Click any live module below to jump straight in.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px bg-ink">
            {tiles.map((t) => (
              <div
                key={t.v}
                className={`p-5 ${t.c === "hazard" ? "bg-hazard text-ink" : "bg-background"}`}
              >
                <dt className="font-display text-3xl tracking-tight">{t.k}</dt>
                <dd className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between border-b-2 border-ink pb-4">
          <h2 className="font-display text-3xl tracking-tighter">Modules</h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            6 / 6 · rolling out
          </span>
        </div>
        <div className="mt-6 grid border-l-2 border-ink md:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const allowed = m.allow.some((r) => roles.includes(r));
            const cardBase =
              "group relative block border-b-2 border-r-2 border-ink bg-background p-6 transition";
            const cardActive = "hover:bg-ink hover:text-background";
            const cardLocked = "opacity-60 cursor-not-allowed";
            const inner = (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-hazard">
                    {m.n}
                  </span>
                  <span
                    className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                      allowed
                        ? "bg-hazard text-ink group-hover:bg-background/10 group-hover:text-background"
                        : "bg-paper text-muted-foreground"
                    }`}
                  >
                    {allowed ? "Open ↳" : "Restricted"}
                  </span>
                </div>
                <h3 className="font-display mt-4 text-xl tracking-tight">{m.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground group-hover:text-background/70">
                  {m.d}
                </p>
              </>
            );
            return allowed ? (
              <Link key={m.n} to={m.to} className={`${cardBase} ${cardActive}`}>
                {inner}
              </Link>
            ) : (
              <div key={m.n} className={`${cardBase} ${cardLocked}`}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
