"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";

const storageKey = "stash-theme";
const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>("system");
  const [status, setStatus] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const saved = isTheme(stored) ? stored : "system";
      setTheme(saved);
      applyTheme(saved);
    } catch {
      applyTheme("system");
    }

    const syncTheme = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const saved = isTheme(event.newValue) ? event.newValue : "system";
      setTheme(saved);
      applyTheme(saved);
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(storageKey, next);
      setStatus(
        `${options.find((option) => option.value === next)?.label} theme selected.`,
      );
    } catch {
      setStatus(
        "Theme changed for this visit but could not be saved in this browser.",
      );
    }
  }

  return (
    <section
      className="panel appearance-panel"
      aria-labelledby="appearance-title"
    >
      <h2 id="appearance-title">Appearance</h2>
      <p>
        Choose how the app looks in this browser. System follows your device
        setting.
      </p>
      <div className="appearance-options" aria-label="Theme">
        {options.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => chooseTheme(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p className="appearance-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
