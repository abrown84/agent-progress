import { useState } from "react";
import { signup } from "../api";
import { AuthShell } from "./LoginPage";

interface Props {
  onGo: (r: "landing" | "login" | "signup" | "dashboard") => void;
  allowSignups: boolean;
}

export function SignupPage({ onGo, allowSignups }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!allowSignups) {
    return (
      <AuthShell title="Signups disabled" onBack={() => onGo("landing")}>
        <p className="text-sm text-overlay-muted">
          Public registration is turned off. Ask your admin to seed an owner account, or
          set <code className="text-overlay-accent">ALLOW_SIGNUPS=true</code>.
        </p>
        <button
          className="mt-4 text-sm text-overlay-accent"
          onClick={() => onGo("login")}
        >
          Sign in instead
        </button>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signup({
        email,
        password,
        name: name || undefined,
        workspaceName: workspaceName || undefined,
      });
      onGo("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create account" onBack={() => onGo("landing")}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="text-overlay-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-overlay-muted">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-overlay-muted">Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-overlay-muted">Workspace name (optional)</span>
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="mt-1 w-full rounded border border-overlay-border bg-overlay-card px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-overlay-error">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-overlay-accent py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
