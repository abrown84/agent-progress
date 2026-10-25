import { z } from "zod";

export const TASK_EVENT_TYPES = [
  "task_started",
  "task_complete",
  "task_error",
  "task_canceled",
  "session_stopped",
] as const;

export const TaskEventSchema = z
  .object({
    type: z.enum(TASK_EVENT_TYPES),
    task_id: z.string().min(1).optional(),
    tool: z.string().optional(),
    description: z.string().optional(),
    session_id: z.string().optional(),
    timestamp: z.number().int().nonnegative(),
    background: z.boolean().optional(),
    subagent_type: z.string().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type !== "session_stopped" && !val.task_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "task_id is required except for session_stopped",
        path: ["task_id"],
      });
    }
  });

export const TodoItemSchema = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  activeForm: z.string(),
  session_id: z.string().optional(),
});

export const DownloadProgressSchema = z.object({
  task_id: z.string().min(1),
  percent: z.number().min(0).max(100),
  speed: z.string().optional(),
  eta: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});

export const AgentMetaSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  source: z
    .enum(["grok-bot", "cursor-cloud", "claude-code", "custom", "desktop-forwarder"])
    .optional(),
  label: z.string().max(120).optional(),
});

export const IngestEnvelopeSchema = z.object({
  agent: AgentMetaSchema.optional(),
  event: TaskEventSchema.optional(),
  events: z.array(TaskEventSchema).optional(),
  todos: z.array(TodoItemSchema).optional(),
  download: DownloadProgressSchema.optional(),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type DownloadProgress = z.infer<typeof DownloadProgressSchema>;
export type AgentMeta = z.infer<typeof AgentMetaSchema>;
export type IngestEnvelope = z.infer<typeof IngestEnvelopeSchema>;

export type TokenKind = "write" | "read";

export interface WorkspaceState {
  workspace: { id: string; name: string; slug: string };
  agents: Array<{
    id: string;
    name: string;
    source: string;
    label: string | null;
    last_seen_at: number | null;
  }>;
  activeTasks: Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    startTime: number;
    status: "active";
    background: boolean;
    subagentType?: string;
    sessionId?: string;
    downloadProgress?: number;
  }>;
  recentTasks: Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    startTime: number;
    endTime?: number;
    status: "completed" | "error" | "canceled";
    background: boolean;
    subagentType?: string;
    sessionId?: string;
    duration_ms?: number;
  }>;
  todos: TodoItem[];
  errors: Array<{
    id: string;
    agent_id: string | null;
    tool: string;
    description: string;
    startTime: number;
    endTime?: number;
  }>;
}

export type StreamPayload =
  | { kind: "task_event"; agent_id: string | null; event: TaskEvent }
  | { kind: "todos"; agent_id: string | null; todos: TodoItem[] }
  | { kind: "download"; agent_id: string | null; download: DownloadProgress }
  | { kind: "snapshot"; state: WorkspaceState }
  | { kind: "ping"; ts: number };
