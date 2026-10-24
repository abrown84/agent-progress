const API_BASE = "";

export async function getPublicConfig(): Promise<{
  allowSignups: boolean;
  branding: { name: string; byline: string; url: string };
}> {
  const res = await fetch(`${API_BASE}/api/config/public`);
  if (!res.ok) {
    return {
      allowSignups: false,
      branding: {
        name: "Agent Progress",
        byline: "Built by Brown Industries",
        url: "https://brwnindustries.com",
      },
    };
  }
  return res.json();
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data;
}

export async function signup(payload: {
  email: string;
  password: string;
  name?: string;
  workspaceName?: string;
}) {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Signup failed");
  return data;
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function me() {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  return res.json();
}

export async function listWorkspaces() {
  const res = await fetch(`${API_BASE}/api/workspaces`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load workspaces");
  return res.json();
}

export async function createToken(
  workspaceId: string,
  kind: "read" | "write",
  name: string
) {
  const res = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ kind, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create token");
  return data as { secret: string; token: { id: string; kind: string; name: string } };
}
