"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  ACCENTS,
  ACCENT_KEY,
  DARK_STYLE_KEY,
  DARK_STYLES,
  DEFAULT_APPEARANCE,
  LIGHT_STYLE_KEY,
  LIGHT_STYLES,
  MODE_OPTIONS,
  THEME_KEY,
  applyAppearance,
  readAppearance,
  resolveMode,
  type Accent,
  type AppearanceState,
  type DarkStyle,
  type LightStyle,
  type ThemeMode,
} from "../../lib/appearance";

const modeIcons = { light: Sun, dark: Moon, system: Monitor } as const;

function readStored(): AppearanceState {
  return readAppearance((key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  });
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function AppearanceSettings() {
  const [state, setState] = useState<AppearanceState>(DEFAULT_APPEARANCE);
  const [dark, setDark] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const sync = () => {
      const next = readStored();
      setState(next);
      setDark(media.matches);
      applyAppearance(document.documentElement, next, media.matches);
    };

    sync();
    const onMedia = () => {
      const next = readStored();
      setState(next);
      setDark(media.matches);
      applyAppearance(document.documentElement, next, media.matches);
    };
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === THEME_KEY ||
        event.key === LIGHT_STYLE_KEY ||
        event.key === DARK_STYLE_KEY ||
        event.key === ACCENT_KEY
      )
        onMedia();
    };

    media.addEventListener("change", onMedia);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function save(next: AppearanceState, message: string) {
    const darkNow = resolveMode(next.mode, prefersDark()) === "dark";
    setState(next);
    setDark(darkNow);
    applyAppearance(document.documentElement, next, prefersDark());
    try {
      window.localStorage.setItem(THEME_KEY, next.mode);
      window.localStorage.setItem(LIGHT_STYLE_KEY, next.lightStyle);
      window.localStorage.setItem(DARK_STYLE_KEY, next.darkStyle);
      window.localStorage.setItem(ACCENT_KEY, next.accent);
      setStatus(message);
    } catch {
      setStatus(
        "Appearance changed for this visit but could not be saved in this browser.",
      );
    }
  }

  function chooseMode(mode: ThemeMode) {
    const label = MODE_OPTIONS.find((option) => option.value === mode)?.label;
    save({ ...state, mode }, `${label} theme selected.`);
  }

  function chooseLightStyle(lightStyle: LightStyle) {
    const label = LIGHT_STYLES.find((option) => option.value === lightStyle)?.label;
    save({ ...state, lightStyle }, `${label} style selected.`);
  }

  function chooseDarkStyle(darkStyle: DarkStyle) {
    const label = DARK_STYLES.find((option) => option.value === darkStyle)?.label;
    save({ ...state, darkStyle }, `${label} style selected.`);
  }

  function chooseAccent(accent: Accent) {
    const label = ACCENTS.find((option) => option.value === accent)?.label;
    save({ ...state, accent }, `${label} accent selected.`);
  }

  const styles = dark ? DARK_STYLES : LIGHT_STYLES;
  const activeStyle = dark ? state.darkStyle : state.lightStyle;

  return (
    <section
      className="panel appearance-panel"
      aria-labelledby="appearance-title"
    >
      <h2 id="appearance-title">Appearance</h2>
      <p>
        Choose how Stash looks in this browser. System follows your device
        setting.
      </p>

      <div className="appearance-group">
        <h3 id="appearance-mode">Theme</h3>
        <div
          className="appearance-options"
          role="group"
          aria-labelledby="appearance-mode"
        >
          {MODE_OPTIONS.map(({ value, label }) => {
            const Icon = modeIcons[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={state.mode === value}
                onClick={() => chooseMode(value)}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="appearance-group">
        <h3 id="appearance-style">Style</h3>
        <div
          className="appearance-options"
          role="group"
          aria-labelledby="appearance-style"
        >
          {styles.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeStyle === value}
              onClick={() =>
                dark
                  ? chooseDarkStyle(value as DarkStyle)
                  : chooseLightStyle(value as LightStyle)
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-group">
        <h3 id="appearance-accent">Accent colour</h3>
        <div
          className="appearance-swatches"
          role="group"
          aria-labelledby="appearance-accent"
        >
          {ACCENTS.map((accent) => {
            const selected = state.accent === accent.value;
            return (
              <button
                key={accent.value}
                type="button"
                aria-pressed={selected}
                aria-label={`${accent.label} accent`}
                onClick={() => chooseAccent(accent.value)}
              >
                <span
                  className="appearance-swatch"
                  aria-hidden="true"
                  style={{
                    background: dark ? accent.dark : accent.light,
                    color: dark ? accent.onDark : accent.onLight,
                  }}
                >
                  {selected ? <Check size={15} strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
          <span className="appearance-accent-name" aria-hidden="true">
            {ACCENTS.find((accent) => accent.value === state.accent)?.label}
          </span>
        </div>
      </div>

      <p className="appearance-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
