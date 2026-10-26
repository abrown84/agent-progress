/** Web Push + native Android (FCM) helpers for the dashboard notification flow. */

export interface PushStatus {
  pushEnabled: boolean;
  relayEnabled: boolean;
  fcmEnabled?: boolean;
  publicUrl: string;
  subscriptionCount: number;
  mySubscriptionCount: number;
  fcmDeviceCount?: number;
  myFcmDeviceCount?: number;
  prefs: {
    notifyCompletions: boolean;
    quietUntil: number | null;
    quietActive: boolean;
  };
}

declare global {
  interface Window {
    AgentProgressNativeApp?: {
      platform: string;
      versionCode?: number;
      versionName?: string;
      fcm?: boolean;
    };
    AgentProgressNative?: {
      enableNotifications?: () => void;
      registerFcm?: (workspaceId: string) => void;
      isNative?: () => boolean;
    };
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True inside the Agent Progress Android WebView shell. */
export function isNativeAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.AgentProgressNativeApp?.platform === "android") return true;
  if (typeof window.AgentProgressNative?.isNative === "function") {
    try {
      return Boolean(window.AgentProgressNative.isNative());
    } catch {
      /* ignore */
    }
  }
  return /AgentProgressNative\//i.test(navigator.userAgent);
}

export function pushSupported(): boolean {
  if (isNativeAndroidApp()) return true;
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
  if (isNativeAndroidApp()) return null;
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

/** Native app: ask the shell for notification permission + FCM token registration. */
async function enableNativeFcm(workspaceId: string): Promise<void> {
  try {
    window.AgentProgressNative?.enableNotifications?.();
  } catch {
    /* bridge optional */
  }
  try {
    window.AgentProgressNative?.registerFcm?.(workspaceId);
  } catch {
    /* bridge optional */
  }
  // Brief wait so the native registrar can POST /api/push/fcm/register with the session cookie.
  await new Promise((r) => setTimeout(r, 1200));
}

export async function enablePush(workspaceId: string): Promise<void> {
  if (isNativeAndroidApp()) {
    await enableNativeFcm(workspaceId);
    return;
  }
  if (!pushSupported()) {
    throw new Error("This browser does not support push. Install the Agent Progress Android app.");
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
  if (isNativeAndroidApp()) {
    // Native FCM tokens are cleared server-side only when the app unregisters; best-effort no-op UI.
    return;
  }
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
  fcm?: { sent: number; removed: number };
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
