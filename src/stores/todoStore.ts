import { create } from "zustand";
import type { TodoItem } from "../types";

interface TodoState {
  todos: TodoItem[];

  visibleTodos: () => TodoItem[];
  completedCount: () => number;
  totalCount: () => number;
  hasTodos: () => boolean;

  setTodos: (todos: TodoItem[]) => void;
}

export const useTodoStore = create<TodoState>()((set, get) => ({
  todos: [],

  visibleTodos: () => get().todos.filter((t) => t.status !== "completed"),
  completedCount: () => get().todos.filter((t) => t.status === "completed").length,
  totalCount: () => get().todos.length,
  hasTodos: () => get().todos.length > 0,

  setTodos: (todos) => set({ todos }),
}));

/** @deprecated Prefer initProgressTransport */
export function initTodoListeners(): () => void {
  return () => undefined;
}
