import { Settings as SettingsType, WindowPosition } from "../hooks/useSettings";

interface SettingsProps {
  settings: SettingsType;
  onUpdate: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
  onReset: () => void;
  onClose: () => void;
}

const POSITION_OPTIONS: { value: WindowPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "top-right", label: "Top Right" },
  { value: "top-left", label: "Top Left" },
];

export function Settings({ settings, onUpdate, onReset, onClose }: SettingsProps) {
  return (
    <div className="absolute inset-0 bg-overlay-bg z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-overlay-border">
        <span className="text-xs font-medium text-overlay-text">Settings</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className="p-1.5 hover:bg-red-500/20 rounded text-overlay-muted hover:text-red-400 transition-colors"
          title="Close settings (Esc)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Settings List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Position */}
        <div className="space-y-1.5">
          <label className="text-xs text-overlay-muted">Window Position</label>
          <select
            value={settings.position}
            onChange={(e) => onUpdate("position", e.target.value as WindowPosition)}
            className="w-full bg-overlay-card border border-overlay-border rounded px-2 py-1.5 text-xs text-overlay-text focus:outline-none focus:border-overlay-accent"
          >
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Always on Top */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-overlay-muted">Always on Top</label>
          <button
            onClick={() => onUpdate("alwaysOnTop", !settings.alwaysOnTop)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.alwaysOnTop ? "bg-overlay-accent" : "bg-overlay-card border border-overlay-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                settings.alwaysOnTop ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Opacity */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-overlay-muted">Opacity</label>
            <span className="text-xs text-overlay-text">{settings.opacity}%</span>
          </div>
          <input
            type="range"
            min="50"
            max="100"
            value={settings.opacity}
            onChange={(e) => onUpdate("opacity", Number(e.target.value))}
            className="w-full h-1.5 bg-overlay-card rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-overlay-accent"
          />
        </div>

        {/* Max Recent Tasks */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-overlay-muted">Recent Tasks</label>
            <span className="text-xs text-overlay-text">{settings.maxRecentTasks}</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            value={settings.maxRecentTasks}
            onChange={(e) => onUpdate("maxRecentTasks", Number(e.target.value))}
            className="w-full h-1.5 bg-overlay-card rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-overlay-accent"
          />
        </div>

        {/* Auto-hide */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs text-overlay-muted block">Auto-hide when idle</label>
            <span className="text-[10px] text-overlay-muted/60">Hide when no active tasks</span>
          </div>
          <button
            onClick={() => onUpdate("autoHide", !settings.autoHide)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.autoHide ? "bg-overlay-accent" : "bg-overlay-card border border-overlay-border"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                settings.autoHide ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-overlay-border">
        <button
          onClick={onReset}
          className="w-full py-1.5 text-xs text-overlay-muted hover:text-overlay-text hover:bg-overlay-card rounded transition-colors"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
