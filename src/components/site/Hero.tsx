import yardHero from "@/assets/yard-hero.jpg";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink bg-paper">
      <div className="grid-paper absolute inset-0 opacity-100" />
      <div className="relative mx-auto grid max-w-[1400px] gap-12 px-6 py-20 lg:grid-cols-12 lg:py-28">
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-3 border-2 border-ink bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hazard" />
            Yard Management System · v1.0
          </div>
          <h1 className="font-display mt-8 text-[clamp(3rem,8vw,7rem)] leading-[0.9] tracking-tighter">
            Master your
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">yard</span>
              <span className="absolute -bottom-1 left-0 right-0 z-0 h-3 bg-hazard" />
            </span>{" "}
            in
            <br />
            real-time.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Full visibility from gate to dock. AI-powered scheduling. Zero coordination overhead.
            YardMaster runs the operational control tower for modern logistics yards.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <button className="group flex items-center gap-3 bg-ink px-6 py-4 font-mono text-xs uppercase tracking-widest text-background transition hover:bg-hazard hover:text-ink">
              Get started
              <span className="transition group-hover:translate-x-1">→</span>
            </button>
            <button className="border-2 border-ink px-6 py-4 font-mono text-xs uppercase tracking-widest hover:bg-ink hover:text-background">
              Request demo
            </button>
          </div>
          <dl className="mt-14 grid max-w-lg grid-cols-3 gap-6 border-t-2 border-ink pt-6">
            {[
              { k: "−42%", v: "Dwell time" },
              { k: "+38%", v: "Dock utilization" },
              { k: "<2s", v: "Live updates" },
            ].map((s) => (
              <div key={s.v}>
                <dt className="font-display text-3xl">{s.k}</dt>
                <dd className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="lg:col-span-5">
          <div className="relative border-2 border-ink bg-ink">
            <div className="absolute -top-3 left-4 z-10 bg-hazard px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink">
              ● Live · Yard 01
            </div>
            <div className="relative aspect-[4/5] overflow-hidden">
              <img
                src={yardHero}
                alt="Aerial view of a logistics yard with dozens of trailers parked in a grid"
                width={1920}
                height={1080}
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan bg-hazard shadow-[0_0_20px_var(--color-hazard)]" />
              <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-widest text-background">
                <div className="border border-background/30 bg-ink/70 p-2 backdrop-blur">
                  <div className="text-background/50">Trailers</div>
                  <div className="mt-1 font-display text-xl normal-case tracking-normal">247</div>
                </div>
                <div className="border border-background/30 bg-ink/70 p-2 backdrop-blur">
                  <div className="text-background/50">Avg dwell</div>
                  <div className="mt-1 font-display text-xl normal-case tracking-normal">1h 12m</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="ticker-mask relative overflow-hidden border-t-2 border-ink bg-ink py-3">
        <div className="animate-ticker flex w-max whitespace-nowrap font-mono text-xs uppercase tracking-widest text-background">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="flex shrink-0">
              {[
                "Gate 03 · Trailer T-4421 cleared",
                "Dock 12 · Live unloading",
                "Driver J. Ortiz · Move complete",
                "Yard B · 87% capacity",
                "Appt #29841 · On time",
                "AI · Suggested re-spot D-07 → D-04",
              ].map((t) => (
                <span key={t} className="mx-8 inline-flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-hazard" />
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
