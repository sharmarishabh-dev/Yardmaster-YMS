const tiers = [
  {
    name: "Starter",
    price: "$1,200",
    sub: "/ yard / month",
    blurb: "Small operations getting their first taste of real visibility.",
    items: ["1 yard", "Up to 200 daily moves", "Gate + Dock scheduler", "Driver mobile app", "Email support"],
    featured: false,
  },
  {
    name: "Pro",
    price: "$3,800",
    sub: "/ yard / month",
    blurb: "Multi-shift operations that need AI optimization and integrations.",
    items: ["Up to 5 yards", "Unlimited moves", "AI dock allocation", "WMS / TMS / ERP integrations", "Priority support · 4hr SLA"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "annual contract",
    blurb: "Networks of yards with custom workflows and on-prem requirements.",
    items: ["Unlimited yards", "Digital twin simulation", "Dedicated CSM", "Custom AI models", "On-prem / VPC deploy"],
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-b-2 border-ink bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-24">
        <div className="grid gap-8 border-b-2 border-ink pb-12 md:grid-cols-2 md:items-end">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              § 05 · Pricing
            </div>
            <h2 className="font-display mt-4 text-5xl tracking-tighter md:text-6xl">
              No per-seat tax.
              <br />
              Pay per yard.
            </h2>
          </div>
          <p className="text-lg text-muted-foreground md:max-w-md md:justify-self-end">
            Every plan ships the full module suite. You're paying for scale and support, not features behind a paywall.
          </p>
        </div>

        <div className="mt-12 grid gap-0 border-2 border-ink md:grid-cols-3">
          {tiers.map((t, i) => (
            <article
              key={t.name}
              className={`flex flex-col p-8 ${i < tiers.length - 1 ? "md:border-r-2 md:border-ink" : ""} ${
                t.featured ? "bg-ink text-background" : "bg-background"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl tracking-tight">{t.name}</h3>
                {t.featured && (
                  <span className="bg-hazard px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink">
                    ★ Most picked
                  </span>
                )}
              </div>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-5xl tracking-tighter">{t.price}</span>
                <span className={`font-mono text-[10px] uppercase tracking-widest ${t.featured ? "text-background/60" : "text-muted-foreground"}`}>
                  {t.sub}
                </span>
              </div>
              <p className={`mt-4 text-sm ${t.featured ? "text-background/70" : "text-muted-foreground"}`}>
                {t.blurb}
              </p>
              <ul className="mt-8 flex-1 space-y-3 text-sm">
                {t.items.map((it) => (
                  <li key={it} className="flex items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-hazard" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
              <button
                className={`mt-10 w-full px-6 py-4 font-mono text-xs uppercase tracking-widest transition ${
                  t.featured
                    ? "bg-hazard text-ink hover:bg-background hover:text-ink"
                    : "border-2 border-ink hover:bg-ink hover:text-background"
                }`}
              >
                {t.name === "Enterprise" ? "Talk to sales" : "Start trial"}
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
