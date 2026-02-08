import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/shallow";
import { Header } from "./components/Header";
import { TaskList } from "./components/tasks/TaskList";
import { TodoSection } from "./components/todos/TodoSection";
import { Settings } from "./components/Settings";
import { useTaskStore, initTaskListeners } from "./stores/taskStore";
import { initTodoListeners } from "./stores/todoStore";
import { useSettingsStore, selectSettings } from "./stores/settingsStore";
import { AUTO_HIDE_DELAY_MS } from "./utils/constants";

function App() {
  // Task store - use shallow comparison for arrays
  const { activeTasks, completedTasks, isVisible } = useTaskStore(
    useShallow((s) => ({
      activeTasks: s.activeTasks,
      completedTasks: s.completedTasks,
      isVisible: s.isVisible,
    }))
  );
  const clearCompleted = useTaskStore((s) => s.clearCompleted);
  const setIsVisible = useTaskStore((s) => s.setIsVisible);

  // Settings store - use shallow comparison to avoid infinite loops
  const settings = useSettingsStore(useShallow(selectSettings));
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [showSettings, setShowSettings] = useState(false);

  // Initialize event listeners once
  useEffect(() => {
    const cleanupTasks = initTaskListeners();
    const cleanupTodos = initTodoListeners();
    return () => {
      cleanupTasks();
      cleanupTodos();
    };
  }, []);

  // Close settings with Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettings) setShowSettings(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings]);

  // Auto-hide when idle
  useEffect(() => {
    if (settings.autoHide && activeTasks.length === 0 && isVisible) {
      const timer = setTimeout(() => {
        invoke("hide_window");
        setIsVisible(false);
      }, AUTO_HIDE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [settings.autoHide, activeTasks.length, isVisible, setIsVisible]);

  const handleMinimize = async () => {
    await invoke("hide_window");
    setIsVisible(false);
  };

  const handleClear = async () => {
    clearCompleted();
    await invoke("clear_events");
  };

  const displayedCompleted = completedTasks.slice(0, settings.maxRecentTasks);
  const windowOpacity = isVisible ? settings.opacity / 100 : 0;

  return (
    <div
      className={`h-full flex flex-col bg-overlay-bg rounded-lg border border-overlay-border shadow-2xl transition-opacity duration-200 ${
        !isVisible ? "pointer-events-none" : ""
      }`}
      style={{ opacity: windowOpacity }}
    >
      <Header
        activeTasks={activeTasks.length}
        onClear={handleClear}
        onMinimize={handleMinimize}
        onSettings={() => setShowSettings(true)}
      />
      <TodoSection />
      <TaskList activeTasks={activeTasks} completedTasks={displayedCompleted} />

      {showSettings && (
        <Settings
          settings={settings}
          onUpdate={updateSetting}
          onReset={resetSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
