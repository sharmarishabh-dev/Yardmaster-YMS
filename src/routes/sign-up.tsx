import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/auth/AuthProvider";
import {
  AuthShell,
  FieldLabel,
  TextField,
  PrimaryButton,
  SecondaryButton,
} from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";

export const Route = createFileRoute("/sign-up")({
  head: () => ({
    meta: [{ title: "Create account — YardMaster" }],
  }),
  component: SignUpPage,
});

const ROLES = [
  { id: "admin", label: "Admin", desc: "Full system control" },
  { id: "operator", label: "Operator", desc: "Gate, yard, dock" },
  { id: "driver", label: "Driver", desc: "Execute moves" },
] as const;

type RoleId = (typeof ROLES)[number]["id"];

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(100),
  companyName: z.string().trim().min(2, "Company is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Min 8 characters").max(128),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  role: z.enum(["admin", "operator", "driver"]),
});

function SignUpPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleId>("operator");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [user, loading, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ fullName, companyName, email, password, phone, role });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: parsed.data.fullName,
          company_name: parsed.data.companyName,
          phone: parsed.data.phone || null,
          role: parsed.data.role,
        },
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(
        error.message.toLowerCase().includes("registered")
          ? "That email is already registered. Try signing in."
          : error.message,
      );
      return;
    }
    toast.success("Account created. Welcome to YardMaster.");
    navigate({ to: "/dashboard" });
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      toast.error(error.message ?? "Google sign-in failed.");
    }
  };

  return (
    <AuthShell
      title="Spin up your yard."
      subtitle="One account. Every module unlocked."
      footer={
        <span className="text-muted-foreground">
          Already have an account?{" "}
          <Link to="/sign-in" className="text-ink underline underline-offset-4 hover:text-hazard">
            Sign in →
          </Link>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Full name</FieldLabel>
            <TextField required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Anita Kowalski" />
          </div>
          <div>
            <FieldLabel>Company</FieldLabel>
            <TextField required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Northbound Logistics" />
          </div>
        </div>
        <div>
          <FieldLabel>Email</FieldLabel>
          <TextField type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yard.co" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Phone (optional)</FieldLabel>
            <TextField type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
          </div>
          <div>
            <FieldLabel>Password</FieldLabel>
            <PasswordField
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
        </div>
        <div>
          <FieldLabel>Your role</FieldLabel>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={`border-2 border-ink p-3 text-left transition ${
                  role === r.id ? "bg-ink text-background" : "bg-background hover:bg-paper"
                }`}
              >
                <div className="font-display text-base tracking-tight">{r.label}</div>
                <div
                  className={`mt-1 font-mono text-[10px] uppercase tracking-widest ${
                    role === r.id ? "text-hazard" : "text-muted-foreground"
                  }`}
                >
                  {r.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account →"}
        </PrimaryButton>
        <div className="relative my-2 text-center">
          <span className="absolute left-0 right-0 top-1/2 -z-10 h-px bg-ink" />
          <span className="bg-paper px-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            or
          </span>
        </div>
        <SecondaryButton onClick={google}>Continue with Google</SecondaryButton>
      </form>
    </AuthShell>
  );
}
