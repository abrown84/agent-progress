import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Header } from "./components/Header";
import { TaskList } from "./components/TaskList";
import { TodoSection } from "./components/TodoSection";
import { Settings } from "./components/Settings";
import { useTasks } from "./hooks/useTasks";
import { useTodos } from "./hooks/useTodos";
import { useSettings } from "./hooks/useSettings";

function App() {
  const { activeTasks, completedTasks, isVisible, clearCompleted, setIsVisible } =
    useTasks();
  const { todos } = useTodos();
  const { settings, updateSetting, resetSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);

  // Close settings with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettings) {
        setShowSettings(false);
      }
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
      }, 3000);
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

  // Filter completed tasks based on settings
  const displayedCompletedTasks = completedTasks.slice(0, settings.maxRecentTasks);

  // Calculate opacity (0-1 range)
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
      <TodoSection todos={todos} />
      <TaskList activeTasks={activeTasks} completedTasks={displayedCompletedTasks} />

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
