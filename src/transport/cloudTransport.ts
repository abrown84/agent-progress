import type {
  CloudConnectionConfig,
  ProgressHandlers,
  ProgressTransport,
  WorkspaceSnapshot,
} from "./types";
import type { DownloadProgressEvent, TaskEvent, TodoItem } from "../types";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function fetchWorkspaceState(
  config: CloudConnectionConfig
): Promise<WorkspaceSnapshot> {
  const base = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${base}/api/state`, {
    headers: { Authorization: `Bearer ${config.readToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load state (${res.status})`);
  }
  return (await res.json()) as WorkspaceSnapshot;
}

export async function postCloudEvents(
  config: CloudConnectionConfig,
  body: unknown
): Promise<void> {
  if (!config.writeToken) {
    throw new Error("Write token required to post events");
  }
  const base = normalizeBaseUrl(config.baseUrl);
  const res = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.writeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post events (${res.status}): ${text}`);
  }
}

export function createCloudTransport(config: CloudConnectionConfig): ProgressTransport {
  return {
    kind: "cloud",
    actions: {
      clearEvents: async () => {
        // Cloud clear is a no-op for now (history is server-owned).
      },
    },
    async connect(handlers: ProgressHandlers) {
      const base = normalizeBaseUrl(config.baseUrl);
      let closed = false;
      let es: EventSource | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

      const handlePayload = (raw: string) => {
        try {
          const payload = JSON.parse(raw) as {
            kind: string;
            event?: TaskEvent;
            todos?: TodoItem[];
            download?: DownloadProgressEvent;
            state?: WorkspaceSnapshot;
          };
          switch (payload.kind) {
            case "snapshot":
              if (payload.state) handlers.onSnapshot?.(payload.state);
              break;
            case "task_event":
              if (payload.event) handlers.onTaskEvent(payload.event);
              break;
            case "todos":
              if (payload.todos) handlers.onTodos(payload.todos);
              break;
            case "download":
              if (payload.download) handlers.onDownload?.(payload.download);
              break;
            default:
              break;
          }
        } catch (err) {
          console.warn("Failed to parse SSE payload", err);
        }
      };

      const connect = () => {
        if (closed) return;
        // EventSource cannot set Authorization headers; pass token as query for browser SSE.
        // Server also accepts Authorization — desktop/fetch uses header; browsers use ?token=.
        const url = `${base}/api/events/stream?token=${encodeURIComponent(config.readToken)}`;
        es = new EventSource(url);

        es.addEventListener("snapshot", (ev) => handlePayload((ev as MessageEvent).data));
        es.addEventListener("task_event", (ev) => handlePayload((ev as MessageEvent).data));
        es.addEventListener("todos", (ev) => handlePayload((ev as MessageEvent).data));
        es.addEventListener("download", (ev) => handlePayload((ev as MessageEvent).data));
        es.addEventListener("ping", () => {
          /* keepalive */
        });

        es.onopen = () => handlers.onConnectionChange?.("connected", "cloud");
        es.onerror = () => {
          handlers.onConnectionChange?.("error", "cloud sse error");
          es?.close();
          if (!closed) {
            reconnectTimer = setTimeout(connect, 2000);
          }
        };
      };

      // Prefer snapshot via fetch first (works with Authorization header), then SSE.
      try {
        const state = await fetchWorkspaceState(config);
        handlers.onSnapshot?.(state);
      } catch (err) {
        handlers.onConnectionChange?.(
          "error",
          err instanceof Error ? err.message : "snapshot failed"
        );
      }

      connect();

      return () => {
        closed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        es?.close();
        handlers.onConnectionChange?.("disconnected", "cloud");
      };
    },
  };
}

/** Apply a server snapshot into the same handler callbacks used for live events. */
export function replaySnapshot(
  state: WorkspaceSnapshot,
  handlers: ProgressHandlers
): void {
  handlers.onSnapshot?.(state);
  handlers.onTodos(state.todos || []);
}
