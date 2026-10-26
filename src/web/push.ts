/** Web Push helpers for the dashboard "Enable notifications" flow. */

export interface PushStatus {
  pushEnabled: boolean;
  relayEnabled: boolean;
  publicUrl: string;
  subscriptionCount: number;
  mySubscriptionCount: number;
  prefs: {
    notifyCompletions: boolean;
    quietUntil: number | null;
    quietActive: boolean;
  };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) {
    await navigator.serviceWorker.ready;
    return existing;
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function fetchPushStatus(workspaceId: string): Promise<PushStatus> {
  const res = await fetch(`/api/push/status?workspaceId=${encodeURIComponent(workspaceId)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Could not load notification status");
  return res.json();
}

export async function enablePush(workspaceId: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error("This browser does not support push. On Android use Chrome, then Add to Home screen.");
  }
  const keyRes = await fetch("/api/push/vapid-public-key");
  const { enabled, publicKey } = await keyRes.json();
  if (!enabled || !publicKey) {
    throw new Error("Push is not configured on the server yet — redeploy or check VAPID keys");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted — allow it in the browser prompt");
  }

  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const appKey = urlBase64ToUint8Array(publicKey);
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
    } catch (err) {
      // Stale subscription after VAPID key rotation — clear and retry once.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => {});
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
      if (!sub) throw err;
    }
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, subscription: sub.toJSON() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save subscription");
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

export async function sendTestPush(workspaceId: string): Promise<{
  ok: boolean;
  push?: { sent: number; removed: number };
  relay?: boolean;
  error?: string;
}> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Test notification failed");
  }
  return data;
}

export async function updateNotifyPrefs(
  workspaceId: string,
  patch: { notifyCompletions?: boolean; quietMinutes?: number }
): Promise<PushStatus["prefs"]> {
  const res = await fetch("/api/push/prefs", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, ...patch }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not update prefs");
  return data.prefs;
}
