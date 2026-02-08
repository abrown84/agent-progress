import { useRef } from "react";
// import { useVirtualizer } from "@tanstack/react-virtual";
import type { Task } from "../../types";
import { TaskCard } from "./TaskCard";

interface TaskListProps {
  activeTasks: Task[];
  completedTasks: Task[];
}

function EmptyState() {
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

function SectionHeader({ label, variant }: { label: string; variant: "active" | "recent" }) {
  return (
    <div className="flex items-center gap-2 px-1 mb-1.5">
      <span
        className={`text-[10px] font-medium uppercase tracking-wider ${
          variant === "active" ? "text-overlay-accent" : "text-overlay-muted"
        }`}
      >
        {label}
      </span>
      <div className="flex-1 h-px bg-overlay-border/50" />
    </div>
  );
}

export function TaskList({ activeTasks, completedTasks }: TaskListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const allItems = [...activeTasks, ...completedTasks];

  // Virtualizer setup for future optimization if list grows large
  // Currently rendering all items directly for simplicity
  // const virtualizer = useVirtualizer({
  //   count: allItems.length,
  //   getScrollElement: () => parentRef.current,
  //   estimateSize: () => 80,
  //   overscan: 3,
  // });

  if (allItems.length === 0) return <EmptyState />;

  // We still use headers outside the virtualizer for simplicity,
  // since the list is typically small (< 50 items)
  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-2">
      {activeTasks.length > 0 && (
        <div>
          <SectionHeader label="Active" variant="active" />
          <div className="space-y-1.5">
            {activeTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}

      {completedTasks.length > 0 && (
        <div>
          <div className={activeTasks.length > 0 ? "mt-3" : ""}>
            <SectionHeader label="Recent" variant="recent" />
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
