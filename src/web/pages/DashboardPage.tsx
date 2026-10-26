import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { TaskList } from "../../components/tasks/TaskList";
import { TodoSection } from "../../components/todos/TodoSection";
import { useTaskStore } from "../../stores/taskStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { initProgressTransport } from "../../transport/bootstrap";
import { createToken, listWorkspaces, logout, me } from "../api";
import {
  currentSubscription,
  disablePush,
  enablePush,
  fetchPushStatus,
  pushSupported,
  sendTestPush,
  updateNotifyPrefs,
  type PushStatus,
} from "../push";

interface Props {
  onGo: (r: "landing" | "login" | "signup" | "dashboard") => void;
}

const TOKEN_KEY = "ap-web-read-token";
const URL_KEY = "ap-web-base-url";
const WRITE_TOKEN_KEY = "ap-web-write-token";

function readBootstrapFromLocation(): { baseUrl?: string; readToken?: string; autoConnect?: boolean } {
  try {
    const hash = window.location.hash; // e.g. #/dashboard?token=apr_…
    const qIndex = hash.indexOf("?");
    const params = new URLSearchParams(
      qIndex >= 0 ? hash.slice(qIndex + 1) : window.location.search
    );
    const token = params.get("token") || undefined;
    const base = params.get("base") || undefined;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      if (base) localStorage.setItem(URL_KEY, base);
    }
    return { baseUrl: base || undefined, readToken: token, autoConnect: Boolean(token) };
  } catch {
    return {};
  }
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-overlay-muted">{label}</span>
        <button
          type="button"
          className="text-[11px] text-overlay-accent hover:underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* ignore */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="mt-1 block break-all rounded bg-overlay-bg px-2 py-1.5 text-[11px] text-overlay-text">
        {value}
      </code>
    </div>
  );
}

export function DashboardPage({ onGo }: Props) {
  const boot = readBootstrapFromLocation();
  const [baseUrl, setBaseUrl] = useState(
    () => boot.baseUrl || localStorage.getItem(URL_KEY) || window.location.origin
  );
  const [readToken, setReadToken] = useState(
    () => boot.readToken || localStorage.getItem(TOKEN_KEY) || ""
  );
  const [writeToken, setWriteToken] = useState(
    () => sessionStorage.getItem(WRITE_TOKEN_KEY) || ""
  );
  const [connected, setConnected] = useState(
    () => Boolean(boot.autoConnect) || Boolean(localStorage.getItem(TOKEN_KEY))
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);

  const { activeTasks, completedTasks, agents, errors, connectionStatus } =
    useTaskStore(
      useShallow((s) => ({
        activeTasks: s.activeTasks,
        completedTasks: s.completedTasks,
        agents: s.agents,
        errors: s.errors,
        connectionStatus: s.connectionStatus,
      }))
    );
  const maxRecent = useSettingsStore((s) => s.maxRecentTasks);

  const refreshPushStatus = async (wsId: string) => {
    try {
      const status = await fetchPushStatus(wsId);
      setPushStatus(status);
    } catch {
      /* guest / not signed in */
    }
  };

  useEffect(() => {
    void me().then((data) => {
      if (data.user?.email) setUserEmail(data.user.email);
    });
    void listWorkspaces()
      .then((data) => {
        const ws = data.workspaces?.[0];
        if (ws) setWorkspaceId(ws.id);
      })
      .catch(() => {
        /* guest with token only */
      });
  }, []);

  useEffect(() => {
    void currentSubscription().then((sub) => setPushOn(Boolean(sub)));
  }, []);

  useEffect(() => {
    if (workspaceId) void refreshPushStatus(workspaceId);
  }, [workspaceId]);

  const enableNotifications = async () => {
    if (!workspaceId) {
      setPushMsg("Sign in first to enable notifications");
      return;
    }
    setPushBusy(true);
    setPushMsg("");
    try {
      await enablePush(workspaceId);
      setPushOn(true);
      const test = await sendTestPush(workspaceId);
      setPushMsg(
        test.ok
          ? "Enabled — check your phone for the test notification"
          : "Enabled, but test did not deliver"
      );
      await refreshPushStatus(workspaceId);
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Could not enable notifications");
    } finally {
      setPushBusy(false);
    }
  };

  const turnOffNotifications = async () => {
    setPushBusy(true);
    setPushMsg("");
    try {
      await disablePush();
      setPushOn(false);
      setPushMsg("Notifications off on this device");
      if (workspaceId) await refreshPushStatus(workspaceId);
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Could not disable");
    } finally {
      setPushBusy(false);
    }
  };

  const runTestNotification = async () => {
    if (!workspaceId) return;
    setPushBusy(true);
    setPushMsg("");
    try {
      const test = await sendTestPush(workspaceId);
      const parts = [
        test.push && test.push.sent > 0 ? `push×${test.push.sent}` : null,
        test.relay ? "relay" : null,
      ].filter(Boolean);
      setPushMsg(
        parts.length
          ? `Test sent (${parts.join(" + ")}) — check your phone`
          : "Test requested"
      );
      await refreshPushStatus(workspaceId);
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Test failed");
    } finally {
      setPushBusy(false);
    }
  };

  const toggleCompletions = async () => {
    if (!workspaceId || !pushStatus) return;
    setPushBusy(true);
    try {
      const prefs = await updateNotifyPrefs(workspaceId, {
        notifyCompletions: !pushStatus.prefs.notifyCompletions,
      });
      setPushStatus({ ...pushStatus, prefs });
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Could not update quiet prefs");
    } finally {
      setPushBusy(false);
    }
  };

  const quietForHour = async () => {
    if (!workspaceId) return;
    setPushBusy(true);
    try {
      const prefs = await updateNotifyPrefs(workspaceId, { quietMinutes: 60 });
      if (pushStatus) setPushStatus({ ...pushStatus, prefs });
      setPushMsg("Quiet for 1 hour");
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Could not set quiet");
    } finally {
      setPushBusy(false);
    }
  };

  const clearQuiet = async () => {
    if (!workspaceId) return;
    setPushBusy(true);
    try {
      const prefs = await updateNotifyPrefs(workspaceId, { quietMinutes: 0 });
      if (pushStatus) setPushStatus({ ...pushStatus, prefs });
      setPushMsg("Quiet cleared");
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : "Could not clear quiet");
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!connected || !readToken) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      cleanup = await initProgressTransport({
        mode: "cloud",
        cloud: {
          enabled: true,
          baseUrl,
          readToken,
        },
      });
      if (cancelled) cleanup?.();
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [connected, baseUrl, readToken]);

  const displayedCompleted = useMemo(
    () => completedTasks.slice(0, maxRecent),
    [completedTasks, maxRecent]
  );

  const connect = () => {
    setError("");
    if (!baseUrl.trim() || !readToken.trim()) {
      setError("Server URL and read token are required");
      return;
    }
    localStorage.setItem(URL_KEY, baseUrl.trim());
    localStorage.setItem(TOKEN_KEY, readToken.trim());
    setConnected(true);
  };

  const mintToken = async (kind: "read" | "write") => {
    if (!workspaceId) {
      setError("Sign in to mint tokens for your workspace");
      return;
    }
    try {
      const result = await createToken(workspaceId, kind, `web-${kind}`);
      setNewSecret(result.secret);
      if (kind === "read") {
        setReadToken(result.secret);
        localStorage.setItem(TOKEN_KEY, result.secret);
      } else {
        setWriteToken(result.secret);
        sessionStorage.setItem(WRITE_TOKEN_KEY, result.secret);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token create failed");
    }
  };

  const reportUrl = (baseUrl || window.location.origin).replace(/\/$/, "");
  const agentExample = writeToken
    ? `curl -sS -X POST "${reportUrl}/api/events" \\\n  -H "Authorization: Bearer ${writeToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"type":"task_complete","task_id":"demo-1","tool":"Demo","description":"hello","timestamp":${Date.now()}}'`
    : "";

  return (
    <div className="min-h-screen bg-[#0b1220] text-overlay-text">
      <header className="sticky top-0 z-20 border-b border-overlay-border/80 bg-[#0b1220]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="font-display text-xl">Agent Progress</div>
            <div className="text-[11px] text-overlay-muted">
              Built by Brown Industries
              {userEmail ? ` · ${userEmail}` : ""}
              {connectionStatus !== "idle" ? ` · ${connectionStatus}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => onGo("landing")}
              className="text-overlay-muted hover:text-overlay-text"
            >
              Home
            </button>
            {userEmail ? (
              <button
                onClick={async () => {
                  await logout();
                  onGo("landing");
                }}
                className="rounded border border-overlay-border px-3 py-1.5"
              >
                Sign out
              </button>
            ) : (
              <button
                onClick={() => onGo("login")}
                className="rounded bg-overlay-accent px-3 py-1.5 font-medium text-slate-950"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-4">
          {userEmail && workspaceId && (
            <section className="rounded-lg border border-overlay-accent/40 bg-overlay-card/40 p-4">
              <h2 className="text-sm font-semibold">1. Phone alerts</h2>
              <p className="mt-1 text-xs text-overlay-muted">
                {pushSupported()
                  ? "Install the Agent Progress APK (or open in Chrome): enable, allow permission, done. Tap a notification to jump back to the task."
                  : "Install the Android APK or open this site in Chrome, then come back here."}
              </p>
              <p className="mt-1 text-[11px] text-overlay-muted">
                APK:{" "}
                <a
                  className="text-overlay-accent hover:underline"
                  href="/android/agent-progress.apk"
                >
                  Download Agent Progress
                </a>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!pushOn ? (
                  <button
                    type="button"
                    disabled={pushBusy || !pushSupported()}
                    onClick={() => void enableNotifications()}
                    className="rounded bg-overlay-accent px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
                  >
                    Enable notifications
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={pushBusy}
                      onClick={() => void runTestNotification()}
                      className="rounded bg-overlay-accent px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
                    >
                      Send test notification
                    </button>
                    <button
                      type="button"
                      disabled={pushBusy}
                      onClick={() => void turnOffNotifications()}
                      className="rounded border border-overlay-border px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Disable
                    </button>
                  </>
                )}
              </div>
              {pushStatus && (
                <p className="mt-2 text-[11px] text-overlay-muted">
                  Devices subscribed: {pushStatus.subscriptionCount}
                  {pushStatus.relayEnabled ? " · BRWN Text relay on" : ""}
                  {pushStatus.prefs.quietActive ? " · quiet" : ""}
                </p>
              )}
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-overlay-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={pushStatus ? !pushStatus.prefs.notifyCompletions : false}
                  disabled={pushBusy || !pushStatus}
                  onChange={() => void toggleCompletions()}
                />
                <span>Only errors &amp; decisions (skip completed)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {pushStatus?.prefs.quietActive ? (
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void clearQuiet()}
                    className="text-[11px] text-overlay-accent hover:underline disabled:opacity-50"
                  >
                    End quiet now
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void quietForHour()}
                    className="text-[11px] text-overlay-accent hover:underline disabled:opacity-50"
                  >
                    Quiet for 1 hour
                  </button>
                )}
              </div>
              {pushMsg && <p className="mt-2 text-xs text-overlay-accent">{pushMsg}</p>}
            </section>
          )}

          {userEmail && workspaceId && (
            <section className="rounded-lg border border-overlay-border bg-overlay-card/40 p-4">
              <h2 className="text-sm font-semibold">2. Agents report here</h2>
              <p className="mt-1 text-xs text-overlay-muted">
                One URL + one write token. Agents POST finished / failed / needs-decision events.
              </p>
              <CopyField label="Report URL" value={`${reportUrl}/api/events`} />
              {writeToken ? (
                <CopyField label="Write token" value={writeToken} />
              ) : (
                <button
                  type="button"
                  onClick={() => void mintToken("write")}
                  className="mt-3 rounded bg-overlay-accent px-3 py-1.5 text-xs font-semibold text-slate-950"
                >
                  Mint write token
                </button>
              )}
              {writeToken && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-overlay-muted">One-line example</span>
                    <button
                      type="button"
                      className="text-[11px] text-overlay-accent hover:underline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(agentExample);
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-overlay-bg p-2 text-[10px] text-overlay-muted">
                    {agentExample}
                  </pre>
                </div>
              )}
            </section>
          )}

          <section className="rounded-lg border border-overlay-border bg-overlay-card/40 p-4">
            <h2 className="text-sm font-semibold">Connect</h2>
            <p className="mt-1 text-xs text-overlay-muted">
              Paste a workspace read token, or sign in and mint one.
            </p>
            <label className="mt-3 block text-xs text-overlay-muted">
              Server URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="mt-1 w-full rounded border border-overlay-border bg-overlay-bg px-2 py-1.5 text-sm"
              />
            </label>
            <label className="mt-2 block text-xs text-overlay-muted">
              Read token
              <input
                type="password"
                value={readToken}
                onChange={(e) => setReadToken(e.target.value)}
                className="mt-1 w-full rounded border border-overlay-border bg-overlay-bg px-2 py-1.5 text-sm"
              />
            </label>
            {error && <p className="mt-2 text-xs text-overlay-error">{error}</p>}
            {newSecret && (
              <p className="mt-2 break-all rounded bg-overlay-bg p-2 text-[11px] text-overlay-accent">
                New token (copy now): {newSecret}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={connect}
                className="rounded bg-overlay-accent px-3 py-1.5 text-xs font-semibold text-slate-950"
              >
                {connected ? "Reconnect" : "Connect"}
              </button>
              {workspaceId && (
                <button
                  onClick={() => void mintToken("read")}
                  className="rounded border border-overlay-border px-3 py-1.5 text-xs"
                >
                  Mint read
                </button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-overlay-border bg-overlay-card/40 p-4">
            <h2 className="text-sm font-semibold">Agents</h2>
            {(!agents || agents.length === 0) && (
              <p className="mt-2 text-xs text-overlay-muted">No agents yet</p>
            )}
            <ul className="mt-2 space-y-2">
              {(agents || []).map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="font-medium text-overlay-text">
                    {a.label || a.name}
                  </div>
                  <div className="text-overlay-muted">{a.source}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-overlay-border bg-overlay-card/40 p-4">
            <h2 className="text-sm font-semibold">Recent errors</h2>
            {(!errors || errors.length === 0) && (
              <p className="mt-2 text-xs text-overlay-muted">None</p>
            )}
            <ul className="mt-2 space-y-2">
              {(errors || []).slice(0, 8).map((e) => (
                <li key={e.id} className="text-xs text-overlay-error">
                  {e.tool}: {e.description}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="min-h-[70vh] overflow-hidden rounded-lg border border-overlay-border bg-overlay-bg shadow-xl">
          <div className="flex items-center justify-between border-b border-overlay-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-overlay-accent animate-pulse-slow" />
              <span className="text-sm font-medium">Live workspace</span>
              {activeTasks.length > 0 && (
                <span className="rounded bg-overlay-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-overlay-accent">
                  {activeTasks.length}
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto">
            <TodoSection />
            <TaskList activeTasks={activeTasks} completedTasks={displayedCompleted} />
          </div>
        </section>
      </main>
    </div>
  );
}
