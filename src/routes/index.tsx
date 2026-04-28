import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Hero } from "@/components/site/Hero";
import { Features } from "@/components/site/Features";
import { HowItWorks } from "@/components/site/HowItWorks";
import { Testimonials } from "@/components/site/Testimonials";
import { Pricing } from "@/components/site/Pricing";
import { CTA } from "@/components/site/CTA";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YardMaster — Total Yard Control. Real-Time Intelligence." },
      {
        name: "description",
        content:
          "The operational control tower for yard logistics. Gate automation, real-time yard visibility, AI dock scheduling, and task orchestration in one platform.",
      },
      { property: "og:title", content: "YardMaster — Total Yard Control" },
      {
        property: "og:description",
        content: "Real-time visibility, AI scheduling, zero coordination overhead.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Testimonials />
        <Pricing />
        <CTA />
      </main>
      <SiteFooter />
    </div>
  );
}
