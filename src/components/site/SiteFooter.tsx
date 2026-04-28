export function SiteFooter() {
  return (
    <footer className="border-t-2 border-ink bg-ink text-background">
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <div className="grid gap-12 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3">
              <div className="hazard-stripe h-7 w-7" />
              <span className="font-display text-xl">YARDMASTER</span>
            </div>
            <p className="mt-4 max-w-sm text-sm text-background/60">
              Operational control tower for yard logistics. Built for operators who refuse to wait.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 border border-background/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-background/70">
              <span className="h-1.5 w-1.5 rounded-full bg-hazard" /> All systems operational
            </div>
          </div>
          {[
            { title: "Product", items: ["Gate", "Yard Map", "Dock Scheduler", "Driver App"] },
            { title: "Developers", items: ["API", "Webhooks", "Docs", "Status"] },
            { title: "Company", items: ["About", "Contact", "Privacy", "Terms"] },
          ].map((col) => (
            <div key={col.title}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">{col.title}</div>
              <ul className="mt-4 space-y-2 text-sm">
                {col.items.map((i) => (
                  <li key={i}><a href="#" className="hover:text-hazard">{i}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-background/20 pt-6 font-mono text-[10px] uppercase tracking-widest text-background/50 md:flex-row">
          <span>© 2026 YardMaster Systems</span>
          <span>v1.0 · Built for the yard</span>
        </div>
      </div>
    </footer>
  );
}
