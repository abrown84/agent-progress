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

function getFileName(desc: string): string {
  const match = desc.match(/[/\\]([^/\\]+)$/);
  return match ? match[1] : desc;
}

function getSummary(desc: string, tool: string): string {
  if (!desc) return "Running...";

  // Bash commands - create human readable summaries
  if (tool === "Bash") {
    // Remove common prefixes that precede the actual command
    let cmd = desc
      .replace(/^cd\s+["'][^"']+["']\s*&&\s*/, "")  // cd 'path' &&
      .replace(/^cd\s+[^\s&]+\s*&&\s*/, "")         // cd path &&
      .replace(/^sleep\s+\d+\s*&&\s*/, "")          // sleep N &&
      .replace(/^timeout\s+\d+\s*&&\s*/, "")        // timeout N &&
      .trim();

    // Helper to extract last path segment
    const getTarget = (s: string): string => {
      const pathMatch = s.match(/["']?([^"'\s]+)["']?\s*$/);
      if (pathMatch) {
        const parts = pathMatch[1].split(/[/\\]/);
        return parts[parts.length - 1] || parts[parts.length - 2] || "";
      }
      return "";
    };

    // Standalone cd command
    if (cmd.match(/^cd\s+/i)) {
      const target = getTarget(cmd);
      return target ? `Navigating to ${target}` : "Changing directory";
    }

    // npm/yarn/pnpm
    if (cmd.match(/^npm\s+(run\s+)?build/i)) return "Building the project";
    if (cmd.match(/^npm\s+(run\s+)?test/i)) return "Running test suite";
    if (cmd.match(/^npm\s+(run\s+)?start/i)) return "Starting dev server";
    if (cmd.match(/^npm\s+(run\s+)?dev/i)) return "Starting dev server";
    if (cmd.match(/^npm\s+install\s+(\S+)/i)) {
      const pkg = cmd.match(/^npm\s+install\s+(\S+)/i)?.[1];
      return `Installing ${pkg} package`;
    }
    if (cmd.match(/^npm\s+install/i)) return "Installing dependencies";
    if (cmd.match(/^npm\s+run\s+(\w+)/)) {
      const script = cmd.match(/^npm\s+run\s+(\w+)/)?.[1];
      return `Running "${script}" script`;
    }
    if (cmd.match(/^yarn\s+build/i)) return "Building the project";
    if (cmd.match(/^yarn\s+test/i)) return "Running test suite";
    if (cmd.match(/^yarn\s+install/i)) return "Installing dependencies";
    if (cmd.match(/^yarn\s+add\s+(\S+)/i)) {
      const pkg = cmd.match(/^yarn\s+add\s+(\S+)/i)?.[1];
      return `Installing ${pkg} package`;
    }
    if (cmd.match(/^pnpm\s+install/i)) return "Installing dependencies";
    if (cmd.match(/^pnpm\s+build/i)) return "Building the project";

    // git
    if (cmd.match(/^git\s+status/i)) return "Checking working tree status";
    if (cmd.match(/^git\s+diff/i)) return "Viewing uncommitted changes";
    if (cmd.match(/^git\s+log/i)) return "Viewing commit history";
    if (cmd.match(/^git\s+add\s+\./i)) return "Staging all changes";
    if (cmd.match(/^git\s+add\s+(\S+)/i)) {
      const file = getTarget(cmd);
      return `Staging ${file}`;
    }
    if (cmd.match(/^git\s+add/i)) return "Staging files";
    if (cmd.match(/^git\s+commit/i)) return "Creating a commit";
    if (cmd.match(/^git\s+push/i)) return "Pushing to remote";
    if (cmd.match(/^git\s+pull/i)) return "Pulling from remote";
    if (cmd.match(/^git\s+clone/i)) return "Cloning repository";
    if (cmd.match(/^git\s+checkout\s+(\S+)/i)) {
      const branch = cmd.match(/^git\s+checkout\s+(\S+)/i)?.[1];
      return `Switching to ${branch}`;
    }
    if (cmd.match(/^git\s+branch/i)) return "Managing branches";
    if (cmd.match(/^git\s+merge/i)) return "Merging branches";
    if (cmd.match(/^git\s+rebase/i)) return "Rebasing commits";
    if (cmd.match(/^git\s+stash/i)) return "Stashing changes";
    if (cmd.match(/^git\s+fetch/i)) return "Fetching from remote";

    // cargo/rust
    if (cmd.match(/^cargo\s+build/i)) return "Compiling Rust project";
    if (cmd.match(/^cargo\s+test/i)) return "Running Rust tests";
    if (cmd.match(/^cargo\s+run/i)) return "Running Rust binary";
    if (cmd.match(/^cargo\s+check/i)) return "Checking Rust code";
    if (cmd.match(/^rustc/i)) return "Compiling Rust";

    // python
    if (cmd.match(/^python\s+["']?([^"'\s]+)/i)) {
      const script = getTarget(cmd);
      return script ? `Running ${script}` : "Running Python script";
    }
    if (cmd.match(/^pip\s+install\s+-r/i)) return "Installing from requirements";
    if (cmd.match(/^pip\s+install\s+(\S+)/i)) {
      const pkg = cmd.match(/^pip\s+install\s+(\S+)/i)?.[1];
      return `Installing ${pkg}`;
    }
    if (cmd.match(/^pip\s+install/i)) return "Installing Python packages";
    if (cmd.match(/^pytest/i)) return "Running Python tests";
    if (cmd.match(/^pip\s+freeze/i)) return "Listing installed packages";

    // docker
    if (cmd.match(/^docker\s+build/i)) return "Building Docker image";
    if (cmd.match(/^docker\s+run/i)) return "Starting container";
    if (cmd.match(/^docker\s+compose\s+up/i)) return "Starting services";
    if (cmd.match(/^docker\s+compose\s+down/i)) return "Stopping services";
    if (cmd.match(/^docker\s+compose\s+build/i)) return "Building services";
    if (cmd.match(/^docker\s+ps/i)) return "Listing containers";
    if (cmd.match(/^docker\s+logs/i)) return "Viewing container logs";

    // file operations
    if (cmd.match(/^make\s+(\w+)/i)) {
      const target = cmd.match(/^make\s+(\w+)/i)?.[1];
      return `Running make ${target}`;
    }
    if (cmd.match(/^make\b/i)) return "Running make";
    if (cmd.match(/^ls\s/i) || cmd === "ls") return "Listing directory contents";
    if (cmd.match(/^mkdir\s/i)) return `Creating ${getTarget(cmd)} directory`;
    if (cmd.match(/^rm\s+-rf?\s/i)) return `Removing ${getTarget(cmd)}`;
    if (cmd.match(/^rm\s/i)) return `Deleting ${getTarget(cmd)}`;
    if (cmd.match(/^cp\s/i)) return "Copying files";
    if (cmd.match(/^mv\s/i)) return "Moving files";
    if (cmd.match(/^cat\s/i)) return `Reading ${getTarget(cmd)}`;
    if (cmd.match(/^curl\s/i)) return "Making HTTP request";
    if (cmd.match(/^wget\s/i)) return "Downloading file";
    if (cmd.match(/^find\s/i)) return "Searching for files";
    if (cmd.match(/^grep\s/i)) return "Searching file contents";
    if (cmd.match(/^tail\s/i)) return `Watching ${getTarget(cmd)}`;
    if (cmd.match(/^head\s/i)) return `Reading start of ${getTarget(cmd)}`;
    if (cmd.match(/^echo\s/i)) return "Printing output";
    if (cmd.match(/^touch\s/i)) return `Creating ${getTarget(cmd)}`;
    if (cmd.match(/^chmod\s/i)) return "Changing permissions";
    if (cmd.match(/^chown\s/i)) return "Changing ownership";

    // build tools
    if (cmd.match(/^tsc/i)) return "Compiling TypeScript";
    if (cmd.match(/^tauri\s+build/i)) return "Building Tauri application";
    if (cmd.match(/^tauri\s+dev/i)) return "Starting Tauri dev mode";
    if (cmd.match(/^vite\s+build/i)) return "Building with Vite";
    if (cmd.match(/^vite\s+dev/i)) return "Starting Vite dev server";
    if (cmd.match(/^webpack/i)) return "Bundling with Webpack";
    if (cmd.match(/^esbuild/i)) return "Bundling with esbuild";
    if (cmd.match(/^rollup/i)) return "Bundling with Rollup";

    // Fallback: truncate long commands
    if (cmd.length > 35) {
      return cmd.substring(0, 32) + "...";
    }
    return cmd;
  }

  // File operations
  if (tool === "Read") return `Reading ${getFileName(desc)}`;
  if (tool === "Write") return `Writing ${getFileName(desc)}`;
  if (tool === "Edit") return `Editing ${getFileName(desc)}`;
  if (tool === "Glob") return "Searching files";
  if (tool === "Grep") return "Searching content";
  if (tool === "WebFetch") return "Fetching web page";
  if (tool === "WebSearch") return "Searching the web";
  if (tool === "LSP") return "Analyzing code";
  if (tool === "TodoWrite") return "Updating task list";

  // For agents/skills, use description as-is
  if (tool === "Task" || tool === "Subagent" || tool === "Skill") {
    let summary = desc.trim();
    if (summary.length > 0) {
      summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    }
    if (summary.length > 35) {
      return summary.substring(0, 32) + "...";
    }
    return summary;
  }

  // Default
  if (desc.length > 35) {
    return desc.substring(0, 32) + "...";
  }
  return desc;
}

const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
  Bash: { label: "Terminal", icon: "terminal" },
  Task: { label: "Agent", icon: "cpu" },
  Subagent: { label: "Agent", icon: "cpu" },
  Skill: { label: "Skill", icon: "wand" },
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

function getToolLabel(tool: string, subagentType?: string, description?: string): string {
  // Handle agents with subagent type
  if ((tool === "Task" || tool === "Subagent") && subagentType) {
    const agentNames: Record<string, string> = {
      Explore: "Explorer",
      Plan: "Planner",
      "general-purpose": "Agent",
      Bash: "Terminal",
    };
    return agentNames[subagentType] || subagentType;
  }

  // Handle skills - extract skill name from description
  if (tool === "Skill" && description) {
    // Description usually contains the skill name
    const skillMatch = description.match(/^(\w+[-\w]*)/);
    if (skillMatch) {
      return `/${skillMatch[1]}`;
    }
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
    wand: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" />
        <path d="M17.8 11.8 19 13" /><path d="M15 9h.01" />
        <path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" />
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
  const [downloadProgress, setDownloadProgress] = useState(0);

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

  // Only show download progress for ACTIVE tasks with real progress data
  const hasRealProgress = task.status === "active" && task.downloadProgress !== undefined && task.downloadProgress > 0;

  useEffect(() => {
    if (hasRealProgress) {
      setDownloadProgress(task.downloadProgress!);
    }
  }, [task.downloadProgress, hasRealProgress]);

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
          {/* Tool label badge */}
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                isActive
                  ? "bg-overlay-accent/20 text-overlay-accent"
                  : "bg-overlay-muted/20 text-overlay-muted"
              }`}
            >
              {getToolLabel(task.tool, task.subagentType, task.description)}
            </span>
            {task.background && (
              <span className="px-1 py-0.5 text-[9px] bg-overlay-accent/10 text-overlay-accent rounded">
                BG
              </span>
            )}
          </div>
          {/* Summary description */}
          <div className="mt-1">
            <span
              className={`text-xs ${
                isActive ? "text-overlay-text" : "text-overlay-muted"
              }`}
              title={task.description}
            >
              {getSummary(task.description, task.tool)}
            </span>
          </div>

          {/* Progress bar - only shows when real download progress data exists */}
          {hasRealProgress && (
            <div className="mt-1.5 w-full h-1.5 bg-overlay-border/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-100"
                style={{ width: `${Math.min(downloadProgress, 100)}%` }}
              />
            </div>
          )}

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
