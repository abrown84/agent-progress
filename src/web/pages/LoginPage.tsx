import { useState } from "react";
import { login } from "../api";

interface Props {
  onGo: (r: "landing" | "login" | "signup" | "dashboard") => void;
  allowSignups: boolean;
}

export function LoginPage({ onGo, allowSignups }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      onGo("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Sign in" onBack={() => onGo("landing")}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="text-overlay-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2 text-overlay-text"
          />
        </label>
        <label className="block text-sm">
          <span className="text-overlay-muted">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2 text-overlay-text"
          />
        </label>
        {error && <p className="text-sm text-overlay-error">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-overlay-accent py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {allowSignups && (
        <p className="mt-4 text-center text-sm text-overlay-muted">
          No account?{" "}
          <button className="text-overlay-accent" onClick={() => onGo("signup")}>
            Sign up
          </button>
        </p>
      )}
    </AuthShell>
  );
}

export function AuthShell({
  title,
  children,
  onBack,
}: {
  title: string;
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="web-hero-bg min-h-screen text-overlay-text flex flex-col">
      <div className="mx-auto w-full max-w-md px-5 py-16">
        <button onClick={onBack} className="text-sm text-overlay-muted hover:text-overlay-text">
          ← Agent Progress
        </button>
        <h1 className="font-display mt-6 text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-overlay-muted">Built by Brown Industries</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
