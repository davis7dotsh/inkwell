// Ink-wash visual language, mirrored from apps/mobile/src/lib/theme.ts.
// Layout styling lives in styles.css (same values as CSS custom properties);
// this module covers the places JS needs a literal color.
//
// Palette — deep ink #0E2E52 (text, headers) · brush blue #1B4F8A (primary,
// buttons) · stroke blue #3D7BC0 (accents, links, ink) · wash #8FB8DE
// (highlights) · mist #E4EEF7 (selected states, cards) · paper #F7F8F6.

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
};

/** Max width of the article text column (matches the mobile reader). */
export const MAX_CONTENT_WIDTH = 700;
