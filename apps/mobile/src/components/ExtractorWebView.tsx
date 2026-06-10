import React, { useCallback, useEffect, useRef } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { buildExtractScript } from "@/lib/extractScript";
import { READABILITY_SOURCE } from "@/lib/readabilitySource";
import type { ExtractionResult } from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 30000;

/** Delay after load end before injecting, to let SPA rendering settle. */
const INJECT_DELAY_MS = 500;

type Props = {
  url: string;
  onResult: (r: ExtractionResult) => void;
  onError: (message: string) => void;
  timeoutMs?: number;
};

type ExtractMessage =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Hidden WebView that loads `url`, runs Mozilla Readability on the rendered
 * page, and reports the extracted article (or an error) exactly once.
 *
 * The view is visually hidden but mounted — display:none would stop JS from
 * running on some platforms, so it is rendered full-screen with opacity 0.
 */
export function ExtractorWebView({
  url,
  onResult,
  onError,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const doneRef = useRef(false);
  const injectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest callbacks without re-arming the timeout effect.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  const finishOk = useCallback((result: ExtractionResult) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onResultRef.current(result);
  }, []);

  const finishError = useCallback((message: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onErrorRef.current(message);
  }, []);

  // Overall timeout for the whole load + extract pipeline.
  useEffect(() => {
    const timer = setTimeout(() => {
      finishError("Timed out loading the page.");
    }, timeoutMs);
    return () => {
      clearTimeout(timer);
      if (injectTimerRef.current != null) {
        clearTimeout(injectTimerRef.current);
      }
    };
  }, [timeoutMs, finishError]);

  const handleLoadEnd = useCallback(() => {
    if (doneRef.current) return;
    // SPAs may fire multiple load events; injecting repeatedly is safe because
    // the script guards against double execution. Delay slightly so
    // client-side rendering can settle first.
    if (injectTimerRef.current != null) {
      clearTimeout(injectTimerRef.current);
    }
    injectTimerRef.current = setTimeout(() => {
      if (doneRef.current) return;
      webViewRef.current?.injectJavaScript(
        buildExtractScript(READABILITY_SOURCE)
      );
    }, INJECT_DELAY_MS);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (doneRef.current) return;
      let message: ExtractMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as ExtractMessage;
      } catch {
        finishError("Received an unreadable response from the page.");
        return;
      }
      if (!message || typeof message !== "object") {
        finishError("Received an unreadable response from the page.");
        return;
      }
      if (message.ok) {
        // JSON can't carry undefined, so the page sends null for missing
        // optional fields; strip them here.
        const raw = message.payload ?? {};
        const result: ExtractionResult = {
          url: typeof raw.url === "string" ? raw.url : url,
          title: typeof raw.title === "string" && raw.title ? raw.title : url,
          contentHtml: typeof raw.contentHtml === "string" ? raw.contentHtml : "",
        };
        if (typeof raw.byline === "string" && raw.byline) {
          result.byline = raw.byline;
        }
        if (typeof raw.siteName === "string" && raw.siteName) {
          result.siteName = raw.siteName;
        }
        if (typeof raw.excerpt === "string" && raw.excerpt) {
          result.excerpt = raw.excerpt;
        }
        if (!result.contentHtml) {
          finishError("The page returned no article content.");
          return;
        }
        finishOk(result);
      } else {
        finishError(
          typeof message.error === "string" && message.error
            ? message.error
            : "Extraction failed for an unknown reason."
        );
      }
    },
    [url, finishOk, finishError]
  );

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onError={(event) => {
          finishError(
            `Failed to load the page: ${
              event.nativeEvent.description || "unknown error"
            }`
          );
        }}
        onHttpError={(event) => {
          const { statusCode, url: failedUrl } = event.nativeEvent;
          // Only fail on errors for the main document; subresources (images,
          // trackers) commonly 404 without affecting extraction.
          if (statusCode >= 400 && failedUrl === url) {
            finishError(
              `The page could not be loaded (HTTP ${statusCode}).`
            );
          }
        }}
      />
    </View>
  );
}

// Full-screen (not 1x1) so the page lays out at a realistic viewport — the
// extraction script stamps each image's on-screen size, which the reader uses
// for natural-size rendering. Still invisible and untouchable.
const styles = StyleSheet.create({
  hidden: {
    position: "absolute",
    top: 0,
    left: 0,
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
    opacity: 0,
    overflow: "hidden",
  },
});
