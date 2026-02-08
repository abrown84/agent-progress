/** Format a duration in milliseconds to a human-readable string */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/** Extract the filename from a path */
export function getFileName(desc: string): string {
  const match = desc.match(/[/\\]([^/\\]+)$/);
  return match ? match[1] : desc;
}

/** Truncate a string to a max length with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

/** Get a short session ID (first 6 chars) */
export function getShortSessionId(sessionId?: string): string {
  if (!sessionId) return "";
  return sessionId.slice(0, 6);
}
