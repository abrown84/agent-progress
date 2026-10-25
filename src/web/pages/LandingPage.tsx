interface Props {
  onGo: (r: "landing" | "login" | "signup" | "dashboard") => void;
  allowSignups: boolean;
}

export function LandingPage({ onGo, allowSignups }: Props) {
  return (
    <div className="web-hero-bg min-h-screen text-overlay-text relative overflow-hidden">
      <div className="web-grid absolute inset-0 pointer-events-none" />

      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-5 py-6">
        <div className="font-display text-2xl tracking-tight">Agent Progress</div>
        <nav className="flex items-center gap-3 text-sm">
          <button
            onClick={() => onGo("login")}
            className="text-overlay-muted hover:text-overlay-text transition-colors"
          >
            Sign in
          </button>
          {allowSignups && (
            <button
              onClick={() => onGo("signup")}
              className="rounded bg-overlay-accent px-3 py-1.5 font-medium text-slate-950 hover:bg-amber-400 transition-colors"
            >
              Sign up
            </button>
          )}
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-20 pt-10 md:pt-20">
        <p className="animate-fade-up text-sm uppercase tracking-[0.2em] text-overlay-accent">
          Brown Industries
        </p>
        <h1 className="animate-fade-up-delay font-display mt-3 max-w-3xl text-5xl leading-[1.05] md:text-7xl">
          Watch every agent work — locally or in the cloud.
        </h1>
        <p className="animate-fade-up-delay-2 mt-5 max-w-xl text-base text-overlay-muted md:text-lg">
          Live tasks, todos, and errors from Claude Code, Cursor Cloud, Grok bots, and
          anything that can POST JSON. Zero AI tokens in the app itself.
        </p>
        <div className="animate-fade-up-delay-2 mt-8 flex flex-wrap gap-3">
          <button
            onClick={() => onGo("dashboard")}
            className="rounded bg-overlay-accent px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
          >
            Open dashboard
          </button>
          <button
            onClick={() => onGo("login")}
            className="rounded border border-overlay-border px-5 py-2.5 text-sm text-overlay-text hover:bg-overlay-card transition-colors"
          >
            Sign in
          </button>
        </div>

        <section className="mt-20 grid gap-8 md:grid-cols-3">
          {[
            {
              title: "Agent write tokens",
              body: "Agents POST events with a workspace write token. Same shapes as ~/.claude JSONL.",
            },
            {
              title: "Live SSE dashboards",
              body: "Browsers and the desktop overlay subscribe to /api/events/stream for instant updates.",
            },
            {
              title: "Self-host ready",
              body: "Docker + SQLite. Deploy behind nginx at progress.brwnindustries.com.",
            },
          ].map((card) => (
            <div key={card.title} className="border-t border-overlay-border pt-4">
              <h2 className="text-sm font-semibold text-overlay-text">{card.title}</h2>
              <p className="mt-2 text-sm text-overlay-muted">{card.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-10 border-t border-overlay-border/60 px-5 py-6 text-center text-xs text-overlay-muted">
        Built by{" "}
        <a
          className="text-overlay-accent hover:underline"
          href="https://brwnindustries.com"
          target="_blank"
          rel="noreferrer"
        >
          Brown Industries
        </a>
      </footer>
    </div>
  );
}
