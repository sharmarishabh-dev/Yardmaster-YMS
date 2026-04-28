import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="hazard-stripe h-7 w-7" />
            <span className="font-display text-xl tracking-tight">YARDMASTER</span>
          </Link>
          <Link
            to="/"
            className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ink"
          >
            ← back to site
          </Link>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-65px)] lg:grid-cols-2">
        <div className="grid-paper relative flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              § Authenticate
            </div>
            <h1 className="font-display mt-4 text-5xl leading-[0.95] tracking-tighter">{title}</h1>
            <p className="mt-3 text-base text-muted-foreground">{subtitle}</p>
            <div className="mt-10">{children}</div>
            <div className="mt-8 border-t-2 border-ink pt-6 font-mono text-xs">{footer}</div>
          </div>
        </div>
        <aside className="hidden bg-ink p-12 text-background lg:block">
          <div className="flex h-full flex-col justify-between">
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              ● Live · Yard 01 · 247 trailers
            </div>
            <div>
              <div className="hazard-stripe h-3 w-24" />
              <p className="font-display mt-8 text-4xl leading-[0.95] tracking-tighter">
                "We finally know what's actually happening on the ground — without calling six people."
              </p>
              <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-background/60">
                Derek Mwangi · Yard Director · Cargo One
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-6 border-t border-background/20 pt-6">
              {[
                ["−42%", "Dwell time"],
                ["+38%", "Dock util."],
                ["<2s", "Updates"],
              ].map(([k, v]) => (
                <div key={v}>
                  <dt className="font-display text-2xl">{k}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-widest text-background/60">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </main>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {children}
    </label>
  );
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 block w-full border-2 border-ink bg-background px-4 py-3 font-mono text-sm outline-none focus:bg-paper focus:ring-2 focus:ring-hazard ${props.className ?? ""}`}
    />
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`group flex w-full items-center justify-center gap-3 bg-ink px-6 py-4 font-mono text-xs uppercase tracking-widest text-background transition hover:bg-hazard hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex w-full items-center justify-center gap-3 border-2 border-ink bg-background px-6 py-4 font-mono text-xs uppercase tracking-widest hover:bg-ink hover:text-background disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}
