import type { CloudSettings, Settings as SettingsType, WindowPosition } from "../types";

interface SettingsProps {
  settings: SettingsType;
  onUpdate: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
  onUpdateCloud: <K extends keyof CloudSettings>(key: K, value: CloudSettings[K]) => void;
  onReset: () => void;
  onClose: () => void;
  showDesktopSettings?: boolean;
}

const POSITION_OPTIONS: { value: WindowPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "top-right", label: "Top Right" },
  { value: "top-left", label: "Top Left" },
];

export function Settings({
  settings,
  onUpdate,
  onUpdateCloud,
  onReset,
  onClose,
  showDesktopSettings = true,
}: SettingsProps) {
  const cloud = settings.cloud;

  return (
    <div className="absolute inset-0 bg-overlay-bg z-50 flex flex-col">
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

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {showDesktopSettings && (
          <>
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

            <div className="flex items-center justify-between">
              <label className="text-xs text-overlay-muted">Always on Top</label>
              <Toggle
                on={settings.alwaysOnTop}
                onToggle={() => onUpdate("alwaysOnTop", !settings.alwaysOnTop)}
              />
            </div>

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
          </>
        )}

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

        {showDesktopSettings && (
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs text-overlay-muted block">Auto-hide when idle</label>
              <span className="text-[10px] text-overlay-muted/60">Hide when no active tasks</span>
            </div>
            <Toggle on={settings.autoHide} onToggle={() => onUpdate("autoHide", !settings.autoHide)} />
          </div>
        )}

        {/* Cloud workspace */}
        <div className="pt-2 border-t border-overlay-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs text-overlay-text block font-medium">Cloud workspace</label>
              <span className="text-[10px] text-overlay-muted/60">
                Connect to a hosted Agent Progress server
              </span>
            </div>
            <Toggle
              on={cloud.enabled}
              onToggle={() => onUpdateCloud("enabled", !cloud.enabled)}
            />
          </div>

          {cloud.enabled && (
            <div className="space-y-2">
              <Field
                label="Server URL"
                value={cloud.baseUrl}
                placeholder="https://progress.brwnindustries.com"
                onChange={(v) => onUpdateCloud("baseUrl", v)}
              />
              <Field
                label="Read token (apr_…)"
                value={cloud.readToken}
                placeholder="apr_…"
                type="password"
                onChange={(v) => onUpdateCloud("readToken", v)}
              />
              {showDesktopSettings && (
                <>
                  <Field
                    label="Write token (apw_…) for forwarder"
                    value={cloud.writeToken}
                    placeholder="apw_…"
                    type="password"
                    onChange={(v) => onUpdateCloud("writeToken", v)}
                  />
                  <Field
                    label="Agent name"
                    value={cloud.agentName}
                    placeholder="desktop"
                    onChange={(v) => onUpdateCloud("agentName", v)}
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs text-overlay-muted block">
                        Forward local ~/.claude events
                      </label>
                      <span className="text-[10px] text-overlay-muted/60">
                        Push desktop events to the cloud workspace
                      </span>
                    </div>
                    <Toggle
                      on={cloud.forwardLocalEvents}
                      onToggle={() =>
                        onUpdateCloud("forwardLocalEvents", !cloud.forwardLocalEvents)
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <p className="text-[10px] text-overlay-muted/50 pt-2">
          Built by Brown Industries · No AI model calls in this app
        </p>
      </div>

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

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-10 h-5 rounded-full transition-colors ${
        on ? "bg-overlay-accent" : "bg-overlay-card border border-overlay-border"
      }`}
    >
      <div
        className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-overlay-muted">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-overlay-card border border-overlay-border rounded px-2 py-1.5 text-xs text-overlay-text focus:outline-none focus:border-overlay-accent"
      />
    </div>
  );
}
