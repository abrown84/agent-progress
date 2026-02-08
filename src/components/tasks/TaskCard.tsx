import { memo, useEffect, useState, useMemo } from "react";
import type { Task } from "../../types";
import { TaskIcon } from "./TaskIcon";
import { getSummary, getToolLabel } from "../../utils/taskSummary";
import { formatDuration } from "../../utils/formatters";

interface TaskCardProps {
  task: Task;
}

export const TaskCard = memo(
  function TaskCard({ task }: TaskCardProps) {
    const [elapsed, setElapsed] = useState(0);

    const summary = useMemo(
      () => getSummary(task.description, task.tool),
      [task.description, task.tool]
    );

    const toolLabel = useMemo(
      () => getToolLabel(task.tool, task.subagentType, task.description),
      [task.tool, task.subagentType, task.description]
    );

    useEffect(() => {
      if (task.status !== "active") {
        if (task.endTime) setElapsed(task.endTime - task.startTime);
        return;
      }
      // Tick every second for active tasks
      const interval = setInterval(() => {
        setElapsed(Date.now() - task.startTime);
      }, 1000);
      return () => clearInterval(interval);
    }, [task.status, task.startTime, task.endTime]);

    const isActive = task.status === "active";
    const isError = task.status === "error";
    const hasProgress =
      isActive && task.downloadProgress !== undefined && task.downloadProgress > 0;

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
          {/* Spinner on the right for active tasks */}
          {isActive && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="relative w-7 h-7 flex items-center justify-center">
                <div className="absolute inset-0 spinner-outer rounded-full" />
                <div className="absolute inset-1 spinner-inner rounded-full" />
                <div className="w-2 h-2 bg-overlay-accent rounded-full animate-pulse" />
              </div>
            </div>
          )}

          <TaskIcon
            tool={task.tool}
            className={`mt-0.5 ${
              isActive
                ? "text-overlay-accent"
                : isError
                ? "text-overlay-error"
                : "text-overlay-success"
            }`}
          />

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
                {toolLabel}
              </span>
              {task.background && (
                <span className="px-1 py-0.5 text-[9px] bg-overlay-accent/10 text-overlay-accent rounded">
                  BG
                </span>
              )}
            </div>

            {/* Summary */}
            <div className="mt-1">
              <span
                className={`text-xs ${isActive ? "text-overlay-text" : "text-overlay-muted"}`}
                title={task.description}
              >
                {summary}
              </span>
            </div>

            {/* Download progress bar */}
            {hasProgress && (
              <div className="mt-1.5 w-full h-1.5 bg-overlay-border/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-100"
                  style={{ width: `${Math.min(task.downloadProgress!, 100)}%` }}
                />
              </div>
            )}

            {/* Duration & status */}
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
  },
  (prev, next) =>
    prev.task.id === next.task.id &&
    prev.task.status === next.task.status &&
    prev.task.downloadProgress === next.task.downloadProgress
);
