import { getFileName, truncate } from "./formatters";

/** Extract the last path segment from a string */
function getTarget(s: string): string {
  const pathMatch = s.match(/["']?([^"'\s]+)["']?\s*$/);
  if (pathMatch) {
    const parts = pathMatch[1].split(/[/\\]/);
    return parts[parts.length - 1] || parts[parts.length - 2] || "";
  }
  return "";
}

/** Generate a human-readable summary for a Bash command */
function getBashSummary(desc: string): string {
  // Strip common cd/sleep/timeout prefixes
  const cmd = desc
    .replace(/^cd\s+["'][^"']+["']\s*&&\s*/, "")
    .replace(/^cd\s+[^\s&]+\s*&&\s*/, "")
    .replace(/^sleep\s+\d+\s*&&\s*/, "")
    .replace(/^timeout\s+\d+\s*&&\s*/, "")
    .trim();

  // cd
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
    return `Installing ${cmd.match(/^npm\s+install\s+(\S+)/i)?.[1]} package`;
  }
  if (cmd.match(/^npm\s+install/i)) return "Installing dependencies";
  if (cmd.match(/^npm\s+run\s+(\w+)/)) {
    return `Running "${cmd.match(/^npm\s+run\s+(\w+)/)?.[1]}" script`;
  }
  if (cmd.match(/^yarn\s+build/i)) return "Building the project";
  if (cmd.match(/^yarn\s+test/i)) return "Running test suite";
  if (cmd.match(/^yarn\s+install/i)) return "Installing dependencies";
  if (cmd.match(/^yarn\s+add\s+(\S+)/i)) {
    return `Installing ${cmd.match(/^yarn\s+add\s+(\S+)/i)?.[1]} package`;
  }
  if (cmd.match(/^pnpm\s+install/i)) return "Installing dependencies";
  if (cmd.match(/^pnpm\s+build/i)) return "Building the project";

  // git
  if (cmd.match(/^git\s+status/i)) return "Checking working tree status";
  if (cmd.match(/^git\s+diff/i)) return "Viewing uncommitted changes";
  if (cmd.match(/^git\s+log/i)) return "Viewing commit history";
  if (cmd.match(/^git\s+add\s+\./i)) return "Staging all changes";
  if (cmd.match(/^git\s+add\s+(\S+)/i)) return `Staging ${getTarget(cmd)}`;
  if (cmd.match(/^git\s+add/i)) return "Staging files";
  if (cmd.match(/^git\s+commit/i)) return "Creating a commit";
  if (cmd.match(/^git\s+push/i)) return "Pushing to remote";
  if (cmd.match(/^git\s+pull/i)) return "Pulling from remote";
  if (cmd.match(/^git\s+clone/i)) return "Cloning repository";
  if (cmd.match(/^git\s+checkout\s+(\S+)/i)) {
    return `Switching to ${cmd.match(/^git\s+checkout\s+(\S+)/i)?.[1]}`;
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
    return `Installing ${cmd.match(/^pip\s+install\s+(\S+)/i)?.[1]}`;
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
  if (cmd.match(/^make\s+(\w+)/i)) return `Running make ${cmd.match(/^make\s+(\w+)/i)?.[1]}`;
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

  return truncate(cmd, 35);
}

/** Generate a human-readable summary for any tool + description */
export function getSummary(desc: string, tool: string): string {
  if (!desc) return "Running...";

  if (tool === "Bash") return getBashSummary(desc);

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

  // Agents and skills
  if (tool === "Task" || tool === "Subagent" || tool === "Skill") {
    let summary = desc.trim();
    if (summary.length > 0) {
      summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    }
    return truncate(summary, 35);
  }

  return truncate(desc, 35);
}

/** Tool display configuration */
export const TOOL_CONFIG: Record<string, { label: string; icon: string }> = {
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

/** Get the display label for a tool */
export function getToolLabel(tool: string, subagentType?: string, description?: string): string {
  if ((tool === "Task" || tool === "Subagent") && subagentType) {
    const agentNames: Record<string, string> = {
      Explore: "Explorer",
      Plan: "Planner",
      "general-purpose": "Agent",
      Bash: "Terminal",
    };
    return agentNames[subagentType] || subagentType;
  }

  if (tool === "Skill" && description) {
    const skillMatch = description.match(/^(\w+[-\w]*)/);
    if (skillMatch) return `/${skillMatch[1]}`;
  }

  return TOOL_CONFIG[tool]?.label || tool;
}
