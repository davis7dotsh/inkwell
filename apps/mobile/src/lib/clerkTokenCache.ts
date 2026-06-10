import type { TokenCache } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";

function hashScope(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createClerkTokenCache(publishableKey: string) {
  const cache = tokenCache;
  if (!cache) return undefined;

  const scope = hashScope(publishableKey);
  const scopedKey = (key: string) => `${key}-${scope}`;

  return {
    getToken: (key) => cache.getToken(scopedKey(key)),
    saveToken: (key, value) => cache.saveToken(scopedKey(key), value),
    clearToken: cache.clearToken
      ? (key) => cache.clearToken?.(scopedKey(key))
      : undefined,
  } satisfies TokenCache;
}
