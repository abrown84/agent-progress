import type { StreamPayload } from "./types.js";

type Listener = (payload: StreamPayload) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(workspaceId: string, listener: Listener): () => void {
  let set = listeners.get(workspaceId);
  if (!set) {
    set = new Set();
    listeners.set(workspaceId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(workspaceId);
  };
}

export function publish(workspaceId: string, payload: StreamPayload): void {
  const set = listeners.get(workspaceId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(payload);
    } catch {
      // ignore broken listeners
    }
  }
}
