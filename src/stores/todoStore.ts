import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { TodoItem } from "../types";

interface TodoState {
  todos: TodoItem[];

  // Derived
  visibleTodos: () => TodoItem[];
  completedCount: () => number;
  totalCount: () => number;
  hasTodos: () => boolean;

  // Actions
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

/** Initialize Tauri event listener for todos - call once at app startup */
export function initTodoListeners(): () => void {
  const unlisten = listen<TodoItem[]>("todos-update", (event) => {
    useTodoStore.getState().setTodos(event.payload || []);
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}
