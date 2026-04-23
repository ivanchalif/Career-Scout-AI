import { Link } from "wouter";
import { Radar, BarChart3, Mail, Zap, ArrowRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Mail,
    title: "Gmail Monitoring",
    description: "Automatically detects job postings from your inbox — no manual copy-pasting.",
  },
  {
    icon: Zap,
    title: "AI Fit Scoring",
    description: "Every opportunity scored 0–100 against your skills, experience, and salary expectations.",
  },
  {
    icon: BarChart3,
    title: "Ranked Dashboard",
    description: "Your best matches surface at the top. Instantly see which roles deserve your attention.",
  },
];

const steps = [
  "Create your career profile — skills, experience, target salary",
  "Connect your Gmail inbox (coming soon)",
  "Career Scout scores every job posting automatically",
  "Review your ranked matches and apply to the best ones",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col" data-testid="landing-page">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20">
            <Radar className="w-5 h-5 text-indigo-400" />
          </div>
          <span className="font-semibold text-foreground tracking-tight">Career Scout</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm" data-testid="nav-sign-in">
              Sign in
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500" data-testid="nav-sign-up">
              Get started
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-6">
          <Radar className="w-3.5 h-3.5" />
          AI-powered job intelligence
        </div>
        <h1 className="text-4xl md:text-6xl font-bold text-foreground max-w-3xl leading-tight">
          Never miss the right{" "}
          <span className="text-indigo-400">opportunity</span> again
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
          Career Scout monitors your inbox, parses job postings with AI, and ranks them against
          your profile — so you focus on the roles that actually fit.
        </p>
        <div className="flex items-center gap-4 mt-8">
          <Link href="/sign-up">
            <Button
              size="lg"
              className="bg-indigo-600 hover:bg-indigo-500 gap-2"
              data-testid="hero-cta"
            >
              Start for free
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button variant="outline" size="lg" data-testid="hero-sign-in">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 md:px-12 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="bg-card border border-border rounded-xl p-6"
                  data-testid={`feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-600/15 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 md:px-12 pb-24 border-t border-border pt-16">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-foreground mb-10">How it works</h2>
          <div className="flex flex-col gap-4 text-left">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="bg-indigo-600 hover:bg-indigo-500"
                data-testid="bottom-cta"
              >
                Get started free
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        Career Scout — AI-powered job matching
      </footer>
    </div>
  );
}
