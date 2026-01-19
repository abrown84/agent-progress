import { TodoItem } from "../hooks/useTodos";

interface TodoSectionProps {
  todos: TodoItem[];
}

function getStatusIcon(status: TodoItem["status"]): JSX.Element {
  switch (status) {
    case "in_progress":
      return (
        <div className="relative w-4 h-4 flex items-center justify-center">
          <div className="absolute inset-0 spinner-outer rounded-full" style={{ borderWidth: '1.5px' }} />
          <div className="absolute inset-0.5 spinner-inner rounded-full" style={{ borderWidth: '1.5px' }} />
        </div>
      );
    case "completed":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-overlay-success">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    default: // pending
      return (
        <div className="w-3 h-3 rounded-full border-2 border-overlay-muted/50" />
      );
  }
}

function getStatusStyle(status: TodoItem["status"]): string {
  switch (status) {
    case "in_progress":
      return "text-overlay-text";
    case "completed":
      return "text-overlay-muted line-through";
    default:
      return "text-overlay-muted";
  }
}

export function TodoSection({ todos }: TodoSectionProps) {
  if (todos.length === 0) return null;

  // Filter to show in_progress first, then pending, hide completed
  const visibleTodos = todos.filter(t => t.status !== "completed");
  const completedCount = todos.filter(t => t.status === "completed").length;
  const totalCount = todos.length;

  if (visibleTodos.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-overlay-border/50">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-overlay-accent">
            <rect width="6" height="6" x="3" y="5" rx="1" />
            <path d="m3 17 2 2 4-4" />
            <path d="M13 6h8" />
            <path d="M13 12h8" />
            <path d="M13 18h8" />
          </svg>
          <span className="text-[10px] font-medium text-overlay-accent uppercase tracking-wider">
            Tasks
          </span>
        </div>
        <span className="text-[10px] text-overlay-muted">
          {completedCount}/{totalCount}
        </span>
      </div>

      <div className="space-y-1">
        {visibleTodos.map((todo, index) => (
          <div
            key={index}
            className={`flex items-center gap-2 py-0.5 ${
              todo.status === "in_progress" ? "animate-slide-in" : ""
            }`}
          >
            <div className="flex-shrink-0">
              {getStatusIcon(todo.status)}
            </div>
            <span
              className={`text-xs truncate ${getStatusStyle(todo.status)}`}
              title={todo.content}
            >
              {todo.status === "in_progress" ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1 bg-overlay-card rounded-full overflow-hidden">
        <div
          className="h-full progress-gradient transition-all duration-300"
          style={{ width: `${(completedCount / totalCount) * 100}%` }}
        />
      </div>
    </div>
  );
}
