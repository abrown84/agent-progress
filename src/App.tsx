import { useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { Header } from "./components/Header";
import { TaskList } from "./components/tasks/TaskList";
import { TodoSection } from "./components/todos/TodoSection";
import { Settings } from "./components/Settings";
import { useTaskStore } from "./stores/taskStore";
import { useSettingsStore, selectSettings } from "./stores/settingsStore";
import { initProgressTransport, getActiveTransport } from "./transport/bootstrap";
import { AUTO_HIDE_DELAY_MS } from "./utils/constants";
import { isTauriRuntime } from "./transport";

function App() {
  const { activeTasks, completedTasks, isVisible } = useTaskStore(
    useShallow((s) => ({
      activeTasks: s.activeTasks,
      completedTasks: s.completedTasks,
      isVisible: s.isVisible,
    }))
  );
  const clearCompleted = useTaskStore((s) => s.clearCompleted);
  const setIsVisible = useTaskStore((s) => s.setIsVisible);

  const settings = useSettingsStore(useShallow(selectSettings));
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const updateCloudSetting = useSettingsStore((s) => s.updateCloudSetting);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [showSettings, setShowSettings] = useState(false);
  const transportEpoch = useRef(0);

  // Initialize / re-init transport when cloud settings change
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const epoch = ++transportEpoch.current;

    void (async () => {
      cleanup = await initProgressTransport({ mode: "auto" });
      if (cancelled || epoch !== transportEpoch.current) {
        cleanup?.();
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [
    settings.cloud.enabled,
    settings.cloud.baseUrl,
    settings.cloud.readToken,
    settings.cloud.writeToken,
    settings.cloud.forwardLocalEvents,
    settings.cloud.agentName,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettings) setShowSettings(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (settings.autoHide && activeTasks.length === 0 && isVisible) {
      const timer = setTimeout(() => {
        void getActiveTransport()?.actions.hideWindow?.();
        setIsVisible(false);
      }, AUTO_HIDE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [settings.autoHide, activeTasks.length, isVisible, setIsVisible]);

  const handleMinimize = async () => {
    await getActiveTransport()?.actions.hideWindow?.();
    setIsVisible(false);
  };

  const handleClear = async () => {
    clearCompleted();
    await getActiveTransport()?.actions.clearEvents?.();
  };

  const displayedCompleted = completedTasks.slice(0, settings.maxRecentTasks);
  const windowOpacity = isVisible ? settings.opacity / 100 : 0;
  const desktop = isTauriRuntime();

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
        showDesktopControls={desktop}
      />
      <TodoSection />
      <TaskList activeTasks={activeTasks} completedTasks={displayedCompleted} />

      {showSettings && (
        <Settings
          settings={settings}
          onUpdate={updateSetting}
          onUpdateCloud={updateCloudSetting}
          onReset={resetSettings}
          onClose={() => setShowSettings(false)}
          showDesktopSettings={desktop}
        />
      )}
    </div>
  );
}

export default App;
