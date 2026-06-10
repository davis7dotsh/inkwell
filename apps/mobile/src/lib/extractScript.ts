// Builds the JavaScript injected into the extraction WebView after page load.
//
// Protocol: the script posts a single JSON message via
// window.ReactNativeWebView.postMessage with the shape
//   { ok: true, payload: { url, title, byline, siteName, excerpt, contentHtml } }
// or
//   { ok: false, error: string }
// Fields that would be `undefined` are sent as `null` (JSON has no undefined);
// the native side strips nulls before producing an ExtractionResult.
//
// Extraction strategy:
//   1. Stamp every <img> in the LIVE document with its browser-resolved URL
//      (currentSrc — already absolute, already the right srcset/lazy-load
//      candidate) plus intrinsic and on-screen dimensions. This is the big
//      advantage of extracting inside a real browser.
//   2. Try Readability. Accept its result only if it found a substantial
//      amount of text.
//   3. Otherwise fall back to cloning the page's main content region and
//      stripping chrome (nav/footer/scripts/hidden nodes) — this keeps
//      non-article pages (landing pages, sponsor grids, docs) usable.

/**
 * Returns the script to pass to WebView.injectJavaScript. Safe to inject more
 * than once: a window flag guards against double extraction.
 */
export function buildExtractScript(readabilitySource: string): string {
  return `(function () {
  try {
    if (window.__inkwellExtracted) {
      return;
    }
    window.__inkwellExtracted = true;

    var post = function (msg) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    };

    // ---- 1. Image pre-pass on the live DOM ----
    // currentSrc is the URL the browser actually loaded (after srcset /
    // <picture> / lazy-load resolution) and is always absolute.
    var imgs = document.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      try {
        var resolved = img.currentSrc || img.src || "";
        if (resolved) {
          img.setAttribute("data-inkwell-src", resolved);
        }
        if (img.naturalWidth > 0) {
          img.setAttribute("data-inkwell-w", String(img.naturalWidth));
          img.setAttribute("data-inkwell-h", String(img.naturalHeight));
        }
        // Stamp the on-screen size, except for full-bleed images (>= 85% of
        // the viewport) — those should fill the reader column instead of
        // being frozen at this device's width.
        var rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.width < window.innerWidth * 0.85) {
          img.setAttribute("data-inkwell-cssw", String(Math.round(rect.width)));
          img.setAttribute("data-inkwell-cssh", String(Math.round(rect.height)));
        }
      } catch (e) {}
    }

    var metaContent = function (selector) {
      var el = document.querySelector(selector);
      return (el && el.getAttribute("content")) || "";
    };

    var finish = function (title, byline, siteName, excerpt, contentHtml) {
      post({
        ok: true,
        payload: {
          url: location.href,
          title: title || document.title || location.href,
          byline: byline || null,
          siteName:
            siteName ||
            metaContent('meta[property="og:site_name"]') ||
            location.hostname,
          excerpt: excerpt || metaContent('meta[name="description"]') || "",
          contentHtml: contentHtml,
        },
      });
    };

    // ---- 3. Fallback extractor for non-article pages ----
    var fallbackExtract = function () {
      var root = null;
      var candidates = ["main", "article", '[role="main"]', "#content", "body"];
      for (var c = 0; c < candidates.length; c++) {
        var el = document.querySelector(candidates[c]);
        if (el && el.textContent && el.textContent.trim().length > 80) {
          root = el;
          break;
        }
      }
      if (!root) root = document.body;
      var clone = root.cloneNode(true);
      // Site chrome & junk. Only strip <header> when we fell all the way back
      // to <body>; inside <main> a header often holds the page title.
      var junkSelector =
        'script,style,noscript,iframe,nav,footer,form,template,canvas,video,audio,[hidden],[aria-hidden="true"]';
      if (root.tagName === "BODY") junkSelector += ",header";
      var junk = clone.querySelectorAll(junkSelector);
      for (var j = 0; j < junk.length; j++) {
        if (junk[j].parentNode) junk[j].parentNode.removeChild(junk[j]);
      }
      // Absolutize what the parser keeps. Images already carry absolute
      // data-inkwell-src from the pre-pass; cover plain src + hrefs too.
      var anchors = clone.querySelectorAll("a[href]");
      for (var a = 0; a < anchors.length; a++) {
        try {
          anchors[a].setAttribute(
            "href",
            new URL(anchors[a].getAttribute("href"), location.href).toString()
          );
        } catch (e) {}
      }
      var cimgs = clone.querySelectorAll("img[src]");
      for (var m = 0; m < cimgs.length; m++) {
        try {
          cimgs[m].setAttribute(
            "src",
            new URL(cimgs[m].getAttribute("src"), location.href).toString()
          );
        } catch (e) {}
      }
      return clone;
    };

    // ---- 2. Readability attempt ----
    // The vendored Readability.js declares a top-level \`Readability\` binding
    // and ends with a guarded \`module.exports = Readability\`. Shim \`module\`
    // so that assignment doesn't throw, then recover the constructor from
    // either the local binding or the shim.
    var article = null;
    try {
      var ReadabilityCtor = (function () {
        var module = { exports: {} };
        ${readabilitySource}
        if (typeof Readability === "function") {
          return Readability;
        }
        return module.exports;
      })();
      if (typeof ReadabilityCtor === "function") {
        article = new ReadabilityCtor(document.cloneNode(true), {
          charThreshold: 250,
        }).parse();
      }
    } catch (e) {
      article = null;
    }

    var articleTextLength =
      article && article.textContent ? article.textContent.trim().length : 0;

    if (article && article.content && articleTextLength >= 500) {
      finish(
        article.title,
        article.byline,
        article.siteName,
        article.excerpt,
        article.content
      );
      return;
    }

    var fallback = fallbackExtract();
    if (
      !fallback ||
      !fallback.textContent ||
      fallback.textContent.trim().length < 80
    ) {
      post({
        ok: false,
        error: "Could not find readable content on this page.",
      });
      return;
    }
    finish(null, null, null, null, fallback.innerHTML);
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
