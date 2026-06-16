// URL normalization shared by the REST routes and the MCP tools.

/**
 * Normalizes a pasted URL: trims, prefixes https:// when no scheme, then
 * requires http(s) and a dotted hostname. Returns null when unsalvageable.
 */
export function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url;
}

export const kindOf = (url: URL): "web" | "pdf" =>
  url.pathname.toLowerCase().endsWith(".pdf") ? "pdf" : "web";
