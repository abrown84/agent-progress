import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export function useTodos() {
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    console.log("[useTodos] Setting up event listener...");

    const unlisten = listen<TodoItem[]>("todos-update", (event) => {
      console.log("[useTodos] Received todos:", event.payload);
      setTodos(event.payload || []);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const pendingTodos = todos.filter((t) => t.status === "pending");
  const inProgressTodos = todos.filter((t) => t.status === "in_progress");
  const completedTodos = todos.filter((t) => t.status === "completed");

  return {
    todos,
    pendingTodos,
    inProgressTodos,
    completedTodos,
    hasTodos: todos.length > 0,
  };
}
