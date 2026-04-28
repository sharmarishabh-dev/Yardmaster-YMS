export function CTA() {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink bg-background">
      <div className="hazard-stripe absolute inset-x-0 top-0 h-3" />
      <div className="mx-auto max-w-[1400px] px-6 py-24 text-center">
        <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
          § 06 · Move in
        </div>
        <h2 className="font-display mx-auto mt-6 max-w-4xl text-[clamp(3rem,7vw,6rem)] leading-[0.9] tracking-tighter">
          Stop coordinating.
          <br />
          Start <span className="bg-ink px-3 text-background">operating</span>.
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">
          Spin up your first yard in under an hour. Bring your team, your trucks, and your appointments — we handle the rest.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <button className="bg-ink px-8 py-4 font-mono text-xs uppercase tracking-widest text-background hover:bg-hazard hover:text-ink">
            Get started →
          </button>
          <button className="border-2 border-ink px-8 py-4 font-mono text-xs uppercase tracking-widest hover:bg-ink hover:text-background">
            Book a demo
          </button>
        </div>
      </div>
      <div className="hazard-stripe absolute inset-x-0 bottom-0 h-3" />
    </section>
  );
}
