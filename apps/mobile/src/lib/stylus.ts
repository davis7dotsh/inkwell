// Remembers whether an Apple Pencil has ever been used on this device.
// There is no API to query Pencil pairing — the practical pattern is to
// observe the first stylus touch and persist the fact. Once known, fingers
// scroll while the pencil draws; until then, fingers draw.
import Storage from "expo-sqlite/kv-store";

const KEY = "stylus-seen";

export async function loadStylusSeen(): Promise<boolean> {
  try {
    return (await Storage.getItem(KEY)) === "1";
  } catch {
    return false;
  }
}

export function persistStylusSeen(): void {
  Storage.setItem(KEY, "1").catch(() => {});
}
