import { createCloudTransport } from "./cloudTransport";
import { createCompositeTransport } from "./compositeTransport";
import { createTauriTransport } from "./tauriTransport";
import {
  isTauriRuntime,
  type CloudConnectionConfig,
  type ProgressTransport,
} from "./types";

export * from "./types";
export { createTauriTransport, createCloudTransport, createCompositeTransport };
export { fetchWorkspaceState, postCloudEvents } from "./cloudTransport";

export function createTransport(options?: {
  cloud?: CloudConnectionConfig | null;
  /** Force cloud-only (web dashboard) */
  mode?: "auto" | "tauri" | "cloud" | "composite";
}): ProgressTransport {
  const mode = options?.mode || "auto";
  const cloud = options?.cloud;

  if (mode === "cloud" || (!isTauriRuntime() && mode === "auto")) {
    if (!cloud?.baseUrl || !cloud?.readToken) {
      // Web without credentials — return a no-op transport; UI shows connect form.
      return {
        kind: "cloud",
        actions: {},
        async connect(handlers) {
          handlers.onConnectionChange?.("disconnected", "missing credentials");
          return () => undefined;
        },
      };
    }
    return createCloudTransport(cloud);
  }

  if (mode === "tauri") {
    return createTauriTransport();
  }

  // Desktop: always keep local file watch; optionally add cloud + forwarder
  return createCompositeTransport({ cloud });
}
