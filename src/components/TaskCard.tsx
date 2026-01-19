import { Task } from "../hooks/useTasks";
import { useEffect, useState } from "react";

interface TaskCardProps {
  task: Task;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function cleanDescription(desc: string, tool: string): string {
  if (!desc) return "Running...";

  // For Bash commands, clean up and shorten
  if (tool === "Bash") {
    // Remove echo commands, show just the message
    const echoMatch = desc.match(/^echo\s+["']([^"']+)["']/);
    if (echoMatch) return echoMatch[1];

    // For commands with &&, show first meaningful part
    const parts = desc.split("&&").map(p => p.trim());
    const firstCmd = parts[0];

    // Extract command name
    const cmdMatch = firstCmd.match(/^(\w+)/);
    if (cmdMatch) {
      const cmd = cmdMatch[1];
      // Common commands with friendly names
      const cmdNames: Record<string, string> = {
        npm: "npm " + (firstCmd.match(/npm\s+(\w+)/)?.[1] || ""),
        npx: "npx " + (firstCmd.match(/npx\s+(\w+)/)?.[1] || ""),
        git: "git " + (firstCmd.match(/git\s+(\w+)/)?.[1] || ""),
        cd: "Changing directory",
        mkdir: "Creating folder",
        rm: "Removing files",
        cp: "Copying files",
        mv: "Moving files",
        cat: "Reading file",
        tail: "Reading file tail",
        head: "Reading file head",
        sleep: "Waiting...",
        taskkill: "Killing process",
        cargo: "cargo " + (firstCmd.match(/cargo\s+(\w+)/)?.[1] || ""),
      };
      if (cmdNames[cmd]) return cmdNames[cmd];
    }

    // Truncate long commands
    if (desc.length > 40) {
      return desc.substring(0, 37) + "...";
    }
  }

  // For file operations, show just the filename
  if (tool === "Read" || tool === "Write" || tool === "Edit") {
    const fileMatch = desc.match(/[/\\]([^/\\]+)$/);
    if (fileMatch) return fileMatch[1];
  }

  // Truncate any long description
  if (desc.length > 50) {
    return desc.substring(0, 47) + "...";
  }

  return desc;
}

function extractPath(desc: string, tool: string): string | null {
  if (!desc) return null;

  // For file operations, extract the directory
  if (tool === "Read" || tool === "Write" || tool === "Edit" || tool === "Glob" || tool === "Grep") {
    // Match full path and extract directory
    const pathMatch = desc.match(/^(.+)[/\\][^/\\]+$/);
    if (pathMatch) {
      let dir = pathMatch[1];
      // Shorten home directory
      dir = dir.replace(/^C:[/\\]Users[/\\][^/\\]+/, "~");
      // Shorten long paths - show last 2 segments
      const segments = dir.split(/[/\\]/);
      if (segments.length > 3) {
        return ".../" + segments.slice(-2).join("/");
      }
      return dir;
    }
  }

  // For Bash, try to extract cd path or working directory
  if (tool === "Bash") {
    const cdMatch = desc.match(/cd\s+["']?([^"'&]+)["']?/);
    if (cdMatch) {
      let dir = cdMatch[1].trim();
      dir = dir.replace(/^C:[/\\]Users[/\\][^/\\]+/, "~");
      const segments = dir.split(/[/\\]/);
      if (segments.length > 3) {
        return ".../" + segments.slice(-2).join("/");
      }
      return dir;
    }
  }

  return null;
}

const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
  Bash: { label: "Terminal", icon: "terminal" },
  Task: { label: "Agent", icon: "cpu" },
  Subagent: { label: "Agent", icon: "cpu" },
  Read: { label: "Reading", icon: "file" },
  Write: { label: "Writing", icon: "pencil" },
  Edit: { label: "Editing", icon: "edit" },
  Glob: { label: "Searching", icon: "search" },
  Grep: { label: "Searching", icon: "search" },
  WebFetch: { label: "Fetching", icon: "globe" },
  WebSearch: { label: "Searching Web", icon: "globe" },
  LSP: { label: "Code Intel", icon: "code" },
  TodoWrite: { label: "Planning", icon: "list" },
};

function getToolLabel(tool: string, subagentType?: string): string {
  if ((tool === "Task" || tool === "Subagent") && subagentType) {
    const agentNames: Record<string, string> = {
      Explore: "Explorer",
      Plan: "Planner",
      "general-purpose": "Agent",
      Bash: "Terminal Agent",
    };
    return agentNames[subagentType] || subagentType;
  }
  return TOOL_CONFIG[tool]?.label || tool;
}

function getToolIcon(tool: string): JSX.Element {
  const iconType = TOOL_CONFIG[tool]?.icon || "info";

  const icons: Record<string, JSX.Element> = {
    terminal: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    cpu: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M15 2v2" /><path d="M15 20v2" /><path d="M2 15h2" /><path d="M2 9h2" />
        <path d="M20 15h2" /><path d="M20 9h2" /><path d="M9 2v2" /><path d="M9 20v2" />
      </svg>
    ),
    file: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
    ),
    pencil: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
    edit: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
    search: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
    ),
    globe: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    ),
    code: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    list: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="6" height="6" x="3" y="5" rx="1" /><path d="m3 17 2 2 4-4" />
        <path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" />
      </svg>
    ),
    info: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
      </svg>
    ),
  };

  return icons[iconType] || icons.info;
}

export function TaskCard({ task }: TaskCardProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (task.status !== "active") {
      if (task.endTime) {
        setElapsed(task.endTime - task.startTime);
      }
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - task.startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [task.status, task.startTime, task.endTime]);

  const isActive = task.status === "active";
  const isError = task.status === "error";

  return (
    <div
      className={`animate-slide-in p-2.5 rounded-lg border transition-all relative ${
        isActive
          ? "bg-overlay-card border-overlay-accent/30"
          : isError
          ? "bg-overlay-card/50 border-overlay-error/30"
          : "bg-overlay-card/50 border-overlay-border/50"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Progress bubble on the right */}
        {isActive && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="relative w-7 h-7 flex items-center justify-center">
              <div className="absolute inset-0 spinner-outer rounded-full" />
              <div className="absolute inset-1 spinner-inner rounded-full" />
              <div className="w-2 h-2 bg-overlay-accent rounded-full animate-pulse" />
            </div>
          </div>
        )}
        <div
          className={`mt-0.5 ${
            isActive
              ? "text-overlay-accent"
              : isError
              ? "text-overlay-error"
              : "text-overlay-success"
          }`}
        >
          {getToolIcon(task.tool)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${
                isActive ? "text-overlay-text" : "text-overlay-muted"
              }`}
              title={task.description}
            >
              {cleanDescription(task.description, task.tool)}
            </span>
            {task.background && (
              <span className="px-1 py-0.5 text-[9px] bg-overlay-accent/10 text-overlay-accent rounded">
                BG
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`text-[10px] ${
                isActive ? "text-overlay-muted" : "text-overlay-muted/70"
              }`}
            >
              {getToolLabel(task.tool, task.subagentType)}
            </span>
            {extractPath(task.description, task.tool) && (
              <>
                <span className="text-overlay-muted/40">•</span>
                <span
                  className={`text-[10px] truncate ${
                    isActive ? "text-overlay-muted/70" : "text-overlay-muted/50"
                  }`}
                  title={task.description}
                >
                  {extractPath(task.description, task.tool)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center justify-between mt-1">
            <span
              className={`text-[10px] ${
                isActive ? "text-overlay-accent" : "text-overlay-muted/70"
              }`}
            >
              {formatDuration(elapsed)}
            </span>

            {!isActive && (
              <span
                className={`text-[10px] ${
                  isError ? "text-overlay-error" : "text-overlay-success"
                }`}
              >
                {isError ? "Failed" : "Done"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
