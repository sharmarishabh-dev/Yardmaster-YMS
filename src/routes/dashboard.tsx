import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth, type AppRole } from "@/auth/AuthProvider";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Control Tower — YardMaster" }] }),
  component: DashboardLayout,
});

// ── Role-based access matrix ──────────────────────────────────
// admin    : full access
// operator : gate, yard, dock, tasks (+ overview)
// driver   : tasks only (+ overview)
const ROUTE_ACCESS: Record<string, AppRole[]> = {
  "/dashboard": ["admin", "operator", "driver"],
  "/dashboard/gate": ["admin", "operator"],
  "/dashboard/yard": ["admin", "operator"],
  "/dashboard/dock": ["admin", "operator"],
  "/dashboard/tasks": ["admin", "operator", "driver"],
  "/dashboard/self": ["admin", "operator", "driver"],
  "/dashboard/weighbridge": ["admin", "operator"],
  "/dashboard/ocr-review": ["admin", "operator"],
  "/dashboard/analytics": ["admin"],
  "/dashboard/aiops": ["admin"],
  "/dashboard/admin": ["admin"],
};

function canAccess(path: string, roles: AppRole[]): boolean {
  const allowed = ROUTE_ACCESS[path];
  if (!allowed) return true;
  return roles.some((r) => allowed.includes(r));
}

function DashboardLayout() {
  const { user, loading, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/sign-in" });
  }, [user, loading, navigate]);

  // Enforce role-based route guard — redirect unauthorized access to a permitted page
  useEffect(() => {
    if (loading || !user || roles.length === 0) return;
    const isDriverOnly = roles.every((r) => r === "driver");
    // Drivers landing on the overview get redirected to their self check page
    if (isDriverOnly && location.pathname === "/dashboard") {
      navigate({ to: "/dashboard/self", replace: true });
      return;
    }
    if (!canAccess(location.pathname, roles)) {
      const fallback = isDriverOnly ? "/dashboard/self" : "/dashboard";
      navigate({ to: fallback, replace: true });
    }
  }, [location.pathname, roles, loading, user, navigate]);

  const nav = useMemo(() => {
    const isDriverOnly =
      roles.length > 0 && roles.every((r) => r === "driver");
    if (isDriverOnly) {
      return [
        { to: "/dashboard/tasks", label: "Tasks" },
        { to: "/dashboard/self", label: "Check in / out" },
      ];
    }
    const allNav: { to: string; label: string }[] = [
      { to: "/dashboard", label: "Overview" },
      { to: "/dashboard/gate", label: "Gate" },
      { to: "/dashboard/yard", label: "Yard map" },
      { to: "/dashboard/dock", label: "Dock" },
      { to: "/dashboard/weighbridge", label: "Weighbridge" },
      { to: "/dashboard/ocr-review", label: "OCR" },
      { to: "/dashboard/tasks", label: "Tasks" },
      { to: "/dashboard/analytics", label: "Analytics" },
      { to: "/dashboard/aiops", label: "AI Ops" },
      { to: "/dashboard/admin", label: "Admin" },
    ];
    return allNav.filter((n) => canAccess(n.to, roles));
  }, [roles]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          ● Authenticating…
        </div>
      </div>
    );
  }

  const roleLabel = roles.length ? roles.join(" · ") : "no role";

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-50 border-b-2 border-ink bg-background">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-6 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="YardMaster Logo" className="h-6 w-6 object-contain" />
            <span className="font-display text-lg tracking-tight">YARDMASTER</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => {
              const active = location.pathname === n.to;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-3 py-2 font-mono text-[10px] uppercase tracking-widest transition ${
                    active ? "bg-ink text-background" : "hover:bg-paper"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right md:block">
              <div className="font-mono text-xs">{user.email}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
                {roleLabel}
              </div>
            </div>
            <button
              onClick={() => void signOut().then(() => navigate({ to: "/" }))}
              className="border-2 border-ink px-3 py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-ink hover:text-background"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
