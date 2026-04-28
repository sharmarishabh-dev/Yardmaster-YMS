const quotes = [
  {
    q: "We cut driver wait time by 40% in the first month. The AI dock allocation alone paid for the platform.",
    n: "Marisol Rentería",
    r: "VP Operations · Northbound Logistics",
  },
  {
    q: "Three yards, one screen. I finally know what's actually happening without calling six people.",
    n: "Derek Mwangi",
    r: "Yard Director · Cargo One",
  },
  {
    q: "The driver app changed everything. Jockeys know exactly what's next and we stopped losing trailers.",
    n: "Anita Kowalski",
    r: "Site Manager · Midland DC",
  },
];

export function Testimonials() {
  return (
    <section className="border-b-2 border-ink bg-paper">
      <div className="mx-auto max-w-[1400px] px-6 py-24">
        <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
          § 04 · Field reports
        </div>
        <h2 className="font-display mt-4 max-w-3xl text-5xl tracking-tighter md:text-6xl">
          Operators who stopped firefighting.
        </h2>

        <div className="mt-16 grid gap-0 border-2 border-ink md:grid-cols-3">
          {quotes.map((t, i) => (
            <figure
              key={t.n}
              className={`flex flex-col bg-background p-8 ${i < quotes.length - 1 ? "md:border-r-2 md:border-ink" : ""}`}
            >
              <div className="font-display text-5xl leading-none text-hazard">"</div>
              <blockquote className="mt-4 flex-1 text-base leading-relaxed">{t.q}</blockquote>
              <figcaption className="mt-8 border-t-2 border-ink pt-4">
                <div className="font-display text-base tracking-tight">{t.n}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t.r}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
