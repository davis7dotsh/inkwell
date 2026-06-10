// Ink-wash visual language: cool paper background, deep-ink serif text,
// blue brush accents — in two finishes.
//
// Light — deep ink #0E2E52 (text, headers) · brush blue #1B4F8A (primary,
// buttons) · stroke blue #3D7BC0 (accents, links, ink) · wash #8FB8DE
// (highlights) · mist #E4EEF7 (selected states, cards) · paper #F7F8F6.
//
// Dark — "night study": deep NEUTRAL gray paper (never jet black, never
// blue-cast), with the brush blues lifted so they read as accents at night.
import { Platform, StyleSheet, useColorScheme } from "react-native";

const light = {
  background: "#F7F8F6", // paper
  surface: "#FFFFFF",
  ink: "#0E2E52", // deep ink
  inkSecondary: "#46627F",
  inkFaint: "#8094A9",
  hairline: "#DCE5ED",
  accent: "#1B4F8A", // brush blue
  onAccent: "#FFFFFF", // text/icons on accent-filled surfaces
  accentSoft: "#E4EEF7", // mist
  link: "#3D7BC0", // stroke blue
  linkUnderline: "#8FB8DE",
  codeBackground: "#ECF2F8",
  boxStroke: "#3D7BC0",
  boxFill: "rgba(61, 123, 192, 0.08)",
  noteBackground: "#E4EEF7", // mist
  noteBorder: "#8FB8DE", // wash
  noteText: "#0E2E52",
  wash: "#8FB8DE",
  mist: "#E4EEF7",
  danger: "#B0413E", // seal red — destructive text/icons, failures
  dangerSolid: "#B0413E", // filled destructive buttons (white label)
  dangerSoft: "rgba(176, 65, 62, 0.08)",
  errorSurface: "#FFF1EF",
  errorBorder: "#D98C82",
  backdrop: "rgba(14, 46, 82, 0.35)",
};

export type Palette = typeof light;

const dark: Palette = {
  background: "#17181A", // deep neutral gray, easy on night eyes
  surface: "#1E2022",
  ink: "#E7E9EC",
  inkSecondary: "#A4ABB4",
  inkFaint: "#737A84",
  hairline: "#2B2E32",
  accent: "#6FA3DC", // brush blue, lifted
  onAccent: "#0E2238", // deep ink label on the lifted blue
  accentSoft: "#1E2C3D",
  link: "#7FB2E8",
  linkUnderline: "#3D5A7A",
  codeBackground: "#1D2024",
  boxStroke: "#5E97D0",
  boxFill: "rgba(94, 151, 208, 0.10)",
  noteBackground: "#1E2C3D",
  noteBorder: "#3D5A7A",
  noteText: "#E3EAF2",
  wash: "#31506F",
  mist: "#1E2C3D",
  danger: "#E08A85",
  dangerSolid: "#C4524E",
  dangerSoft: "rgba(224, 138, 133, 0.12)",
  errorSurface: "#3A2422",
  errorBorder: "#6B4540",
  backdrop: "rgba(0, 0, 0, 0.5)",
};

export const palettes = { light, dark } as const;
export type Scheme = keyof typeof palettes;

/** Current palette, following the system appearance. */
export function useTheme() {
  const scheme: Scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, c: palettes[scheme], isDark: scheme === "dark" } as const;
}

/**
 * Builds one stylesheet per scheme at module load — components pick with
 * `themed[scheme]`, so no per-render StyleSheet.create.
 */
export function makeThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: Palette) => T
): Record<Scheme, T> {
  return { light: factory(light), dark: factory(dark) };
}

export const serif = Platform.select({ ios: "Georgia", default: "serif" });
export const mono = Platform.select({ ios: "Menlo", default: "monospace" });

// Deep ink, brush blue, stroke blue, plus a seal red for warm contrast.
// These are the CANONICAL stored stroke colors — annotations keep them in
// both themes; displayInkColor maps them for night rendering.
export const penColors = ["#0E2E52", "#1B4F8A", "#3D7BC0", "#B0413E"] as const;
export const HIGHLIGHTER_COLOR = "rgba(143, 184, 222, 0.5)"; // wash
export const PEN_WIDTH = 2.5;
export const HIGHLIGHTER_WIDTH = 18;

// Night-legible counterparts of the stored ink colors. Unknown colors pass
// through untouched, so the mapping is purely cosmetic and reversible.
const NIGHT_INK: Record<string, string> = {
  "#0E2E52": "#D9E6F4", // deep ink → pale ink
  "#1B4F8A": "#7FAEDF",
  "#3D7BC0": "#8FBCE9",
  "#B0413E": "#E08A85",
  [HIGHLIGHTER_COLOR]: "rgba(111, 163, 220, 0.40)",
};

/** Render-time color for a stored annotation ink. */
export function displayInkColor(color: string, isDark: boolean): string {
  return isDark ? NIGHT_INK[color] ?? color : color;
}

/** Max width of the article text column. */
export const MAX_CONTENT_WIDTH = 700;
/** Horizontal padding around the content column. */
export const CONTENT_PADDING = 20;
