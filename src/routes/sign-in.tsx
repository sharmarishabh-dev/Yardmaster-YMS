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

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [{ title: "Sign in — YardMaster" }],
  }),
  component: SignInPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Min 6 characters").max(128),
});

function SignInPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [user, loading, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setSubmitting(false);
    if (error) {
      toast.error(error.message.includes("Invalid") ? "Wrong email or password." : error.message);
      return;
    }
    toast.success("Welcome back.");
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
      title="Sign in to your yard."
      subtitle="Operators, drivers, and admins all enter here."
      footer={
        <span className="text-muted-foreground">
          New to YardMaster?{" "}
          <Link to="/sign-up" className="text-ink underline underline-offset-4 hover:text-hazard">
            Create an account →
          </Link>
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <FieldLabel>Email</FieldLabel>
          <TextField
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yard.co"
          />
        </div>
        <div>
          <FieldLabel>Password</FieldLabel>
          <PasswordField
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <PrimaryButton type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in →"}
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
