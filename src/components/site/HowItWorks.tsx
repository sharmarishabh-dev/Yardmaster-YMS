import dockDetail from "@/assets/dock-detail.jpg";

const steps = [
  { n: "01", t: "Truck arrives", d: "OCR captures plate and trailer ID at the gate." },
  { n: "02", t: "System verifies", d: "Appointment matched, SLA checked, decision in <2s." },
  { n: "03", t: "Dock assigned", d: "AI picks the optimal door based on load, dwell, and crew." },
  { n: "04", t: "Driver executes", d: "Yard jockey gets the move on their phone with the route." },
  { n: "05", t: "Truck departs", d: "Gate auto-clears. Movement logged. Analytics updated." },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden border-b-2 border-ink bg-ink text-background">
      <div className="mx-auto grid max-w-[1400px] gap-16 px-6 py-24 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-hazard">
            § 03 · Workflow
          </div>
          <h2 className="font-display mt-4 text-5xl tracking-tighter md:text-6xl">
            From gate to gone, in five moves.
          </h2>
          <div className="relative mt-10 border-2 border-background/20">
            <img
              src={dockDetail}
              alt="Industrial trailer at a loading dock with orange accent lighting"
              width={1280}
              height={1280}
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 hazard-stripe h-3" />
          </div>
        </div>

        <ol className="lg:col-span-7">
          {steps.map((s, i) => (
            <li
              key={s.n}
              className="grid grid-cols-[auto_1fr] gap-8 border-t border-background/20 py-8 first:border-t-0 first:pt-0"
            >
              <div className="font-display text-5xl text-hazard md:text-6xl">{s.n}</div>
              <div className="self-center">
                <h3 className="font-display text-2xl tracking-tight">{s.t}</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-background/60">{s.d}</p>
              </div>
              {i === steps.length - 1 && (
                <div className="col-span-2 mt-2 font-mono text-[10px] uppercase tracking-widest text-background/40">
                  ← end of cycle · loop continues
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
