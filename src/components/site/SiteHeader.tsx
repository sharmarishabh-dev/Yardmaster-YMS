import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="YardMaster Logo" style={{height: '40px', width: 'auto', display: 'block', flexShrink: 0}} />
          <span className="font-display text-xl tracking-tight uppercase">YARDMASTER</span>
        </Link>
        <nav className="hidden items-center gap-8 font-mono text-xs uppercase tracking-widest md:flex">
          <a href="#features" className="hover:text-hazard">Features</a>
          <a href="#how" className="hover:text-hazard">How it works</a>
          <a href="#pricing" className="hover:text-hazard">Pricing</a>
          <a href="#docs" className="hover:text-hazard">Docs</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/sign-in"
            className="hidden border-2 border-ink px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-ink hover:text-background sm:block"
          >
            Sign in
          </Link>
          <Link
            to="/sign-up"
            className="bg-ink px-4 py-2 font-mono text-xs uppercase tracking-widest text-background hover:bg-hazard hover:text-ink"
          >
            Get started →
          </Link>
        </div>
      </div>
    </header>
  );
}
