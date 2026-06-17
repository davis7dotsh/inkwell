// Tag colors: a small ink-wash-friendly palette plus a deterministic mapping
// from a stored color (a hex string) to the soft fill / border / readable
// foreground used to render a chip. Tags without a color fall back to the
// neutral house style (mist + accent), so an uncolored tag still looks tidy.

/** The swatches offered in the tag manager. Stored verbatim as `tag.color`. */
export const TAG_COLOR_SWATCHES = [
  "#1B4F8A", // brush blue
  "#2E7D6B", // pine
  "#B0413E", // seal red
  "#B8860B", // ochre
  "#7B4FA8", // plum
  "#3D7BC0", // stroke blue
] as const;

export type TagChipColors = {
  /** Readable text/icon color. */
  fg: string;
  /** Soft tint behind the chip. */
  bg: string;
  /** Hairline border. */
  border: string;
};

/** #RGB / #RRGGBB → {r,g,b}, or null when it isn't a hex color. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, "");
  if (value.length === 3) {
    const r = parseInt(value[0] + value[0], 16);
    const g = parseInt(value[1] + value[1], 16);
    const b = parseInt(value[2] + value[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (value.length === 6) {
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

/**
 * Resolve a chip's colors from its stored value. Uncolored (or unparseable)
 * tags use the neutral house palette via CSS custom properties so they track
 * light/dark automatically.
 */
export function tagDisplayColor(color: string | undefined): TagChipColors {
  if (!color) {
    return {
      fg: "var(--accent)",
      bg: "var(--mist)",
      border: "var(--link-underline)",
    };
  }
  const rgb = parseHex(color);
  if (!rgb) {
    return {
      fg: "var(--accent)",
      bg: "var(--mist)",
      border: "var(--link-underline)",
    };
  }
  const { r, g, b } = rgb;
  return {
    fg: color,
    bg: `rgba(${r}, ${g}, ${b}, 0.12)`,
    border: `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}
