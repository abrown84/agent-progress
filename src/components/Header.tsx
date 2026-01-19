import { invoke } from "@tauri-apps/api/core";

interface HeaderProps {
  activeTasks: number;
  onClear: () => void;
  onMinimize: () => void;
  onSettings: () => void;
}

export function Header({ activeTasks, onClear, onMinimize, onSettings }: HeaderProps) {
  const handleClose = async () => {
    await invoke("close_app");
  };

  const handleDevTools = async () => {
    await invoke("toggle_devtools");
  };

  return (
    <div className="drag-region flex items-center justify-between px-3 py-2 border-b border-overlay-border bg-overlay-bg/95">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-overlay-accent animate-pulse-slow" />
        <span className="text-xs font-medium text-overlay-text">
          Agent Progress
        </span>
        {activeTasks > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-overlay-accent/20 text-overlay-accent rounded">
            {activeTasks}
          </span>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          onClick={onSettings}
          className="p-1 hover:bg-overlay-card rounded text-overlay-muted hover:text-overlay-text transition-colors"
          title="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

        <button
          onClick={handleDevTools}
          className="p-1 hover:bg-overlay-card rounded text-overlay-muted hover:text-overlay-text transition-colors"
          title="Toggle DevTools"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>

        <button
          onClick={onClear}
          className="p-1 hover:bg-overlay-card rounded text-overlay-muted hover:text-overlay-text transition-colors"
          title="Clear completed"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>

        <button
          onClick={onMinimize}
          className="p-1 hover:bg-overlay-card rounded text-overlay-muted hover:text-overlay-text transition-colors"
          title="Minimize"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
          </svg>
        </button>

        <button
          onClick={handleClose}
          className="p-1 hover:bg-red-500/20 rounded text-overlay-muted hover:text-red-400 transition-colors"
          title="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
