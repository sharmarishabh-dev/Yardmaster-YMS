const features = [
  {
    no: "01",
    title: "Gate Automation",
    body: "License plate + trailer OCR, appointment validation, and an entry decision engine that opens the gate without humans in the loop.",
  },
  {
    no: "02",
    title: "Dock Scheduling",
    body: "Smart slot booking, SLA-based prioritization, and real-time conflict resolution. Drag, drop, done.",
  },
  {
    no: "03",
    title: "Yard Intelligence",
    body: "Slot-level trailer tracking, congestion heatmaps, and predictive positioning that anticipates the next move.",
  },
  {
    no: "04",
    title: "Task Orchestration",
    body: "Dynamic driver assignment with route optimization. Every yard move tracked from creation to completion.",
  },
  {
    no: "05",
    title: "Driver & Carrier Portal",
    body: "Self-service appointments, QR-based check-in, kiosk mode, and real-time SMS notifications.",
  },
  {
    no: "06",
    title: "Plug-and-Play APIs",
    body: "REST, webhooks, and event streaming. Wire YardMaster into your WMS, TMS, or ERP in an afternoon.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b-2 border-ink bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-24">
        <div className="grid gap-8 border-b-2 border-ink pb-12 md:grid-cols-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
              § 02 · Capabilities
            </div>
            <h2 className="font-display mt-4 text-5xl tracking-tighter md:text-6xl">
              Six engines.
              <br />
              One control tower.
            </h2>
          </div>
          <p className="self-end text-lg text-muted-foreground md:max-w-md md:justify-self-end">
            Every module ships on day one. No phased rollouts, no "coming soon" features, no half-built dashboards.
          </p>
        </div>

        <div className="grid border-l-2 border-ink md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.no}
              className="group relative border-b-2 border-r-2 border-ink p-8 transition hover:bg-ink hover:text-background"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-hazard">
                {f.no}
              </div>
              <h3 className="font-display mt-6 text-2xl tracking-tight">{f.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground group-hover:text-background/70">
                {f.body}
              </p>
              <div className="mt-8 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                Learn more <span className="transition group-hover:translate-x-1">→</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
