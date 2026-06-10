// Syntax check for the WebView extraction script. Run with:
//   pnpm tsx scripts/test-extract-script.mjs

import assert from "node:assert/strict";

import { buildExtractScript } from "../src/lib/extractScript.ts";
import { READABILITY_SOURCE } from "../src/lib/readabilitySource.ts";

const script = buildExtractScript(READABILITY_SOURCE);

assert.equal(typeof script, "string", "script should be a string");
assert.ok(script.length > READABILITY_SOURCE.length, "script should embed the readability source");

// Syntax check only — constructing the Function parses the body without
// executing it.
new Function(script);

assert.ok(
  script.includes("ReactNativeWebView.postMessage"),
  'script must post results via "ReactNativeWebView.postMessage"'
);
assert.ok(
  script.trimEnd().endsWith("true;"),
  'script must end with "true;" (react-native-webview injectJavaScript requirement)'
);

console.log("EXTRACT SCRIPT SYNTAX OK");
