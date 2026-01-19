import { Task } from "../hooks/useTasks";
import { TaskCard } from "./TaskCard";

interface TaskListProps {
  activeTasks: Task[];
  completedTasks: Task[];
}

export function TaskList({ activeTasks, completedTasks }: TaskListProps) {
  const hasAny = activeTasks.length > 0 || completedTasks.length > 0;

  if (!hasAny) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-overlay-muted/50 mb-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto"
            >
              <path d="M12 2a10 10 0 1 0 10 10" />
              <path d="M12 12 8 8" />
              <path d="M12 6v6" />
            </svg>
          </div>
          <p className="text-xs text-overlay-muted/70">Waiting for tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2">
      {activeTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-1 mb-1.5">
            <span className="text-[10px] font-medium text-overlay-accent uppercase tracking-wider">
              Active
            </span>
            <div className="flex-1 h-px bg-overlay-border/50" />
          </div>
          <div className="space-y-1.5">
            {activeTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}

      {completedTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-1 mb-1.5 mt-3">
            <span className="text-[10px] font-medium text-overlay-muted uppercase tracking-wider">
              Recent
            </span>
            <div className="flex-1 h-px bg-overlay-border/50" />
          </div>
          <div className="space-y-1.5">
            {completedTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
