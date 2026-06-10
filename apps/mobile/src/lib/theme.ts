// Ink-wash visual language: cool paper background, deep-ink serif text,
// blue brush accents.
//
// Palette — deep ink #0E2E52 (text, headers) · brush blue #1B4F8A (primary,
// buttons) · stroke blue #3D7BC0 (accents, links, ink) · wash #8FB8DE
// (highlights) · mist #E4EEF7 (selected states, cards) · paper #F7F8F6.
import { Platform } from "react-native";

export const colors = {
  background: "#F7F8F6", // paper
  surface: "#FFFFFF",
  ink: "#0E2E52", // deep ink
  inkSecondary: "#46627F",
  inkFaint: "#8094A9",
  hairline: "#DCE5ED",
  accent: "#1B4F8A", // brush blue
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
  danger: "#B0413E", // seal red — destructive actions, failures
};

export const serif = Platform.select({ ios: "Georgia", default: "serif" });
export const mono = Platform.select({ ios: "Menlo", default: "monospace" });

// Deep ink, brush blue, stroke blue, plus a seal red for warm contrast.
export const penColors = ["#0E2E52", "#1B4F8A", "#3D7BC0", "#B0413E"] as const;
export const HIGHLIGHTER_COLOR = "rgba(143, 184, 222, 0.5)"; // wash
export const PEN_WIDTH = 2.5;
export const HIGHLIGHTER_WIDTH = 18;

/** Max width of the article text column. */
export const MAX_CONTENT_WIDTH = 700;
/** Horizontal padding around the content column. */
export const CONTENT_PADDING = 20;
