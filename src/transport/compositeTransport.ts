import type {
  CloudConnectionConfig,
  ProgressHandlers,
  ProgressTransport,
} from "./types";
import { createTauriTransport } from "./tauriTransport";
import { createCloudTransport, postCloudEvents } from "./cloudTransport";
import type { TaskEvent, TodoItem } from "../types";

/**
 * Local Tauri file-watch events plus optional cloud SSE, with optional
 * forwarding of local events to the cloud workspace.
 */
export function createCompositeTransport(options: {
  cloud?: CloudConnectionConfig | null;
}): ProgressTransport {
  const local = createTauriTransport();
  const cloud =
    options.cloud?.baseUrl && options.cloud?.readToken
      ? createCloudTransport(options.cloud)
      : null;

  return {
    kind: "composite",
    actions: local.actions,
    async connect(handlers: ProgressHandlers) {
      const cleanups: Array<() => void> = [];

      const localHandlers: ProgressHandlers = {
        onTaskEvent: (event) => {
          handlers.onTaskEvent(event);
          if (options.cloud?.forwardLocalEvents && options.cloud.writeToken) {
            void forwardTask(options.cloud, event);
          }
        },
        onTodos: (todos) => {
          handlers.onTodos(todos);
          if (options.cloud?.forwardLocalEvents && options.cloud.writeToken) {
            void forwardTodos(options.cloud, todos);
          }
        },
        onDownload: (event) => {
          handlers.onDownload?.(event);
          if (options.cloud?.forwardLocalEvents && options.cloud.writeToken) {
            void postCloudEvents(options.cloud, {
              agent: {
                name: options.cloud.agentName || "desktop",
                source: "desktop-forwarder",
                label: options.cloud.agentName || "Desktop",
              },
              download: event,
            }).catch((err) => console.warn("forward download failed", err));
          }
        },
        onConnectionChange: handlers.onConnectionChange,
      };

      cleanups.push(await local.connect(localHandlers));

      if (cloud) {
        cleanups.push(await cloud.connect(handlers));
      }

      return () => cleanups.forEach((fn) => fn());
    },
  };
}

async function forwardTask(config: CloudConnectionConfig, event: TaskEvent) {
  try {
    await postCloudEvents(config, {
      agent: {
        name: config.agentName || "desktop",
        source: "desktop-forwarder",
        label: config.agentName || "Desktop",
      },
      event,
    });
  } catch (err) {
    console.warn("forward task failed", err);
  }
}

async function forwardTodos(config: CloudConnectionConfig, todos: TodoItem[]) {
  try {
    await postCloudEvents(config, {
      agent: {
        name: config.agentName || "desktop",
        source: "desktop-forwarder",
        label: config.agentName || "Desktop",
      },
      todos,
    });
  } catch (err) {
    console.warn("forward todos failed", err);
  }
}
