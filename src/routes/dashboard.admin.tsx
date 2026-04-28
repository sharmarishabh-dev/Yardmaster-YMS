import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/auth/AuthProvider";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/admin")({
  head: () => ({ meta: [{ title: "Admin · Users & Roles — YardMaster" }] }),
  component: AdminUsersPage,
});

const ALL_ROLES: AppRole[] = ["admin", "operator", "driver"];

const ROLE_STYLE: Record<AppRole, string> = {
  admin: "bg-hazard text-ink",
  operator: "bg-ink text-background",
  driver: "border-2 border-ink text-ink",
};

interface ProfileRow {
  id: string;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  created_at: string;
}

interface RoleRow {
  id: string;
  user_id: string;
  role: AppRole;
}

function AdminUsersPage() {
  const { user, roles } = useAuth();
  const isAdmin = roles.includes("admin");

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | AppRole | "none">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const [profQ, roleQ] = await Promise.all([
        supabase.from("profiles").select("id, full_name, company_name, phone, created_at").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("id, user_id, role"),
      ]);
      if (profQ.error) toast.error(profQ.error.message);
      if (roleQ.error) toast.error(roleQ.error.message);
      setProfiles((profQ.data ?? []) as ProfileRow[]);
      setRoleRows((roleQ.data ?? []) as RoleRow[]);
    };
    void load();

    const ch = supabase
      .channel("admin-users-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [isAdmin]);

  const rolesByUser = useMemo(() => {
    const m = new Map<string, AppRole[]>();
    for (const r of roleRows) {
      const arr = m.get(r.user_id) ?? [];
      arr.push(r.role);
      m.set(r.user_id, arr);
    }
    return m;
  }, [roleRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      const userRoles = rolesByUser.get(p.id) ?? [];
      if (filterRole === "none" && userRoles.length > 0) return false;
      if (filterRole !== "all" && filterRole !== "none" && !userRoles.includes(filterRole)) return false;
      if (!q) return true;
      const hay = `${p.full_name ?? ""} ${p.company_name ?? ""} ${p.phone ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, rolesByUser, search, filterRole]);

  const counts = useMemo(() => {
    const c = { admin: 0, operator: 0, driver: 0 };
    roleRows.forEach((r) => {
      c[r.role]++;
    });
    return c;
  }, [roleRows]);

  const toggleRole = async (userId: string, role: AppRole, currentlyHas: boolean) => {
    if (userId === user?.id && role === "admin" && currentlyHas) {
      // Prevent demoting yourself out of admin
      const adminCount = roleRows.filter((r) => r.role === "admin").length;
      if (adminCount <= 1) {
        toast.error("You are the last admin — cannot remove your own admin role");
        return;
      }
      if (!confirm("Remove your own admin role? You will lose admin access.")) return;
    }
    setBusyId(`${userId}:${role}`);
    if (currentlyHas) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) toast.error(error.message);
      else toast.success(`Removed ${role}`);
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (error) toast.error(error.message);
      else toast.success(`Granted ${role}`);
    }
    setBusyId(null);
  };

  if (!isAdmin) {
    return (
      <div className="border-2 border-ink p-8">
        <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">● Restricted</div>
        <h1 className="font-display mt-2 text-2xl">Admin only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need the admin role to manage users.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">Module · Admin</div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">Users & Roles</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Grant or revoke admin / operator / driver access. Users sign up themselves at /sign-up — assign them a role here.
          </p>
        </div>
        <dl className="grid grid-cols-4 gap-px bg-ink">
          <Stat k={profiles.length} v="Users" />
          <Stat k={counts.admin} v="Admins" tone="hazard" />
          <Stat k={counts.operator} v="Operators" />
          <Stat k={counts.driver} v="Drivers" />
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, phone…"
          className="flex-1 min-w-[240px] border-2 border-ink bg-background px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex border-2 border-ink">
          {(["all", "admin", "operator", "driver", "none"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilterRole(r)}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                filterRole === r ? "bg-ink text-background" : "hover:bg-paper"
              }`}
            >
              {r === "none" ? "No role" : r}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto border-2 border-ink">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-paper">
            <tr className="text-left">
              <Th>User</Th>
              <Th>Phone</Th>
              <Th>Joined</Th>
              <Th>Current roles</Th>
              <Th className="text-right">Toggle role</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  No users match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const userRoles = rolesByUser.get(p.id) ?? [];
                const isSelf = p.id === user?.id;
                return (
                  <tr key={p.id} className="border-t-2 border-ink align-top">
                    <td className="p-3">
                      <div className="font-medium">
                        {p.full_name || <span className="text-muted-foreground">Unnamed</span>}
                        {isSelf && (
                          <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-hazard">
                            you
                          </span>
                        )}
                      </div>
                      {p.company_name && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{p.company_name}</div>
                      )}
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.id}</div>
                    </td>
                    <td className="p-3 font-mono text-xs">{p.phone || "—"}</td>
                    <td className="p-3 font-mono text-xs">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {userRoles.length === 0 ? (
                          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            none
                          </span>
                        ) : (
                          userRoles.map((r) => (
                            <span
                              key={r}
                              className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${ROLE_STYLE[r]}`}
                            >
                              {r}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {ALL_ROLES.map((r) => {
                          const has = userRoles.includes(r);
                          const busy = busyId === `${p.id}:${r}`;
                          return (
                            <button
                              key={r}
                              disabled={busy}
                              onClick={() => void toggleRole(p.id, r, has)}
                              className={`border-2 border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition disabled:opacity-50 ${
                                has ? "bg-ink text-background hover:bg-hazard hover:text-ink" : "hover:bg-ink hover:text-background"
                              }`}
                              title={has ? `Remove ${r}` : `Grant ${r}`}
                            >
                              {has ? `− ${r}` : `+ ${r}`}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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
