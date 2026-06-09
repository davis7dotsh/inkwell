// Builds the JavaScript injected into the extraction WebView after page load.
//
// Protocol: the script posts a single JSON message via
// window.ReactNativeWebView.postMessage with the shape
//   { ok: true, payload: { url, title, byline, siteName, excerpt, contentHtml } }
// or
//   { ok: false, error: string }
// Fields that would be `undefined` are sent as `null` (JSON has no undefined);
// the native side strips nulls before producing an ExtractionResult.

/**
 * Returns the script to pass to WebView.injectJavaScript. Safe to inject more
 * than once: a window flag guards against double extraction.
 */
export function buildExtractScript(readabilitySource: string): string {
  return `(function () {
  try {
    if (window.__marginaliaExtracted) {
      return;
    }
    window.__marginaliaExtracted = true;

    var post = function (msg) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    };

    // The vendored Readability.js declares a top-level \`Readability\` binding
    // and ends with a guarded \`module.exports = Readability\`. Shim \`module\`
    // so that assignment doesn't throw, then recover the constructor from
    // either the local binding or the shim.
    var ReadabilityCtor = (function () {
      var module = { exports: {} };
      ${readabilitySource}
      if (typeof Readability === "function") {
        return Readability;
      }
      return module.exports;
    })();

    if (typeof ReadabilityCtor !== "function") {
      post({ ok: false, error: "Failed to load Readability parser." });
      return;
    }

    var article = new ReadabilityCtor(document.cloneNode(true), {
      charThreshold: 250,
    }).parse();

    if (!article) {
      post({
        ok: false,
        error: "Could not find readable article content on this page.",
      });
      return;
    }

    var metaContent = function (selector) {
      var el = document.querySelector(selector);
      return (el && el.getAttribute("content")) || "";
    };

    post({
      ok: true,
      payload: {
        url: location.href,
        title: article.title || document.title || location.href,
        byline: article.byline || null,
        siteName:
          article.siteName ||
          metaContent('meta[property="og:site_name"]') ||
          location.hostname,
        excerpt:
          article.excerpt || metaContent('meta[name="description"]') || "",
        contentHtml: article.content,
      },
    });
  } catch (err) {
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ ok: false, error: String(err) })
      );
    } catch (e) {}
  }
})();
true;`;
}
