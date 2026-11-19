export type ThemeMode = "light" | "dark" | "system";
export type LightStyle = "paper" | "cool" | "warm";
export type DarkStyle = "forest" | "midnight" | "graphite" | "warm";
export type Accent = "violet" | "indigo" | "teal" | "clay" | "plum" | "slate";

export const THEME_KEY = "stash-theme";
export const LIGHT_STYLE_KEY = "stash-theme-light";
export const DARK_STYLE_KEY = "stash-theme-dark";
export const ACCENT_KEY = "stash-accent";

export const DEFAULT_THEME: ThemeMode = "system";
export const DEFAULT_LIGHT_STYLE: LightStyle = "paper";
export const DEFAULT_DARK_STYLE: DarkStyle = "forest";
export const DEFAULT_ACCENT: Accent = "violet";

export const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export const LIGHT_STYLES: { value: LightStyle; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "cool", label: "Cool" },
  { value: "warm", label: "Warm" },
];

export const DARK_STYLES: { value: DarkStyle; label: string }[] = [
  { value: "forest", label: "Forest" },
  { value: "midnight", label: "Midnight" },
  { value: "graphite", label: "Graphite" },
  { value: "warm", label: "Warm" },
];

export const ACCENTS: {
  value: Accent;
  label: string;
  light: string;
  dark: string;
  onLight: string;
  onDark: string;
}[] = [
  {
    value: "violet",
    label: "Violet",
    light: "#6b52c9",
    dark: "#b5a3ff",
    onLight: "#fff",
    onDark: "#21193a",
  },
  {
    value: "indigo",
    label: "Indigo",
    light: "#4a54c4",
    dark: "#aab3ff",
    onLight: "#fff",
    onDark: "#12142a",
  },
  {
    value: "teal",
    label: "Teal",
    light: "#0f6f66",
    dark: "#74d6c9",
    onLight: "#fff",
    onDark: "#08201d",
  },
  {
    value: "clay",
    label: "Clay",
    light: "#a34a22",
    dark: "#f0a184",
    onLight: "#fff",
    onDark: "#23110a",
  },
  {
    value: "plum",
    label: "Plum",
    light: "#8a3f68",
    dark: "#e5a2c5",
    onLight: "#fff",
    onDark: "#241019",
  },
  {
    value: "slate",
    label: "Slate",
    light: "#475569",
    dark: "#b9c5d3",
    onLight: "#fff",
    onDark: "#131820",
  },
];

export interface AppearanceState {
  mode: ThemeMode;
  lightStyle: LightStyle;
  darkStyle: DarkStyle;
  accent: Accent;
}

export const DEFAULT_APPEARANCE: AppearanceState = {
  mode: DEFAULT_THEME,
  lightStyle: DEFAULT_LIGHT_STYLE,
  darkStyle: DEFAULT_DARK_STYLE,
  accent: DEFAULT_ACCENT,
};

const modeValues = MODE_OPTIONS.map((option) => option.value);
const lightStyleValues = LIGHT_STYLES.map((option) => option.value);
const darkStyleValues = DARK_STYLES.map((option) => option.value);
const accentValues = ACCENTS.map((option) => option.value);

export function isThemeMode(value: unknown): value is ThemeMode {
  return modeValues.includes(value as ThemeMode);
}

export function isLightStyle(value: unknown): value is LightStyle {
  return lightStyleValues.includes(value as LightStyle);
}

export function isDarkStyle(value: unknown): value is DarkStyle {
  return darkStyleValues.includes(value as DarkStyle);
}

export function isAccent(value: unknown): value is Accent {
  return accentValues.includes(value as Accent);
}

export function resolveMode(mode: ThemeMode, prefersDark: boolean) {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** Read the stored appearance, falling back to defaults for missing or invalid values. */
export function readAppearance(
  read: (key: string) => string | null,
): AppearanceState {
  const mode = read(THEME_KEY);
  const light = read(LIGHT_STYLE_KEY);
  const dark = read(DARK_STYLE_KEY);
  const accent = read(ACCENT_KEY);
  return {
    mode: isThemeMode(mode) ? mode : DEFAULT_THEME,
    lightStyle: isLightStyle(light) ? light : DEFAULT_LIGHT_STYLE,
    darkStyle: isDarkStyle(dark) ? dark : DEFAULT_DARK_STYLE,
    accent: isAccent(accent) ? accent : DEFAULT_ACCENT,
  };
}

export function applyAppearance(
  root: HTMLElement,
  state: AppearanceState,
  prefersDark: boolean,
) {
  const theme = resolveMode(state.mode, prefersDark);
  root.dataset.theme = theme;
  root.dataset.themePreference = state.mode;
  root.dataset.themeStyle =
    theme === "dark" ? state.darkStyle : state.lightStyle;
  root.dataset.accent = state.accent;
}

/** Inline, pre-hydration setup so a saved appearance applies before first paint. */
export function appearanceScript() {
  return `(() => {
  const config = ${JSON.stringify({
    keys: {
      mode: THEME_KEY,
      light: LIGHT_STYLE_KEY,
      dark: DARK_STYLE_KEY,
      accent: ACCENT_KEY,
    },
    defaults: DEFAULT_APPEARANCE,
    allowed: {
      mode: modeValues,
      light: lightStyleValues,
      dark: darkStyleValues,
      accent: accentValues,
    },
  })};
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const read = (key, allowed, fallback) => {
    try {
      const value = window.localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const apply = () => {
    const mode = read(config.keys.mode, config.allowed.mode, config.defaults.mode);
    const lightStyle = read(config.keys.light, config.allowed.light, config.defaults.lightStyle);
    const darkStyle = read(config.keys.dark, config.allowed.dark, config.defaults.darkStyle);
    const accent = read(config.keys.accent, config.allowed.accent, config.defaults.accent);
    const theme = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    root.dataset.theme = theme;
    root.dataset.themePreference = mode;
    root.dataset.themeStyle = theme === "dark" ? darkStyle : lightStyle;
    root.dataset.accent = accent;
  };
  apply();
  media.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key === config.keys.mode ||
      event.key === config.keys.light ||
      event.key === config.keys.dark ||
      event.key === config.keys.accent
    )
      apply();
  });
})();`;
}
